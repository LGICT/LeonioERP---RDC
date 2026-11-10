'use strict';
/* ============ Vendor accreditation (decisions 10 and 11) ============
   Accreditation per vendor: required documents (list editable under Vendor Document Requirements), checked by Supply Chain,
   approved by the Supply Chain & Admin Head (Approval Rules: "VACC"), valid for 12 months, renewed before expiry.
   Suspend / blacklist / reinstate with a reason. Vendor rating (weighted score and suggested tier, from Luis's LG-ERP design).
   Purchase Orders to vendors that are not accredited are blocked once "Require accreditation for POs" is switched on;
   blacklisted vendors are always blocked.
   Bank details and payment terms change only through a change request: Supply Chain requests → Accounting Shared checks →
   Treasury approves (Approval Rules: "VBANK"). Data is kept in the ERP database, keyed by master data set and vendor no. */

const VA_STATUSES = ['Not accredited', 'Pending review', 'Accredited', 'Conditional', 'Suspended', 'Blacklisted'];
const VA_OK = ['Accredited', 'Conditional'];
const VA_CRITERIA = [['delivery', 'On-time delivery', 25], ['quality', 'Quality', 30], ['price', 'Price competitiveness', 20], ['response', 'Responsiveness', 15], ['compliance', 'Compliance (documents)', 10]];
DOC_TYPES_FOR_RULES.push('VACC', 'VBANK');
const vaCfg = () => Object.assign({ enforce: false, validityMonths: 12, alertDays: 60 }, DB.settings.vendAccr || {});
const vaKey = (no, co) => `${MDS(co)}|${no}`;
const vaRec = (no, co) => (DB.vendAccr || {})[vaKey(no, co)] || null;
const vaCanManage = () => isAdmin() || ERS_SC_ROLES.some(hasRole);
const vaCanDecide = () => isAdmin() || hasRole('Supply Chain & Admin Head') || hasRole('Supply Chain VP');
const vaReqs = () => (DB.vendDocReqs || []).filter(r => r.active !== false);
const addMonths = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setMonth(d.getMonth() + num(n)); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/* effective status: accreditation past its expiry date shows as Expired */
function vaStatus(no, co) {
  const r = vaRec(no, co); if (!r) return 'Not accredited';
  if (VA_OK.includes(r.status) && r.expiresAt && r.expiresAt < today()) return 'Expired';
  return r.status || 'Not accredited';
}
function vaDocState(d, req) {
  if (!d || !d.status || d.status === 'Missing') return req.mandatory ? 'Missing' : 'Not submitted';
  if (d.status === 'Verified' && d.expiry) {
    if (d.expiry < today()) return 'Expired';
    if (daysBetween(today(), d.expiry) <= vaCfg().alertDays) return 'Expiring';
  }
  return d.status;
}
function vaDocsSummary(no, co) {
  const r = vaRec(no, co) || {}, reqs = vaReqs(), docs = r.docs || {};
  const states = reqs.map(q => ({ q, s: vaDocState(docs[q.code], q) }));
  const mand = states.filter(x => x.q.mandatory);
  return { total: mand.length, ok: mand.filter(x => ['Verified', 'Expiring'].includes(x.s)).length, missing: mand.filter(x => !['Verified', 'Expiring'].includes(x.s)), expiring: states.filter(x => x.s === 'Expiring'), expired: states.filter(x => x.s === 'Expired'), states };
}
function vaEnsure(no, co) {
  DB.vendAccr = DB.vendAccr || {}; const k = vaKey(no, co);
  if (!DB.vendAccr[k]) DB.vendAccr[k] = { set: MDS(co), vendor: no, status: 'Not accredited', docs: {}, categories: '', history: [], ratings: [], approvals: [] };
  return DB.vendAccr[k];
}
const vaHist = (r, action, remarks) => (r.history = r.history || []).push({ at: new Date().toISOString(), by: curUser().name, action, remarks: remarks || '' });
const vaLastRating = r => (r && r.ratings && r.ratings.length) ? r.ratings[r.ratings.length - 1] : null;
const vaTier = s => s >= 85 ? 'Preferred' : s >= 70 ? 'Approved' : s >= 50 ? 'Conditional' : 'For review';

/* ---------- migration: document requirements, approval rules, settings ---------- */
function vaMigrate() {
  let ch = false;
  if (!DB.vendDocReqs) {
    const R = (code, name, mandatory, hasExpiry, validityMonths, appliesTo) => ({ code, name, mandatory, hasExpiry, validityMonths, appliesTo, active: true });
    DB.vendDocReqs = [
      R('VIS', 'Vendor Information Sheet (signed)', true, false, 0, 'All vendors'),
      R('BIR2303', 'BIR Certificate of Registration (Form 2303)', true, false, 0, 'All vendors'),
      R('SAMPLEOR', 'Sample Official Receipt / Sales Invoice', true, false, 0, 'All vendors'),
      R('DTISEC', 'DTI or SEC Registration', true, false, 0, 'All vendors'),
      R('PERMIT', "Mayor's / Business Permit (current year)", true, true, 12, 'All vendors'),
      R('BANKCERT', 'Bank Certificate (for bank transfer payments)', false, false, 0, 'Vendors paid by bank transfer'),
      R('GIS', 'Latest General Information Sheet', false, true, 12, 'Corporations'),
      R('AFS', 'Latest Audited Financial Statements', false, true, 12, 'Major suppliers and contractors'),
      R('PCAB', 'PCAB Contractor License', false, true, 12, 'Construction contractors')];
    ch = true;
  }
  const rule = (docType, seq, role) => ({ id: uid(), docType, seq, role, cond: 'always', amount: 0, approverType: 'Role' });
  if (!DB.approvalRules.some(r => r.docType === 'VACC')) { DB.approvalRules.push(rule('VACC', 10, 'Supply Chain & Admin Head')); ch = true; }
  if (!DB.approvalRules.some(r => r.docType === 'VBANK')) { DB.approvalRules.push(rule('VBANK', 10, 'General Accounting Supervisor'), rule('VBANK', 20, 'Treasury Assistant Manager')); ch = true; }
  if (!DB.settings.vendAccr) { DB.settings.vendAccr = { enforce: false, validityMonths: 12, alertDays: 60 }; ch = true; }
  if (!DB.vendAccr) { DB.vendAccr = {}; ch = true; }
  if (!DB.vendChanges) { DB.vendChanges = []; ch = true; }
  if (!DB.vendBank) { DB.vendBank = {}; ch = true; }
  return ch;
}
MASTERS.vendDocReqs = { title: 'Vendor Document Requirements', single: 'Document Requirement', key: 'code', group: 'Purchasing', adminOnly: 'Supply Chain & Admin Head',
  desc: 'The documents a vendor must submit to be accredited. Mandatory documents must be verified before the vendor can be submitted for accreditation; documents with an expiry are renewed.',
  cols: [{ l: 'Code', k: 'code' }, { l: 'Document', k: 'name' }, { l: 'Mandatory', v: r => r.mandatory ? 'Yes' : 'No' }, { l: 'Expires', v: r => r.hasExpiry ? `every ${r.validityMonths || 12} months` : 'No' }, { l: 'Applies to', k: 'appliesTo' }, { l: 'Active', v: r => r.active === false ? 'No' : 'Yes' }],
  fields: [T('code', 'Code', { req: 1 }), T('name', 'Document', { req: 1, w: 'w2' }), T('mandatory', 'Mandatory for accreditation', { t: 'check' }), T('hasExpiry', 'Has an expiry date', { t: 'check' }),
    T('validityMonths', 'Usual validity (months)', { t: 'number' }), T('appliesTo', 'Applies to', { w: 'w2' }), T('active', 'Active', { t: 'check' })] };

/* ---------- PO / PQ checks ---------- */
const _validateDoc_va = validateDoc;
validateDoc = function (d) {
  _validateDoc_va(d);
  if (!['PO', 'PQ'].includes(d.type) || !d.vendor) return;
  const st = vaStatus(d.vendor, d.company), name = partyName('vendor', d.vendor, d.company);
  if (st === 'Blacklisted') fail(`Vendor ${d.vendor} (${name}) is blacklisted. It cannot receive quotes or orders.`);
  if (d.type === 'PO' && vaCfg().enforce && !VA_OK.includes(st)) fail(`Vendor ${d.vendor} (${name}) is ${st.toLowerCase()}. Only accredited vendors can receive a Purchase Order (Purchasing → Vendor Accreditation).`);
};
const _relatedPanel_va = relatedPanel;
relatedPanel = function () {
  const d = ED, base = _relatedPanel_va();
  if (!d || !['PQ', 'PO', 'PI'].includes(d.type) || !d.vendor) return base;
  const st = vaStatus(d.vendor, d.company), r = vaRec(d.vendor, d.company), sm = vaDocsSummary(d.vendor, d.company), lr = vaLastRating(r);
  const warn = !VA_OK.includes(st) ? (st === 'Blacklisted' ? 'bad' : 'warn') : sm.expired.length || sm.expiring.length ? 'warn' : 'ok';
  return `<div class="card"><h3>Vendor accreditation</h3><div class="alertbox ${warn}"><div><b>${esc(st)}${r && r.expiresAt && VA_OK.includes(r.status) ? ` · valid until ${esc(r.expiresAt)}` : ''}</b>
    ${!VA_OK.includes(st) ? (vaCfg().enforce && d.type === 'PO' ? 'A Purchase Order cannot be released to this vendor.' : 'Accreditation is not yet required for POs, but this vendor is not accredited.') : ''}
    ${sm.expired.length ? `Expired: ${sm.expired.map(x => esc(x.q.name)).join(', ')}. ` : ''}${sm.expiring.length ? `Expiring soon: ${sm.expiring.map(x => esc(x.q.name)).join(', ')}.` : ''}
    ${lr ? ` Rating ${lr.score} (${esc(vaTier(lr.score))}).` : ''} <a href="#/vendacc/${encodeURIComponent(d.vendor)}">Open accreditation</a></div></div></div>` + base;
};

/* ---------- dashboard ---------- */
const VA_F = { tab: 'action', q: '' };
route('vendacc', no => no ? vaCard(no) : vaDashboard());
function vaRows(co) {
  return M(co).vendors.map(v => {
    const r = vaRec(v.no, co), st = vaStatus(v.no, co), sm = vaDocsSummary(v.no, co);
    const days = r && r.expiresAt ? daysBetween(today(), r.expiresAt) : null;
    const pend = DB.vendChanges.filter(c => c.set === MDS(co) && c.vendor === v.no && c.status === 'Pending Approval').length;
    let next = '';
    if (st === 'Pending review') next = 'Waiting for approval';
    else if (st === 'Not accredited' && r && Object.keys(r.docs || {}).length) next = sm.missing.length ? `${sm.missing.length} document(s) to complete` : 'Ready to submit';
    else if (st === 'Expired') next = 'Renew accreditation';
    else if (VA_OK.includes(st) && days != null && days <= vaCfg().alertDays) next = `Expires in ${days} day(s): renew`;
    else if (sm.expired.length) next = `${sm.expired.length} document(s) expired`;
    else if (sm.expiring.length) next = `${sm.expiring.length} document(s) expiring`;
    if (pend) next = (next ? next + ' · ' : '') + 'bank / terms change pending';
    return { v, r, st, sm, days, next, lr: vaLastRating(r) };
  });
}
function vaDashboard() {
  const co = S.company, rows = vaRows(co), cfg = vaCfg();
  const touched = rows.filter(x => x.r);
  const tabs = {
    action: ['Needs action', x => !!x.next],
    accredited: ['Accredited', x => VA_OK.includes(x.st)],
    pending: ['Pending review', x => x.st === 'Pending review'],
    expiring: ['Expiring', x => VA_OK.includes(x.st) && x.days != null && x.days <= cfg.alertDays],
    expired: ['Expired', x => x.st === 'Expired'],
    blocked: ['Suspended / blacklisted', x => ['Suspended', 'Blacklisted'].includes(x.st)],
    all: ['All vendors', () => true]
  };
  const words = VA_F.q.toLowerCase().split(/\s+/).filter(Boolean);
  let list = rows.filter(tabs[VA_F.tab][1]).filter(x => words.every(w => `${x.v.no} ${x.v.name} ${x.v.tin || ''}`.toLowerCase().includes(w)));
  const total = list.length; list = list.slice(0, 300);
  const chg = DB.vendChanges.filter(c => c.set === MDS(co) && ['Pending Approval'].includes(c.status));
  AFTER = () => { const s = $('#va_q'); if (s && VA_F.q) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } };
  return pageHead('Vendor Accreditation', `Accreditation of the vendors in the <b>${esc(MDS(co))}</b> master data. ${cfg.enforce ? '<b>Purchase Orders require an accredited vendor.</b>' : 'Accreditation is <b>not yet required</b> for Purchase Orders (switch it on below when ready).'}`,
    '<a class="btn" href="#/list/vendDocReqs">Document requirements</a>') +
  `<div class="tiles">
    <div class="tile"><span>Accredited</span><b>${rows.filter(x => VA_OK.includes(x.st)).length}</b><small>of ${rows.length} vendors</small></div>
    <div class="tile"><span>Pending review</span><b>${rows.filter(x => x.st === 'Pending review').length}</b><small>waiting for approval</small></div>
    <div class="tile"><span>Expiring in ${cfg.alertDays} days</span><b>${rows.filter(tabs.expiring[1]).length}</b><small>start the renewal</small></div>
    <div class="tile"><span>Expired</span><b>${rows.filter(x => x.st === 'Expired').length}</b><small>accreditation lapsed</small></div>
    <div class="tile"><span>Documents expired / expiring</span><b>${touched.reduce((s, x) => s + x.sm.expired.length + x.sm.expiring.length, 0)}</b><small>permits and licenses</small></div>
    <div class="tile"><span>Suspended / blacklisted</span><b>${rows.filter(tabs.blocked[1]).length}</b><small>cannot be ordered from</small></div></div>
  ${chg.length ? `<div class="card warn-card"><h3>Bank and payment-term change requests</h3>${vaChangeTable(chg)}</div>` : ''}
  <div class="card"><div class="tbl-tools" style="flex-wrap:wrap"><div class="segs">${Object.entries(tabs).map(([k, t]) => `<button class="${VA_F.tab === k ? 'on' : ''}" onclick="VA_F.tab='${k}';render()">${t[0]} (${rows.filter(t[1]).length})</button>`).join('')}</div>
    <input class="search" id="va_q" placeholder="Search vendor no., name or TIN" value="${esc(VA_F.q)}" oninput="VA_F.q=this.value;clearTimeout(window._vaT);window._vaT=setTimeout(render,250)"></div>
    ${list.length ? `<div class="tbl-wrap"><table class="grid"><thead><tr><th>Vendor</th><th>Name</th><th>Status</th><th>Valid until</th><th>Documents</th><th>Rating</th><th>Next action</th></tr></thead><tbody>
    ${list.map(x => `<tr class="link" onclick="go('#/vendacc/${encodeURIComponent(x.v.no)}')"><td><a href="#/vendacc/${encodeURIComponent(x.v.no)}">${esc(x.v.no)}</a></td><td>${esc(x.v.name)}</td><td>${badge(x.st)}${x.r && x.r.legacy ? ' <span class="small muted">transition</span>' : ''}</td>
      <td>${esc(x.r && x.r.expiresAt || '')}</td><td>${x.sm.total ? `${x.sm.ok}/${x.sm.total}` : '—'}</td><td>${x.lr ? `${x.lr.score} <span class="small muted">${esc(vaTier(x.lr.score))}</span>` : ''}</td><td class="small">${esc(x.next)}</td></tr>`).join('')}
    </tbody></table></div>${total > list.length ? `<p class="small muted">Showing 300 of ${total}. Search to narrow down.</p>` : ''}` : '<p class="muted" style="margin:0">No vendors here.</p>'}</div>
  ${isAdmin() || vaCanDecide() ? `<div class="card"><h3>Settings</h3><div class="form-grid">
    <label class="fld chk"><input type="checkbox" id="vs_enf" ${cfg.enforce ? 'checked' : ''}> Require accreditation for Purchase Orders</label>
    <label class="fld">Accreditation valid for (months)<input type="number" id="vs_val" value="${cfg.validityMonths}"></label>
    <label class="fld">Remind before expiry (days)<input type="number" id="vs_alert" value="${cfg.alertDays}"></label></div>
    <div class="actions" style="margin-top:12px"><button class="btn primary" onclick="vaSaveCfg()">Save settings</button><button class="btn" onclick="vaTransition()">Accredit existing vendors (transition)…</button></div>
    <p class="small muted" style="margin:8px 0 0">Before switching the requirement on, either accredit vendors one by one or use the transition: existing approved vendors are marked accredited until a date you choose, so ordering does not stop, and they are renewed with full documents by then.</p></div>` : ''}`;
}
async function vaSaveCfg() {
  const ok = await commit(() => { DB.settings.vendAccr = { enforce: $('#vs_enf').checked, validityMonths: num($('#vs_val').value) || 12, alertDays: num($('#vs_alert').value) || 60 }; }, 'Changed vendor accreditation settings');
  if (ok !== false) { toast('Settings saved.'); render(); }
}
function vaTransition() {
  const co = S.company, n = M(co).vendors.filter(v => STATUS_USABLE(v) && !VA_OK.includes(vaStatus(v.no, co)) && vaStatus(v.no, co) !== 'Blacklisted').length;
  modal('Accredit existing vendors (transition)', `<p>Marks <b>${n}</b> approved vendors of the ${esc(MDS(co))} master data that are not yet accredited as <b>Accredited (transition)</b> until the date below. Their documents still need to be collected and they must be renewed before that date.</p>
    <div class="form-grid"><label class="fld">Valid until<input type="date" id="tr_to" value="${addMonths(today(), 6)}"></label></div>`, async () => {
    const to = $('#tr_to').value; if (!to || to <= today()) { toast('Choose a future date.', 'err'); return false; }
    const ok = await commit(() => {
      for (const v of M(co).vendors) { if (!STATUS_USABLE(v)) continue; const st = vaStatus(v.no, co); if (VA_OK.includes(st) || st === 'Blacklisted') continue;
        const r = vaEnsure(v.no, co); Object.assign(r, { status: 'Accredited', legacy: true, accreditedAt: today(), expiresAt: to }); vaHist(r, 'Accredited (transition)', `Until ${to}`); }
    }, `Transition accreditation of ${n} vendors until ${to}`);
    if (ok !== false) { toast(`${n} vendors marked accredited until ${to}.`); render(); } else return false;
  }, 'Accredit');
}

/* ---------- accreditation card ---------- */
function vaCard(no) {
  const co = S.company, v = vendorOf(no, co); if (!v) return '<div class="card">Vendor not found in this company\'s master data.</div>';
  const r = vaRec(no, co) || { status: 'Not accredited', docs: {}, history: [], ratings: [], approvals: [] }, st = vaStatus(no, co), sm = vaDocsSummary(no, co), cfg = vaCfg();
  const bank = (DB.vendBank || {})[vaKey(no, co)], lr = vaLastRating(r), man = vaCanManage(), dec = vaCanDecide();
  const pendChg = DB.vendChanges.filter(c => c.set === MDS(co) && c.vendor === no).slice().reverse();
  const days = r.expiresAt ? daysBetween(today(), r.expiresAt) : null;
  const acts = [];
  const nq = esc(no).replace(/'/g, "\\'");
  if (man && ['Not accredited', 'Expired'].includes(st) || (man && VA_OK.includes(st) && days != null && days <= cfg.alertDays)) acts.push(`<button class="btn primary" onclick="vaSubmit('${nq}')">${st === 'Not accredited' && !r.accreditedAt ? 'Submit for accreditation' : 'Submit renewal'}</button>`);
  if (r.status === 'Pending review' && canApprove(r)) acts.push(`<button class="btn primary" onclick="vaDecide('${nq}',true)">Approve accreditation</button>`, `<button class="btn danger ghost" onclick="vaDecide('${nq}',false)">Reject</button>`);
  if (dec && VA_OK.includes(r.status)) acts.push(`<button class="btn" onclick="vaChangeStatus('${nq}','Conditional')">Make conditional</button>`, `<button class="btn" onclick="vaChangeStatus('${nq}','Suspended')">Suspend</button>`);
  if (dec && r.status !== 'Blacklisted') acts.push(`<button class="btn danger ghost" onclick="vaChangeStatus('${nq}','Blacklisted')">Blacklist</button>`);
  if (dec && ['Suspended', 'Blacklisted', 'Conditional'].includes(r.status)) acts.push(`<button class="btn" onclick="vaChangeStatus('${nq}','Accredited')">Reinstate</button>`);
  if (man) acts.push(`<button class="btn" onclick="vaRate('${nq}')">Rate vendor</button>`);
  return pageHead(`Vendor Accreditation: ${no}`, `${badge(st)} &nbsp;${esc(v.name)} · TIN ${esc(v.tin || '—')}${r.expiresAt ? ` · valid until <b>${esc(r.expiresAt)}</b>${days != null && days >= 0 ? ` (${days} days)` : ''}` : ''}${r.legacy ? ' · <span class="small">transition: collect documents before expiry</span>' : ''}`,
    `<a class="btn ghost" href="#/card/vendors/${encodeURIComponent(no)}">Vendor card</a><a class="btn ghost" href="#/vendacc">← Vendor Accreditation</a>`) +
  `<div class="ers-layout"><div>
    <div class="card"><div class="lines-head"><h3 style="margin:0">Documents</h3><span class="small muted">${sm.ok} of ${sm.total} mandatory documents verified</span></div>
    <div class="tbl-wrap"><table class="grid"><thead><tr><th>Document</th><th>Status</th><th>Reference no.</th><th>Issued</th><th>Expires</th><th>Checked by</th><th></th></tr></thead><tbody>
    ${sm.states.map(({ q, s }) => { const d = (r.docs || {})[q.code] || {}; const cq = esc(q.code).replace(/'/g, "\\'"); return `<tr><td><b>${esc(q.name)}</b>${q.mandatory ? '' : ' <span class="small muted">optional</span>'}<div class="small muted">${esc(q.appliesTo || '')}</div></td>
      <td>${badge(s)}${d.note ? `<div class="small muted">${esc(d.note)}</div>` : ''}</td><td>${esc(d.ref || '')}</td><td>${esc(d.issued || '')}</td><td>${esc(d.expiry || '')}</td><td class="small">${esc(d.verifiedBy || d.receivedBy || '')}</td>
      <td style="white-space:nowrap">${man ? `<button class="btn sm" onclick="vaDocRecord('${nq}','${cq}')">${d.status ? 'Update' : 'Record received'}</button>${d.status === 'Received' && d.receivedById !== curUser().id ? ` <button class="btn sm primary" onclick="vaDocVerify('${nq}','${cq}',true)">Verify</button> <button class="btn sm danger ghost" onclick="vaDocVerify('${nq}','${cq}',false)">Reject</button>` : ''}` : ''}</td></tr>`; }).join('')}
    </tbody></table></div><p class="small muted" style="margin:8px 0 0">The person who records a document cannot verify it. File upload comes with the Attachments feature; until then keep the scanned copies where you keep them today and note the reference here.</p></div>
    <div class="card"><div class="lines-head"><h3 style="margin:0">Bank details and payment terms</h3>${man ? `<button class="btn sm" onclick="vaChangeReq('${nq}')">Request a change</button>` : ''}</div>
      <div class="kvlist"><div><span>Payment terms</span><b>${esc(v.paymentTerms || '—')}</b></div><div><span>Payment method</span><b>${esc(v.paymentMethod || '—')}</b></div>
      <div><span>Bank</span><b>${esc(bank ? `${bank.bankName} ${bank.branch ? '(' + bank.branch + ')' : ''}` : '—')}</b></div><div><span>Account name</span><b>${esc(bank ? bank.accountName : '—')}</b></div>
      <div><span>Account no.</span><b>${esc(bank ? bank.accountNo : '—')}</b></div>${bank && bank.swift ? `<div><span>SWIFT</span><b>${esc(bank.swift)}</b></div>` : ''}${bank ? `<div><span>Approved</span><b>${esc(bank.approvedAt || '')}</b></div>` : ''}</div>
      <p class="small muted" style="margin:8px 0 0">Changes go Supply Chain → Accounting Shared (check) → Treasury (approve). The vendor card no longer accepts direct changes to payment terms.</p>
      ${pendChg.length ? `<h3 style="margin-top:14px">Change requests</h3>${vaChangeTable(pendChg)}` : ''}</div>
    <div class="card"><h3>Categories supplied</h3>${man ? `<label class="fld"><input id="va_cat" value="${esc(r.categories || '')}" placeholder="e.g. Spare parts (Komatsu), PPE, Hauling services" onchange="vaSetCats('${nq}',this.value)"></label>` : `<p style="margin:0">${esc(r.categories || '—')}</p>`}</div>
  </div><div class="ers-side">
    <div class="card"><h3>Accreditation</h3><div class="kvlist"><div><span>Status</span><b>${badge(st)}</b></div><div><span>Accredited on</span><b>${esc(r.accreditedAt || '—')}</b></div><div><span>Valid until</span><b>${esc(r.expiresAt || '—')}</b></div>
      ${r.reason ? `<div style="display:block"><span class="muted small">Reason</span><div>${esc(r.reason)}</div></div>` : ''}</div>
      ${r.status === 'Pending review' && !canApprove(r) ? `<p class="muted small" style="margin:8px 0 0">${esc(whyCannotApprove(r))}</p>` : ''}
      <div class="actions" style="margin-top:12px">${acts.join('') || '<span class="muted small">No actions for you.</span>'}</div></div>
    ${approvalPanel(r)}
    <div class="card"><h3>Rating</h3>${lr ? `<div class="kvlist"><div><span>Latest score</span><b>${lr.score} / 100</b></div><div><span>Suggested tier</span><b>${esc(vaTier(lr.score))}</b></div><div><span>Period</span><b>${esc(lr.period)}</b></div>
      ${VA_CRITERIA.map(([k, l, w]) => `<div><span>${esc(l)} (${w}%)</span><b>${lr.marks[k]} / 5</b></div>`).join('')}</div>${r.ratings.length > 1 ? `<p class="small muted" style="margin:8px 0 0">Earlier: ${r.ratings.slice(0, -1).reverse().slice(0, 4).map(x => `${esc(x.period)} ${x.score}`).join(' · ')}</p>` : ''}` : '<p class="muted small" style="margin:0">Not yet rated.</p>'}</div>
    <div class="card"><h3>History</h3><div class="kvlist">${(r.history || []).slice().reverse().map(h => `<div style="display:block"><b>${esc(h.action)}</b> <span class="muted small">· ${esc(h.by)} · ${esc(h.at.slice(0, 16).replace('T', ' '))}</span>${h.remarks ? `<div class="small muted">${esc(h.remarks)}</div>` : ''}</div>`).join('') || '<span class="muted small">No history.</span>'}</div></div>
  </div></div>`;
}
async function vaSetCats(no, val) { const ok = await commit(() => { vaEnsure(no, S.company).categories = val.trim(); }, 'Vendor categories', no); if (ok !== false) toast('Saved.'); }
function vaDocRecord(no, code) {
  const q = vaReqs().find(x => x.code === code), d = ((vaRec(no, S.company) || {}).docs || {})[code] || {};
  const F = [{ k: 'ref', l: 'Reference / certificate no.' }, { k: 'issued', l: 'Date issued', t: 'date' }, { k: 'expiry', l: q.hasExpiry ? 'Expiry date *' : 'Expiry date (if any)', t: 'date' }, { k: 'note', l: 'Remarks', w: 'w3' }];
  const init = { ...d }; if (q.hasExpiry && !init.expiry && init.issued) init.expiry = addMonths(init.issued, q.validityMonths || 12);
  modal(`${q.name}`, `<p class="small muted">Record that the document was received. Someone else then verifies it.</p><div class="form-grid">${F.map(f => fieldHtml(f, init[f.k], 'vd')).join('')}</div>`, async () => {
    const v = readForm(F, 'vd'); if (q.hasExpiry && !v.expiry) { toast('Enter the expiry date.', 'err'); return false; }
    if (v.expiry && v.expiry < today()) { toast('This document has already expired. Ask the vendor for a current one.', 'err'); return false; }
    const ok = await commit(() => { const r = vaEnsure(no, S.company); r.docs[code] = { ...v, status: 'Received', receivedBy: curUser().name, receivedById: curUser().id, receivedAt: today() }; vaHist(r, `Received: ${q.name}`, v.ref); }, `Vendor document received: ${q.name}`, no);
    if (ok !== false) { toast('Recorded. It now needs to be verified by someone else.'); render(); } else return false;
  }, 'Save');
}
function vaDocVerify(no, code, okDoc) {
  const q = vaReqs().find(x => x.code === code);
  const go2 = async note => { const ok = await commit(() => {
    const r = vaEnsure(no, S.company), d = r.docs[code]; if (!d || d.status !== 'Received') fail('Nothing to verify.');
    if (d.receivedById === curUser().id) fail('You recorded this document, so someone else must verify it.');
    Object.assign(d, { status: okDoc ? 'Verified' : 'Rejected', verifiedBy: curUser().name, verifiedAt: today(), note: okDoc ? d.note : note }); vaHist(r, `${okDoc ? 'Verified' : 'Rejected'}: ${q.name}`, note);
  }, `Vendor document ${okDoc ? 'verified' : 'rejected'}: ${q.name}`, no); if (ok !== false) { toast(okDoc ? 'Verified.' : 'Rejected.'); render(); } };
  if (okDoc) go2(''); else ersAsk('Reject document', 'Reason (the vendor must send a new one)', go2, true);
}
async function vaSubmit(no) {
  const ok = await commit(() => {
    const co = S.company, r = vaEnsure(no, co), sm = vaDocsSummary(no, co);
    if (sm.missing.length) fail(`Verify the mandatory documents first: ${sm.missing.map(x => x.q.name).join(', ')}.`);
    if (sm.expired.length) fail(`Renew the expired documents first: ${sm.expired.map(x => x.q.name).join(', ')}.`);
    if (r.status === 'Blacklisted') fail('A blacklisted vendor cannot be submitted.');
    r.prevStatus = r.status; r.renewal = !!r.accreditedAt; r.type = 'VACC'; r.createdBy = curUser().id;
    submitForApproval(r, 'VACC');
    if (r.status === 'Approved') vaApply(r); else r.status = 'Pending review';
    vaHist(r, r.renewal ? 'Renewal submitted' : 'Submitted for accreditation');
  }, 'Submitted vendor for accreditation', no);
  if (ok !== false) { const r = vaRec(no, S.company); const st = (r.approvals || []).find(a => a.status === 'Pending'); toast(r.status === 'Pending review' ? `Sent for approval to ${st ? st.role : 'the approver'}.` : 'Accredited.'); render(); }
}
function vaApply(r) { r.status = 'Accredited'; r.legacy = false; r.accreditedAt = today(); r.expiresAt = addMonths(today(), vaCfg().validityMonths); r.reason = ''; }
function vaDecide(no, approve) {
  modal(approve ? 'Approve accreditation' : 'Reject accreditation', `<label class="fld w3"><span>Comment${approve ? ' (optional)' : ' *'}</span><textarea id="vac" rows="3"></textarea></label>`, async () => {
    const c = $('#vac').value.trim();
    const ok = await commit(() => {
      const r = vaEnsure(no, S.company), st = pendingStep(r);
      if (approve) { r.status = 'Pending Approval'; approveStep(r, c); if (r.status === 'Approved') { vaApply(r); vaHist(r, r.renewal ? 'Renewal approved' : 'Accredited', `Valid until ${r.expiresAt}`); } else { r.status = 'Pending review'; vaHist(r, `Approved by ${st.role}`, c); } }
      else { r.status = 'Pending Approval'; rejectStep(r, c); r.status = r.prevStatus && r.prevStatus !== 'Pending review' ? r.prevStatus : 'Not accredited'; vaHist(r, 'Accreditation rejected', c); }
    }, `Vendor accreditation ${approve ? 'approved' : 'rejected'}`, no);
    if (ok !== false) { toast(approve ? 'Approved.' : 'Rejected.'); render(); } else return false;
  }, approve ? 'Approve' : 'Reject');
}
/* approvals work on status "Pending Approval"; the record shows "Pending review" between steps */
const _canApprove_va = canApprove;
canApprove = function (o) { if (o && o.type === 'VACC' && o.status === 'Pending review') { const s = o.status; o.status = 'Pending Approval'; try { return _canApprove_va(o); } finally { o.status = s; } } return _canApprove_va(o); };
const _why_va = whyCannotApprove;
whyCannotApprove = function (o) { if (o && o.type === 'VACC' && o.status === 'Pending review') { const s = o.status; o.status = 'Pending Approval'; try { return _why_va(o); } finally { o.status = s; } } return _why_va(o); };
function vaChangeStatus(no, to) {
  modal(`${to === 'Accredited' ? 'Reinstate' : to === 'Blacklisted' ? 'Blacklist' : to === 'Suspended' ? 'Suspend' : 'Make conditional'} ${no}`, `<label class="fld w3"><span>Reason *</span><textarea id="vsr" rows="3"></textarea></label>`, async () => {
    const reason = $('#vsr').value.trim(); if (reason.length < 10) { toast('Give a reason of at least 10 characters.', 'err'); return false; }
    const ok = await commit(() => {
      if (!vaCanDecide()) fail('Only the Supply Chain & Admin Head can change the accreditation status.');
      const r = vaEnsure(no, S.company), from = vaStatus(no, S.company);
      if (to === 'Accredited' && (!r.expiresAt || r.expiresAt < today())) { r.accreditedAt = today(); r.expiresAt = addMonths(today(), vaCfg().validityMonths); }
      r.status = to; r.reason = to === 'Accredited' ? '' : reason; vaHist(r, `${from} → ${to}`, reason);
    }, `Vendor accreditation status: ${to}`, no);
    if (ok !== false) { toast(`Status changed to ${to}.`); render(); } else return false;
  }, 'Confirm');
}
function vaRate(no) {
  const sm = vaDocsSummary(no, S.company), compliance = sm.total ? Math.max(1, Math.round((sm.ok / sm.total) * 5 - sm.expired.length)) : 3;
  modal(`Rate vendor ${no}`, `<div class="form-grid"><label class="fld">Period<input id="vr_p" value="${today().slice(0, 4)} H${today().slice(5, 7) <= '06' ? 1 : 2}"></label></div>
    <table class="grid" style="margin-top:10px"><thead><tr><th>Criterion</th><th class="num">Weight</th><th>Mark (1 poor – 5 excellent)</th></tr></thead><tbody>
    ${VA_CRITERIA.map(([k, l, w]) => `<tr><td>${esc(l)}</td><td class="num">${w}%</td><td><select id="vr_${k}">${[5, 4, 3, 2, 1].map(n => `<option ${n === (k === 'compliance' ? compliance : (typeof asrSuggest === 'function' && asrSuggest(no, k)) || 3) ? 'selected' : ''}>${n}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table>
    ${typeof asrVendorStats === 'function' && asrVendorStats(no, S.company) ? (s => `<p class="small muted">Service reports (last 12 months): ${s.n} approved, average timeliness ${s.timeliness}, average quality ${s.quality}/5. On-time delivery and Quality are suggested from them.</p>`)(asrVendorStats(no, S.company)) : ''}
    <label class="fld w3" style="margin-top:10px">Remarks<textarea id="vr_n" rows="2"></textarea></label><p class="small muted">Compliance is suggested from the documents (${sm.ok}/${sm.total} verified${sm.expired.length ? `, ${sm.expired.length} expired` : ''}). Score 85+ Preferred, 70+ Approved, 50+ Conditional, below 50 for review.</p>`, async () => {
    const marks = Object.fromEntries(VA_CRITERIA.map(([k]) => [k, num($('#vr_' + k).value)])), score = Math.round(sum(VA_CRITERIA, ([k, , w]) => w * marks[k] / 5));
    const ok = await commit(() => { const r = vaEnsure(no, S.company); r.ratings.push({ period: $('#vr_p').value.trim(), marks, score, note: $('#vr_n').value.trim(), by: curUser().name, at: today() }); vaHist(r, `Rated ${score} (${vaTier(score)})`, $('#vr_p').value.trim()); }, 'Vendor rated', no);
    if (ok !== false) { toast(`Score ${score}: ${vaTier(score)}.`); render(); } else return false;
  }, 'Save rating', true);
}

/* ---------- bank details and payment terms change requests (decision 11) ---------- */
function vaChangeTable(list) {
  return `<div class="tbl-wrap"><table class="grid compact"><thead><tr><th>Date</th><th>Vendor</th><th>Change</th><th>Requested by</th><th>Status</th><th>Waiting for</th><th></th></tr></thead><tbody>
  ${list.map(c => `<tr><td>${esc(c.date)}</td><td><a href="#/vendacc/${encodeURIComponent(c.vendor)}">${esc(c.vendor)}</a></td><td class="small">${esc(vaChangeText(c))}</td><td>${esc(c.byName)}</td><td>${badge(c.status)}</td><td class="small">${esc(pendingStep(c) ? pendingStep(c).role : '')}</td>
    <td style="white-space:nowrap">${canApprove(c) ? `<button class="btn sm primary" onclick="vaChgDecide('${c.id}',true)">Approve</button> <button class="btn sm danger ghost" onclick="vaChgDecide('${c.id}',false)">Reject</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
}
function vaChangeText(c) {
  const p = [];
  if (c.bank) p.push(`Bank: ${c.bank.bankName} ${c.bank.accountNo} (${c.bank.accountName})`);
  if (c.paymentTerms != null && c.paymentTerms !== c.oldTerms) p.push(`Payment terms: ${c.oldTerms || '—'} → ${c.paymentTerms}`);
  if (c.paymentMethod != null && c.paymentMethod !== c.oldMethod) p.push(`Payment method: ${c.oldMethod || '—'} → ${c.paymentMethod}`);
  return p.join(' · ') + (c.reason ? ` — ${c.reason}` : '');
}
function vaChangeReq(no) {
  const co = S.company, v = vendorOf(no, co), b = (DB.vendBank || {})[vaKey(no, co)] || {};
  const F = [{ k: 'bankName', l: 'Bank' }, { k: 'branch', l: 'Branch' }, { k: 'accountName', l: 'Account name' }, { k: 'accountNo', l: 'Account no.' }, { k: 'swift', l: 'SWIFT (foreign)' },
    { k: 'paymentTerms', l: 'Payment terms', t: 'ref', ref: 'paymentTerms' }, { k: 'paymentMethod', l: 'Payment method', t: 'ref', ref: 'paymentMethods' }, { k: 'reason', l: 'Reason and supporting document (e.g. vendor letter, bank certificate) *', w: 'w3' }];
  const init = { ...b, paymentTerms: v.paymentTerms || '', paymentMethod: v.paymentMethod || '' };
  modal(`Request a change: ${no}`, `<p class="small muted">Accounting Shared checks it, then Treasury approves. The change applies only after approval.</p><div class="form-grid">${F.map(f => fieldHtml(f, init[f.k], 'vc')).join('')}</div>`, async () => {
    const x = readForm(F, 'vc'); if (!x.reason) { toast('Give the reason and supporting document.', 'err'); return false; }
    const bankChanged = ['bankName', 'branch', 'accountName', 'accountNo', 'swift'].some(k => (x[k] || '') !== (b[k] || ''));
    if (bankChanged && !(x.bankName && x.accountName && x.accountNo)) { toast('Enter bank, account name and account no.', 'err'); return false; }
    if (!bankChanged && x.paymentTerms === (v.paymentTerms || '') && x.paymentMethod === (v.paymentMethod || '')) { toast('Nothing was changed.', 'err'); return false; }
    const ok = await commit(() => {
      if (DB.vendChanges.some(c => c.set === MDS(co) && c.vendor === no && c.status === 'Pending Approval')) fail('A change request for this vendor is already waiting for approval.');
      const c = { id: uid(), type: 'VBANK', set: MDS(co), company: co, vendor: no, date: today(), createdBy: curUser().id, byName: curUser().name, reason: x.reason,
        bank: bankChanged ? { bankName: x.bankName, branch: x.branch, accountName: x.accountName, accountNo: x.accountNo, swift: x.swift } : null,
        paymentTerms: x.paymentTerms, oldTerms: v.paymentTerms || '', paymentMethod: x.paymentMethod, oldMethod: v.paymentMethod || '', approvals: [] };
      submitForApproval(c, 'VBANK'); DB.vendChanges.push(c);
      if (c.status === 'Approved') vaChgApply(c);
      vaHist(vaEnsure(no, co), 'Change requested', vaChangeText(c));
    }, 'Requested vendor bank / payment-term change', no);
    if (ok !== false) { toast('Change request sent for approval.'); render(); } else return false;
  }, 'Send request', true);
}
function vaChgApply(c) {
  const v = vendorOf(c.vendor, c.company);
  if (c.bank) DB.vendBank[`${c.set}|${c.vendor}`] = { ...c.bank, approvedAt: today(), requestId: c.id };
  if (v) { if (c.paymentTerms !== c.oldTerms) v.paymentTerms = c.paymentTerms; if (c.paymentMethod !== c.oldMethod) v.paymentMethod = c.paymentMethod; MD_DIRTY = true; }
  vaHist(vaEnsure(c.vendor, c.company), 'Change approved and applied', vaChangeText(c));
}
function vaChgDecide(id, approve) {
  modal(approve ? 'Approve change' : 'Reject change', `<p class="small">${esc(vaChangeText(DB.vendChanges.find(c => c.id === id)))}</p><label class="fld w3"><span>Comment${approve ? ' (optional)' : ' *'}</span><textarea id="vcc" rows="3"></textarea></label>`, async () => {
    const cm = $('#vcc').value.trim();
    const ok = await commit(() => { const c = DB.vendChanges.find(x => x.id === id); if (approve) { approveStep(c, cm); if (c.status === 'Approved') vaChgApply(c); } else { rejectStep(c, cm); vaHist(vaEnsure(c.vendor, c.company), 'Change rejected', cm); } },
      `Vendor change request ${approve ? 'approved' : 'rejected'}`, (DB.vendChanges.find(c => c.id === id) || {}).vendor, { md: approve });
    if (ok !== false) { toast(approve ? 'Approved.' : 'Rejected.'); render(); } else return false;
  }, approve ? 'Approve' : 'Reject');
}
/* the vendor card no longer changes payment terms or method directly on existing vendors */
const _saveMaster_va = saveMaster;
saveMaster = async function (coll, key) {
  if (coll === 'vendors' && key) {
    const v = findMaster('vendors', key), t = $('#m_paymentTerms'), m = $('#m_paymentMethod');
    if (v && ((t && t.value.trim() !== (v.paymentTerms || '')) || (m && m.value.trim() !== (v.paymentMethod || '')))) return toast('Payment terms and method change through a request: Vendor Accreditation → Request a change.', 'err');
  }
  return _saveMaster_va(coll, key);
};
/* the vendor card links to its accreditation */
const _routeCard_va = ROUTES.card;
ROUTES.card = (coll, key) => {
  const html = _routeCard_va(coll, key);
  if (coll !== 'vendors' || !key || key === 'new') return html;
  const st = vaStatus(key, S.company), r = vaRec(key, S.company);
  return html.replace('<div class="card"><div class="form-grid">', `<div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div><b>Accreditation:</b> ${badge(st)}${r && r.expiresAt ? ` <span class="small muted">valid until ${esc(r.expiresAt)}</span>` : ''}</div><a class="btn sm primary" href="#/vendacc/${encodeURIComponent(key)}">Open accreditation</a></div><div class="card"><div class="form-grid">`);
};
/* Requests to Approve page and the menu badge */
const _myApprovals_va = myApprovals;
myApprovals = function () {
  const out = _myApprovals_va();
  for (const r of Object.values(DB.vendAccr || {})) if (r.status === 'Pending review' && canApprove(r)) {
    const co = (DB.companies.find(c => c.md === r.set) || {}).code;
    out.push({ company: co, label: 'Vendor accreditation', no: r.vendor, party: (M(co).vendors.find(v => v.no === r.vendor) || {}).name || '', amount: '', role: pendingStep({ ...r, status: 'Pending Approval' }).role, link: `#/vendacc/${encodeURIComponent(r.vendor)}` });
  }
  for (const c of DB.vendChanges || []) if (canApprove(c)) out.push({ company: c.company, label: 'Vendor bank / terms change', no: c.vendor, party: vaChangeText(c), amount: '', role: pendingStep(c).role, link: `#/vendacc/${encodeURIComponent(c.vendor)}` });
  return out;
};
const vaBadgeCount = () => Object.values(DB.vendAccr || {}).filter(r => r.status === 'Pending review' && canApprove(r)).length + (DB.vendChanges || []).filter(c => canApprove(c)).length;
