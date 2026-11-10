'use strict';
/* ============ Request for Quotation (decision 9, gap 4) ============
   Approved Purchase Requisition → RFQ → invite vendors (one Purchase Quote per vendor) → key in each vendor's quote
   → technical review of each quote for equipment and spare parts → comparison sheet → award (approval through the
   Purchase Quote approval rules) → Make Order. From ₱50,000 at least 3 valid quotes are needed, otherwise a written
   justification (sole supplier / fewer quotes). Choosing a quote that is not the lowest compliant one needs a reason.
   Thresholds and the item categories that need a technical review are settings (Purchasing → RFQ settings). */

DOCS.RFQ = { name: 'Request for Quotation', plural: 'Requests for Quotation', lines: 'none', post: false, system: true, noSeries: true, bc: 'Customized (Purchase Quotes per vendor)', head: [] };
ROLES.push('Technical Head');
// quote details on the Purchase Quote page
(() => { const h = DOCS.PQ.head, i = h.findIndex(f => f.k === 'validUntil') + 1; h.splice(i, 0, { k: 'leadTimeDays', l: 'Lead time (days)', t: 'number' }, { k: 'warranty', l: 'Warranty' }, { k: 'quoteTerms', l: 'Payment terms offered' }); })();
const rfqCfg = () => Object.assign({ minQuotes: 3, threshold: 50000, dueDays: 3, techCategories: 'SPP, TREP, TMAIN, TECH, TIRE, USEDTIRE' }, DB.settings.rfq || {});
const rfqTechCats = () => rfqCfg().techCategories.split(/[,\s]+/).map(s => U(s.trim())).filter(Boolean);
const rfqDocs = co => DB.docs.filter(d => d.type === 'RFQ' && (!co || d.company === co));
const rfqPQs = r => DB.docs.filter(x => x.type === 'PQ' && x.rfqId === r.id);
const rfqCanBuy = () => isAdmin() || ERS_SC_ROLES.some(hasRole);
const rfqCanReview = () => isAdmin() || hasRole('Technical Head');
const rfqEst = r => r2(sum(r.lines, l => num(l.qty) * num(l.unitCost)));
function rfqNeedsTech(r) { const co = r.company, cats = rfqTechCats(); return r.techOverride != null ? r.techOverride : r.lines.some(l => l.type === 'Fixed Asset' || (l.type === 'Item' && cats.includes(U((itemOf(l.no, co) || {}).category)))); }
const rfqPriced = pq => pq.lines.length && pq.lines.every(l => num(l.unitCost) > 0);
function rfqQuoteState(r, pq) {
  const inv = (r.vendors || []).find(v => v.pqId === pq.id) || {};
  if (inv.status === 'Declined') return 'Declined';
  if (!rfqPriced(pq)) return 'Waiting';
  if (!rfqNeedsTech(r)) return 'Valid';
  const t = (r.tech || {})[pq.id]; if (!t) return 'For technical review';
  return t.result === 'Not compliant' ? 'Not compliant' : 'Valid';
}
function rfqStage(r) {
  if (r.status === 'Cancelled') return 'Cancelled';
  if (r.status === 'Draft') return 'Draft';
  const aw = r.award && DB.docs.find(x => x.id === r.award.pqId);
  if (aw) {
    if (DB.docs.some(x => x.type === 'PO' && x.pqNo === aw.no && x.company === r.company)) return 'Ordered';
    if (aw.status === 'Approved') return 'Awarded';
    if (aw.status === 'Pending Approval') return 'Award pending approval';
  }
  const pqs = rfqPQs(r), st = pqs.map(p => rfqQuoteState(r, p));
  if (st.includes('For technical review')) return 'Technical review';
  if (st.includes('Valid')) return st.includes('Waiting') && r.dueDate >= today() ? 'Receiving quotes' : 'For award';
  return 'Receiving quotes';
}
function rfqComparison(r) {
  const pqs = rfqPQs(r).filter(p => rfqPriced(p)), valid = pqs.filter(p => rfqQuoteState(r, p) === 'Valid');
  const tot = p => docTotals(p).total * (() => { try { return docRate(p); } catch (e) { return 1; } })();
  const lowest = valid.slice().sort((a, b) => tot(a) - tot(b))[0];
  return { pqs, valid, lowest, tot };
}

/* ---------- start from a Purchase Requisition ---------- */
async function rfqFromPR() {
  let id = '';
  const ok = await commit(() => {
    const pr = dbDoc(); if (pr.status !== 'Approved') fail('The Purchase Requisition must be approved first.');
    const ex = rfqDocs(pr.company).find(x => x.prId === pr.id && x.status !== 'Cancelled'); if (ex) { id = ex.id; return; }
    const y = today().slice(0, 4), k = 'RFQ' + y; DB.meta.seq[k] = (DB.meta.seq[k] || 0) + 1;
    const r = { id: uid(), type: 'RFQ', no: `RFQ-${y}-${pad(DB.meta.seq[k], 4)}`, company: pr.company, prId: pr.id, prNo: pr.no, date: today(), dueDate: addDays(today(), rfqCfg().dueDays),
      location: pr.location || '', purpose: pr.purpose || '', dims: clone(pr.dims || {}), lines: clone(pr.lines), vendors: [], tech: {}, status: 'Draft', createdBy: curUser().id, history: [], approvals: [] };
    DB.docs.push(r); id = r.id; ersHist(r, 'RFQ created', `From ${pr.no}`);
  }, 'Created RFQ from Purchase Requisition', ED.no);
  if (ok !== false) go(`#/rfq/${id}`);
}

/* ---------- list ---------- */
const RFQ_F = { tab: 'open' };
route('rfq', id => id ? rfqCard(id) : rfqList());
function rfqList() {
  const co = S.company, all = rfqDocs(co).map(r => ({ r, st: rfqStage(r) })).sort((a, b) => (b.r.no > a.r.no ? 1 : -1));
  const tabs = { open: ['Open', x => !['Ordered', 'Cancelled'].includes(x.st)], quotes: ['Receiving quotes', x => x.st === 'Receiving quotes'], tech: ['Technical review', x => x.st === 'Technical review'],
    award: ['For award', x => x.st === 'For award'], approval: ['Award pending approval', x => x.st === 'Award pending approval'], done: ['Awarded / ordered', x => ['Awarded', 'Ordered'].includes(x.st)], all: ['All', () => true] };
  const rows = all.filter(tabs[RFQ_F.tab][1]);
  return pageHead('Requests for Quotation', `Canvassing for <b>${esc(companyName(co))}</b>. From ₱${money(rfqCfg().threshold)} at least ${rfqCfg().minQuotes} valid quotes are needed; equipment and spare parts get a technical review. Start an RFQ from an approved Purchase Requisition.`,
    `<a class="btn" href="#/docs/PR">Purchase Requisitions</a>${isAdmin() || hasRole('Supply Chain & Admin Head') ? '<button class="btn" onclick="rfqSettings()">RFQ settings</button>' : ''}`) +
  `<div class="tiles">${['quotes', 'tech', 'award', 'approval'].map(k => `<a class="tile" href="#/rfq" onclick="RFQ_F.tab='${k}'"><span>${tabs[k][0]}</span><b>${all.filter(tabs[k][1]).length}</b><small>${k === 'quotes' ? `${all.filter(x => x.st === 'Receiving quotes' && x.r.dueDate < today()).length} past the deadline` : k === 'tech' ? 'Technical Head' : k === 'award' ? 'Supply Chain' : 'approvers'}</small></a>`).join('')}</div>
  <div class="card"><div class="tbl-tools"><div class="segs">${Object.entries(tabs).map(([k, t]) => `<button class="${RFQ_F.tab === k ? 'on' : ''}" onclick="RFQ_F.tab='${k}';render()">${t[0]} (${all.filter(t[1]).length})</button>`).join('')}</div></div>
  ${rows.length ? `<div class="tbl-wrap"><table class="grid"><thead><tr><th>RFQ</th><th>Requisition</th><th>Purpose</th><th class="num">Estimate</th><th>Deadline</th><th class="num">Quotes</th><th>Technical</th><th>Status</th></tr></thead><tbody>
  ${rows.map(({ r, st }) => { const pq = rfqPQs(r); return `<tr class="link" onclick="go('#/rfq/${r.id}')"><td><a href="#/rfq/${r.id}">${esc(r.no)}</a></td><td>${esc(r.prNo)}</td><td class="small" style="max-width:280px">${esc(String(r.purpose).slice(0, 80))}</td><td class="num">${money(rfqEst(r))}</td>
    <td>${esc(r.dueDate)}${st === 'Receiving quotes' && r.dueDate < today() ? ' <span class="badge s-rejected">late</span>' : ''}</td><td class="num">${pq.filter(rfqPriced).length} / ${pq.length}</td><td class="small">${rfqNeedsTech(r) ? 'Required' : '—'}</td><td>${badge(st)}</td></tr>`; }).join('')}
  </tbody></table></div>` : '<p class="muted" style="margin:0">Nothing here.</p>'}</div>`;
}
function rfqSettings() {
  const c = rfqCfg();
  modal('RFQ settings', `<div class="form-grid"><label class="fld">Minimum valid quotes<input type="number" id="rs_min" value="${c.minQuotes}"></label><label class="fld">From amount (₱)<input type="number" id="rs_th" value="${c.threshold}"></label>
    <label class="fld">Quote deadline (days)<input type="number" id="rs_due" value="${c.dueDays}"></label><label class="fld w3">Item categories that need a technical review<input id="rs_cat" value="${esc(c.techCategories)}"></label></div>
    <p class="small muted">Fixed asset lines always need a technical review. Category codes are your item category codes.</p>`, async () => {
    const ok = await commit(() => { DB.settings.rfq = { minQuotes: num($('#rs_min').value) || 3, threshold: num($('#rs_th').value), dueDays: num($('#rs_due').value) || 3, techCategories: $('#rs_cat').value.trim() }; }, 'Changed RFQ settings');
    if (ok !== false) render(); else return false;
  });
}

/* ---------- RFQ card ---------- */
function rfqCard(id) {
  const r = DB.docs.find(x => x.id === id && x.type === 'RFQ'); if (!r) return '<div class="card">RFQ not found.</div>';
  const co = r.company, st = rfqStage(r), buy = rfqCanBuy(), cfg = rfqCfg(), tech = rfqNeedsTech(r), est = rfqEst(r), cmp = rfqComparison(r);
  const need3 = est >= cfg.threshold, enough = cmp.valid.length >= cfg.minQuotes;
  const pqs = rfqPQs(r), aw = r.award && DB.docs.find(x => x.id === r.award.pqId);
  const acts = [];
  if (r.status === 'Draft' && buy) acts.push(`<button class="btn primary" onclick="rfqSend('${id}')">Send to vendors</button>`);
  if (buy && !['Ordered', 'Cancelled', 'Awarded', 'Award pending approval'].includes(st)) acts.push(`<button class="btn danger ghost" onclick="ersAsk('Cancel RFQ','Reason',x=>rfqCancel('${id}',x),true)">Cancel RFQ</button>`);
  if (st === 'Awarded' && aw && buy) acts.push(`<a class="btn primary" href="#/doc/PQ/${aw.id}">Open awarded quote → Make Order</a>`);
  const po = aw && DB.docs.find(x => x.type === 'PO' && x.pqNo === aw.no && x.company === co);
  if (po) acts.push(`<a class="btn" href="#/doc/PO/${po.id}">Purchase Order ${esc(po.no)}</a>`);
  return pageHead(`RFQ ${r.no}`, `${badge(st)} &nbsp;From <a href="#/doc/PR/${r.prId}">${esc(r.prNo)}</a> · estimate ₱${money(est)} · deadline <b>${esc(r.dueDate)}</b>${tech ? ' · <b>technical review required</b>' : ''}`, '<a class="btn ghost" href="#/rfq">← RFQs</a>') +
  `<div class="ers-layout"><div>
    <div class="card"><h3>Items requested</h3><div class="tbl-wrap"><table class="grid compact"><thead><tr><th>#</th><th>Item / account</th><th>Description</th><th>Part No.</th><th class="num">Qty</th><th>Unit</th><th class="num">Est. unit cost</th></tr></thead><tbody>
      ${r.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.no)}</td><td>${esc(l.description || '')}</td><td>${buy && !r.award ? `<input style="width:150px;padding:4px 7px;border:1px solid #d5dce8;border-radius:7px" value="${esc(l.partNo || '')}" placeholder="part / drawing no." onchange="qarSetPart('${id}',${i},this.value)">` : esc(l.partNo || '')}</td><td class="num">${qtyf(l.qty)}</td><td>${esc(l.uom || '')}</td><td class="num">${money(l.unitCost)}</td></tr>`).join('')}</tbody></table></div>
      <p class="small" style="margin:8px 0 0">${esc(r.purpose)}</p></div>
    <div class="card"><div class="lines-head"><h3 style="margin:0">Vendors invited</h3>${buy && !['Ordered', 'Cancelled', 'Awarded', 'Award pending approval'].includes(st) ? `<span style="display:flex;gap:8px;align-items:center"><span style="min-width:260px">${pickHtml('rq_v', 'vendors', '')}</span><button class="btn sm" onclick="rfqInvite('${id}')">+ Invite</button></span>` : ''}</div>
      ${(r.vendors || []).length ? `<div class="tbl-wrap"><table class="grid"><thead><tr><th>Vendor</th><th>Accreditation</th><th>Quote</th><th class="num">Total (incl. VAT)</th><th>Lead time</th><th>Technical review</th><th></th></tr></thead><tbody>
      ${r.vendors.map(v => { const pq = DB.docs.find(x => x.id === v.pqId), qs = pq ? rfqQuoteState(r, pq) : 'Not sent', t = pq ? (r.tech || {})[pq.id] : null, vs = vaStatus(v.vendor, co); return `<tr><td><b>${esc(v.vendor)}</b> ${esc(partyName('vendor', v.vendor, co))}</td>
        <td>${badge(vs)}</td><td>${pq ? `<a href="#/doc/PQ/${pq.id}">${esc(pq.no)}</a> ${badge(qs)}` : '<span class="muted small">sent when the RFQ is sent</span>'}</td><td class="num">${pq && rfqPriced(pq) ? `${esc(pq.currency || 'PHP')} ${money(qarTotal(pq).total)}` : ''}</td><td>${pq && pq.leadTimeDays ? esc(pq.leadTimeDays) + ' days' : ''}</td>
        <td class="small">${t ? `${badge(t.result)} ${esc(t.by)}${t.remarks ? `<div class="muted">${esc(t.remarks)}</div>` : ''}` : tech && pq && rfqPriced(pq) ? 'Waiting' : ''}</td>
        <td style="white-space:nowrap">${pq && buy && ['Receiving quotes', 'Technical review', 'For award'].includes(st) && v.status !== 'Declined' ? `<button class="btn sm" onclick="rfqQuote('${id}','${pq.id}')">${rfqPriced(pq) ? 'Edit quote' : 'Enter quote'}</button> <button class="btn sm ghost" onclick="rfqDecline('${id}','${pq.id}')">Declined</button>` : ''}
          ${pq && tech && rfqPriced(pq) && rfqCanReview() && r.createdBy !== curUser().id && ['Technical review', 'For award'].includes(st) ? ` <button class="btn sm primary" onclick="rfqReview('${id}','${pq.id}')">${t ? 'Change review' : 'Review'}</button>` : ''}</td></tr>`; }).join('')}
      </tbody></table></div>` : '<p class="muted" style="margin:0">No vendors invited yet. Invite at least ' + cfg.minQuotes + (need3 ? ' (this RFQ is above ₱' + money(cfg.threshold) + ').' : '.') + '</p>'}</div>
    ${typeof qarToolsHtml === 'function' ? qarToolsHtml(r, st, buy) : ''}
    ${cmp.pqs.length ? rfqCompareHtml(r, cmp, st, buy) : ''}
  </div><div class="ers-side">
    <div class="card"><h3>Canvass rules</h3><div class="kvlist"><div><span>Estimate</span><b>₱${money(est)}</b></div><div><span>Valid quotes needed</span><b>${need3 ? cfg.minQuotes : 1}</b></div><div><span>Valid quotes so far</span><b style="color:${(need3 ? enough : cmp.valid.length) ? 'var(--ok)' : 'var(--warn)'}">${cmp.valid.length}</b></div><div><span>Technical review</span><b>${tech ? 'Required' : 'Not required'}</b></div></div>
      ${need3 && !enough && cmp.pqs.length ? `<div class="alertbox warn" style="margin-top:10px"><span>⚠</span><div><b>Fewer than ${cfg.minQuotes} valid quotes</b>Awarding needs a written justification (for example sole supplier or no other response).</div></div>` : ''}
      ${buy && r.status !== 'Draft' && !aw ? `<p class="small" style="margin:10px 0 0"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" ${tech ? 'checked' : ''} onchange="rfqSetTech('${id}',this.checked)"> Technical review for this RFQ</label></p>` : ''}</div>
    ${aw ? `<div class="card"><h3>Award</h3><div class="kvlist"><div><span>Vendor</span><b>${esc(aw.vendor)}</b></div><div><span>Quote</span><b><a href="#/doc/PQ/${aw.id}">${esc(aw.no)}</a></b></div><div><span>Status</span><b>${badge(aw.status)}</b></div></div>
      ${r.award.reason ? `<p class="small" style="margin:8px 0 0"><b>Reason (not the lowest):</b> ${esc(r.award.reason)}</p>` : ''}${r.award.justification ? `<p class="small" style="margin:8px 0 0"><b>Justification (fewer quotes):</b> ${esc(r.award.justification)}</p>` : ''}${approvalPanel(aw).replace('<div class="card">', '<div>')}</div>` : ''}
    <div class="card"><h3>History</h3><div class="kvlist">${(r.history || []).slice().reverse().map(h => `<div style="display:block"><b>${esc(h.action)}</b> <span class="muted small">· ${esc(h.by)} · ${esc(h.at.slice(0, 16).replace('T', ' '))}</span>${h.remarks ? `<div class="small muted">${esc(h.remarks)}</div>` : ''}</div>`).join('')}</div></div>
  </div></div>${acts.length ? `<div class="card" style="margin:12px 0 0;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">${acts.join('')}</div>` : ''}`;
}
function rfqCompareHtml(r, cmp, st, buy) {
  const co = r.company, can = buy && st === 'For award';
  return `<div class="card"><h3>Comparison sheet</h3><div class="tbl-wrap"><table class="grid"><thead><tr><th>Item</th><th class="num">Qty</th>${cmp.pqs.map(p => `<th class="num">${esc(p.vendor)}<div class="small muted" style="font-weight:400">${esc(partyName('vendor', p.vendor, co)).slice(0, 26)}</div></th>`).join('')}</tr></thead><tbody>
    ${r.lines.map((l, i) => { const prices = cmp.pqs.map(p => num((p.lines[i] || {}).unitCost)), lo = Math.min(...prices.filter(x => x > 0)); return `<tr><td>${esc(l.description || l.no)}</td><td class="num">${qtyf(l.qty)}</td>${prices.map(x => `<td class="num" style="${x === lo ? 'color:var(--ok);font-weight:700' : ''}">${x ? money(x) : '—'}</td>`).join('')}</tr>`; }).join('')}
    <tr><td><b>Total (incl. VAT)</b></td><td></td>${cmp.pqs.map(p => `<td class="num"><b>${esc(p.currency || 'PHP')} ${money(docTotals(p).total)}</b>${p.currency ? `<div class="small muted">₱${money(cmp.tot(p))}</div>` : ''}</td>`).join('')}</tr>
    <tr><td>Lead time</td><td></td>${cmp.pqs.map(p => `<td class="num">${p.leadTimeDays ? esc(p.leadTimeDays) + ' days' : '—'}</td>`).join('')}</tr>
    <tr><td>Payment terms</td><td></td>${cmp.pqs.map(p => `<td class="num small">${esc(p.quoteTerms || p.paymentTerms || '—')}</td>`).join('')}</tr>
    <tr><td>Warranty</td><td></td>${cmp.pqs.map(p => `<td class="num small">${esc(p.warranty || '—')}</td>`).join('')}</tr>
    <tr><td>Valid until</td><td></td>${cmp.pqs.map(p => `<td class="num small">${esc(p.validUntil || '—')}</td>`).join('')}</tr>
    <tr><td>Technical</td><td></td>${cmp.pqs.map(p => { const s = rfqQuoteState(r, p); return `<td class="num">${badge(s === 'Valid' ? (rfqNeedsTech(r) ? (r.tech[p.id] || {}).result : 'Valid') : s)}</td>`; }).join('')}</tr>
    <tr><td>Accreditation</td><td></td>${cmp.pqs.map(p => `<td class="num">${badge(vaStatus(p.vendor, co))}</td>`).join('')}</tr>
    <tr class="best"><td><b>Lowest valid quote</b></td><td></td>${cmp.pqs.map(p => `<td class="num">${cmp.lowest && cmp.lowest.id === p.id ? '★ lowest' : ''}</td>`).join('')}</tr>
    ${can ? `<tr><td></td><td></td>${cmp.pqs.map(p => `<td class="num">${rfqQuoteState(r, p) === 'Valid' && vaStatus(p.vendor, co) !== 'Blacklisted' ? `<button class="btn sm ${cmp.lowest && cmp.lowest.id === p.id ? 'primary' : ''}" onclick="rfqAward('${r.id}','${p.id}')">Award</button>` : ''}</td>`).join('')}</tr>` : ''}
  </tbody></table></div><p class="small muted" style="margin:8px 0 0">Green = lowest price per item. Only quotes that are fully priced${rfqNeedsTech(r) ? ' and technically compliant' : ''} count as valid.</p></div>`;
}

/* ---------- actions ---------- */
async function rfqInvite(id) {
  const no = ($('#rq_v') || {}).value ? $('#rq_v').value.trim() : '';
  if (!no) return toast('Choose a vendor.', 'err');
  const ok = await commit(() => {
    const r = DB.docs.find(x => x.id === id), v = vendorOf(no, r.company); if (!v) fail(`Vendor ${no} does not exist.`);
    if (r.vendors.some(x => x.vendor === no)) fail(`${no} is already invited.`);
    const st = vaStatus(no, r.company); if (st === 'Blacklisted') fail(`${v.name} is blacklisted.`);
    r.vendors.push({ vendor: no, invitedAt: today(), status: 'Invited', pqId: '' });
    if (r.status !== 'Draft') rfqMakePQ(r, r.vendors[r.vendors.length - 1]);
    ersHist(r, `Invited ${no}`, VA_OK.includes(st) ? '' : `Note: vendor is ${st.toLowerCase()}`);
  }, 'Invited vendor to RFQ', (DB.docs.find(x => x.id === id) || {}).no);
  if (ok !== false) { const st = vaStatus(no, S.company); toast(VA_OK.includes(st) ? 'Vendor invited.' : `Vendor invited. Note: it is ${st.toLowerCase()}.`); render(); }
}
function rfqMakePQ(r, inv) {
  const pq = { id: uid(), type: 'PQ', no: nextNo('PQ', r.company), company: r.company, date: today(), status: 'Draft', vendor: inv.vendor, location: r.location, prNo: r.prNo, rfqId: r.id, rfqNo: r.no, dims: clone(r.dims || {}),
    createdBy: curUser().id, createdAt: new Date().toISOString(), approvals: [], lines: r.lines.map(l => ({ ...clone(l), unitCost: 0 })) };
  copyPartyToDoc(pq); DB.docs.push(pq); inv.pqId = pq.id; inv.status = 'Sent'; inv.sentAt = today();
}
async function rfqSend(id) {
  const ok = await commit(() => {
    const r = DB.docs.find(x => x.id === id), cfg = rfqCfg();
    if (!r.vendors.length) fail('Invite at least one vendor.');
    if (rfqEst(r) >= cfg.threshold && r.vendors.length < cfg.minQuotes) fail(`This RFQ is ₱${money(rfqEst(r))}; invite at least ${cfg.minQuotes} vendors.`);
    for (const v of r.vendors) if (!v.pqId) rfqMakePQ(r, v);
    r.status = 'Sent'; r.sentAt = today(); ersHist(r, 'Sent to vendors', r.vendors.map(v => v.vendor).join(', '));
  }, 'Sent RFQ to vendors', (DB.docs.find(x => x.id === id) || {}).no);
  if (ok !== false) { toast('RFQ sent: a Purchase Quote was created for each vendor. Send the request to the vendors as you do today, then key in their quotes here.'); render(); }
}
function rfqQuote(id, pqId) {
  const pq = DB.docs.find(x => x.id === pqId), H = [{ k: 'vendorQuoteNo', l: 'Vendor quote no.' }, { k: 'date', l: 'Quote date', t: 'date' }, { k: 'validUntil', l: 'Valid until', t: 'date' }, { k: 'leadTimeDays', l: 'Lead time (days)', t: 'number' },
    { k: 'quoteTerms', l: 'Payment terms offered' }, { k: 'warranty', l: 'Warranty' }, { k: 'remarks', l: 'Remarks', w: 'w3' }];
  modal(`Quote from ${pq.vendor} – ${partyName('vendor', pq.vendor, pq.company)}`, `<div class="form-grid">${H.map(f => fieldHtml(f, pq[f.k], 'qh')).join('')}</div>
    <table class="grid" style="margin-top:12px"><thead><tr><th>Item</th><th class="num">Qty</th><th>Unit price${pq.pricesInclVat ? ' (incl. VAT)' : ' (excl. VAT)'}${pq.currency ? ' ' + esc(pq.currency) : ''}</th></tr></thead><tbody>
    ${pq.lines.map((l, i) => `<tr><td>${esc(l.description || l.no)}</td><td class="num">${qtyf(l.qty)}</td><td><input id="qp_${i}" class="num" style="width:140px;padding:5px 8px;border:1px solid #d5dce8;border-radius:8px" value="${num(l.unitCost) || ''}"></td></tr>`).join('')}</tbody></table>`, async () => {
    const h = readForm(H, 'qh'), prices = pq.lines.map((l, i) => num($('#qp_' + i).value));
    if (prices.some(p => p <= 0)) { toast('Enter a price for every item. If the vendor did not quote an item, mark the vendor as declined or ask for a full quote.', 'err'); return false; }
    const ok = await commit(() => { const d = DB.docs.find(x => x.id === pqId), r = DB.docs.find(x => x.id === id); Object.assign(d, h); d.lines.forEach((l, i) => { l.unitCost = prices[i]; });
      const inv = r.vendors.find(v => v.pqId === pqId); inv.status = 'Quoted'; inv.quotedAt = today(); if (r.tech) delete r.tech[pqId]; ersHist(r, `Quote entered: ${d.vendor}`, `${d.currency || 'PHP'} ${money(docTotals(d).total)}`); }, 'Entered vendor quote', pq.no);
    if (ok !== false) { toast('Quote saved.'); render(); } else return false;
  }, 'Save quote', true);
}
async function rfqDecline(id, pqId) {
  const ok = await commit(() => { const r = DB.docs.find(x => x.id === id), inv = r.vendors.find(v => v.pqId === pqId), pq = DB.docs.find(x => x.id === pqId); inv.status = 'Declined'; pq.status = 'Not Selected'; ersHist(r, `${inv.vendor} declined / no quote`); }, 'Vendor declined RFQ');
  if (ok !== false) render();
}
async function rfqSetTech(id, on) { const ok = await commit(() => { const r = DB.docs.find(x => x.id === id); r.techOverride = on; ersHist(r, on ? 'Technical review switched on' : 'Technical review switched off'); }, 'RFQ technical review setting'); if (ok !== false) render(); }
function rfqReview(id, pqId) {
  const r = DB.docs.find(x => x.id === id), t = (r.tech || {})[pqId] || {}, pq = DB.docs.find(x => x.id === pqId);
  modal(`Technical review: ${pq.vendor} – ${partyName('vendor', pq.vendor, pq.company)}`, `<p class="small muted">Does the quoted item or service meet the specifications (make, model, part no., standards, warranty)?</p>
    <div class="form-grid"><label class="fld">Result<select id="tr_res">${optionsHtml(['Compliant', 'Compliant with conditions', 'Not compliant'].map(x => [x, x]), t.result || 'Compliant', false)}</select></label><label class="fld w3">Remarks / conditions<textarea id="tr_rem" rows="3">${esc(t.remarks || '')}</textarea></label></div>`, async () => {
    const res = $('#tr_res').value, rem = $('#tr_rem').value.trim();
    if (res !== 'Compliant' && !rem) { toast('Explain the conditions or why it is not compliant.', 'err'); return false; }
    const ok = await commit(() => { if (!rfqCanReview()) fail('Only the Technical Head can review quotes.'); const x = DB.docs.find(d => d.id === id); if (x.createdBy === curUser().id) fail('You created this RFQ, so someone else must do the technical review.');
      x.tech = x.tech || {}; x.tech[pqId] = { result: res, remarks: rem, by: curUser().name, at: new Date().toISOString() }; ersHist(x, `Technical review ${pq.vendor}: ${res}`, rem); }, 'Technical review of quote', pq.no);
    if (ok !== false) { toast('Review saved.'); render(); } else return false;
  }, 'Save review');
}
function rfqAward(id, pqId) {
  const r = DB.docs.find(x => x.id === id), cmp = rfqComparison(r), cfg = rfqCfg(), pq = DB.docs.find(x => x.id === pqId);
  const notLowest = cmp.lowest && cmp.lowest.id !== pqId, fewer = rfqEst(r) >= cfg.threshold && cmp.valid.length < cfg.minQuotes;
  modal(`Award to ${pq.vendor} – ${partyName('vendor', pq.vendor, pq.company)}`, `<p>Quote ${esc(pq.no)}: <b>${esc(pq.currency || 'PHP')} ${money(qarTotal(pq).total)}</b>. The award goes through the Purchase Quote approval; after approval, Make Order creates the PO.</p>
    ${notLowest ? `<label class="fld w3"><span>Reason for not choosing the lowest valid quote (${esc(cmp.lowest.vendor)}, ${money(qarTotal(cmp.lowest).total)}) *</span><textarea id="aw_reason" rows="2"></textarea></label>` : ''}
    ${fewer ? `<label class="fld w3" style="margin-top:8px"><span>Justification: only ${cmp.valid.length} valid quote(s) for ₱${money(rfqEst(r))} (rule: ${cfg.minQuotes}) *</span><textarea id="aw_just" rows="2" placeholder="e.g. sole distributor of Komatsu parts in the Philippines"></textarea></label>` : ''}
    ${!VA_OK.includes(vaStatus(pq.vendor, pq.company)) ? `<div class="alertbox warn" style="margin-top:8px"><span>⚠</span><div><b>Vendor is ${esc(vaStatus(pq.vendor, pq.company).toLowerCase())}</b>${vaCfg().enforce ? 'The Purchase Order will be blocked until the vendor is accredited.' : 'Accreditation is not yet required for POs.'}</div></div>` : ''}`, async () => {
    const reason = notLowest ? $('#aw_reason').value.trim() : '', just = fewer ? $('#aw_just').value.trim() : '';
    if (notLowest && !reason) { toast('Give the reason for not choosing the lowest valid quote.', 'err'); return false; }
    if (fewer && !just) { toast('Give the justification for fewer quotes.', 'err'); return false; }
    const ok = await commit(() => {
      const x = DB.docs.find(d => d.id === id), p = DB.docs.find(d => d.id === pqId);
      if (rfqStage(x) !== 'For award') fail('This RFQ is not ready for award.');
      x.award = { pqId, vendor: p.vendor, reason, justification: just, lowest: cmp.lowest ? cmp.lowest.id : '', by: curUser().name, at: new Date().toISOString() };
      p.remarks = [p.remarks, reason ? `Award reason: ${reason}` : '', just ? `Justification: ${just}` : ''].filter(Boolean).join(' | ');
      p.status = 'Draft'; validateDoc(p); submitForApproval(p, 'PQ');
      ersHist(x, `Awarded to ${p.vendor}`, [reason, just].filter(Boolean).join(' | '));
    }, 'Awarded RFQ', r.no);
    if (ok !== false) { const p = DB.docs.find(d => d.id === pqId); toast(p.status === 'Approved' ? 'Awarded. Open the quote and click Make Order.' : `Award sent for approval to ${pendingStep(p).role}.`); render(); } else return false;
  }, 'Award', true);
}
async function rfqCancel(id, reason) {
  const ok = await commit(() => { const r = DB.docs.find(x => x.id === id); r.status = 'Cancelled'; for (const p of rfqPQs(r)) if (['Draft', 'Pending Approval', 'Approved'].includes(p.status)) p.status = 'Cancelled'; ersHist(r, 'Cancelled', reason); }, 'Cancelled RFQ');
  if (ok !== false) { toast('RFQ cancelled.'); render(); }
}
/* a quote that belongs to an RFQ is approved only through the award; a rejected award reopens the RFQ for award */
const _validateDoc_rfq = validateDoc;
validateDoc = function (d) {
  _validateDoc_rfq(d);
  if (d.type === 'PQ' && d.rfqId) { const r = DB.docs.find(x => x.id === d.rfqId); if (r && !(r.award && r.award.pqId === d.id)) fail(`This quote belongs to ${r.no}. Award it from the RFQ comparison sheet.`); }
};
const _rejectStep_rfq = rejectStep;
rejectStep = function (o, c) { _rejectStep_rfq(o, c); if (o.type === 'PQ' && o.rfqId) { const r = DB.docs.find(x => x.id === o.rfqId); if (r && r.award && r.award.pqId === o.id) { ersHist(r, `Award to ${o.vendor} rejected`, c); r.award = null; o.status = 'Draft'; o.approvals = []; } } };
const _relatedPanel_rfq = relatedPanel;
relatedPanel = function () {
  const d = ED, base = _relatedPanel_rfq(); if (!d) return base;
  const r = d.type === 'PQ' && d.rfqId ? DB.docs.find(x => x.id === d.rfqId) : d.type === 'PR' ? rfqDocs(d.company).find(x => x.prId === d.id && x.status !== 'Cancelled') : null;
  return r ? `<div class="card"><h3>Request for Quotation</h3><p style="margin:0"><a href="#/rfq/${r.id}">${esc(r.no)}</a> ${badge(rfqStage(r))} — ${(r.vendors || []).length} vendor(s) invited, deadline ${esc(r.dueDate)}.</p></div>` + base : base;
};
const rfqBadgeCount = () => rfqCanReview() ? rfqDocs(S.company).filter(r => rfqStage(r) === 'Technical review' && r.createdBy !== curUser().id).length : 0;
/* demo user for the technical review */
function rfqMigrate() {
  if (DB.users.some(u => u.id === 'u23')) return false;
  DB.users.push({ id: 'u23', name: 'Technical Head', roles: ['Technical Head'], email: '', department: 'TECH', reportsTo: '' });
  return true;
}
