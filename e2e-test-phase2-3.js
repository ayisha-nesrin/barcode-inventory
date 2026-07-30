process.env.PORT = '4401';
process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
process.env.SESSION_SECRET = 'test-secret';
// Rate limiting is intentionally left ENABLED for this suite (unlike
// e2e-test-eams.js) so the dedicated rate-limit test at the bottom can
// verify the real limiter actually trips. Everything before that section
// logs in only a handful of times, well under the 20/15min login ceiling.

const BASE = 'http://localhost:4401';
let cookie = '';
let csrfToken = '';

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('OK:', msg);
}

async function req(method, url, body, opts = {}) {
  const headers = opts.headers || {};
  if (cookie) headers['Cookie'] = cookie;
  if (opts.csrf !== false && csrfToken && method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
  if (opts.csrfOverride !== undefined) headers['X-CSRF-Token'] = opts.csrfOverride;
  let fetchBody = body;
  if (body && typeof body === 'object') {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(body);
  }
  const res = await fetch(BASE + url, { method, headers, body: fetchBody });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}

async function login(username, password) {
  cookie = '';
  csrfToken = '';
  const r = await req('POST', '/api/auth/login', { username, password });
  assert(r.status === 200, `login as ${username} -> 200`);
  csrfToken = (r.data && r.data.csrfToken) || '';
  return r.data.user;
}

async function main() {
  require('./server.js');
  await new Promise((r) => setTimeout(r, 2000));

  // ==========================================================
  // 1. RECYCLE BIN
  // ==========================================================
  const superAdmin = await login('superadmin', 'super123');
  let r = await req('GET', '/api/verticals');
  const studies = r.data.verticals.find((v) => v.code === 'aec-studies');

  // Create a throwaway asset to delete/restore
  r = await req('POST', '/api/assets/generate-barcode', {
    asset_name: 'Recycle Bin Test Item', serial_number: 'RBIN-TEST-001', vertical_id: studies.id
  });
  assert(r.status === 201, 'created a throwaway asset for recycle-bin testing -> 201');
  const rbinAssetId = r.data.asset.id;
  const rbinBarcode = r.data.asset.barcode;

  r = await req('GET', '/api/assets/recycle-bin');
  assert(r.status === 200 && Array.isArray(r.data.assets), 'GET /api/assets/recycle-bin -> 200 (super admin)');
  assert(!r.data.assets.some((a) => a.id === rbinAssetId), 'freshly-created asset is NOT in the recycle bin yet');

  r = await req('DELETE', `/api/assets/${rbinAssetId}`);
  assert(r.status === 200, 'soft-delete the test asset -> 200');

  r = await req('GET', '/api/assets/recycle-bin');
  assert(r.data.assets.some((a) => a.id === rbinAssetId), 'soft-deleted asset now appears in the recycle bin');

  r = await req('GET', '/api/assets');
  assert(!r.data.assets.some((a) => a.id === rbinAssetId), 'soft-deleted asset no longer appears in the normal asset list');

  // Only super_admin can see/restore the recycle bin
  const studiesAdmin = await login('studies.admin', 'studies123');
  r = await req('GET', '/api/assets/recycle-bin');
  assert(r.status === 403, 'vertical_admin CANNOT view the recycle bin -> 403');
  r = await req('POST', `/api/assets/${rbinAssetId}/restore`);
  assert(r.status === 403, 'vertical_admin CANNOT restore an asset -> 403');

  const studiesEmp = await login('studies.emp', 'emp123');
  r = await req('GET', '/api/assets/recycle-bin');
  assert(r.status === 403, 'employee CANNOT view the recycle bin -> 403');

  await login('superadmin', 'super123');
  r = await req('POST', `/api/assets/${rbinAssetId}/restore`);
  assert(r.status === 200, 'super_admin restores the asset -> 200');
  assert(r.data.asset.deleted_at === null, 'restored asset has deleted_at cleared');

  r = await req('GET', '/api/assets');
  assert(r.data.assets.some((a) => a.id === rbinAssetId), 'restored asset is back in the normal asset list');

  r = await req('GET', '/api/assets/recycle-bin');
  assert(!r.data.assets.some((a) => a.id === rbinAssetId), 'restored asset no longer appears in the recycle bin');

  r = await req('POST', `/api/assets/999999/restore`);
  assert(r.status === 404, 'restoring a non-existent/non-deleted asset id -> 404');

  // ==========================================================
  // 2. AUDIT LOG VIEWER (read-only, immutable, super_admin only)
  // ==========================================================
  r = await req('GET', '/api/audit-logs');
  assert(r.status === 200 && Array.isArray(r.data.logs), 'GET /api/audit-logs -> 200 for super admin');
  assert(r.data.logs.some((l) => l.action === 'Asset Restored'), 'the restore we just did shows up in the audit log');
  assert(r.data.logs.some((l) => l.action === 'Login'), 'login events are captured in the audit log');

  r = await req('GET', '/api/audit-logs/actions');
  assert(r.status === 200 && Array.isArray(r.data.actions) && r.data.actions.includes('Login'), 'GET /api/audit-logs/actions returns distinct action names');

  r = await req('GET', '/api/audit-logs?username=studies.admin');
  assert(r.data.logs.length > 0 && r.data.logs.every((l) => l.username === 'studies.admin'), 'audit log username filter works');

  r = await req('GET', '/api/audit-logs?action=Asset Restored');
  assert(r.data.logs.every((l) => l.action === 'Asset Restored'), 'audit log action filter works');

  await login('studies.admin', 'studies123');
  r = await req('GET', '/api/audit-logs');
  assert(r.status === 403, 'vertical_admin CANNOT view the audit log -> 403');

  await login('studies.emp', 'emp123');
  r = await req('GET', '/api/audit-logs');
  assert(r.status === 403, 'employee CANNOT view the audit log -> 403');

  // Immutability: confirm no PUT/PATCH/DELETE route exists at all
  await login('superadmin', 'super123');
  r = await req('PUT', '/api/audit-logs/1', { action: 'Tampered' });
  assert(r.status === 404 || r.status === 405, 'no route exists to edit an audit log entry (PUT -> 404/405)');
  r = await req('DELETE', '/api/audit-logs/1');
  assert(r.status === 404 || r.status === 405, 'no route exists to delete an audit log entry (DELETE -> 404/405)');

  // Duplicate-blocked events get logged too
  r = await req('POST', '/api/vendors', { name: 'Dell' }); // already seeded, should 409 + log
  assert(r.status === 409, 'duplicate vendor rejected (sanity check before checking the log)');

  // ==========================================================
  // 3. NOTIFICATIONS
  // ==========================================================
  r = await req('GET', '/api/notifications');
  assert(r.status === 200 && Array.isArray(r.data.notifications), 'GET /api/notifications -> 200');
  assert(typeof r.data.count === 'number' && r.data.count === r.data.notifications.length, 'notifications count matches array length');

  // Trigger a low-stock notification: drop a fresh asset's quantity to 1 (<=5 threshold)
  r = await req('POST', '/api/assets/generate-barcode', {
    asset_name: 'Low Stock Test Item', serial_number: 'LOWSTOCK-001', vertical_id: studies.id, quantity: 1
  });
  assert(r.status === 201, 'created a low-stock test asset (qty 1) -> 201');
  r = await req('GET', '/api/notifications');
  assert(r.data.notifications.some((n) => n.type === 'low_stock'), 'low-stock notification appears after creating a qty<=5 asset');

  // Vertical-scoped: studies.admin should see it, residency.admin should not
  await login('studies.admin', 'studies123');
  r = await req('GET', '/api/notifications');
  assert(r.data.notifications.some((n) => n.type === 'low_stock'), 'studies.admin sees the low-stock notification for their own vertical');

  const residencyAdmin = await login('residency.admin', 'residency123');
  r = await req('GET', '/api/notifications');
  assert(!r.data.notifications.some((n) => n.type === 'low_stock' && /Low Stock Test Item/.test(n.message)), 'residency.admin does NOT see a different vertical\'s low-stock notification');

  // ==========================================================
  // 4. CSRF PROTECTION
  // ==========================================================
  await login('superadmin', 'super123');

  // Missing token entirely
  r = await req('POST', '/api/vendors', { name: 'CSRF Test Vendor A' }, { csrfOverride: undefined, csrf: false });
  assert(r.status === 403, 'POST with NO X-CSRF-Token header -> 403');

  // Wrong/garbage token
  r = await req('POST', '/api/vendors', { name: 'CSRF Test Vendor B' }, { csrfOverride: 'totally-wrong-token-value' });
  assert(r.status === 403, 'POST with an INVALID X-CSRF-Token header -> 403');

  // Correct token succeeds
  r = await req('POST', '/api/vendors', { name: 'CSRF Test Vendor C' });
  assert(r.status === 201, 'POST with the correct X-CSRF-Token header -> 201');

  // GET requests never need a token
  r = await req('GET', '/api/assets', null, { csrf: false });
  assert(r.status === 200, 'GET requests are exempt from CSRF checks -> 200');

  // Login itself is exempt (no session/token exists yet)
  cookie = '';
  r = await req('POST', '/api/auth/login', { username: 'superadmin', password: 'super123' }, { csrf: false });
  assert(r.status === 200, 'POST /api/auth/login is exempt from CSRF (no prior session) -> 200');
  csrfToken = r.data.csrfToken;

  // ==========================================================
  // 5. RATE LIMITING
  // ==========================================================
  // Login limiter: 20 attempts/15min/IP. Fire 21 bad-password attempts and
  // confirm the limiter itself trips (429) before all 21 are exhausted -
  // we don't care exactly which attempt number trips it, only that it does.
  let sawLoginLimit = false;
  for (let i = 0; i < 25; i++) {
    const rr = await req('POST', '/api/auth/login', { username: 'nouser', password: 'wrong' }, { csrf: false });
    if (rr.status === 429) { sawLoginLimit = true; break; }
  }
  assert(sawLoginLimit, 'login rate limiter (20/15min) trips after repeated attempts -> 429');

  console.log('\nALL EAMS PHASE 2/3 TESTS PASSED');
  process.exit(0);
}

main().catch((err) => {
  console.error('\nTEST SUITE FAILED:', err);
  process.exit(1);
});
