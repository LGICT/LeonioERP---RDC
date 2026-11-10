'use strict';
/* ============ Approval designer (backlog: "Approval designer") ============
   A visual editor for the approval chains in DB.approvalRules, per document type and per company.
   Each step: who approves (role, immediate superior, department head or a named user), when (always, by amount,
   amount band, budget, G&A, capex …, plus optional limits by the creator's department or a dimension value such as a
   vessel), Required or Automatic (recorded as approved by the system, for the trail), and an alternate approver who
   may act instead. A company may have its own chain; otherwise the "all companies" chain applies.
   Changes are made in a draft and published together (Change Log). "Who would approve this?" runs the draft chain
   for an example document and names the people, with warnings (no one can approve, approver without permission,
   creator would approve their own document). Changes apply to documents sent for approval after publishing. */

APPROVAL_CONDITIONS.push(['amountBetween', 'Only if amount is in a band (from – below)']);
const AP_MODES = [['Required', 'Required'], ['Automatic', 'Automatic (recorded, no action)']];
const apDocName = t => ({ MASTER: 'Master data cards (vendors, customers, items)', VACC: 'Vendor accreditation', VBANK: 'Vendor bank / payment-terms change' })[t] || (DOCS[t] || {}).name || t;

/* ---------- engine: company chains, extra conditions, automatic steps, alternate approvers ---------- */
const _approvalContext_ap = approvalContext;
approvalContext = function (d) {
  const ctx = _approvalContext_ap(d), u = DB.users.find(x => x.id === (d.requestedBy || d.createdBy || d.submittedBy)) || curUser() || {};
  return { ...ctx, dept: d.dept || u.department || '', dims: d.dims || {}, company: d.company || '' };
};
const _condMet_ap = condMet;
condMet = function (rule, ctx) {
  const base = rule.cond === 'amountBetween' ? ctx.amount >= num(rule.amount) && (!num(rule.amount2) || ctx.amount < num(rule.amount2)) : _condMet_ap(rule, ctx);
  if (!base) return false;
  const depts = (rule.depts || []).filter(Boolean); if (depts.length && !depts.includes(ctx.dept)) return false;
  if (rule.dimCode && (rule.dimValues || []).length && !(rule.dimValues || []).includes((ctx.dims || {})[rule.dimCode])) return false;
  return true;
};
function apRulesFor(docType, company, rules) {
  const all = (rules || DB.approvalRules).filter(r => r.docType === docType), own = company ? all.filter(r => r.company === company) : [];
  return (own.length ? own : all.filter(r => !r.company)).slice().sort((a, b) => a.seq - b.seq);
}
function apStep(r, obj) {
  const st = resolveApprover(r, obj);
  if (r.mode === 'Automatic') return { role: r.label || st.role, status: 'Approved', by: 'Automatic', at: new Date().toISOString(), auto: true };
  if (r.label) st.label = r.label;
  if (r.altType === 'Specific user' && r.altUserId) { const u = DB.users.find(x => x.id === r.altUserId); if (u) st.alt = { userId: u.id, name: u.name }; }
  else if (r.altType === 'Role' && r.altRole) st.alt = { role: r.altRole, name: r.altRole };
  return st;
}
function apChain(docType, obj, ctx, rules) {
  return apRulesFor(docType, obj.company, rules).filter(r => condMet(r, ctx)).map(r => apStep(r, obj))
    .filter((s, i, a) => !s.userId || !a.slice(0, i).some(p => p.userId === s.userId && p.status === s.status));
}
buildChain = function (ruleType, obj) { return apChain(ruleType, obj, approvalContext(obj)); };
const _submit_ap = submitForApproval;
submitForApproval = function (obj, ruleType) {
  _submit_ap(obj, ruleType);
  if (obj.status === 'Pending Approval' && !(obj.approvals || []).some(a => a.status === 'Pending')) { obj.status = 'Approved'; obj.approvedAt = new Date().toISOString(); }
};
const apAltOk = (o, st) => !!st && !!st.alt && o.createdBy !== curUser().id && (st.alt.userId ? st.alt.userId === curUser().id : hasRole(st.alt.role));
const _canApprove_ap = canApprove;
canApprove = function (o) { if (_canApprove_ap(o)) return true; const st = o && (pendingStep(o) || (o.status === 'Pending review' && (o.approvals || []).find(a => a.status === 'Pending'))); return apAltOk(o, st); };
const _why_ap = whyCannotApprove;
whyCannotApprove = function (o) { const w = _why_ap(o), st = o && pendingStep(o); if (w && apAltOk(o, st)) return ''; return w && st && st.alt ? `${w} Alternate: ${st.alt.name}.` : w; };
const _approveStep_ap = approveStep;
approveStep = function (o, c) {
  const st = pendingStep(o), viaAlt = st && st.alt && !_canApprove_ap(o) && apAltOk(o, st);
  _approveStep_ap(o, viaAlt ? `${c ? c + ' · ' : ''}(as alternate for ${st.role})` : c);
};

/* ---------- the designer ---------- */
const AP = { doc: '', co: '', draft: null, key: '', sim: null, q: '' };
const apKey = () => `${AP.doc}|${AP.co}`;
function apLoad() {
  const own = DB.approvalRules.filter(r => r.docType === AP.doc && (r.company || '') === AP.co);
  AP.draft = clone(own).sort((a, b) => a.seq - b.seq); AP.key = apKey(); AP.dirty = false;
}
route('apflow', () => {
  const types = DOC_TYPES_FOR_RULES.filter((t, i, a) => a.indexOf(t) === i);
  if (!AP.doc || !types.includes(AP.doc)) AP.doc = 'PO';
  if (!AP.draft || AP.key !== apKey()) apLoad();
  const editable = typeof can !== 'function' || can('admin', 'create');
  const cnt = t => { const r = DB.approvalRules.filter(x => x.docType === t); return { all: r.filter(x => !x.company).length, cos: [...new Set(r.filter(x => x.company).map(x => x.company))] }; };
  const list = types.filter(t => !AP.q || `${t} ${apDocName(t)}`.toLowerCase().includes(AP.q.toLowerCase()));
  const generic = DB.approvalRules.filter(r => r.docType === AP.doc && !r.company).length, inherits = AP.co && !AP.draft.length;
  return pageHead('Approval Designer', `Who approves each document, in what order and when. Pick a document on the left; changes stay in a draft until you <b>Publish</b>. They apply to documents sent for approval afterwards.`, `<a class="btn" href="#/list/approvalRules">Table view</a>`) +
  `<div class="rp-grid"><div class="card" style="align-self:start"><input placeholder="Search documents…" value="${esc(AP.q)}" oninput="AP.q=this.value;render()" style="width:100%;padding:6px 9px;border:1px solid #d5dce8;border-radius:8px;margin-bottom:8px">
      <div class="rp-roles">${list.map(t => { const c = cnt(t); return `<a href="#/apflow" class="${t === AP.doc ? 'on' : ''}" onclick="apPick('${t}');return false"><span>${esc(apDocName(t))}<br><small style="color:#7a8599">${esc(t)}${c.cos.length ? ' · own chain: ' + esc(c.cos.join(', ')) : ''}</small></span><small>${c.all ? c.all + ' step' + (c.all > 1 ? 's' : '') : 'none'}</small></a>`; }).join('')}</div></div>
    <div><div class="ers-layout"><div>
      <div class="card"><div class="lines-head"><div><h3 style="margin:0">${esc(apDocName(AP.doc))} <span class="muted small">(${esc(AP.doc)})</span></h3></div>
        <label class="fld" style="min-width:230px"><span>Chain for</span><select onchange="apScope(this.value)">${optionsHtml([['', 'All companies (standard chain)'], ...DB.companies.map(c => [c.code, `${c.code} only – ${c.name}`])], AP.co, false)}</select></label></div>
        ${inherits ? `<div class="alertbox"><span>ℹ</span><div><b>${esc(AP.co)} uses the all-companies chain</b>${generic ? `It has ${generic} step(s).` : 'There are no steps, so these documents are released without approval.'} ${editable ? `<button class="btn sm" style="margin-top:6px" onclick="apCopyGeneric()">Make a separate chain for ${esc(AP.co)}</button>` : ''}</div></div>` : apFlowHtml(editable)}
      </div>
      ${AP.dirty ? `<div class="card" style="margin:12px 0 0;display:flex;gap:8px;flex-wrap:wrap;justify-content:space-between;align-items:center"><span class="small"><b>Unpublished changes</b> to this chain.</span><span style="display:flex;gap:8px"><button class="btn ghost" onclick="apLoad();render()">Discard</button><button class="btn primary" onclick="apPublish()">Publish</button></span></div>` : ''}
    </div><div class="ers-side">${apSimHtml()}${apWarnHtml()}
      ${editable && !inherits ? `<div class="card"><h3>Copy this chain</h3><p class="small muted" style="margin:0 0 8px">Duplicate the draft to another document or company (it replaces the chain there).</p><div style="display:flex;gap:6px;flex-wrap:wrap"><select id="ap_cp_doc" style="flex:1;min-width:120px">${optionsHtml(types.map(t => [t, `${t} – ${apDocName(t)}`]), AP.doc, false)}</select><select id="ap_cp_co" style="flex:1;min-width:120px">${optionsHtml([['', 'All companies'], ...DB.companies.map(c => [c.code, c.code])], AP.co, false)}</select><button class="btn sm" onclick="apCopyTo()">Copy</button></div></div>` : ''}
    </div></div></div></div>`;
});
function apFlowHtml(editable) {
  const d = AP.draft, ro = !editable;
  const sel = (i, k, opts, v, blank) => `<select ${ro ? 'disabled' : ''} onchange="apSet(${i},'${k}',this.value)">${optionsHtml(opts, v, !!blank)}</select>`;
  const userOpts = DB.users.map(u => [u.id, `${u.name}${(u.roles || []).length ? ' – ' + u.roles.join(', ') : ''}`]);
  const dims = (M(AP.co || S.company).dimensions || []).map(x => [x.code, x.code]);
  const step = (r, i) => {
    const t = r.approverType || 'Role', amt = ['amountGte', 'amountLt', 'amountBetween'].includes(r.cond), auto = r.mode === 'Automatic';
    return `<div class="apf-arrow">↓</div><div class="apf-step ${auto ? 'auto' : ''}">
      <div class="apf-h"><b>Step ${i + 1}</b>${auto ? ' <span class="badge s-approved">automatic</span>' : ''}<span style="flex:1"></span>${ro ? '' : `<button class="btn sm ghost" title="Move up" ${i ? '' : 'disabled'} onclick="apMove(${i},-1)">▲</button><button class="btn sm ghost" title="Move down" ${i < d.length - 1 ? '' : 'disabled'} onclick="apMove(${i},1)">▼</button><button class="btn sm ghost" title="Remove step" onclick="apDel(${i})">✕</button>`}</div>
      <div class="apf-g">
        <label class="fld"><span>Approver type</span>${sel(i, 'approverType', APPROVER_TYPES.map(x => [x, x]), t)}</label>
        ${t === 'Specific user' ? `<label class="fld w2"><span>Person</span>${sel(i, 'userId', userOpts, r.userId, 1)}</label>` : `<label class="fld w2"><span>${t === 'Role' ? 'Role' : 'If nobody is found, the role'}</span>${sel(i, 'role', ROLES.map(x => [x, x]), r.role, 1)}</label>`}
        <label class="fld w2"><span>When</span>${sel(i, 'cond', APPROVAL_CONDITIONS, r.cond || 'always')}</label>
        ${amt ? `<label class="fld"><span>${r.cond === 'amountLt' ? 'Below ₱' : 'From ₱'}</span><input type="number" ${ro ? 'disabled' : ''} value="${num(r.amount) || ''}" onchange="apSet(${i},'amount',num(this.value))"></label>` : ''}
        ${r.cond === 'amountBetween' ? `<label class="fld"><span>Below ₱ (blank = no limit)</span><input type="number" ${ro ? 'disabled' : ''} value="${num(r.amount2) || ''}" onchange="apSet(${i},'amount2',num(this.value))"></label>` : ''}
        <label class="fld"><span>Step type</span>${sel(i, 'mode', AP_MODES, r.mode || 'Required')}</label>
        <label class="fld w2"><span>Only for creator's departments (codes, comma; blank = all)</span><input ${ro ? 'disabled' : ''} value="${esc((r.depts || []).join(', '))}" placeholder="e.g. TECH, PROD" onchange="apSet(${i},'depts',this.value.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean))"></label>
        <label class="fld"><span>Only if dimension</span>${sel(i, 'dimCode', dims, r.dimCode, 1)}</label>
        ${r.dimCode ? `<label class="fld w2"><span>is one of (codes, comma)</span><input ${ro ? 'disabled' : ''} value="${esc((r.dimValues || []).join(', '))}" onchange="apSet(${i},'dimValues',this.value.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean))"></label>` : ''}
        <label class="fld"><span>Alternate approver</span>${sel(i, 'altType', [['', 'None'], ['Role', 'A role'], ['Specific user', 'A person']], r.altType || '')}</label>
        ${r.altType === 'Role' ? `<label class="fld w2"><span>Alternate role</span>${sel(i, 'altRole', ROLES.map(x => [x, x]), r.altRole, 1)}</label>` : r.altType === 'Specific user' ? `<label class="fld w2"><span>Alternate person</span>${sel(i, 'altUserId', userOpts, r.altUserId, 1)}</label>` : ''}
      </div><p class="small muted" style="margin:6px 0 0">${esc(apStepText(r))}</p></div>`;
  };
  return `<div class="apf"><div class="apf-node">📝 Document sent for approval</div>${d.map(step).join('')}
    ${editable ? `<div class="apf-arrow">↓</div><button class="btn" style="width:100%;border-style:dashed" onclick="apAdd()">+ Add a step</button>` : ''}
    <div class="apf-arrow">↓</div><div class="apf-node end">✅ Approved: ${esc(AP.doc === 'PO' ? 'the order can be received' : 'released for the next step')}</div></div>
    ${!d.length ? '<p class="small bad" style="margin:8px 0 0">No steps: these documents are approved automatically when sent.</p>' : ''}`;
}
function apStepText(r) {
  const t = r.approverType || 'Role', who = t === 'Role' ? r.role || '(choose a role)' : t === 'Specific user' ? (DB.users.find(u => u.id === r.userId) || { name: '(choose a person)' }).name : `the requester's ${t.toLowerCase()}${r.role ? ` (else ${r.role})` : ''}`;
  const c = (APPROVAL_CONDITIONS.find(x => x[0] === (r.cond || 'always')) || [, r.cond])[1];
  const amt = r.cond === 'amountGte' ? ` ₱${money(r.amount)} and above` : r.cond === 'amountLt' ? ` below ₱${money(r.amount)}` : r.cond === 'amountBetween' ? ` ₱${money(r.amount)}${num(r.amount2) ? ' to below ₱' + money(r.amount2) : ' and above'}` : '';
  return `${r.mode === 'Automatic' ? 'Recorded automatically for' : 'Approved by'} ${who}. ${amt ? 'When the amount is' + amt : r.cond && r.cond !== 'always' ? c.replace(/\s*\(.*\)$/, '') : 'Always'}.${(r.depts || []).length ? ` Departments: ${r.depts.join(', ')}.` : ''}${r.dimCode && (r.dimValues || []).length ? ` ${r.dimCode}: ${r.dimValues.join(', ')}.` : ''}${r.altType ? ` Alternate: ${r.altType === 'Role' ? r.altRole : (DB.users.find(u => u.id === r.altUserId) || {}).name || ''}.` : ''}`;
}
function apPick(t) { if (AP.dirty && !confirm('Discard the unpublished changes?')) return; AP.doc = t; AP.co = ''; AP.draft = null; AP.sim = null; render(); }
function apScope(co) { if (AP.dirty && !confirm('Discard the unpublished changes?')) return render(); AP.co = co; AP.draft = null; AP.sim = null; render(); }
function apSet(i, k, v) {
  const r = AP.draft[i]; r[k] = v; AP.dirty = true;
  if (k === 'approverType' && v === 'Specific user' && !r.userId) r.userId = '';
  if (k === 'cond' && !['amountGte', 'amountLt', 'amountBetween'].includes(v)) { r.amount = 0; r.amount2 = 0; }
  if (k === 'altType' && !v) { delete r.altRole; delete r.altUserId; }
  if (k === 'dimCode' && !v) delete r.dimValues;
  render();
}
function apAdd() { AP.draft.push({ id: uid(), docType: AP.doc, company: AP.co, seq: 0, role: '', approverType: 'Role', cond: 'always', amount: 0, mode: 'Required' }); AP.dirty = true; render(); }
function apDel(i) { AP.draft.splice(i, 1); AP.dirty = true; render(); }
function apMove(i, d) { const a = AP.draft, j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; AP.dirty = true; render(); }
function apCopyGeneric() { AP.draft = clone(DB.approvalRules.filter(r => r.docType === AP.doc && !r.company).sort((a, b) => a.seq - b.seq)).map(r => ({ ...r, id: uid(), company: AP.co })); AP.dirty = true; render(); }
function apValidate(rules) {
  rules.forEach((r, i) => {
    const t = r.approverType || 'Role';
    if (t === 'Role' && !r.role) fail(`Step ${i + 1}: choose the role that approves.`);
    if (t === 'Specific user' && !r.userId) fail(`Step ${i + 1}: choose the person who approves.`);
    if (['amountGte', 'amountLt', 'amountBetween'].includes(r.cond) && !num(r.amount) && r.cond !== 'amountBetween') fail(`Step ${i + 1}: enter the amount.`);
    if (r.cond === 'amountBetween' && num(r.amount2) && num(r.amount2) <= num(r.amount)) fail(`Step ${i + 1}: the "below" amount must be higher than the "from" amount.`);
    if (r.altType === 'Role' && !r.altRole) fail(`Step ${i + 1}: choose the alternate role or set Alternate approver to None.`);
    if (r.altType === 'Specific user' && !r.altUserId) fail(`Step ${i + 1}: choose the alternate person or set Alternate approver to None.`);
  });
}
async function apPublish() {
  const doc = AP.doc, co = AP.co, rules = AP.draft.map((r, i) => ({ ...r, docType: doc, company: co, seq: (i + 1) * 10 }));
  const before = apRulesFor(doc, co || '').filter(r => (r.company || '') === co).map(apStepText), after = rules.map(apStepText);
  const ok = await commit(() => {
    if (typeof can === 'function' && !can('admin', 'create')) fail(permMsg('admin', 'create'));
    apValidate(rules);
    DB.approvalRules = DB.approvalRules.filter(r => !(r.docType === doc && (r.company || '') === co)).concat(rules);
  }, `Approval chain ${doc} (${co || 'all companies'}) published: ${after.length ? after.map((t, i) => `${i + 1}. ${t}`).join(' ') : 'no steps'}${before.length ? ` | before: ${before.map((t, i) => `${i + 1}. ${t}`).join(' ')}` : ''}`.slice(0, 900), doc);
  if (ok !== false) { AP.draft = null; toast('Approval chain published. It applies to documents sent for approval from now on.'); render(); }
}
async function apCopyTo() {
  const doc = $('#ap_cp_doc').value, co = $('#ap_cp_co').value;
  if (doc === AP.doc && co === AP.co) return toast('Choose another document or company.', 'err');
  if (!confirm(`Replace the approval chain of ${doc} (${co || 'all companies'}) with this one?`)) return;
  const rules = AP.draft.map((r, i) => ({ ...clone(r), id: uid(), docType: doc, company: co, seq: (i + 1) * 10 }));
  const ok = await commit(() => { if (typeof can === 'function' && !can('admin', 'create')) fail(permMsg('admin', 'create')); apValidate(rules); DB.approvalRules = DB.approvalRules.filter(r => !(r.docType === doc && (r.company || '') === co)).concat(rules); }, `Approval chain copied from ${AP.doc} (${AP.co || 'all'}) to ${doc} (${co || 'all'})`, doc);
  if (ok !== false) toast(`Copied to ${doc} (${co || 'all companies'}).`);
}

/* ---------- "Who would approve this?" and checks ---------- */
function apSimHtml() {
  const s = AP.sim || (AP.sim = { co: AP.co || S.company, user: 'u02', amount: 100000, within: true, ga: false, capex: false, dims: {} });
  const u = DB.users.find(x => x.id === s.user) || {}, dept = s.dept ?? u.department ?? '';
  const dimCodes = [...new Set(apRulesFor(AP.doc, s.co, apMerged(s.co)).map(r => r.dimCode).filter(Boolean))];
  const res = apSimulate();
  return `<div class="card"><h3>Who would approve this?</h3><div class="form-grid" style="grid-template-columns:1fr 1fr">
    <label class="fld"><span>Company</span><select onchange="AP.sim.co=this.value;render()">${optionsHtml(DB.companies.map(c => [c.code, c.code]), s.co, false)}</select></label>
    <label class="fld"><span>Amount ₱</span><input type="number" value="${s.amount}" onchange="AP.sim.amount=num(this.value);render()"></label>
    <label class="fld w2"><span>Created by</span><select onchange="AP.sim.user=this.value;AP.sim.dept=undefined;render()">${optionsHtml(DB.users.map(x => [x.id, x.name]), s.user, false)}</select></label>
    <label class="fld"><span>Department</span><input value="${esc(dept)}" onchange="AP.sim.dept=this.value.trim().toUpperCase();render()"></label>
    <label class="fld"><span>Budget</span><select onchange="AP.sim.within=this.value==='1';render()">${optionsHtml([['1', 'Within budget'], ['0', 'Outside budget']], s.within ? '1' : '0', false)}</select></label>
    <label class="fld chk"><span>G&A expense</span><input type="checkbox" ${s.ga ? 'checked' : ''} onchange="AP.sim.ga=this.checked;render()"></label>
    <label class="fld chk"><span>Capex / fixed asset</span><input type="checkbox" ${s.capex ? 'checked' : ''} onchange="AP.sim.capex=this.checked;render()"></label>
    ${dimCodes.map(c => `<label class="fld"><span>${esc(c)}</span><input value="${esc(s.dims[c] || '')}" onchange="AP.sim.dims['${c}']=this.value.trim().toUpperCase();render()"></label>`).join('')}</div>
    <div class="apf-sim">${res.steps.length ? res.steps.map((x, i) => `<div class="${x.problem ? 'bad' : ''}"><b>${i + 1}.</b> ${esc(x.label)}${x.auto ? ' <span class="muted">(automatic)</span>' : ''}<div class="small muted">${esc(x.who)}</div>${x.problem ? `<div class="small">⚠ ${esc(x.problem)}</div>` : ''}</div>`).join('') : '<div><b>No approval needed.</b><div class="small muted">No step applies: the document is approved as soon as it is sent.</div></div>'}
    ${res.skipped.length ? `<div class="small muted" style="margin-top:6px">Skipped: ${esc(res.skipped.join('; '))}</div>` : ''}</div>
    <p class="small muted" style="margin:8px 0 0">${AP.dirty ? 'Uses your unpublished draft.' : 'Uses the published chain.'}</p></div>`;
}
function apMerged(co) { // the rules as they would be after publishing the draft
  return DB.approvalRules.filter(r => !(r.docType === AP.doc && (r.company || '') === AP.co)).concat((AP.draft || []).map((r, i) => ({ ...r, docType: AP.doc, company: AP.co, seq: (i + 1) * 10 })));
}
function apSimulate() {
  const s = AP.sim, u = DB.users.find(x => x.id === s.user) || {}, dept = s.dept ?? u.department ?? '';
  const obj = { type: AP.doc, company: s.co, createdBy: s.user, requestedBy: s.user, dept, dims: s.dims };
  const ctx = { amount: num(s.amount), ga: !!s.ga, notGa: !s.ga, capex: !!s.capex, intlTravel: false, within: !!s.within, accts: [], asrException: false, dept, dims: s.dims, company: s.co };
  const rules = apMerged(s.co), used = apRulesFor(AP.doc, s.co, rules);
  const skipped = used.filter(r => !condMet(r, ctx)).map(r => apStepText(r).split('. ')[0]);
  const area = typeof areaOfDoc === 'function' ? areaOfDoc(AP.doc) : null;
  const steps = apChain(AP.doc, obj, ctx, rules).map(st => {
    if (st.auto) return { label: st.role, who: 'recorded by the system', auto: true };
    let people = st.userId ? DB.users.filter(x => x.id === st.userId) : DB.users.filter(x => (x.roles || []).includes(st.role));
    people = people.filter(x => x.id !== s.user && (!area || typeof can !== 'function' || st.userId || can(area, 'approve', x)));
    const alt = st.alt ? ` · alternate: ${st.alt.name}` : '';
    return { label: st.role, who: people.length ? people.map(x => x.name).join(', ') + alt : alt.replace(' · ', ''), problem: people.length || st.alt ? '' : (st.userId === s.user ? 'The creator would have to approve their own document; nobody else can, so it would be stuck.' : 'Nobody can approve this step (no user with this role and the Approve permission).') };
  });
  return { steps, skipped };
}
function apWarnHtml() {
  if (!AP.draft) return '';
  const w = [], area = typeof areaOfDoc === 'function' ? areaOfDoc(AP.doc) : null;
  AP.draft.forEach((r, i) => {
    const t = r.approverType || 'Role';
    if (t === 'Role' && r.role) { const us = DB.users.filter(u => (u.roles || []).includes(r.role)); if (!us.length) w.push(`Step ${i + 1}: no user has the role ${r.role}.`); else if (area && typeof can === 'function' && !us.some(u => can(area, 'approve', u))) w.push(`Step ${i + 1}: ${r.role} has no Approve permission for this document (Roles & Permissions).`); }
    if (t === 'Immediate superior') { const n = DB.users.filter(u => !u.reportsTo).length; if (n) w.push(`Step ${i + 1}: ${n} user(s) have no "Reports to"; for them the role ${r.role || 'Department Head'} approves instead.`); }
    if (t === 'Specific user' && r.userId && !DB.users.some(u => u.id === r.userId)) w.push(`Step ${i + 1}: the chosen person no longer exists.`);
  });
  const amounts = AP.draft.filter(r => r.cond === 'amountGte').map(r => num(r.amount)).sort((a, b) => a - b);
  if (AP.draft.length && AP.draft.every(r => r.cond && r.cond !== 'always')) w.push('Every step has a condition: documents that meet none of them are approved without anyone approving.');
  if (!AP.draft.length && !(AP.co && DB.approvalRules.some(r => r.docType === AP.doc && !r.company))) w.push('No steps: these documents are approved automatically when sent.');
  return `<div class="card"><h3>Checks</h3>${w.length ? `<ul class="small" style="margin:0;padding-left:18px">${w.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="small" style="margin:0;color:var(--ok)">No problems found.</p>'}${amounts.length > 1 ? `<p class="small muted" style="margin:8px 0 0">Amount levels: ${amounts.map(a => '₱' + money(a)).join(' → ')}</p>` : ''}</div>`;
}
