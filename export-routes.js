const express = require('express');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { query } = require('./db-init');
const { requireLogin } = require('./auth-middleware');
const router = express.Router();

router.use(requireLogin);

router.get('/products.xlsx', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM products ORDER BY id ASC');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Products');
    sheet.columns = [
      { header: 'Barcode', key: 'barcode', width: 20 },
      { header: 'Product Name', key: 'product_name', width: 32 },
      { header: 'Position', key: 'position', width: 20 },
      { header: 'Allocated User', key: 'allocated_user', width: 20 },
      { header: 'Remarks', key: 'remarks', width: 25 },
      { header: 'Created', key: 'created_at', width: 22 },
      { header: 'Last Updated', key: 'updated_at', width: 22 }
    ];
    sheet.getRow(1).font = { bold: true };
    rows.forEach((p) => sheet.addRow(p));

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="products.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

router.get('/scans.xlsx', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM scans ORDER BY id ASC');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Scan History');
    sheet.columns = [
      { header: 'Date', key: 'scan_date', width: 14 },
      { header: 'Time', key: 'scan_time', width: 12 },
      { header: 'Barcode', key: 'barcode', width: 20 },
      { header: 'Product Name', key: 'product_name', width: 32 },
      { header: 'Position', key: 'position', width: 20 },
      { header: 'Allocated User', key: 'allocated_user', width: 20 },
      { header: 'Scanned By', key: 'scanned_by', width: 16 },
      { header: 'Device', key: 'device_name', width: 24 },
      { header: 'Remarks', key: 'remarks', width: 25 }
    ];
    sheet.getRow(1).font = { bold: true };
    rows.forEach((s) => sheet.addRow(s));

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="scan-history.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

function drawTable(doc, title, headers, colX, colW, rows, rowMapper) {
  doc.fontSize(16).text(title, { align: 'center' });
  doc.moveDown();
  doc.fontSize(9);

  doc.font('Helvetica-Bold');
  let y = doc.y;
  headers.forEach((h, i) => doc.text(h, colX[i], y, { width: colW[i] }));
  doc.moveDown(1.2);
  doc.font('Helvetica');

  rows.forEach((row) => {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 30) {
      doc.addPage();
    }
    const rowY = doc.y;
    const cells = rowMapper(row);
    cells.forEach((val, i) => doc.text(String(val ?? '-'), colX[i], rowY, { width: colW[i] }));
    doc.moveDown(1);
  });
}

router.get('/products.pdf', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM products ORDER BY id ASC');
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="products.pdf"');
    doc.pipe(res);

    const colX = [30, 150, 340, 460, 580, 700];
    const colW = [115, 185, 115, 115, 115, 100];
    drawTable(
      doc,
      'AEC Product Inventory Report',
      ['Barcode', 'Product Name', 'Position', 'Allocated User', 'Remarks', 'Updated'],
      colX,
      colW,
      rows,
      (p) => [p.barcode, p.product_name, p.position, p.allocated_user, p.remarks, new Date(p.updated_at).toLocaleString()]
    );

    doc.end();
  } catch (err) {
    next(err);
  }
});

router.get('/scans.pdf', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM scans ORDER BY id ASC');
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="scan-history.pdf"');
    doc.pipe(res);

    const colX = [30, 100, 200, 400, 520, 650];
    const colW = [65, 95, 195, 115, 125, 115];
    drawTable(
      doc,
      'AEC Scan History Report',
      ['Date/Time', 'Barcode', 'Product Name', 'Scanned By', 'Device', 'Position'],
      colX,
      colW,
      rows,
      (s) => [`${s.scan_date} ${s.scan_time}`, s.barcode, s.product_name, s.scanned_by, s.device_name, s.position]
    );

    doc.end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
