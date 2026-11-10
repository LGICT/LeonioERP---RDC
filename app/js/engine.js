'use strict';
/* ============ Posting engine – follows Business Central posting-group logic ============
   G/L accounts are never stored on items/vendors/customers. They are found through:
   General Posting Setup (Gen. Bus. × Gen. Prod.), Inventory Posting Setup, Vendor/Customer/Bank/FA Posting Groups,
   VAT Posting Setup (VAT Bus. × VAT Prod.) and WHT Posting Setup (WHT Bus. × WHT Prod.). */

function checkPeriod(date) {
  const s = DB.settings;
  if (!date) fail('Please set the Posting Date.');
  if ((s.postingFrom && date < s.postingFrom) || (s.postingTo && date > s.postingTo))
    fail(`Posting Date ${date} is not within your range of allowed posting dates (${s.postingFrom} to ${s.postingTo}). Change it in Administration → Settings.`);
}

/* ---------- Setup lookups (errors read like BC's) ---------- */
const U = s => String(s || '').toUpperCase();
function genSetupRow(co, bus, prod) {
  return M(co).genSetup.find(r => U(r.bus) === U(bus) && U(r.prod) === U(prod));
}
function gpAcc(co, bus, prod, field, label) {
  const r = genSetupRow(co, bus, prod);
  if (!r) fail(`The General Posting Setup does not exist. Gen. Bus. Posting Group: '${bus || ''}', Gen. Prod. Posting Group: '${prod || ''}'. Add it under Posting Setup → General Posting Setup.`);
  if (!r[field]) fail(`${label} is missing in General Posting Setup '${bus || '(blank)'}' / '${prod}'.`);
  return r[field];
}
function invAccount(co, location, group) {
  const m = M(co);
  if (!group) fail('The item has no Inventory Posting Group.');
  const r = m.invSetup.find(x => U(x.group) === U(group) && U(x.location) === U(location)) || m.invSetup.find(x => U(x.group) === U(group) && !x.location);
  const acc = (r && r.inventory) || (m.invPostGroups.find(g => U(g.code) === U(group)) || {}).inventory;
  if (!acc) fail(`The Inventory Posting Setup does not exist. Location: '${location || ''}', Invt. Posting Group: '${group}'.`);
  return acc;
}
function vatRow(co, bus, prod) { return M(co).vatSetup.find(r => U(r.bus) === U(bus) && U(r.prod) === U(prod)); }
function whtRow(co, bus, prod) { return M(co).whtSetup.find(r => U(r.bus) === U(bus) && U(r.prod) === U(prod)); }
function vendorPayables(co, v) {
  const pg = M(co).vendPostGroups.find(g => U(g.code) === U(v.postingGroup));
  if (!pg || !pg.payables) fail(`Payables Account is missing in Vendor Posting Group '${v.postingGroup || ''}' (vendor ${v.no}).`);
  return pg.payables;
}
function customerReceivables(co, c) {
  const pg = M(co).custPostGroups.find(g => U(g.code) === U(c.postingGroup));
  if (!pg || !pg.receivables) fail(`Receivables Account is missing in Customer Posting Group '${c.postingGroup || ''}' (customer ${c.no}).`);
  return pg.receivables;
}
function bankGL(co, code) {
  const b = M(co).bankAccounts.find(x => x.code === code); if (!b) fail(`Bank Account ${code} does not exist.`);
  const pg = M(co).bankPostGroups.find(g => U(g.code) === U(b.postingGroup));
  if (!pg || !pg.glAccount) fail(`G/L Account No. is missing in Bank Account Posting Group '${b.postingGroup || ''}'.`);
  return pg.glAccount;
}
function faPG(co, fa) {
  const pg = M(co).faPostGroups.find(g => U(g.code) === U(fa.postGroup));
  if (!pg) fail(`FA Posting Group '${fa.postGroup || ''}' does not exist (fixed asset ${fa.no}).`);
  return pg;
}

/** Post a balanced entry to the General Ledger (dimensions travel with each line) */
function postGL(doc, lines, partyKind, party) {
  checkPeriod(doc.date);
  const m = M(doc.company), L = [];
  for (const l of lines) {
    let d = r2(l.debit), c = r2(l.credit);
    if (d < 0) { c += -d; d = 0; }
    if (c < 0) { d += -c; c = 0; }
    if (!d && !c) continue;
    const a = m.accounts.find(x => x.no === l.account);
    if (!a) fail(`G/L Account '${l.account || '(blank)'}' does not exist in the ${MDS(doc.company)} chart of accounts. Check the posting setup.`);
    if (a.type !== 'Posting') fail(`G/L Account ${a.no} ${a.name} is a ${a.type} account; you can only post to Posting accounts.`);
    if (a.blocked) fail(`G/L Account ${a.no} ${a.name} is blocked.`);
    L.push({ ...l, debit: r2(d), credit: r2(c) });
  }
  const dr = r2(sum(L, 'debit')), cr = r2(sum(L, 'credit'));
  if (Math.abs(dr - cr) > 0.009) fail(`The transaction cannot be completed because it will cause inconsistencies in the G/L Entry table (debit ${money(dr)} vs credit ${money(cr)}).`);
  if (!L.length) fail('There is nothing to post.');
  for (const l of L) DB.gl.push({
    id: uid(), date: doc.date, company: doc.company, account: l.account, debit: l.debit, credit: l.credit,
    desc: l.desc || doc.remarks || doc.purpose || '', dims: { ...(doc.dims || {}), ...(l.dims || {}) }, asset: l.asset || '',
    docType: doc.type, docNo: doc.no, partyKind: partyKind || '', party: party || ''
  });
}

/* ---------- Inventory: item ledger with actual and expected cost (BC value entries) ---------- */
const ilFor = (co, item, loc) => DB.itemLedger.filter(e => e.company === co && e.item === item && (!loc || e.location === loc));
function onHand(co, item, loc) { return r4(sum(ilFor(co, item, loc), 'qty')); }
function avgCost(co, item) {
  const es = ilFor(co, item), q = sum(es, 'qty');
  return q > 0.0001 ? r4((sum(es, 'value') + sum(es, e => e.exp || 0)) / q) : num((itemOf(item, co) || {}).unitCost);
}
/** Cost leaving stock at moving average, split into actual (invoiced) and expected (received, not invoiced) */
/** Cost leaving stock in a transaction that posts to the G/L (sale, negative adjustment, count): the full cost is booked,
    so COGS is right even before the purchase invoice arrives; the later invoice clears the expected cost. */
function costOutPosted(co, item, qty) { const o = costOut(co, item, qty); return { value: r2(o.value + o.exp), exp: 0 }; }
function costOut(co, item, qty) {
  const es = ilFor(co, item), q = sum(es, 'qty');
  if (q <= 0.0001) { const c = num((itemOf(item, co) || {}).unitCost); return { value: r2(c * qty), exp: 0 }; }
  return { value: r2(sum(es, 'value') / q * qty), exp: r2(sum(es, e => e.exp || 0) / q * qty) };
}
/* ---------- Bins & warehouse entries (bin content = item ledger by bin + warehouse movements) ---------- */
const locOf = (co, code) => M(co).locations.find(l => l.code === code);
const binExists = (co, loc, bin) => M(co).bins.some(b => b.location === loc && U(b.code) === U(bin));
function binQty(co, loc, bin, item) {
  return r4(sum(DB.itemLedger.filter(e => e.company === co && e.location === loc && e.item === item && U(e.bin) === U(bin)), 'qty') +
    sum((DB.whseEntries || []).filter(e => e.company === co && e.location === loc && e.item === item && U(e.bin) === U(bin)), 'qty'));
}
function binContents(co, loc) {
  const by = new Map();
  const add = e => { if (loc && e.location !== loc) return; const k = e.location + '|' + U(e.bin) + '|' + e.item; by.set(k, r4((by.get(k) || 0) + num(e.qty))); };
  DB.itemLedger.filter(e => e.company === co && e.bin).forEach(add);
  (DB.whseEntries || []).filter(e => e.company === co).forEach(add);
  return [...by.entries()].filter(([, q]) => Math.abs(q) > 0.0001).map(([k, q]) => { const [location, bin, item] = k.split('|'); return { location, bin, item, qty: q }; });
}
/** Move quantity between bins of one location (put-away, pick, bin-to-bin): warehouse entries only, no value change */
function whseMove(doc, item, location, fromBin, toBin, qty) {
  if (!binExists(doc.company, location, fromBin)) fail(`Bin ${fromBin} does not exist at ${location}.`);
  if (!binExists(doc.company, location, toBin)) fail(`Bin ${toBin} does not exist at ${location}.`);
  if (U(fromBin) === U(toBin)) fail(`Take and Place bin are the same (${fromBin}) for item ${item}.`);
  const avail = binQty(doc.company, location, fromBin, item);
  if (avail - qty < -0.0001) fail(`Bin ${fromBin} contains only ${qtyf(avail)} of item ${item}; ${qtyf(qty)} is needed.`);
  if (!DB.whseEntries) DB.whseEntries = [];
  const base = { company: doc.company, date: doc.date || today(), location, item, docType: doc.type, docNo: doc.no };
  DB.whseEntries.push({ id: uid(), ...base, bin: fromBin, qty: -r4(qty), entryType: 'Movement (Take)' }, { id: uid(), ...base, bin: toBin, qty: r4(qty), entryType: 'Movement (Place)' });
}
const needsWhse = (co, loc, kind) => !!(locOf(co, loc) || {})[kind];
function postItem(doc, itemNo, location, qty, value, exp, entryType, bin) {
  const it = itemOf(itemNo, doc.company);
  if (!it) fail(`Item ${itemNo} does not exist.`);
  if (it.type !== 'Inventory') return;
  if (!location) fail(`Location Code must have a value for item ${itemNo}.`);
  const loc = locOf(doc.company, location);
  if (loc && loc.binMandatory && qty !== 0) {
    if (!bin) bin = (qty > 0 ? loc.receiptBin || loc.adjustmentBin : loc.shipmentBin || loc.adjustmentBin) || loc.defaultBin || '';
    if (!bin) fail(`Bin Code must have a value for item ${itemNo} at location ${location} (Bin Mandatory is on).`);
    if (!binExists(doc.company, location, bin)) fail(`Bin ${bin} does not exist at location ${location}.`);
    if (qty < 0) { const bq = binQty(doc.company, location, bin, itemNo); if (bq + qty < -0.0001) fail(`Bin ${bin} at ${location} contains only ${qtyf(bq)} of item ${itemNo}; ${qtyf(-qty)} is needed.`); }
  } else bin = '';
  if (qty < 0) {
    const oh = onHand(doc.company, itemNo, location);
    if (oh + qty < -0.0001) fail(`You have insufficient quantity of Item ${itemNo} (${it.description}) on inventory at ${location}: on hand ${qtyf(oh)}, needed ${qtyf(-qty)}.`);
  }
  DB.itemLedger.push({ id: uid(), date: doc.date, company: doc.company, item: itemNo, location, bin: bin || '', qty: r4(qty), value: r2(value), exp: r2(exp || 0), entryType, docType: doc.type, docNo: doc.no });
}

/* ---------- Line logic (purchase & sales documents) ---------- */
const SALES_DOCS = ['SI', 'SCM'];
const partyKindOf = d => SALES_DOCS.includes(d.type) || d.type === 'CR' ? 'customer' : 'vendor';
function lineDefaults(d, l) {
  const co = d.company;
  if (l.type === 'Item') { const it = itemOf(l.no, co); if (it) Object.assign(l, { description: it.description, uom: it.uom, genProd: it.genProd, vatProd: it.vatProd, whtProd: it.whtProd, unitCost: num(it.unitCost) || num(l.unitCost), price: num(it.unitPrice) }); }
  else if (l.type === 'G/L Account') { const a = accOf(l.no, co); if (a) Object.assign(l, { description: a.name, uom: '', genProd: a.genProd, vatProd: a.vatProd, whtProd: a.whtProd }); }
  else if (l.type === 'Fixed Asset') { const f = faOf(l.no, co); if (f) { const pg = M(co).faPostGroups.find(g => g.code === f.postGroup) || {}; const a = accOf(pg.acqCost, co) || {}; Object.assign(l, { description: f.description, uom: 'UNIT', genProd: a.genProd || '', vatProd: a.vatProd || '', whtProd: a.whtProd || '' }); } }
  else if (l.type === 'Charge (Item)') { const c = M(co).itemCharges.find(x => x.no === l.no); if (c) Object.assign(l, { description: c.description, uom: '', genProd: c.genProd, vatProd: c.vatProd, whtProd: c.whtProd }); }
}
function lineAmount(d, l) { return r2(num(l.qty) * num(SALES_DOCS.includes(d.type) ? l.price : l.unitCost)); }
/** VAT and withholding tax for one line, from VAT/WHT Posting Setup */
function lineCalc(d, l) {
  const amt = lineAmount(d, l);
  const vs = d.vatBus ? vatRow(d.company, d.vatBus, l.vatProd) : null;
  const pct = vs && !/reverse/i.test(vs.calcType || '') ? num(vs.pct) : 0;
  let base, vat;
  if (d.pricesInclVat) { base = r2(amt / (1 + pct / 100)); vat = r2(amt - base); } else { base = amt; vat = r2(base * pct / 100); }
  let wht = 0, ws = null;
  if (!SALES_DOCS.includes(d.type) && d.whtBus && l.whtProd) {
    ws = whtRow(d.company, d.whtBus, l.whtProd);
    if (ws && !/payment/i.test(ws.realized || '')) wht = r2(base * num(ws.pct) / 100);
  }
  return { amt, base, vat, pct, vs, wht, ws };
}
/** The G/L account a line will hit (used for budget checks and approval routing) */
function lineAccount(d, l) {
  try {
    if (!l.no) return '';
    const co = d.company, sales = SALES_DOCS.includes(d.type);
    if (l.type === 'G/L Account') return l.no;
    if (l.type === 'Fixed Asset') return faPG(co, faOf(l.no, co)).acqCost;
    if (l.type === 'Charge (Item)') return gpAcc(co, d.genBus, l.genProd, 'purch', 'Purch. Account');
    const it = itemOf(l.no, co); if (!it) return '';
    if (sales) return gpAcc(co, d.genBus, l.genProd, 'sales', 'Sales Account');
    return it.type === 'Inventory' ? invAccount(co, d.location, it.invPostGroup) : gpAcc(co, d.genBus, l.genProd, 'purch', 'Purch. Account');
  } catch (e) { return ''; }
}
/** Check every setup a document needs before it is sent for approval (BC would fail at posting) */
function checkSetup(d) {
  const co = d.company;
  if (!['purchase', 'sales'].includes((DOCS[d.type] || {}).lines) || d.type === 'PR') return;
  if (!d.vatBus) fail('VAT Bus. Posting Group must have a value (taken from the vendor/customer card).');
  if (!d.genBus) fail('Gen. Bus. Posting Group must have a value (taken from the vendor/customer card).');
  for (const l of d.lines) {
    if (!l.vatProd) fail(`VAT Prod. Posting Group must have a value on line ${l.no}.`);
    if (!vatRow(co, d.vatBus, l.vatProd)) fail(`The VAT Posting Setup does not exist. VAT Bus. Posting Group: '${d.vatBus}', VAT Prod. Posting Group: '${l.vatProd}'.`);
    if (d.whtBus && l.whtProd && !whtRow(co, d.whtBus, l.whtProd)) fail(`The WHT Posting Setup does not exist. WHT Bus.: '${d.whtBus}', WHT Prod.: '${l.whtProd}'.`);
    if (['PR', 'PQ', 'PO'].includes(d.type)) continue;
    const it = l.type === 'Item' ? itemOf(l.no, co) : null;
    if (SALES_DOCS.includes(d.type)) {
      if (l.type === 'Item') gpAcc(co, d.genBus, l.genProd, 'sales', 'Sales Account');
      if (it && it.type === 'Inventory') { gpAcc(co, d.genBus, l.genProd, 'cogs', 'COGS Account'); invAccount(co, d.location, it.invPostGroup); }
    } else {
      if (it && it.type === 'Inventory') invAccount(co, d.location, it.invPostGroup);
      else if (l.type === 'Item' || (l.type === 'Charge (Item)' && !l.chargeItem)) gpAcc(co, d.genBus, l.genProd, 'purch', 'Purch. Account');
      if (l.type === 'Fixed Asset') faPG(co, faOf(l.no, co));
    }
  }
}

/* ---------- Budget check (optional, Settings → Budget Control) ---------- */
function budgetCheck(d) {
  if (!DB.settings.budgetControl || !['PR', 'PQ', 'PO', 'PI'].includes(d.type)) return null;
  const yr = (d.date || today()).slice(0, 4), by = {};
  const fxr = (() => { try { return docRate(d); } catch (e) { return 1; } })();
  for (const l of d.lines || []) { const a = lineAccount(d, l); if (a) by[a] = (by[a] || 0) + lineCalc(d, l).base * fxr; }
  const rows = Object.entries(by).map(([account, amount]) => {
    const budget = sum(DB.budgets.filter(b => b.company === d.company && String(b.year) === yr && b.account === account), 'amount');
    const actual = r2(sum(DB.gl.filter(g => g.company === d.company && g.account === account && g.date.slice(0, 4) === yr && g.docNo !== d.no), g => g.debit - g.credit));
    const available = r2(budget - actual);
    return { account, amount: r2(amount), budget, actual, available, ok: budget > 0 && amount <= available + 0.001 };
  });
  return { ok: rows.length > 0 && rows.every(r => r.ok), rows };
}

/* ---------- Approvals ---------- */
const GA_RE = /^(ADM|G&A|GA|OPEX-ADM)/i;
function approvalContext(d) {
  const lines = d.lines || [];
  const accts = lines.map(l => lineAccount(d, l)).filter(Boolean);
  const isGa = l => GA_RE.test(l.genProd || '');
  const bc = budgetCheck(d);
  return {
    amount: d._isMaster ? 0 : docTotals(d).total * (() => { try { return docRate(d); } catch (e) { return 1; } })(),
    ga: lines.some(isGa), notGa: !lines.length || lines.some(l => !isGa(l)),
    capex: lines.some(l => l.type === 'Fixed Asset'),
    intlTravel: lines.some(l => /travel/i.test(l.description || '') && /int|foreign|abroad/i.test(l.description || '')),
    within: bc ? bc.ok : true, accts
  };
}
function condMet(rule, ctx) {
  switch (rule.cond) {
    case 'always': return true;
    case 'withinBudget': return ctx.within;
    case 'outsideBudget': return !ctx.within;
    case 'ga': return ctx.ga;
    case 'notGa': return ctx.notGa;
    case 'capex': return ctx.capex;
    case 'intlTravel': return ctx.intlTravel;
    case 'capexOrOutside': return ctx.capex || ctx.intlTravel || !ctx.within;
    case 'amountGte': return ctx.amount >= num(rule.amount);
    default: return true;
  }
}
function buildChain(ruleType, obj) {
  const ctx = approvalContext(obj);
  return DB.approvalRules.filter(r => r.docType === ruleType).sort((a, b) => a.seq - b.seq).filter(r => condMet(r, ctx)).map(r => ({ role: r.role, status: 'Pending' }));
}
function submitForApproval(obj, ruleType) {
  obj.approvals = buildChain(ruleType, obj);
  obj.submittedBy = curUser().id; obj.submittedAt = new Date().toISOString();
  obj.status = obj.approvals.length ? 'Pending Approval' : 'Approved';
}
const pendingStep = o => o.status === 'Pending Approval' ? (o.approvals || []).find(a => a.status === 'Pending') : null;
function canApprove(o) { const st = pendingStep(o); return !!st && hasRole(st.role) && o.createdBy !== curUser().id; }
function whyCannotApprove(o) {
  const st = pendingStep(o); if (!st) return '';
  if (!hasRole(st.role)) return `Waiting for: ${st.role}. Switch to a user with this role (top right) to approve.`;
  if (o.createdBy === curUser().id) return 'You created this record, so you cannot approve it (segregation of duties).';
  return '';
}
function approveStep(o, comment) {
  const st = pendingStep(o); if (!st) fail('Nothing to approve.');
  if (!canApprove(o)) fail(whyCannotApprove(o));
  Object.assign(st, { status: 'Approved', by: curUser().name, byId: curUser().id, at: new Date().toISOString(), comment: comment || '' });
  if (!pendingStep(o)) { o.status = 'Approved'; o.approvedAt = new Date().toISOString(); }
}
function rejectStep(o, comment) {
  const st = pendingStep(o); if (!st) fail('Nothing to reject.');
  if (!canApprove(o)) fail(whyCannotApprove(o));
  if (!comment) fail('Please give a reason for rejecting.');
  Object.assign(st, { status: 'Rejected', by: curUser().name, byId: curUser().id, at: new Date().toISOString(), comment });
  o.status = 'Rejected';
}
function approvalPanel(o) {
  const ap = o.approvals || []; if (!ap.length) return '';
  return `<div class="card"><h3>Approval Entries</h3><table class="grid compact"><thead><tr><th>#</th><th>Approver role</th><th>Status</th><th>By</th><th>Date</th><th>Comment</th></tr></thead><tbody>
    ${ap.map((a, i) => `<tr><td>${i + 1}</td><td>${esc(a.role)}</td><td>${badge(a.status)}</td><td>${esc(a.by || '')}</td><td>${a.at ? esc(a.at.slice(0, 16).replace('T', ' ')) : ''}</td><td>${esc(a.comment || '')}</td></tr>`).join('')}
    </tbody></table>${o.status === 'Pending Approval' && !canApprove(o) ? `<p class="muted small">${esc(whyCannotApprove(o))}</p>` : ''}</div>`;
}

/* ---------- Posting routines ---------- */
function postReceipt(po, rr) {
  for (const l of rr.lines) {
    const it = l.type === 'Item' ? itemOf(l.no, rr.company) : null;
    if (it && it.type === 'Inventory' && !rr.fromWhse && needsWhse(rr.company, rr.location, 'requireReceive'))
      fail(`Warehouse handling is required for location ${rr.location}: use "Create Whse. Receipt" for item ${l.no}.`);
    // Like BC without "Expected Cost Posting to G/L": the receipt updates quantity and expected cost only, no G/L entry.
    if (it && it.type === 'Inventory') postItem(rr, l.no, rr.location, l.qty, 0, r2(l.qty * l.unitCost), 'Purchase Receipt', l.bin);
    const pl = po.lines[l.poLine]; pl.qtyReceived = r4(num(pl.qtyReceived) + l.qty);
  }
  po.status = po.lines.every(pl => num(pl.qtyReceived) >= num(pl.qty) - 0.0001) ? 'Received' : 'Partially Received';
}

/* ---------- Foreign currency (BC: Currency Code + Currency Factor on documents; ledger entries keep the currency) ----------
   Document amounts are in the document currency; the G/L and item values are in PHP (LCY).
   Customer/vendor ledger entries keep the currency amount plus the rate they are carried at (adjRate),
   which Adjust Exchange Rates updates (unrealized) and applications settle (realized gain/loss). */
const LCY = 'PHP';
const isFCY = c => !!c && U(c) !== LCY;
function rateAt(currency, date) {
  if (!isFCY(currency)) return 1;
  const rs = (DB.fxRates || []).filter(r => U(r.currency) === U(currency) && r.date <= date).sort((a, b) => b.date.localeCompare(a.date));
  if (!rs.length) fail(`There is no Currency Exchange Rate for ${currency} on or before ${date}. Add it under Finance → Currency Exchange Rates.`);
  return num(rs[0].rate);
}
const docRate = d => isFCY(d.currency) ? (num(d.exchRate) || rateAt(d.currency, d.date)) : 1;
const entryRate = e => num(e.adjRate || e.rate || 1);
const remLCY = e => r2(num(e.remaining) * entryRate(e));
function curAcc(co, currency, kind, label) {
  const c = M(co).currencies.find(x => U(x.code) === U(currency));
  if (!c || !c[kind]) fail(`${label} is missing for currency ${currency} (Finance → Currencies).`);
  return c[kind];
}
/** Exchange difference: positive = loss for us. Posts to the currency's realized (or unrealized) gain/loss account. */
function fxLine(co, currency, lossAmt, realized, desc) {
  if (Math.abs(lossAmt) < 0.005) return null;
  return lossAmt > 0 ? { account: curAcc(co, currency, realized ? 'realizedLoss' : 'unrealizedLoss', realized ? 'Realized Losses Acc.' : 'Unrealized Losses Acc.'), debit: r2(lossAmt), desc }
    : { account: curAcc(co, currency, realized ? 'realizedGain' : 'unrealizedGain', realized ? 'Realized Gains Acc.' : 'Unrealized Gains Acc.'), credit: r2(-lossAmt), desc };
}

function postPurchase(d, isCredit) {
  const co = d.company, v = vendorOf(d.vendor, co); if (!v) fail(`Vendor ${d.vendor} does not exist.`);
  const sign = isCredit ? -1 : 1, gl = [], t = docTotals(d), R = docRate(d);
  let totLCY = 0;
  const D = (account, amt, extra = {}) => gl.push({ account, debit: sign > 0 ? amt : 0, credit: sign < 0 ? amt : 0, ...extra });
  const C = (account, amt, extra = {}) => gl.push({ account, debit: sign < 0 ? amt : 0, credit: sign > 0 ? amt : 0, ...extra });
  for (const l of d.lines) {
    const c = lineCalc(d, l), base = r2(c.base * R), vat = r2(c.vat * R), wht = r2(c.wht * R);
    totLCY += base + vat - wht;
    if (l.type === 'Item') {
      const it = itemOf(l.no, co); if (!it) fail(`Item ${l.no} does not exist.`);
      if (it.type === 'Inventory') {
        const acc = invAccount(co, d.location, it.invPostGroup);
        if (isCredit) postItem(d, l.no, d.location, -num(l.qty), -base, 0, 'Purchase Return', l.bin);
        else if (l.received) DB.itemLedger.push({ id: uid(), date: d.date, company: co, item: l.no, location: d.location, bin: '', qty: 0, value: base, exp: -r2(num(l.qty) * num(l.rcvUnitCost)), entryType: 'Purchase Invoice (value)', docType: d.type, docNo: d.no });
        else postItem(d, l.no, d.location, num(l.qty), base, 0, 'Purchase', l.bin);
        D(acc, base, { desc: l.description });
      } else D((isCredit && (genSetupRow(co, d.genBus, l.genProd) || {}).purchCM) || gpAcc(co, d.genBus, l.genProd, 'purch', 'Purch. Account'), base, { desc: l.description });
    } else if (l.type === 'Fixed Asset') {
      const fa = faOf(l.no, co); if (!fa) fail(`Fixed Asset ${l.no} does not exist.`);
      D(faPG(co, fa).acqCost, base, { desc: l.description, asset: fa.no });
      DB.faLedger.push({ id: uid(), company: co, fa: fa.no, date: d.date, type: 'Acquisition Cost', amount: sign * base, docNo: d.no });
      if (!fa.acqDate) fa.acqDate = d.date;
    } else if (l.type === 'Charge (Item)') {
      if (l.chargeItem) { // landed cost assigned to an item
        const it = itemOf(l.chargeItem, co); if (!it) fail(`Item ${l.chargeItem} (charge assignment) does not exist.`);
        DB.itemLedger.push({ id: uid(), date: d.date, company: co, item: it.no, location: d.location, bin: '', qty: 0, value: sign * base, exp: 0, entryType: 'Item Charge', docType: d.type, docNo: d.no });
        D(invAccount(co, d.location, it.invPostGroup), base, { desc: `${l.description} → ${it.no}` });
      } else D(gpAcc(co, d.genBus, l.genProd, 'purch', 'Purch. Account'), base, { desc: l.description });
    } else D(l.no, base, { desc: l.description, asset: l.asset });
    if (vat) { if (!c.vs.purchAcc) fail(`Purchase VAT Account is missing in VAT Posting Setup '${d.vatBus}' / '${l.vatProd}'.`); D(c.vs.purchAcc, vat, { desc: `VAT ${c.pct}%` }); }
    if (wht) { if (!c.ws.payableAcc) fail(`Payable WHT Account is missing in WHT Posting Setup '${d.whtBus}' / '${l.whtProd}'.`); C(c.ws.payableAcc, wht, { desc: `${c.ws.whtType || 'EWT'} ${l.whtProd} ${c.ws.pct}%` }); }
  }
  C(vendorPayables(co, v), r2(totLCY), { desc: `${isCredit ? 'Credit memo' : 'Invoice'} ${d.vendorInvoiceNo || d.refInvoice || ''}${isFCY(d.currency) ? ` (${d.currency} ${money(t.total)} @ ${R})` : ''}` });
  postGL(d, gl, 'vendor', d.vendor);
  DB.apLedger.push({ id: uid(), company: co, vendor: d.vendor, docType: d.type, docNo: d.no, extDocNo: d.vendorInvoiceNo || '', date: d.date, due: d.dueDate || d.date, desc: isCredit ? 'Credit memo' : `Invoice ${d.vendorInvoiceNo || ''}`,
    amount: sign * t.total, remaining: sign * t.total, base: sign * t.subtotal, currency: isFCY(d.currency) ? d.currency : '', rate: R, adjRate: R });
}
function postPI(d) {
  postPurchase(d, false);
  for (const l of d.lines) if (l.poNo && l.poLine != null) {
    const po = DB.docs.find(x => x.type === 'PO' && x.no === l.poNo && x.company === d.company);
    if (po) { const pl = po.lines[l.poLine]; pl.qtyInvoiced = r4(num(pl.qtyInvoiced) + num(l.qty)); }
  }
  for (const poNo of new Set(d.lines.map(l => l.poNo).filter(Boolean))) {
    const po = DB.docs.find(x => x.type === 'PO' && x.no === poNo && x.company === d.company);
    if (po && po.lines.every(pl => num(pl.qtyInvoiced) >= num(pl.qty) - 0.0001)) po.status = 'Completed';
  }
}
function postPRET(d) { postPurchase(d, true); }

function postSales(d, isCredit) {
  const co = d.company, cu = customerOf(d.customer, co); if (!cu) fail(`Customer ${d.customer} does not exist.`);
  const sign = isCredit ? -1 : 1, gl = [], t = docTotals(d), R = docRate(d);
  if (!isCredit && num(cu.creditLimit) > 0) {
    const bal = r2(sum(DB.arLedger.filter(e => e.company === co && e.customer === cu.no), remLCY));
    if (bal + t.total * R > num(cu.creditLimit)) fail(`The customer's credit limit has been exceeded: limit ${money(cu.creditLimit)}, balance ${money(bal)}, this invoice ${money(t.total * R)} (PHP).`);
  }
  let totLCY = 0;
  const D = (account, amt, extra = {}) => gl.push({ account, debit: sign > 0 ? amt : 0, credit: sign < 0 ? amt : 0, ...extra });
  const C = (account, amt, extra = {}) => gl.push({ account, debit: sign < 0 ? amt : 0, credit: sign > 0 ? amt : 0, ...extra });
  for (const l of d.lines) {
    const c = lineCalc(d, l), base = r2(c.base * R), vat = r2(c.vat * R);
    totLCY += base + vat;
    if (l.type === 'Item') {
      const it = itemOf(l.no, co); if (!it) fail(`Item ${l.no} does not exist.`);
      const revAcc = isCredit ? (genSetupRow(co, d.genBus, l.genProd) || {}).salesCM || gpAcc(co, d.genBus, l.genProd, 'sales', 'Sales Account') : gpAcc(co, d.genBus, l.genProd, 'sales', 'Sales Account');
      C(revAcc, base, { desc: l.description });
      if (it.type === 'Inventory') {
        if (!isCredit && !d._fromWhse && needsWhse(co, d.location, 'requireShipment')) fail(`Warehouse handling is required for location ${d.location}: use "Create Whse. Shipment" for item ${l.no}.`);
        const out = costOutPosted(co, l.no, num(l.qty));
        if (isCredit) postItem(d, l.no, d.location, num(l.qty), out.value, out.exp, 'Sales Return', l.bin);
        else postItem(d, l.no, d.location, -num(l.qty), -out.value, -out.exp, 'Sale', l.bin);
        const cogs = gpAcc(co, d.genBus, l.genProd, 'cogs', 'COGS Account'), inv = invAccount(co, d.location, it.invPostGroup);
        D(cogs, out.value, { desc: `Cost of ${l.no}` }); C(inv, out.value, { desc: `Cost of ${l.no}` });
      }
    } else C(l.no, base, { desc: l.description });
    if (vat) { if (!c.vs.salesAcc) fail(`Sales VAT Account is missing in VAT Posting Setup '${d.vatBus}' / '${l.vatProd}'.`); C(c.vs.salesAcc, vat, { desc: `Output VAT ${c.pct}%` }); }
  }
  D(customerReceivables(co, cu), r2(totLCY), { desc: `${isCredit ? 'Credit memo' : 'Sales invoice'}${isFCY(d.currency) ? ` (${d.currency} ${money(t.total)} @ ${R})` : ''}` });
  postGL(d, gl, 'customer', d.customer);
  DB.arLedger.push({ id: uid(), company: co, customer: d.customer, docType: d.type, docNo: d.no, date: d.date, due: d.dueDate || d.date, desc: d.customerPO || (isCredit ? 'Credit memo' : ''),
    amount: sign * t.total, remaining: sign * t.total, base: sign * t.subtotal, currency: isFCY(d.currency) ? d.currency : '', rate: R, adjRate: R });
}
function postSI(d) { postSales(d, false); }
function postSCM(d) { postSales(d, true); }

/** Apply entries; returns the applied amount in the document currency and records it at the rates the entries are carried at (LCY) */
function applyEntries(d, ledger) {
  let applied = 0, carried = 0, shift = 0;
  for (const a of d.lines) {
    const e = ledger.find(x => x.id === a.entryId);
    if (!e) fail(`Open entry ${a.docNo} no longer exists.`);
    if (U(e.currency || '') !== U(isFCY(d.currency) ? d.currency : '')) fail(`Entry ${e.docNo} is in ${e.currency || 'PHP'}; this document is in ${isFCY(d.currency) ? d.currency : 'PHP'}. Currencies must match to apply.`);
    const amt = r2(a.amount);
    if (Math.abs(amt) > Math.abs(e.remaining) + 0.009 || Math.sign(amt) !== Math.sign(e.remaining)) fail(`Amount to Apply for ${e.docNo} (${money(amt)}) is more than its Remaining Amount (${money(e.remaining)}).`);
    e.remaining = r2(e.remaining - amt);
    applied += amt; carried += r2(amt * entryRate(e)); shift += r2(amt * (entryRate(e) - num(e.rate || entryRate(e))));
  }
  d._carriedLCY = r2(carried); d._unrealShift = r2(shift);
  return r2(applied);
}
/** Bank Account Ledger entry in the bank's currency, with its PHP value (several banks can share one G/L account) */
function bankPost(doc, bank, amount, desc, checkNo, amountLCY) {
  if (!DB.bankLedger) DB.bankLedger = [];
  DB.bankLedger.push({ id: uid(), company: doc.company, bank, date: doc.date, docType: doc.type, docNo: doc.no, desc: desc || doc.remarks || '', amount: r2(amount), amountLCY: r2(amountLCY ?? amount), checkNo: checkNo || '', reconciled: false, statementNo: '' });
}
const bankBalance = (co, bank, asOf) => r2(sum((DB.bankLedger || []).filter(e => e.company === co && e.bank === bank && (!asOf || e.date <= asOf)), 'amount'));
const bankBalanceLCY = (co, bank, asOf) => r2(sum((DB.bankLedger || []).filter(e => e.company === co && e.bank === bank && (!asOf || e.date <= asOf)), e => e.amountLCY ?? e.amount));
const bankCurrency = (co, bank) => { const b = M(co).bankAccounts.find(x => x.code === bank) || {}; return isFCY(b.currency) ? U(b.currency) : ''; };
/** Bank amount in the bank's own currency for a payment in document currency `dc` at rate R */
function bankAmount(co, bank, dc, amountDoc, R) {
  const bc = bankCurrency(co, bank), dcu = isFCY(dc) ? U(dc) : '';
  if (bc && bc !== dcu) fail(`Bank account ${bank} is in ${bc}; the document is in ${dcu || 'PHP'}. Use a ${bc} document or a PHP bank account.`);
  return bc ? amountDoc : r2(amountDoc * R);
}
/** Payment Journal (Account Type Vendor, Bal. Account Type Bank Account). Document Type Payment, or Refund (vendor pays us back). */
function postPAY(d) {
  const co = d.company, v = vendorOf(d.vendor, co); if (!v) fail(`Vendor ${d.vendor} does not exist.`);
  const refund = d.docKind === 'Refund', R = docRate(d), cur = isFCY(d.currency) ? d.currency : '';
  const bankAcc = bankGL(co, d.bank), payables = vendorPayables(co, v);
  const applied = applyEntries(d, DB.apLedger);
  if (refund && applied > 0.009) fail('A refund can only be applied to open advances or credit memos (negative entries).');
  const amount = r2(num(d.amount) || Math.abs(applied));
  if (amount <= 0) fail('Amount must be positive.');
  if (amount < Math.abs(applied) - 0.009) fail(`Amount (${money(amount)}) is less than the total applied (${money(Math.abs(applied))}).`);
  if (!refund && d.method === 'Check' && !d.checkNo) { const b = M(co).bankAccounts.find(x => x.code === d.bank); d.checkNo = incStr(b.nextCheck || '000000'); b.nextCheck = d.checkNo; }
  const desc = refund ? `Vendor refund ${d.checkNo || ''}` : `${d.method || ''} ${d.checkNo || ''}`.trim();
  const bankLCY = r2(amount * R), unapplied = r2(amount - Math.abs(applied));
  // Payables are cleared at the rate each invoice is carried at; the difference to today's rate is a realized gain/loss.
  const apLCY = r2(Math.abs(d._carriedLCY) + unapplied * R), fx = refund ? apLCY - bankLCY : bankLCY - apLCY;
  const gl = refund ? [{ account: bankAcc, debit: bankLCY, desc }, { account: payables, credit: apLCY, desc }] : [{ account: payables, debit: apLCY, desc: `Payment ${d.checkNo || ''}` }, { account: bankAcc, credit: bankLCY, desc }];
  const x = cur && fxLine(co, cur, fx, true, `Realized exchange ${fx > 0 ? 'loss' : 'gain'} ${cur}`); if (x) gl.push(x);
  if (cur) gl.push(...fxShift(co, cur, d._unrealShift, "vendor"));
  postGL(d, gl, 'vendor', d.vendor);
  const bAmt = bankAmount(co, d.bank, cur, amount, R);
  bankPost(d, d.bank, refund ? bAmt : -bAmt, `${partyName('vendor', d.vendor, co)} – ${desc}`, refund ? '' : d.checkNo, refund ? bankLCY : -bankLCY);
  // Like BC: the payment is a vendor ledger entry; whatever is not applied stays open (advance) until applied.
  const amt = refund ? amount : -amount;
  DB.apLedger.push({ id: uid(), company: co, vendor: d.vendor, docType: 'PAY', docNo: d.no, date: d.date, due: d.date, desc: refund ? 'Refund' : (Math.abs(amt + applied) > 0.009 ? 'Payment (advance / unapplied part open)' : 'Payment'),
    amount: amt, remaining: r2(amt + applied), base: 0, payment: true, currency: cur, rate: R, adjRate: R });
  d.amount = amount;
}
/** Cash Receipt Journal (Account Type Customer, Bal. Account Type Bank Account). Document Type Payment (with CWT), or Refund (we pay the customer back). */
function postCR(d) {
  const co = d.company, cu = customerOf(d.customer, co); if (!cu) fail(`Customer ${d.customer} does not exist.`);
  const refund = d.docKind === 'Refund', R = docRate(d), cur = isFCY(d.currency) ? d.currency : '';
  const bankAcc = bankGL(co, d.bank), recv = customerReceivables(co, cu);
  const cwt = refund ? { amount: 0 } : cwtFor(d);
  const applied = applyEntries(d, DB.arLedger);
  if (refund && applied > 0.009) fail('A refund can only be applied to open customer deposits or credit memos (negative entries).');
  const amount = r2(num(d.amount));
  if (amount <= 0) fail('Amount must be positive.');
  const bankLCY = r2(amount * R);
  if (refund) {
    if (amount < Math.abs(applied) - 0.009) fail(`Amount (${money(amount)}) is less than the total applied (${money(Math.abs(applied))}).`);
    const arLCY = r2(Math.abs(d._carriedLCY) + (amount - Math.abs(applied)) * R), gl = [{ account: recv, debit: arLCY, desc: `Customer refund ${d.orNo || ''}` }, { account: bankAcc, credit: bankLCY, desc: `Customer refund ${d.orNo || ''}` }];
    const x = cur && fxLine(co, cur, bankLCY - arLCY, true, `Realized exchange difference ${cur}`); if (x) gl.push(x);
  if (cur) gl.push(...fxShift(co, cur, d._unrealShift, "customer"));
    postGL(d, gl, 'customer', d.customer);
    const bAmt = bankAmount(co, d.bank, cur, amount, R);
    bankPost(d, d.bank, -bAmt, `${partyName('customer', d.customer, co)} – refund`, d.orNo, -bankLCY);
    DB.arLedger.push({ id: uid(), company: co, customer: d.customer, docType: 'CR', docNo: d.no, date: d.date, due: d.date, desc: 'Refund', amount, remaining: r2(amount + applied), base: 0, payment: true, currency: cur, rate: R, adjRate: R });
    return;
  }
  const credited = r2(amount + cwt.amount);
  if (credited < applied - 0.009) fail(`Amount received plus CWT (${money(credited)}) is less than the total applied (${money(applied)}).`);
  // Receivables are cleared at the rate each invoice is carried at; the difference to today's rate is a realized gain/loss.
  const cwtLCY = r2(cwt.amount * R), arLCY = r2(d._carriedLCY + (credited - applied) * R), fx = arLCY - (bankLCY + cwtLCY);
  const gl = [{ account: bankAcc, debit: bankLCY, desc: `O.R. ${d.orNo || ''}` }];
  if (cwtLCY) gl.push({ account: cwt.account, debit: cwtLCY, desc: `CWT ${d.cwtProd} ${cwt.pct}%` });
  gl.push({ account: recv, credit: arLCY, desc: `Collection O.R. ${d.orNo || ''}` });
  const x = cur && fxLine(co, cur, fx, true, `Realized exchange ${fx > 0 ? 'loss' : 'gain'} ${cur}`); if (x) gl.push(x);
  if (cur) gl.push(...fxShift(co, cur, d._unrealShift, "customer"));
  postGL(d, gl, 'customer', d.customer);
  bankPost(d, d.bank, bankAmount(co, d.bank, cur, amount, R), `${partyName('customer', d.customer, co)} – O.R. ${d.orNo || ''}`, '', bankLCY);
  DB.arLedger.push({ id: uid(), company: co, customer: d.customer, docType: 'CR', docNo: d.no, date: d.date, due: d.date, desc: Math.abs(credited - applied) > 0.009 ? 'Payment (deposit / unapplied part open)' : 'Payment',
    amount: -credited, remaining: r2(-credited + applied), base: 0, payment: true, currency: cur, rate: R, adjRate: R });
}
function cwtFor(d) {
  if (!d.cwtProd) return { amount: 0, pct: 0 };
  const cu = customerOf(d.customer, d.company) || {};
  const ws = whtRow(d.company, cu.whtBus, d.cwtProd);
  if (!ws) fail(`The WHT Posting Setup does not exist. WHT Bus.: '${cu.whtBus || ''}', WHT Prod.: '${d.cwtProd}'.`);
  if (!ws.prepaidAcc) fail(`Prepaid (creditable) WHT Account is missing in WHT Posting Setup '${cu.whtBus}' / '${d.cwtProd}'.`);
  let base = 0;
  for (const a of d.lines) { const e = DB.arLedger.find(x => x.id === a.entryId); if (e && e.amount) base += num(e.base) * num(a.amount) / num(e.amount); }
  return { amount: r2(base * num(ws.pct) / 100), pct: num(ws.pct), account: ws.prepaidAcc };
}

/** Default Gen. Bus. Posting Group for item journal lines: a blank group if set up (BC default), else the first group
    that has an Inventory Adjmt. Account for the item's Gen. Prod. group (your packages use DOMESTIC). */
function invAdjBus(co, prod) {
  const rows = M(co).genSetup.filter(r => U(r.prod) === U(prod) && r.invAdj);
  return (rows.find(r => !r.bus) || rows.find(r => U(r.bus) === 'DOMESTIC') || rows[0] || {}).bus || '';
}
/** Item Journal: Positive/Negative Adjmt. Offset account = Inventory Adjmt. Account from General Posting Setup (line Gen. Bus. × item Gen. Prod.) */
const IJ_TYPES = ['Negative Adjmt.', 'Positive Adjmt.'];
function postIJ(d) {
  const co = d.company, gl = [];
  for (const l of d.lines) {
    const it = itemOf(l.item, co); if (!it || it.type !== 'Inventory') fail(`Item ${l.item} is not an inventory item.`);
    const pos = (l.entryType || d.entryType) === 'Positive Adjmt.';
    const inv = invAccount(co, d.location, it.invPostGroup), adj = gpAcc(co, l.genBus || invAdjBus(co, it.genProd), it.genProd, 'invAdj', 'Inventory Adjmt. Account');
    if (pos) { const val = r2(num(l.qty) * (num(l.unitCost) || avgCost(co, l.item))); l.unitCost = r4(val / num(l.qty)); postItem(d, l.item, d.location, num(l.qty), val, 0, 'Positive Adjmt.', l.bin); gl.push({ account: inv, debit: val, desc: `${l.item} ${l.description || ''}` }, { account: adj, credit: val, asset: l.asset, dims: l.dims }); }
    else { const out = costOutPosted(co, l.item, num(l.qty)); l.unitCost = r4((out.value + out.exp) / num(l.qty)); postItem(d, l.item, d.location, -num(l.qty), -out.value, -out.exp, 'Negative Adjmt.', l.bin); gl.push({ account: adj, debit: out.value, asset: l.asset, dims: l.dims, desc: `${l.item} ${l.description || ''}${l.asset ? ' → ' + l.asset : ''}` }, { account: inv, credit: out.value }); }
  }
  if (gl.some(x => x.debit || x.credit)) postGL(d, gl);
}
/** Phys. Inventory Journal: posts the difference between counted and calculated quantity */
function postPC(d) {
  const co = d.company, gl = [];
  for (const l of d.lines) {
    const it = itemOf(l.item, co);
    const sys = l.bin ? binQty(co, d.location, l.bin, l.item) : onHand(co, l.item, d.location), diff = r4(num(l.countedQty) - sys);
    l.systemQty = sys; l.diff = diff;
    if (Math.abs(diff) < 0.0001) continue;
    const inv = invAccount(co, d.location, it.invPostGroup), adj = gpAcc(co, invAdjBus(co, it.genProd), it.genProd, 'invAdj', 'Inventory Adjmt. Account');
    if (diff > 0) { const val = r2(diff * avgCost(co, l.item)); postItem(d, l.item, d.location, diff, val, 0, 'Positive Adjmt. (count)', l.bin); gl.push({ account: inv, debit: val }, { account: adj, credit: val, desc: `Count surplus ${l.item}` }); }
    else { const out = costOutPosted(co, l.item, -diff); postItem(d, l.item, d.location, diff, -out.value, -out.exp, 'Negative Adjmt. (count)', l.bin); gl.push({ account: adj, debit: out.value, desc: `Count shortage ${l.item}` }, { account: inv, credit: out.value }); }
  }
  if (gl.some(x => x.debit || x.credit)) postGL(d, gl);
}
/** General Journal with BC account types */
const GJ_ACC_TYPES = ['G/L Account', 'Vendor', 'Customer', 'Bank Account'];
function postGJ(d) {
  const co = d.company, gl = [];
  for (const l of d.lines) {
    const t = l.accType || 'G/L Account', dr = num(l.debit), cr = num(l.credit);
    let account = l.account;
    if (t === 'Vendor') {
      const v = vendorOf(l.account, co); if (!v) fail(`Vendor ${l.account} does not exist.`); account = vendorPayables(co, v);
      DB.apLedger.push({ id: uid(), company: co, vendor: v.no, docType: 'GJ', docNo: d.no, date: d.date, due: d.date, desc: l.desc || d.remarks, amount: r2(cr - dr), remaining: r2(cr - dr), base: 0 });
    } else if (t === 'Customer') {
      const c = customerOf(l.account, co); if (!c) fail(`Customer ${l.account} does not exist.`); account = customerReceivables(co, c);
      DB.arLedger.push({ id: uid(), company: co, customer: c.no, docType: 'GJ', docNo: d.no, date: d.date, due: d.date, desc: l.desc || d.remarks, amount: r2(dr - cr), remaining: r2(dr - cr), base: 0 });
    } else if (t === 'Bank Account') { if (bankCurrency(co, l.account)) fail(`Bank account ${l.account} is in ${bankCurrency(co, l.account)}: use a Payment / Cash Receipt Journal or a Transfer of Funds for foreign-currency banks.`); account = bankGL(co, l.account); bankPost(d, l.account, r2(dr - cr), l.desc || d.remarks); }
    gl.push({ account, debit: dr, credit: cr, desc: l.desc, dims: l.dims, asset: l.asset });
  }
  postGL(d, gl);
}

/** Transfer Order: Post Shipment moves stock to the in-transit location, Post Receipt to the destination (no G/L in the same company) */
function shipTO(d) {
  checkPeriod(d.date);
  if (!d.transitLoc) fail('In-Transit Code must have a value.');
  if (!d._fromWhse && needsWhse(d.company, d.fromLoc, 'requireShipment')) fail(`Warehouse handling is required for location ${d.fromLoc}: use "Create Whse. Shipment".`);
  for (const l of d.lines) {
    const out = costOut(d.company, l.item, num(l.qty));
    postItem(d, l.item, d.fromLoc, -num(l.qty), -out.value, -out.exp, 'Transfer (Ship)', l.fromBin);
    postItem(d, l.item, d.transitLoc, num(l.qty), out.value, out.exp, 'Transfer (In-Transit)');
    l.qtyShipped = num(l.qty); l.shipValue = out.value; l.shipExp = out.exp;
  }
  d.status = 'Shipped'; d.shippedAt = new Date().toISOString();
}
function receiveTO(d, date) {
  const rd = { ...d, date: date || today() }; checkPeriod(rd.date);
  if (!d._fromWhse && needsWhse(d.company, d.toLoc, 'requireReceive')) fail(`Warehouse handling is required for location ${d.toLoc}: use "Create Whse. Receipt".`);
  for (const l of d.lines) {
    postItem(rd, l.item, d.transitLoc, -num(l.qtyShipped), -num(l.shipValue), -num(l.shipExp), 'Transfer (In-Transit)');
    postItem(rd, l.item, d.toLoc, num(l.qtyShipped), num(l.shipValue), num(l.shipExp), 'Transfer (Receive)', l.toBin);
    l.qtyReceived = l.qtyShipped;
  }
  d.status = 'Received'; d.receivedAt = new Date().toISOString();
}

/* ---------- Fixed assets (FA Posting Group accounts) ---------- */
const faLed = (co, no) => DB.faLedger.filter(e => e.fa === no && (!e.company || e.company === co));
function faCost(no, co) { return r2(sum(faLed(co || S.company, no).filter(e => e.type === 'Acquisition Cost'), 'amount')); }
function faAccum(no, co) { return r2(sum(faLed(co || S.company, no).filter(e => e.type === 'Depreciation'), 'amount')); }
function faMonths(fa) { return num(fa.depMonths); }
function runDepreciation(company, periodEnd) {
  const key = periodEnd.slice(0, 7);
  const doc = { id: uid(), type: 'DEP', no: nextNo('DEP', company), company, date: periodEnd, status: 'Posted', remarks: `Calculate Depreciation ${key}`, createdBy: curUser().id, createdAt: new Date().toISOString(), approvals: [], lines: [] };
  const gl = [];
  for (const fa of M(company).fixedAssets.filter(f => (!f.company || f.company === company) && f.status !== 'Disposed')) {
    if (!/straight/i.test(fa.depMethod || 'Straight-line') || !faMonths(fa)) continue;
    if (fa.depStart && fa.depStart > periodEnd) continue;
    if (DB.faLedger.some(e => e.fa === fa.no && e.company === company && e.type === 'Depreciation' && e.period === key)) continue;
    const cost = faCost(fa.no, company), accum = faAccum(fa.no, company);
    const amt = r2(Math.min(cost / faMonths(fa), cost - accum));
    if (amt <= 0) continue;
    const pg = faPG(company, fa);
    if (!pg.depExp || !pg.accumDep) fail(`Depreciation Expense Acc. / Accum. Depreciation Account missing in FA Posting Group '${pg.code}'.`);
    gl.push({ account: pg.depExp, debit: amt, asset: fa.no, desc: `Depreciation ${fa.no} ${key}` }, { account: pg.accumDep, credit: amt, asset: fa.no, desc: `Depreciation ${fa.no} ${key}` });
    DB.faLedger.push({ id: uid(), company, fa: fa.no, date: periodEnd, type: 'Depreciation', amount: amt, period: key, docNo: doc.no });
    doc.lines.push({ asset: fa.no, description: fa.description, amount: amt });
  }
  if (!gl.length) fail(`No depreciation to post for ${company} in ${key} (already posted, no acquisition cost yet, or no straight-line assets).`);
  postGL(doc, gl); DB.docs.push(doc);
  return doc;
}
function disposeFA(company, fa, date, proceeds, proceedsAccount) {
  const doc = { id: uid(), type: 'FAD', no: nextNo('FAD', company), company, date, status: 'Posted', remarks: `Disposal of ${fa.no} ${fa.description}`, createdBy: curUser().id, createdAt: new Date().toISOString(), approvals: [], lines: [{ asset: fa.no, description: fa.description, amount: proceeds }] };
  const pg = faPG(company, fa), cost = faCost(fa.no, company), accum = faAccum(fa.no, company), gain = r2(proceeds - (cost - accum));
  const gl = [{ account: pg.accumDepDisp || pg.accumDep, debit: accum, asset: fa.no }, { account: pg.acqCostDisp || pg.acqCost, credit: cost, asset: fa.no }];
  if (proceeds) gl.push({ account: proceedsAccount, debit: proceeds, desc: 'Proceeds from disposal' });
  if (gain > 0) gl.push({ account: pg.gains, credit: gain, asset: fa.no, desc: 'Gain on disposal' });
  if (gain < 0) gl.push({ account: pg.losses, debit: -gain, asset: fa.no, desc: 'Loss on disposal' });
  postGL(doc, gl);
  DB.faLedger.push({ id: uid(), company, fa: fa.no, date, type: 'Proceeds on Disposal', amount: proceeds, docNo: doc.no });
  fa.status = 'Disposed'; fa.disposedDate = date;
  DB.docs.push(doc);
  return doc;
}
/** When a revalued entry is applied, BC reverses its unrealized gain/loss and books it as realized */
function fxShift(co, cur, s, kind) {
  if (!cur || Math.abs(s) < 0.005) return [];
  const a = k => curAcc(co, cur, k, k), v = r2(Math.abs(s)), gainSide = kind === 'customer' ? s > 0 : s < 0;
  return gainSide ? [{ account: a('unrealizedGain'), debit: v, desc: `Unrealized → realized gain ${cur}` }, { account: a('realizedGain'), credit: v, desc: `Unrealized → realized gain ${cur}` }]
    : [{ account: a('unrealizedLoss'), credit: v, desc: `Unrealized → realized loss ${cur}` }, { account: a('realizedLoss'), debit: v, desc: `Unrealized → realized loss ${cur}` }];
}
