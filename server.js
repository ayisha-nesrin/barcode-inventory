const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');

require('./db-init'); // ensures db-data.json exists and default accounts/sample data are seeded

const authRoutes = require('./auth-routes');
const productRoutes = require('./product-routes');
const scanRoutes = require('./scan-routes');
const userRoutes = require('./user-routes');
const statsRoutes = require('./stats-routes');
const exportRoutes = require('./export-routes');

const app = express();
const PORT = process.env.PORT || 3000;

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'aec-barcode-inventory-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 12 } // 12 hours
  })
);

// Uploaded product photos
app.use('/uploads', express.static(uploadsDir));

// Front-end pages/assets are whitelisted explicitly (rather than a blanket
// static folder) so the source code and db-data.json are never served.
const publicFiles = {
  '/': 'login.html', // fallback, real redirect happens below
  '/login.html': 'login.html',
  '/scan.html': 'scan.html',
  '/admin.html': 'admin.html',
  '/manifest.json': 'manifest.json',
  '/service-worker.js': 'service-worker.js',
  '/icon.svg': 'icon.svg'
};

app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login.html');
  return res.redirect(req.session.user.role === 'admin' ? '/admin.html' : '/scan.html');
});

Object.entries(publicFiles).forEach(([route, file]) => {
  if (route === '/') return;
  app.get(route, (req, res) => res.sendFile(path.join(__dirname, file)));
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/scans', scanRoutes);
app.use('/api/users', userRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/export', exportRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error', detail: err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('=================================================');
  console.log('  AEC Barcode Inventory System is running');
  console.log('=================================================');
  console.log(`  On this computer:  http://localhost:${PORT}`);
  console.log(`  On your phone:     http://<this-computer-IP>:${PORT}`);
  console.log('  (see README.md for how to find your IP and how');
  console.log('   to enable phone camera access over the network)');
  console.log('=================================================');
  console.log('');
});
