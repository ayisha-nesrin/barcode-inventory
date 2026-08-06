const express = require('express');
const { query, logAudit } = require('./db-init');
const { requireLogin, requireSuperAdmin } = require('./auth-middleware');
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

// Removing a vendor is Super Admin only, since the vendor master list is
// shared across every business - a Vertical Admin deleting one could break
// other businesses' asset records. Blocked outright if any non-deleted
// asset still references this vendor, so nothing ever ends up pointing at
// a vendor that no longer exists.
router.delete('/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: existing } = await query('SELECT * FROM vendors WHERE id = $1', [id]);
    if (!existing.length) return res.status(404).json({ error: 'Vendor not found' });

    const { rows: inUse } = await query(
      'SELECT COUNT(*)::int AS count FROM assets WHERE vendor_id = $1 AND deleted_at IS NULL',
      [id]
    );
    if (inUse[0].count > 0) {
      return res.status(409).json({
        error: `Cannot remove "${existing[0].name}" - it's still used by ${inUse[0].count} asset(s). Change their vendor first, then try again.`
      });
    }

    await query('DELETE FROM vendors WHERE id = $1', [id]);
    await logAudit({
      username: req.session.user.username,
      action: 'Vendor Deleted',
      ip_address: req.ip,
      old_value: existing[0]
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
