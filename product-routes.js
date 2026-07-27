const express = require('express');
const { query } = require('./db-init');
const { requireLogin, requireAdmin } = require('./auth-middleware');
const router = express.Router();

router.use(requireLogin);

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
        `(barcode ILIKE ${p} OR product_name ILIKE ${p} OR position ILIKE ${p} OR allocated_user ILIKE ${p})`
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

// Create a product directly (admin panel "Add Product")
router.post('/', async (req, res, next) => {
  try {
    const { barcode, product_name, position, allocated_user, remarks, image_path } = req.body || {};
    if (!barcode || !product_name) {
      return res.status(400).json({ error: 'Barcode and product name required' });
    }
    const { rows: existing } = await query('SELECT id FROM products WHERE barcode = $1', [barcode]);
    if (existing.length) {
      return res.status(409).json({ error: 'Product with this barcode already exists' });
    }

    const { rows } = await query(
      `INSERT INTO products (barcode, product_name, image_path, position, allocated_user, remarks)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [barcode, product_name, image_path || null, position || '', allocated_user || '', remarks || '']
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

    const { product_name, position, allocated_user, remarks, image_path } = req.body || {};
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
