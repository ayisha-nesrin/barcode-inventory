// db-init.js
// Simple embedded JSON database (lowdb) - no external database server required.
// Data is stored in db-data.json in this same folder.

const path = require('path');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const bcrypt = require('bcryptjs');

const adapter = new FileSync(path.join(__dirname, 'db-data.json'));
const db = low(adapter);

db.defaults({
  users: [],
  products: [],
  scans: [],
  meta: { nextUserId: 1, nextProductId: 1, nextScanId: 1 }
}).write();

function seed() {
  // Seed default users on first run
  if (db.get('users').size().value() === 0) {
    const now = new Date().toISOString();
    db.get('users')
      .push(
        {
          id: 1,
          username: 'admin',
          password_hash: bcrypt.hashSync('admin123', 10),
          full_name: 'System Administrator',
          role: 'admin',
          created_at: now
        },
        {
          id: 2,
          username: 'scanner1',
          password_hash: bcrypt.hashSync('scanner123', 10),
          full_name: 'Michael (Warehouse Scanner)',
          role: 'scanner',
          created_at: now
        }
      )
      .write();
    db.set('meta.nextUserId', 3).write();
  }

  // Seed sample products + scan history so the dashboard isn't empty on first run
  if (db.get('products').size().value() === 0) {
    const now = new Date();
    const iso = now.toISOString();
    const sampleProducts = [
      {
        id: 1,
        barcode: '8901234567890',
        product_name: 'Dell Latitude 5420 Laptop',
        image_path: null,
        position: 'Rack A-12',
        allocated_user: 'John Smith',
        remarks: 'IT Department asset',
        created_at: iso,
        updated_at: iso
      },
      {
        id: 2,
        barcode: '8901234567891',
        product_name: 'HP LaserJet Printer M404',
        image_path: null,
        position: 'Rack B-04',
        allocated_user: 'Sarah Lee',
        remarks: '',
        created_at: iso,
        updated_at: iso
      },
      {
        id: 3,
        barcode: '8901234567892',
        product_name: 'Logitech Wireless Mouse MX Master 3',
        image_path: null,
        position: 'Shelf C-01',
        allocated_user: 'Unassigned',
        remarks: 'Spare stock',
        created_at: iso,
        updated_at: iso
      },
      {
        id: 4,
        barcode: '8901234567893',
        product_name: 'Cisco 24-Port Network Switch',
        image_path: null,
        position: 'Server Room - Rack 2',
        allocated_user: 'Network Team',
        remarks: '',
        created_at: iso,
        updated_at: iso
      },
      {
        id: 5,
        barcode: '8901234567894',
        product_name: 'Office Chair - Ergonomic',
        image_path: null,
        position: 'Store Room D',
        allocated_user: 'Unassigned',
        remarks: 'New stock, unassigned',
        created_at: iso,
        updated_at: iso
      }
    ];
    db.get('products').push(...sampleProducts).write();
    db.set('meta.nextProductId', 6).write();

    const dateStr = iso.split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0];
    const sampleScans = sampleProducts.slice(0, 4).map((p, i) => ({
      id: i + 1,
      product_id: p.id,
      barcode: p.barcode,
      product_name: p.product_name,
      scanned_by: i % 2 === 0 ? 'admin' : 'scanner1',
      device_name: i % 2 === 0 ? 'Samsung Galaxy S24 (Chrome)' : 'iPhone 15 (Safari)',
      device_id: 'demo-device-' + (i % 2 === 0 ? '1' : '2'),
      scan_date: dateStr,
      scan_time: timeStr,
      position: p.position,
      allocated_user: p.allocated_user,
      remarks: 'Initial scan (demo data)',
      created_at: iso
    }));
    db.get('scans').push(...sampleScans).write();
    db.set('meta.nextScanId', sampleScans.length + 1).write();
  }
}

seed();

function nextId(counterKey) {
  const val = db.get(`meta.${counterKey}`).value();
  db.set(`meta.${counterKey}`, val + 1).write();
  return val;
}

module.exports = { db, nextId };
