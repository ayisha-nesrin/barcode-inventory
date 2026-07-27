const express = require('express');
const { db } = require('./db-init');
const { requireLogin } = require('./auth-middleware');
const router = express.Router();

router.use(requireLogin);

router.get('/', (req, res) => {
  const products = db.get('products').value();
  const scans = db.get('scans').value();
  const today = new Date().toISOString().split('T')[0];
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

  const recentScans = scans.slice().reverse().slice(0, 10);

  res.json({
    totalProducts: products.length,
    totalScans: scans.length,
    scansToday,
    totalUsers: db.get('users').value().length,
    byUser,
    byPosition,
    recentScans
  });
});

module.exports = router;
