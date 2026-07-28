// Load DATABASE_URL / SESSION_SECRET from a local .env file if one exists
// (used only when running on your own computer - Render and other hosts
// provide these as real environment variables instead, so this is a no-op
// there).
require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');

const { initDB } = require('./db-init');

const authRoutes = require('./auth-routes');
const productRoutes = require('./product-routes');
const scanRoutes = require('./scan-routes');
const userRoutes = require('./user-routes');
const statsRoutes = require('./stats-routes');
const exportRoutes = require('./export-routes');
const searchRoutes = require('./search-routes');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Front-end pages/assets are whitelisted explicitly (rather than a blanket
// static folder) so the source code is never served. Product photos are no
// longer served from local disk - they live as data URLs inside the
// database (see scan-routes.js), so there's no /uploads route anymore.
const publicFiles = {
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
  app.get(route, (req, res) => res.sendFile(path.join(__dirname, file)));
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/scans', scanRoutes);
app.use('/api/users', userRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/search', searchRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error', detail: err.message });
});

initDB()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log('');
      console.log('=================================================');
      console.log('  AEC Barcode Inventory System is running');
      console.log('=================================================');
      console.log(`  On this computer:  http://localhost:${PORT}`);
      console.log(`  On your phone:     http://<this-computer-IP>:${PORT}`);
      console.log('  Database: connected to Postgres (DATABASE_URL)');
      console.log('=================================================');
      console.log('');
    });
  })
  .catch((err) => {
    console.error('Failed to connect to the database. Check your DATABASE_URL.');
    console.error(err);
    process.exit(1);
  });
