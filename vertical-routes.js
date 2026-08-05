const express = require('express');
const multer = require('multer');
const { query, logAudit } = require('./db-init');
const { requireLogin, requireSuperAdmin } = require('./auth-middleware');
const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 }
});

// Same trick used for asset/scan photos: store the uploaded image directly
// as a base64 data URL in the database column (logo_path), no separate
// file storage or logos/ folder to keep in sync. This is what lets a new
// business get a real logo at the moment it's created, from a normal file
// picker, instead of someone having to manually upload a file into a
// logos/ folder in the GitHub repo afterwards.
function fileToDataUrl(file) {
  if (!file) return undefined;
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
}

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
// change, no redeploy required. Super Admin only. Accepts multipart/form-data
// so an optional logo image can be uploaded at the same time (field name
// "logo") - it's stored straight into logo_path as a data URL, same pattern
// as asset/scan photos.
router.post('/', requireLogin, requireSuperAdmin, upload.single('logo'), async (req, res, next) => {
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
    const logo_path = fileToDataUrl(req.file) || null;
    const { rows } = await query(
      `INSERT INTO verticals (code, name, icon, logo_path) VALUES ($1, $2, $3, $4) RETURNING *`,
      [cleanCode, name, icon || '🏢', logo_path]
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

// Update an existing business - Super Admin only. Also accepts multipart so
// a logo can be uploaded/replaced after creation from the same form.
router.put('/:id', requireLogin, requireSuperAdmin, upload.single('logo'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: existingRows } = await query('SELECT * FROM verticals WHERE id = $1', [id]);
    if (!existingRows.length) return res.status(404).json({ error: 'Business vertical not found' });

    const { name, icon, active } = req.body || {};
    const uploadedLogo = fileToDataUrl(req.file);
    const fields = [];
    const params = [];
    function set(col, val) {
      params.push(val);
      fields.push(`${col} = $${params.length}`);
    }
    if (name !== undefined) set('name', name);
    if (icon !== undefined) set('icon', icon);
    if (uploadedLogo !== undefined) set('logo_path', uploadedLogo);
    if (active !== undefined) set('active', active === 'false' || active === false ? false : Boolean(active));
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

// Remove a business from view - soft delete (sets active = false) rather
// than a hard DELETE, consistent with how assets are recycled elsewhere in
// the app: nothing referencing this vertical_id (existing assets, scans,
// users, audit log rows) breaks, it just stops showing up in the active
// list (landing page, dropdowns, Businesses tab). Super Admin only, and
// blocked if it's the last remaining active business.
router.delete('/:id', requireLogin, requireSuperAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: existingRows } = await query('SELECT * FROM verticals WHERE id = $1 AND active = true', [id]);
    if (!existingRows.length) return res.status(404).json({ error: 'Business vertical not found' });

    const { rows: activeCount } = await query('SELECT COUNT(*)::int AS count FROM verticals WHERE active = true');
    if (activeCount[0].count <= 1) {
      return res.status(400).json({ error: 'Cannot remove the only remaining business' });
    }

    const { rows } = await query('UPDATE verticals SET active = false WHERE id = $1 RETURNING *', [id]);
    await logAudit({
      username: req.session.user.username,
      action: 'Business Vertical Removed',
      ip_address: req.ip,
      old_value: existingRows[0]
    });
    res.json({ vertical: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
