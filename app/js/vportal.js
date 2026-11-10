'use strict';
/* ============ Vendor portal (backlog: "Vendor portal") – built for local testing ============
   A separate screen for suppliers at #/vp: sign in with email + PIN, then
   · RFQs they are invited to: enter the quote online (same Purchase Quote and QAR as when Purchasing keys it in) or decline;
     after the award they see "Awarded" or "Not selected" (never other vendors' prices);
   · Purchase Orders: view, print and acknowledge with a promised delivery date;
   · Invoices: submit an invoice against a PO with the PDF; status follows the ERP (Submitted → Under review → Approved for
     payment → Paid, or Returned with the reason);
   · Payments: remittance advice per payment (invoices paid, EWT withheld, check / transfer) and Form 2307 per quarter;
   · Accreditation: status and required documents; upload a document with its expiry (it arrives as "Received" and your
     staff still verify it).
   In the ERP: Purchasing → Vendor Portal Accounts (create accounts, PINs, open the portal as a vendor for testing) and
   Vendor Portal Inbox (what vendors sent; turn a submitted invoice into a Purchase Invoice or return it).
   NOT YET FOR REAL VENDORS: the ERP runs on one PC without real logins or internet access. Before go-live it needs the
   logins / server step, HTTPS, and ICT's security review. Files are kept in the ERP database (max 2 MB each) for now. */

const VP = { uid: (() => { try { return sessionStorage.getItem('leonio-vp') || ''; } catch (e) { return ''; } })(), inv: {}, q: {} };
const vpSave = () => { try { VP.uid ? sessionStorage.setItem('leonio-vp', VP.uid) : sessionStorage.removeItem('leonio-vp'); } catch (e) { } };
const vpAcc = () => (DB.vpUsers || []).find(u => u.id === VP.uid && u.active) || null;
const vpCos = acc => DB.companies.filter(c => c.md === acc.set).map(c => c.code);
const vpVendor = acc => M(vpCos(acc)[0]).vendors.find(v => v.no === acc.vendor) || { no: acc.vendor, name: acc.vendor };
async function vpHash(pin, salt) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
function vpLog(acc, kind, ref, text, extra = {}) { (DB.vpLog = DB.vpLog || []).push({ id: uid(), at: new Date().toISOString(), set: acc.set, vendor: acc.vendor, account: acc.name, kind, ref, text, ...extra }); }
const vpFile = id => (DB.vpFiles || {})[id];
function vpDownload(id) { const f = vpFile(id); if (!f) return toast('File not found.', 'err'); const a = document.createElement('a'); a.href = f.data; a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); }
async function vpReadFile(inp) {
  const f = inp && inp.files && inp.files[0]; if (!f) return null;
  if (f.size > 2 * 1024 * 1024) { toast('The file is larger than 2 MB. Please send a smaller PDF or photo.', 'err'); return false; }
  if (!/pdf|image\//i.test(f.type)) { toast('Please attach a PDF or a photo (JPG / PNG).', 'err'); return false; }
  const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
  return { name: f.name, type: f.type, size: f.size, data };
}
const vpPut = file => { const id = uid(); DB.vpFiles = DB.vpFiles || {}; DB.vpFiles[id] = { ...file, at: new Date().toISOString() }; return id; };

/* portal mode: the ERP menu and top bar are hidden on #/vp pages */
const vpMode = () => document.body.classList.toggle('vp-mode', /^#\/vp(\/|$)/.test(location.hash));
window.addEventListener('hashchange', vpMode); vpMode();

/* ---------- sign-in ---------- */
function vpLoginHtml(msg) {
  return `<div class="vp-wrap"><div class="vp-login card"><div class="vp-brand">🏢 Leonio Group <span>Supplier Portal</span></div>
    <p class="small muted" style="margin:0 0 12px">Sign in with the email and PIN given by Leonio's Supply Chain.</p>
    ${msg ? `<div class="alertbox warn"><span>⚠</span><div>${esc(msg)}</div></div>` : ''}
    <div class="form-grid" style="grid-template-columns:1fr"><label class="fld"><span>Email</span><input id="vp_em" type="email" autocomplete="username"></label>
    <label class="fld"><span>PIN</span><input id="vp_pin" type="password" inputmode="numeric" autocomplete="current-password" onkeydown="if(event.key==='Enter')vpSignIn()"></label></div>
    <button class="btn primary" style="width:100%;margin-top:10px" onclick="vpSignIn()">Sign in</button>
    <p class="small muted" style="margin:14px 0 0">Test version: runs only on Leonio's PC. Accounts are made in the ERP under Purchasing → Vendor Portal Accounts.</p></div></div>`;
}
async function vpSignIn() {
  const em = ($('#vp_em').value || '').trim().toLowerCase(), pin = ($('#vp_pin').value || '').trim();
  const acc = (DB.vpUsers || []).find(u => (u.email || '').toLowerCase() === em);
  if (!acc || !acc.active || !pin || (await vpHash(pin, acc.salt)) !== acc.pinHash) { $('#main').innerHTML = vpLoginHtml('Email or PIN is not correct, or the account is not active.'); return; }
  VP.uid = acc.id; vpSave();
  await commit(() => { const a = DB.vpUsers.find(u => u.id === acc.id); a.lastLogin = new Date().toISOString(); }, '');
  go('#/vp'); render();
}
function vpSignOut() { VP.uid = ''; vpSave(); go('#/vp'); render(); }

/* ---------- frame ---------- */
route('vp', (page, id) => {
  const acc = vpAcc(); if (!acc) return vpLoginHtml();
  const v = vpVendor(acc), tabs = [['', 'Home'], ['rfq', 'Requests for quotation'], ['po', 'Purchase orders'], ['inv', 'Invoices'], ['pay', 'Payments'], ['acc', 'Accreditation']];
  const body = page === 'rfq' ? (id ? vpRfqCard(acc, id) : vpRfqList(acc)) : page === 'po' ? (id ? vpPoCard(acc, id) : vpPoList(acc)) : page === 'inv' ? vpInvPage(acc) : page === 'pay' ? vpPayPage(acc) : page === 'acc' ? vpAccrPage(acc) : vpHome(acc);
  return `<div class="vp-wrap"><div class="vp-head"><div class="vp-brand">🏢 Leonio Group <span>Supplier Portal</span></div>
    <div class="vp-who"><b>${esc(v.name)}</b><span class="small muted">${esc(acc.name)} · ${esc(v.no)}</span></div><button class="btn sm" onclick="vpSignOut()">Sign out</button></div>
    <nav class="vp-tabs">${tabs.map(([k, l]) => `<a href="#/vp${k ? '/' + k : ''}" class="${(page || '') === k ? 'on' : ''}">${l}</a>`).join('')}</nav>${body}
    <p class="small muted" style="text-align:center;margin:18px 0 6px">Leonio Group Supplier Portal · test version</p></div>`;
});

/* ---------- data for the signed-in vendor ---------- */
function vpRfqs(acc) {
  const cos = vpCos(acc);
  return DB.docs.filter(d => d.type === 'RFQ' && cos.includes(d.company) && d.status !== 'Draft' && (d.vendors || []).some(x => x.vendor === acc.vendor && x.pqId))
    .map(r => { const inv = r.vendors.find(x => x.vendor === acc.vendor), pq = DB.docs.find(x => x.id === inv.pqId), st = rfqStage(r);
      const result = st === 'Cancelled' ? 'Cancelled' : r.award ? (r.award.pqId === inv.pqId ? 'Awarded' : 'Not selected') : inv.status === 'Declined' ? 'Declined' : '';
      const open = !result && ['Receiving quotes', 'Technical review', 'For award'].includes(st) && r.dueDate >= today();
      return { r, inv, pq, open, result, quoted: inv.status === 'Quoted' }; }).sort((a, b) => b.r.date.localeCompare(a.r.date));
}
const vpPos = acc => DB.docs.filter(d => d.type === 'PO' && d.vendor === acc.vendor && vpCos(acc).includes(d.company) && ['Approved', 'Partially Received', 'Received', 'Completed'].includes(d.status)).sort((a, b) => b.date.localeCompare(a.date));
const vpInvs = acc => (DB.vpInvoices || []).filter(x => x.set === acc.set && x.vendor === acc.vendor).sort((a, b) => b.at.localeCompare(a.at));
function vpInvStatus(x) {
  const pi = DB.docs.find(d => d.type === 'PI' && d.company === x.company && d.vendor === x.vendor && String(d.vendorInvoiceNo || '').trim().toLowerCase() === x.invNo.toLowerCase());
  if (pi) {
    if (pi.status !== 'Posted') return { s: 'Under review', pi };
    const e = DB.apLedger.find(a => a.company === pi.company && a.docNo === pi.no && a.docType === 'PI');
    return { s: e && Math.abs(e.remaining) < 0.01 ? 'Paid' : 'Approved for payment', pi, due: e && e.due };
  }
  return { s: x.status };
}
const vpPays = acc => DB.docs.filter(d => d.type === 'PAY' && d.status === 'Posted' && d.vendor === acc.vendor && vpCos(acc).includes(d.company) && d.docKind !== 'Refund').sort((a, b) => b.date.localeCompare(a.date));
const vpPoUnbilled = po => r2(sum(po.lines || [], l => Math.max(0, num(l.qtyReceived) - num(l.qtyInvoiced)) * (() => { const c = lineCalc(po, { ...l, qty: 1 }); return c.base + c.vat; })()));

/* ---------- home ---------- */
function vpHome(acc) {
  const rf = vpRfqs(acc), pos = vpPos(acc), invs = vpInvs(acc), co = vpCos(acc)[0], st = vaStatus(acc.vendor, co), sm = vaDocsSummary(acc.vendor, co);
  const todo = [];
  rf.filter(x => x.open && !x.quoted).forEach(x => todo.push(`<a href="#/vp/rfq/${x.r.id}">Quote for ${esc(x.r.no)}</a> – deadline ${esc(x.r.dueDate)}`));
  pos.filter(p => !p.vendorAck).forEach(p => todo.push(`<a href="#/vp/po/${p.id}">Acknowledge PO ${esc(p.no)}</a>${p.expectedDate ? ` – needed by ${esc(p.expectedDate)}` : ''}`));
  invs.filter(x => vpInvStatus(x).s === 'Returned').forEach(x => todo.push(`<a href="#/vp/inv">Invoice ${esc(x.invNo)} was returned</a>: ${esc(x.reason || '')}`));
  sm.missing.forEach(m => todo.push(`<a href="#/vp/acc">Send ${esc(m.q.name)}</a>`)); sm.expiring.forEach(m => todo.push(`<a href="#/vp/acc">Renew ${esc(m.q.name)}</a> (expiring)`));
  const tile = (l, v, s, h) => `<a class="tile" href="${h}"><span>${l}</span><b>${v}</b><small>${s}</small></a>`;
  return `<div class="tiles">${tile('Open RFQs', rf.filter(x => x.open).length, `${rf.filter(x => x.open && !x.quoted).length} waiting for your quote`, '#/vp/rfq')}${tile('Purchase orders', pos.length, `${pos.filter(p => !p.vendorAck).length} to acknowledge`, '#/vp/po')}
    ${tile('Invoices submitted', invs.length, `${invs.filter(x => ['Submitted', 'Under review'].includes(vpInvStatus(x).s)).length} in review`, '#/vp/inv')}${tile('Accreditation', esc(st), `${sm.ok} of ${sm.total} required documents verified`, '#/vp/acc')}</div>
    <div class="card"><h3>To do</h3>${todo.length ? `<ul style="margin:0;padding-left:18px">${todo.map(t => `<li style="margin:4px 0">${t}</li>`).join('')}</ul>` : '<p class="muted" style="margin:0">Nothing to do right now.</p>'}</div>`;
}

/* ---------- RFQs and quotes ---------- */
function vpRfqList(acc) {
  const rows = vpRfqs(acc);
  return `<div class="card"><h3>Requests for quotation</h3>${rows.length ? `<div class="tbl-wrap"><table class="grid"><thead><tr><th>RFQ</th><th>Date</th><th>Deadline</th><th>Items</th><th>Your quote</th><th>Status</th></tr></thead><tbody>
    ${rows.map(x => `<tr class="link" onclick="go('#/vp/rfq/${x.r.id}')"><td><b>${esc(x.r.no)}</b></td><td>${esc(x.r.date)}</td><td class="${x.open && x.r.dueDate <= addDays(today(), 1) ? 'bad' : ''}">${esc(x.r.dueDate)}</td><td class="small">${x.r.lines.slice(0, 2).map(l => esc(l.description || l.no)).join('<br>')}${x.r.lines.length > 2 ? `<br>+${x.r.lines.length - 2} more` : ''}</td>
      <td class="num">${x.quoted && x.pq ? `${esc(x.pq.currency || 'PHP')} ${money(qarTotal(x.pq).total)}` : '—'}</td><td>${badge(x.result || (x.open ? (x.quoted ? 'Quoted' : 'Open') : 'Closed'))}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted" style="margin:0">No requests for quotation yet.</p>'}</div>`;
}
function vpRfqCard(acc, id) {
  const x = vpRfqs(acc).find(y => y.r.id === id); if (!x) return '<div class="card">This RFQ is not available.</div>';
  const { r, pq, open } = x, ro = !open, h = pq || {};
  const inp = (k, l, t = 'text', w = '') => `<label class="fld ${w}"><span>${l}</span><input id="vq_${k}" type="${t}" value="${esc(h[k] ?? '')}" ${ro ? 'disabled' : ''}></label>`;
  return `<div class="card"><div class="lines-head"><div><h3 style="margin:0">${esc(r.no)} ${badge(x.result || (open ? (x.quoted ? 'Quoted' : 'Open') : 'Closed'))}</h3><span class="small muted">Requested ${esc(r.date)} · quote deadline <b>${esc(r.dueDate)}</b> · deliver to ${esc(r.location || '')}</span></div></div>
    ${r.purpose ? `<p class="small" style="margin:6px 0 0">${esc(r.purpose)}</p>` : ''}
    ${x.result === 'Awarded' ? '<div class="alertbox"><span>🎉</span><div><b>Your quote was awarded.</b>A Purchase Order will follow under Purchase orders.</div></div>' : x.result === 'Not selected' ? '<div class="alertbox"><span>ℹ</span><div><b>Another quote was selected.</b>Thank you for quoting.</div></div>' : ''}
    ${!open && !x.result && !x.quoted ? '<div class="alertbox warn"><span>⏰</span><div><b>The deadline has passed.</b>Quotes can no longer be entered.</div></div>' : ''}</div>
  <div class="card"><h3>Your prices</h3><div class="tbl-wrap"><table class="grid compact"><thead><tr><th>#</th><th>Item</th><th>Part no.</th><th class="num">Qty</th><th>Unit</th><th>Your offer (brand / model)</th><th class="num" style="width:150px">Unit price (₱, excl. VAT)</th><th class="num">Amount</th></tr></thead><tbody>
    ${r.lines.map((l, i) => { const p = pq && pq.lines[i] ? pq.lines[i] : {}; return `<tr><td>${i + 1}</td><td>${esc(l.description || l.no)}</td><td class="small">${esc(l.partNo || '')}</td><td class="num">${qtyf(l.qty)}</td><td>${esc(l.uom || '')}</td>
      <td><input id="vq_o${i}" value="${esc(p.offer || '')}" ${ro ? 'disabled' : ''} style="width:100%;min-width:140px"></td><td><input id="vq_p${i}" type="number" step="any" class="num" value="${num(p.unitCost) || ''}" ${ro ? 'disabled' : ''} oninput="vpQuoteTotal('${id}')" style="width:140px"></td><td class="num" id="vq_a${i}">${num(p.unitCost) ? money(num(p.unitCost) * num(l.qty)) : ''}</td></tr>`; }).join('')}
    <tr><td colspan="7"><b>Total (excl. VAT)</b></td><td class="num"><b id="vq_tot">${pq && x.quoted ? money(sum(pq.lines, l => num(l.unitCost) * num(l.qty))) : ''}</b></td></tr></tbody></table></div></div>
  <div class="card"><h3>Terms</h3><div class="form-grid">${inp('vendorQuoteNo', 'Your quotation no.')}${inp('validUntil', 'Valid until', 'date')}${inp('leadTimeDays', 'Delivery lead time (days)', 'number')}${inp('quoteTerms', 'Payment terms')}${inp('warranty', 'Warranty')}${inp('deliveryPoint', 'Delivery point')}
    <label class="fld"><span>Quality</span><select id="vq_qualityTag" ${ro ? 'disabled' : ''}>${optionsHtml(['', 'OEM', 'Genuine', 'Original', 'Replacement / compatible'].map(q => [q, q || '—']), h.qualityTag || '', false)}</select></label>
    ${inp('inclusions', 'Inclusions (delivery, installation …)', 'text', 'w2')}${inp('remarks', 'Remarks', 'text', 'w3')}</div></div>
  ${open ? `<div class="card" style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">${x.quoted ? '' : `<button class="btn ghost" onclick="vpDecline('${id}')">We will not quote</button>`}<button class="btn primary" onclick="vpQuoteSubmit('${id}')">${x.quoted ? 'Update quote' : 'Submit quote'}</button></div>` : ''}`;
}
function vpQuoteTotal(id) {
  const r = DB.docs.find(d => d.id === id); let t = 0;
  r.lines.forEach((l, i) => { const p = num($('#vq_p' + i).value), a = p * num(l.qty); t += a; $('#vq_a' + i).textContent = p ? money(a) : ''; }); $('#vq_tot').textContent = money(t);
}
async function vpQuoteSubmit(id) {
  const acc = vpAcc(), x = vpRfqs(acc).find(y => y.r.id === id); if (!x || !x.open) return toast('This RFQ is closed.', 'err');
  const r = x.r, prices = r.lines.map((l, i) => num($('#vq_p' + i).value)), offers = r.lines.map((l, i) => $('#vq_o' + i).value.trim());
  if (prices.some(p => p <= 0)) return toast('Enter a unit price for every item. If you cannot supply an item, contact Supply Chain.', 'err');
  const g = k => ($('#vq_' + k) || {}).value || '';
  const h = { vendorQuoteNo: g('vendorQuoteNo').trim(), date: today(), validUntil: g('validUntil'), currency: '', leadTimeDays: num(g('leadTimeDays')), quoteTerms: g('quoteTerms').trim(), warranty: g('warranty').trim(), qualityTag: g('qualityTag'), deliveryPoint: g('deliveryPoint').trim(), inclusions: g('inclusions').trim(), discount: 0, pricesInclVat: false, remarks: g('remarks').trim() };
  if (!h.validUntil || h.validUntil < today()) return toast('Enter until when the quote is valid.', 'err');
  if (!h.leadTimeDays) return toast('Enter the delivery lead time in days.', 'err');
  const ok = await commit(() => {
    const rr = DB.docs.find(d => d.id === id), inv = rr.vendors.find(v => v.vendor === acc.vendor);
    if (rr.award || rr.dueDate < today()) fail('This RFQ is closed.');
    qarApplyQuote(rr.id, inv.pqId, h, prices, offers, []);
    const last = (rr.history || [])[rr.history.length - 1]; if (last) last.by = `${acc.name} (vendor portal)`;
    const pq = DB.docs.find(d => d.id === inv.pqId); pq.portalAt = new Date().toISOString(); pq.portalBy = acc.name;
    vpLog(acc, 'Quote', rr.no, `Quote ${x.quoted ? 'updated' : 'submitted'}: PHP ${money(qarTotal(pq).total)}`, { docId: rr.id });
  }, `Vendor portal (${acc.vendor}): quote for ${x.r.no}`, x.r.no);
  if (ok !== false) { toast('Thank you. Your quote has been received.'); render(); }
}
function vpDecline(id) {
  ersAsk('Not quoting', 'Reason (optional, e.g. item not available)', async t => {
    const acc = vpAcc();
    const ok = await commit(() => { const r = DB.docs.find(d => d.id === id), inv = r.vendors.find(v => v.vendor === acc.vendor); inv.status = 'Declined'; const pq = DB.docs.find(d => d.id === inv.pqId); pq.status = 'Not Selected';
      (r.history = r.history || []).push({ at: new Date().toISOString(), by: `${acc.name} (vendor portal)`, action: `${acc.vendor} declined`, remarks: t }); vpLog(acc, 'Quote', r.no, `Declined${t ? ': ' + t : ''}`, { docId: r.id }); }, `Vendor portal (${acc.vendor}): declined RFQ`, '');
    if (ok !== false) render();
  });
}

/* ---------- purchase orders ---------- */
function vpPoList(acc) {
  const rows = vpPos(acc);
  return `<div class="card"><h3>Purchase orders</h3>${rows.length ? `<div class="tbl-wrap"><table class="grid"><thead><tr><th>PO</th><th>Date</th><th>Needed by</th><th class="num">Amount</th><th>Delivery</th><th>Acknowledged</th></tr></thead><tbody>
    ${rows.map(p => `<tr class="link" onclick="go('#/vp/po/${p.id}')"><td><b>${esc(p.no)}</b><div class="small muted">${esc(companyName(p.company))}</div></td><td>${esc(p.date)}</td><td>${esc(p.expectedDate || '—')}</td><td class="num">${money(docTotals(p).total)}</td><td>${badge(p.status === 'Approved' ? 'Open' : p.status)}</td><td>${p.vendorAck ? `✔ ${esc(p.vendorAck.at.slice(0, 10))}` : '<span class="bad">not yet</span>'}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted" style="margin:0">No purchase orders yet.</p>'}</div>`;
}
function vpPoCard(acc, id) {
  const p = vpPos(acc).find(x => x.id === id); if (!p) return '<div class="card">This purchase order is not available.</div>';
  const t = docTotals(p), loc = M(p.company).locations.find(l => l.code === p.location) || {};
  return `<div class="card"><div class="lines-head"><div><h3 style="margin:0">Purchase Order ${esc(p.no)} ${badge(p.status === 'Approved' ? 'Open' : p.status)}</h3><span class="small muted">${esc(companyName(p.company))} · ${esc(p.date)} · deliver to ${esc(loc.name || p.location || '')}${p.expectedDate ? ` · needed by <b>${esc(p.expectedDate)}</b>` : ''} · terms ${esc(p.paymentTerms || '')}</span></div><button class="btn sm" onclick="vpPoPrint('${id}')">🖨 Print</button></div>
    <div class="tbl-wrap"><table class="grid compact"><thead><tr><th>#</th><th>Item</th><th class="num">Qty</th><th>Unit</th><th class="num">Unit price</th><th class="num">Amount</th><th class="num">Received</th></tr></thead><tbody>
    ${p.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.description || l.no)}${l.partNo ? `<div class="small muted">Part no. ${esc(l.partNo)}</div>` : ''}</td><td class="num">${qtyf(l.qty)}</td><td>${esc(l.uom || '')}</td><td class="num">${money(l.unitCost)}</td><td class="num">${money(num(l.qty) * num(l.unitCost))}</td><td class="num">${qtyf(l.qtyReceived || 0)}</td></tr>`).join('')}
    <tr><td colspan="5">Total excl. VAT</td><td class="num">${money(t.subtotal)}</td><td></td></tr><tr><td colspan="5">VAT</td><td class="num">${money(t.vat)}</td><td></td></tr><tr><td colspan="5">Less withholding tax</td><td class="num">${money(-t.wht)}</td><td></td></tr><tr><td colspan="5"><b>Amount payable</b></td><td class="num"><b>${money(t.total)}</b></td><td></td></tr></tbody></table></div>
    ${p.remarks ? `<p class="small" style="margin:8px 0 0">${esc(p.remarks)}</p>` : ''}</div>
  <div class="card"><h3>Acknowledgement</h3>${p.vendorAck ? `<p style="margin:0">✔ Acknowledged by <b>${esc(p.vendorAck.by)}</b> on ${esc(p.vendorAck.at.slice(0, 10))}. Promised delivery: <b>${esc(p.vendorAck.promised || '—')}</b>${p.vendorAck.note ? ` · ${esc(p.vendorAck.note)}` : ''}</p>`
    : `<div class="form-grid"><label class="fld"><span>We will deliver on</span><input type="date" id="vpa_d" value="${esc(p.expectedDate || addDays(today(), 7))}"></label><label class="fld w2"><span>Remarks (optional)</span><input id="vpa_n"></label></div><button class="btn primary" style="margin-top:10px" onclick="vpAck('${id}')">✔ Acknowledge this PO</button>`}</div>
  <div class="card"><p class="small muted" style="margin:0">Delivered? Submit your invoice under <a href="#/vp/inv">Invoices</a> once the goods are received or the service accepted.</p></div>`;
}
async function vpAck(id) {
  const acc = vpAcc(), d = $('#vpa_d').value, n = $('#vpa_n').value.trim(); if (!d) return toast('Enter the delivery date.', 'err');
  const ok = await commit(() => { const p = DB.docs.find(x => x.id === id); if (p.vendor !== acc.vendor) fail('Not your PO.'); p.vendorAck = { at: new Date().toISOString(), by: acc.name, promised: d, note: n }; vpLog(acc, 'PO acknowledged', p.no, `Delivery promised ${d}${n ? ' – ' + n : ''}`, { docId: p.id }); },
    `Vendor portal (${acc.vendor}): PO acknowledged`, (DB.docs.find(x => x.id === id) || {}).no);
  if (ok !== false) { toast('PO acknowledged. Thank you.'); render(); }
}
function vpPoPrint(id) {
  const p = DB.docs.find(x => x.id === id), t = docTotals(p), v = vendorOf(p.vendor, p.company) || {}, w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print.', 'err');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.no)}</title><style>body{font:12px Arial;margin:14mm} table{border-collapse:collapse;width:100%;margin:10px 0} td,th{border:1px solid #555;padding:4px 6px} th{background:#eee} .n{text-align:right}</style></head><body>
    <h2 style="margin:0">${esc((DB.companies.find(c => c.code === p.company) || {}).legalName || companyName(p.company))}</h2><h3>PURCHASE ORDER ${esc(p.no)}</h3>
    <p>Vendor: <b>${esc(v.name || p.vendor)}</b> (${esc(p.vendor)})<br>Date: ${esc(p.date)} · Needed by: ${esc(p.expectedDate || '—')} · Payment terms: ${esc(p.paymentTerms || '')}</p>
    <table><tr><th>#</th><th>Item</th><th class="n">Qty</th><th>Unit</th><th class="n">Unit price</th><th class="n">Amount</th></tr>${p.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.description || l.no)}</td><td class="n">${qtyf(l.qty)}</td><td>${esc(l.uom || '')}</td><td class="n">${money(l.unitCost)}</td><td class="n">${money(num(l.qty) * num(l.unitCost))}</td></tr>`).join('')}
    <tr><td colspan="5">Total excl. VAT</td><td class="n">${money(t.subtotal)}</td></tr><tr><td colspan="5">VAT</td><td class="n">${money(t.vat)}</td></tr><tr><td colspan="5">Less withholding tax</td><td class="n">${money(-t.wht)}</td></tr><tr><td colspan="5"><b>Amount payable</b></td><td class="n"><b>${money(t.total)}</b></td></tr></table>
    <p>${esc(p.remarks || '')}</p><p style="font-size:10px;color:#555">Printed from the Leonio Group Supplier Portal on ${new Date().toLocaleString('en-PH')}.</p><script>setTimeout(()=>print(),300)<\/script></body></html>`); w.document.close();
}

/* ---------- invoices ---------- */
function vpInvPage(acc) {
  const rows = vpInvs(acc), pos = vpPos(acc);
  const stHtml = x => { const s = vpInvStatus(x); return badge(s.s) + (s.s === 'Approved for payment' && s.due ? `<div class="small muted">due ${esc(s.due)}</div>` : '') + (s.s === 'Returned' && x.reason ? `<div class="small bad">${esc(x.reason)}</div>` : ''); };
  return `<div class="card"><h3>Submit an invoice</h3>${pos.length ? `<div class="form-grid">
      <label class="fld w2"><span>For purchase order *</span><select id="vi_po" onchange="vpInvHint()">${optionsHtml([['', ''], ...pos.map(p => [p.id, `${p.no} – ${companyName(p.company)} – ₱${money(docTotals(p).total)}`])], VP.inv.po || '', false)}</select></label>
      <label class="fld"><span>Your invoice no. *</span><input id="vi_no"></label><label class="fld"><span>Invoice date *</span><input id="vi_dt" type="date" value="${today()}"></label>
      <label class="fld"><span>Invoice amount, incl. VAT (₱) *</span><input id="vi_amt" type="number" step="any"></label>
      <label class="fld w2"><span>Invoice copy (PDF or photo, max 2 MB) *</span><input id="vi_file" type="file" accept=".pdf,image/*"></label>
      <label class="fld w3"><span>Remarks</span><input id="vi_note"></label></div><p id="vi_hint" class="small muted" style="margin:6px 0 0"></p>
      <button class="btn primary" style="margin-top:10px" onclick="vpInvSubmit()">Submit invoice</button>` : '<p class="muted" style="margin:0">You can submit an invoice once you have a purchase order.</p>'}</div>
  <div class="card"><h3>Your invoices</h3>${rows.length ? `<div class="tbl-wrap"><table class="grid"><thead><tr><th>Invoice no.</th><th>Date</th><th>PO</th><th class="num">Amount</th><th>Submitted</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map(x => `<tr><td><b>${esc(x.invNo)}</b></td><td>${esc(x.invDate)}</td><td>${esc(x.poNo)}</td><td class="num">${money(x.amount)}</td><td class="small">${esc(x.at.slice(0, 10))}</td><td>${stHtml(x)}</td><td>${x.fileId ? `<button class="btn sm ghost" onclick="vpDownload('${x.fileId}')">📎</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted" style="margin:0">No invoices submitted yet.</p>'}
    <p class="small muted" style="margin:8px 0 0">Submitted → Under review (Accounts Payable is checking it) → Approved for payment (with due date) → Paid. A returned invoice shows the reason; submit a corrected one.</p></div>`;
}
function vpInvHint() { const p = DB.docs.find(d => d.id === $('#vi_po').value), el = $('#vi_hint'); if (!el) return; el.textContent = p ? `Received and not yet invoiced on ${p.no}: ₱${money(vpPoUnbilled(p))} incl. VAT.` : ''; }
async function vpInvSubmit() {
  const acc = vpAcc(), po = DB.docs.find(d => d.id === $('#vi_po').value), no = $('#vi_no').value.trim(), dt = $('#vi_dt').value, amt = num($('#vi_amt').value), note = $('#vi_note').value.trim();
  if (!po) return toast('Choose the purchase order.', 'err'); if (!no) return toast('Enter your invoice number.', 'err'); if (!dt || dt > today()) return toast('Enter the invoice date (not in the future).', 'err'); if (amt <= 0) return toast('Enter the invoice amount.', 'err');
  const file = await vpReadFile($('#vi_file')); if (file === false) return; if (!file) return toast('Attach a copy of the invoice.', 'err');
  if (vpInvs(acc).some(x => x.invNo.toLowerCase() === no.toLowerCase() && vpInvStatus(x).s !== 'Returned')) return toast(`Invoice ${no} was already submitted.`, 'err');
  const ok = await commit(() => {
    const fileId = vpPut(file);
    (DB.vpInvoices = DB.vpInvoices || []).push({ id: uid(), set: acc.set, vendor: acc.vendor, company: po.company, poId: po.id, poNo: po.no, invNo: no, invDate: dt, amount: r2(amt), note, fileId, status: 'Submitted', at: new Date().toISOString(), by: acc.name, expected: vpPoUnbilled(po) });
    vpLog(acc, 'Invoice', po.no, `Invoice ${no} submitted: ₱${money(amt)}`, { docId: po.id });
  }, `Vendor portal (${acc.vendor}): invoice ${no} submitted`, po.no);
  if (ok !== false) { toast('Invoice submitted. Accounts Payable will review it.'); VP.inv = {}; render(); }
}

/* ---------- payments ---------- */
function vpPayPage(acc) {
  const pays = vpPays(acc), cos = vpCos(acc);
  const quarters = []; for (const co of cos) { const ls = typeof birLines === 'function' ? birLines(co, `${+today().slice(0, 4) - 1}-01-01`, today()).filter(l => l.vendor === acc.vendor) : [];
    for (const l of ls) { const q = `${l.date.slice(0, 4)}-Q${Math.ceil(+l.date.slice(5, 7) / 3)}`, k = co + '|' + q, o = quarters.find(x => x.k === k) || (quarters.push({ k, co, q, tax: 0 }), quarters[quarters.length - 1]); o.tax += l.tax; } }
  return `<div class="card"><h3>Payments received</h3>${pays.length ? pays.map(p => { const lines = (p.lines || []).map(a => { const pi = DB.docs.find(d => d.company === p.company && d.no === a.docNo) || {}; const t = pi.lines ? docTotals(pi) : {}; return { a, pi, t }; });
      return `<div class="vp-pay"><div class="lines-head"><div><b>${esc(p.date)}</b> · ${esc(p.method || '')}${p.checkNo ? ` · check no. ${esc(p.checkNo)}` : ''} · ${esc(companyName(p.company))} <span class="small muted">(${esc(p.no)})</span></div><b>₱${money(p.amount)}</b></div>
        <table class="grid compact"><thead><tr><th>Your invoice</th><th class="num">Invoice amount (incl. VAT)</th><th class="num">Withholding tax</th><th class="num">Paid</th></tr></thead><tbody>${lines.map(({ a, pi, t }) => `<tr><td>${esc(pi.vendorInvoiceNo || a.docNo)}</td><td class="num">${t.subtotal != null ? money(t.subtotal + t.vat) : ''}</td><td class="num">${t.wht != null ? money(t.wht) : ''}</td><td class="num">${money(a.amount)}</td></tr>`).join('')}</tbody></table>
        <button class="btn sm ghost" style="margin-top:6px" onclick="vpRemit('${p.id}')">🖨 Remittance advice</button></div>`; }).join('') : '<p class="muted" style="margin:0">No payments yet.</p>'}</div>
  <div class="card"><h3>BIR Form 2307 (tax withheld)</h3>${quarters.length ? `<table class="grid compact"><thead><tr><th>Company</th><th>Quarter</th><th class="num">Tax withheld</th><th></th></tr></thead><tbody>${quarters.sort((a, b) => b.q.localeCompare(a.q)).map(x => `<tr><td>${esc(companyName(x.co))}</td><td>${esc(x.q)}</td><td class="num">${money(x.tax)}</td><td><button class="btn sm" onclick="vp2307('${x.co}','${x.q}')">🖨 2307</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted" style="margin:0">No tax withheld yet.</p>'}</div>`;
}
function vp2307(co, q) { const acc = vpAcc(); Object.assign(BIR, { co, year: q.slice(0, 4), kind: 'Q', q: q.slice(-1) }); bir2307([acc.vendor]); }
function vpRemit(id) {
  const p = DB.docs.find(x => x.id === id), acc = vpAcc(); if (!p || p.vendor !== acc.vendor) return; const v = vpVendor(acc), w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print.', 'err');
  const rows = (p.lines || []).map(a => { const pi = DB.docs.find(d => d.company === p.company && d.no === a.docNo) || {}; const t = pi.lines ? docTotals(pi) : { subtotal: 0, vat: 0, wht: 0 }; return `<tr><td>${esc(pi.vendorInvoiceNo || a.docNo)}</td><td>${esc(pi.date || '')}</td><td class="n">${money(t.subtotal + t.vat)}</td><td class="n">${money(t.wht)}</td><td class="n">${money(a.amount)}</td></tr>`; }).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Remittance ${esc(p.no)}</title><style>body{font:12px Arial;margin:14mm} table{border-collapse:collapse;width:100%;margin:10px 0} td,th{border:1px solid #555;padding:4px 6px} th{background:#eee} .n{text-align:right}</style></head><body>
    <h2 style="margin:0">${esc((DB.companies.find(c => c.code === p.company) || {}).legalName || companyName(p.company))}</h2><h3>REMITTANCE ADVICE</h3>
    <p>To: <b>${esc(v.name)}</b> (${esc(v.no)})<br>Payment date: ${esc(p.date)} · ${esc(p.method || '')}${p.checkNo ? ` · Check no. ${esc(p.checkNo)}` : ''} · Reference ${esc(p.no)}</p>
    <table><tr><th>Your invoice</th><th>Invoice date</th><th class="n">Invoice amount (incl. VAT)</th><th class="n">Withholding tax</th><th class="n">Amount paid</th></tr>${rows}<tr><td colspan="4"><b>Total paid</b></td><td class="n"><b>${money(p.amount)}</b></td></tr></table>
    <p>The tax withheld is shown on BIR Form 2307, available in the Supplier Portal under Payments.</p><script>setTimeout(()=>print(),300)<\/script></body></html>`); w.document.close();
}

/* ---------- accreditation ---------- */
function vpAccrPage(acc) {
  const co = vpCos(acc)[0], st = vaStatus(acc.vendor, co), r = vaRec(acc.vendor, co) || {}, docs = r.docs || {};
  return `<div class="card"><h3>Accreditation ${badge(st)}</h3><p class="small muted" style="margin:0">${r.expiresAt ? `Valid until <b>${esc(r.expiresAt)}</b>. ` : ''}Upload each required document below. Leonio's staff check it; you'll see the status here.</p></div>
  <div class="card"><div class="tbl-wrap"><table class="grid"><thead><tr><th>Document</th><th>Required</th><th>Status</th><th>Expiry</th><th></th></tr></thead><tbody>
    ${vaReqs().map(q => { const d = docs[q.code] || {}, s = vaDocState(d, q), can = !['Verified', 'Received'].includes(s) || s === 'Expiring'; return `<tr><td><b>${esc(q.name)}</b>${q.appliesTo ? `<div class="small muted">${esc(q.appliesTo)}</div>` : ''}</td><td>${q.mandatory ? 'Yes' : 'If applicable'}</td><td>${badge(s === 'Received' ? 'Being checked' : s)}${s === 'Rejected' && d.note ? `<div class="small bad">${esc(d.note)}</div>` : ''}</td><td>${esc(d.expiry || '')}</td>
      <td>${can ? `<button class="btn sm ${q.mandatory ? 'primary' : ''}" onclick="vpDocUpload('${q.code}')">⬆ ${s === 'Expiring' || s === 'Expired' ? 'Renew' : 'Upload'}</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div></div>`;
}
function vpDocUpload(code) {
  const q = vaReqs().find(x => x.code === code);
  modal(`Upload: ${q.name}`, `<div class="form-grid"><label class="fld"><span>Reference / certificate no.</span><input id="vd_ref"></label><label class="fld"><span>Date issued</span><input id="vd_iss" type="date"></label>
    <label class="fld"><span>Expiry date${q.hasExpiry ? ' *' : ' (if any)'}</span><input id="vd_exp" type="date"></label><label class="fld w3"><span>File (PDF or photo, max 2 MB) *</span><input id="vd_file" type="file" accept=".pdf,image/*"></label></div>`, async () => {
    const acc = vpAcc(), ref = $('#vd_ref').value.trim(), iss = $('#vd_iss').value, exp = $('#vd_exp').value;
    if (q.hasExpiry && !exp) { toast('Enter the expiry date.', 'err'); return false; } if (exp && exp < today()) { toast('This document has expired. Please upload a current one.', 'err'); return false; }
    const file = await vpReadFile($('#vd_file')); if (file === false) return false; if (!file) { toast('Choose the file.', 'err'); return false; }
    const ok = await commit(() => { const co = vpCos(acc)[0], r = vaEnsure(acc.vendor, co), fileId = vpPut(file);
      r.docs[code] = { ref, issued: iss, expiry: exp, note: '', status: 'Received', receivedBy: `${acc.name} (vendor portal)`, receivedById: 'vp:' + acc.id, receivedAt: today(), fileId, viaPortal: true };
      (r.history = r.history || []).push({ at: new Date().toISOString(), by: `${acc.name} (vendor portal)`, action: `Uploaded: ${q.name}`, remarks: ref }); vpLog(acc, 'Document', q.name, `Uploaded ${q.name}${exp ? ', expires ' + exp : ''}`); },
      `Vendor portal (${acc.vendor}): document uploaded – ${q.name}`, acc.vendor);
    if (ok !== false) { toast('Uploaded. Leonio will check it.'); render(); } else return false;
  }, 'Upload');
}

/* =================== ERP side =================== */
/* accounts */
route('vpacc', () => {
  const co = S.company, set = MDS(co), accs = (DB.vpUsers || []).filter(u => u.set === set), can_ = typeof can !== 'function' || can('vendors', 'create');
  return pageHead('Vendor Portal Accounts', `Supplier sign-ins for <b>${esc(set)}</b>. <b>Test version:</b> the portal runs only on this PC until the logins / server step is done; open it here as a vendor to try it.`,
    `${can_ ? '<button class="btn primary" onclick="vpAccNew()">+ New account</button>' : ''} <a class="btn" href="#/vp" onclick="VP.uid=\'\';vpSave()">Open the sign-in page</a>`) +
  `<div class="card">${accs.length ? `<div class="tbl-wrap"><table class="grid"><thead><tr><th>Vendor</th><th>Contact</th><th>Email (sign-in)</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead><tbody>
    ${accs.map(a => `<tr><td><b>${esc(a.vendor)}</b> ${esc(partyName('vendor', a.vendor, co))}</td><td>${esc(a.name)}</td><td>${esc(a.email)}</td><td>${badge(a.active ? 'Active' : 'Inactive')}</td><td class="small">${esc((a.lastLogin || '').slice(0, 16).replace('T', ' '))}</td>
      <td style="white-space:nowrap">${can_ ? `<button class="btn sm" onclick="vpOpenAs('${a.id}')">Open as vendor</button> <button class="btn sm ghost" onclick="vpAccPin('${a.id}')">New PIN</button> <button class="btn sm ghost" onclick="vpAccToggle('${a.id}')">${a.active ? 'Deactivate' : 'Activate'}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted" style="margin:0">No portal accounts yet. Create one for a vendor to try the portal.</p>'}</div>`;
});
function vpAccNew() {
  modal('New vendor portal account', `<div class="form-grid"><label class="fld w2"><span>Vendor *</span>${pickHtml('vpn_v', 'vendors', '')}</label><label class="fld"><span>Contact person *</span><input id="vpn_n"></label><label class="fld w2"><span>Email (used to sign in) *</span><input id="vpn_e" type="email"></label></div>
    <p class="small muted">A 6-digit PIN is created and shown once. Give it to the vendor's contact person.</p>`, async () => {
    const v = $('#vpn_v').value.trim(), n = $('#vpn_n').value.trim(), e = $('#vpn_e').value.trim().toLowerCase(), vend = vendorOf(v, S.company);
    if (!vend) { toast('Choose the vendor.', 'err'); return false; } if (!n || !/^\S+@\S+\.\S+$/.test(e)) { toast('Enter the contact person and a valid email.', 'err'); return false; }
    if ((DB.vpUsers || []).some(u => u.email === e)) { toast('This email already has an account.', 'err'); return false; }
    const pin = String(Math.floor(100000 + Math.random() * 900000)), salt = uid(), pinHash = await vpHash(pin, salt);
    const ok = await commit(() => { if (typeof can === 'function' && !can('vendors', 'create')) fail(permMsg('vendors', 'create')); (DB.vpUsers = DB.vpUsers || []).push({ id: uid(), set: MDS(), vendor: v, name: n, email: e, salt, pinHash, active: true, createdAt: new Date().toISOString(), createdBy: curUser().name }); }, `Vendor portal account created for ${v}`, v);
    if (ok === false) return false; render(); setTimeout(() => modal('Account created', `<p>Sign-in for <b>${esc(vend.name)}</b>:</p><p>Email: <b>${esc(e)}</b><br>PIN: <b style="font-size:20px;letter-spacing:2px">${pin}</b></p><p class="small muted">The PIN is shown only now. Use "New PIN" to make another.</p>`, () => { }, 'OK'), 50);
  }, 'Create');
}
async function vpAccPin(id) {
  const pin = String(Math.floor(100000 + Math.random() * 900000)), salt = uid(), pinHash = await vpHash(pin, salt);
  const ok = await commit(() => { const a = DB.vpUsers.find(u => u.id === id); Object.assign(a, { salt, pinHash }); }, 'Vendor portal PIN reset', (DB.vpUsers.find(u => u.id === id) || {}).vendor);
  if (ok !== false) modal('New PIN', `<p>New PIN: <b style="font-size:20px;letter-spacing:2px">${pin}</b></p><p class="small muted">Shown only now.</p>`, () => { }, 'OK');
}
async function vpAccToggle(id) { const ok = await commit(() => { const a = DB.vpUsers.find(u => u.id === id); a.active = !a.active; }, 'Vendor portal account activated / deactivated', (DB.vpUsers.find(u => u.id === id) || {}).vendor); if (ok !== false) render(); }
function vpOpenAs(id) { VP.uid = id; vpSave(); go('#/vp'); }

/* inbox */
const VPI = { tab: 'inv' };
const vpPendingInv = () => (DB.vpInvoices || []).filter(x => DB.companies.some(c => c.code === x.company) && vpInvStatus(x).s === 'Submitted');
const vpBadgeCount = () => (typeof can !== 'function' || can('pi', 'create')) ? vpPendingInv().filter(x => x.company === S.company).length : 0;
route('vpinbox', () => {
  const co = S.company, invs = (DB.vpInvoices || []).filter(x => x.company === co).sort((a, b) => b.at.localeCompare(a.at)), log = (DB.vpLog || []).filter(l => l.set === MDS(co)).slice().reverse().slice(0, 80);
  const docs = Object.values(DB.vendAccr || {}).filter(r => r.set === MDS(co)).flatMap(r => Object.entries(r.docs || {}).filter(([, d]) => d.viaPortal && d.status === 'Received').map(([code, d]) => ({ r, code, d })));
  const tabs = [['inv', `Invoices (${invs.filter(x => vpInvStatus(x).s === 'Submitted').length} new)`], ['doc', `Documents to verify (${docs.length})`], ['log', 'All activity']];
  return pageHead('Vendor Portal Inbox', `What suppliers sent through the portal for <b>${esc(companyName(co))}</b>. Quotes go straight into their RFQ; invoices wait here for Accounts Payable.`, '<a class="btn" href="#/vpacc">Portal accounts</a>') +
  `<div class="card"><div class="segs">${tabs.map(([k, l]) => `<button class="${VPI.tab === k ? 'on' : ''}" onclick="VPI.tab='${k}';render()">${l}</button>`).join('')}</div></div>
  ${VPI.tab === 'inv' ? `<div class="card">${invs.length ? `<div class="tbl-wrap"><table class="grid"><thead><tr><th>Vendor</th><th>Invoice no.</th><th>Date</th><th>PO</th><th class="num">Amount</th><th class="num">Expected</th><th>Status</th><th></th></tr></thead><tbody>
      ${invs.map(x => { const s = vpInvStatus(x); return `<tr><td>${esc(partyName('vendor', x.vendor, co))}<div class="small muted">${esc(x.by)} · ${esc(x.at.slice(0, 10))}</div></td><td><b>${esc(x.invNo)}</b></td><td>${esc(x.invDate)}</td><td><a href="#/doc/PO/${x.poId}">${esc(x.poNo)}</a></td><td class="num">${money(x.amount)}</td>
        <td class="num ${Math.abs(x.amount - x.expected) > 1 ? 'bad' : ''}">${money(x.expected)}</td><td>${badge(s.s)}${s.pi ? ` <a href="#/doc/PI/${s.pi.id}">${esc(s.pi.no)}</a>` : ''}${s.s === 'Returned' ? `<div class="small bad">${esc(x.reason || '')}</div>` : ''}</td>
        <td style="white-space:nowrap">${x.fileId ? `<button class="btn sm ghost" onclick="vpDownload('${x.fileId}')">📎 Copy</button> ` : ''}${s.s === 'Submitted' ? `<button class="btn sm primary" onclick="vpMakePI('${x.id}')">Create Purchase Invoice</button> <button class="btn sm ghost" onclick="vpReturn('${x.id}')">Return</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>
      <p class="small muted" style="margin:8px 0 0">"Expected" = received on the PO and not yet invoiced (incl. VAT) when the vendor submitted. Create Purchase Invoice takes the receipt lines of the PO and fills in the vendor's invoice no.</p>` : '<p class="muted" style="margin:0">No invoices from the portal.</p>'}</div>`
    : VPI.tab === 'doc' ? `<div class="card">${docs.length ? `<table class="grid"><thead><tr><th>Vendor</th><th>Document</th><th>Ref.</th><th>Expiry</th><th>Uploaded</th><th></th></tr></thead><tbody>${docs.map(({ r, code, d }) => `<tr><td>${esc(partyName('vendor', r.vendor, co))}</td><td>${esc((vaReqs().find(q => q.code === code) || {}).name || code)}</td><td>${esc(d.ref || '')}</td><td>${esc(d.expiry || '')}</td><td class="small">${esc(d.receivedAt)}</td>
      <td style="white-space:nowrap"><button class="btn sm ghost" onclick="vpDownload('${d.fileId}')">📎 Open</button> <a class="btn sm" href="#/vendacc/${encodeURIComponent(r.vendor)}">Verify on the accreditation page</a></td></tr>`).join('')}</tbody></table>` : '<p class="muted" style="margin:0">Nothing to verify.</p>'}</div>`
    : `<div class="card">${log.length ? `<table class="grid compact"><thead><tr><th>When</th><th>Vendor</th><th>What</th><th>Ref.</th><th>Details</th></tr></thead><tbody>${log.map(l => `<tr><td class="small">${esc(l.at.slice(0, 16).replace('T', ' '))}</td><td>${esc(partyName('vendor', l.vendor, co))}<div class="small muted">${esc(l.account)}</div></td><td>${esc(l.kind)}</td><td>${l.docId ? `<a href="${l.kind === 'Quote' ? `#/rfq/${l.docId}` : `#/doc/PO/${l.docId}`}">${esc(l.ref)}</a>` : esc(l.ref)}</td><td class="small">${esc(l.text)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted" style="margin:0">No portal activity yet.</p>'}</div>`}`;
});
async function vpMakePI(id) {
  const x = (DB.vpInvoices || []).find(v => v.id === id); if (!x) return;
  location.hash = `#/doc/PO/${x.poId}`; await new Promise(r => setTimeout(r, 300));
  const before = location.hash; await poCreatePI(); await new Promise(r => setTimeout(r, 400));
  if (location.hash === before || !/#\/doc\/PI\//.test(location.hash)) return;
  const f = $('#h_vendorInvoiceNo'), d = $('#h_date'), rm = $('#h_remarks'); if (f) f.value = x.invNo; if (d) d.value = x.invDate; if (rm) rm.value = `From the vendor portal: invoice ${x.invNo}, ₱${money(x.amount)}${x.note ? ' – ' + x.note : ''}`;
  if (typeof saveDoc === 'function') await saveDoc();
  toast(`Purchase Invoice created from ${x.poNo} with invoice no. ${x.invNo}. Compare it with the vendor's copy (📎 in the inbox), then send it for approval.`);
}
function vpReturn(id) {
  ersAsk('Return the invoice to the vendor', 'Reason (the vendor sees it)', async t => {
    const ok = await commit(() => { const x = DB.vpInvoices.find(v => v.id === id); x.status = 'Returned'; x.reason = t; x.returnedBy = curUser().name; x.returnedAt = new Date().toISOString(); }, 'Vendor portal invoice returned', (DB.vpInvoices.find(v => v.id === id) || {}).invNo);
    if (ok !== false) render();
  }, true);
}
/* PO page: show the vendor's acknowledgement; PI page: link to the portal invoice */
const _relatedPanel_vp = relatedPanel;
relatedPanel = function () {
  const d = ED, base = _relatedPanel_vp(); if (!d || !d.id) return base;
  if (d.type === 'PO') { const p = DB.docs.find(x => x.id === d.id) || d; return `<div class="card"><h3>Vendor portal</h3>${p.vendorAck ? `<p style="margin:0">✔ Acknowledged by <b>${esc(p.vendorAck.by)}</b> on ${esc(p.vendorAck.at.slice(0, 10))}; promised delivery <b>${esc(p.vendorAck.promised)}</b>${p.vendorAck.note ? ` – ${esc(p.vendorAck.note)}` : ''}.</p>` : '<p class="muted" style="margin:0">Not acknowledged by the vendor yet.</p>'}</div>` + base; }
  if (d.type === 'PI') { const x = (DB.vpInvoices || []).find(v => v.company === d.company && v.vendor === d.vendor && v.invNo.toLowerCase() === String(d.vendorInvoiceNo || '').trim().toLowerCase()); if (x) return `<div class="card"><h3>Submitted in the vendor portal</h3><p style="margin:0">Invoice <b>${esc(x.invNo)}</b> of ${esc(x.invDate)}, ₱${money(x.amount)}${x.fileId ? ` · <a href="#" onclick="vpDownload('${x.fileId}');return false">📎 vendor's copy</a>` : ''}</p></div>` + base; }
  return base;
};
/* accreditation page in the ERP: files the vendor uploaded */
const _routeVendacc_vp = ROUTES.vendacc;
ROUTES.vendacc = (no, ...a) => {
  const html = _routeVendacc_vp(no, ...a); if (!no || typeof html !== 'string') return html;
  const r = vaRec(decodeURIComponent(no), S.company); const files = Object.entries((r && r.docs) || {}).filter(([, d]) => d.fileId);
  return files.length ? html + `<div class="card"><h3>Files uploaded in the vendor portal</h3><table class="grid compact"><tbody>${files.map(([code, d]) => `<tr><td>${esc((vaReqs().find(q => q.code === code) || {}).name || code)}</td><td>${badge(d.status)}</td><td class="small">${esc(d.receivedAt || '')}</td><td><button class="btn sm ghost" onclick="vpDownload('${d.fileId}')">📎 Open</button></td></tr>`).join('')}</tbody></table></div>` : html;
};
/* Change Log: actions taken on portal pages are logged under the supplier's account, not the ERP "Acting as" user */
const _audit_vp = audit;
audit = function (msg, ref) {
  const acc = /^#\/vp(\/|$)/.test(location.hash) ? vpAcc() : null;
  if (!acc) return _audit_vp(msg, ref);
  DB.audit.push({ id: uid(), ts: new Date().toISOString(), user: `${acc.name} (vendor portal, ${acc.vendor})`, company: S.company, msg, ref: ref || '' });
};
