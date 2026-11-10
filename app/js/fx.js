'use strict';
/* ============ Foreign currency (BC: Currencies, Currency Exchange Rates, Currency Code / Currency Factor on documents,
   realized gain/loss on application, Adjust Exchange Rates, purchase/sale of foreign currency between bank accounts) ============ */
const safeRate = (cur, date) => { try { return rateAt(cur, date); } catch (e) { return ''; } };

// Currency Code + Exchange Rate on documents (after the Posting/Document Date)
const CUR_FIELDS = [{ k: 'currency', l: 'Currency Code (blank = PHP)', t: 'ref', ref: 'currencies' }, { k: 'exchRate', l: 'Exchange Rate (PHP per 1 unit)', t: 'number' }];
for (const t of ['PQ', 'PO', 'PI', 'PRET', 'SI', 'SCM', 'PAY', 'CR']) {
  const h = DOCS[t].head; if (h.some(f => f.k === 'currency')) continue;
  const i = h.findIndex(f => f.k === 'date'); h.splice(i + 1, 0, ...CUR_FIELDS);
}
DOCS.FT.head.splice(DOCS.FT.head.findIndex(f => f.k === 'amount') + 1, 0, { k: 'exchRate', l: 'Deal Exchange Rate (PHP per 1 unit, buying/selling foreign currency)', t: 'number' });
const _copyParty = copyPartyToDoc;
copyPartyToDoc = function (d) {
  _copyParty(d);
  const kind = DOCS[d.type].party; if (!kind || !d[kind]) return;
  const p = kind === 'vendor' ? vendorOf(d[kind], d.company) : customerOf(d[kind], d.company);
  d.currency = p && isFCY(p.currency) ? U(p.currency) : '';
  d.exchRate = d.currency ? safeRate(d.currency, d.date) : '';
};
const _hdrChange = hdrChange;
hdrChange = function (ev) {
  const before = { cur: ED.currency, date: ED.date };
  _hdrChange(ev);
  if (!DOCS[ED.type].head.some(f => f.k === 'currency')) return;
  if (before.cur !== ED.currency || before.date !== ED.date) {
    ED.exchRate = isFCY(ED.currency) ? safeRate(ED.currency, ED.date) : '';
    const el = $('#h_exchRate'); if (el) el.value = ED.exchRate;
    if (before.cur !== ED.currency && DOCS[ED.type].lines === 'apply') { ED.lines = []; return drawDoc(); }
    setTotals();
  }
};
const _totalsHtml = totalsHtml;
totalsHtml = function () {
  const html = _totalsHtml();
  if (!ED || !isFCY(ED.currency) || ['FT'].includes(ED.type)) return html;
  const t = docTotals(ED), R = num(ED.exchRate) || safeRate(ED.currency, ED.date);
  return html.replace(/<\/div>$/, '') + `<div class="trow"><span>Currency</span><b>${esc(ED.currency)} @ ${R || '—'}</b></div><div class="trow"><span>Total in PHP</span><b>${R ? money(t.total * R) : 'no exchange rate'}</b></div></div>`;
};
const _validateDoc = validateDoc;
validateDoc = function (d) {
  _validateDoc(d);
  if (d.currency && !isFCY(d.currency)) d.currency = '';
  if (isFCY(d.currency)) { if (!num(d.exchRate)) d.exchRate = rateAt(d.currency, d.date); if (!M(d.company).currencies.some(c => U(c.code) === U(d.currency))) fail(`Currency ${d.currency} is not set up (Finance → Currencies).`); }
};

/* ---------- Transfer of Funds incl. buying / selling foreign currency between your own banks ---------- */
const carriedRate = (co, bank, date) => { const f = bankBalance(co, bank, date), l = bankBalanceLCY(co, bank, date); return f > 0.004 ? l / f : rateAt(bankCurrency(co, bank), date); };
POSTERS.FT = function postFTfx(d) {
  const co = d.company, amt = r2(num(d.amount)), from = d.fromBank, to = d.toBank;
  if (amt <= 0) fail('Amount must be positive.');
  if (from === to) fail('From and To bank accounts must be different.');
  const fc = bankCurrency(co, from), tc = bankCurrency(co, to);
  if (fc && tc && fc !== tc) fail(`Converting ${fc} directly to ${tc} is not supported; transfer through a PHP account.`);
  if (bankBalance(co, from, d.date) < amt - 0.009) fail(`Bank ${from} balance on ${d.date} is only ${money(bankBalance(co, from, d.date))} ${fc || 'PHP'}.`);
  let toAmt, toLCY, fromLCY;
  if (!fc && !tc) { toAmt = amt; toLCY = fromLCY = amt; }
  else if (fc && fc === tc) { fromLCY = r2(amt * carriedRate(co, from, d.date)); toAmt = amt; toLCY = fromLCY; }
  else if (fc) { const R = num(d.exchRate) || rateAt(fc, d.date); d.exchRate = R; toAmt = r2(amt * R); toLCY = toAmt; fromLCY = r2(amt * carriedRate(co, from, d.date)); } // selling foreign currency
  else { const R = num(d.exchRate) || rateAt(tc, d.date); d.exchRate = R; toAmt = r2(amt / R); toLCY = amt; fromLCY = amt; } // buying foreign currency
  const gl = [{ account: bankGL(co, to), debit: toLCY, desc: `Transfer from ${from}` }, { account: bankGL(co, from), credit: fromLCY, desc: `Transfer to ${to}` }];
  const x = fxLine(co, fc || tc || LCY, r2(fromLCY - toLCY), true, `Realized exchange ${fromLCY > toLCY ? 'loss' : 'gain'} on ${fc ? 'sale' : 'purchase'} of ${fc || tc}`); if (x && (fc || tc)) gl.push(x);
  postGL(d, gl);
  bankPost(d, from, -amt, `Transfer to ${to} ${d.refNo || ''}`, '', -fromLCY);
  bankPost(d, to, toAmt, `Transfer from ${from} ${d.refNo || ''}`, '', toLCY);
  d.toAmount = toAmt;
};

/* ---------- Void check: reverse exactly what the payment posted (incl. realized FX) ---------- */
voidCheckModal = (function (orig) {
  return function () {
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
        const vd = { ...d, date: q.date };
        const orig = DB.gl.filter(g => g.company === co && g.docType === 'PAY' && g.docNo === d.no);
        postGL(vd, orig.map(g => ({ account: g.account, debit: g.credit, credit: g.debit, desc: `VOID ${d.checkNo}: ${q.reason}` })), 'vendor', d.vendor);
        const be = (DB.bankLedger || []).find(e => e.company === co && e.docType === 'PAY' && e.docNo === d.no);
        if (be) bankPost(vd, d.bank, -be.amount, `VOID check ${d.checkNo} – ${q.reason}`, d.checkNo, -(be.amountLCY ?? be.amount));
        Object.assign(d, { voided: true, status: 'Voided', voidReason: q.reason, voidDate: q.date, voidedBy: curUser().id });
      }, 'Voided check', ED.no);
      if (ok !== false) { toast('Check voided. The paid invoices are open again.'); afterChange(ok); } else return false;
    }, 'Void Check');
  };
})(voidCheckModal);

/* ---------- Currency Exchange Rates (group-wide) and Currencies setup ---------- */
MASTERS.fxRates = { title: 'Currency Exchange Rates', single: 'Exchange Rate', key: 'id', group: 'Finance', adminOnly: 'Treasury Assistant Manager',
  desc: 'PHP per 1 unit of foreign currency, by starting date. Documents take the latest rate on or before their posting date; you can override the rate on a document.',
  cols: [{ l: 'Currency', k: 'currency' }, { l: 'Starting Date', k: 'date' }, { l: 'PHP per 1 unit', k: 'rate', num: 1 }],
  fields: [{ k: 'currency', l: 'Currency Code', t: 'ref', ref: 'currencies', req: 1 }, { k: 'date', l: 'Starting Date', t: 'date', req: 1 }, { k: 'rate', l: 'Exchange Rate (PHP per 1 unit)', t: 'number', req: 1 }] };
MASTERS.currencies.cols = [{ l: 'Code', k: 'code' }, { l: 'Description', k: 'description' }, { l: 'Latest rate', v: r => { const x = (DB.fxRates || []).filter(f => U(f.currency) === U(r.code)).sort((a, b) => b.date.localeCompare(a.date))[0]; return x ? `${x.rate} (${x.date})` : '—'; } },
  { l: 'Realized Gains', k: 'realizedGain' }, { l: 'Realized Losses', k: 'realizedLoss' }, { l: 'Unrealized Gains', k: 'unrealizedGain' }, { l: 'Unrealized Losses', k: 'unrealizedLoss' }];
MASTERS.currencies.fields = [{ k: 'code', l: 'Code', req: 1 }, { k: 'description', l: 'Description', w: 'w2' },
  { k: 'realizedGain', l: 'Realized Gains Acc.', t: 'ref', ref: 'accounts' }, { k: 'realizedLoss', l: 'Realized Losses Acc.', t: 'ref', ref: 'accounts' },
  { k: 'unrealizedGain', l: 'Unrealized Gains Acc.', t: 'ref', ref: 'accounts' }, { k: 'unrealizedLoss', l: 'Unrealized Losses Acc.', t: 'ref', ref: 'accounts' }];

/* ---------- Adjust Exchange Rates (month-end unrealized gain/loss) ---------- */
DOCS.FXA = { name: 'Exchange Rate Adjustment', plural: 'Exchange Rate Adjustments', lines: 'fxa', post: false, system: true, bc: 'Adjust Exchange Rates (batch job)', head: [{ k: 'date', l: 'Posting Date', t: 'date' }, { k: 'remarks', l: 'Description', w: 'w2' }] };
WH_COLS.fxa = () => [{ k: 'what', l: 'Entry / Bank', t: 'ro' }, { k: 'currency', l: 'Currency', t: 'ro' }, { k: 'remaining', l: 'Open Amount (currency)', t: 'ro', f: 'money' }, { k: 'oldRate', l: 'Carried Rate', t: 'ro' }, { k: 'newRate', l: 'New Rate', t: 'ro' }, { k: 'adj', l: 'Adjustment (PHP)', t: 'ro', f: 'money' }];
function fxPreview(co, date) {
  const rows = [];
  for (const [kind, ledger] of [['customer', DB.arLedger], ['vendor', DB.apLedger]]) for (const e of ledger.filter(e => e.company === co && isFCY(e.currency) && Math.abs(e.remaining) > 0.004)) {
    const nr = rateAt(e.currency, date), adj = r2(e.remaining * nr) - r2(e.remaining * entryRate(e));
    if (Math.abs(adj) >= 0.01) rows.push({ kind, e, what: `${kind === 'customer' ? 'Customer' : 'Vendor'} ${e[kind]} – ${e.docNo}`, currency: e.currency, remaining: e.remaining, oldRate: r4(entryRate(e)), newRate: nr, adj: r2(adj) });
  }
  for (const b of M(co).bankAccounts.filter(b => (!b.company || b.company === co) && isFCY(b.currency))) {
    const f = bankBalance(co, b.code, date), l = bankBalanceLCY(co, b.code, date); if (Math.abs(f) < 0.004 && Math.abs(l) < 0.004) continue;
    const nr = rateAt(b.currency, date), adj = r2(r2(f * nr) - l);
    if (Math.abs(adj) >= 0.01) rows.push({ kind: 'bank', bank: b.code, what: `Bank ${b.code}`, currency: U(b.currency), remaining: f, oldRate: f ? r4(l / f) : '', newRate: nr, adj });
  }
  return rows;
}
route('fxadjust', () => {
  let rows = [], err = '';
  const date = window.FXA_DATE || today();
  try { rows = fxPreview(S.company, date); } catch (e) { err = e.message; }
  return pageHead('Adjust Exchange Rates', `Revalues open foreign-currency customer and vendor entries and foreign-currency bank balances of <b>${esc(companyName(S.company))}</b> at the exchange rate on the posting date, posting unrealized gains/losses. Run it at month-end after entering the month-end rates.`,
    `<button class="btn primary" onclick="fxAdjustPost()">Post Adjustment</button>`) +
    `<div class="card filters"><div class="form-grid">${fieldHtml({ k: 'date', l: 'Posting Date (rates as of)', t: 'date' }, date, 'fx')}</div><button class="btn" onclick="window.FXA_DATE=$('#fx_date').value;render()">Preview</button></div>
    <div class="card">${err ? `<p class="bad">${esc(err)}</p>` : dataTable('fxprev', [{ l: 'Entry / Bank', k: 'what' }, { l: 'Currency', k: 'currency' }, { l: 'Open Amount', k: 'remaining', f: 'money' }, { l: 'Carried Rate', k: 'oldRate' }, { l: 'New Rate', k: 'newRate' }, { l: 'Adjustment (PHP)', k: 'adj', f: 'money' }], rows, { title: 'FX adjustment preview', search: false, foot: `<tr><td colspan="5"><b>Net adjustment</b></td><td class="num"><b>${money(sum(rows, 'adj'))}</b></td></tr>` })}</div>`;
});
async function fxAdjustPost() {
  const date = $('#fx_date').value; let doc;
  if (!confirm(`Post exchange rate adjustments as of ${date}?`)) return;
  const ok = await commit(() => {
    const co = S.company, rows = fxPreview(co, date); if (!rows.length) fail('Nothing to adjust: all foreign-currency entries are already at these rates.');
    doc = { id: uid(), type: 'FXA', no: nextNo('FXA', co), company: co, date, status: 'Posted', remarks: `Adjust Exchange Rates ${date}`, createdBy: curUser().id, createdAt: new Date().toISOString(), postedAt: new Date().toISOString(), approvals: [], lines: [] };
    const gl = [];
    for (const r of rows) {
      if (r.kind === 'bank') {
        gl.push({ account: bankGL(co, r.bank), debit: r.adj > 0 ? r.adj : 0, credit: r.adj < 0 ? -r.adj : 0, desc: `FX revaluation ${r.bank}` });
        const x = fxLine(co, r.currency, -r.adj, false, `Unrealized exchange ${r.adj > 0 ? 'gain' : 'loss'} ${r.bank}`); if (x) gl.push(x);
        bankPost(doc, r.bank, 0, `FX revaluation @ ${r.newRate}`, '', r.adj);
      } else {
        const p = r.kind === 'customer' ? customerOf(r.e.customer, co) : vendorOf(r.e.vendor, co);
        const acc = r.kind === 'customer' ? customerReceivables(co, p) : vendorPayables(co, p);
        // receivable worth more in PHP = gain; payable worth more in PHP = loss
        if (r.kind === 'customer') { gl.push({ account: acc, debit: r.adj > 0 ? r.adj : 0, credit: r.adj < 0 ? -r.adj : 0, desc: `FX revaluation ${r.e.docNo}` }); const x = fxLine(co, r.currency, -r.adj, false, `Unrealized exchange ${r.adj > 0 ? 'gain' : 'loss'} ${r.e.docNo}`); if (x) gl.push(x); }
        else { gl.push({ account: acc, credit: r.adj > 0 ? r.adj : 0, debit: r.adj < 0 ? -r.adj : 0, desc: `FX revaluation ${r.e.docNo}` }); const x = fxLine(co, r.currency, r.adj, false, `Unrealized exchange ${r.adj > 0 ? 'loss' : 'gain'} ${r.e.docNo}`); if (x) gl.push(x); }
        r.e.adjRate = r.newRate;
      }
      doc.lines.push({ what: r.what, currency: r.currency, remaining: r.remaining, oldRate: r.oldRate, newRate: r.newRate, adj: r.adj });
    }
    postGL(doc, gl); DB.docs.push(doc);
  }, 'Adjusted exchange rates', date);
  if (ok !== false) { toast(`Exchange rate adjustment ${doc.no} posted.`); go(`#/doc/FXA/${doc.id}`); }
}
