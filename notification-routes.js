const express = require('express');
const { query } = require('./db-init');
const { requireLogin, scopeVerticalId } = require('./auth-middleware');
const router = express.Router();

router.use(requireLogin);

const LOW_STOCK_THRESHOLD = 5;

function todayIST() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date()).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Proactive alerts, computed live (not stored) each time this is called:
//   - warranty expiring within 30 days
//   - stock at/below the low-stock threshold
// Plus recent (last 24h) blocked-duplicate events pulled straight from the
// audit log (duplicate serial number, duplicate barcode, an asset that was
// already assigned) - those are the same events already logged by
// asset-routes.js/scan-routes.js at the moment they're blocked, surfaced
// here as a second, persistent channel beyond the one-off error toast.
router.get('/', async (req, res, next) => {
  try {
    const myVertical = scopeVerticalId(req);
    const today = todayIST();
    const in30 = addDays(today, 30);

    const assetParams = [];
    let assetVerticalClause = '';
    if (myVertical !== null) {
      assetParams.push(myVertical);
      assetVerticalClause = `AND a.vertical_id = $${assetParams.length}`;
    }

    const { rows: warrantyAssets } = await query(
      `SELECT a.*, ve.name AS vertical_name FROM assets a JOIN verticals ve ON a.vertical_id = ve.id
       WHERE a.deleted_at IS NULL AND a.warranty_expiry IS NOT NULL
         AND a.warranty_expiry >= $${assetParams.length + 1} AND a.warranty_expiry <= $${assetParams.length + 2}
         ${assetVerticalClause}
       ORDER BY a.warranty_expiry ASC`,
      [...assetParams, today, in30]
    );

    const { rows: lowStockAssets } = await query(
      `SELECT a.*, ve.name AS vertical_name FROM assets a JOIN verticals ve ON a.vertical_id = ve.id
       WHERE a.deleted_at IS NULL AND a.quantity > 0 AND a.quantity <= ${LOW_STOCK_THRESHOLD}
       ${assetVerticalClause}
       ORDER BY a.quantity ASC`,
      assetParams
    );

    // (Using explicit IN (...) placeholders rather than = ANY($1::text[])
    // for broader SQL-engine compatibility.)
    const logParams = ['Duplicate Serial Number Blocked', 'Duplicate Barcode Blocked', 'Duplicate Assignment Blocked'];
    let logVerticalClause = '';
    if (myVertical !== null) {
      logParams.push(myVertical);
      logVerticalClause = `AND vertical_id = $${logParams.length}`;
    }
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    logParams.push(since);
    const { rows: dupEvents } = await query(
      `SELECT * FROM audit_logs WHERE action IN ($1, $2, $3) ${logVerticalClause} AND ts >= $${logParams.length} ORDER BY ts DESC LIMIT 30`,
      logParams
    );

    const notifications = [
      ...warrantyAssets.map((a) => ({
        type: 'warranty_expiring', severity: 'warn',
        message: `${a.asset_name} (${a.barcode}) warranty expires ${a.warranty_expiry}${myVertical === null ? ' — ' + a.vertical_name : ''}`,
        created_at: a.warranty_expiry, vertical_id: a.vertical_id
      })),
      ...lowStockAssets.map((a) => ({
        type: 'low_stock', severity: 'warn',
        message: `${a.asset_name} is low on stock (${a.quantity} left)${myVertical === null ? ' — ' + a.vertical_name : ''}`,
        created_at: a.updated_at, vertical_id: a.vertical_id
      })),
      ...dupEvents.map((e) => ({
        type: 'duplicate_blocked', severity: 'danger',
        message: `${e.action.replace(' Blocked', '')} blocked (by ${e.username || 'unknown user'})`,
        created_at: e.ts, vertical_id: e.vertical_id
      }))
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ notifications, count: notifications.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
