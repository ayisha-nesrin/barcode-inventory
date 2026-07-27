# AEC Barcode Inventory System

A complete barcode scanning inventory system: a mobile-friendly scanner app (works
in any phone browser, installable like an app) plus a web admin panel, backed by
a real PostgreSQL database so your data survives server restarts and redeploys.

## What's included

- **Mobile Scanner App** (`scan.html`) — open it on any Android or iPhone browser.
  Scans barcodes using the phone's camera (no app store install needed), takes a
  product photo, and captures Product Name, Position, Allocated User, Remarks,
  Date, Time, Device Name/ID, and the logged-in user automatically.
- **Admin Panel** (`admin.html`) — add/edit/delete products, search by barcode /
  name / user / position, view product photos, print barcode labels, view full
  scan history with filters, manage users, export everything to Excel or PDF,
  and see a live dashboard.
- **Backend** (`server.js` + route files) — Node.js/Express API with login
  sessions and role-based access (Admin vs Scanner).
- **Database** — PostgreSQL (designed for [Neon](https://neon.tech)'s free tier,
  but works with any Postgres connection string, including Render's own Postgres
  or a local install). Product photos are stored directly in the database as
  base64 images, so there's no separate file storage to manage or lose.
- Pre-loaded with 5 sample products and sample scan history on first run so the
  dashboard isn't empty.

## 1. Set up your database (Neon, free)

1. Go to [neon.tech](https://neon.tech) and sign up (free, no credit card).
2. Create a new project. Neon gives you a **connection string** that looks like:
   ```
   postgresql://user:password@ep-example-12345.region.aws.neon.tech/neondb?sslmode=require
   ```
3. Copy that connection string — you'll need it in the next step and again when
   deploying.

## 2. Install and run locally

You need [Node.js](https://nodejs.org) version 18 or later.

1. Copy `.env.example` to a new file named `.env` in this same folder.
2. Open `.env` and paste your Neon connection string as `DATABASE_URL`, and set
   `SESSION_SECRET` to any random text.
3. Open a terminal **in this folder** and run:
   ```
   npm install
   npm start
   ```

You'll see:

```
On this computer:  http://localhost:3000
Database: connected to Postgres (DATABASE_URL)
```

Open `http://localhost:3000` in a browser to try it. The first run automatically
creates the tables and loads the demo data into your Neon database.

## 3. Default logins

| Role    | Username  | Password    |
|---------|-----------|-------------|
| Admin   | admin     | admin123    |
| Scanner | scanner1  | scanner123  |

**Change these immediately** from the Admin Panel → Users tab before real use
(add your real staff accounts, delete/disable the demo ones).

## 4. Deploying (e.g. on Render)

1. Push this project to a GitHub repository.
2. Create a new Web Service on [render.com](https://render.com), connect the repo.
3. Build Command: `npm install` — Start Command: `npm start`.
4. Under Environment Variables, add:
   - `DATABASE_URL` = your Neon connection string
   - `SESSION_SECRET` = any random text
5. Deploy. Because your data lives in Neon (not on Render's disk), it survives
   every restart and redeploy from now on.

## 5. Using it from a phone (important — read this)

Phone browsers only allow camera access (`getUserMedia`) on `localhost` or over
a secure **HTTPS** connection — this is a browser security rule, not something
this app can bypass.

- **Testing on the same computer**: works immediately via `http://localhost:3000`.
- **Scanning from an actual phone** on your WiFi network before deploying: use a
  free HTTPS tunnel: `npx ngrok http 3000`.
- **Once deployed** (see section 4), your Render URL is already HTTPS, so every
  phone can use it directly.

Once opened over HTTPS (or localhost), users can tap "Add to Home Screen" in
their phone browser to install it like a normal app icon.

## 6. How scanning works

1. Log in (as a Scanner or Admin user).
2. Tap **Start Scanning** — point the camera at a barcode (or type it manually).
3. **If the barcode already exists**: shows the product, photo, position,
   allocated user, and last scan date. Update any field and tap **Save & Log
   Scan** — this updates the product and adds a new row to scan history.
4. **If it's a new barcode**: fill in Product Name, take a photo, set Position
   and Allocated User, and tap **Save New Product** — this creates the product
   and logs the first scan.
5. Every scan automatically records: date, time (India Standard Time), device
   name, and the logged-in user — no manual entry needed for those fields.

## 7. Admin panel features

- **Dashboard** — total products, total scans, scans today, total users,
  recent scan activity.
- **Products** — search/filter by barcode, name, position, or user; add
  products manually; edit; delete (admin only); view photos; **print a
  barcode label** for any product (opens a print-ready label with a
  scannable CODE128 barcode).
- **Scan History** — filter by barcode, user, or date range; see which
  device/phone did each scan; export to Excel or PDF.
- **Users** — add Admin or Scanner accounts, delete accounts.

## 8. Data & backups

- All product/scan/user data (including photos) lives in your Neon Postgres
  database, not on the app server — so it's safe across restarts and redeploys.
- Still worth doing occasionally: use **Export to Excel** in the admin panel as
  an extra backup.
- Photos are kept to 3MB max and stored as base64 inside the database, which
  keeps things simple but does count against Neon's free storage limit (0.5GB)
  — that's roughly a few hundred photos at typical sizes. If you outgrow that,
  moving photos to dedicated file storage later is a small, isolated change.

## 9. Security notes before going live

- Change the default admin/scanner passwords right away.
- Never commit your `.env` file or real `DATABASE_URL` to a public GitHub repo
  (`.gitignore` already excludes `.env`).
- Set a real, random `SESSION_SECRET` in production, not the placeholder.

## 10. Project files

```
server.js            - starts the app, connects to Postgres, wires up routes and sessions
db-init.js            - Postgres connection, table creation, demo data seeding
auth-middleware.js     - login / admin access checks
auth-routes.js         - login, logout, current user
product-routes.js      - product CRUD + barcode lookup
scan-routes.js          - records each scan (creates/updates product + photo as base64)
user-routes.js          - user management (admin only)
stats-routes.js         - dashboard numbers
export-routes.js        - Excel / PDF export
login.html / scan.html / admin.html  - the three pages of the app
manifest.json / service-worker.js / icon.svg  - makes the scanner installable as an app
.env.example            - template for local DATABASE_URL / SESSION_SECRET
```
