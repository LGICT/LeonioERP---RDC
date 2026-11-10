'use strict';
/* ============ Business documents (Business Central style) ============ */
const PAY_METHODS = ['Check', 'Bank Transfer', 'Online / Fund Transfer', 'Cash'];
const POSTING_FIELDS = (kind) => [
  { k: 'genBus', l: 'Gen. Bus. Posting Group', t: 'ref', ref: 'genBus' }, { k: 'vatBus', l: 'VAT Bus. Posting Group', t: 'ref', ref: 'vatBus' },
  { k: 'whtBus', l: 'WHT Bus. Posting Group', t: 'ref', ref: 'whtBus' }, { k: 'pricesInclVat', l: 'Prices Including VAT', t: 'check' }];
const PARTY = { vendor: { k: 'vendor', l: 'Vendor No.', t: 'ref', ref: 'vendors', req: 1, w: 'w2' }, customer: { k: 'customer', l: 'Customer No.', t: 'ref', ref: 'customers', req: 1, w: 'w2' } };

const DOCS = {
  PR: { name: 'Purchase Requisition', plural: 'Purchase Requisitions', lines: 'purchase', post: false, bc: 'Customized (no standard BC page)',
    desc: 'Department request for goods/services; approved by the Department Head; then Purchasing creates Purchase Quotes (canvass).',
    head: [{ k: 'date', l: 'Document Date', t: 'date', req: 1 }, { k: 'location', l: 'Location Code', t: 'ref', ref: 'locations' }, { k: 'needDate', l: 'Requested Receipt Date', t: 'date' },
      { k: 'purpose', l: 'Purpose / Justification', t: 'textarea', w: 'w2', req: 1 }] },
  PQ: { name: 'Purchase Quote', plural: 'Purchase Quotes', party: 'vendor', lines: 'purchase', post: false, bc: 'Purchase Quote → Make Order',
    desc: 'Supplier quotation (canvass). Create one per supplier; approve the selected quote, then Make Order.',
    head: [PARTY.vendor, { k: 'date', l: 'Document Date', t: 'date', req: 1 }, { k: 'vendorQuoteNo', l: 'Vendor Quote No.' }, { k: 'location', l: 'Location Code', t: 'ref', ref: 'locations' },
      { k: 'validUntil', l: 'Quote Valid Until Date', t: 'date' }, ...POSTING_FIELDS(), { k: 'remarks', l: 'Remarks', t: 'textarea', w: 'w2' }] },
  PO: { name: 'Purchase Order', plural: 'Purchase Orders', party: 'vendor', lines: 'purchase', post: false, bc: 'Purchase Order → Post (Receive) / Create Whse. Receipt',
    desc: 'Approved order to a supplier. Receive goods (Posted Purchase Receipt / WAR for services), then Get Receipt Lines on a Purchase Invoice.',
    head: [PARTY.vendor, { k: 'date', l: 'Posting Date', t: 'date', req: 1 }, { k: 'location', l: 'Location Code', t: 'ref', ref: 'locations', req: 1 },
      { k: 'expectedDate', l: 'Expected Receipt Date', t: 'date' }, { k: 'paymentTerms', l: 'Payment Terms Code', t: 'ref', ref: 'paymentTerms' }, ...POSTING_FIELDS(), { k: 'remarks', l: 'Remarks', t: 'textarea', w: 'w2' }] },
  RR: { name: 'Posted Purchase Receipt', plural: 'Posted Purchase Receipts (RR / WAR)', party: 'vendor', lines: 'purchase', post: false, system: true, bc: 'Posted Purchase Receipt',
    head: [PARTY.vendor, { k: 'date', l: 'Posting Date', t: 'date' }, { k: 'location', l: 'Location Code', t: 'ref', ref: 'locations' }, { k: 'drNo', l: "Vendor Shipment No. (DR / WAR)" }, { k: 'remarks', l: 'Remarks', t: 'textarea', w: 'w2' }] },
  PI: { name: 'Purchase Invoice', plural: 'Purchase Invoices', party: 'vendor', lines: 'purchase', post: true, tax: true, bc: 'Purchase Invoice → Get Receipt Lines → Post',
    desc: 'Vendor billing matched to the PO and receipt. Approval: General Accounting Supervisor → EA/SA to the President → President (CAPEX, international travel, outside budget) → Accounting Manager.',
    head: [PARTY.vendor, { k: 'vendorInvoiceNo', l: 'Vendor Invoice No.', req: 1 }, { k: 'date', l: 'Posting Date', t: 'date', req: 1 }, { k: 'dueDate', l: 'Due Date', t: 'date' },
      { k: 'location', l: 'Location Code', t: 'ref', ref: 'locations' }, { k: 'paymentTerms', l: 'Payment Terms Code', t: 'ref', ref: 'paymentTerms' }, ...POSTING_FIELDS(), { k: 'remarks', l: 'Remarks', t: 'textarea', w: 'w2' }] },
  PRET: { name: 'Purchase Credit Memo', plural: 'Purchase Credit Memos / Returns', party: 'vendor', lines: 'purchase', post: true, tax: true, bc: 'Purchase Credit Memo / Purchase Return Order',
    desc: 'Return of items to the vendor or a purchase adjustment. Reduces what we owe.',
    head: [PARTY.vendor, { k: 'date', l: 'Posting Date', t: 'date', req: 1 }, { k: 'location', l: 'Location Code', t: 'ref', ref: 'locations' }, { k: 'refInvoice', l: 'Vendor Cr. Memo No. / Applies-to Doc.' },
      ...POSTING_FIELDS(), { k: 'remarks', l: 'Reason', t: 'textarea', w: 'w2', req: 1 }] },
  PAY: { name: 'Payment Journal', plural: 'Payment Journals', party: 'vendor', lines: 'apply', post: true, bc: 'Payment Journal (Account Type Vendor, Bal. Account Type Bank Account) → Apply Entries → Post',
    desc: 'Pay vendors by check or bank transfer, applied to their open entries. Approval: Treasury Supervisor → Treasury Assistant Manager → President (₱1M and above).',
    head: [PARTY.vendor, { k: 'date', l: 'Posting Date', t: 'date', req: 1 }, { k: 'bank', l: 'Bal. Account No. (Bank Account)', t: 'ref', ref: 'bankAccounts', req: 1 },
      { k: 'method', l: 'Bank Payment Type', t: 'select', opts: PAY_METHODS, noBlank: 1 }, { k: 'checkNo', l: 'Document No. / Check No. (blank = next)' }, { k: 'amount', l: 'Amount (blank = total applied)', t: 'number' },
      { k: 'remarks', l: 'Description', t: 'textarea', w: 'w2' }] },
  SI: { name: 'Sales Invoice', plural: 'Sales Invoices', party: 'customer', lines: 'sales', post: true, tax: true, bc: 'Sales Invoice → Post',
    desc: 'Billing for ore, lots, fuel, vessel rental, equipment, port and other services. Approved by Accounting Manager - Shared Service.',
    head: [PARTY.customer, { k: 'date', l: 'Posting Date', t: 'date', req: 1 }, { k: 'dueDate', l: 'Due Date', t: 'date' }, { k: 'location', l: 'Location Code', t: 'ref', ref: 'locations' },
      { k: 'customerPO', l: 'External Document No.' }, { k: 'paymentTerms', l: 'Payment Terms Code', t: 'ref', ref: 'paymentTerms' }, ...POSTING_FIELDS(), { k: 'remarks', l: 'Remarks', t: 'textarea', w: 'w2' }] },
  SCM: { name: 'Sales Credit Memo', plural: 'Sales Credit Memos', party: 'customer', lines: 'sales', post: true, tax: true, bc: 'Sales Credit Memo / Sales Return Order',
    desc: 'Sales returns and billing corrections. Reduces the customer balance.',
    head: [PARTY.customer, { k: 'date', l: 'Posting Date', t: 'date', req: 1 }, { k: 'location', l: 'Location Code', t: 'ref', ref: 'locations' }, { k: 'refInvoice', l: 'Applies-to Doc. No.' },
      ...POSTING_FIELDS(), { k: 'remarks', l: 'Reason', t: 'textarea', w: 'w2', req: 1 }] },
  CR: { name: 'Cash Receipt Journal', plural: 'Cash Receipt Journals (Collections)', party: 'customer', lines: 'apply', post: true, bc: 'Cash Receipt Journal → Apply Entries → Post',
    desc: 'Customer collections applied to invoices, with Official Receipt no. and creditable withholding tax (CWT, realized on payment). Unapplied amounts stay open as customer deposits/advances.',
    head: [PARTY.customer, { k: 'date', l: 'Posting Date', t: 'date', req: 1 }, { k: 'bank', l: 'Bal. Account No. (Bank Account)', t: 'ref', ref: 'bankAccounts', req: 1 },
      { k: 'method', l: 'Payment Method', t: 'select', opts: PAY_METHODS, noBlank: 1 }, { k: 'orNo', l: 'Document No. (O.R. No.)', req: 1 }, { k: 'amount', l: 'Amount Received', t: 'number', req: 1 },
      { k: 'cwtProd', l: 'CWT – WHT Prod. Posting Group (if customer withheld tax)', t: 'ref', ref: 'whtProd' }, { k: 'remarks', l: 'Description', t: 'textarea', w: 'w2' }] },
  TO: { name: 'Transfer Order', plural: 'Transfer Orders', lines: 'transfer', post: false, bc: 'Transfer Order → Post (Ship) → Post (Receive)',
    desc: 'Move stock between warehouses, vessels, fuel tanks, equipment and mine sites through an in-transit location.',
    head: [{ k: 'date', l: 'Posting Date', t: 'date', req: 1 }, { k: 'fromLoc', l: 'Transfer-from Code', t: 'ref', ref: 'locations', req: 1 }, { k: 'toLoc', l: 'Transfer-to Code', t: 'ref', ref: 'locations', req: 1 },
      { k: 'transitLoc', l: 'In-Transit Code', t: 'ref', ref: 'transitLocations', req: 1 }, { k: 'remarks', l: 'Remarks', t: 'textarea', w: 'w2' }] },
  IJ: { name: 'Item Journal', plural: 'Item Journals', lines: 'itemjnl', post: true, bc: 'Item Journal (Positive/Negative Adjmt.)',
    desc: 'Issue/consume items (fuel, spares) charged to equipment or vessels, and record adjustments. The offset account is the Inventory Adjmt. Account from General Posting Setup.',
    head: [{ k: 'date', l: 'Posting Date', t: 'date', req: 1 }, { k: 'entryType', l: 'Entry Type', t: 'select', opts: IJ_TYPES, req: 1, noBlank: 1 },
      { k: 'location', l: 'Location Code', t: 'ref', ref: 'locations', req: 1 }, { k: 'remarks', l: 'Description', t: 'textarea', w: 'w2' }] },
  PC: { name: 'Phys. Inventory Journal', plural: 'Phys. Inventory Journals', lines: 'count', post: true, bc: 'Phys. Inventory Journal → Calculate Inventory → Post',
    desc: '"Calculate Inventory" loads the calculated quantity; enter the physical quantity; posting adjusts the difference.',
    head: [{ k: 'date', l: 'Posting Date', t: 'date', req: 1 }, { k: 'location', l: 'Location Code', t: 'ref', ref: 'locations', req: 1 }, { k: 'remarks', l: 'Description / Count Team', t: 'textarea', w: 'w2' }] },
  GJ: { name: 'General Journal', plural: 'General Journals', lines: 'gj', post: true, bc: 'General Journal',
    desc: 'Journal lines by Account Type (G/L Account, Vendor, Customer, Bank Account). Must balance.',
    head: [{ k: 'date', l: 'Posting Date', t: 'date', req: 1 }, { k: 'batch', l: 'Journal Batch', t: 'select', get opts() { return M().journalBatches.filter(b => /general|gen/i.test(b.template)).map(b => [b.name, `${b.name} – ${b.description || ''}`]); } },
      { k: 'remarks', l: 'Description', t: 'textarea', w: 'w2', req: 1 }] },
  DEP: { name: 'Depreciation (Calculate Depreciation)', plural: 'Depreciation Runs', lines: 'fa', post: false, system: true, bc: 'Calculate Depreciation → FA G/L Journal', head: [{ k: 'date', l: 'Posting Date', t: 'date' }, { k: 'remarks', l: 'Description', w: 'w2' }] },
  FAD: { name: 'Fixed Asset Disposal', plural: 'Fixed Asset Disposals', lines: 'fa', post: false, system: true, bc: 'FA G/L Journal (Disposal)', head: [{ k: 'date', l: 'Posting Date', t: 'date' }, { k: 'remarks', l: 'Description', w: 'w2' }] }
};

function docTotals(d) {
  const def = DOCS[d.type] || {};
  if (def.lines === 'gj') { const dr = r2(sum(d.lines || [], 'debit')), cr = r2(sum(d.lines || [], 'credit')); return { debit: dr, credit: cr, total: dr, diff: r2(dr - cr) }; }
  if (def.lines === 'apply') { const applied = r2(sum(d.lines || [], 'amount')); return { applied, total: r2(num(d.amount) || Math.abs(applied)) }; }
  if (def.lines === 'none') return { total: r2(num(d.amount)) };
  if (def.lines === 'brec') return { total: r2(num(d.endingBalance)) };
  if (def.lines === 'fa') return { total: r2(sum(d.lines || [], 'amount')) };
  if (def.lines === 'transfer' || def.lines === 'count') return { total: 0 };
  if (def.lines === 'itemjnl') return { total: r2(sum(d.lines || [], l => num(l.qty) * num(l.unitCost))) };
  let subtotal = 0, vat = 0, wht = 0;
  for (const l of d.lines || []) { const c = lineCalc(d, l); subtotal += c.base; vat += c.vat; wht += c.wht; }
  subtotal = r2(subtotal); vat = r2(vat); wht = r2(wht);
  return { subtotal, vat, wht, total: r2(subtotal + vat - (SALES_DOCS.includes(d.type) ? 0 : wht)) };
}
var docParty = d => { const k = (DOCS[d.type] || {}).party; return k && d[k] ? partyName(k, d[k], d.company) : (d.type === 'TO' ? `${d.fromLoc} → ${d.toLoc}` : d.type === 'FT' ? `${d.fromBank} → ${d.toBank}` : d.type === 'BREC' ? `${d.bank} stmt ${d.statementNo || ''}` : d.location || d.purpose || ''); };

/* ---------- Document list ---------- */
route('docs', type => {
  const def = DOCS[type]; if (!def) return '<div class="card">Unknown document type</div>';
  const rows = DB.docs.filter(d => d.type === type && d.company === S.company).sort((a, b) => (b.date + b.no).localeCompare(a.date + a.no));
  const cols = [{ l: 'No.', k: 'no' }, { l: 'Posting Date', k: 'date' }, { l: def.party === 'customer' ? 'Customer' : def.party ? 'Vendor' : 'Details', v: docParty },
    { l: 'Status', k: 'status', html: r => badge(r.status) }, { l: 'Amount Incl. VAT', v: r => docTotals(r).total || '', f: 'money' }, { l: 'Created By', v: r => (DB.users.find(u => u.id === r.createdBy) || {}).name || '' }];
  if (type === 'PI') cols.splice(3, 0, { l: 'Vendor Invoice No.', k: 'vendorInvoiceNo' });
  return pageHead(def.plural, `${esc(def.desc || '')} <br><b>Company:</b> ${esc(companyName(S.company))}`,
    (def.listActions || '') + (def.system ? '' : `<button class="btn primary" onclick="go('#/doc/${type}/new')">+ New</button>`)) +
    `<div class="card">${dataTable('docs-' + type, cols, rows, { link: r => `#/doc/${type}/${r.id}`, title: def.plural })}</div>`;
});

/* ---------- Document editor ---------- */
let ED = null;
function newDoc(type) {
  const d = { id: '', type, no: '', company: S.company, date: today(), status: 'Draft', createdBy: curUser().id, createdAt: new Date().toISOString(), approvals: [], lines: [], dims: {} };
  if (['PAY', 'CR'].includes(type)) { d.method = type === 'PAY' ? 'Check' : 'Bank Transfer'; d.docKind = 'Payment'; }
  if (type === 'IJ') d.entryType = IJ_TYPES[0];
  if (type === 'TO') d.transitLoc = (refOptions('transitLocations')[0] || [])[0] || '';
  const banks = refOptions('bankAccounts'); if (['PAY', 'CR'].includes(type) && banks[0]) d.bank = banks[0][0];
  return d;
}
route('doc', (type, id) => {
  if (!DOCS[type]) return '<div class="card">Unknown document type</div>';
  if (id === 'new') { ED = newDoc(type); addLine(true); }
  else {
    const d = DB.docs.find(x => x.id === id); if (!d) return '<div class="card">Document not found.</div>';
    if (d.company !== S.company) S.company = d.company;
    ED = clone(d);
  }
  return docPage();
});
const editable = () => ED.status === 'Draft' || ED.status === 'Open';
function drawDoc() { $('#dls').innerHTML = ''; $('#main').innerHTML = docPage(); renderTopbar(); }

function docPage() {
  const def = DOCS[ED.type], ed = editable();
  const info = [`<span><b>Company:</b> ${esc(companyName(ED.company))}</span>`];
  if (ED.createdBy) info.push(`<span><b>Created by:</b> ${esc((DB.users.find(u => u.id === ED.createdBy) || {}).name || '')}</span>`);
  for (const [k, t] of [['prNo', 'Requisition'], ['pqNo', 'Quote'], ['poNo', 'Order']]) if (ED[k]) {
    const p = DB.docs.find(x => x.no === ED[k] && x.company === ED.company); info.push(`<span><b>From ${t}:</b> ${p ? `<a href="#/doc/${p.type}/${p.id}">${esc(ED[k])}</a>` : esc(ED[k])}</span>`);
  }
  const bc = budgetCheck(ED);
  return pageHead(`${def.name} ${ED.no || '(new)'}`, `${badge(ED.status)} &nbsp; ${info.join(' &nbsp;·&nbsp; ')}`, docActions()) +
    (def.desc ? `<p class="hint">${esc(def.desc)}</p>` : '') +
    `<div class="card"><h3>General</h3><div class="form-grid" onchange="hdrChange(event)">${def.head.map(f => fieldHtml(f, ED[f.k], 'h', !ed)).join('')}</div></div>` +
    dimsCard(ed) + (bc ? `<div id="budget">${budgetPanel(bc)}</div>` : '') +
    (def.lines === 'none' ? '' : `<div class="card"><div class="lines-head"><h3>${def.lines === 'apply' ? 'Apply Entries' : def.lines === 'brec' ? 'Bank Account Ledger Entries' : 'Lines'}</h3>${linesToolbar()}</div><div id="lines-wrap">${linesHtml()}</div><div id="totals">${totalsHtml()}</div></div>`) +
    approvalPanel(ED) + relatedPanel() + glPanel() + whseEntriesPanel() + printArea();
}
function dimsCard(ed) {
  const dims = M(ED.company).dimensions; if (!dims.length || DOCS[ED.type].system) return '';
  return `<details class="card" ${Object.values(ED.dims || {}).some(Boolean) ? 'open' : ''}><summary><b>Dimensions</b> <span class="muted small">(${dims.map(d => d.code).join(', ')})</span></summary>
    <div class="form-grid" style="margin-top:10px" onchange="dimChange()">${dims.map(d => fieldHtml({ k: d.code.replace(/\W/g, '_'), l: d.name || d.code, t: 'ref', ref: 'dim:' + d.code }, (ED.dims || {})[d.code], 'dm', !ed)).join('')}</div></details>`;
}
function dimChange() { ED.dims = {}; for (const d of M(ED.company).dimensions) { const el = $('#dm_' + d.code.replace(/\W/g, '_')); if (el && el.value) ED.dims[d.code] = el.value.trim(); } }

function docActions() {
  const def = DOCS[ED.type], s = ED.status, b = [];
  const btn = (label, fn, cls = '') => { if (!whseHides(label)) b.push(`<button class="btn ${cls}" onclick="${fn}">${label}</button>`); };
  whseButtons(btn); treasuryButtons(btn); if (typeof extraButtons === 'function') extraButtons(btn);
  if (def.system) { btn('🖨 Print', 'printDoc()', 'ghost'); return b.join(''); }
  if (s === 'Draft') {
    btn('💾 Save', 'saveDoc()');
    if (ED.type === 'PC') btn('Calculate Inventory', 'pcCalculate()');
    btn(ED.type === 'TO' ? 'Release' : 'Send Approval Request ➜', 'submitDoc()', 'primary');
    if (ED.id) btn('Delete', 'deleteDoc()', 'danger ghost');
  }
  if (s === 'Pending Approval') {
    if (canApprove(ED)) { btn('✔ Approve', 'approveDoc()', 'primary'); btn('✖ Reject', 'rejectDoc()', 'danger'); }
    if (ED.createdBy === curUser().id || isAdmin()) btn('Cancel Approval Request', 'reopenDoc()', 'ghost');
  }
  if (s === 'Rejected') btn('Reopen', 'reopenDoc()', 'primary');
  if (s === 'Approved') {
    if (ED.type === 'PR') { if (typeof rfqFromPR === 'function') btn('Create RFQ (canvass) ➜', 'rfqFromPR()', 'primary'); else btn('Create Purchase Quotes…', 'prCreatePQ()', 'primary'); }
    if (ED.type === 'PQ') btn('Make Order ➜', 'pqMakePO()', 'primary');
    if (ED.type === 'PO') btn('Post Receipt (RR / WAR)…', 'poReceive()', 'primary');
    if (ED.type === 'TO') btn('Post Shipment ➜', 'toShip()', 'primary');
    if (def.post) btn('📗 Post', 'postDoc()', 'primary');
    btn('Reopen', 'reopenDoc()', 'ghost');
  }
  if (ED.type === 'PO' && ['Approved', 'Partially Received', 'Received'].includes(s)) btn('Create Invoice (Get Receipt Lines) ➜', 'poCreatePI()');
  if (ED.type === 'PO' && s === 'Partially Received') btn('Post Receipt (remaining)…', 'poReceive()', 'primary');
  if (ED.type === 'TO' && s === 'Shipped') btn('Post Receipt at Destination…', 'toReceive()', 'primary');
  if (ED.id) btn('🖨 Print', 'printDoc()', 'ghost');
  return b.join('');
}
function budgetPanel(bc) {
  if (!bc.rows.length) return '';
  return `<div class="card ${bc.ok ? 'ok-card' : 'warn-card'}"><h3>Budget Check: ${bc.ok ? 'Within budget ✔' : 'Outside budget / no budget ⚠'}</h3>
  <table class="grid compact"><thead><tr><th>Account</th><th class="num">Annual Budget</th><th class="num">Used</th><th class="num">Available</th><th class="num">This Document</th><th></th></tr></thead><tbody>
  ${bc.rows.map(r => `<tr><td>${esc(r.account)} – ${esc(accName(r.account, ED.company))}</td><td class="num">${money(r.budget)}</td><td class="num">${money(r.actual)}</td><td class="num">${money(r.available)}</td><td class="num">${money(r.amount)}</td><td>${r.ok ? '✔' : (r.budget ? '⚠ exceeds' : '⚠ no budget')}</td></tr>`).join('')}
  </tbody></table></div>`;
}

/* ---------- Lines ---------- */
function lineCols() {
  const t = ED.type, kind = DOCS[t].lines;
  if (WH_COLS[kind]) return WH_COLS[kind]();
  if (kind === 'purchase') return [
    { k: 'type', l: 'Type', t: 'select', opts: t === 'PRET' ? ['Item', 'G/L Account', 'Charge (Item)'] : ['Item', 'G/L Account', 'Fixed Asset', 'Charge (Item)'], w: 120 },
    { k: 'no', l: 'No.', t: 'lineref', w: 190 }, { k: 'description', l: 'Description', t: 'text' }, { k: 'qty', l: 'Quantity', t: 'number', w: 85 }, { k: 'uom', l: 'UOM', t: 'ro', w: 55 },
    { k: 'unitCost', l: ED.pricesInclVat ? 'Direct Unit Cost Incl. VAT' : 'Direct Unit Cost Excl. VAT', t: 'number', w: 115 }, { k: 'amount', l: 'Line Amount', t: 'calc', w: 115 },
    { k: 'genProd', l: 'Gen. Prod.', t: 'ref', ref: 'genProd', w: 120 }, { k: 'vatProd', l: 'VAT Prod.', t: 'ref', ref: 'vatProd', w: 105 }, { k: 'whtProd', l: 'WHT Prod.', t: 'ref', ref: 'whtProd', w: 95 },
    ...(['PI', 'PRET'].includes(t) ? [{ k: 'chargeItem', l: 'Charge Assigned to Item', t: 'ref', ref: 'invItems', w: 150, only: l => l.type === 'Charge (Item)' }] : []),
    ...(t === 'PO' ? [{ k: 'qtyReceived', l: 'Qty. Received', t: 'ro', w: 80, f: 'qty' }, { k: 'qtyInvoiced', l: 'Qty. Invoiced', t: 'ro', w: 80, f: 'qty' }] : [])];
  if (kind === 'sales') return [
    { k: 'type', l: 'Type', t: 'select', opts: ['Item', 'G/L Account'], w: 120 }, { k: 'no', l: 'No.', t: 'lineref', w: 190 }, { k: 'description', l: 'Description', t: 'text' },
    { k: 'qty', l: 'Quantity', t: 'number', w: 85 }, { k: 'uom', l: 'UOM', t: 'ro', w: 55 }, { k: 'price', l: ED.pricesInclVat ? 'Unit Price Incl. VAT' : 'Unit Price Excl. VAT', t: 'number', w: 115 },
    { k: 'amount', l: 'Line Amount', t: 'calc', w: 115 }, { k: 'genProd', l: 'Gen. Prod.', t: 'ref', ref: 'genProd', w: 120 }, { k: 'vatProd', l: 'VAT Prod.', t: 'ref', ref: 'vatProd', w: 105 }];
  if (kind === 'transfer') return [{ k: 'item', l: 'Item No.', t: 'ref', ref: 'invItems', w: 230 }, { k: 'description', l: 'Description', t: 'text' }, { k: 'qty', l: 'Quantity', t: 'number', w: 100 },
    { k: 'uom', l: 'UOM', t: 'ro', w: 60 }, { k: 'onhand', l: 'Inventory (From)', t: 'calcOnHand', w: 110 }, { k: 'qtyShipped', l: 'Qty. Shipped', t: 'ro', f: 'qty', w: 85 }, { k: 'qtyReceived', l: 'Qty. Received', t: 'ro', f: 'qty', w: 85 }];
  if (kind === 'itemjnl') return [{ k: 'item', l: 'Item No.', t: 'ref', ref: 'invItems', w: 220 }, { k: 'description', l: 'Description', t: 'text' }, { k: 'qty', l: 'Quantity', t: 'number', w: 90 },
    { k: 'uom', l: 'UOM', t: 'ro', w: 55 }, { k: 'unitCost', l: 'Unit Cost (blank = average)', t: 'number', w: 110 }, { k: 'amount', l: 'Amount', t: 'calc', w: 110 },
    { k: 'genBus', l: 'Gen. Bus. Posting Group', t: 'ref', ref: 'genBus', w: 150 }, { k: 'asset', l: 'Charge to Equipment / Vessel (FA)', t: 'ref', ref: 'fixedAssets', w: 180 }, { k: 'bin', l: 'Bin Code', t: 'refFn', refFn: () => binsRef(ED.location), w: 140 }];
  if (kind === 'count') return [{ k: 'item', l: 'Item No.', t: 'ref', ref: 'invItems', w: 230 }, { k: 'description', l: 'Description', t: 'ro' }, { k: 'uom', l: 'UOM', t: 'ro', w: 60 },
    ...(needsWhse(ED.company, ED.location, 'binMandatory') ? [{ k: 'bin', l: 'Bin Code', t: 'refFn', refFn: () => binsRef(ED.location), w: 140 }] : []),
    { k: 'systemQty', l: 'Qty. (Calculated)', t: 'ro', f: 'qty', w: 110 }, { k: 'countedQty', l: 'Qty. (Phys. Inventory)', t: 'number', w: 120 }, { k: 'diff', l: 'Difference', t: 'calcDiff', w: 100 }];
  if (kind === 'gj') return [{ k: 'accType', l: 'Account Type', t: 'select', opts: GJ_ACC_TYPES, w: 125 }, { k: 'account', l: 'Account No.', t: 'gjref', w: 220 }, { k: 'desc', l: 'Description', t: 'text' },
    { k: 'asset', l: 'Equipment / Vessel', t: 'ref', ref: 'fixedAssets', w: 150 }, { k: 'debit', l: 'Debit Amount', t: 'number', w: 120 }, { k: 'credit', l: 'Credit Amount', t: 'number', w: 120 }];
  if (kind === 'fa') return [{ k: 'asset', l: 'FA No.', t: 'ro' }, { k: 'description', l: 'Description', t: 'ro' }, { k: 'amount', l: 'Amount', t: 'ro', f: 'money' }];
  return [];
}
function lineRefFor(l) { return l.type === 'G/L Account' ? 'accounts' : l.type === 'Fixed Asset' ? 'fixedAssets' : l.type === 'Charge (Item)' ? 'itemCharges' : 'items'; }
function gjRefFor(l) { return { 'Vendor': 'vendors', 'Customer': 'customers', 'Bank Account': 'bankAccounts' }[l.accType] || 'accounts'; }
function linesToolbar() { return !editable() || ['apply', 'fa', 'whsercpt', 'putaway', 'whseship', 'pick'].includes(DOCS[ED.type].lines) ? '' : `<button class="btn sm" onclick="addLine()">+ Add line</button>`; }
function linesHtml() {
  const kind = DOCS[ED.type].lines;
  if (kind === 'apply') return applyGrid();
  const cols = lineCols(), ed = editable();
  const numT = c => ['number', 'calc', 'calcDiff', 'calcOnHand'].includes(c.t) || c.f;
  const head = cols.map(c => `<th style="${c.w ? `min-width:${c.w}px` : ''}" class="${numT(c) ? 'num' : ''}">${esc(c.l)}</th>`).join('') + (ed ? '<th style="width:34px"></th>' : '');
  const rows = (ED.lines || []).map((l, i) => `<tr>${cols.map(c => lineCell(c, l, i, ed)).join('')}${ed ? `<td><button class="x" title="Remove line" onclick="delLine(${i})">×</button></td>` : ''}</tr>`).join('');
  return `<div class="tbl-wrap"><table class="grid lines"><thead><tr>${head}</tr></thead><tbody>${rows || `<tr><td colspan="${cols.length + 1}" class="empty">No lines.</td></tr>`}</tbody></table></div>`;
}
function lineCell(c, l, i, ed) {
  const v = l[c.k];
  if (c.only && !c.only(l)) return '<td></td>';
  if (c.t === 'calc') return `<td class="num" id="amt-${i}">${money(ED.type === 'IJ' ? num(l.qty) * num(l.unitCost) : lineAmount(ED, l))}</td>`;
  if (c.t === 'calcDiff') return `<td class="num" id="diff-${i}">${qtyf(num(l.countedQty) - num(l.systemQty))}</td>`;
  if (c.t === 'calcOnHand') return `<td class="num">${l.item ? qtyf(onHand(ED.company, l.item, ED.fromLoc)) : ''}</td>`;
  if (c.t === 'check') return `<td>${ed ? `<input type="checkbox" ${v ? 'checked' : ''} onchange="lnChk(${i},'${c.k}',this.checked)">` : (v ? '✔' : '')}</td>`;
  if (c.t === 'calcFn') return `<td class="${c.k === 'src' ? '' : 'num'}">${esc(c.fn(l))}</td>`;
  if (c.t === 'refFn' && ed) return `<td>${pickHtml('', c.refFn(l), v, `onchange="lnSel(${i},'${c.k}',this.value)"`)}</td>`;
  if (c.t === 'ro' || !ed) {
    let disp = v ?? '';
    if (c.f === 'qty') disp = v == null || v === '' ? '' : qtyf(v);
    else if (c.f === 'money' || c.t === 'number') disp = v == null || v === '' ? '' : (['qty', 'countedQty'].includes(c.k) ? qtyf(v) : money(v));
    return `<td class="${c.t === 'number' || c.f ? 'num' : ''}">${esc(disp)}</td>`;
  }
  const on = `onchange="lnSel(${i},'${c.k}',this.value)"`;
  switch (c.t) {
    case 'select': return `<td><select ${on}>${optionsHtml(c.opts, v, false)}</select></td>`;
    case 'lineref': return `<td>${pickHtml('', lineRefFor(l), v, on)}</td>`;
    case 'gjref': return `<td>${pickHtml('', gjRefFor(l), v, on)}</td>`;
    case 'ref': return `<td>${pickHtml('', c.ref, v, on)}</td>`;
    case 'number': return `<td><input type="number" step="any" class="num" value="${esc(v ?? '')}" oninput="lnIn(${i},'${c.k}',this.value,1)"></td>`;
    default: return `<td><input type="text" value="${esc(v ?? '')}" oninput="lnIn(${i},'${c.k}',this.value)"></td>`;
  }
}
function addLine(silent) {
  const kind = DOCS[ED.type].lines;
  if (['apply', 'fa', 'count', 'whsercpt', 'putaway', 'whseship', 'pick'].includes(kind) && silent) return;
  ED.lines.push(kind === 'purchase' || kind === 'sales' ? { type: 'Item', no: '', description: '', qty: 1, uom: '', unitCost: 0, price: 0 } :
    kind === 'gj' ? { accType: 'G/L Account', account: '', desc: '', debit: 0, credit: 0 } : kind === 'reclass' ? { item: '', description: '', location: '', bin: '', newLocation: '', newBin: '', qty: 1 } : { item: '', description: '', qty: 1 });
  if (!silent) refreshLines();
}
function delLine(i) { ED.lines.splice(i, 1); refreshLines(); }
function refreshLines() {
  if ($('#lines-wrap')) $('#lines-wrap').innerHTML = linesHtml(); setTotals();
  const bc = budgetCheck(ED); if (bc && $('#budget')) $('#budget').innerHTML = budgetPanel(bc);
}
function lnIn(i, k, v, isNum) {
  const l = ED.lines[i]; l[k] = isNum ? (v === '' ? '' : num(v)) : v;
  const a = $('#amt-' + i); if (a) a.textContent = money(ED.type === 'IJ' ? num(l.qty) * num(l.unitCost) : lineAmount(ED, l));
  const df = $('#diff-' + i); if (df) df.textContent = qtyf(num(l.countedQty) - num(l.systemQty));
  setTotals();
}
function lnSel(i, k, v) {
  const l = ED.lines[i]; l[k] = v.trim();
  if (k === 'type') Object.assign(l, { no: '', description: '', uom: '', genProd: '', vatProd: '', whtProd: '' });
  if (k === 'accType') l.account = '';
  if (k === 'no' && l.no) { lineDefaults(ED, l); if (!l.description) toast(`${l.no} was not found.`, 'err'); }
  if (k === 'item' && l.item) {
    const it = itemOf(l.item, ED.company); if (!it) { toast(`Item ${l.item} was not found.`, 'err'); return refreshLines(); }
    l.description = it.description; l.uom = it.uom;
    if (ED.type === 'IJ') { l.unitCost = r4(avgCost(ED.company, l.item)); l.genBus = invAdjBus(ED.company, it.genProd); if (!l.bin && needsWhse(ED.company, ED.location, 'binMandatory')) l.bin = suggestBin(ED.company, ED.location, l.item); }
    if (ED.type === 'RJ') { l.bin = ''; l.newBin = ''; }
    if (ED.type === 'PC') { l.systemQty = onHand(ED.company, l.item, ED.location); l.countedQty = l.systemQty; }
  }
  if (k === 'account' && ED.type === 'GJ' && !l.desc) l.desc = (gjRefFor(l) === 'accounts' ? accName(l.account) : lookupName(gjRefFor(l), l.account)).replace(/^.*? – /, '');
  refreshLines();
}
function totalsHtml() {
  const t = docTotals(ED), kind = DOCS[ED.type].lines;
  const row = (l, v, cls = '') => `<div class="trow ${cls}"><span>${l}</span><b>${money(v)}</b></div>`;
  if (kind === 'gj') return `<div class="totals">${row('Total Debit', t.debit)}${row('Total Credit', t.credit)}${row('Difference', t.diff, Math.abs(t.diff) > 0.009 ? 'bad' : 'good')}</div>`;
  if (kind === 'brec') { const b = brecTotals(ED); return `<div class="totals">${row('Balance Last Statement', b.last)}${row('+ Matched entries', b.matched)}${row('= Calculated balance', b.calc)}${row('Statement Ending Balance', b.ending)}${row('Difference (must be 0)', b.diff, Math.abs(b.diff) > 0.009 ? 'bad' : 'good')}</div>`; }
  if (kind === 'apply') {
    let extra = '';
    if (ED.type === 'CR' && ED.cwtProd) { try { const c = cwtFor(ED); extra = row(`CWT withheld by customer (${c.pct}%)`, c.amount); } catch (e) { extra = `<div class="trow bad">${esc(e.message)}</div>`; } }
    return `<div class="totals">${row('Total Applied', t.applied)}${extra}${row(ED.type === 'PAY' ? 'Payment Amount' : 'Amount Received', t.total, 'grand')}</div>`;
  }
  if (['transfer', 'count', 'whsercpt', 'putaway', 'whseship', 'pick', 'reclass'].includes(kind)) return '';
  if (kind === 'fa' || kind === 'itemjnl') return `<div class="totals">${row('Total', t.total, 'grand')}</div>`;
  return `<div class="totals">${row('Total Excl. VAT', t.subtotal)}${row('Total VAT', t.vat)}${!SALES_DOCS.includes(ED.type) ? row('Less: Withholding Tax (EWT)', -t.wht) : ''}${row(SALES_DOCS.includes(ED.type) ? 'Total Incl. VAT' : 'Amount Payable to Vendor', t.total, 'grand')}</div>`;
}

/* ---------- Apply Entries ---------- */
function applyGrid() {
  const kind = DOCS[ED.type].party, party = ED[kind];
  const ledger = kind === 'vendor' ? DB.apLedger : DB.arLedger;
  if (!editable()) return ED.lines.length ? `<table class="grid compact"><thead><tr><th>Applies-to Doc. No.</th><th>Description</th><th class="num">Amount Applied</th></tr></thead><tbody>${ED.lines.map(a =>
    `<tr><td>${esc(a.docNo)}</td><td>${esc(a.desc || '')}</td><td class="num">${money(a.amount)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No entries applied (amount stays open on the ledger as an advance/deposit).</p>';
  if (!party) return `<p class="muted">Select the ${kind} first to see their open entries.</p>`;
  const open = ledger.filter(e => e.company === ED.company && e[kind] === party && Math.abs(e.remaining) > 0.004 && U(e.currency || '') === U(isFCY(ED.currency) ? ED.currency : ''));
  if (!open.length) return `<p class="muted">No open entries. Any amount posted will stay open on the ${kind} ledger as an ${ED.type === 'PAY' ? 'advance to the vendor' : 'unapplied payment / customer deposit'}.</p>`;
  return `<table class="grid compact"><thead><tr><th style="width:40px">Apply</th><th>Document No.</th><th>Ext. Doc. No.</th><th>Posting Date</th><th>Due Date</th><th>Description</th><th class="num">Original Amount</th><th class="num">Remaining Amount</th><th class="num" style="width:150px">Amount to Apply</th></tr></thead><tbody>
  ${open.map(e => { const a = ED.lines.find(x => x.entryId === e.id);
    return `<tr><td><input type="checkbox" ${a ? 'checked' : ''} onchange="apToggle('${e.id}',this.checked)"></td><td>${esc(e.docNo)}</td><td>${esc(e.extDocNo || '')}</td><td>${esc(e.date)}</td><td class="${e.due < today() ? 'bad' : ''}">${esc(e.due)}</td><td>${esc(e.desc)}</td>
    <td class="num">${money(e.amount)}</td><td class="num">${money(e.remaining)}</td><td>${a ? `<input type="number" step="any" class="num" value="${a.amount}" oninput="apAmt('${e.id}',this.value)">` : ''}</td></tr>`; }).join('')}</tbody></table>`;
}
function apToggle(id, on) {
  const ledger = DOCS[ED.type].party === 'vendor' ? DB.apLedger : DB.arLedger, e = ledger.find(x => x.id === id);
  ED.lines = ED.lines.filter(x => x.entryId !== id);
  if (on) ED.lines.push({ entryId: id, docNo: e.docNo, desc: e.desc, amount: e.remaining });
  refreshLines();
}
function apAmt(id, v) { const a = ED.lines.find(x => x.entryId === id); if (a) a.amount = num(v); setTotals(); }

/* ---------- Header changes: copy posting setup from the vendor/customer card, like BC ---------- */
function copyPartyToDoc(d) {
  const kind = DOCS[d.type].party; if (!kind || !d[kind]) return;
  const p = kind === 'vendor' ? vendorOf(d[kind], d.company) : customerOf(d[kind], d.company);
  if (!p) return;
  Object.assign(d, { genBus: p.genBus || '', vatBus: p.vatBus || '', whtBus: p.whtBus || '', pricesInclVat: !!p.pricesInclVat, paymentTerms: p.paymentTerms || '', postingGroup: p.postingGroup || '' });
  if ('dueDate' in Object.fromEntries(DOCS[d.type].head.map(f => [f.k, 1]))) d.dueDate = addDays(d.date, (M(d.company).paymentTerms.find(t => t.code === p.paymentTerms) || {}).days || 0);
}
function hdrChange() {
  const def = DOCS[ED.type];
  const before = { p: ED[def.party], loc: ED.location, from: ED.fromLoc, incl: ED.pricesInclVat };
  Object.assign(ED, readForm(def.head, 'h'));
  if (def.party && before.p !== ED[def.party]) {
    if (ED[def.party] && !(def.party === 'vendor' ? vendorOf(ED.vendor) : customerOf(ED.customer))) { toast(`${ED[def.party]} was not found.`, 'err'); return; }
    if (def.lines === 'apply') ED.lines = [];
    copyPartyToDoc(ED); return drawDoc();
  }
  if (before.incl !== ED.pricesInclVat) return drawDoc();
  if (ED.type === 'PC' && before.loc !== ED.location) { ED.lines.forEach(l => { l.systemQty = onHand(ED.company, l.item, ED.location); }); return refreshLines(); }
  if (ED.type === 'TO' && before.from !== ED.fromLoc) return refreshLines();
  setTotals();
  const bc = budgetCheck(ED); if (bc && $('#budget')) $('#budget').innerHTML = budgetPanel(bc);
}

/* ---------- Save / workflow ---------- */
function cleanLines(d) {
  const kind = DOCS[d.type].lines;
  if (kind === 'purchase' || kind === 'sales') d.lines = d.lines.filter(l => l.no);
  else if (kind === 'gj') d.lines = d.lines.filter(l => l.account && (num(l.debit) || num(l.credit)));
  else if (['transfer', 'itemjnl', 'count', 'reclass'].includes(kind)) d.lines = d.lines.filter(l => l.item);
  else if (kind === 'apply') d.lines = d.lines.filter(l => num(l.amount));
  for (const l of d.lines) for (const k of ['qty', 'unitCost', 'price', 'debit', 'credit', 'countedQty', 'amount']) if (k in l) l[k] = num(l[k]);
}
function storeED() {
  Object.assign(ED, readForm(DOCS[ED.type].head, 'h'));
  if ($('#dm_' + ((M(ED.company).dimensions[0] || {}).code || 'x').replace(/\W/g, '_'))) dimChange();
  cleanLines(ED);
  const i = ED.id ? DB.docs.findIndex(x => x.id === ED.id) : -1;
  if (i < 0) { ED.id = uid(); ED.no = nextNo(ED.type, ED.company); ED.createdBy = curUser().id; ED.createdAt = new Date().toISOString(); DB.docs.push(clone(ED)); }
  else DB.docs[i] = clone(ED);
}
const dbDoc = () => DB.docs.find(x => x.id === ED.id);
function afterChange(ok) { if (ok === false) return; const d = dbDoc(); if (location.hash === `#/doc/${ED.type}/${ED.id}`) { ED = clone(d); drawDoc(); } else go(`#/doc/${ED.type}/${ED.id}`); }
async function saveDoc() {
  const wasNew = !ED.id;
  const ok = await commit(() => storeED(), `Saved ${ED.type}`, ED.no);
  if (ok !== false) { toast(`${DOCS[ED.type].name} ${ED.no} saved.`); afterChange(ok); } else if (wasNew) { ED.id = ''; ED.no = ''; }
}
function validateDoc(d) {
  const def = DOCS[d.type];
  requireFields(def.head, d);
  if (!['apply', 'none', 'brec'].includes(def.lines) && !d.lines.length) fail('There is nothing to release: add at least one line.');
  if (['purchase', 'sales', 'transfer', 'itemjnl', 'reclass'].includes(def.lines)) for (const l of d.lines) if (num(l.qty) <= 0) fail(`Quantity must be positive (${l.no || l.item}).`);
  if (d.type === 'GJ') { const t = docTotals(d); if (Math.abs(t.diff) > 0.009) fail(`The journal is out of balance by ${money(t.diff)}.`); }
  if (d.type === 'TO' && d.fromLoc === d.toLoc) fail('Transfer-from Code and Transfer-to Code cannot be the same.');
  if (d.type === 'PI') {
    const dup = DB.docs.find(x => x.type === 'PI' && x.id !== d.id && x.vendor === d.vendor && x.company === d.company && x.vendorInvoiceNo === d.vendorInvoiceNo && x.status !== 'Cancelled');
    if (dup) fail(`Purchase Invoice ${dup.no} already exists for this vendor with Vendor Invoice No. ${d.vendorInvoiceNo}.`);
  }
  if (['PI', 'PRET', 'SI', 'SCM'].includes(d.type) && d.lines.some(l => (l.type === 'Item' && (itemOf(l.no, d.company) || {}).type === 'Inventory') || l.type === 'Charge (Item)') && !d.location) fail('Location Code must have a value for inventory items.');
  if (d.type === 'CR' && num(d.amount) <= 0) fail('Amount Received must be positive.');
  if (d.type === 'PAY' && !(num(d.amount) || d.lines.length)) fail('Apply entries or enter an amount.');
  checkSetup(d);
}
async function submitDoc() {
  const wasNew = !ED.id;
  const ok = await commit(() => { if (ED.status !== 'Draft') fail('Only documents with status Draft (Open) can be sent for approval.'); storeED(); const d = dbDoc(); validateDoc(d); submitForApproval(d, d.type); ED = clone(d); }, `Sent ${ED.type} for approval`, ED.no);
  if (ok !== false) { toast(ED.status === 'Approved' ? `${ED.no} released (no approval steps apply).` : `${ED.no} sent for approval to: ${pendingStep(ED).role}.`); afterChange(ok); }
  else if (wasNew) { ED.id = ''; ED.no = ''; ED.status = 'Draft'; ED.approvals = []; }
}
function approveDoc() {
  modal('Approve ' + ED.no, `<label class="fld w3"><span>Comment (optional)</span><textarea id="apc" rows="3"></textarea></label>`, async () => {
    const c = $('#apc').value.trim(); const ok = await commit(() => approveStep(dbDoc(), c), `Approved ${ED.type}`, ED.no);
    if (ok !== false) { toast('Approved.'); afterChange(ok); }
  }, 'Approve');
}
function rejectDoc() {
  modal('Reject ' + ED.no, `<label class="fld w3"><span>Reason for rejection *</span><textarea id="apc" rows="3"></textarea></label>`, async () => {
    const c = $('#apc').value.trim(); const ok = await commit(() => rejectStep(dbDoc(), c), `Rejected ${ED.type}: ${c}`, ED.no);
    if (ok !== false) { toast('Rejected and returned to the requester.'); afterChange(ok); } else return false;
  }, 'Reject');
}
async function reopenDoc() { const ok = await commit(() => { const d = dbDoc(); d.status = 'Draft'; d.approvals = []; }, `Reopened ${ED.type}`, ED.no); afterChange(ok); }
async function deleteDoc() {
  if (!confirm(`Delete ${ED.no}?`)) return;
  const ok = await commit(() => { if (dbDoc().status !== 'Draft') fail('Only drafts can be deleted.'); DB.docs = DB.docs.filter(x => x.id !== ED.id); }, `Deleted ${ED.type}`, ED.no);
  if (ok !== false) { toast('Deleted.'); go('#/docs/' + ED.type); }
}
const POSTERS = { PI: postPI, PRET: postPRET, PAY: postPAY, CR: postCR, SI: postSI, SCM: postSCM, IJ: postIJ, PC: postPC, GJ: postGJ };
async function postDoc() {
  if (!confirm(`Do you want to post ${ED.no}? Posted entries cannot be changed; correct them with a credit memo or journal.`)) return;
  const ok = await commit(() => {
    const d = dbDoc(); if (d.status !== 'Approved') fail('Status must be Approved (released) before posting.');
    POSTERS[d.type](d); d.status = 'Posted'; d.postedAt = new Date().toISOString(); d.postedBy = curUser().id;
  }, `Posted ${ED.type}`, ED.no);
  if (ok !== false) { toast(`${ED.no} posted.`); afterChange(ok); }
}

/* ---------- Procure-to-Pay conversions ---------- */
const HDR_COPY = ['genBus', 'vatBus', 'whtBus', 'pricesInclVat', 'paymentTerms', 'postingGroup', 'location', 'currency'];
function prCreatePQ() {
  modal('Create Purchase Quotes (canvass)', `<p>Enter one or more Vendor No. (one per box). A Purchase Quote is created per vendor with the requisition lines.</p>
    ${[0, 1, 2].map(i => fieldHtml({ k: 'v' + i, l: `Vendor ${i + 1}`, t: 'ref', ref: 'vendors', w: 'w3' }, '', 'pq')).join('')}`, async () => {
    const sel = [0, 1, 2].map(i => $('#pq_v' + i).value.trim()).filter(Boolean);
    if (!sel.length) { toast('Enter at least one vendor.', 'err'); return false; }
    const ok = await commit(() => {
      const pr = dbDoc();
      for (const v of sel) {
        if (!vendorOf(v, pr.company)) fail(`Vendor ${v} does not exist.`);
        const pq = { id: uid(), type: 'PQ', no: nextNo('PQ', pr.company), company: pr.company, date: today(), status: 'Draft', vendor: v, location: pr.location, prNo: pr.no, dims: clone(pr.dims || {}),
          createdBy: curUser().id, createdAt: new Date().toISOString(), approvals: [], lines: clone(pr.lines) };
        copyPartyToDoc(pq); DB.docs.push(pq);
      }
    }, `Created ${sel.length} quote(s) from requisition`, ED.no);
    if (ok !== false) { toast(`${sel.length} Purchase Quote(s) created. Enter each vendor's prices.`); afterChange(ok); } else return false;
  }, 'Create Quotes');
}
async function pqMakePO() {
  let po;
  const ok = await commit(() => {
    const pq = dbDoc();
    if (pq.status !== 'Approved') fail(`Quote ${pq.no} is ${pq.status}. Only an approved (awarded) quote can become a Purchase Order.`);
    if (DB.docs.some(x => x.type === 'PO' && x.company === pq.company && x.pqNo === pq.no)) fail(`Quote ${pq.no} already has a Purchase Order.`);
    po = { id: uid(), type: 'PO', no: nextNo('PO', pq.company), company: pq.company, date: today(), status: 'Draft', vendor: pq.vendor, prNo: pq.prNo || '', pqNo: pq.no, dims: clone(pq.dims || {}),
      createdBy: curUser().id, createdAt: new Date().toISOString(), approvals: [], lines: pq.lines.map(l => ({ ...l, qtyReceived: 0, qtyInvoiced: 0 })) };
    for (const k of HDR_COPY) po[k] = pq[k];
    if (!po.location) po.location = (refOptions('locations')[0] || [])[0];
    DB.docs.push(po); pq.status = 'Ordered';
    if (pq.prNo) for (const o of DB.docs.filter(x => x.type === 'PQ' && x.prNo === pq.prNo && x.company === pq.company && x.id !== pq.id && ['Draft', 'Approved', 'Pending Approval'].includes(x.status))) o.status = 'Not Selected';
    const pr = DB.docs.find(x => x.type === 'PR' && x.no === pq.prNo && x.company === pq.company); if (pr) pr.status = 'Ordered';
  }, 'Make Order', ED.no);
  if (ok !== false) { toast(`Purchase Order ${po.no} created. Review it and send the approval request.`); go(`#/doc/PO/${po.id}`); }
}
function poReceive() {
  const whse = needsWhse(ED.company, ED.location, 'requireReceive'), inv = invLines(ED);
  const svc = l => typeof asrBlocks === 'function' && asrBlocks(ED, l);
  const rows = ED.lines.map((l, i) => ({ l, i, out: r4(num(l.qty) - num(l.qtyReceived)) })).filter(x => x.out > 0 && !(whse && inv.includes(x.l)) && !svc(x.l));
  if (!rows.length) return toast(ED.lines.some(l => svc(l) && num(l.qty) > num(l.qtyReceived)) ? 'Service lines are accepted with an Approved Service Report: click "Record Service Completion (ASR)".' : whse ?'Inventory items at this location are received through a Warehouse Receipt.' : 'Everything on this order has been received.', 'err');
  const loc = M(ED.company).locations.find(l => l.code === ED.location) || {};
  modal(`Post Receipt – ${ED.no}`, `<div class="form-grid">${fieldHtml({ k: 'date', l: 'Posting Date', t: 'date' }, today(), 'rr')}${fieldHtml({ k: 'drNo', l: 'Vendor Shipment No. (DR / WAR)' }, '', 'rr')}
    ${fieldHtml({ k: 'remarks', l: 'Remarks (inspection, condition)', w: 'w2' }, '', 'rr')}</div>
    <p class="muted small">Location <b>${esc(ED.location)}</b>${loc.binMandatory ? ` · Bin mandatory (receipt bin ${esc(loc.receiptBin || '—')})` : ''}. For services this is the Work Accomplishment Report (WAR).</p>
    <table class="grid compact"><thead><tr><th>No.</th><th>Description</th><th class="num">Quantity</th><th class="num">Qty. Received</th><th class="num">Qty. to Receive</th>${loc.binMandatory ? '<th>Bin Code</th>' : ''}</tr></thead><tbody>
    ${rows.map(x => `<tr><td>${esc(x.l.no)}</td><td>${esc(x.l.description)}</td><td class="num">${qtyf(x.l.qty)}</td><td class="num">${qtyf(x.l.qtyReceived)}</td>
      <td><input type="number" step="any" class="num rcvq" data-i="${x.i}" value="${x.out}"></td>${loc.binMandatory ? `<td>${pickHtml('', 'bins:' + ED.location, loc.receiptBin || '', `class="rcvb" data-i="${x.i}"`)}</td>` : ''}</tr>`).join('')}</tbody></table>`, async m => {
    const h = readForm([{ k: 'date' }, { k: 'drNo' }, { k: 'remarks' }], 'rr');
    const bins = Object.fromEntries($$('.rcvb', m).map(x => [x.dataset.i, x.value]));
    const q = $$('.rcvq', m).map(x => ({ i: +x.dataset.i, qty: num(x.value), bin: bins[x.dataset.i] || '' })).filter(x => x.qty > 0);
    if (!q.length) { toast('Enter a Qty. to Receive.', 'err'); return false; }
    const ok = await commit(() => {
      const po = dbDoc();
      for (const x of q) if (x.qty > num(po.lines[x.i].qty) - num(po.lines[x.i].qtyReceived) + 0.0001) fail(`You cannot receive more than ${qtyf(num(po.lines[x.i].qty) - num(po.lines[x.i].qtyReceived))} units of ${po.lines[x.i].no}.`);
      const rr = { id: uid(), type: 'RR', no: nextNo('RR', po.company), company: po.company, date: h.date || today(), status: 'Posted', vendor: po.vendor, location: po.location, poNo: po.no, drNo: h.drNo, remarks: h.remarks, dims: clone(po.dims || {}),
        createdBy: curUser().id, createdAt: new Date().toISOString(), postedAt: new Date().toISOString(), approvals: [],
        lines: q.map(x => { const pl = po.lines[x.i]; return { poLine: x.i, type: pl.type, no: pl.no, description: pl.description, uom: pl.uom, qty: x.qty, unitCost: lineCalc(po, { ...pl, qty: 1 }).base * docRate(po), bin: x.bin }; }) };
      postReceipt(po, rr); DB.docs.push(rr);
    }, 'Posted purchase receipt', ED.no);
    if (ok !== false) { toast('Receipt posted. Inventory updated (expected cost).'); afterChange(ok); } else return false;
  }, 'Post', true);
}
async function poCreatePI() {
  let pi;
  const ok = await commit(() => {
    const po = dbDoc();
    const pendingQty = i => sum(DB.docs.filter(x => x.type === 'PI' && x.company === po.company && !['Posted', 'Cancelled'].includes(x.status)).flatMap(x => x.lines).filter(l => l.poNo === po.no && l.poLine === i), 'qty');
    const lines = po.lines.map((l, i) => ({ l, i, q: r4(num(l.qtyReceived) - num(l.qtyInvoiced) - pendingQty(i)) })).filter(x => x.q > 0)
      .map(x => ({ ...clone(x.l), qty: x.q, rcvUnitCost: lineCalc(po, { ...x.l, qty: 1 }).base * docRate(po), received: true, poNo: po.no, poLine: x.i, qtyReceived: undefined, qtyInvoiced: undefined }));
    if (!lines.length) fail('There are no receipt lines to invoice: post the receipt first (or they are already on another invoice).');
    pi = { id: uid(), type: 'PI', no: nextNo('PI', po.company), company: po.company, date: today(), status: 'Draft', vendor: po.vendor, poNo: po.no, prNo: po.prNo, dims: clone(po.dims || {}),
      createdBy: curUser().id, createdAt: new Date().toISOString(), approvals: [], lines };
    for (const k of HDR_COPY) pi[k] = po[k];
    pi.dueDate = addDays(pi.date, (M(po.company).paymentTerms.find(t => t.code === pi.paymentTerms) || {}).days || 0);
    DB.docs.push(pi);
  }, 'Get Receipt Lines', ED.no);
  if (ok !== false) { toast(`Purchase Invoice ${pi.no} created from the receipt lines. Enter the Vendor Invoice No. and send for approval.`); go(`#/doc/PI/${pi.id}`); }
}

/* ---------- Inventory actions ---------- */
async function toShip() { const ok = await commit(() => shipTO(dbDoc()), 'Posted transfer shipment', ED.no); if (ok !== false) { toast('Shipment posted. Items are in transit.'); afterChange(ok); } }
function toReceive() {
  modal('Post Receipt – ' + ED.no, fieldHtml({ k: 'date', l: 'Posting Date', t: 'date' }, today(), 'tr'), async () => {
    const dt = $('#tr_date').value; const ok = await commit(() => receiveTO(dbDoc(), dt), 'Posted transfer receipt', ED.no);
    if (ok !== false) { toast('Received at destination.'); afterChange(ok); } else return false;
  }, 'Post');
}
function pcCalculate() {
  Object.assign(ED, readForm(DOCS.PC.head, 'h'));
  if (!ED.location) return toast('Choose the Location Code first.', 'err');
  if (needsWhse(ED.company, ED.location, 'binMandatory')) {
    ED.lines = binContents(ED.company, ED.location).map(b => { const it = itemOf(b.item, ED.company); return { item: b.item, bin: b.bin, description: it.description, uom: it.uom, systemQty: b.qty, countedQty: b.qty }; });
  } else {
    const items = [...new Set(DB.itemLedger.filter(e => e.company === ED.company && e.location === ED.location).map(e => e.item))];
    ED.lines = items.map(i => { const it = itemOf(i, ED.company); const q = onHand(ED.company, i, ED.location); return { item: i, description: it.description, uom: it.uom, systemQty: q, countedQty: q }; });
  }
  refreshLines(); toast(`${ED.lines.length} item(s) loaded. Enter the physical quantities.`);
}

/* ---------- Related docs, G/L entries, print ---------- */
function relatedPanel() {
  if (!ED.no) return '';
  const rel = DB.docs.filter(x => x.id !== ED.id && x.company === ED.company && (x.prNo === ED.no || x.pqNo === ED.no || x.poNo === ED.no || (x.lines || []).some(l => l.poNo === ED.no)));
  const uniq = [...new Map(rel.map(r => [r.id, r])).values()];
  let html = '';
  if (ED.type === 'PR') {
    const pqs = uniq.filter(x => x.type === 'PQ');
    if (pqs.length) {
      const low = Math.min(...pqs.map(q => docTotals(q).total || Infinity));
      html += `<div class="card"><h3>Canvass Comparison</h3><table class="grid compact"><thead><tr><th>Quote</th><th>Vendor</th><th>Status</th>${ED.lines.map(l => `<th class="num">${esc(l.no)}</th>`).join('')}<th class="num">Total Incl. VAT</th></tr></thead><tbody>
      ${pqs.map(q => { const tot = docTotals(q).total; return `<tr class="link ${tot === low && tot > 0 ? 'best' : ''}" onclick="go('#/doc/PQ/${q.id}')"><td>${esc(q.no)}</td><td>${esc(partyName('vendor', q.vendor, q.company))}</td><td>${badge(q.status)}</td>
        ${ED.lines.map(l => { const ql = q.lines.find(x => x.no === l.no); return `<td class="num">${ql ? money(ql.unitCost) : '–'}</td>`; }).join('')}<td class="num"><b>${money(tot)}</b>${tot === low && tot > 0 ? ' ★ lowest' : ''}</td></tr>`; }).join('')}
      </tbody></table></div>`;
    }
  }
  if (uniq.length) html += `<div class="card"><h3>Related Documents</h3>${uniq.map(r => `<a class="chip" href="#/doc/${r.type}/${r.id}">${esc(DOCS[r.type].name)} ${esc(r.no)} ${badge(r.status)}</a>`).join(' ')}</div>`;
  return html;
}
function dimText(dims) { return Object.entries(dims || {}).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(' '); }
function glPanel() {
  if (!ED.no) return '';
  const g = DB.gl.filter(e => e.docNo === ED.no && e.company === ED.company), il = DB.itemLedger.filter(e => e.docNo === ED.no && e.company === ED.company);
  let html = '';
  if (g.length) html += `<div class="card"><h3>G/L Entries</h3><table class="grid compact"><thead><tr><th>Posting Date</th><th>G/L Account</th><th>Description</th><th>Dimensions</th><th>FA</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead><tbody>
    ${g.map(e => `<tr><td>${e.date}</td><td>${esc(e.account)} – ${esc(accName(e.account, e.company))}</td><td>${esc(e.desc)}</td><td class="small">${esc(dimText(e.dims))}</td><td>${esc(e.asset)}</td><td class="num">${e.debit ? money(e.debit) : ''}</td><td class="num">${e.credit ? money(e.credit) : ''}</td></tr>`).join('')}
    </tbody><tfoot><tr><td colspan="5"><b>Total</b></td><td class="num"><b>${money(sum(g, 'debit'))}</b></td><td class="num"><b>${money(sum(g, 'credit'))}</b></td></tr></tfoot></table></div>`;
  if (il.length) html += `<div class="card"><h3>Item Ledger / Value Entries</h3><table class="grid compact"><thead><tr><th>Date</th><th>Item</th><th>Location</th><th>Bin</th><th>Entry Type</th><th class="num">Quantity</th><th class="num">Cost (Actual)</th><th class="num">Cost (Expected)</th></tr></thead><tbody>
    ${il.map(e => `<tr><td>${e.date}</td><td>${esc(e.item)} – ${esc((itemOf(e.item, e.company) || {}).description)}</td><td>${esc(e.location)}</td><td>${esc(e.bin || '')}</td><td>${esc(e.entryType)}</td><td class="num">${qtyf(e.qty)}</td><td class="num">${money(e.value)}</td><td class="num">${money(e.exp || 0)}</td></tr>`).join('')}</tbody></table></div>`;
  return html;
}
function printDoc() { window.print(); }
function printArea() {
  const def = DOCS[ED.type], co = DB.companies.find(c => c.code === ED.company) || {};
  const cols = lineCols().filter(c => !['qtyReceived', 'qtyInvoiced', 'onhand', 'genProd', 'whtProd', 'chargeItem', 'bin', 'genBus'].includes(c.k));
  const t = docTotals(ED);
  const party = def.party && ED[def.party] ? (def.party === 'vendor' ? vendorOf(ED.vendor, ED.company) : customerOf(ED.customer, ED.company)) : null;
  const lineRows = def.lines === 'apply'
    ? `<table class="pgrid"><thead><tr><th>Applies-to Doc.</th><th>Description</th><th class="num">Amount</th></tr></thead><tbody>${ED.lines.map(a => `<tr><td>${esc(a.docNo)}</td><td>${esc(a.desc || '')}</td><td class="num">${money(a.amount)}</td></tr>`).join('')}</tbody></table>`
    : `<table class="pgrid"><thead><tr>${cols.map(c => `<th>${esc(c.l)}</th>`).join('')}</tr></thead><tbody>${ED.lines.map(l => `<tr>${cols.map(c => {
      let v = l[c.k]; if (c.t === 'calc') v = money(ED.type === 'IJ' ? num(l.qty) * num(l.unitCost) : lineAmount(ED, l)); else if (c.t === 'calcDiff') v = qtyf(num(l.countedQty) - num(l.systemQty));
      else if (c.t === 'number' && v !== '' && v != null) v = ['qty', 'countedQty'].includes(c.k) ? qtyf(v) : money(v); else if (c.f === 'money') v = money(v);
      return `<td>${esc(v ?? '')}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
  return `<div class="print-area"><div class="p-head"><div><h2>${esc(co.name || ED.company)}</h2><div>${esc(DB.settings.groupName)} · ${esc(co.address || '')} ${co.tin ? 'TIN ' + esc(co.tin) : ''}</div></div>
    <div class="p-title"><h1>${esc(def.name.toUpperCase())}</h1><div>No. <b>${esc(ED.no)}</b></div><div>Date: ${esc(ED.date)}</div><div>Status: ${esc(ED.status)}</div></div></div>
    ${party ? `<div class="p-party"><b>${def.party === 'vendor' ? 'Vendor' : 'Customer'}:</b> ${esc(party.no)} – ${esc(party.name)}<br>${esc(party.address || '')} ${esc(party.city || '')} ${party.tin ? 'TIN ' + esc(party.tin) : ''}</div>` : ''}
    <div class="p-fields">${def.head.filter(f => !['vendor', 'customer', 'date'].includes(f.k) && ED[f.k] !== '' && ED[f.k] != null && ED[f.k] !== false).map(f => `<div><b>${esc(f.l)}:</b> ${esc(f.t === 'check' ? 'Yes' : ED[f.k])}</div>`).join('')}
    ${dimText(ED.dims) ? `<div><b>Dimensions:</b> ${esc(dimText(ED.dims))}</div>` : ''}</div>
    ${lineRows}
    <div class="p-totals">${t.subtotal != null ? `<div>Total Excl. VAT: <b>${money(t.subtotal)}</b></div>` : ''}${t.vat ? `<div>VAT: <b>${money(t.vat)}</b></div>` : ''}${t.wht ? `<div>Less Withholding Tax: <b>(${money(t.wht)})</b></div>` : ''}${t.total ? `<div class="grand">TOTAL: <b>${money(t.total)}</b></div>` : ''}</div>
    <div class="p-sign"><div><div class="line"></div>Prepared by: ${esc((DB.users.find(u => u.id === ED.createdBy) || {}).name || '')}</div>
    ${(ED.approvals || []).map(a => `<div><div class="line">${a.status === 'Approved' ? '✔ ' + esc(a.by) + ' ' + esc((a.at || '').slice(0, 10)) : ''}</div>${esc(a.role)}</div>`).join('')}
    ${def.party === 'customer' || ED.type === 'PAY' ? '<div><div class="line"></div>Received by / Date</div>' : ''}</div>
    ${checkHtml()}<div class="p-foot">Printed ${new Date().toLocaleString()} – ${esc(DB.settings.groupName)} ERP</div></div>`;
}
function lnChk(i, k, v) { ED.lines[i][k] = !!v; setTotals(); }
function setTotals() { const t = $('#totals'); if (t) t.innerHTML = totalsHtml(); }
