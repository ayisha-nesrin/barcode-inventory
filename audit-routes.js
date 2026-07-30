const express = require('express');
const { query } = require('./db-init');
const { requireLogin, requireSuperAdmin } = require('./auth-middleware');
const router = express.Router();

// Read-only, Super Admin only. Deliberately: this file contains no PUT,
// PATCH, or DELETE route for audit_logs anywhere - there is no code path,
// for any role including Super Admin, that can alter or erase a log entry
// once db-init.js's logAudit() has written it. That's what makes the log
// "immutable" in practice, not a permissions check that could be changed
// later.
router.use(requireLogin, requireSuperAdmin);

router.get('/', async (req, res, next) => {
  try {
    const { username, action, vertical_id, from, to } = req.query;
    const clauses = [];
    const params = [];

    if (username) {
      params.push(username);
      clauses.push(`al.username = $${params.length}`);
    }
    if (action) {
      params.push(action);
      clauses.push(`al.action = $${params.length}`);
    }
    if (vertical_id) {
      params.push(Number(vertical_id));
      clauses.push(`al.vertical_id = $${params.length}`);
    }
    if (from) {
      params.push(from + 'T00:00:00.000Z');
      clauses.push(`al.ts >= $${params.length}`);
    }
    if (to) {
      params.push(to + 'T23:59:59.999Z');
      clauses.push(`al.ts <= $${params.length}`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT al.*, ve.name AS vertical_name, ve.icon AS vertical_icon, ve.code AS vertical_code
       FROM audit_logs al
       LEFT JOIN verticals ve ON al.vertical_id = ve.id
       ${where}
       ORDER BY al.ts DESC
       LIMIT 300`,
      params
    );
    res.json({ logs: rows });
  } catch (err) {
    next(err);
  }
});

// Distinct action names, purely to populate the filter dropdown with real
// values instead of a hardcoded list that could drift out of sync.
router.get('/actions', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT DISTINCT action FROM audit_logs ORDER BY action ASC');
    res.json({ actions: rows.map((r) => r.action) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
