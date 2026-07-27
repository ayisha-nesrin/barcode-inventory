const express = require('express');
const multer = require('multer');
const { query } = require('./db-init');
const { requireLogin } = require('./auth-middleware');
const router = express.Router();

// Photos are kept small and stored as base64 directly in the database (as a
// data: URL) instead of on local disk. This is what makes photos survive
// server restarts/redeploys on hosts with no persistent disk (e.g. Render
// free tier) - the database (Neon) is the only thing that needs to persist.
// Kept deliberately small (3MB) since base64 inflates size ~33% and the
// free Neon tier has a limited total storage budget.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 }
});

function fileToDataUrl(file) {
  if (!file) return undefined;
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
}

// The server (e.g. Render) may run in UTC regardless of where your team is.
// Always compute the displayed scan date/time in India Standard Time so the
// records match what your staff actually see on their clocks.
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

router.use(requireLogin);

// Record a scan. Creates the product if the barcode is new, otherwise
// updates its position / allocated user / remarks / photo. Always logs
// a row in the scan history with who/what device/when.
router.post('/', upload.single('photo'), async (req, res, next) => {
  try {
    const { barcode, product_name, position, allocated_user, remarks, device_name, device_id } =
      req.body || {};
    if (!barcode) return res.status(400).json({ error: 'Barcode required' });

    const image_path = fileToDataUrl(req.file);

    const { rows: existingRows } = await query('SELECT * FROM products WHERE barcode = $1', [barcode]);
    let product = existingRows[0];

    if (!product) {
      if (!product_name) {
        return res.status(400).json({ error: 'Product name required for a new product' });
      }
      const { rows } = await query(
        `INSERT INTO products (barcode, product_name, image_path, position, allocated_user, remarks)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [barcode, product_name, image_path || null, position || '', allocated_user || '', remarks || '']
      );
      product = rows[0];
    } else {
      const fields = [];
      const params = [];
      function set(col, val) {
        params.push(val);
        fields.push(`${col} = $${params.length}`);
      }
      if (product_name) set('product_name', product_name);
      if (position !== undefined) set('position', position);
      if (allocated_user !== undefined) set('allocated_user', allocated_user);
      if (image_path) set('image_path', image_path);
      fields.push('updated_at = now()');

      params.push(product.id);
      const { rows } = await query(
        `UPDATE products SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params
      );
      product = rows[0];
    }

    const ist = getIST(new Date());
    const { rows: scanRows } = await query(
      `INSERT INTO scans (product_id, barcode, product_name, scanned_by, device_name, device_id, scan_date, scan_time, position, allocated_user, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        product.id, barcode, product.product_name,
        req.session.user.username,
        device_name || 'Unknown device',
        device_id || 'unknown',
        ist.date, ist.time,
        product.position, product.allocated_user,
        remarks || ''
      ]
    );

    res.status(201).json({ product, scan: scanRows[0] });
  } catch (err) {
    next(err);
  }
});

// Scan history with optional filters
router.get('/', async (req, res, next) => {
  try {
    const { user, barcode, from, to } = req.query;
    const clauses = [];
    const params = [];

    if (user) {
      params.push(user);
      clauses.push(`scanned_by = $${params.length}`);
    }
    if (barcode) {
      params.push(`%${barcode}%`);
      clauses.push(`barcode ILIKE $${params.length}`);
    }
    if (from) {
      params.push(from);
      clauses.push(`scan_date >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      clauses.push(`scan_date <= $${params.length}`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await query(`SELECT * FROM scans ${where} ORDER BY id DESC`, params);
    res.json({ scans: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
