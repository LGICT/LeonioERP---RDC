'use strict';
/* ============ Service acceptance: Approved Service Report (ASR) (gap 8, LG-ERP M9) ============
   The service equivalent of a goods receipt. For a released Purchase Order with service lines (items of type Service,
   or G/L Account lines), the end user records the work done: % complete per line to date, who did it, who inspected it,
   a 1–5 quality rating and the reason for any delay. The system scores timeliness (30%), scope (30%) and quality (40%)
   and flags exceptions (quality 2 or lower, late because of the vendor, work different from the PO scope).
   Approval follows the Approval Rules for "ASR" (default: head of the requesting department; Supply Chain Manager too
   when there are exceptions). On final approval the accepted quantity is posted as a Purchase Receipt (WAR) on the PO,
   so AP can invoice only accepted work (Create Invoice → Get Receipt Lines). Progress reports are allowed: each ASR
   accepts the increase since the last one. A rejected ASR can be revised and sent again.
   Improvements over LG-ERP: every approval checks the approver and segregation of duties, lateness is an exception,
   progress is cumulative per line, and the ASR is listed on the PO. */

DOCS.ASR = { name: 'Approved Service Report', plural: 'Approved Service Reports', party: 'vendor', lines: 'none', post: false, system: true, noSeries: true,
  bc: 'Customized (posts a Purchase Receipt of the service lines)', head: [], desc: 'End-user acceptance of services before AP can invoice.' };
DOC_TYPES_FOR_RULES.push('ASR');
APPROVAL_CONDITIONS.push(['asrException', 'Only if the service report has exceptions']);
const asrCfg = () => Object.assign({ required: true, latePenalty: 10 }, DB.settings.asr || {});
const ASR_DELAY = [['Vendor', 'Vendor (counts against the vendor)'], ['Company', 'Our side (access, permits, materials)'], ['Weather', 'Weather'], ['Force majeure', 'Force majeure'], ['Other', 'Other']];
const ASR_Q = [['5', '5 – Excellent'], ['4', '4 – Good'], ['3', '3 – Acceptable'], ['2', '2 – Poor'], ['1', '1 – Unacceptable']];
const ASR_HDR = [
  { k: 'completionDate', l: 'Date work was done / checked', t: 'date', req: 1 }, { k: 'expectedDate', l: 'Expected completion (PO)', t: 'date' },
  { k: 'serviceLocation', l: 'Service location', req: 1 }, { k: 'performedBy', l: 'Performed by (vendor team / technician)', req: 1 },
  { k: 'inspectedBy', l: 'Inspected by (end user)', req: 1 }, { k: 'quality', l: 'Quality rating', t: 'select', opts: ASR_Q, req: 1 },
  { k: 'workDescription', l: 'Work done', t: 'textarea', w: 'w3', req: 1 }, { k: 'qualityNotes', l: 'Quality remarks (required if 2 or lower)', t: 'textarea', w: 'w3' },
  { k: 'delayReason', l: 'Reason for delay (if late)', t: 'select', opts: ASR_DELAY }, { k: 'delayNotes', l: 'Delay remarks', w: 'w2' },
  { k: 'scopeDeviation', l: 'Work differs from the PO scope', t: 'check' }, { k: 'scopeNotes', l: 'What is different', w: 'w2' }];

const asrDocs = co => DB.docs.filter(d => d.type === 'ASR' && (!co || d.company === co));
function asrIsService(co, l) {
  if (l.type === 'G/L Account') return true;
  if (l.type === 'Item') { const it = itemOf(l.no, co); return !!it && it.type === 'Service'; }
  return false;
}
const asrSvcLines = po => (po.lines || []).map((l, i) => ({ l, i })).filter(x => asrIsService(po.company, x.l));
const asrPctDone = (po, i) => { const q = num(po.lines[i].qty); return q ? Math.min(100, r2(num(po.lines[i].qtyReceived) / q * 100)) : 0; };
const asrOpenPO = po => po.type === 'PO' && ['Approved', 'Partially Received'].includes(po.status) && asrSvcLines(po).some(x => asrPctDone(po, x.i) < 100);
const asrOpenFor = po => asrDocs(po.company).find(a => a.poId === po.id && ['Draft', 'Pending Approval', 'Rejected'].includes(a.status));
const asrBlocks = (d, l) => !!d && d.type === 'PO' && asrCfg().required && asrIsService(d.company, l);
const asrCanRecord = () => true; // any user who received the service (usually the requester or site supervisor)
const asrCanManage = () => isAdmin() || hasRole('Supply Chain & Admin Head') || hasRole('Supply Chain Manager');
const asrDays = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const asrLineQty = l => r4(num(l.qty) * num(l.pct) / 100);
const asrValue = d => r2(sum(d.lines || [], l => Math.max(0, asrLineQty(l) - r4(num(l.qty) * num(l.pctPrev) / 100)) * num(l.unitCost)));

function asrScore(d) {
  const cfg = asrCfg(), late = d.expectedDate && d.completionDate && d.completionDate > d.expectedDate ? asrDays(d.expectedDate, d.completionDate) : 0;
  const vendorLate = late > 0 && (!d.delayReason || d.delayReason === 'Vendor');
  const timeliness = vendorLate ? Math.max(0, 100 - late * num(cfg.latePenalty)) : 100;
  const scope = d.lines.length ? r2(sum(d.lines, l => num(l.pct)) / d.lines.length) : 0;
  const quality = num(d.quality) * 20, overall = Math.round(0.3 * timeliness + 0.3 * scope + 0.4 * quality);
  const exceptions = [], notes = [];
  if (num(d.quality) && num(d.quality) <= 2) exceptions.push('Quality issue (rating 2 or lower)');
  if (vendorLate) exceptions.push(`Late by ${late} day(s), caused by the vendor`);
  if (d.scopeDeviation) exceptions.push('Work differs from the PO scope');
  if (late > 0 && !vendorLate) notes.push(`Late by ${late} day(s), not the vendor's fault (${d.delayReason}): timeliness not penalised`);
  const open = d.lines.filter(l => num(l.pct) < 100).length;
  if (open) notes.push(`Progress report: ${open} line(s) not yet 100% complete`);
  return { late, vendorLate, timeliness, scope, quality, overall, exceptions, notes, final: !open };
}
function asrVendorStats(vendor, co) {
  const from = addDays(today(), -365), xs = asrDocs(co).filter(a => a.vendor === vendor && a.status === 'Approved' && (a.completionDate || a.date) >= from);
  if (!xs.length) return null;
  const sc = xs.map(a => a.score || asrScore(a));
  return { n: xs.length, overall: Math.round(sum(sc, s => s.overall) / xs.length), timeliness: Math.round(sum(sc, s => s.timeliness) / xs.length), quality: r2(sum(xs, a => num(a.quality)) / xs.length) };
}
/* suggested marks for the vendor rating (vendacc.js) */
function asrSuggest(vendor, k) {
  const s = asrVendorStats(vendor, S.company); if (!s) return 0;
  if (k === 'delivery') return Math.max(1, Math.min(5, Math.round(s.timeliness / 20)));
  if (k === 'quality') return Math.max(1, Math.min(5, Math.round(s.quality)));
  return 0;
}

/* ---------- approval engine hooks ---------- */
const _approvalContext_asr = approvalContext;
approvalContext = function (d) {
  if (d.type !== 'ASR') return _approvalContext_asr(d);
  return { amount: asrValue(d), ga: false, notGa: true, capex: false, intlTravel: false, within: true, accts: [], asrException: asrScore(d).exceptions.length > 0 };
};
const _condMet_asr = condMet;
condMet = function (rule, ctx) { return rule.cond === 'asrException' ? !!ctx.asrException : _condMet_asr(rule, ctx); };
const _approveStep_asr = approveStep;
approveStep = function (o, c) { _approveStep_asr(o, c); if (o.type === 'ASR') { ersHist(o, `Approved by ${curUser().name}`, c); if (o.status === 'Approved') asrAccept(o); } };
const _rejectStep_asr = rejectStep;
rejectStep = function (o, c) { _rejectStep_asr(o, c); if (o.type === 'ASR') ersHist(o, `Rejected by ${curUser().name}`, c); };
const _docTotals_asr = docTotals;
docTotals = function (d) { if (d.type !== 'ASR') return _docTotals_asr(d); const v = asrValue(d); return { subtotal: v, vat: 0, wht: 0, total: v }; };
const _routeDoc_asr = ROUTES.doc;
ROUTES.doc = (type, id) => type === 'ASR' ? asrCard(id) : _routeDoc_asr(type, id);

/* accepted work becomes a Purchase Receipt (WAR) on the PO, which AP then invoices */
function asrAccept(d) {
  const po = DB.docs.find(x => x.id === d.poId); if (!po) fail(`Purchase Order ${d.poNo} no longer exists.`);
  if (!['Approved', 'Partially Received', 'Received'].includes(po.status)) fail(`Purchase Order ${po.no} is ${po.status}; it must be released to accept services.`);
  const q = d.lines.map(l => ({ l, inc: r4(asrLineQty(l) - num(po.lines[l.poLine].qtyReceived)) })).filter(x => x.inc > 0.00005);
  d.score = asrScore(d); d.acceptedAt = new Date().toISOString();
  if (!q.length) { ersHist(d, 'Accepted', 'Nothing new to receive on the PO'); return; }
  const rr = { id: uid(), type: 'RR', no: nextNo('RR', po.company), company: po.company, date: d.completionDate || today(), status: 'Posted', vendor: po.vendor, location: po.location, poNo: po.no,
    drNo: d.no, remarks: `Approved Service Report ${d.no}`, asrId: d.id, dims: clone(po.dims || {}), createdBy: curUser().id, createdAt: new Date().toISOString(), postedAt: new Date().toISOString(), approvals: [],
    lines: q.map(x => { const pl = po.lines[x.l.poLine]; return { poLine: x.l.poLine, type: pl.type, no: pl.no, description: pl.description, uom: pl.uom, qty: x.inc, unitCost: lineCalc(po, { ...pl, qty: 1 }).base * docRate(po), bin: '' }; }) };
  postReceipt(po, rr); DB.docs.push(rr); d.rrId = rr.id; d.rrNo = rr.no;
  ersHist(d, 'Accepted: service receipt posted on the PO', `${rr.no} · ₱${money(asrValue(d))} can now be invoiced`);
}

/* ---------- create, save, submit ---------- */
async function asrNew(poId) {
  let id = '';
  const ok = await commit(() => {
    const po = DB.docs.find(x => x.id === poId); if (!po) fail('Purchase Order not found.');
    const ex = asrOpenFor(po); if (ex) { id = ex.id; return; }
    if (!asrOpenPO(po)) fail(`${po.no} has no service lines left to accept (it must be released and not fully received).`);
    const pr = po.prNo && DB.docs.find(x => x.type === 'PR' && x.no === po.prNo && x.company === po.company);
    const loc = M(po.company).locations.find(l => l.code === po.location) || {};
    const y = today().slice(0, 4), k = 'ASR' + y; DB.meta.seq[k] = (DB.meta.seq[k] || 0) + 1;
    const d = { id: uid(), type: 'ASR', no: `ASR-${y}-${pad(DB.meta.seq[k], 4)}`, company: po.company, poId: po.id, poNo: po.no, prNo: po.prNo || '', vendor: po.vendor, dept: (pr && pr.dept) || curUser().department || '',
      date: today(), completionDate: today(), expectedDate: po.expectedDate || '', serviceLocation: loc.name || po.location || '', performedBy: '', inspectedBy: curUser().name,
      workDescription: (pr && pr.purpose) || po.remarks || '', quality: '', qualityNotes: '', delayReason: '', delayNotes: '', scopeDeviation: false, scopeNotes: '',
      lines: asrSvcLines(po).filter(x => asrPctDone(po, x.i) < 100).map(x => ({ poLine: x.i, no: x.l.no, description: x.l.description, uom: x.l.uom, qty: num(x.l.qty), unitCost: num(x.l.unitCost), pctPrev: asrPctDone(po, x.i), pct: asrPctDone(po, x.i), remarks: '' })),
      status: 'Draft', createdBy: curUser().id, createdAt: new Date().toISOString(), approvals: [], history: [] };
    DB.docs.push(d); id = d.id; ersHist(d, 'Service report started', `For ${po.no}`);
  }, 'Started Approved Service Report', (DB.docs.find(x => x.id === poId) || {}).no);
  if (ok !== false && id) go(`#/asr/${id}`);
}
function asrRead(d) {
  const h = readForm(ASR_HDR, 'as');
  const lines = d.lines.map((l, i) => ({ ...l, pct: $('#as_pct' + i) ? num($('#as_pct' + i).value) : l.pct, remarks: $('#as_rem' + i) ? $('#as_rem' + i).value.trim() : l.remarks }));
  return { ...h, lines };
}
async function asrSave(id, quiet) {
  const d0 = DB.docs.find(x => x.id === id), v = asrRead(d0);
  const ok = await commit(() => { const d = DB.docs.find(x => x.id === id); if (d.status !== 'Draft') fail('Only a draft can be changed.'); Object.assign(d, v); }, quiet ? '' : 'Saved Approved Service Report', d0.no);
  if (ok !== false && !quiet) { toast('Saved.'); render(); }
  return ok;
}
function asrValidate(d) {
  const po = DB.docs.find(x => x.id === d.poId); if (!po) fail(`Purchase Order ${d.poNo} no longer exists.`);
  if (!['Approved', 'Partially Received'].includes(po.status)) fail(`Purchase Order ${po.no} is ${po.status}. Services can only be accepted on a released PO.`);
  requireFields(ASR_HDR, d);
  if (d.completionDate > today()) fail('The completion date cannot be in the future. Record the work once it has been done.');
  if (num(d.quality) <= 2 && !d.qualityNotes) fail('Explain the quality problem in "Quality remarks".');
  if (d.expectedDate && d.completionDate > d.expectedDate && !d.delayReason) fail(`The work is ${asrDays(d.expectedDate, d.completionDate)} day(s) late. Choose the reason for the delay.`);
  if (d.scopeDeviation && !d.scopeNotes) fail('Describe how the work differs from the PO scope.');
  let up = 0;
  d.lines.forEach(l => {
    const done = asrPctDone(po, l.poLine);
    if (num(l.pct) < 0 || num(l.pct) > 100) fail(`${l.description}: % complete must be between 0 and 100.`);
    if (num(l.pct) < done - 0.001) fail(`${l.description}: ${done}% was already accepted. Enter the % complete to date (${done}% or more).`);
    l.pctPrev = done; if (num(l.pct) > done + 0.001) up++;
  });
  if (!up) fail('Enter the % complete to date for at least one line (more than what was already accepted).');
}
async function asrSubmit(id) {
  const d0 = DB.docs.find(x => x.id === id), v = asrRead(d0);
  const ok = await commit(() => {
    const d = DB.docs.find(x => x.id === id); if (d.status !== 'Draft') fail('This report was already sent.');
    Object.assign(d, v); asrValidate(d); d.score = asrScore(d);
    submitForApproval(d, 'ASR');
    ersHist(d, 'Sent for acceptance', d.score.exceptions.length ? `Exceptions: ${d.score.exceptions.join('; ')}` : `Score ${d.score.overall}/100, no exceptions`);
    if (d.status === 'Approved') asrAccept(d);
  }, 'Sent Approved Service Report for approval', d0.no);
  if (ok !== false) { const d = DB.docs.find(x => x.id === id); toast(d.status === 'Approved' ? `Accepted. Receipt ${d.rrNo || ''} posted; AP can invoice it.` : `Sent for approval to ${pendingStep(d).role}.`); render(); }
}
function asrDecide(id, approve) {
  const d = DB.docs.find(x => x.id === id);
  modal(`${approve ? 'Approve' : 'Reject'} ${d.no}`, `${approve ? `<p>Accepting posts a service receipt of <b>₱${money(asrValue(d))}</b> (excl. VAT) on ${esc(d.poNo)} once the last approver signs. AP can then invoice it.</p>` : ''}
    <label class="fld w3"><span>${approve ? 'Comment (optional)' : 'Reason for rejection *'}</span><textarea id="as_c" rows="3"></textarea></label>`, async () => {
    const c = $('#as_c').value.trim(); if (!approve && !c) { toast('Give the reason for rejecting.', 'err'); return false; }
    const ok = await commit(() => { const x = DB.docs.find(y => y.id === id); approve ? approveStep(x, c) : rejectStep(x, c); }, `${approve ? 'Approved' : 'Rejected'} Approved Service Report`, d.no);
    if (ok !== false) { const x = DB.docs.find(y => y.id === id); toast(x.status === 'Approved' ? `Accepted. Receipt ${x.rrNo || ''} posted on ${x.poNo}.` : approve ? `Approved. Next: ${pendingStep(x).role}.` : 'Rejected. The person who recorded it can revise and send it again.'); render(); } else return false;
  }, approve ? 'Approve' : 'Reject');
}
async function asrRevise(id) {
  const ok = await commit(() => { const d = DB.docs.find(x => x.id === id); if (!['Rejected', 'Pending Approval'].includes(d.status)) fail('Only a rejected or pending report can be revised.'); d.status = 'Draft'; d.approvals = []; ersHist(d, 'Reopened for revision'); }, 'Reopened Approved Service Report', (DB.docs.find(x => x.id === id) || {}).no);
  if (ok !== false) render();
}
async function asrDelete(id) {
  if (!confirm('Delete this draft service report?')) return;
  const d = DB.docs.find(x => x.id === id);
  const ok = await commit(() => { if (d.status !== 'Draft') fail('Only drafts can be deleted.'); DB.docs = DB.docs.filter(x => x.id !== id); }, 'Deleted Approved Service Report draft', d.no);
  if (ok !== false) go('#/asr');
}
function asrSettings() {
  const c = asrCfg();
  modal('Service acceptance settings', `<div class="form-grid"><label class="fld chk w3"><span>Services must be accepted with an Approved Service Report before AP can invoice</span><input type="checkbox" id="asx_req" ${c.required ? 'checked' : ''}></label>
    <label class="fld">Timeliness points lost per day late<input type="number" id="asx_pen" value="${c.latePenalty}"></label></div>
    <p class="small muted">Service lines are items of type Service and G/L Account lines on a Purchase Order. When this is on, "Post Receipt" is not available for them.
    Approvers are set in Approval Rules, document type <b>ASR</b> (condition "Only if the service report has exceptions" adds a step only when needed).</p>`, async () => {
    const ok = await commit(() => { DB.settings.asr = { required: $('#asx_req').checked, latePenalty: num($('#asx_pen').value) || 10 }; }, 'Changed service acceptance settings');
    if (ok !== false) render(); else return false;
  });
}

/* ---------- list ---------- */
const ASR_F = { tab: 'open' };
route('asr', id => id ? asrCard(id) : asrList());
function asrList() {
  const co = S.company, all = asrDocs(co).sort((a, b) => (b.no > a.no ? 1 : -1));
  const toDo = DB.docs.filter(d => d.company === co && asrOpenPO(d) && !asrOpenFor(d));
  const tabs = { open: ['Open', a => ['Draft', 'Pending Approval', 'Rejected'].includes(a.status)], draft: ['Draft', a => a.status === 'Draft'], pending: ['Pending approval', a => a.status === 'Pending Approval'],
    rejected: ['Rejected', a => a.status === 'Rejected'], approved: ['Approved', a => a.status === 'Approved'], all: ['All', () => true] };
  const rows = all.filter(tabs[ASR_F.tab][1]);
  const tile = (l, v, s, k) => `<a class="tile" href="#/asr" ${k ? `onclick="ASR_F.tab='${k}'"` : ''}><span>${l}</span><b>${v}</b><small>${s}</small></a>`;
  return pageHead('Service Acceptance (ASR)', `Approved Service Reports for <b>${esc(companyName(co))}</b>. The end user confirms the work on a service PO; once approved, the accepted part is received on the PO and AP can invoice it.${asrCfg().required ? '' : ' <b>Acceptance is currently optional</b> (settings).'}`,
    asrCanManage() ? '<button class="btn" onclick="asrSettings()">Settings</button>' : '') +
  `<div class="tiles">${tile('Service POs to accept', toDo.length, 'released, work not yet accepted')}${tile('Drafts', all.filter(a => a.status === 'Draft').length, 'not yet sent', 'draft')}${tile('Pending approval', all.filter(a => a.status === 'Pending Approval').length, 'department head / Supply Chain', 'pending')}${tile('Approved this month', all.filter(a => a.status === 'Approved' && (a.acceptedAt || '').slice(0, 7) === today().slice(0, 7)).length, 'receipts posted', 'approved')}</div>
  ${toDo.length ? `<div class="card"><h3>Service Purchase Orders waiting for acceptance</h3><div class="tbl-wrap"><table class="grid"><thead><tr><th>PO</th><th>Vendor</th><th>Service lines</th><th>Expected</th><th class="num">Accepted so far</th><th></th></tr></thead><tbody>
    ${toDo.map(po => { const sl = asrSvcLines(po); return `<tr><td><a href="#/doc/PO/${po.id}">${esc(po.no)}</a></td><td>${esc(partyName('vendor', po.vendor, co))}</td><td class="small">${sl.map(x => esc(x.l.description || x.l.no)).join('<br>')}</td>
      <td class="${po.expectedDate && po.expectedDate < today() ? 'bad' : ''}">${esc(po.expectedDate || '—')}</td><td class="num">${sl.map(x => asrPctDone(po, x.i) + '%').join('<br>')}</td><td><button class="btn sm primary" onclick="asrNew('${po.id}')">Record completion</button></td></tr>`; }).join('')}</tbody></table></div></div>` : ''}
  <div class="card"><div class="tbl-tools"><div class="segs">${Object.entries(tabs).map(([k, t]) => `<button class="${ASR_F.tab === k ? 'on' : ''}" onclick="ASR_F.tab='${k}';render()">${t[0]} (${all.filter(t[1]).length})</button>`).join('')}</div></div>
  ${rows.length ? `<div class="tbl-wrap"><table class="grid"><thead><tr><th>ASR</th><th>PO</th><th>Vendor</th><th>Work</th><th>Completed</th><th class="num">Value accepted</th><th class="num">Score</th><th>Exceptions</th><th>Status</th></tr></thead><tbody>
    ${rows.map(a => { const s = a.score || asrScore(a); return `<tr onclick="go('#/asr/${a.id}')" style="cursor:pointer"><td><b>${esc(a.no)}</b></td><td>${esc(a.poNo)}</td><td>${esc(partyName('vendor', a.vendor, co))}</td><td class="small">${esc((a.workDescription || '').slice(0, 60))}</td>
      <td>${esc(a.completionDate || '')}</td><td class="num">${money(asrValue(a))}</td><td class="num">${a.quality ? s.overall : '—'}</td><td class="small">${s.exceptions.length ? `<span class="bad">${s.exceptions.length}</span>` : '—'}</td><td>${badge(a.status)}</td></tr>`; }).join('')}</tbody></table></div>`
    : '<p class="muted" style="margin:0">No service reports here.</p>'}</div>`;
}

/* ---------- card ---------- */
function asrCard(id) {
  const d = DB.docs.find(x => x.id === id && x.type === 'ASR'); if (!d) return '<div class="card">Service report not found.</div>';
  const co = d.company, po = DB.docs.find(x => x.id === d.poId), ed = d.status === 'Draft' && (d.createdBy === curUser().id || isAdmin());
  const s = d.status === 'Approved' && d.score ? d.score : asrScore(d), vs = asrVendorStats(d.vendor, co);
  const acts = [];
  if (ed) { acts.push(`<button class="btn" onclick="asrSave('${id}')">💾 Save</button>`, `<button class="btn primary" onclick="asrSubmit('${id}')">Send for acceptance ➜</button>`, `<button class="btn danger ghost" onclick="asrDelete('${id}')">Delete</button>`); }
  if (d.status === 'Pending Approval' && canApprove(d)) acts.push(`<button class="btn primary" onclick="asrDecide('${id}',true)">✔ Approve</button>`, `<button class="btn danger" onclick="asrDecide('${id}',false)">✖ Reject</button>`);
  if (['Rejected', 'Pending Approval'].includes(d.status) && (d.createdBy === curUser().id || isAdmin())) acts.push(`<button class="btn ${d.status === 'Rejected' ? 'primary' : 'ghost'}" onclick="asrRevise('${id}')">${d.status === 'Rejected' ? 'Revise and resend' : 'Withdraw to revise'}</button>`);
  acts.push(`<button class="btn ghost" onclick="asrPrint('${id}')">🖨 Print</button>`);
  const why = d.status === 'Pending Approval' && !canApprove(d) ? whyCannotApprove(d) : '';
  const bar = (l, v, w) => `<div style="margin:6px 0"><div style="display:flex;justify-content:space-between" class="small"><span>${l} (${w}%)</span><b>${Math.round(v)}</b></div><div style="height:6px;background:#e8edf5;border-radius:4px"><div style="height:6px;width:${Math.max(0, Math.min(100, v))}%;background:${v >= 80 ? 'var(--ok)' : v >= 50 ? 'var(--warn)' : 'var(--bad, #c0392b)'};border-radius:4px"></div></div></div>`;
  return pageHead(`Service Report ${d.no}`, `${badge(d.status)} &nbsp;PO ${po ? `<a href="#/doc/PO/${po.id}">${esc(d.poNo)}</a>` : esc(d.poNo)}${d.prNo ? ` · from ${esc(d.prNo)}` : ''} · <b>${esc(partyName('vendor', d.vendor, co))}</b>${d.rrNo ? ` · receipt <a href="#/doc/RR/${d.rrId}">${esc(d.rrNo)}</a>` : ''}`, '<a class="btn ghost" href="#/asr">← Service reports</a>') +
  `<div class="ers-layout"><div>
    ${why ? `<div class="alertbox warn"><span>ℹ</span><div>${esc(why)}</div></div>` : ''}
    <div class="card"><h3>Service details</h3><div class="form-grid">${ASR_HDR.map(f => fieldHtml(f, d[f.k], 'as', !ed || f.k === 'expectedDate')).join('')}</div></div>
    <div class="card"><h3>Work accepted per PO line</h3><div class="tbl-wrap"><table class="grid compact"><thead><tr><th>Service</th><th class="num">PO qty</th><th>Unit</th><th class="num">Accepted before</th><th class="num" style="width:130px">% complete to date</th><th class="num">Qty accepted now</th><th class="num">Value (excl. VAT)</th><th>Remarks</th></tr></thead><tbody>
      ${d.lines.map((l, i) => { const prev = d.status === 'Draft' && po ? asrPctDone(po, l.poLine) : num(l.pctPrev), inc = Math.max(0, asrLineQty(l) - r4(num(l.qty) * prev / 100));
        return `<tr><td><b>${esc(l.no)}</b> ${esc(l.description || '')}</td><td class="num">${qtyf(l.qty)}</td><td>${esc(l.uom || '')}</td><td class="num">${prev}%</td>
        <td>${ed ? `<input type="number" id="as_pct${i}" class="num" min="${prev}" max="100" step="any" value="${num(l.pct)}" style="width:110px">` : `<b>${num(l.pct)}%</b>`}</td><td class="num">${qtyf(inc)}</td><td class="num">${money(inc * num(l.unitCost))}</td>
        <td>${ed ? `<input id="as_rem${i}" value="${esc(l.remarks || '')}" style="width:100%;min-width:140px">` : esc(l.remarks || '')}</td></tr>`; }).join('')}
      <tr><td colspan="6"><b>Total accepted by this report</b></td><td class="num"><b>${money(asrValue(d))}</b></td><td></td></tr></tbody></table></div>
      <p class="small muted" style="margin:8px 0 0">Enter the % of each service done <b>to date</b>. Only the increase since the last approved report is accepted. Prices are not printed on the service report.</p></div>
  </div><div class="ers-side">
    <div class="card"><h3>Service score <span style="float:right;font-size:22px;color:${s.overall >= 80 ? 'var(--ok)' : 'var(--warn)'}">${d.quality ? s.overall : '—'}<span class="small muted">/100</span></span></h3>
      ${bar('Timeliness', s.timeliness, 30)}${bar('Scope completed', s.scope, 30)}${bar('Quality', s.quality, 40)}
      ${s.exceptions.length ? `<div class="alertbox warn" style="margin-top:10px"><span>⚠</span><div><b>Exceptions</b>${s.exceptions.map(esc).join('<br>')}</div></div>` : '<p class="small" style="margin:8px 0 0;color:var(--ok)">No exceptions.</p>'}
      ${s.notes.length ? `<p class="small muted" style="margin:8px 0 0">${s.notes.map(esc).join('<br>')}</p>` : ''}</div>
    ${vs ? `<div class="card"><h3>Vendor service record (12 months)</h3><div class="kvlist"><div><span>Approved reports</span><b>${vs.n}</b></div><div><span>Average score</span><b>${vs.overall}</b></div><div><span>Average timeliness</span><b>${vs.timeliness}</b></div><div><span>Average quality</span><b>${vs.quality} / 5</b></div></div></div>` : ''}
    ${approvalPanel(d)}
    <div class="card"><h3>History</h3><div class="kvlist">${(d.history || []).slice().reverse().map(h => `<div style="display:block"><b>${esc(h.action)}</b> <span class="muted small">· ${esc(h.by)} · ${esc(h.at.slice(0, 16).replace('T', ' '))}</span>${h.remarks ? `<div class="small muted">${esc(h.remarks)}</div>` : ''}</div>`).join('')}</div></div>
  </div></div><div class="card" style="margin:12px 0 0;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">${acts.join('')}</div>`;
}

/* ---------- print (no prices) ---------- */
function asrPrint(id) {
  const d = DB.docs.find(x => x.id === id), s = d.score || asrScore(d), w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups to print the service report.', 'err');
  const u = DB.users.find(x => x.id === d.createdBy) || {};
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.no)}</title><style>@page{size:A4;margin:14mm} body{font:12px Arial,sans-serif;color:#000;margin:0} h1{font-size:17px;margin:0} h2{font-size:13px;margin:2px 0 10px;font-weight:600}
    table{border-collapse:collapse;width:100%;margin:8px 0} td,th{border:1px solid #555;padding:4px 6px;vertical-align:top;text-align:left} th{background:#e8edf5} .n{text-align:right} .kv td:first-child{width:28%;font-weight:700}
    .sign{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:34px} .sign div{border-top:1px solid #000;padding-top:3px;font-size:11px}</style></head><body>
    <h1>${esc(companyName(d.company))}</h1><h2>APPROVED SERVICE REPORT · ${esc(d.no)} · ${esc(d.status)}</h2>
    <table class="kv"><tbody><tr><td>Purchase Order</td><td>${esc(d.poNo)}${d.prNo ? ` (requisition ${esc(d.prNo)})` : ''}</td></tr><tr><td>Vendor</td><td>${esc(d.vendor)} – ${esc(partyName('vendor', d.vendor, d.company))}</td></tr>
    <tr><td>Service location</td><td>${esc(d.serviceLocation)}</td></tr><tr><td>Date completed / checked</td><td>${esc(d.completionDate)}${d.expectedDate ? ` (expected ${esc(d.expectedDate)})` : ''}</td></tr>
    <tr><td>Performed by</td><td>${esc(d.performedBy)}</td></tr><tr><td>Work done</td><td>${esc(d.workDescription)}</td></tr>
    <tr><td>Quality</td><td>${'★'.repeat(num(d.quality))}${'☆'.repeat(5 - num(d.quality))} (${num(d.quality)}/5) ${esc(d.qualityNotes || '')}</td></tr>
    ${d.delayReason ? `<tr><td>Delay</td><td>${esc(d.delayReason)} ${esc(d.delayNotes || '')}</td></tr>` : ''}${d.scopeDeviation ? `<tr><td>Scope difference</td><td>${esc(d.scopeNotes)}</td></tr>` : ''}
    <tr><td>Service score</td><td>${s.overall}/100 (timeliness ${Math.round(s.timeliness)}, scope ${Math.round(s.scope)}, quality ${s.quality})${s.exceptions.length ? ` · Exceptions: ${esc(s.exceptions.join('; '))}` : ''}</td></tr></tbody></table>
    <table><thead><tr><th>Service</th><th class="n">PO qty</th><th>Unit</th><th class="n">Accepted before</th><th class="n">% complete to date</th><th class="n">Qty accepted</th><th>Remarks</th></tr></thead><tbody>
    ${d.lines.map(l => `<tr><td>${esc(l.no)} ${esc(l.description || '')}</td><td class="n">${qtyf(l.qty)}</td><td>${esc(l.uom || '')}</td><td class="n">${num(l.pctPrev)}%</td><td class="n">${num(l.pct)}%</td><td class="n">${qtyf(Math.max(0, asrLineQty(l) - r4(num(l.qty) * num(l.pctPrev) / 100)))}</td><td>${esc(l.remarks || '')}</td></tr>`).join('')}</tbody></table>
    <div class="sign"><div>Recorded by: <b>${esc(u.name || '')}</b></div><div>Inspected by (end user): <b>${esc(d.inspectedBy)}</b></div>
    ${(d.approvals || []).map(a => `<div>Approved by: <b>${esc(a.status === 'Approved' ? a.by : '')}</b><br>${esc(a.role)} · ${esc(a.status === 'Approved' ? (a.at || '').slice(0, 10) : a.status)}</div>`).join('')}</div>
    <p style="font-size:9px;color:#555;margin-top:16px">Printed from the Leonio ERP on ${new Date().toLocaleString('en-PH')}.${d.rrNo ? ` Service receipt ${esc(d.rrNo)}.` : ''}</p><script>setTimeout(()=>window.print(),300)<\/script></body></html>`);
  w.document.close();
}

/* ---------- PO page: button, hide Post Receipt for service-only POs, related panel ---------- */
const _extraButtons_asr = extraButtons;
extraButtons = function (btn) {
  _extraButtons_asr(btn);
  const d = ED; if (!d || d.type !== 'PO' || !d.id) return;
  const po = DB.docs.find(x => x.id === d.id); if (!po || !asrOpenPO(po)) return;
  const a = asrOpenFor(po);
  if (a) btn(`Service report ${a.no} (${a.status}) ➜`, `go('#/asr/${a.id}')`, 'primary');
  else btn('Record Service Completion (ASR) ➜', `asrNew('${po.id}')`, 'primary');
};
const _whseHides_asr = whseHides;
whseHides = function (label) {
  const d = ED;
  if (d && d.type === 'PO' && /Post Receipt/.test(label) && asrCfg().required && !d.lines.some(l => !asrBlocks(d, l) && num(l.qty) > num(l.qtyReceived))) return true;
  return _whseHides_asr(label);
};
const _relatedPanel_asr = relatedPanel;
relatedPanel = function () {
  const d = ED, base = _relatedPanel_asr(); if (!d) return base;
  if (d.type === 'PO' && d.id) {
    const xs = asrDocs(d.company).filter(a => a.poId === d.id); if (!xs.length) return base;
    return `<div class="card"><h3>Service reports (ASR)</h3><table class="grid compact"><tbody>${xs.map(a => `<tr><td><a href="#/asr/${a.id}">${esc(a.no)}</a></td><td>${esc(a.completionDate || '')}</td><td>${a.lines.map(l => num(l.pct) + '%').join(', ')}</td><td>${badge(a.status)}</td></tr>`).join('')}</tbody></table></div>` + base;
  }
  if (d.type === 'RR' && d.asrId) return `<div class="card"><h3>Accepted through</h3><p style="margin:0"><a href="#/asr/${d.asrId}">${esc(d.drNo)}</a> (Approved Service Report)</p></div>` + base;
  return base;
};
const asrBadgeCount = () => asrDocs(S.company).filter(a => canApprove(a)).length;

/* default approval rules: head of the requesting department; Supply Chain Manager too when there are exceptions */
function asrMigrate() {
  let ch = false;
  if (!DB.approvalRules.some(r => r.docType === 'ASR')) {
    DB.approvalRules.push({ id: uid(), docType: 'ASR', seq: 10, role: 'Department Head', cond: 'always', amount: 0, approverType: 'Department head' },
      { id: uid(), docType: 'ASR', seq: 20, role: 'Supply Chain Manager', cond: 'asrException', amount: 0, approverType: 'Role' });
    ch = true;
  }
  if (!DB.settings.asr) { DB.settings.asr = { required: true, latePenalty: 10 }; ch = true; }
  return ch;
}
