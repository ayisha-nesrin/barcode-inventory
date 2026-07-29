const express = require('express');
const bcrypt = require('bcryptjs');
const { query, logAudit } = require('./db-init');
const { requireLogin, requireSuperAdmin } = require('./auth-middleware');
const router = express.Router();

// Per the PRD, user management (create/delete accounts) is a Super Admin
// only capability - a Vertical Admin cannot create or remove accounts,
// even within their own vertical.
router.use(requireLogin, requireSuperAdmin);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.username, u.full_name, u.role, u.vertical_id, u.created_at,
              ve.name AS vertical_name, ve.code AS vertical_code, ve.icon AS vertical_icon
       FROM users u
       LEFT JOIN verticals ve ON u.vertical_id = ve.id
       ORDER BY u.id ASC`
    );
    res.json({ users: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { username, password, full_name, role, vertical_id } = req.body || {};
    if (!username || !password || !role) {
      return res.status(400).json({ error: 'Username, password and role required' });
    }
    if (!['super_admin', 'vertical_admin', 'employee'].includes(role)) {
      return res.status(400).json({ error: 'Role must be "super_admin", "vertical_admin" or "employee"' });
    }
    if (role !== 'super_admin' && !vertical_id) {
      return res.status(400).json({ error: 'A business vertical is required for this role' });
    }
    const { rows: existing } = await query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.length) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    const password_hash = bcrypt.hashSync(password, 10);
    const { rows } = await query(
      `INSERT INTO users (username, password_hash, full_name, role, vertical_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, username, full_name, role, vertical_id, created_at`,
      [username, password_hash, full_name || username, role, role === 'super_admin' ? null : Number(vertical_id)]
    );
    await logAudit({
      username: req.session.user.username, action: 'User Created', ip_address: req.ip,
      new_value: { username, role, vertical_id: rows[0].vertical_id }
    });
    res.status(201).json({ user: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (req.session.user.id === id) {
      return res.status(400).json({ error: 'Cannot delete your own account while logged in' });
    }
    const { rows: existing } = await query('SELECT username, role, vertical_id FROM users WHERE id = $1', [id]);
    const { rows } = await query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    await logAudit({
      username: req.session.user.username, action: 'User Deleted', ip_address: req.ip,
      old_value: existing[0]
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
