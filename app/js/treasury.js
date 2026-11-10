'use strict';
/* ============ Treasury (signed Cash Management To-Be): Suggest Vendor Payments, check printing, Void Check,
   Unapply / Apply Entries, Vendor & Customer Refunds, Transfer of Funds, Bank Account Reconciliation,
   Bank Account Ledger, Cash Flow Forecast ============ */

// Document Type on Payment / Cash Receipt Journals (BC: Payment or Refund)
for (const t of ['PAY', 'CR']) if (!DOCS[t].head.some(f => f.k === 'docKind'))
  DOCS[t].head.splice(1, 0, { k: 'docKind', l: 'Document Type', t: 'select', opts: ['Payment', 'Refund'], noBlank: 1 });
DOCS.PAY.listActions = `<button class="btn" onclick="suggestVendorPayments()">Suggest Vendor Payments…</button>`;

Object.assign(DOCS, {
  FT: { name: 'Transfer of Funds', plural: 'Transfers of Funds', lines: 'none', post: true, bc: 'Payment/General Journal: Bank Account → Bank Account',
    desc: 'Move money between your own bank accounts (e.g. PHP current to payroll account). Approved by the Treasury Assistant Manager, then posted.',
    head: [{ k: 'date', l: 'Posting Date', t: 'date', req: 1 }, { k: 'fromBank', l: 'From Bank Account', t: 'ref', ref: 'bankAccounts', req: 1 }, { k: 'toBank', l: 'To Bank Account', t: 'ref', ref: 'bankAccounts', req: 1 },
      { k: 'amount', l: 'Amount', t: 'number', req: 1 }, { k: 'refNo', l: 'Bank Reference / Debit Advice No.' }, { k: 'remarks', l: 'Description', t: 'textarea', w: 'w2', req: 1 }] },
  BREC: { name: 'Bank Acc. Reconciliation', plural: 'Bank Acc. Reconciliations', lines: 'brec', post: true, bc: 'Bank Acc. Reconciliation → Suggest Lines → Match → Post',
    desc: 'Match the bank statement against the Bank Account Ledger. "Suggest Lines" loads the open entries; tick the ones on the statement; the difference must be zero to post. Record bank charges/interest first with a General Journal (Account Type Bank Account).',
    head: [{ k: 'bank', l: 'Bank Account No.', t: 'ref', ref: 'bankAccounts', req: 1 }, { k: 'statementNo', l: 'Statement No.', req: 1 }, { k: 'date', l: 'Statement Date', t: 'date', req: 1 },
      { k: 'endingBalance', l: 'Statement Ending Balance', t: 'number', req: 1 }, { k: 'remarks', l: 'Remarks', t: 'textarea', w: 'w2' }] }
});
POSTERS.FT = postFT; POSTERS.BREC = postBREC;
for (const t of ['FT', 'BREC']) if (!DOC_TYPES_FOR_RULES.includes(t)) DOC_TYPES_FOR_RULES.push(t);
WH_COLS.none = () => [];
WH_COLS.brec = () => [{ k: 'match', l: 'Matched', t: 'check', w: 70 }, { k: 'date', l: 'Posting Date', t: 'ro' }, { k: 'docNo', l: 'Document No.', t: 'ro' }, { k: 'checkNo', l: 'Check No.', t: 'ro' },
  { k: 'desc', l: 'Description', t: 'ro' }, { k: 'amount', l: 'Amount', t: 'ro', f: 'money' }];

/* ---------- Transfer of Funds ---------- */
function postFT(d) {
  const co = d.company, amt = r2(num(d.amount));
  if (amt <= 0) fail('Amount must be positive.');
  if (d.fromBank === d.toBank) fail('From and To bank accounts must be different.');
  if (bankBalance(co, d.fromBank, d.date) < amt - 0.009) fail(`Bank ${d.fromBank} balance on ${d.date} is only ${money(bankBalance(co, d.fromBank, d.date))}.`);
  postGL(d, [{ account: bankGL(co, d.toBank), debit: amt, desc: `Transfer from ${d.fromBank}` }, { account: bankGL(co, d.fromBank), credit: amt, desc: `Transfer to ${d.toBank}` }]);
  bankPost(d, d.fromBank, -amt, `Transfer to ${d.toBank} ${d.refNo || ''}`);
  bankPost(d, d.toBank, amt, `Transfer from ${d.fromBank} ${d.refNo || ''}`);
}

/* ---------- Bank Account Reconciliation ---------- */
const bankOf = (co, code) => M(co).bankAccounts.find(b => b.code === code) || {};
function brecTotals(d) {
  const last = d.lastBalance != null ? num(d.lastBalance) : num(bankOf(d.company, d.bank).lastStatementBalance);
  const matched = r2(sum((d.lines || []).filter(l => l.match), 'amount'));
  return { last, matched, calc: r2(last + matched), ending: r2(num(d.endingBalance)), diff: r2(last + matched - num(d.endingBalance)) };
}
function brecSuggest() {
  Object.assign(ED, readForm(DOCS.BREC.head, 'h'));
  if (!ED.bank || !ED.date) return toast('Choose the Bank Account and Statement Date first.', 'err');
  const inUse = new Set(DB.docs.filter(x => x.type === 'BREC' && x.id !== ED.id && x.status !== 'Posted').flatMap(x => x.lines.map(l => l.entryId)));
  ED.lines = (DB.bankLedger || []).filter(e => e.company === ED.company && e.bank === ED.bank && !e.reconciled && e.date <= ED.date && !inUse.has(e.id))
    .sort((a, b) => a.date.localeCompare(b.date)).map(e => ({ entryId: e.id, date: e.date, docNo: e.docNo, checkNo: e.checkNo, desc: e.desc, amount: e.amount, match: false }));
  refreshLines(); toast(`${ED.lines.length} open bank ledger entries loaded. Tick the ones that appear on the statement.`);
}
function postBREC(d) {
  const t = brecTotals(d);
  if (Math.abs(t.diff) > 0.009) fail(`Balance Last Statement + matched entries (${money(t.calc)}) does not equal the Statement Ending Balance (${money(t.ending)}). Difference ${money(t.diff)}.`);
  checkPeriod(d.date);
  for (const l of d.lines.filter(l => l.match)) { const e = DB.bankLedger.find(x => x.id === l.entryId); if (!e || e.reconciled) fail(`Bank ledger entry ${l.docNo} is already reconciled.`); e.reconciled = true; e.statementNo = d.statementNo; }
  d.lines = d.lines.filter(l => l.match); d.lastBalance = t.last;
  Object.assign(bankOf(d.company, d.bank), { lastStatementNo: d.statementNo, lastStatementBalance: t.ending, lastStatementDate: d.date });
}

/* ---------- Void Check / Unapply / Apply ---------- */
const paymentEntry = d => (d.type === 'PAY' ? DB.apLedger : DB.arLedger).find(e => e.company === d.company && e.docType === d.type && e.docNo === d.no && e.payment);
const canTreasury = () => isAdmin() || hasRole('Treasury Assistant Manager') || hasRole('Treasury Supervisor');
function voidCheckModal() {
  if (!canTreasury()) return toast('Only Treasury (Supervisor / Assistant Manager) can void checks.', 'err');
  modal(`Void Check ${ED.checkNo} – ${ED.no}`, `<p>Unapply and void check: the bank entry is reversed and the invoices this check paid become open again.</p>
    <div class="form-grid">${fieldHtml({ k: 'date', l: 'Void Date', t: 'date' }, today(), 'vc')}${fieldHtml({ k: 'reason', l: 'Reason *', w: 'w2' }, '', 'vc')}</div>`, async () => {
    const q = readForm([{ k: 'date' }, { k: 'reason' }], 'vc');
    const ok = await commit(() => {
      if (!q.reason) fail('Please give the reason for voiding.');
      const d = dbDoc(), co = d.company, pe = paymentEntry(d);
      if (d.status !== 'Posted' || d.voided) fail('Only posted, not yet voided payments can be voided.');
      if (!pe) fail('The vendor ledger entry of this payment was not found.');
      const applied = d.unapplied ? 0 : r2(sum(d.lines, 'amount'));
      if (Math.abs(pe.remaining - (pe.amount + applied)) > 0.009) fail('This payment was applied to other entries afterwards. Unapply those applications first.');
      if (!d.unapplied) for (const a of d.lines) { const e = DB.apLedger.find(x => x.id === a.entryId); if (e) e.remaining = r2(e.remaining + num(a.amount)); }
      pe.remaining = 0; pe.voided = true;
      const v = vendorOf(d.vendor, co), vd = { ...d, date: q.date };
      postGL(vd, [{ account: bankGL(co, d.bank), debit: num(d.amount), desc: `Void check ${d.checkNo}: ${q.reason}` }, { account: vendorPayables(co, v), credit: num(d.amount), desc: `Void check ${d.checkNo}` }], 'vendor', d.vendor);
      bankPost(vd, d.bank, num(d.amount), `VOID check ${d.checkNo} – ${q.reason}`, d.checkNo);
      Object.assign(d, { voided: true, status: 'Voided', voidReason: q.reason, voidDate: q.date, voidedBy: curUser().id });
    }, 'Voided check', ED.no);
    if (ok !== false) { toast('Check voided. The paid invoices are open again.'); afterChange(ok); } else return false;
  }, 'Void Check');
}
async function unapplyDoc() {
  if (!confirm(`Unapply the entries applied by ${ED.no}? The ${ED.type === 'PAY' ? 'invoices' : 'invoices'} become open again and the ${ED.type === 'PAY' ? 'payment' : 'collection'} stays open on the ledger for re-application.`)) return;
  const ok = await commit(() => {
    const d = dbDoc(), pe = paymentEntry(d), ledger = d.type === 'PAY' ? DB.apLedger : DB.arLedger;
    if (d.unapplied || d.voided) fail('Already unapplied or voided.');
    if (!pe) fail('The ledger entry of this payment was not found.');
    const applied = r2(sum(d.lines, 'amount'));
    if (Math.abs(pe.remaining - (pe.amount + applied)) > 0.009) fail('This payment was applied to other entries afterwards; unapply those first.');
    for (const a of d.lines) { const e = ledger.find(x => x.id === a.entryId); if (e) e.remaining = r2(e.remaining + num(a.amount)); }
    pe.remaining = pe.amount; pe.desc = 'Payment (unapplied – open)';
    Object.assign(d, { unapplied: true, unappliedAt: new Date().toISOString(), unappliedBy: curUser().id });
  }, 'Unapplied entries', ED.no);
  if (ok !== false) { toast('Entries unapplied. Use Apply Entries on the vendor/customer to apply the payment again.'); afterChange(ok); }
}
/** Standalone Apply Entries (BC: Vendor/Customer Ledger Entries → Apply Entries), e.g. apply a customer deposit or supplier advance to an invoice */
route('applyent', (kind, party) => {
  const co = S.company, ledger = kind === 'vendor' ? DB.apLedger : DB.arLedger;
  const open = ledger.filter(e => e.company === co && e[kind] === party && Math.abs(e.remaining) > 0.004).sort((a, b) => a.date.localeCompare(b.date));
  return pageHead(`Apply Entries – ${partyName(kind, party, co)}`, `Choose the applying entry (a payment, advance, deposit or credit memo), then the entries it settles. ${kind === 'vendor' ? 'Vendor' : 'Customer'} ${esc(party)} · ${esc(companyName(co))}`,
    `<button class="btn primary" onclick="postApplication('${kind}','${esc(party)}')">Post Application</button><button class="btn ghost" onclick="go('#/card/${kind}s/${encodeURIComponent(party)}')">Back</button>`) +
    `<div class="card">${open.length ? `<table class="grid compact"><thead><tr><th>Applying Entry</th><th>Apply</th><th>Document</th><th>Date</th><th>Due</th><th>Description</th><th class="num">Remaining Amount</th><th class="num">Amount to Apply</th></tr></thead><tbody>
    ${open.map(e => `<tr><td><input type="radio" name="appl" value="${e.id}" ${e.remaining < 0 ? '' : ''}></td><td><input type="checkbox" class="apx" value="${e.id}"></td><td>${esc(e.docNo)}</td><td>${e.date}</td><td>${e.due}</td><td>${esc(e.desc)}</td>
      <td class="num">${money(e.remaining)}</td><td><input type="number" step="any" class="num apa" data-id="${e.id}" value="${Math.abs(e.remaining)}"></td></tr>`).join('')}</tbody></table>` : '<p class="muted">No open entries.</p>'}</div>
    ${applicationsHtml(kind, party)}`;
});
function applicationsHtml(kind, party) {
  const a = (DB.applications || []).filter(x => x.company === S.company && x.kind === kind && x.party === party);
  if (!a.length) return '';
  return `<div class="card"><h3>Applications</h3><table class="grid compact"><thead><tr><th>Date</th><th>Applying</th><th>Applied to</th><th class="num">Amount</th><th>By</th></tr></thead><tbody>
    ${a.map(x => `<tr><td>${x.date}</td><td>${esc(x.fromDoc)}</td><td>${esc(x.toDoc)}</td><td class="num">${money(x.amount)}</td><td>${esc(x.user)}</td></tr>`).join('')}</tbody></table></div>`;
}
async function postApplication(kind, party) {
  const applying = ($('input[name=appl]:checked') || {}).value;
  const targets = $$('.apx:checked').map(x => x.value).filter(id => id !== applying);
  const amt = Object.fromEntries($$('.apa').map(x => [x.dataset.id, num(x.value)]));
  const ok = await commit(() => {
    const ledger = kind === 'vendor' ? DB.apLedger : DB.arLedger;
    const A = ledger.find(e => e.id === applying); if (!A) fail('Choose the applying entry (radio button).');
    if (!targets.length) fail('Tick at least one entry to apply to.');
    let left = Math.abs(A.remaining);
    for (const id of targets) {
      const e = ledger.find(x => x.id === id);
      if (Math.sign(e.remaining) === Math.sign(A.remaining)) fail(`${e.docNo} has the same sign as the applying entry; you can only apply payments/credits against invoices.`);
      const x = r2(Math.min(amt[id], Math.abs(e.remaining), left));
      if (x <= 0) continue;
      e.remaining = r2(e.remaining - Math.sign(e.remaining) * x); A.remaining = r2(A.remaining - Math.sign(A.remaining) * x); left = r2(left - x);
      if (!DB.applications) DB.applications = [];
      DB.applications.push({ id: uid(), company: S.company, kind, party, date: today(), fromId: A.id, fromDoc: A.docNo, toId: e.id, toDoc: e.docNo, amount: x, user: curUser().name });
    }
  }, 'Applied ledger entries', party);
  if (ok !== false) { toast('Application posted.'); render(); }
}

/* ---------- Suggest Vendor Payments ---------- */
function suggestVendorPayments() {
  modal('Suggest Vendor Payments', `<p>Creates a Payment Journal (draft) per vendor for open invoices due on or before the Last Payment Date. Review them, then send them for approval as usual.</p>
    <div class="form-grid">${fieldHtml({ k: 'date', l: 'Last Payment Date (due on or before)', t: 'date' }, today(), 'sv')}${fieldHtml({ k: 'postDate', l: 'Posting Date', t: 'date' }, today(), 'sv')}
    ${fieldHtml({ k: 'bank', l: 'Bal. Account No. (Bank)', t: 'ref', ref: 'bankAccounts' }, (refOptions('bankAccounts')[0] || [])[0], 'sv')}${fieldHtml({ k: 'method', l: 'Bank Payment Type', t: 'select', opts: PAY_METHODS, noBlank: 1 }, 'Check', 'sv')}
    ${fieldHtml({ k: 'vendor', l: 'Only this vendor (blank = all)', t: 'ref', ref: 'vendors', w: 'w2' }, '', 'sv')}</div>`, async () => {
    const q = readForm([{ k: 'date' }, { k: 'postDate' }, { k: 'bank' }, { k: 'method' }, { k: 'vendor' }], 'sv');
    let created = [];
    const ok = await commit(() => {
      if (!q.bank) fail('Choose the bank account.');
      const co = S.company;
      const busy = new Set(DB.docs.filter(x => x.type === 'PAY' && x.company === co && x.status !== 'Posted' && x.status !== 'Voided').flatMap(x => x.lines.map(l => l.entryId)));
      const due = DB.apLedger.filter(e => e.company === co && e.remaining > 0.004 && e.due <= q.date && (!q.vendor || e.vendor === q.vendor) && !busy.has(e.id));
      const byVendor = {}; due.forEach(e => (byVendor[e.vendor] = byVendor[e.vendor] || []).push(e));
      for (const [v, es] of Object.entries(byVendor)) {
        const d = { id: uid(), type: 'PAY', no: nextNo('PAY', co), company: co, date: q.postDate, status: 'Draft', docKind: 'Payment', vendor: v, bank: q.bank, method: q.method, amount: 0,
          remarks: `Suggested payment – due up to ${q.date}`, createdBy: curUser().id, createdAt: new Date().toISOString(), approvals: [], dims: {},
          lines: es.map(e => ({ entryId: e.id, docNo: e.docNo, desc: e.desc, amount: e.remaining })) };
        copyPartyToDoc(d); DB.docs.push(d); created.push(d.no);
      }
      if (!created.length) fail(`No open vendor invoices are due on or before ${q.date} (or they are already on a draft payment).`);
    }, 'Suggested vendor payments');
    if (ok !== false) { toast(`${created.length} payment journal(s) created: ${created.join(', ')}.`); render(); } else return false;
  }, 'Suggest');
}

/* ---------- Check printing (amount in words, Philippine format) ---------- */
function numWords(n) {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const t = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const h = x => x < 20 ? a[x] : x < 100 ? t[Math.floor(x / 10)] + (x % 10 ? '-' + a[x % 10] : '') : a[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' + h(x % 100) : '');
  if (n === 0) return 'Zero';
  const parts = [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand'], [1, '']]; let out = [];
  for (const [v, w] of parts) { const q = Math.floor(n / v); if (q) { out.push(h(q) + (w ? ' ' + w : '')); n -= q * v; } }
  return out.join(' ');
}
const amountInWords = x => { const p = Math.floor(r2(x)), c = Math.round((r2(x) - p) * 100); return `${numWords(p)} Pesos${c ? ` and ${pad(c)}/100` : ' Only'}`; };
function checkHtml() {
  if (ED.type !== 'PAY' || ED.docKind === 'Refund' || ED.method !== 'Check') return '';
  const v = vendorOf(ED.vendor, ED.company) || {}, b = bankOf(ED.company, ED.bank);
  return `<div class="p-check"><div class="p-check-top"><span>${esc(b.name || ED.bank)}</span><span>Check No. <b>${esc(ED.checkNo || '(assigned on posting)')}</b></span><span>Date: <b>${esc(ED.date)}</b></span></div>
    <div class="p-check-pay">PAY TO THE ORDER OF <b>${esc(v.name || ED.vendor)}</b> <span class="p-check-amt">₱ ${money(docTotals(ED).total)}</span></div>
    <div class="p-check-words">${esc(amountInWords(docTotals(ED).total))}</div><div class="p-check-sign">Authorized Signature(s)</div></div>`;
}

/* ---------- Bank Account Ledger & Cash Flow Forecast ---------- */
REPORTS.bankled = function () {
  const rows = (DB.bankLedger || []).filter(e => inCo(e) && e.date >= RF.from && e.date <= RF.to).sort((a, b) => (a.bank + a.date).localeCompare(b.bank + b.date));
  const bal = {}; const data = rows.map(e => { bal[e.bank] = r2((bal[e.bank] ?? bankBalance(e.company, e.bank, addDays(RF.from, -1))) + e.amount); return { ...e, bal: bal[e.bank], status: e.reconciled ? `Reconciled (${e.statementNo})` : 'Open' }; });
  const banks = (RF.company === 'ALL' ? DB.companies.map(c => c.code) : [RF.company]).flatMap(co => M(co).bankAccounts.filter(b => !b.company || b.company === co).map(b => ({ co, ...b, balance: bankBalance(co, b.code) }))).filter(b => b.balance || (DB.bankLedger || []).some(e => e.bank === b.code && e.company === b.co));
  return pageHead('Bank Account Ledger Entries', 'Every deposit, check, transfer and void per bank account, with reconciliation status.') + filterBar({ from: 1, to: 1 }) +
    `<div class="card"><h3>Balances</h3>${dataTable('bankbal', [{ l: 'Company', k: 'co' }, { l: 'Bank', k: 'code' }, { l: 'Name', k: 'name' }, { l: 'Currency', v: r => r.currency || 'PHP' }, { l: 'Balance', k: 'balance', f: 'money' }, { l: 'Balance (PHP)', v: r => bankBalanceLCY(r.co, r.code), f: 'money' }, { l: 'Last Statement', v: r => r.lastStatementNo ? `${r.lastStatementNo} (${r.lastStatementDate})` : '' }, { l: 'Last Statement Balance', k: 'lastStatementBalance', f: 'money' }], banks, { title: 'Bank balances', search: false })}</div>
    <div class="card">${dataTable('bankled', [{ l: 'Date', k: 'date' }, { l: 'Bank', k: 'bank' }, { l: 'Document No.', k: 'docNo' }, { l: 'Check No.', k: 'checkNo' }, { l: 'Description', k: 'desc' }, { l: 'Amount (bank currency)', k: 'amount', f: 'money' }, { l: 'Amount (PHP)', v: r => r.amountLCY ?? r.amount, f: 'money' }, { l: 'Running Balance', k: 'bal', f: 'money' }, { l: 'Status', k: 'status' }], data,
      { title: 'Bank Ledger', link: r => { const d = DB.docs.find(x => x.no === r.docNo && x.company === r.company); return d ? `#/doc/${d.type}/${d.id}` : ''; } })}</div>`;
};
REPORTS.cashflow = function () {
  const co = RF.company, start = (() => { const d = new Date(today() + 'T00:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })();
  const weeks = Array.from({ length: 13 }, (_, i) => ({ from: addDays(start, i * 7), to: addDays(start, i * 7 + 6) }));
  const inCoF = e => co === 'ALL' || e.company === co;
  const opening = r2(sum((DB.bankLedger || []).filter(inCoF), e => e.amountLCY ?? e.amount));
  const bucket = (date) => { if (date < weeks[0].from) return 0; const i = weeks.findIndex(w => date >= w.from && date <= w.to); return i; };
  const rows = weeks.map((w, i) => ({ label: i === 0 ? `This week ${w.from} (incl. overdue)` : `${w.from} – ${w.to}`, ar: 0, ap: 0, po: 0 }));
  for (const e of DB.arLedger.filter(e => inCoF(e) && e.remaining > 0)) { const i = bucket(e.due); if (i >= 0) rows[i].ar += remLCY(e); }
  for (const e of DB.apLedger.filter(e => inCoF(e) && e.remaining > 0)) { const i = bucket(e.due); if (i >= 0) rows[i].ap += remLCY(e); }
  for (const p of DB.docs.filter(d => inCoF(d) && d.type === 'PO' && ['Approved', 'Partially Received', 'Received'].includes(d.status))) {
    const open = sum(p.lines, l => (num(l.qty) - num(l.qtyInvoiced)) * lineCalc(p, { ...l, qty: 1 }).amt);
    const v = vendorOf(p.vendor, p.company) || {}, days = (M(p.company).paymentTerms.find(t => t.code === v.paymentTerms) || {}).days || 0;
    const i = bucket(addDays(p.expectedDate || p.date, days)); if (i >= 0) rows[i].po += open;
  }
  let bal = opening;
  const data = rows.map(r => { const net = r2(r.ar - r.ap - r.po); bal = r2(bal + net); return { ...r, ar: r2(r.ar), ap: r2(r.ap), po: r2(r.po), net, bal }; });
  return pageHead('Cash Flow Forecast (13 weeks)', `Opening cash (Bank Account Ledger): <b>₱ ${money(opening)}</b>. Receivables and payables by due date; purchase orders not yet invoiced by expected date + payment terms.`) + filterBar({}) +
    `<div class="card">${dataTable('cashflow', [{ l: 'Week', k: 'label' }, { l: 'Receivables (in)', k: 'ar', f: 'money' }, { l: 'Payables (out)', k: 'ap', f: 'money' }, { l: 'Open POs (out)', k: 'po', f: 'money' }, { l: 'Net', k: 'net', f: 'money' }, { l: 'Projected Cash', k: 'bal', html: r => `<span class="${r.bal < 0 ? 'bad' : ''}">${money(r.bal)}</span>` }], data, { title: 'Cash Flow Forecast', search: false })}</div>`;
};

/* ---------- Buttons on treasury documents ---------- */
function treasuryButtons(btn) {
  const d = ED;
  if (d.type === 'PAY' && d.status === 'Posted' && d.docKind !== 'Refund' && d.method === 'Check' && !d.voided && canTreasury()) btn('Void Check…', 'voidCheckModal()', 'danger ghost');
  if (['PAY', 'CR'].includes(d.type) && d.status === 'Posted' && !d.unapplied && !d.voided && d.lines.length) btn('Unapply Entries', 'unapplyDoc()', 'ghost');
  if (['PAY', 'CR'].includes(d.type) && d.status === 'Posted') btn('Apply Entries (ledger)…', `go('#/applyent/${d.type === 'PAY' ? 'vendor' : 'customer'}/${encodeURIComponent(d.type === 'PAY' ? d.vendor : d.customer)}')`, 'ghost');
  if (d.type === 'BREC' && d.status === 'Draft') btn('Suggest Lines', 'brecSuggest()');
}
