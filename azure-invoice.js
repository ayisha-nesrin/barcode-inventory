// Azure AI Document Intelligence ("Form Recognizer") integration for the
// "Scan Bill (AI)" feature. Uses the prebuilt-invoice model, which is
// purpose-built to read vendor/invoice/line-item/total fields off a real
// bill or receipt photo/PDF.
//
// Deliberately implemented with Node's built-in https module rather than
// adding axios/node-fetch as a new dependency - the rest of this app has
// no HTTP-client dependency at all, so this keeps that true.
//
// INERT BY DEFAULT: every function below throws a clear, catchable error
// if AZURE_DOCINTEL_ENDPOINT / AZURE_DOCINTEL_KEY aren't set. Nothing here
// runs or costs anything until those two environment variables exist on
// Render (Settings -> Environment), exactly like DATABASE_URL/SESSION_SECRET
// already work for this app.
const https = require('https');

const API_VERSION = '2023-07-31'; // stable GA version of the prebuilt-invoice model

function isConfigured() {
  return Boolean(process.env.AZURE_DOCINTEL_ENDPOINT && process.env.AZURE_DOCINTEL_KEY);
}

function endpointHost() {
  const url = new URL(process.env.AZURE_DOCINTEL_ENDPOINT);
  return { hostname: url.hostname, basePath: url.pathname.replace(/\/$/, '') };
}

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Step 1: submit the image/PDF for analysis. Azure responds 202 Accepted
// with an Operation-Location header to poll for the result - this is how
// every Azure Document Intelligence call works, since OCR/extraction on a
// real document takes a few seconds, not milliseconds.
async function submitAnalysis(fileBuffer, mimetype) {
  const { hostname, basePath } = endpointHost();
  const path = `${basePath}/formrecognizer/documentModels/prebuilt-invoice:analyze?api-version=${API_VERSION}`;
  const res = await httpsRequest({
    hostname,
    path,
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': process.env.AZURE_DOCINTEL_KEY,
      'Content-Type': mimetype || 'application/octet-stream',
      'Content-Length': fileBuffer.length
    }
  }, fileBuffer);

  if (res.statusCode !== 202) {
    let detail = res.body;
    try { detail = JSON.parse(res.body).error?.message || res.body; } catch (e) {}
    throw new Error(`Azure Document Intelligence rejected the request (${res.statusCode}): ${detail}`);
  }
  const opLocation = res.headers['operation-location'];
  if (!opLocation) throw new Error('Azure did not return an operation-location to poll for results');
  return opLocation;
}

// Step 2: poll the operation until it's done. Most single-page bills take
// 2-6 seconds; this polls every 1.2s for up to ~30s before giving up.
async function pollResult(opLocation) {
  const url = new URL(opLocation);
  for (let attempt = 0; attempt < 25; attempt++) {
    const res = await httpsRequest({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { 'Ocp-Apim-Subscription-Key': process.env.AZURE_DOCINTEL_KEY }
    });
    const data = JSON.parse(res.body);
    if (data.status === 'succeeded') return data;
    if (data.status === 'failed') {
      throw new Error('Azure could not read this document: ' + (data.error?.message || 'unknown error'));
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error('Azure is taking longer than expected to read this bill - please try again in a moment');
}

// Pulls a plain value + confidence out of one of Azure's typed field
// objects, regardless of which "value*" variant it used (valueString,
// valueNumber, valueDate, valueCurrency, or just the raw recognized text
// in .content) - the exact variant can differ by field type/API version,
// so this is intentionally tolerant rather than assuming one shape.
function readField(field) {
  if (!field) return { value: null, confidence: 0 };
  let value = field.valueString ?? field.content ?? null;
  if (field.valueNumber !== undefined) value = field.valueNumber;
  if (field.valueDate !== undefined) value = field.valueDate;
  if (field.valueCurrency !== undefined) value = field.valueCurrency.amount;
  return { value, confidence: field.confidence ?? 0 };
}

// Turns Azure's raw response into the flat shape the Bills UI actually
// needs: one entry per line item (since our bills table is one row per
// product), each carrying the shared vendor/date/tax info plus its own
// confidence flags so the review screen can highlight anything uncertain.
function extractBillDraft(azureResult) {
  const doc = azureResult.analyzeResult?.documents?.[0];
  if (!doc) throw new Error('No invoice data found in this image');
  const f = doc.fields || {};

  const vendor = readField(f.VendorName);
  const invoiceId = readField(f.InvoiceId);
  const invoiceDate = readField(f.InvoiceDate);
  const invoiceTotal = readField(f.InvoiceTotal);
  const tax = readField(f.TotalTax);

  const itemsField = f.Items;
  const lineItems = [];
  if (itemsField && Array.isArray(itemsField.valueArray)) {
    itemsField.valueArray.forEach((item) => {
      const obj = item.valueObject || {};
      const description = readField(obj.Description);
      const quantity = readField(obj.Quantity);
      const unitPrice = readField(obj.UnitPrice);
      const amount = readField(obj.Amount);
      lineItems.push({
        asset_name: description.value || '',
        quantity: quantity.value || 1,
        unit_price: unitPrice.value || null,
        amount: amount.value || (invoiceTotal.value && itemsField.valueArray.length === 1 ? invoiceTotal.value : null),
        confidence: {
          asset_name: description.confidence,
          quantity: quantity.confidence,
          amount: amount.confidence
        }
      });
    });
  }

  // Some receipts (as opposed to itemized invoices) don't break out
  // individual line items at all - fall back to one row using the
  // invoice-level total so the bill is still logged instead of dropped.
  if (!lineItems.length) {
    lineItems.push({
      asset_name: '',
      quantity: 1,
      unit_price: invoiceTotal.value,
      amount: invoiceTotal.value,
      confidence: { asset_name: 0, quantity: 0, amount: invoiceTotal.confidence }
    });
  }

  return {
    vendor_name: vendor.value || '',
    vendor_confidence: vendor.confidence,
    invoice_id: invoiceId.value || '',
    bill_date: invoiceDate.value || null,
    bill_date_confidence: invoiceDate.confidence,
    tax_amount: tax.value,
    invoice_total: invoiceTotal.value,
    line_items: lineItems
  };
}

const LOW_CONFIDENCE_THRESHOLD = 0.7;

async function analyzeBillImage(fileBuffer, mimetype) {
  if (!isConfigured()) {
    const err = new Error('AI bill reading is not set up yet - add AZURE_DOCINTEL_ENDPOINT and AZURE_DOCINTEL_KEY in Render, then try again.');
    err.code = 'AI_NOT_CONFIGURED';
    throw err;
  }
  const opLocation = await submitAnalysis(fileBuffer, mimetype);
  const result = await pollResult(opLocation);
  return extractBillDraft(result);
}

module.exports = { analyzeBillImage, isConfigured, LOW_CONFIDENCE_THRESHOLD };
