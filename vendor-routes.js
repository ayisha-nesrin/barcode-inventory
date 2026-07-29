const express = require('express');
const { query, logAudit } = require('./db-init');
const { requireLogin } = require('./auth-middleware');
const router = express.Router();

router.use(requireLogin);

// Shared master list across all verticals (Dell, HP, Lenovo, ...). Any
// logged-in user can read it (needed for the asset registration dropdown).
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM vendors ORDER BY name ASC');
    res.json({ vendors: rows });
  } catch (err) {
    next(err);
  }
});

// Adding a vendor is allowed from the registration form ("+ Add Vendor" if
// it's not in the list yet), but duplicates are always rejected so the
// master list never fragments into "Dell" / "dell " / "DELL Inc".
router.post('/', async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Vendor name required' });
    }
    const clean = name.trim();
    const { rows: existing } = await query('SELECT * FROM vendors WHERE LOWER(name) = LOWER($1)', [clean]);
    if (existing.length) {
      return res.status(409).json({ error: 'This vendor already exists', vendor: existing[0] });
    }
    const { rows } = await query('INSERT INTO vendors (name) VALUES ($1) RETURNING *', [clean]);
    await logAudit({
      username: req.session.user.username,
      vertical_id: req.session.user.vertical_id,
      action: 'Vendor Created',
      ip_address: req.ip,
      new_value: rows[0]
    });
    res.status(201).json({ vendor: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
