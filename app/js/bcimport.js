'use strict';
/* ============ Import Business Central configuration packages (.xlsx) into a Master Data Set ============ */
const BC_TABLES = [
  { t: 'accounts', key: ['no'], m: /g\/?l account|chart of accounts|^coa$|^land$/i, req: ['no', 'name', 'type'], c: { no: ['No.'], name: ['Name'], type: ['Account Type'], category: ['Account Category'], incomeBalance: ['Income/Balance'], debitCredit: ['Debit/Credit'], directPosting: ['Direct Posting'], totaling: ['Totaling'], genPostingType: ['Gen. Posting Type'], genBus: ['Gen. Bus. Posting Group'], genProd: ['Gen. Prod. Posting Group'], vatBus: ['VAT Bus. Posting Group'], vatProd: ['VAT Prod. Posting Group'], whtBus: ['WHT Business Posting Group', 'WHT Bus. Posting Group'], whtProd: ['WHT Product Posting Group', 'WHT Prod. Posting Group'] } },
  { t: 'genSetup', key: ['bus', 'prod'], m: /general posting setup/i, req: ['prod'], c: { bus: ['Gen. Bus. Posting Group'], prod: ['Gen. Prod. Posting Group'], sales: ['Sales Account'], purch: ['Purch. Account'], cogs: ['COGS Account'], invAdj: ['Inventory Adjmt. Account'], salesCM: ['Sales Credit Memo Account'], purchCM: ['Purch. Credit Memo Account'], salesPrepay: ['Sales Prepayments Account'], purchPrepay: ['Purch. Prepayments Account'], invAccrual: ['Invt. Accrual Acc. (Interim)'], directCostApplied: ['Direct Cost Applied Account'], purchVariance: ['Purchase Variance Account'], description: ['Description'] } },
  { t: 'genBus', key: ['code'], m: /gen\.?\s*bus/i, req: ['code'], c: { code: ['Code'], description: ['Description'], defVatBus: ['Def. VAT Bus. Posting Group'] } },
  { t: 'genProd', key: ['code'], m: /gen\.?\s*prod/i, req: ['code'], c: { code: ['Code'], description: ['Description'] } },
  { t: 'invSetup', key: ['location', 'group'], m: /inventory posting setup/i, req: ['group', 'inventory'], c: { location: ['Location Code'], group: ['Invt. Posting Group Code', 'Inventory Posting Group'], inventory: ['Inventory Account'], interim: ['Inventory Account (Interim)'] } },
  { t: 'invPostGroups', key: ['code'], m: /inventory posting group/i, req: ['code'], c: { code: ['Code'], description: ['Description'], inventory: ['Inventory Account'] } },
  { t: 'vendPostGroups', key: ['code'], m: /vendor posting/i, req: ['code', 'payables'], c: { code: ['Code'], payables: ['Payables Account'], description: ['Description'] } },
  { t: 'custPostGroups', key: ['code'], m: /customer posting/i, req: ['code', 'receivables'], c: { code: ['Code'], receivables: ['Receivables Account'], description: ['Description'] } },
  { t: 'empPostGroups', key: ['code'], m: /employee posting/i, req: ['code'], c: { code: ['Code'], payables: ['Payables Account'] } },
  { t: 'bankPostGroups', key: ['code'], m: /bank account posting/i, req: ['code', 'glAccount'], c: { code: ['Code', 'Code No.'], glAccount: ['G/L Account No.', 'G/L Bank Account No.'] } },
  { t: 'bankAccounts', key: ['code'], m: /^bank account(?!.*posting)|^bank$/i, req: ['code', 'name', 'postingGroup'], company: 1, c: { code: ['No.', 'Code No.'], name: ['Name'], bankAccountNo: ['Bank Account No.'], postingGroup: ['Bank Acc. Posting Group'], currency: ['Currency Code'], city: ['City'] } },
  { t: 'vatSetup', key: ['bus', 'prod'], m: /vat posting setup/i, req: ['bus', 'pct'], c: { bus: ['VAT Bus. Posting Group'], prod: ['VAT Prod. Posting Group'], calcType: ['VAT Calculation Type'], pct: ['VAT %'], salesAcc: ['Sales VAT Account'], purchAcc: ['Purchase VAT Account'], reverseAcc: ['Reverse Chrg. VAT Acc.'], identifier: ['VAT Identifier'] } },
  { t: 'vatBus', key: ['code'], m: /vat bus/i, req: ['code'], c: { code: ['Code'], description: ['Description'] } },
  { t: 'vatProd', key: ['code'], m: /vat prod/i, req: ['code'], c: { code: ['Code'], description: ['Description'], pct: ['VAT %'] } },
  { t: 'whtSetup', key: ['bus', 'prod'], m: /wht posting setup/i, req: ['bus', 'prod', 'pct'], c: { bus: ['WHT Business Posting Group'], prod: ['WHT Product Posting Group'], pct: ['WHT Percentage'], realized: ['Realized WHT Type'], whtType: ['WHT Type'], payableAcc: ['Payable WHT Account Code', 'Payable WHT Account Code4'], prepaidAcc: ['Prepaid WHT Account Code', 'Prepaid WHT Account Code3', 'Receivable WHT Account Code'] } },
  { t: 'whtBus', key: ['code'], m: /wht bus/i, req: ['code'], c: { code: ['Code'], description: ['Description'] } },
  { t: 'whtProd', key: ['code'], m: /wht prod|wht pord|^wht$|wht product/i, req: ['code'], c: { code: ['Code', 'Withholding Tax Code'], description: ['Description', 'Withholding Tax Name'] } },
  { t: 'vendors', key: ['no'], m: /vendor|purchas/i, req: ['no', 'name', 'postingGroup'], c: { no: ['No.'], name: ['Name'], address: ['Address'], address2: ['Address 2'], city: ['City'], contact: ['Contact Person', 'Contact'], phone: ['Phone No.'], email: ['Email', 'E-Mail'], tin: ['VAT Registration No.'], postingGroup: ['Vendor Posting Group'], genBus: ['Gen. Bus. Posting Group'], vatBus: ['VAT Bus. Posting Group'], whtBus: ['WHT Bus. Posting Group', 'WHT Business Posting Group'], currency: ['Currency Code'], paymentTerms: ['Payment Terms Code'], paymentMethod: ['Payment Method Code'], pricesInclVat: ['Prices Including VAT'], dim1: ['Global Dimension 1 Code'], dim2: ['Global Dimension 2 Code'] } },
  { t: 'customers', key: ['no'], m: /customer|receivab|sales/i, req: ['no', 'name', 'postingGroup'], c: { no: ['No.'], name: ['Name'], address: ['Address'], address2: ['Address 2'], city: ['City'], contact: ['Contact Person', 'Contact'], phone: ['Phone No.'], email: ['Email', 'E-Mail'], tin: ['VAT Registration No.'], postingGroup: ['Customer Posting Group'], genBus: ['Gen. Bus. Posting Group'], vatBus: ['VAT Bus. Posting Group'], whtBus: ['WHT Business Posting Group', 'WHT Bus. Posting Group'], currency: ['Currency Code'], paymentTerms: ['Payment Terms Code'], paymentMethod: ['Payment Method Code'], pricesInclVat: ['Prices Including VAT'], creditLimit: ['Credit Limit (LCY)'], prepaymentPct: ['Prepayment %'] } },
  { t: 'items', key: ['no'], m: /item|inventor/i, req: ['no', 'description', 'type'], c: { no: ['No.'], description: ['Description'], uom: ['Base Unit of Measure'], type: ['Type'], genProd: ['Gen. Prod. Posting Group', 'Gen Product Posting Group'], invPostGroup: ['Inventory Posting Group'], category: ['Item Category Code'], unitPrice: ['Unit Price'], unitCost: ['Unit Cost'], costingMethod: ['Costing Method'], vatProd: ['VAT Prod. Posting Group'], whtProd: ['WHT Prod. Posting Group', 'WHT Product Posting Group'], tracking: ['Item Tracking Code'], purchUom: ['Purch. Unit of Measure'], salesUom: ['Sales Unit of Measure'] } },
  { t: 'itemCharges', key: ['no'], m: /item charge/i, req: ['no', 'genProd'], c: { no: ['No.'], description: ['Description'], genProd: ['Gen. Prod. Posting Group'], vatProd: ['VAT Prod. Posting Group'], whtProd: ['WHT Product Posting Group', 'WHT Prod. Posting Group'] } },
  { t: 'bins', key: ['location', 'code'], m: /bin/i, req: ['location', 'code'], c: { location: ['Location Code'], code: ['Code'], description: ['Description'], zone: ['Zone Code'] } },
  { t: 'locations', key: ['code'], m: /location/i, req: ['code', 'name'], c: { code: ['Code'], name: ['Name'], address: ['Address'], city: ['City'], inTransit: ['Use As In-Transit'], requireReceive: ['Require Receive'], requireShipment: ['Require Shipment'], requirePutaway: ['Require Put-away'], requirePick: ['Require Pick'], binMandatory: ['Bin Mandatory'], receiptBin: ['Receipt Bin Code'], shipmentBin: ['Shipment Bin Code'], adjustmentBin: ['Adjustment Bin Code'], defaultBin: ['Default Bin Code'] } },
  { t: 'dimValues', key: ['dim', 'code'], m: /dimension value/i, req: ['dim', 'code'], c: { dim: ['Dimension Code'], code: ['Code'], name: ['Name'], type: ['Dimension Value Type'] } },
  { t: 'dimensions', key: ['code'], m: /dimension/i, req: ['code', 'name'], c: { code: ['Code'], name: ['Name'] } },
  { t: 'paymentTerms', key: ['code'], m: /payment terms|terms of payment/i, req: ['code'], c: { code: ['Code'], dueCalc: ['Due Date Calculation'], description: ['Description'] } },
  { t: 'paymentMethods', key: ['code'], m: /payment method/i, req: ['code'], c: { code: ['Code'], description: ['Description'] } },
  { t: 'uom', key: ['code'], m: /unit of measure/i, req: ['code'], c: { code: ['Code'], description: ['Description'] } },
  { t: 'itemCategories', key: ['code'], m: /item category/i, req: ['code'], c: { code: ['Code'], parent: ['Parent Category'], description: ['Description'] } },
  { t: 'currencies', key: ['code'], m: /currenc/i, req: ['code'], c: { code: ['Code'], description: ['Description'], realizedGain: ['Realized Gains Acc.', 'Realized Gain Account'], realizedLoss: ['Realized Losses Acc.', 'Realized Losses Acc'],
    unrealizedGain: ['Unrealized Gains Acc.', 'Unrealized Gain'], unrealizedLoss: ['Unrealized Losses Acc.', 'Unrealized Losses'] } },
  { t: 'noSeriesLines', key: ['series'], m: /series line/i, req: ['series'], c: { series: ['Series Code'], startNo: ['Starting No.'], endNo: ['Ending No.'], lastUsed: ['Last Used No.'] } },
  { t: 'noSeries', key: ['code'], m: /no\.?\s*series$/i, req: ['code'], c: { code: ['Code'], description: ['Description'], manual: ['Manual Nos.'], startNo: ['Starting No.'], endNo: ['Ending No.'] } },
  { t: 'faPostGroups', key: ['code'], m: /fa posting|fixed asset posting/i, req: ['code', 'acqCost'], c: { code: ['Code', 'FA Group Code'], description: ['Description', 'FA Group Name'], acqCost: ['Acquisition Cost Account'], accumDep: ['Accum. Depreciation Account', 'Accum Dep Account'], acqCostDisp: ['Acq. Cost Acc. on Disposal'], accumDepDisp: ['Accum. Depr. Acc. on Disposal'], gains: ['Gains Acc. on Disposal', 'Gain of Disposal Account'], losses: ['Losses Acc. on Disposal', 'Loss of Disposal Account'], maintExp: ['Maintenance Expense Account', 'Maintenance Account'], depExp: ['Depreciation Expense Acc.', 'Depreciation Expense Account'], writeDown: ['Write-Down Account'], writeDownExp: ['Write-Down Expense Acc.'], appreciation: ['Appreciation Account'], appreciationBal: ['Appreciation Bal. Account'] } },
  { t: 'faSubclasses', key: ['code'], m: /subclass/i, req: ['code'], c: { code: ['Code'], name: ['Name'], classCode: ['FA Class Code'], defPostGroup: ['Default FA Posting Group'] } },
  { t: 'faClasses', key: ['code'], m: /fa.?class/i, req: ['code'], c: { code: ['Code'], name: ['Name'] } },
  { t: 'faLocations', key: ['code'], m: /fa.?location/i, req: ['code'], c: { code: ['Code'], name: ['Name'] } },
  { t: 'faDepBooks', key: ['fa'], m: /depreciation book|depn book/i, req: ['fa'], c: { fa: ['FA No.'], book: ['Depreciation Book Code'], method: ['Depreciation Method'], start: ['Depreciation Starting Date'], years: ['No. of Depreciation Years'], months: ['No. of Depreciation Months'], slPct: ['Straight-Line %'], postGroup: ['FA Posting Group'], end: ['Depreciation Ending Date'] } },
  { t: 'fixedAssets', key: ['no'], m: /fixed asset|fa card/i, req: ['no', 'description'], company: 1, c: { no: ['No.'], description: ['Description'], classCode: ['FA Class Code'], subclass: ['FA Subclass Code'], postGroup: ['FA Posting Group'], faLocation: ['FA Location Code'], serialNo: ['Serial No.', 'Serial_No'], responsible: ['Responsible Employee'], mainAsset: ['Main Asset/Component'] } },
  // Only non-sensitive employee fields are imported (no birth dates, SSS numbers, addresses).
  { t: 'employees', key: ['no'], m: /employee$/i, req: ['no', 'firstName'], c: { no: ['No.'], firstName: ['First Name'], lastName: ['Last Name'], jobTitle: ['Job Title'], postingGroup: ['Employee Posting Group'] } },
  { t: 'journalBatches', key: ['template', 'name'], m: /journal batch/i, req: ['template', 'name'], c: { template: ['Journal Template Name'], name: ['Name'], description: ['Description'], balAccType: ['Bal. Account Type'], balAccNo: ['Bal. Account No.'], noSeries: ['No. Series'] } }
];
const BC_SKIP_SHEET = /summary|^sheet\d|revis|utci|zone|^column|warehouse employee|whse employee|ship-to|bank list|maint|insurance|default dimension|relationship|item unit of measure/i;
const BC_DEDUPE = ['items', 'fixedAssets', 'vatSetup']; // same data in two sheets: keep the better sheet only
const normH = s => String(s || '').toLowerCase().replace(/0de\b/g, 'code').replace(/[^a-z0-9%]/g, '');
const MD_TABLES = ['accounts', 'genBus', 'genProd', 'genSetup', 'invPostGroups', 'invSetup', 'vendPostGroups', 'custPostGroups', 'empPostGroups', 'bankPostGroups', 'bankAccounts', 'vatBus', 'vatProd', 'vatSetup', 'whtBus', 'whtProd', 'whtSetup', 'vendors', 'customers', 'items', 'itemCharges', 'locations', 'bins', 'dimensions', 'dimValues', 'paymentTerms', 'paymentMethods', 'uom', 'itemCategories', 'currencies', 'noSeries', 'noSeriesLines', 'faClasses', 'faSubclasses', 'faLocations', 'faPostGroups', 'fixedAssets', 'employees', 'journalBatches'];
function emptyMD(name) { const m = { name: name || '', settings: { globalDim1: '', globalDim2: '', docSeries: {} } }; for (const t of MD_TABLES) m[t] = []; return m; }

function bcValue(field, v) {
  if (v == null) return '';
  v = String(v).trim();
  if (/^(directPosting|pricesInclVat|inTransit|requireReceive|requireShipment|requirePutaway|requirePick|binMandatory|manual)$/.test(field)) return /^(yes|true|1)$/i.test(v);
  if (/^(pct|unitPrice|unitCost|creditLimit|prepaymentPct|years|months|slPct)$/.test(field)) return num(v);
  if (/^(start|end)$/.test(field)) {
    if (/^\d{5}(\.\d+)?$/.test(v)) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+v) * 86400000); return d.toISOString().slice(0, 10); }
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  }
  return v;
}
/** Identify which BC table a sheet holds and return its records */
function parseBcSheet(sheet) {
  if (BC_SKIP_SHEET.test(sheet.name.trim())) return null;
  const tableName = (sheet.rows[0] || [])[1] || '';
  let best = null;
  for (const spec of BC_TABLES) {
    const nameHit = spec.m.test(sheet.name.trim()) || spec.m.test(tableName);
    if (!nameHit) continue;
    for (let h = 0; h < Math.min(10, sheet.rows.length); h++) {
      const hdr = sheet.rows[h].map(normH);
      const idx = {};
      for (const [f, al] of Object.entries(spec.c)) { for (const a of al) { const i = hdr.indexOf(normH(a)); if (i >= 0) { idx[f] = i; break; } } }
      if (!spec.req.every(f => f in idx)) continue;
      const score = Object.keys(idx).length;
      if (!best || score > best.score) best = { spec, h, idx, score };
    }
    if (best && best.spec === spec) break; // first spec (in priority order) that matches wins
  }
  if (!best) return null;
  const { spec, h, idx } = best, out = [];
  for (const row of sheet.rows.slice(h + 1)) {
    const o = {};
    for (const [f, i] of Object.entries(idx)) o[f] = bcValue(f, row[i]);
    const k0 = o[spec.req[0]];
    if (!k0 || /^(mandatory|optional)/i.test(String(k0))) continue;
    if (spec.t === 'locations' && /^\d+$/.test(o.code)) continue;
    out.push(o);
  }
  return { table: spec.t, spec, rows: out };
}
function rankSheet(name) { return /production|final/i.test(name) ? 2 : /internal|\(2\)/i.test(name) ? 0 : 1; }

/** Merge parsed tables into a master data set */
function mergeIntoSet(md, parsedList, company) {
  const counts = {};
  for (const p of parsedList) {
    const coll = md[p.table] || (md[p.table] = []);
    const keyOf = r => p.spec.key.map(k => String(r[k] || '').toUpperCase()).join('|');
    const map = new Map(coll.map((r, i) => [keyOf(r), i]));
    for (const r of p.rows) {
      if (p.spec.company) r.company = company;
      const k = keyOf(r);
      if (map.has(k)) Object.assign(coll[map.get(k)], Object.fromEntries(Object.entries(r).filter(([, v]) => v !== '')));
      else { map.set(k, coll.length); coll.push(r); }
    }
    counts[p.table] = (counts[p.table] || 0) + p.rows.length;
  }
  return counts;
}
function finalizeSet(md) {
  const typeMap = { posting: 'Posting', heading: 'Heading', total: 'Total', begintotal: 'Begin-Total', endtotal: 'End-Total' };
  for (const a of md.accounts) {
    a.type = typeMap[normH(a.type)] || a.type || 'Posting';
    if (a.directPosting === '') a.directPosting = true;
    if (!a.incomeBalance) a.incomeBalance = /^[123]/.test(a.no) ? 'Balance Sheet' : 'Income Statement';
  }
  for (const i of md.items) {
    i.type = /service/i.test(i.type) ? 'Service' : /non/i.test(i.type) ? 'Non-Inventory' : 'Inventory';
    if (!i.genProd) i.genProd = i.invPostGroup || '';
    if (!i.status) i.status = 'Approved';
  }
  for (const v of md.vendors.concat(md.customers)) { if (!v.status) v.status = 'Approved'; }
  for (const t of md.paymentTerms) t.days = num((String(t.dueCalc || t.code).match(/\d+/) || [0])[0]);
  // Some packages have the WHT Bus./Prod. sheet titles swapped: detect it from what vendors and the setup actually use
  const inSet = (arr, v) => arr.some(x => U(x.code) === U(v));
  const busUsed = [...new Set(md.vendors.concat(md.customers).map(v => v.whtBus).filter(Boolean)).values()];
  if (busUsed.length && busUsed.filter(b => inSet(md.whtProd, b)).length > busUsed.filter(b => inSet(md.whtBus, b)).length) {
    [md.whtBus, md.whtProd] = [md.whtProd, md.whtBus];
    md.importNotes = (md.importNotes || []).concat('WHT Bus. and WHT Prod. Posting Group sheets were swapped in the package; corrected automatically.');
  }
  for (const s of md.whtSetup) if (!s.realized) s.realized = /^c/i.test(s.bus) ? 'Payment' : 'Invoice';
  // No. Series that carry their numbers on the header (no separate No. Series Line sheet)
  for (const s of md.noSeries) if ((s.startNo || s.lastUsed) && !md.noSeriesLines.some(l => l.series === s.code)) md.noSeriesLines.push({ series: s.code, startNo: s.startNo || '', endNo: s.endNo || '', lastUsed: '' });
  // fixed assets: merge depreciation book info
  const dep = new Map((md.faDepBooks || []).map(b => [String(b.fa).toUpperCase(), b]));
  for (const f of md.fixedAssets) {
    const b = dep.get(String(f.no).toUpperCase()) || {};
    f.depMethod = b.method || f.depMethod || 'Straight-line';
    f.depStart = b.start || f.depStart || '';
    f.depMonths = num(b.years) * 12 + num(b.months) || f.depMonths || 0;
    if (!f.postGroup) f.postGroup = b.postGroup || ((md.faSubclasses.find(s => s.code === f.subclass) || {}).defPostGroup) || '';
    if (!f.status) f.status = 'Active';
  }
  md.faDepBooks = [];
  // Global dimensions: prefer DEPT as dimension 2, first other as dimension 1 (editable in Setup)
  const dims = md.dimensions.map(d => d.code);
  if (!md.settings.globalDim1) md.settings.globalDim1 = dims.find(d => d !== 'DEPT') || dims[0] || '';
  if (!md.settings.globalDim2) md.settings.globalDim2 = dims.includes('DEPT') ? 'DEPT' : dims.find(d => d !== md.settings.globalDim1) || '';
  // In-transit location for transfers
  if (!md.locations.some(l => l.inTransit)) md.locations.push({ code: 'IN-TRANSIT', name: 'In Transit', inTransit: true });
  autoMapSeries(md);
  return md;
}
/** Guess which number series each document type uses, from the series descriptions */
function autoMapSeries(md) {
  const want = { PR: /requisition|purchase request/i, PQ: /purchase quote/i, PO: /purchase order/i, RR: /posted (purchase )?receipt|purch.*receipt/i, PI: /^purchase invoice/i,
    PRET: /purchase credit memo|purchase return/i, PAY: /payment journal/i, SI: /^sales invoice/i, SCM: /sales credit memo/i, CR: /cash receipt/i, TO: /transfer order/i,
    IJ: /item journal/i, PC: /physical inventory/i, GJ: /general journal/i,
    WR: /^(whse\.?|warehouse) receipt/i, PA: /^(whse\.?|warehouse) put.?away/i, WS: /^(whse\.?|warehouse) ship/i, PK: /^(whse\.?|warehouse) pick/i, RJ: /^item reclass\.? journal$/i,
    FT: /transfer of fund|fund transfer/i, BREC: /bank (acc(ount)?\.? )?rec/i, SO: /^sales order/i };
  const usable = s => md.noSeriesLines.some(l => l.series === s.code && (l.startNo || l.lastUsed));
  for (const [t, re] of Object.entries(want)) {
    if (md.settings.docSeries[t]) continue;
    const s = md.noSeries.find(x => re.test(x.description || '') && usable(x)) || md.noSeries.find(x => re.test(x.code || '') && usable(x));
    if (s) md.settings.docSeries[t] = s.code;
  }
}

/* ---------- Import page ---------- */
route('bcimport', () => {
  const sets = Object.entries(DB.md);
  return pageHead('Import Master Data (Configuration Packages)', 'Load masters and setup from configuration-package Excel files (chart of accounts, posting groups, VAT/WHT, vendors, customers, items, locations, bins, dimensions, number series, fixed assets, journal batches). Existing records with the same code are updated.') +
    (isAdmin() ? `<div class="card"><div class="form-grid">
      ${fieldHtml({ k: 'set', l: 'Master Data Set (one per business unit)', t: 'select', opts: sets.map(([k, v]) => [k, `${k} – ${v.name}`]), noBlank: 1 }, MDS(), 'imp')}
      ${fieldHtml({ k: 'company', l: 'Company for bank accounts & fixed assets', t: 'ref', ref: 'companies' }, S.company, 'imp')}
      <label class="fld w2"><span>Excel files (.xlsx) – you can select many at once</span><input type="file" id="imp_files" accept=".xlsx" multiple></label></div>
      <button class="btn primary" onclick="runBcImport()">Import</button><div id="imp_out"></div></div>` : '<div class="card">Only System Admin can import.</div>') +
    `<div class="card"><h3>Master Data Sets</h3><table class="grid compact"><thead><tr><th>Set</th><th>Used by companies</th>${['accounts', 'vendors', 'customers', 'items', 'locations', 'fixedAssets', 'genSetup', 'vatSetup', 'whtSetup'].map(t => `<th class="num">${t}</th>`).join('')}</tr></thead><tbody>
    ${sets.map(([k, m]) => `<tr><td>${esc(k)} – ${esc(m.name)}</td><td>${esc(DB.companies.filter(c => c.md === k).map(c => c.code).join(', '))}</td>${['accounts', 'vendors', 'customers', 'items', 'locations', 'fixedAssets', 'genSetup', 'vatSetup', 'whtSetup'].map(t => `<td class="num">${m[t].length}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
});
async function importBcFiles(files, setCode, company, log) {
  const md = DB.md[setCode];
  const all = [];
  for (const f of files) {
    let sheets;
    try { sheets = await readXlsx(f.buffer); } catch (e) { log.push([f.name, '', 'ERROR: ' + e.message, 0]); continue; }
    const perTable = {};
    for (const sh of sheets) {
      const p = parseBcSheet(sh);
      if (!p) { log.push([f.name, sh.name, '(skipped)', 0]); continue; }
      if (!BC_DEDUPE.includes(p.table)) { all.push(p); log.push([f.name, sh.name, p.table, p.rows.length]); continue; }
      const prev = perTable[p.table];
      const better = !prev || rankSheet(sh.name) > rankSheet(prev.sheet) || (rankSheet(sh.name) === rankSheet(prev.sheet) && p.rows.length > prev.p.rows.length);
      const loser = better ? prev : { p, sheet: sh.name };
      if (better) perTable[p.table] = { p, sheet: sh.name };
      if (loser) log.push([f.name, loser.sheet, `${p.table} (duplicate sheet, not used)`, loser.p.rows.length]);
    }
    for (const { p, sheet } of Object.values(perTable)) { all.push(p); log.push([f.name, sheet, p.table, p.rows.length]); }
  }
  // order: setup tables before masters so they merge cleanly
  mergeIntoSet(md, all, company);
  finalizeSet(md);
}
async function runBcImport() {
  const files = [...$('#imp_files').files]; if (!files.length) return toast('Choose the Excel files first.', 'err');
  const setCode = $('#imp_set').value, company = $('#imp_company').value;
  $('#imp_out').innerHTML = '<p>Reading files…</p>';
  const log = [];
  const bufs = await Promise.all(files.map(async f => ({ name: f.name, buffer: await f.arrayBuffer() })));
  const ok = await commitAsync(() => importBcFiles(bufs, setCode, company, log), `Imported configuration packages into ${setCode}`, '', { md: true });
  $('#imp_out').innerHTML = (ok !== false ? '<p class="good">✔ Import finished and saved.</p>' : '') + `<table class="grid compact"><thead><tr><th>File</th><th>Sheet</th><th>Loaded as</th><th class="num">Rows</th></tr></thead><tbody>${log.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td class="num">${r[3]}</td></tr>`).join('')}</tbody></table>`;
}
