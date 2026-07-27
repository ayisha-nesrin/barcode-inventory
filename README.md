# AEC Barcode Inventory System

A complete barcode scanning inventory system: a mobile-friendly scanner app (works
in any phone browser, installable like an app) plus a web admin panel — built as a
single self-contained Node.js application, matching the system you specified.

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
- **Database** — a self-contained embedded database (`db-data.json`, created
  automatically). No separate database server to install.
- Pre-loaded with 5 sample products and sample scan history so the dashboard
  isn't empty the first time you open it.

## 1. Install and run

You need [Node.js](https://nodejs.org) version 16 or later installed on the
computer that will act as your server.

Open a terminal **in this folder** and run:

```
npm install
npm start
```

You'll see:

```
On this computer:  http://localhost:3000
On your phone:     http://<this-computer-IP>:3000
```

Open `http://localhost:3000` in a browser on the same computer to try the admin
panel right away.

## 2. Default logins

| Role    | Username  | Password    |
|---------|-----------|-------------|
| Admin   | admin     | admin123    |
| Scanner | scanner1  | scanner123  |

**Change these immediately** from the Admin Panel → Users tab before real use
(add your real staff accounts, delete/disable the demo ones).

## 3. Using it from a phone (important — read this)

Phone browsers only allow camera access (`getUserMedia`) on `localhost` or over
a secure **HTTPS** connection — this is a browser security rule, not something
this app can bypass. So:

- **Testing on the same computer**: works immediately via `http://localhost:3000`.
- **Scanning from an actual phone** on your WiFi network: most phone browsers
  will block the camera on a plain `http://<ip>:3000` address. The easiest fix
  is a free HTTPS tunnel while testing:
  ```
  npx ngrok http 3000
  ```
  ngrok will give you an `https://...ngrok-free.app` URL — open that on your
  phone and the camera will work.
- **For permanent/production use**: deploy this app to any host that gives you
  HTTPS automatically (Render, Railway, a small VPS with Caddy/Nginx +
  Let's Encrypt, etc.), or put it behind your company's existing HTTPS reverse
  proxy. Once it's on a real HTTPS domain, everyone on your team can just open
  that URL on their phone.

Once opened over HTTPS (or localhost), users can tap "Add to Home Screen" in
their phone browser to install it like a normal app icon.

## 4. How scanning works

1. Log in (as a Scanner or Admin user).
2. Tap **Start Scanning** — point the camera at a barcode (or type it manually).
3. **If the barcode already exists**: shows the product, photo, position,
   allocated user, and last scan date. Update any field and tap **Save & Log
   Scan** — this updates the product and adds a new row to scan history.
4. **If it's a new barcode**: fill in Product Name, take a photo, set Position
   and Allocated User, and tap **Save New Product** — this creates the product
   and logs the first scan.
5. Every scan automatically records: date, time, device name, and the
   logged-in user — no manual entry needed for those fields.

## 5. Admin panel features

- **Dashboard** — total products, total scans, scans today, total users,
  recent scan activity.
- **Products** — search/filter by barcode, name, position, or user; add
  products manually; edit; delete (admin only); view photos; **print a
  barcode label** for any product (opens a print-ready label with a
  scannable CODE128 barcode).
- **Scan History** — filter by barcode, user, or date range; see which
  device/phone did each scan; export to Excel or PDF.
- **Users** — add Admin or Scanner accounts, delete accounts.

## 6. Data & backups

- Product/scan/user data lives in `db-data.json` in this folder.
- Uploaded product photos live in the `uploads/` folder (created automatically
  on first run).
- To back up your data, copy `db-data.json` and the `uploads/` folder
  somewhere safe. To reset to a fresh install, delete `db-data.json` and
  restart the server (it will reseed the demo data).

## 7. Security notes before going live

- Change the default admin/scanner passwords right away.
- Set a real session secret before deploying: `SESSION_SECRET=some-long-random-string npm start`
- Serve over HTTPS in production (see section 3).
- This embedded JSON database is great for a single warehouse / small-to-medium
  product catalog. If you later need many simultaneous scanners hitting the
  server constantly, or tens of thousands of products, it's straightforward to
  migrate the same API layer to MySQL/PostgreSQL (the original spec) — the
  route files are small and isolated per feature (`product-routes.js`,
  `scan-routes.js`, etc.) to make that swap easy later.

## 8. Project files

```
server.js            - starts the app, wires up routes and sessions
db-init.js            - embedded database + demo data seeding
auth-middleware.js     - login / admin access checks
auth-routes.js         - login, logout, current user
product-routes.js      - product CRUD + barcode lookup
scan-routes.js          - records each scan (creates/updates product + photo upload)
user-routes.js          - user management (admin only)
stats-routes.js         - dashboard numbers
export-routes.js        - Excel / PDF export
login.html / scan.html / admin.html  - the three pages of the app
manifest.json / service-worker.js / icon.svg  - makes the scanner installable as an app
```
