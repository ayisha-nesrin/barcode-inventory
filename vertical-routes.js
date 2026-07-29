const express = require('express');
const { query, logAudit } = require('./db-init');
const { requireLogin, requireSuperAdmin } = require('./auth-middleware');
const router = express.Router();

// GET / is intentionally public (no requireLogin) - the AEC Group landing
// page needs to render the vertical cards (name + icon) BEFORE anyone logs
// in. Nothing sensitive is exposed here, only the list of business units.
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT id, code, name, icon, logo_path FROM verticals WHERE active = true ORDER BY id ASC');
    res.json({ verticals: rows });
  } catch (err) {
    next(err);
  }
});

// Adding a brand new AEC business unit is just a database row - no code
// change, no redeploy required. Super Admin only.
router.post('/', requireLogin, requireSuperAdmin, async (req, res, next) => {
  try {
    const { code, name, icon } = req.body || {};
    if (!code || !name) {
      return res.status(400).json({ error: 'Code and name are required' });
    }
    const cleanCode = String(code).trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const { rows: existing } = await query('SELECT id FROM verticals WHERE code = $1', [cleanCode]);
    if (existing.length) {
      return res.status(409).json({ error: 'A business vertical with this code already exists' });
    }
    const { rows } = await query(
      `INSERT INTO verticals (code, name, icon) VALUES ($1, $2, $3) RETURNING *`,
      [cleanCode, name, icon || '🏢']
    );
    await logAudit({
      username: req.session.user.username,
      action: 'Business Vertical Created',
      ip_address: req.ip,
      new_value: rows[0]
    });
    res.status(201).json({ vertical: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireLogin, requireSuperAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: existingRows } = await query('SELECT * FROM verticals WHERE id = $1', [id]);
    if (!existingRows.length) return res.status(404).json({ error: 'Business vertical not found' });

    const { name, icon, logo_path, active } = req.body || {};
    const fields = [];
    const params = [];
    function set(col, val) {
      params.push(val);
      fields.push(`${col} = $${params.length}`);
    }
    if (name !== undefined) set('name', name);
    if (icon !== undefined) set('icon', icon);
    if (logo_path !== undefined) set('logo_path', logo_path);
    if (active !== undefined) set('active', active);
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

    params.push(id);
    const { rows } = await query(`UPDATE verticals SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    await logAudit({
      username: req.session.user.username,
      action: 'Business Vertical Updated',
      ip_address: req.ip,
      old_value: existingRows[0],
      new_value: rows[0]
    });
    res.json({ vertical: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
