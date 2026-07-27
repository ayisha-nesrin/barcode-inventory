const express = require('express');
const bcrypt = require('bcryptjs');
const { db, nextId } = require('./db-init');
const { requireLogin, requireAdmin } = require('./auth-middleware');
const router = express.Router();

router.use(requireLogin, requireAdmin);

router.get('/', (req, res) => {
  const users = db
    .get('users')
    .value()
    .map((u) => ({
      id: u.id,
      username: u.username,
      full_name: u.full_name,
      role: u.role,
      created_at: u.created_at
    }));
  res.json({ users });
});

router.post('/', (req, res) => {
  const { username, password, full_name, role } = req.body || {};
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Username, password and role required' });
  }
  if (!['admin', 'scanner'].includes(role)) {
    return res.status(400).json({ error: 'Role must be "admin" or "scanner"' });
  }
  if (db.get('users').find({ username }).value()) {
    return res.status(409).json({ error: 'Username already exists' });
  }
  const now = new Date().toISOString();
  const user = {
    id: nextId('nextUserId'),
    username,
    password_hash: bcrypt.hashSync(password, 10),
    full_name: full_name || username,
    role,
    created_at: now
  };
  db.get('users').push(user).write();
  res.status(201).json({
    user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, created_at: user.created_at }
  });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (req.session.user.id === id) {
    return res.status(400).json({ error: 'Cannot delete your own account while logged in' });
  }
  const user = db.get('users').find({ id }).value();
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.get('users').remove({ id }).write();
  res.json({ ok: true });
});

module.exports = router;
