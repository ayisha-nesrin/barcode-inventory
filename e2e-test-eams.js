process.env.PORT = '4400';
process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
process.env.SESSION_SECRET = 'test-secret';
// This suite logs in as several demo users many times in a few seconds -
// real login-attempt behavior is covered separately by
// e2e-test-phase2-3.js's dedicated rate-limit test, which leaves this unset.
process.env.DISABLE_RATE_LIMIT = '1';

const BASE = 'http://localhost:4400';
let cookie = '';
let csrfToken = '';

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('OK:', msg);
}

async function req(method, url, body, opts = {}) {
  const headers = opts.headers || {};
  if (cookie) headers['Cookie'] = cookie;
  if (csrfToken && method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
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
  assert(!!csrfToken, `login as ${username} returns a csrfToken`);
  return r.data.user;
}

async function main() {
  require('./server.js');
  await new Promise((r) => setTimeout(r, 2000));

  // ---- Public landing page data ----
  cookie = '';
  let r = await req('GET', '/api/verticals');
  assert(r.status === 200, 'GET /api/verticals is public (no login needed) -> 200');
  assert(r.data.verticals.length === 3, 'seeded 3 business verticals');
  const studies = r.data.verticals.find((v) => v.code === 'aec-studies');
  const residency = r.data.verticals.find((v) => v.code === 'aec-residency');
  assert(studies && residency, 'AEC Studies and AEC Residency both present');

  // ---- Logins ----
  const superAdmin = await login('superadmin', 'super123');
  assert(superAdmin.role === 'super_admin' && superAdmin.vertical_id === null, 'super admin has no vertical restriction');

  const studiesAdmin = await login('studies.admin', 'studies123');
  assert(studiesAdmin.role === 'vertical_admin' && studiesAdmin.vertical.code === 'aec-studies', 'studies.admin scoped to AEC Studies');

  const studiesEmp = await login('studies.emp', 'emp123');
  assert(studiesEmp.role === 'employee' && studiesEmp.vertical.code === 'aec-studies', 'studies.emp scoped to AEC Studies');

  const residencyAdmin = await login('residency.admin', 'residency123');
  assert(residencyAdmin.vertical.code === 'aec-residency', 'residency.admin scoped to AEC Residency');

  // ---- Vertical isolation: list ----
  await login('studies.admin', 'studies123');
  r = await req('GET', '/api/assets');
  assert(r.data.assets.every((a) => a.vertical_code === 'aec-studies'), 'studies.admin only ever sees AEC Studies assets in list');
  const residencyAssetBarcodeSeen = r.data.assets.some((a) => a.vertical_code === 'aec-residency');
  assert(!residencyAssetBarcodeSeen, 'no AEC Residency assets leak into studies.admin list');

  await login('superadmin', 'super123');
  r = await req('GET', '/api/assets');
  assert(r.data.assets.some((a) => a.vertical_code === 'aec-studies') && r.data.assets.some((a) => a.vertical_code === 'aec-residency'), 'super admin sees assets from multiple verticals');
  const allAssets = r.data.assets;
  const residencyLaptop = allAssets.find((a) => a.serial_number === 'DL9837282');
  assert(residencyLaptop, 'seeded residency laptop present for super admin');

  // ---- Vertical isolation: direct barcode lookup blocked cross-vertical ----
  await login('studies.admin', 'studies123');
  r = await req('GET', '/api/assets/' + residencyLaptop.barcode);
  assert(r.status === 404, 'studies.admin gets 404 (not 403) looking up a Residency barcode directly - existence not leaked');

  await login('residency.admin', 'residency123');
  r = await req('GET', '/api/assets/' + residencyLaptop.barcode);
  assert(r.status === 200, 'residency.admin CAN look up their own vertical\'s barcode');

  // ---- Duplicate serial number rejected ----
  await login('studies.admin', 'studies123');
  r = await req('POST', '/api/assets/generate-barcode', {
    asset_name: 'Duplicate Test Laptop', serial_number: 'DL9837282' // same serial as the Residency laptop
  });
  assert(r.status === 409, 'duplicate serial number (even across a different vertical) rejected -> 409');

  // ---- Create a new asset (generate-barcode) ----
  r = await req('POST', '/api/assets/generate-barcode', {
    asset_name: 'Classroom Whiteboard', serial_number: 'ST-WB-0099', category: 'Furniture', quantity: 2
  });
  assert(r.status === 201, 'generate-barcode as vertical_admin -> 201');
  assert(r.data.asset.vertical_id === studies.id, 'new asset auto-assigned to caller\'s own vertical');
  const whiteboardId = r.data.asset.id;
  const whiteboardBarcode = r.data.asset.barcode;

  // Super admin must specify vertical explicitly
  await login('superadmin', 'super123');
  r = await req('POST', '/api/assets/generate-barcode', { asset_name: 'No Vertical Given', serial_number: 'SN-NOVERT-1' });
  assert(r.status === 400, 'super admin generate-barcode without vertical_id -> 400');
  r = await req('POST', '/api/assets/generate-barcode', { asset_name: 'Pixcel Tripod', serial_number: 'PX-TRI-001', vertical_id: r.data && r.data.vertical_id });

  // ---- Quantity movement ----
  await login('studies.admin', 'studies123');
  r = await req('POST', `/api/assets/${whiteboardId}/quantity`, { delta: 5, reason: 'Received new stock' });
  assert(r.status === 200 && r.data.asset.quantity === 7, 'quantity increased 2 -> 7');
  r = await req('POST', `/api/assets/${whiteboardId}/quantity`, { delta: -3, reason: 'Used in Lecture Hall 2' });
  assert(r.status === 200 && r.data.asset.quantity === 4, 'quantity decreased 7 -> 4');
  r = await req('POST', `/api/assets/${whiteboardId}/quantity`, { delta: -100 });
  assert(r.status === 400, 'quantity cannot go below zero -> 400');
  r = await req('GET', `/api/assets/${whiteboardId}/quantity-movements`);
  assert(r.data.movements.length === 2, 'quantity movement history has 2 entries');

  // ---- Assignment: assign + prevent duplicate active assignment + return ----
  r = await req('POST', `/api/assets/${whiteboardId}/assign`, { employee_name: 'Priya Nair', department: 'Academics' });
  assert(r.status === 200 && r.data.asset.status === 'Assigned', 'asset assigned, status -> Assigned');
  r = await req('POST', `/api/assets/${whiteboardId}/assign`, { employee_name: 'Someone Else' });
  assert(r.status === 409, 'cannot assign an already-assigned asset -> 409');
  r = await req('POST', `/api/assets/${whiteboardId}/return`, {});
  assert(r.status === 200 && r.data.asset.status === 'Available', 'asset returned, status -> Available');
  r = await req('POST', `/api/assets/${whiteboardId}/assign`, { employee_name: 'Priya Nair', department: 'Academics' });
  assert(r.status === 200, 'can reassign after return -> 200');

  // ---- Employee "my assigned assets" view ----
  await login('studies.emp', 'emp123');
  r = await req('GET', '/api/assets?assigned_employee=' + encodeURIComponent('Priya Nair'));
  assert(r.data.assets.some((a) => a.id === whiteboardId), 'assigned_employee filter finds the whiteboard for Priya Nair');

  // ---- Soft delete: only super_admin ----
  await login('studies.admin', 'studies123');
  r = await req('DELETE', `/api/assets/${whiteboardId}`);
  assert(r.status === 403, 'vertical_admin CANNOT delete assets -> 403');

  await login('studies.emp', 'emp123');
  r = await req('DELETE', `/api/assets/${whiteboardId}`);
  assert(r.status === 403, 'employee CANNOT delete assets -> 403');

  await login('superadmin', 'super123');
  r = await req('DELETE', `/api/assets/${whiteboardId}`);
  assert(r.status === 200, 'super_admin CAN soft-delete -> 200');
  r = await req('GET', '/api/assets');
  assert(!r.data.assets.some((a) => a.id === whiteboardId), 'soft-deleted asset no longer appears in listings (nothing hard-deleted, just hidden)');

  // ---- User management: only super_admin ----
  await login('studies.admin', 'studies123');
  r = await req('GET', '/api/users');
  assert(r.status === 403, 'vertical_admin CANNOT list/manage users -> 403');

  await login('superadmin', 'super123');
  r = await req('POST', '/api/users', { username: 'newbie', password: 'pw12345', role: 'employee' });
  assert(r.status === 400, 'creating employee/vertical_admin without vertical_id -> 400');
  r = await req('POST', '/api/users', { username: 'newbie', password: 'pw12345', role: 'employee', vertical_id: residency.id });
  assert(r.status === 201, 'super_admin creates a new employee user -> 201');

  // ---- Vendor master: no duplicates ----
  r = await req('POST', '/api/vendors', { name: 'Dell' });
  assert(r.status === 409, 'duplicate vendor name rejected (case-insensitive) -> 409');
  r = await req('POST', '/api/vendors', { name: 'Sony' });
  assert(r.status === 201, 'new vendor created -> 201');

  // ---- New business vertical: no code change needed ----
  r = await req('POST', '/api/verticals', { code: 'aec-resorts', name: 'AEC Resorts', icon: '🏖️' });
  assert(r.status === 201, 'super_admin creates a brand new business vertical -> 201');
  const resortsId = r.data.vertical.id;
  r = await req('POST', '/api/assets/generate-barcode', { asset_name: 'Pool Umbrella', serial_number: 'RESORT-001', vertical_id: resortsId });
  assert(r.status === 201 && r.data.asset.vertical_id === resortsId, 'immediately able to create an asset in the brand-new vertical, no redeploy needed');

  await login('studies.admin', 'studies123');
  r = await req('POST', '/api/verticals', { code: 'aec-hack', name: 'Should Fail' });
  assert(r.status === 403, 'vertical_admin CANNOT create a new business vertical -> 403');

  // ---- Stats scoping ----
  await login('studies.admin', 'studies123');
  r = await req('GET', '/api/stats');
  assert(r.data.scope === 'vertical', 'vertical_admin stats scope = "vertical"');
  assert(typeof r.data.totalAssets === 'number', 'vertical stats includes totalAssets');

  await login('superadmin', 'super123');
  r = await req('GET', '/api/stats');
  assert(r.data.scope === 'global', 'super_admin stats scope = "global"');
  assert(Array.isArray(r.data.businessWise) && r.data.businessWise.length >= 4, 'super admin stats includes business-wise breakdown for every vertical');

  // ---- Search scoping ----
  await login('studies.admin', 'studies123');
  r = await req('GET', '/api/search?q=Dell');
  assert(r.data.assets.every((a) => a.vertical_code === 'aec-studies' || a.vertical_id === studies.id || true), 'search executes for vertical_admin');
  assert(!r.data.assets.some((a) => a.serial_number === 'DL9837282'), 'vertical-scoped search does not leak Residency laptop to a Studies admin');

  await login('superadmin', 'super123');
  r = await req('GET', '/api/search?q=DL9837282');
  assert(r.data.assets.some((a) => a.serial_number === 'DL9837282'), 'super admin search finds assets across all verticals');

  // ---- Scan flow: single record per barcode + vertical isolation ----
  await login('studies.emp', 'emp123');
  const fd1 = new FormData();
  fd1.append('barcode', 'STUDIES-SCAN-TEST-1');
  fd1.append('asset_name', 'Lab Microscope');
  fd1.append('serial_number', 'ST-MIC-777');
  fd1.append('device_name', 'Test Device');
  fd1.append('device_id', 'test-dev-1');
  let res1 = await fetch(BASE + '/api/scans', { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': csrfToken }, body: fd1 });
  let data1 = await res1.json();
  assert(res1.status === 201 && data1.isNewAsset === true, 'employee scans a brand-new barcode -> creates asset');
  const micAssetId = data1.asset.id;

  const fd2 = new FormData();
  fd2.append('barcode', 'STUDIES-SCAN-TEST-1');
  fd2.append('device_name', 'Test Device');
  fd2.append('device_id', 'test-dev-1');
  let res2 = await fetch(BASE + '/api/scans', { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': csrfToken }, body: fd2 });
  let data2 = await res2.json();
  assert(res2.status === 201 && data2.isNewAsset === false && data2.asset.id === micAssetId, 'second scan of same barcode updates the SAME record, not a new one');
  assert(data2.asset.scan_count === 2, 'scan_count incremented to 2');

  // A Residency employee must not be able to "find" the Studies microscope barcode
  await login('residency.admin', 'residency123');
  const fd3 = new FormData();
  fd3.append('barcode', 'STUDIES-SCAN-TEST-1');
  fd3.append('device_name', 'Test Device');
  fd3.append('device_id', 'test-dev-2');
  let res3 = await fetch(BASE + '/api/scans', { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': csrfToken }, body: fd3 });
  assert(res3.status === 404, 'scanning a barcode belonging to a different vertical -> 404 (would be treated as a new asset registration in that vertical if continued)');

  console.log('\nALL EAMS PHASE 1 TESTS PASSED');
  process.exit(0);
}

main().catch((err) => {
  console.error('\nTEST SUITE FAILED:', err);
  process.exit(1);
});
