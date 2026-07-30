const crypto = require('crypto');

// Called after a session exists (login, or /me) so the frontend has a
// token to send back on every state-changing request.
function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  return req.session.csrfToken;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// /api/auth/login is exempt because there is no session/token yet at the
// point someone is logging in - it's protected by rate limiting instead
// (see rate-limit-config.js). Every other state-changing route requires a
// matching token once a session exists.
const EXEMPT_PATHS = new Set(['/api/auth/login']);

// Double-submit-cookie-style CSRF check, but using the session (server
// side) as the source of truth instead of a second cookie: the token is
// handed to the frontend once (on login/me) and must be echoed back in the
// X-CSRF-Token header on every POST/PUT/DELETE. A cross-site page can
// trigger a request with the browser's cookies attached, but it cannot
// read the token out of our JSON response to put it in that header.
function requireCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (EXEMPT_PATHS.has(req.path)) return next();
  if (!req.session || !req.session.user) return next(); // let requireLogin produce the 401 instead

  const headerToken = req.headers['x-csrf-token'];
  if (!headerToken || headerToken !== req.session.csrfToken) {
    return res.status(403).json({ error: 'Invalid or missing security token. Please refresh the page and try again.' });
  }
  next();
}

module.exports = { ensureCsrfToken, requireCsrf };
