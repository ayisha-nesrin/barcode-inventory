const express = require('express');
const { query } = require('./db-init');
const { requireLogin } = require('./auth-middleware');
const router = express.Router();

router.use(requireLogin);

// Match the "today" cutoff to India Standard Time, since scan_date on each
// scan record is already stored in IST (see scan-routes.js).
function todayIST() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date()).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

router.get('/', async (req, res, next) => {
  try {
    const { rows: products } = await query('SELECT * FROM products');
    const { rows: scans } = await query('SELECT * FROM scans ORDER BY id DESC');
    const { rows: userCountRows } = await query('SELECT COUNT(*)::int AS count FROM users');

    const today = todayIST();
    const scansToday = scans.filter((s) => s.scan_date === today).length;

    const byUser = {};
    scans.forEach((s) => {
      byUser[s.scanned_by] = (byUser[s.scanned_by] || 0) + 1;
    });

    const byPosition = {};
    products.forEach((p) => {
      const pos = p.position || 'Unassigned';
      byPosition[pos] = (byPosition[pos] || 0) + 1;
    });

    const recentScans = scans.slice(0, 10);

    res.json({
      totalProducts: products.length,
      totalScans: scans.length,
      scansToday,
      totalUsers: userCountRows[0].count,
      byUser,
      byPosition,
      recentScans
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
