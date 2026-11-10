'use strict';
/* ============ Sales Contract (NOSPA – Nickel Ore Sale and Purchase Agreement) ============
   Decision 19 / Gap 26. One record holds the commercial terms every later invoice reads: buyer, contract no., grade, volume, price (USD/WMT),
   ports, Laycan, shipment no., seller bank and the deposit schedule (Deposit 1 / Deposit 2 / Provisional, triggered by milestones).
   Flow from MNG-VP-001-03/-04 and CPD-HR-001-01: Draft (VP) → approval → signed by buyer → notarised (Active) → Laycan confirmed → vessel
   confirmed → loaded → closed. Changes after approval go through an Amendment (amendment letter) and are approved again. */

DOCS.NOSPA = { name: 'Sales Contract (NOSPA)', plural: 'Sales Contracts', party: 'customer', lines: 'none', post: false, system: true, noSeries: true, bc: 'Customized (no standard BC page)', head: [] };
DOC_TYPES_FOR_RULES.push('NOSPA');
const NC_TRIGGERS = ['NOSPA finalised', 'Laycan confirmed', 'Vessel confirmed'];
const NC_FINAL_DOCS = [['surveyor', 'Independent Surveyor billing invoice'], ['cow', 'Certificate of Weight (COW)'], ['coq', 'Certificate of Quality (COQ)'], ['lc', 'Laytime Calculation (LC)'], ['fic', 'Final Invoice Computation (FIC)']];
const ncCanEdit = () => isAdmin() || hasRole('Commercial Manager');
const ncDocs = co => DB.docs.filter(d => d.type === 'NOSPA' && (!co || d.company === co));
const ncCommodities = co => M(co).items.filter(i => U(i.uom) === 'WMT' && i.type === 'Inventory').map(i => [i.no, `${i.no} – ${i.description}`]);
const ncCurrencies = co => [['PHP', 'PHP – Philippine Peso']].concat(M(co).currencies.filter(c => isFCY(c.code)).map(c => [c.code, `${c.code} – ${c.description || ''}`]));
const ncValue = d => r2(num(d.volume) * num(d.price));
const ncDepAmt = (d, x) => x.basis === 'Fixed amount' ? r2(num(x.amount)) : r2(ncValue(d) * num(x.pct) / 100);
function ncTriggerAt(d, trig) { return trig === 'NOSPA finalised' ? d.notarizedAt : trig === 'Laycan confirmed' ? d.laycanConfirmedAt : trig === 'Vessel confirmed' ? d.vesselConfirmedAt : ''; }
/* Status of one deposit line: Not yet due → Due → Invoice (draft / pending / approved) → Invoiced → Partly paid → Paid */
const ncInvOf = (d, x) => DB.docs.find(s => s.type === 'SI' && s.prepay && s.prepay.contractId === d.id && s.prepay.uid === x.uid && !['Cancelled', 'Rejected'].includes(s.status));
const ncArOf = (co, no) => DB.arLedger.find(e => e.company === co && e.docType === 'SI' && e.docNo === no);
function ncDepStatus(d, x) {
  const at = ncTriggerAt(d, x.trigger), due = at ? addDays(at, num(x.days) || 0) : '';
  const inv = x.uid ? ncInvOf(d, x) : null;
  if (inv) {
    if (inv.status !== 'Posted') return { st: `Invoice ${inv.status === 'Draft' ? 'draft' : inv.status.toLowerCase()}`, due, inv };
    const e = ncArOf(d.company, inv.no), rem = e ? num(e.remaining) : 0, amt = e ? num(e.amount) : 0;
    return { st: Math.abs(rem) < 0.005 ? 'Paid' : Math.abs(rem - amt) < 0.005 ? 'Invoiced' : 'Partly paid', due, inv, paid: r2(amt - rem), rem };
  }
  return at ? { st: 'Due', due } : { st: 'Not yet due', due: '' };
}
function ncPHP(d, amt) { if (!isFCY(d.currency)) return amt; try { return r2(amt * rateAt(d.currency, today())); } catch (e) { return null; } }

const NC_FIELDS = {
  contract: [{ k: 'contractRef', l: 'Contract No. (as printed on the NOSPA)', req: 1 }, { k: 'date', l: 'NOSPA date', t: 'date', req: 1 }, { k: 'customer', l: 'Buyer (customer)', t: 'ref', ref: 'customers', req: 1, w: 'w2' }],
  commodity: [{ k: 'item', l: 'Commodity', t: 'select', get opts() { return ncCommodities(S.company); }, req: 1 }, { k: 'gradeNi', l: 'Target Ni %', t: 'number' }, { k: 'gradeFe', l: 'Fe %', t: 'number' },
    { k: 'moisture', l: 'Max moisture %', t: 'number' }, { k: 'specNotes', l: 'Other specifications / rejection limits', t: 'textarea', w: 'w2' }],
  price: [{ k: 'volume', l: 'Base volume (WMT)', t: 'number', req: 1 }, { k: 'tolerance', l: 'Tolerance ± %', t: 'number' }, { k: 'currency', l: 'Currency', t: 'select', get opts() { return ncCurrencies(S.company); }, req: 1, noBlank: 1 },
    { k: 'price', l: 'Base price per WMT', t: 'number', req: 1 }, { k: 'priceAdj', l: 'Price adjustment terms (grade, moisture)', t: 'textarea', w: 'w2' }],
  shipment: [{ k: 'loadPort', l: 'Port / anchorage of loading' }, { k: 'dischargePort', l: 'Discharge port' }, { k: 'shipmentNo', l: 'Shipment No.', t: 'ref', ref: 'dim:SHIPMENT NUMBER' },
    { k: 'tentativeShip', l: 'Tentative shipment date', t: 'date' }, { k: 'laycanFrom', l: 'Laycan from', t: 'date' }, { k: 'laycanTo', l: 'Laycan to', t: 'date' }],
  payment: [{ k: 'bank', l: 'Seller bank account (beneficiary)', t: 'ref', ref: 'bankAccounts', w: 'w2' }]
};
const NC_ALL = () => Object.values(NC_FIELDS).flat();
const NC_AMENDABLE = ['gradeNi', 'gradeFe', 'moisture', 'specNotes', 'volume', 'tolerance', 'price', 'priceAdj', 'loadPort', 'dischargePort', 'shipmentNo', 'tentativeShip', 'laycanFrom', 'laycanTo', 'bank'];

function ncNew() {
  const loc = { id: '', type: 'NOSPA', no: '', company: S.company, date: today(), status: 'Draft', createdBy: curUser().id, currency: 'USD', tolerance: 10, loadPort: 'LAMI port', approvals: [], history: [], amendments: [], finalDocs: {},
    deposits: NC_TRIGGERS.map((t, i) => ({ label: ['Deposit 1', 'Deposit 2', 'Provisional Payment'][i], trigger: t, basis: '% of contract value', pct: 0, amount: 0, days: 7 })) };
  const coms = ncCommodities(S.company); if (coms[0]) loc.item = coms[0][0];
  return loc;
}
function ncNextNo(co) { const y = today().slice(0, 4), k = 'NOSPA' + y; DB.meta.seq[k] = (DB.meta.seq[k] || 0) + 1; return `NOSPA-${y}-${pad(DB.meta.seq[k], 3)}`; }

/* ---------- list ---------- */
route('nospa', id => {
  if (id) return ncCard(id);
  const co = S.company, all = ncDocs(co).sort((a, b) => (b.no > a.no ? 1 : -1)), ym = today().slice(0, 7);
  const active = all.filter(d => d.status === 'Active'), dueDeps = [];
  for (const d of all) if (['Active', 'Signed'].includes(d.status)) for (const x of d.deposits) { const s = ncDepStatus(d, x); if (s.st === 'Due') dueDeps.push({ d, x, s }); }
  const usd = sum(active.filter(d => d.currency === 'USD'), ncValue);
  return pageHead('Sales Contracts (NOSPA)', `Nickel ore sale and purchase agreements of <b>${esc(companyName(co))}</b>. Every deposit, provisional and final invoice reads its terms from here.`,
    ncCanEdit() ? '<a class="btn primary" href="#/nospa/new">+ New Sales Contract</a>' : '') +
  `<div class="tiles"><div class="tile"><span>Active contracts</span><b>${active.length}</b><small>notarised, not yet closed</small></div>
    <div class="tile"><span>Waiting for approval</span><b>${all.filter(d => d.status === 'Pending Approval').length}</b><small>new or amended</small></div>
    <div class="tile"><span>Deposits due</span><b>${dueDeps.length}</b><small>milestone reached; to invoice</small></div>
    <div class="tile"><span>Laycan this month</span><b>${all.filter(d => (d.laycanFrom || '').slice(0, 7) === ym && !['Closed', 'Cancelled'].includes(d.status)).length}</b><small>shipments starting</small></div>
    <div class="tile"><span>Active contract value</span><b>$${money(usd)}</b><small>USD contracts</small></div></div>
  ${dueDeps.length ? `<div class="card warn-card"><h3>Deposits due</h3><div class="tbl-wrap"><table class="grid compact"><thead><tr><th>Contract</th><th>Buyer</th><th>Deposit</th><th>Triggered by</th><th>Due date</th><th class="num">Amount</th></tr></thead><tbody>
    ${dueDeps.map(r => `<tr class="link" onclick="go('#/nospa/${r.d.id}')"><td><a href="#/nospa/${r.d.id}">${esc(r.d.no)}</a></td><td>${esc(partyName('customer', r.d.customer, co))}</td><td>${esc(r.x.label)}</td><td>${esc(r.x.trigger)}</td><td>${esc(r.s.due)}</td><td class="num">${esc(r.d.currency)} ${money(ncDepAmt(r.d, r.x))}</td></tr>`).join('')}
    </tbody></table></div><p class="small muted" style="margin:8px 0 0">Invoicing these deposits from the contract is the next build (Deposit 1, Deposit 2 and Provisional prepayment invoices).</p></div>` : ''}
  <div class="card">${all.length ? `<div class="tbl-wrap"><table class="grid"><thead><tr><th>No.</th><th>Contract No.</th><th>Buyer</th><th>Commodity</th><th class="num">Volume (WMT)</th><th class="num">Price / WMT</th><th class="num">Contract value</th><th>Laycan</th><th>Shipment</th><th>Status</th></tr></thead><tbody>
    ${all.map(d => `<tr class="link" onclick="go('#/nospa/${d.id}')"><td><a href="#/nospa/${d.id}">${esc(d.no)}</a></td><td>${esc(d.contractRef || '')}</td><td>${esc(partyName('customer', d.customer, co))}</td><td>${esc((itemOf(d.item, co) || {}).description || d.item || '')}${d.gradeNi ? ` <span class="small muted">Ni ${esc(d.gradeNi)}%</span>` : ''}</td>
      <td class="num">${qtyf(d.volume)}</td><td class="num">${esc(d.currency)} ${money(d.price)}</td><td class="num">${esc(d.currency)} ${money(ncValue(d))}</td><td class="small">${esc(d.laycanFrom || '')}${d.laycanTo ? ' – ' + esc(d.laycanTo) : ''}</td><td>${esc(d.shipmentNo || '')}</td><td>${badge(d.amendDraft && d.status === 'Pending Approval' ? 'Amendment pending' : d.status)}</td></tr>`).join('')}
    </tbody></table></div>` : `<p class="muted" style="margin:0">No sales contracts yet.${ncCanEdit() ? ' Start with <a href="#/nospa/new">+ New Sales Contract</a>.' : ' The Commercial Manager (VP) creates them.'}</p>`}</div>`;
});
const _rdNC = ROUTES.doc;
ROUTES.doc = (type, id) => type === 'NOSPA' ? ROUTES.nospa(id) : _rdNC(type, id);

/* ---------- card ---------- */
let NC = null, NC_AMEND = false;
function ncCard(id) {
  if (id === 'new') { if (!ncCanEdit()) return '<div class="card">Only the Commercial Manager (VP) or the System Admin can create sales contracts.</div>'; if (!NC || NC.id || NC.company !== S.company) NC = ncNew(); NC_AMEND = false; }
  else { const d = DB.docs.find(x => x.id === id && x.type === 'NOSPA'); if (!d) return '<div class="card">Sales contract not found.</div>'; if (!NC || NC.id !== id || !NC_AMEND) { NC = clone(d); NC_AMEND = false; } }
  const d = NC, co = d.company, editing = (d.status === 'Draft' && ncCanEdit()) || NC_AMEND;
  const ro = k => !editing || (NC_AMEND && !NC_AMEND_OK(k));
  const sec = (title, fields) => `<div class="card"><h3>${title}</h3><div class="form-grid">${fields.map(f => fieldHtml(f, d[f.k], 'nc', ro(f.k))).join('')}</div></div>`;
  const val = ncValue(d), php = ncPHP(d, val), depTot = r2(sum(d.deposits, x => ncDepAmt(d, x)));
  const acts = [];
  if (d.status === 'Draft' && ncCanEdit()) acts.push('<button class="btn outline" onclick="ncSave(false)">Save draft</button>', '<button class="btn primary" onclick="ncSave(true)">Submit for approval</button>', d.id ? `<button class="btn danger ghost" onclick="ncDelete()">Delete draft</button>` : '');
  if (NC_AMEND) acts.push('<button class="btn primary" onclick="ncSubmitAmend()">Submit amendment for approval</button>', '<button class="btn ghost" onclick="NC_AMEND=false;NC=null;render()">Discard changes</button>');
  if (!NC_AMEND && d.id && canApprove(DB.docs.find(x => x.id === d.id))) acts.push(`<button class="btn primary" onclick="ncAct('approve')">Approve${d.amendDraft ? ' amendment' : ''}</button>`, `<button class="btn danger ghost" onclick="ersAsk('Reject','Reason for rejecting',r=>ncAct('reject',r),true)">Reject</button>`);
  if (!NC_AMEND && ncCanEdit()) {
    if (d.status === 'Approved') acts.push(`<button class="btn primary" onclick="ncMilestone('signed')">Record buyer's signature</button>`);
    if (d.status === 'Signed') acts.push(`<button class="btn primary" onclick="ncMilestone('notarized')">Record notarisation</button>`);
    if (d.status === 'Active') {
      if (!d.laycanConfirmedAt) acts.push(`<button class="btn primary" onclick="ncMilestone('laycan')">Confirm Laycan</button>`);
      else if (!d.vesselConfirmedAt) acts.push(`<button class="btn primary" onclick="ncMilestone('vessel')">Confirm vessel</button>`);
      else if (!d.loadedAt) acts.push(`<button class="btn primary" onclick="ncMilestone('loaded')">Record loading (B/L)</button>`);
      else acts.push(`<button class="btn outline" onclick="ncMilestone('close')">Close contract</button>`);
    }
    if (['Approved', 'Signed', 'Active'].includes(d.status)) acts.push('<button class="btn outline" onclick="NC_AMEND=true;render()">Amend</button>');
    if (['Approved', 'Signed'].includes(d.status)) acts.push(`<button class="btn danger ghost" onclick="ersAsk('Cancel contract','Reason for cancelling',r=>ncAct('cancel',r),true)">Cancel contract</button>`);
  }
  // after loading: Sales Order (decision 21) → final invoice created from the order
  if (!NC_AMEND && d.id && ['Active', 'Closed'].includes(d.status) && d.loadedAt) {
    const so = ncSOOf(d), fin = ncFinalOf(d);
    if (fin) acts.unshift(`<a class="btn" href="#/doc/SI/${fin.id}">Final invoice ${esc(fin.no)}</a>`);
    if (so) acts.unshift(`<a class="btn ${fin ? '' : 'primary'}" href="#/doc/SO/${so.id}">Sales Order ${esc(so.no)}</a>`);
    else if (d.status === 'Active' && (ncCanBill() || ncCanEdit())) acts.unshift(`<button class="btn primary" onclick="ncMakeSO()">Create Sales Order</button>`);
  }
  return pageHead(d.id ? `Sales Contract ${d.no}` : 'New Sales Contract', `${badge(d.amendDraft && d.status === 'Pending Approval' ? 'Amendment pending' : d.status)} &nbsp;${esc(companyName(co))}${d.customer ? ' · ' + esc(partyName('customer', d.customer, co)) : ''}${d.contractRef ? ' · Contract No. ' + esc(d.contractRef) : ''}`, '<a class="btn ghost" href="#/nospa">← Sales Contracts</a>') +
  (NC_AMEND ? `<div class="hint"><b>Amendment.</b> Change the terms below, then give the amendment letter no. and reason. The contract is approved again before the change applies. Buyer, commodity and currency cannot be amended; cancel and create a new contract instead.</div>
    <div class="card"><div class="form-grid"><label class="fld">Amendment letter no. <input id="am_letter"></label><label class="fld w2">Reason for the amendment <span class="req">*</span><input id="am_reason"></label></div></div>` : '') +
  `<div class="ers-layout"><div>
    ${sec('Buyer and contract', NC_FIELDS.contract)}${sec('Commodity and specification', NC_FIELDS.commodity)}${sec('Quantity and price', NC_FIELDS.price)}${sec('Shipment and Laycan', NC_FIELDS.shipment)}${sec('Payment', NC_FIELDS.payment)}
    <div class="card"><div class="lines-head"><h3 style="margin:0">Deposit schedule</h3>${editing ? '<button class="btn sm" onclick="ncDepAdd()">+ Add line</button>' : ''}</div>
      ${!editing ? `<div class="tbl-wrap"><table class="grid"><thead><tr><th>Payment</th><th>Becomes due when</th><th class="num">Amount (${esc(d.currency)})</th><th>Status</th><th>Due date</th><th>Invoice</th></tr></thead><tbody>
      ${d.deposits.map((x, i) => { const s = ncDepStatus(d, x); return `<tr><td><b>${esc(x.label)}</b><div class="small muted">${x.basis === 'Fixed amount' ? 'fixed amount' : num(x.pct) + '% of value'} · pay within ${esc(x.days)} days</div></td><td>${esc(x.trigger)}</td><td class="num">${money(ncDepAmt(d, x))}</td>
        <td>${d.id ? badge(s.st) : ''}${s.paid ? `<div class="small muted">paid ${money(s.paid)}</div>` : ''}${x.deductedIn ? `<div class="small muted">deducted in ${esc(x.deductedIn)}</div>` : ''}</td><td>${esc(s.due)}</td>
        <td>${s.inv ? `<a href="#/doc/SI/${s.inv.id}">${esc(s.inv.no)}</a>` : s.st === 'Due' && ncCanBill() ? `<button class="btn sm primary" onclick="ncMakeDepInv(${i})">Create invoice</button>` : ''}</td></tr>`; }).join('')}
      </tbody><tfoot><tr><td colspan="2">Total deposits</td><td class="num">${money(depTot)}</td><td colspan="3"></td></tr></tfoot></table></div>` : ''}
      ${editing ? `<div class="tbl-wrap"><table class="grid"><thead><tr><th>Payment</th><th>Becomes due when</th><th>Basis</th><th class="num">%</th><th class="num">Amount (${esc(d.currency)})</th><th class="num">Days to pay</th><th></th></tr></thead><tbody>
      ${d.deposits.map((x, i) => { const s = ncDepStatus(d, x), pctMode = x.basis !== 'Fixed amount', ed = true;
        const inp = (k, v, w, extra = '') => `<input class="num" style="width:${w}px;padding:5px 8px;border:1px solid #d5dce8;border-radius:8px" value="${esc(v)}" onchange="ncDep(${i},'${k}',this.value)" ${extra}>`;
        return `<tr><td>${ed ? `<input style="width:150px;padding:5px 8px;border:1px solid #d5dce8;border-radius:8px" value="${esc(x.label)}" onchange="ncDep(${i},'label',this.value)">` : esc(x.label)}</td>
        <td>${ed ? `<select style="padding:5px;border:1px solid #d5dce8;border-radius:8px" onchange="ncDep(${i},'trigger',this.value)">${optionsHtml(NC_TRIGGERS.map(t => [t, t]), x.trigger, false)}</select>` : esc(x.trigger)}</td>
        <td>${ed ? `<select style="padding:5px;border:1px solid #d5dce8;border-radius:8px" onchange="ncDep(${i},'basis',this.value)">${optionsHtml([['% of contract value', '% of contract value'], ['Fixed amount', 'Fixed amount']], x.basis, false)}</select>` : esc(x.basis)}</td>
        <td class="num">${pctMode ? (ed ? inp('pct', x.pct, 70) : num(x.pct) + '%') : ''}</td><td class="num">${!pctMode && ed ? inp('amount', x.amount, 120) : money(ncDepAmt(d, x))}</td>
        <td class="num">${inp('days', x.days, 60)}</td><td>${s.inv ? `<span class="small muted">${esc(s.inv.no)}</span>` : `<button class="x" title="Remove" onclick="ncDepDel(${i})">🗑</button>`}</td></tr>`; }).join('')}
      </tbody><tfoot><tr><td colspan="4">Total deposits</td><td class="num">${money(depTot)}</td><td colspan="2"></td></tr></tfoot></table></div>` : ''}
      <p class="small muted" style="margin:8px 0 0">Deposit 1 becomes due when the NOSPA is notarised, Deposit 2 when the Laycan is confirmed, the Provisional Payment when the vessel is confirmed. The final invoice (after the COW and COQ) settles the balance.</p></div>
  </div><div class="ers-side">
    <div class="card"><h3>Contract value</h3><div class="kvlist">
      <div><span>Base volume</span><b>${qtyf(d.volume)} WMT${num(d.tolerance) ? ` ± ${esc(d.tolerance)}%` : ''}</b></div><div><span>Base price</span><b>${esc(d.currency)} ${money(d.price)} / WMT</b></div>
      <div><span>Contract value</span><b style="color:var(--primary)">${esc(d.currency)} ${money(val)}</b></div>
      ${isFCY(d.currency) ? `<div><span>In pesos (today's rate)</span><b>${php == null ? '<span class="small muted">no rate entered</span>' : '₱' + money(php)}</b></div>` : ''}
      <div><span>Scheduled deposits</span><b>${esc(d.currency)} ${money(depTot)}</b></div><div><span>Balance on final invoice (est.)</span><b>${esc(d.currency)} ${money(val - depTot)}</b></div></div>
      ${depTot > val + 0.01 ? '<div class="alertbox bad" style="margin-top:10px"><span>⚠</span><div><b>Deposits exceed the contract value</b>Check the percentages.</div></div>' : ''}</div>
    ${d.id && ['Active', 'Closed'].includes(d.status) ? ncSettlementCard(d) : ''}
    <div class="card"><h3>Progress</h3>${ncSteps(d)}${d.id && d.status === 'Pending Approval' && !canApprove(DB.docs.find(x => x.id === d.id)) ? `<p class="muted small" style="margin:0">${esc(whyCannotApprove(DB.docs.find(x => x.id === d.id)))}</p>` : ''}</div>
    ${d.status === 'Active' || d.status === 'Closed' ? `<div class="card"><h3>Final payment documents</h3><div class="kvlist">${NC_FINAL_DOCS.map(([k, l]) => `<label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" ${d.finalDocs && d.finalDocs[k] ? 'checked' : ''} ${ncCanEdit() || hasRole('Accounting Manager - Shared Service') ? '' : 'disabled'} onchange="ncFinalDoc('${k}',this.checked)"> ${esc(l)}</label>`).join('')}</div><p class="small muted" style="margin:8px 0 0">Needed before the final invoice.</p></div>` : ''}
    ${(d.amendDraft && d.status === 'Pending Approval') ? `<div class="card"><h3>Amendment waiting for approval</h3>${ncChangeList(d.amendDraft)}</div>` : ''}
    ${(d.amendments || []).length ? `<div class="card"><h3>Amendments</h3>${d.amendments.map((a, i) => `<div style="margin-bottom:10px"><b>Amendment ${i + 1}${a.letterNo ? ' · letter ' + esc(a.letterNo) : ''}</b> <span class="small muted">${esc(a.at.slice(0, 10))} · ${esc(a.by)}</span><div class="small">${esc(a.reason)}</div>${ncChangeList(a)}</div>`).join('')}</div>` : ''}
    ${d.id ? `<div class="card"><h3>History</h3><div class="kvlist">${(d.history || []).slice().reverse().map(h => `<div style="display:block"><b>${esc(h.action)}</b> <span class="muted small">· ${esc(h.by)} · ${esc(h.at.slice(0, 16).replace('T', ' '))}</span>${h.remarks ? `<div class="small muted">${esc(h.remarks)}</div>` : ''}</div>`).join('')}</div></div>` : ''}
  </div></div><div class="card" style="margin:12px 0 0;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">${acts.join('') || '<span class="muted small">No actions for you at this stage.</span>'}</div>`;
}
const NC_AMEND_OK = k => NC_AMENDABLE.includes(k);
function ncChangeList(a) {
  const names = Object.fromEntries(NC_ALL().map(f => [f.k, f.l]));
  const rows = Object.entries(a.changes || {}).map(([k, [o, n]]) => `<li><b>${esc(names[k] || k)}</b>: ${esc(o === '' || o == null ? '—' : o)} → ${esc(n === '' || n == null ? '—' : n)}</li>`);
  if (a.depChanged) rows.push('<li><b>Deposit schedule</b> changed</li>');
  return rows.length ? `<ul class="small" style="margin:6px 0 0;padding-left:18px">${rows.join('')}</ul>` : '<p class="small muted" style="margin:0">No field changes.</p>';
}
function ncSteps(d) {
  const st = [['Draft', 'Prepared by the VP', !!d.id && d.status !== 'Draft'], ['Approved', 'Internal approval', !!d.approvedAt], ['Signed by buyer', d.signedAt || '', !!d.signedAt],
    ['Notarised', d.notarizedAt ? `${d.notarizedAt}${d.notaryDocNo ? ' · Doc. ' + d.notaryDocNo : ''}` : 'Contract becomes active; Deposit 1 due', !!d.notarizedAt],
    ['Laycan confirmed', d.laycanConfirmedAt ? `${d.laycanFrom || ''} – ${d.laycanTo || ''}` : 'Deposit 2 due', !!d.laycanConfirmedAt],
    ['Vessel confirmed', d.vesselConfirmedAt ? `${d.vesselName || ''}${d.vesselArrival ? ' · arrives ' + d.vesselArrival : ''}` : 'Provisional payment due', !!d.vesselConfirmedAt],
    ['Loaded', d.loadedAt ? `B/L ${d.blDate || d.loadedAt} · ${qtyf(d.loadedWmt)} WMT` : 'Final invoice after COW and COQ', !!d.loadedAt], ['Closed', '', d.status === 'Closed']];
  let nowSet = false;
  return `<div class="wf">${st.map((s, i) => { let cls = s[2] ? 'done' : ''; if (!s[2] && !nowSet && !['Cancelled'].includes(d.status)) { cls = 'now'; nowSet = true; } return `<div class="wf-step ${cls}"><span class="wf-dot">${s[2] ? '✓' : i + 1}</span><div><b>${esc(s[0])}</b><small>${esc(s[1])}</small></div></div>`; }).join('')}${d.status === 'Cancelled' ? '<div class="wf-step stop"><span class="wf-dot">✕</span><div><b>Cancelled</b></div></div>' : ''}</div>`;
}

/* ---------- editing ---------- */
function ncRead() { const vals = readForm(NC_ALL(), 'nc'); for (const f of NC_ALL()) if (f.k in vals && (!NC_AMEND || NC_AMEND_OK(f.k))) NC[f.k] = vals[f.k]; }
function ncDep(i, k, v) { ncRead(); NC.deposits[i][k] = ['pct', 'amount', 'days'].includes(k) ? num(v) : v; const y = $('#main').scrollTop; render(); $('#main').scrollTop = y; }
function ncDepAdd() { ncRead(); NC.deposits.push({ label: 'Additional deposit', trigger: NC_TRIGGERS[0], basis: 'Fixed amount', pct: 0, amount: 0, days: 7 }); render(); }
function ncDepDel(i) { ncRead(); NC.deposits.splice(i, 1); render(); }
function ncValidate(d) {
  requireFields(NC_ALL(), d);
  if (!customerOf(d.customer, d.company)) fail(`Buyer ${d.customer} does not exist.`);
  if (num(d.volume) <= 0) fail('Base volume must be more than zero.');
  if (num(d.price) <= 0) fail('Base price must be more than zero.');
  if (d.laycanFrom && d.laycanTo && d.laycanTo < d.laycanFrom) fail('Laycan "to" date is before the "from" date.');
  if (!d.deposits.length) fail('Add the deposit schedule (Deposit 1, Deposit 2, Provisional Payment).');
  for (const x of d.deposits) if (ncDepAmt(d, x) <= 0) fail(`${x.label}: enter a percentage or an amount.`);
  if (sum(d.deposits, x => ncDepAmt(d, x)) > ncValue(d) + 0.01) fail('The deposits add up to more than the contract value.');
  if (d.bank) { const b = M(d.company).bankAccounts.find(x => x.code === d.bank); if (b && (b.currency || 'PHP') !== (d.currency || 'PHP') && isFCY(d.currency)) fail(`Bank ${d.bank} is in ${b.currency || 'PHP'}; the contract is in ${d.currency}. Choose a ${d.currency} account.`); }
  const dup = DB.docs.find(x => x.type === 'NOSPA' && x.id !== d.id && x.company === d.company && x.contractRef === d.contractRef && x.status !== 'Cancelled');
  if (dup) fail(`Contract No. ${d.contractRef} is already used on ${dup.no}.`);
}
async function ncSave(submit) {
  ncRead(); const wasNew = !NC.id;
  const ok = await commit(() => {
    const d = NC; d.amount = ncValue(d);
    const sh = M(d.company).dimensions.find(x => U(x.code) === 'SHIPMENT NUMBER'); d.dims = sh && d.shipmentNo ? { [sh.code]: d.shipmentNo } : {};
    for (const x of d.deposits) x.uid = x.uid || uid();
    if (submit) ncValidate(d); else if (!d.customer) fail('Select the buyer first.');
    let i = d.id ? DB.docs.findIndex(x => x.id === d.id) : -1;
    if (i < 0) { d.id = uid(); d.no = ncNextNo(d.company); d.createdAt = new Date().toISOString(); DB.docs.push(clone(d)); i = DB.docs.length - 1; ersHist(DB.docs[i], 'Draft saved'); }
    const doc = DB.docs[i]; Object.assign(doc, clone({ ...d, history: doc.history, approvals: doc.approvals }));
    if (submit) { submitForApproval(doc, 'NOSPA'); if (doc.status === 'Approved') doc.approvedAt = today(); ersHist(doc, 'Submitted for approval', `${doc.currency} ${money(doc.amount)}`); }
    NC = clone(doc);
  }, submit ? 'Submitted sales contract' : 'Saved sales contract draft', NC.no);
  if (ok === false) { if (wasNew) { NC.id = ''; NC.no = ''; } return; }
  toast(submit ? `${NC.no} sent for approval${pendingStep(NC) ? ' to ' + pendingStep(NC).role : ''}.` : `Draft ${NC.no} saved.`); go(`#/nospa/${NC.id}`); render();
}
async function ncDelete() { const id = NC.id, no = NC.no; const ok = await commit(() => { DB.docs = DB.docs.filter(x => x.id !== id); }, 'Deleted sales contract draft', no); if (ok !== false) { NC = null; toast('Draft deleted.'); go('#/nospa'); } }
async function ncSubmitAmend() {
  const reason = $('#am_reason').value.trim(), letterNo = $('#am_letter').value.trim();
  if (!reason) return toast('Enter the reason for the amendment.', 'err');
  ncRead();
  const ok = await commit(() => {
    const doc = DB.docs.find(x => x.id === NC.id), next = { ...doc, ...Object.fromEntries(NC_AMENDABLE.map(k => [k, NC[k]])), deposits: clone(NC.deposits) };
    ncValidate(next);
    const changes = {}; for (const k of NC_AMENDABLE) if (String(doc[k] ?? '') !== String(NC[k] ?? '')) changes[k] = [doc[k] ?? '', NC[k] ?? ''];
    const depChanged = JSON.stringify(doc.deposits) !== JSON.stringify(NC.deposits);
    if (!Object.keys(changes).length && !depChanged) fail('Nothing was changed.');
    doc.amendDraft = { at: new Date().toISOString(), by: curUser().name, byId: curUser().id, reason, letterNo, changes, depChanged, values: Object.fromEntries(NC_AMENDABLE.map(k => [k, NC[k]])), deposits: clone(NC.deposits), prevStatus: doc.status };
    // approval chain on the amended value; the person who amends cannot approve it
    doc.approvals = buildChain('NOSPA', { ...next, amount: ncValue(next) }); if (doc.approvals.length) doc.status = 'Pending Approval'; doc.amendBy = curUser().id;
    if (!doc.approvals.length) ncApplyAmend(doc);
    ersHist(doc, 'Amendment submitted', `${letterNo ? 'Letter ' + letterNo + ': ' : ''}${reason}`);
  }, 'Submitted sales contract amendment', NC.no);
  if (ok !== false) { NC_AMEND = false; NC = null; toast('Amendment sent for approval.'); render(); }
}
function ncApplyAmend(doc) {
  const a = doc.amendDraft; Object.assign(doc, a.values); doc.deposits = a.deposits; doc.amount = ncValue(doc);
  (doc.amendments = doc.amendments || []).push({ at: a.at, by: a.by, reason: a.reason, letterNo: a.letterNo, changes: a.changes, depChanged: a.depChanged, approvedAt: today() });
  doc.status = a.prevStatus; delete doc.amendDraft; delete doc.amendBy;
}
async function ncAct(action, remarks) {
  const ok = await commit(() => {
    const doc = DB.docs.find(x => x.id === NC.id);
    if (action === 'approve' || action === 'reject') {
      if (doc.amendBy === curUser().id) fail('You submitted this amendment, so you cannot approve it (segregation of duties).');
      if (action === 'approve') { approveStep(doc, remarks); if (doc.status === 'Approved') { if (doc.amendDraft) { ncApplyAmend(doc); ersHist(doc, 'Amendment approved'); return; } doc.approvedAt = today(); } ersHist(doc, 'Approved'); }
      else { rejectStep(doc, remarks); if (doc.amendDraft) { doc.status = doc.amendDraft.prevStatus; delete doc.amendDraft; delete doc.amendBy; doc.approvals = []; ersHist(doc, 'Amendment rejected', remarks); } else { doc.status = 'Draft'; doc.approvals = []; ersHist(doc, 'Rejected – back to draft', remarks); } }
    } else if (action === 'cancel') { doc.status = 'Cancelled'; ersHist(doc, 'Cancelled', remarks); }
  }, `Sales contract: ${action}`, NC.no);
  if (ok !== false) { NC = null; toast(action === 'approve' ? 'Approved.' : action === 'reject' ? 'Rejected.' : 'Cancelled.'); render(); }
}
function ncMilestone(kind) {
  const d = DB.docs.find(x => x.id === NC.id);
  const F = {
    signed: ['Buyer signature', [{ k: 'signedAt', l: 'Date signed by the buyer', t: 'date', req: 1 }]],
    notarized: ['Notarisation', [{ k: 'notarizedAt', l: 'Date notarised', t: 'date', req: 1 }, { k: 'notaryDocNo', l: 'Notarial document no.' }]],
    laycan: ['Confirm Laycan', [{ k: 'laycanFrom', l: 'Laycan from', t: 'date', req: 1 }, { k: 'laycanTo', l: 'Laycan to', t: 'date', req: 1 }, { k: 'laycanConfirmedAt', l: 'Date confirmed', t: 'date', req: 1 }]],
    vessel: ['Confirm vessel', [{ k: 'vesselName', l: 'Vessel name', req: 1 }, { k: 'vesselArrival', l: 'Arrival date at LAMI port', t: 'date' }, { k: 'vesselConfirmedAt', l: 'Date confirmed', t: 'date', req: 1 }]],
    loaded: ['Record loading', [{ k: 'blDate', l: 'Bill of Lading date', t: 'date', req: 1 }, { k: 'loadedWmt', l: 'Loaded quantity (WMT, draft survey)', t: 'number', req: 1 }, { k: 'loadedAt', l: 'Loading completed', t: 'date', req: 1 }]],
    close: ['Close contract', [{ k: 'closedAt', l: 'Date closed', t: 'date', req: 1 }, { k: 'closeNote', l: 'Remarks (final invoice no., refund or additional billing)', t: 'textarea', w: 'w3' }]]
  }[kind];
  const init = { ...d }; for (const f of F[1]) if (f.t === 'date' && !init[f.k]) init[f.k] = today();
  modal(F[0], `<div class="form-grid">${F[1].map(f => fieldHtml(f, init[f.k], 'ms')).join('')}</div>`, async () => {
    const v = readForm(F[1], 'ms'); try { requireFields(F[1], v); } catch (e) { toast(e.message, 'err'); return false; }
    if (kind === 'laycan' && v.laycanTo < v.laycanFrom) { toast('Laycan "to" date is before the "from" date.', 'err'); return false; }
    const ok = await commit(() => {
      const doc = DB.docs.find(x => x.id === d.id); Object.assign(doc, v);
      if (kind === 'loaded') doc.loadedWmt = num(v.loadedWmt);
      if (kind === 'signed') doc.status = 'Signed';
      if (kind === 'notarized') doc.status = 'Active';
      if (kind === 'close') doc.status = 'Closed';
      ersHist(doc, F[0], F[1].map(f => `${f.l}: ${v[f.k]}`).join(' · '));
    }, `Sales contract: ${F[0]}`, d.no);
    if (ok !== false) { NC = null; toast(`Saved: ${F[0].toLowerCase()}.`); render(); } else return false;
  }, 'Save');
}
async function ncFinalDoc(k, on) { const ok = await commit(() => { const doc = DB.docs.find(x => x.id === NC.id); doc.finalDocs = doc.finalDocs || {}; doc.finalDocs[k] = on; }, `Final document ${k}: ${on ? 'received' : 'not received'}`, NC.no); if (ok !== false) { NC = null; render(); } }
