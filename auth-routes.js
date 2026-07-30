const express = require('express');
const bcrypt = require('bcryptjs');
const { query, logAudit } = require('./db-init');
const { ensureCsrfToken } = require('./csrf-middleware');
const { loginLimiter } = require('./rate-limit-config');
const router = express.Router();

async function buildSessionUser(userRow) {
  let vertical = null;
  if (userRow.vertical_id) {
    const { rows } = await query('SELECT id, code, name, icon, logo_path FROM verticals WHERE id = $1', [userRow.vertical_id]);
    vertical = rows[0] || null;
  }
  return {
    id: userRow.id,
    username: userRow.username,
    full_name: userRow.full_name,
    role: userRow.role,
    vertical_id: userRow.vertical_id || null,
    vertical
  };
}

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    const { rows } = await query('SELECT * FROM users WHERE username = $1', [username]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      await logAudit({ username, action: 'Login Failed', ip_address: req.ip });
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    req.session.user = await buildSessionUser(user);
    const csrfToken = ensureCsrfToken(req);
    await logAudit({ username: user.username, vertical_id: user.vertical_id, action: 'Login', ip_address: req.ip });
    res.json({ user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', async (req, res) => {
  const user = req.session && req.session.user;
  if (user) {
    await logAudit({ username: user.username, vertical_id: user.vertical_id, action: 'Logout', ip_address: req.ip });
  }
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  const csrfToken = ensureCsrfToken(req);
  res.json({ user: req.session.user, csrfToken });
});

module.exports = router;
