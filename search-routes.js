const express = require('express');
const { query } = require('./db-init');
const { requireLogin } = require('./auth-middleware');
const router = express.Router();

router.use(requireLogin);

// Global dashboard search: looks across both products and scan history in
// one call, so the admin panel's search bar can show matching results from
// either. Kept to simple ILIKE matching (case-insensitive, partial match) -
// fine for the data volumes this app is designed for.
router.get('/', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ products: [], scans: [], query: '' });

    const like = `%${q}%`;

    const { rows: products } = await query(
      `SELECT * FROM products
       WHERE barcode ILIKE $1
          OR product_name ILIKE $1
          OR brand_name ILIKE $1
          OR category ILIKE $1
          OR variant ILIKE $1
          OR serial_number ILIKE $1
          OR position ILIKE $1
          OR allocated_user ILIKE $1
          OR remarks ILIKE $1
       ORDER BY id DESC
       LIMIT 50`,
      [like]
    );

    const { rows: scans } = await query(
      `SELECT * FROM scans
       WHERE barcode ILIKE $1
          OR product_name ILIKE $1
          OR scanned_by ILIKE $1
          OR device_name ILIKE $1
          OR position ILIKE $1
          OR allocated_user ILIKE $1
          OR remarks ILIKE $1
          OR scan_date ILIKE $1
          OR scan_time ILIKE $1
       ORDER BY id DESC
       LIMIT 50`,
      [like]
    );

    res.json({ products, scans, query: q });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
