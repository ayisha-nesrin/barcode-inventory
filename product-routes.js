const express = require('express');
const { query } = require('./db-init');
const { requireLogin, requireAdmin } = require('./auth-middleware');
const router = express.Router();

router.use(requireLogin);

// Generates a unique, barcode-scanner-friendly numeric code. Starts with
// "2" (a prefix range reserved for internal/in-store use, never assigned by
// GS1 to real retail products) so generated codes can never collide with a
// genuine manufacturer barcode you scan later.
async function generateUniqueBarcode() {
  for (let attempt = 0; attempt < 8; attempt++) {
    const ts = Date.now().toString().slice(-9);
    const rand = Math.floor(100 + Math.random() * 900);
    const candidate = '2' + ts + rand; // 13 digits
    const { rows } = await query('SELECT id FROM products WHERE barcode = $1', [candidate]);
    if (!rows.length) return candidate;
  }
  throw new Error('Could not generate a unique barcode, please try again');
}

// List / search products
router.get('/', async (req, res, next) => {
  try {
    const { q, position, allocated_user } = req.query;
    const clauses = [];
    const params = [];

    if (q) {
      params.push(`%${q}%`);
      const p = `$${params.length}`;
      clauses.push(
        `(barcode ILIKE ${p} OR product_name ILIKE ${p} OR brand_name ILIKE ${p} OR category ILIKE ${p} OR variant ILIKE ${p} OR serial_number ILIKE ${p} OR position ILIKE ${p} OR allocated_user ILIKE ${p})`
      );
    }
    if (position) {
      params.push(position);
      clauses.push(`position = $${params.length}`);
    }
    if (allocated_user) {
      params.push(allocated_user);
      clauses.push(`allocated_user = $${params.length}`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await query(`SELECT * FROM products ${where} ORDER BY id DESC`, params);
    res.json({ products: rows });
  } catch (err) {
    next(err);
  }
});

// Generate a brand new product with a freshly generated, unique barcode
// (used by the "Create Barcode" flow for items that don't have a physical
// barcode yet).
router.post('/generate-barcode', async (req, res, next) => {
  try {
    const { product_name, brand_name, category, variant, serial_number, location } = req.body || {};
    if (!product_name || !brand_name || !category) {
      return res.status(400).json({ error: 'Product Name, Brand Name and Category are required' });
    }

    const barcode = await generateUniqueBarcode();
    const { rows } = await query(
      `INSERT INTO products (barcode, product_name, brand_name, category, variant, serial_number, position, allocated_user, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '', '') RETURNING *`,
      [barcode, product_name, brand_name, category, variant || '', serial_number || '', location || '']
    );
    res.status(201).json({ product: rows[0] });
  } catch (err) {
    next(err);
  }
});

// Regenerate the barcode for an EXISTING product. Requires the caller to
// have already confirmed with the user (the admin UI shows a confirm
// dialog first) since this changes the code that may already be printed
// and stuck on a physical item.
router.post('/:id/regenerate-barcode', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: existing } = await query('SELECT * FROM products WHERE id = $1', [id]);
    if (!existing.length) return res.status(404).json({ error: 'Product not found' });

    const barcode = await generateUniqueBarcode();
    const { rows } = await query(
      `UPDATE products SET barcode = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [barcode, id]
    );
    res.json({ product: rows[0] });
  } catch (err) {
    next(err);
  }
});

// Look up a single product by barcode (used by the scanner app)
router.get('/:barcode', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM products WHERE barcode = $1', [req.params.barcode]);
    const product = rows[0];
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const { rows: scanRows } = await query(
      'SELECT * FROM scans WHERE barcode = $1 ORDER BY id DESC LIMIT 1',
      [product.barcode]
    );
    res.json({ product, lastScan: scanRows[0] || null });
  } catch (err) {
    next(err);
  }
});

// Create a product directly (admin panel "Add Product", barcode already known)
router.post('/', async (req, res, next) => {
  try {
    const { barcode, product_name, position, allocated_user, remarks, image_path, brand_name, category, variant, serial_number } = req.body || {};
    if (!barcode || !product_name) {
      return res.status(400).json({ error: 'Barcode and product name required' });
    }
    const { rows: existing } = await query('SELECT id FROM products WHERE barcode = $1', [barcode]);
    if (existing.length) {
      return res.status(409).json({ error: 'Product with this barcode already exists' });
    }

    const { rows } = await query(
      `INSERT INTO products (barcode, product_name, image_path, position, allocated_user, remarks, brand_name, category, variant, serial_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        barcode, product_name, image_path || null, position || '', allocated_user || '', remarks || '',
        brand_name || '', category || '', variant || '', serial_number || ''
      ]
    );
    res.status(201).json({ product: rows[0] });
  } catch (err) {
    next(err);
  }
});

// Update a product (admin panel edit form)
router.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: existingRows } = await query('SELECT * FROM products WHERE id = $1', [id]);
    if (!existingRows.length) return res.status(404).json({ error: 'Product not found' });

    const { product_name, position, allocated_user, remarks, image_path, brand_name, category, variant, serial_number } = req.body || {};
    const fields = [];
    const params = [];

    function set(col, val) {
      params.push(val);
      fields.push(`${col} = $${params.length}`);
    }
    if (product_name !== undefined) set('product_name', product_name);
    if (position !== undefined) set('position', position);
    if (allocated_user !== undefined) set('allocated_user', allocated_user);
    if (remarks !== undefined) set('remarks', remarks);
    if (image_path !== undefined) set('image_path', image_path);
    if (brand_name !== undefined) set('brand_name', brand_name);
    if (category !== undefined) set('category', category);
    if (variant !== undefined) set('variant', variant);
    if (serial_number !== undefined) set('serial_number', serial_number);
    fields.push('updated_at = now()');

    params.push(id);
    const { rows } = await query(
      `UPDATE products SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    res.json({ product: rows[0] });
  } catch (err) {
    next(err);
  }
});

// Delete a product (admin only)
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await query('DELETE FROM products WHERE id = $1 RETURNING id', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Product not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
