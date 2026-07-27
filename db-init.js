// db-init.js
// Persistent database backed by PostgreSQL (works with Neon's free tier,
// or any Postgres connection string). Replaces the old local-JSON-file
// storage so data survives server restarts and redeploys.
//
// Set the connection string via the DATABASE_URL environment variable.
// Neon's connection strings need SSL, which is handled below automatically.

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is not set.');
  console.error('Set it to your Neon (or other Postgres) connection string before starting the server.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
});

async function query(text, params) {
  return pool.query(text, params);
}

const bcrypt = require('bcryptjs');

function getIST(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`
  };
}

async function initDB() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT,
      role TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      barcode TEXT UNIQUE NOT NULL,
      product_name TEXT NOT NULL,
      image_path TEXT,
      position TEXT DEFAULT '',
      allocated_user TEXT DEFAULT '',
      remarks TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS scans (
      id SERIAL PRIMARY KEY,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      barcode TEXT NOT NULL,
      product_name TEXT,
      scanned_by TEXT,
      device_name TEXT,
      device_id TEXT,
      scan_date TEXT,
      scan_time TEXT,
      position TEXT,
      allocated_user TEXT,
      remarks TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await seed();
}

async function seed() {
  const { rows: userRows } = await query('SELECT COUNT(*)::int AS count FROM users');
  if (userRows[0].count === 0) {
    await query(
      `INSERT INTO users (username, password_hash, full_name, role) VALUES
        ($1, $2, $3, $4),
        ($5, $6, $7, $8)`,
      [
        'admin', bcrypt.hashSync('admin123', 10), 'System Administrator', 'admin',
        'scanner1', bcrypt.hashSync('scanner123', 10), 'Michael (Warehouse Scanner)', 'scanner'
      ]
    );
  }

  const { rows: productRows } = await query('SELECT COUNT(*)::int AS count FROM products');
  if (productRows[0].count === 0) {
    const sampleProducts = [
      ['8901234567890', 'Dell Latitude 5420 Laptop', 'Rack A-12', 'John Smith', 'IT Department asset'],
      ['8901234567891', 'HP LaserJet Printer M404', 'Rack B-04', 'Sarah Lee', ''],
      ['8901234567892', 'Logitech Wireless Mouse MX Master 3', 'Shelf C-01', 'Unassigned', 'Spare stock'],
      ['8901234567893', 'Cisco 24-Port Network Switch', 'Server Room - Rack 2', 'Network Team', ''],
      ['8901234567894', 'Office Chair - Ergonomic', 'Store Room D', 'Unassigned', 'New stock, unassigned']
    ];

    for (const [barcode, product_name, position, allocated_user, remarks] of sampleProducts) {
      const { rows } = await query(
        `INSERT INTO products (barcode, product_name, position, allocated_user, remarks)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [barcode, product_name, position, allocated_user, remarks]
      );
      // Seed one demo scan for the first 4 sample products
      if (['8901234567890', '8901234567891', '8901234567892', '8901234567893'].includes(barcode)) {
        const idx = sampleProducts.findIndex((p) => p[0] === barcode);
        const ist = getIST(new Date());
        await query(
          `INSERT INTO scans (product_id, barcode, product_name, scanned_by, device_name, device_id, scan_date, scan_time, position, allocated_user, remarks)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            rows[0].id, barcode, product_name,
            idx % 2 === 0 ? 'admin' : 'scanner1',
            idx % 2 === 0 ? 'Samsung Galaxy S24 (Chrome)' : 'iPhone 15 (Safari)',
            'demo-device-' + (idx % 2 === 0 ? '1' : '2'),
            ist.date, ist.time,
            position, allocated_user, 'Initial scan (demo data)'
          ]
        );
      }
    }
  }
}

module.exports = { pool, query, initDB };
