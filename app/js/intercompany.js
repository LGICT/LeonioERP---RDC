'use strict';
/* ============ Intercompany (BC: IC Partners, IC Outbox / IC Inbox, consolidation with eliminations)
   A posted Sales Invoice / Credit Memo to a customer that is a sister company goes to the IC Outbox.
   The sister company sees it in its IC Inbox, accepts it, and a Purchase Invoice / Credit Memo is created there
   (items, quantities, prices, vendor invoice no.), which then follows the normal approval and posting. ============ */

// Legal names (from your affiliate vendor/customer records) identify each company as an IC partner.
const IC_STOP = new Set(['inc', 'incorporated', 'incorp', 'corp', 'corporation', 'co', 'the', 'company', 'formerly', 'frmly']);
const icKey = name => String(name || '').toLowerCase().replace(/\(.*?\)/g, ' ').split(/[^a-z0-9]+/).filter(w => w && !IC_STOP.has(w)).slice(0, 3).join('');
const icNorm = s => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]/g, '');
/** Which sister company (code) a customer/vendor represents, seen from company `co` */
function icPartnerOf(co, kind, no) {
  const p = kind === 'vendor' ? vendorOf(no, co) : customerOf(no, co); if (!p) return '';
  if (p.icPartner) return p.icPartner === co ? '' : p.icPartner;
  const n = icNorm(p.name);
  const c = DB.companies.find(x => x.code !== co && x.legalName && icKey(x.legalName).length >= 6 && n.includes(icKey(x.legalName)));
  return c ? c.code : '';
}
/** Vendor in the receiving company that represents the sending company (mirror the customer type: trade / non-trade / affiliate) */
function icVendorFor(receiver, sender, custPG) {
  const vs = M(receiver).vendors.filter(v => icPartnerOf(receiver, 'vendor', v.no) === sender && STATUS_USABLE(v));
  const want = /non/i.test(custPG || '') ? /non/i : /trade/i.test(custPG || '') ? /^trade/i : /affil/i;
  return (vs.find(v => want.test(v.postingGroup || '')) || vs.find(v => /affil/i.test(v.postingGroup || '')) || vs[0] || {}).no || '';
}

/* ---------- IC Outbox: hook on sales posting ---------- */
for (const t of ['SI', 'SCM']) {
  const orig = POSTERS[t];
  POSTERS[t] = d => { orig(d); icOutbox(d); };
}
function icOutbox(d) {
  const to = icPartnerOf(d.company, 'customer', d.customer); if (!to) return;
  const cu = customerOf(d.customer, d.company) || {};
  if (!DB.icTransactions) DB.icTransactions = [];
  DB.icTransactions.push({ id: uid(), from: d.company, to, srcType: d.type, srcId: d.id, srcNo: d.no, date: d.date, custPG: cu.postingGroup, extDoc: d.customerPO || '',
    lines: d.lines.map(l => { const c = lineCalc(d, l); return { type: l.type, no: l.no, description: l.description, uom: l.uom, qty: num(l.qty), unitPrice: c.base / (num(l.qty) || 1), base: c.base, vat: c.vat }; }),
    total: docTotals(d).total, status: 'Pending', createdAt: new Date().toISOString(), by: curUser().name });
  d.icTo = to;
}

/* ---------- IC Inbox / Outbox page ---------- */
route('ic', () => {
  const co = S.company, all = DB.icTransactions || [];
  const inbox = all.filter(t => t.to === co).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const outbox = all.filter(t => t.from === co).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const docLink = (co2, id, no) => { const d = DB.docs.find(x => x.id === id); return d ? `<a href="#/doc/${d.type}/${d.id}" onclick="S.company='${co2}'">${esc(no)}</a>` : esc(no || ''); };
  const row = (t, inb) => `<tr><td>${t.date}</td><td>${esc(inb ? t.from : t.to)} – ${esc(companyName(inb ? t.from : t.to))}</td><td>${t.srcType === 'SI' ? 'Sales Invoice → Purchase Invoice' : 'Sales Credit Memo → Purchase Credit Memo'}</td>
    <td>${docLink(t.from, t.srcId, t.srcNo)}</td><td class="num">${money(t.total)}</td><td>${badge(t.status)}${t.rejectReason ? ' <span class="small">' + esc(t.rejectReason) + '</span>' : ''}</td><td>${t.createdDocNo ? docLink(t.to, t.createdDocId, t.createdDocNo) : ''}</td>
    <td>${inb && t.status === 'Pending' ? `<button class="btn sm primary" onclick="icAcceptModal('${t.id}')">Accept…</button> <button class="btn sm danger ghost" onclick="icReject('${t.id}')">Reject</button>` : ''}</td></tr>`;
  const tbl = (rows, inb) => rows.length ? `<table class="grid"><thead><tr><th>Date</th><th>${inb ? 'From' : 'To'}</th><th>Transaction</th><th>Source Document</th><th class="num">Amount</th><th>Status</th><th>Created Document</th><th></th></tr></thead><tbody>${rows.map(t => row(t, inb)).join('')}</tbody></table>` : '<p class="muted">Nothing here.</p>';
  return pageHead(`Intercompany Inbox / Outbox – ${companyName(co)}`, 'Sales invoices and credit memos to sister companies arrive here as incoming transactions. Accept to create the Purchase Invoice / Credit Memo (then approve and post as usual), or reject with a reason.',
    `<button class="btn ghost" onclick="go('#/icpartners')">IC Partners</button>`) +
    `<div class="card"><h3>IC Inbox (incoming – ${inbox.filter(t => t.status === 'Pending').length} pending)</h3>${tbl(inbox, true)}</div><div class="card"><h3>IC Outbox (sent)</h3>${tbl(outbox, false)}</div>`;
});
function icAcceptModal(id) {
  const t = DB.icTransactions.find(x => x.id === id), co = t.to, same = MDS(co) === MDS(t.from);
  const vend = icVendorFor(co, t.from, t.custPG);
  const needAcc = t.lines.filter(l => !(l.type === 'Item' && itemOf(l.no, co)));
  modal(`Accept ${t.srcNo} from ${t.from}`, `<p>Creates a <b>${t.srcType === 'SI' ? 'Purchase Invoice' : 'Purchase Credit Memo'}</b> in ${esc(companyName(co))} with Vendor Invoice No. <b>${esc(t.srcNo)}</b>. ${same ? 'Both companies use the same item list, so items carry over as items.' : 'The two companies use different charts of accounts; choose the account for lines that are not items here.'}</p>
    <div class="form-grid">${fieldHtml({ k: 'vendor', l: `Vendor No. (represents ${t.from})`, t: 'ref', ref: 'vendors', w: 'w2' }, vend, 'ica')}
    ${fieldHtml({ k: 'location', l: 'Location Code (for items)', t: 'ref', ref: 'locations' }, '', 'ica')}${fieldHtml({ k: 'date', l: 'Posting Date', t: 'date' }, today(), 'ica')}
    ${needAcc.length ? fieldHtml({ k: 'account', l: `G/L Account for ${needAcc.length} non-item line(s) (IC G/L mapping; suggested from the line description)`, t: 'ref', ref: 'accounts', w: 'w3' }, icSuggestAccount(co, needAcc, t.from), 'ica') : ''}</div>
    <table class="grid compact"><thead><tr><th>Type</th><th>No.</th><th>Description</th><th class="num">Qty</th><th class="num">Unit Price Excl. VAT</th></tr></thead><tbody>${t.lines.map(l => `<tr><td>${esc(l.type)}</td><td>${esc(l.no)}</td><td>${esc(l.description)}</td><td class="num">${qtyf(l.qty)}</td><td class="num">${money(l.unitPrice)}</td></tr>`).join('')}</tbody></table>`, async () => {
    const q = readForm([{ k: 'vendor' }, { k: 'location' }, { k: 'date' }, { k: 'account' }], 'ica');
    let doc;
    const ok = await commit(() => {
      if (S.company !== co) fail(`Switch to company ${co} to accept.`);
      const v = vendorOf(q.vendor, co); if (!v) fail('Choose the vendor that represents the sending company.');
      const lines = t.lines.map(l => {
        if (l.type === 'Item' && itemOf(l.no, co)) { const nl = { type: 'Item', no: l.no, qty: l.qty }; lineDefaults({ company: co, type: 'PI' }, nl); return { ...nl, unitCost: l.unitPrice }; }
        let acc = q.account;
        if (!acc && same) { const src = l.type === 'Item' ? itemOf(l.no, t.from) : accOf(l.no, t.from); const r = genSetupRow(co, v.genBus, (src || {}).genProd); acc = r && r.purch; }
        if (!acc) fail(`Choose the G/L Account for line "${l.description}".`);
        const nl = { type: 'G/L Account', no: acc, qty: l.qty }; lineDefaults({ company: co, type: 'PI' }, nl);
        return { ...nl, description: l.description, unitCost: l.unitPrice };
      });
      if (lines.some(l => l.type === 'Item' && (itemOf(l.no, co) || {}).type === 'Inventory') && !q.location) fail('Choose the Location Code for the items.');
      doc = { id: uid(), type: t.srcType === 'SI' ? 'PI' : 'PRET', company: co, date: q.date, status: 'Draft', vendor: v.no, vendorInvoiceNo: t.srcNo, refInvoice: t.srcNo, location: q.location,
        remarks: `Intercompany from ${t.from} ${t.srcNo}`, createdBy: curUser().id, createdAt: new Date().toISOString(), approvals: [], dims: {}, lines, icRef: t.id, icFrom: t.from };
      copyPartyToDoc(doc); doc.pricesInclVat = false; doc.date = q.date;
      doc.no = nextNo(doc.type, co); DB.docs.push(doc);
      Object.assign(t, { status: 'Accepted', createdDocId: doc.id, createdDocNo: doc.no, acceptedBy: curUser().name, acceptedAt: new Date().toISOString() });
    }, 'Accepted intercompany transaction', t.srcNo);
    if (ok !== false) { toast(`${DOCS[doc.type].name} ${doc.no} created. Send it for approval and post as usual.`); go(`#/doc/${doc.type}/${doc.id}`); } else return false;
  }, 'Accept', true);
}
/** Suggest an expense/cost account in the receiving company whose name shares the key word of the sender's line (e.g. "Rental Income" → "Rental Expense") */
function icSuggestAccount(co, lines, from) {
  const src = lines.map(l => ((accOf(l.no, from) || {}).name || '') + ' ' + l.description).join(' ').toLowerCase();
  const words = src.split(/[^a-z]+/).filter(w => w.length > 4 && !/income|revenue|sales|other|service|services/.test(w));
  const cand = M(co).accounts.filter(a => a.type === 'Posting' && /^[5-9]/.test(a.no));
  let best = null, bestScore = 0;
  for (const a of cand) { const n = a.name.toLowerCase(), s = words.filter(w => n.includes(w)).length - (/port|vessel|land/.test(n) && !words.some(w => n.includes(w) && /port|vessel|land/.test(w)) ? 0.5 : 0); if (s > bestScore) { best = a; bestScore = s; } }
  return best ? best.no : '';
}
function icReject(id) {
  modal('Reject intercompany transaction', `<label class="fld w3"><span>Reason *</span><textarea id="icr" rows="3"></textarea></label>`, async () => {
    const r = $('#icr').value.trim(); if (!r) { toast('Please give a reason.', 'err'); return false; }
    const ok = await commit(() => { const t = DB.icTransactions.find(x => x.id === id); Object.assign(t, { status: 'Rejected', rejectReason: r, rejectedBy: curUser().name }); }, 'Rejected intercompany transaction');
    if (ok !== false) { toast('Rejected. The sender sees the reason in its IC Outbox (correct with a credit memo).'); render(); } else return false;
  }, 'Reject');
}

/* ---------- IC Partners page ---------- */
route('icpartners', () => {
  const co = S.company, m = M(co);
  const custs = m.customers.map(c => ({ ...c, kind: 'Customer', partner: icPartnerOf(co, 'customer', c.no) })).filter(c => c.partner);
  const vends = m.vendors.map(v => ({ ...v, kind: 'Vendor', partner: icPartnerOf(co, 'vendor', v.no) })).filter(v => v.partner);
  const missing = DB.companies.filter(c => !c.legalName).map(c => c.code);
  return pageHead(`Intercompany Partners – ${companyName(co)}`, `Customers and vendors recognised as sister companies, from each company's legal name (Administration → Companies) or the "IC Partner" field on the customer/vendor card.${missing.length ? ` <b>No legal name yet for: ${esc(missing.join(', '))}</b> – fill it in to link those companies.` : ''}`, `<button class="btn ghost" onclick="go('#/list/companies')">Companies</button>`) +
    `<div class="card">${dataTable('icp', [{ l: 'Type', k: 'kind' }, { l: 'No.', k: 'no' }, { l: 'Name', k: 'name' }, { l: 'Posting Group', k: 'postingGroup' }, { l: 'IC Partner Company', v: r => `${r.partner} – ${companyName(r.partner)}` }], custs.concat(vends), { title: 'IC Partners', link: r => `#/card/${r.kind === 'Customer' ? 'customers' : 'vendors'}/${encodeURIComponent(r.no)}` })}</div>`;
});

/* ---------- IC Reconciliation & consolidated trial balance ---------- */
REPORTS.icrec = function () {
  const cos = DB.companies.map(c => c.code), rows = [];
  for (const a of cos) for (const b of cos) {
    if (a === b) continue;
    const ar = r2(sum(DB.arLedger.filter(e => e.company === a && icPartnerOf(a, 'customer', e.customer) === b), remLCY));
    const ap = r2(sum(DB.apLedger.filter(e => e.company === b && icPartnerOf(b, 'vendor', e.vendor) === a), remLCY));
    const sales = r2(sum(DB.docs.filter(d => d.company === a && ['SI', 'SCM'].includes(d.type) && d.status === 'Posted' && icPartnerOf(a, 'customer', d.customer) === b), d => (d.type === 'SCM' ? -1 : 1) * docTotals(d).subtotal));
    const purch = r2(sum(DB.docs.filter(d => d.company === b && ['PI', 'PRET'].includes(d.type) && d.status === 'Posted' && icPartnerOf(b, 'vendor', d.vendor) === a), d => (d.type === 'PRET' ? -1 : 1) * docTotals(d).subtotal));
    const pending = (DB.icTransactions || []).filter(t => t.from === a && t.to === b && t.status !== 'Rejected' && !(DB.docs.find(x => x.id === t.createdDocId) || {}).postedAt);
    const rejected = (DB.icTransactions || []).filter(t => t.from === a && t.to === b && t.status === 'Rejected');
    if (!ar && !ap && !sales && !purch && !pending.length && !rejected.length) continue;
    rows.push({ pair: `${a} → ${b}`, ar, ap, diffBal: r2(ar - ap), sales, purch, diffPL: r2(sales - purch), pending: pending.length, pendingAmt: r2(sum(pending, 'total')), rejected: rejected.map(t => `${t.srcNo} (₱ ${money(t.total)}): ${t.rejectReason}`).join('; ') });
  }
  return pageHead('Intercompany Reconciliation', 'Receivable of the seller vs payable of the buyer, and intercompany sales vs purchases (excl. VAT). Differences are usually transactions still pending in the IC Inbox, not yet posted, or posted outside the IC flow.') +
    `<div class="card">${dataTable('icrec', [{ l: 'Seller → Buyer', k: 'pair' }, { l: 'Seller receivable', k: 'ar', f: 'money' }, { l: 'Buyer payable', k: 'ap', f: 'money' }, { l: 'Difference', k: 'diffBal', html: r => `<span class="${Math.abs(r.diffBal) > 0.009 ? 'bad' : ''}">${money(r.diffBal)}</span>` },
      { l: 'IC sales', k: 'sales', f: 'money' }, { l: 'IC purchases', k: 'purch', f: 'money' }, { l: 'Difference', k: 'diffPL', html: r => `<span class="${Math.abs(r.diffPL) > 0.009 ? 'bad' : ''}">${money(r.diffPL)}</span>` },
      { l: 'Pending / not posted', v: r => r.pending ? `${r.pending} (₱ ${money(r.pendingAmt)})` : '' }, { l: 'Rejected by buyer (seller to issue credit memo)', k: 'rejected' }], rows, { title: 'IC Reconciliation', search: false })}</div>`;
};
/** Elimination: every G/L entry of documents between two companies of the group is reversed, except VAT, withholding tax and bank lines.
    This removes intercompany sales/purchases, receivables/payables and payments, and puts transferred stock back at original cost. */
function icEliminations(set, cos) {
  const m = DB.md[set], keep = new Set([...m.vatSetup.flatMap(v => [v.salesAcc, v.purchAcc, v.reverseAcc]), ...m.whtSetup.flatMap(w => [w.payableAcc, w.prepaidAcc]), ...m.bankPostGroups.map(b => b.glAccount)].filter(Boolean));
  const out = {};
  for (const g of DB.gl.filter(g => cos.includes(g.company) && g.date <= RF.to && g.partyKind && ['SI', 'SCM', 'PI', 'PRET', 'PAY', 'CR'].includes(g.docType))) {
    const p = icPartnerOf(g.company, g.partyKind, g.party);
    if (!p || !cos.includes(p) || keep.has(g.account)) continue;
    out[g.account] = r2((out[g.account] || 0) - (g.debit - g.credit));
  }
  return out;
}
REPORTS.consol = function (setArg) {
  const set = setArg || MDS(), cos = DB.companies.filter(c => c.md === set).map(c => c.code), m = DB.md[set];
  const elim = icEliminations(set, cos);
  const by = new Map();
  for (const g of DB.gl.filter(g => cos.includes(g.company) && g.date <= RF.to)) {
    const r = by.get(g.account) || { no: g.account, name: (m.accounts.find(a => a.no === g.account) || {}).name || g.account, ...Object.fromEntries(cos.map(c => [c, 0])) };
    r[g.company] = r2(r[g.company] + g.debit - g.credit); by.set(g.account, r);
  }
  for (const a of Object.keys(elim)) if (!by.has(a)) by.set(a, { no: a, name: (m.accounts.find(x => x.no === a) || {}).name || a, ...Object.fromEntries(cos.map(c => [c, 0])) });
  const rows = [...by.values()].map(r => ({ ...r, elim: elim[r.no] || 0, total: r2(sum(cos, c => r[c]) + (elim[r.no] || 0)) })).filter(r => cos.some(c => r[c]) || r.elim).sort((a, b) => a.no.localeCompare(b.no));
  const diff = r2(sum(rows, 'elim'));
  const cols = [{ l: 'Account', k: 'no' }, { l: 'Name', k: 'name' }, ...cos.map(c => ({ l: c, k: c, f: 'money' })), { l: 'IC Eliminations', k: 'elim', f: 'money' }, { l: 'Consolidated', k: 'total', f: 'money' }];
  const foot = `<tr><td colspan="2"><b>Total</b></td>${cos.map(c => `<td class="num"><b>${money(sum(rows, c))}</b></td>`).join('')}<td class="num"><b>${money(diff)}</b></td><td class="num"><b>${money(sum(rows, 'total'))}</b></td></tr>`;
  return pageHead(`Consolidated Trial Balance – ${set}`, `Companies sharing the ${set} chart of accounts: ${cos.join(', ')} · as of ${RF.to}. ${Math.abs(diff) > 0.009 ? `<span class="bad">⚠ Eliminations are out of balance by ${money(diff)}: an intercompany document is posted on one side only (see Intercompany Reconciliation).</span>` : '✔ Eliminations balance.'}`,
    Object.keys(DB.md).map(s => `<button class="btn ${s === set ? 'primary' : ''}" onclick="go('#/report/consol/${s}')">${s}</button>`).join('')) + filterBar({ to: 1, toLabel: 'As of' }) +
    `<div class="card">${dataTable('consol', cols, rows, { title: 'Consolidated TB ' + set, foot })}</div>
    <p class="hint">Companies with different charts of accounts (Land, Mining, Tankering) need a consolidation account mapping before they can be combined; that is not built yet. Unrealized profit is eliminated only for stock still on hand.</p>`;
};
