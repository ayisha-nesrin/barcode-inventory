const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { db, nextId } = require('./db-init');
const { requireLogin } = require('./auth-middleware');
const router = express.Router();

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.jpg';
    cb(null, `product-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });

router.use(requireLogin);

// Record a scan. Creates the product if the barcode is new, otherwise
// updates its position / allocated user / remarks / photo. Always logs
// a row in the scan history with who/what device/when.
router.post('/', upload.single('photo'), (req, res) => {
  const { barcode, product_name, position, allocated_user, remarks, device_name, device_id } =
    req.body || {};
  if (!barcode) return res.status(400).json({ error: 'Barcode required' });

  const now = new Date();
  const iso = now.toISOString();
  let product = db.get('products').find({ barcode }).value();
  const image_path = req.file ? `/uploads/${req.file.filename}` : undefined;

  if (!product) {
    if (!product_name) {
      return res.status(400).json({ error: 'Product name required for a new product' });
    }
    product = {
      id: nextId('nextProductId'),
      barcode,
      product_name,
      image_path: image_path || null,
      position: position || '',
      allocated_user: allocated_user || '',
      remarks: remarks || '',
      created_at: iso,
      updated_at: iso
    };
    db.get('products').push(product).write();
  } else {
    const updates = { updated_at: iso };
    if (product_name) updates.product_name = product_name;
    if (position !== undefined) updates.position = position;
    if (allocated_user !== undefined) updates.allocated_user = allocated_user;
    if (image_path) updates.image_path = image_path;
    db.get('products').find({ barcode }).assign(updates).write();
    product = db.get('products').find({ barcode }).value();
  }

  const scan = {
    id: nextId('nextScanId'),
    product_id: product.id,
    barcode,
    product_name: product.product_name,
    scanned_by: req.session.user.username,
    device_name: device_name || 'Unknown device',
    device_id: device_id || 'unknown',
    scan_date: iso.split('T')[0],
    scan_time: now.toTimeString().split(' ')[0],
    position: product.position,
    allocated_user: product.allocated_user,
    remarks: remarks || '',
    created_at: iso
  };
  db.get('scans').push(scan).write();

  res.status(201).json({ product, scan });
});

// Scan history with optional filters
router.get('/', (req, res) => {
  const { user, barcode, from, to } = req.query;
  let list = db.get('scans').value();
  if (user) list = list.filter((s) => s.scanned_by === user);
  if (barcode) list = list.filter((s) => s.barcode.includes(barcode));
  if (from) list = list.filter((s) => s.scan_date >= from);
  if (to) list = list.filter((s) => s.scan_date <= to);
  res.json({ scans: list.slice().reverse() });
});

module.exports = router;
