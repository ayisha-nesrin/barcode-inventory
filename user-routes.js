const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('./db-init');
const { requireLogin, requireAdmin } = require('./auth-middleware');
const router = express.Router();

router.use(requireLogin, requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, username, full_name, role, created_at FROM users ORDER BY id ASC'
    );
    res.json({ users: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { username, password, full_name, role } = req.body || {};
    if (!username || !password || !role) {
      return res.status(400).json({ error: 'Username, password and role required' });
    }
    if (!['admin', 'scanner'].includes(role)) {
      return res.status(400).json({ error: 'Role must be "admin" or "scanner"' });
    }
    const { rows: existing } = await query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.length) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    const password_hash = bcrypt.hashSync(password, 10);
    const { rows } = await query(
      `INSERT INTO users (username, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4) RETURNING id, username, full_name, role, created_at`,
      [username, password_hash, full_name || username, role]
    );
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
    const { rows } = await query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
