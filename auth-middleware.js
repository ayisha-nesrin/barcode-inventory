// Role model (Phase 1 EAMS):
//   super_admin     - sees/manages every vertical, only role that can see across businesses
//   vertical_admin  - manages only their own assigned vertical
//   employee        - scans/adds/edits assets and assignments within their own vertical only
//
// IMPORTANT: vertical isolation is enforced HERE and in every route file
// that touches assets/scans/stats/search - never only in the frontend. A
// vertical_admin or employee token can never be used to read or write data
// belonging to a different vertical, no matter what the client sends.

function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.session || !req.session.user || req.session.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Super Admin access required' });
  }
  next();
}

function requireVerticalAdmin(req, res, next) {
  const role = req.session && req.session.user && req.session.user.role;
  if (role !== 'super_admin' && role !== 'vertical_admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Returns the vertical_id a request should be scoped to, or null if the
// caller is a super_admin and should see every vertical. Every route that
// lists or mutates assets/scans must call this and apply it in the SQL
// WHERE clause (or reject the request) rather than trusting any
// vertical_id the client may have sent in the request body/query.
function scopeVerticalId(req) {
  const user = req.session && req.session.user;
  if (!user) return undefined;
  if (user.role === 'super_admin') return null; // null = no restriction = all verticals
  return user.vertical_id;
}

module.exports = { requireLogin, requireSuperAdmin, requireVerticalAdmin, scopeVerticalId };
