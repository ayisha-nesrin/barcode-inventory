const express = require('express');
const { db, nextId } = require('./db-init');
const { requireLogin, requireAdmin } = require('./auth-middleware');
const router = express.Router();

router.use(requireLogin);

// List / search products
router.get('/', (req, res) => {
  const { q, position, allocated_user } = req.query;
  let list = db.get('products').value();

  if (q) {
    const term = String(q).toLowerCase();
    list = list.filter(
      (p) =>
        p.barcode.toLowerCase().includes(term) ||
        p.product_name.toLowerCase().includes(term) ||
        (p.allocated_user || '').toLowerCase().includes(term) ||
        (p.position || '').toLowerCase().includes(term)
    );
  }
  if (position) list = list.filter((p) => (p.position || '') === position);
  if (allocated_user) list = list.filter((p) => (p.allocated_user || '') === allocated_user);

  res.json({ products: list.slice().reverse() });
});

// Look up a single product by barcode (used by the scanner app)
router.get('/:barcode', (req, res) => {
  const product = db.get('products').find({ barcode: req.params.barcode }).value();
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const lastScan = db
    .get('scans')
    .filter({ barcode: product.barcode })
    .sortBy('id')
    .last()
    .value();
  res.json({ product, lastScan: lastScan || null });
});

// Create a product directly (admin panel "Add Product")
router.post('/', (req, res) => {
  const { barcode, product_name, position, allocated_user, remarks, image_path } = req.body || {};
  if (!barcode || !product_name) {
    return res.status(400).json({ error: 'Barcode and product name required' });
  }
  const existing = db.get('products').find({ barcode }).value();
  if (existing) return res.status(409).json({ error: 'Product with this barcode already exists' });

  const now = new Date().toISOString();
  const product = {
    id: nextId('nextProductId'),
    barcode,
    product_name,
    image_path: image_path || null,
    position: position || '',
    allocated_user: allocated_user || '',
    remarks: remarks || '',
    created_at: now,
    updated_at: now
  };
  db.get('products').push(product).write();
  res.status(201).json({ product });
});

// Update a product (admin panel edit form)
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const product = db.get('products').find({ id }).value();
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const { product_name, position, allocated_user, remarks, image_path } = req.body || {};
  const updates = { updated_at: new Date().toISOString() };
  if (product_name !== undefined) updates.product_name = product_name;
  if (position !== undefined) updates.position = position;
  if (allocated_user !== undefined) updates.allocated_user = allocated_user;
  if (remarks !== undefined) updates.remarks = remarks;
  if (image_path !== undefined) updates.image_path = image_path;

  db.get('products').find({ id }).assign(updates).write();
  res.json({ product: db.get('products').find({ id }).value() });
});

// Delete a product (admin only)
router.delete('/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const product = db.get('products').find({ id }).value();
  if (!product) return res.status(404).json({ error: 'Product not found' });
  db.get('products').remove({ id }).write();
  res.json({ ok: true });
});

module.exports = router;
