'use strict';
/* ============ ERS – Enterprise Requisition System inside the ERP ============
   Material Request (MRF) → approval (hierarchy or role, by amount) → Supply Chain review (stock check, shortages to a Purchase Requisition)
   → For Release → Warehouseman releases: posts the issue (Item Ledger negative adjustment at cost; Dr Inventory Adjmt. account with department
   and equipment, Cr Inventory). Replaces the Excel MRF/MIF and Warehouse Inventory Tracker (CPD-SCW-002-01, decision 14). */

DOCS.MR = { name: 'Material Request (MRF)', plural: 'Material Requests', lines: 'mr', post: false, system: true, noSeries: true,
  bc: 'Item Journal (Negative Adjmt.) posted on release', desc: 'Employee request for stock items, issued from the warehouse and charged to a department and equipment.', head: [] };
DOC_TYPES_FOR_RULES.push('MR');
APPROVAL_CONDITIONS.push(['amountLt', 'Only if amount below threshold']);
const APPROVER_TYPES = ['Role', 'Immediate superior', 'Department head', 'Specific user'];
const ERS_OPEN = ['Pending Approval', 'Supply Chain Review', 'For Release', 'Partially Released'];
const ERS_SC_ROLES = ['Supply Chain Specialist', 'Purchasing Assistant', 'Supply Chain & Admin Head', 'Supply Chain Manager'];
const ERS_REL_ROLES = ['Warehouseman'];
const ersIsSC = () => isAdmin() || ERS_SC_ROLES.some(hasRole);
const ersIsWH = () => isAdmin() || ERS_REL_ROLES.some(hasRole);

/* ---------- category icons (BC Item Category codes) ---------- */
const ERS_ICONS = {
  NICK: ['⛰️', '#047857', '#e6f6ef'], CHROM: ['⛰️', '#475569', '#eef1f5'], TIRE: ['🛞', '#334155', '#eef1f5'], USEDTIRE: ['🛞', '#64748b', '#f1f3f6'],
  FUEL: ['⛽', '#b45309', '#fff3e0'], FUELDC: ['⛽', '#b45309', '#fff3e0'], FUELIDC: ['⛽', '#b45309', '#fff3e0'],
  SPP: ['🔩', '#1d4ed8', '#e8effd'], TREP: ['🔧', '#dc2626', '#fdecec'], TMAIN: ['🔧', '#dc2626', '#fdecec'], TECH: ['🛠️', '#7c3aed', '#f1eafe'],
  REUSE: ['♻️', '#059669', '#e6f6ef'], SCRAP: ['🗑️', '#6b7280', '#f1f3f6'],
  ADM: ['📄', '#1a56db', '#e8effd'], ADMIN: ['📄', '#1a56db', '#e8effd'], SITEOFFSUPP: ['📎', '#1a56db', '#e8effd'], EXE: ['💼', '#0f766e', '#e6f6f4'], HRD: ['👥', '#0891b2', '#e3f5f9'],
  VESS: ['🚢', '#0369a1', '#e0f2fe'], PTHUST: ['⚓', '#0369a1', '#e0f2fe'], PORTOP: ['⚓', '#0369a1', '#e0f2fe'], POR: ['⚓', '#0369a1', '#e0f2fe'], HAUL: ['🚚', '#a16207', '#fef9c3'],
  PROJ: ['📐', '#4338ca', '#eef2ff'], PROJMGT: ['📐', '#4338ca', '#eef2ff'], MINEDEV: ['⛏️', '#92400e', '#fef3c7'], EXPLO: ['🧭', '#92400e', '#fef3c7'],
  OPS: ['⚙️', '#374151', '#eef1f5'], OTHDC: ['📦', '#64748b', '#eef1f5'], OTHMH: ['📦', '#64748b', '#eef1f5'], COMMON: ['📦', '#64748b', '#eef1f5'],
  LAB: ['🧪', '#7c3aed', '#f1eafe'], OHS: ['🦺', '#059669', '#e6f6ef'], ASHP: ['🦺', '#059669', '#e6f6ef'], ENVI: ['🌿', '#15803d', '#e7f7ec'], EPEP: ['🌿', '#15803d', '#e7f7ec'],
  TRP: ['🌳', '#15803d', '#e7f7ec'], TCEP: ['🌱', '#15803d', '#e7f7ec'], SDMP: ['🤝', '#c2410c', '#fff0e6'], COMREL: ['🤝', '#c2410c', '#fff0e6'],
  COMM: ['📈', '#0f766e', '#e6f6f4'], COML: ['📈', '#0f766e', '#e6f6f4'], CASHADV: ['💵', '#15803d', '#e7f7ec'], _: ['📦', '#64748b', '#eef1f5']
};
const ersCat = it => ERS_ICONS[U(it && it.category)] || ERS_ICONS._;
const ersCatName = (code, co) => { const c = M(co).itemCategories.find(x => U(x.code) === U(code)); return c ? (c.description || c.code) : (code || 'Uncategorised'); };
const ersPhotoKey = (co, no) => `${MDS(co)}|${no}`;
function ersThumb(itemNo, co, size = '') {
  const it = itemOf(itemNo, co) || {}, s = ersCat(it), ph = (DB.itemPhotos || {})[ersPhotoKey(co, itemNo)];
  return `<span class="thumb ${size}" style="background:${s[2]}" title="${esc(ersCatName(it.category, co))}">${ph ? `<img src="${ph}" alt="">` : s[0]}</span>`;
}

/* ---------- helpers ---------- */
const ersDeptDim = co => { const d = M(co).dimensions.find(x => U(x.code) === 'DEPT') || M(co).dimensions.find(x => /depart/i.test(x.name || '')); return d ? d.code : ''; };
const ersDepts = co => { const dim = ersDeptDim(co); return M(co).dimValues.filter(v => v.dim === dim && (!v.type || v.type === 'Standard')).map(v => [v.code, `${v.code} – ${v.name || ''}`]); };
const ersCost = (co, no) => r4(avgCost(co, no) || num((itemOf(no, co) || {}).unitCost));
/* Issuance expense account per Gen. Prod. Posting Group: the Issuance Accounts setup first, else the Inventory Adjmt. Account of General
   Posting Setup when it is a real expense account (in the imported Mining setup it is blank for most groups, and equals the inventory account for fuel). */
function ersSetupAcc(co, prod) {
  let gs = ''; try { gs = gpAcc(co, invAdjBus(co, prod), prod, 'invAdj', 'Inventory Adjmt. Account'); } catch (e) { }
  const invs = new Set(M(co).invSetup.map(s => s.inventory).filter(Boolean));
  return { gs, gsUsable: !!gs && !invs.has(gs), override: (DB.issueAccounts || {})[`${MDS(co)}|${U(prod)}`] || '' };
}
function ersAccount(co, no) { const it = itemOf(no, co); if (!it) return ''; const s = ersSetupAcc(co, it.genProd); return s.override || (s.gsUsable ? s.gs : ''); }
const ersRemain = l => r4(num(l.qty) - num(l.issuedQty));
const ersTotal = d => r2(sum((d.lines || []).filter(l => !l.purchase), l => ersRemain(l) * num(l.estCost)) + sum(d.lines || [], 'issuedValue'));
const ersUser = id => DB.users.find(u => u.id === id) || { name: id || '—' };
const ersReqs = co => DB.docs.filter(d => d.type === 'MR' && (!co || d.company === co));
function ersHist(d, action, remarks) { (d.history = d.history || []).push({ at: new Date().toISOString(), by: curUser().name, action, remarks: remarks || '' }); }
const ersPct = () => ({ warn: num(DB.settings.ersWarnPct) || 80, crit: num(DB.settings.ersCriticalPct) || 95 });

/* Budget per expense account: allocated (Budgets), actual (G/L), committed (open requests not yet issued) */
function ersBudget(co, account, year, excludeId) {
  const allocated = r2(sum(DB.budgets.filter(b => b.company === co && String(b.year) === String(year) && b.account === account), 'amount'));
  const actual = r2(sum(DB.gl.filter(g => g.company === co && g.account === account && g.date.slice(0, 4) === String(year)), g => g.debit - g.credit));
  let committed = 0;
  for (const d of ersReqs(co)) if (d.id !== excludeId && ERS_OPEN.includes(d.status) && (d.date || '').slice(0, 4) === String(year))
    for (const l of d.lines) if (!l.purchase && (l.account || ersAccount(co, l.item)) === account) committed += ersRemain(l) * num(l.estCost);
  // purchase requests made by employees, until Supply Chain orders them
  for (const d of DB.docs) if (d.type === 'PR' && d.ersOrigin && d.company === co && d.id !== excludeId && ['Pending Approval', 'Approved'].includes(d.status) && (d.date || '').slice(0, 4) === String(year))
    for (const l of d.lines) if (l.budgetAcc === account) committed += num(l.qty) * num(l.unitCost);
  committed = r2(committed);
  const remaining = r2(allocated - actual - committed), used = allocated ? (actual + committed) / allocated * 100 : 0, p = ersPct();
  const health = !allocated ? 'No Budget' : remaining < 0 ? 'Over Budget' : used >= p.crit ? 'Critical' : used >= p.warn ? 'Near Limit' : 'Within Budget';
  return { account, allocated, actual, committed, remaining, used, health };
}
function ersImpact(d) {
  const by = {};
  for (const l of d.lines || []) if (!l.purchase) { const a = l.account || ersAccount(d.company, l.item) || '(no account)'; by[a] = (by[a] || 0) + ersRemain(l) * num(l.estCost); }
  const yr = (d.date || today()).slice(0, 4);
  return Object.entries(by).map(([a, amt]) => { const b = ersBudget(d.company, a, yr, d.id); return { ...b, request: r2(amt), after: r2(b.remaining - amt), over: b.allocated > 0 && b.remaining - amt < 0 }; });
}

/* ---------- approvals: hierarchy, specific user, role; amount ranges (decision 7) ---------- */
function resolveApprover(r, obj) {
  const t = r.approverType || 'Role';
  const reqUser = DB.users.find(u => u.id === (obj.requestedBy || obj.createdBy || obj.submittedBy)) || {};
  const step = (u, label) => ({ role: label, userId: u.id, status: 'Pending' });
  if (t === 'Specific user') { const u = DB.users.find(x => x.id === r.userId); if (u) return step(u, u.name); }
  if (t === 'Immediate superior') { const u = DB.users.find(x => x.id === reqUser.reportsTo); if (u) return step(u, `${u.name} (immediate superior)`); }
  if (t === 'Department head') {
    const dept = obj.dept || reqUser.department;
    const u = DB.users.find(x => x.id !== reqUser.id && (x.roles || []).includes('Department Head') && x.department && x.department === dept);
    if (u) return step(u, `${u.name} (head of ${dept})`);
  }
  return { role: r.role || 'Department Head', status: 'Pending' };
}
buildChain = function (ruleType, obj) {
  const ctx = approvalContext(obj);
  return DB.approvalRules.filter(r => r.docType === ruleType).sort((a, b) => a.seq - b.seq).filter(r => condMet(r, ctx)).map(r => resolveApprover(r, obj)).filter((s, i, a) => !s.userId || !a.slice(0, i).some(p => p.userId === s.userId));
};
const _condMet = condMet;
condMet = function (rule, ctx) { return rule.cond === 'amountLt' ? ctx.amount < num(rule.amount) : _condMet(rule, ctx); };
const _approvalContext = approvalContext;
approvalContext = function (d) {
  if (d.type !== 'MR') return _approvalContext(d);
  const imp = ersImpact(d);
  return { amount: ersTotal(d), ga: false, notGa: true, capex: false, intlTravel: false, within: !imp.some(x => x.over), accts: imp.map(x => x.account) };
};
canApprove = function (o) {
  const st = pendingStep(o); if (!st || o.createdBy === curUser().id) return false;
  return st.userId ? st.userId === curUser().id : hasRole(st.role);
};
whyCannotApprove = function (o) {
  const st = pendingStep(o); if (!st) return '';
  if (o.createdBy === curUser().id) return 'You created this record, so you cannot approve it (segregation of duties).';
  if (st.userId && st.userId !== curUser().id) return `Waiting for: ${st.role}. Switch to that user (top right) to approve.`;
  if (!st.userId && !hasRole(st.role)) return `Waiting for: ${st.role}. Switch to a user with this role (top right) to approve.`;
  return '';
};
const _docTotals = docTotals;
docTotals = function (d) { return d.type === 'MR' ? { total: ersTotal(d) } : _docTotals(d); };
const _docParty = docParty;
docParty = function (d) { return d.type === 'MR' ? `${ersUser(d.requestedBy || d.createdBy).name} · ${d.dept || ''}` : _docParty(d); };
const _routeDoc = ROUTES.doc;
ROUTES.doc = (type, id) => type === 'MR' ? ROUTES.ersreq(id) : _routeDoc(type, id);

/* Users and approval-rule setup fields */
MASTERS.users.fields.push({ k: 'department', l: 'Department (DEPT dimension)', t: 'select', get opts() { return [['', '']].concat(ersDepts(S.company)); } },
  { k: 'reportsTo', l: 'Reports to (immediate superior)', t: 'select', get opts() { return [['', '']].concat(DB.users.map(u => [u.id, `${u.name} (${u.id})`])); } });
MASTERS.users.cols.push({ l: 'Department', k: 'department' }, { l: 'Reports to', v: r => r.reportsTo ? ersUser(r.reportsTo).name : '' });
MASTERS.approvalRules.desc = 'Approval chains. Each step is approved by a role, by the requester\'s immediate superior or department head (hierarchy), or by a named user. Use the amount conditions for approval levels by amount (for example a 3rd level above ₱500,000). Steps run in sequence; a step is skipped when its condition does not apply.';
(() => {
  const f = MASTERS.approvalRules.fields, ri = f.findIndex(x => x.k === 'role');
  f[ri] = { ...f[ri], req: 0, l: 'Approver Role (for type Role, or fallback)' };
  f.splice(ri, 0, { k: 'approverType', l: 'Approver Type', t: 'select', opts: APPROVER_TYPES, noBlank: 1 },
    { k: 'userId', l: 'Specific User', t: 'select', get opts() { return [['', '']].concat(DB.users.map(u => [u.id, u.name])); } });
  const ai = f.findIndex(x => x.k === 'amount'); if (ai >= 0) f[ai] = { ...f[ai], l: 'Amount threshold (₱) for the amount conditions' };
  const c = MASTERS.approvalRules.cols, i = c.findIndex(x => x.k === 'role');
  c[i] = { l: 'Approver', v: r => { const t = r.approverType || 'Role'; return t === 'Role' ? r.role : t === 'Specific user' ? ersUser(r.userId).name : `${t}${r.role ? ' (else ' + r.role + ')' : ''}`; } };
  const ci = c.findIndex(x => x.l === 'Condition');
  c[ci] = { l: 'Condition', v: r => (APPROVAL_CONDITIONS.find(x => x[0] === r.cond) || [, r.cond])[1] + (['amountGte', 'amountLt'].includes(r.cond) ? ` (₱${money(r.amount)})` : '') };
})();

/* ---------- shared UI pieces ---------- */
const ICO_DOC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>';
const ICO_SEARCH = '<svg class="sico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';
function ersStock(co, no, loc) { const q = onHand(co, no, loc); return q; }
function ersStockHtml(q, need) { const cls = q <= 0 ? 'bad' : need && q < need ? 'warn' : ''; return `<b style="color:${cls === 'bad' ? 'var(--bad)' : cls === 'warn' ? 'var(--warn)' : 'var(--ok)'}">${qtyf(q)}</b>`; }
function ersWorkflow(d) {
  const ap = d.approvals || [];
  const steps = [{ t: 'Submitted', s: d.no && d.status !== 'Draft' ? `by ${ersUser(d.requestedBy || d.createdBy).name}` : 'Draft' , state: d.status === 'Draft' || d.status === 'Returned' ? 'now' : 'done' }];
  const buy = d.type === 'PR';
  const chain = ap.length ? ap : (d.status === 'Draft' || d.status === 'Returned') ? (() => { try { return buildChain(buy ? 'PR' : 'MR', d); } catch (e) { return []; } })() : [];
  chain.forEach(a => steps.push({ t: 'Approval', s: `${a.role}${a.status === 'Approved' ? ' · approved' : a.status === 'Rejected' ? ' · rejected' : ''}`, state: a.status === 'Approved' ? 'done' : a.status === 'Rejected' ? 'stop' : d.status === 'Pending Approval' && pendingStep(d) === a ? 'now' : '' }));
  if (buy) {
    const ordered = DB.docs.some(x => x.type === 'PQ' && x.prNo === d.no && x.company === d.company);
    steps.push({ t: 'Supply Chain', s: 'Canvass (quotes) and Purchase Order', state: d.status === 'Approved' ? (ordered ? 'done' : 'now') : '' });
    steps.push({ t: 'Delivered', s: 'Received by the warehouse or the requester', state: '' });
    if (['Rejected', 'Cancelled'].includes(d.status)) steps.push({ t: d.status, s: '', state: 'stop' });
    return `<div class="wf">${steps.map((x, i) => `<div class="wf-step ${x.state}"><span class="wf-dot">${x.state === 'done' ? '✓' : x.state === 'stop' ? '✕' : i + 1}</span><div><b>${esc(x.t)}</b><small>${esc(x.s)}</small></div></div>`).join('')}</div>`;
  }
  const after = ['Supply Chain Review', 'For Release', 'Partially Released', 'Released'];
  const at = after.indexOf(d.status);
  steps.push({ t: 'Supply Chain Review', s: 'Stock check; shortages go to purchasing', state: at === 0 ? 'now' : at > 0 ? 'done' : '' });
  steps.push({ t: 'For Release', s: 'Warehouse issues the items', state: at === 1 || at === 2 ? 'now' : at > 2 ? 'done' : '' });
  steps.push({ t: 'Completed', s: d.status === 'Released' ? 'Issued and posted' : 'Pending', state: d.status === 'Released' ? 'done' : '' });
  if (['Rejected', 'Cancelled'].includes(d.status)) steps.push({ t: d.status, s: '', state: 'stop' });
  return `<div class="wf">${steps.map((x, i) => `<div class="wf-step ${x.state}"><span class="wf-dot">${x.state === 'done' ? '✓' : x.state === 'stop' ? '✕' : i + 1}</span><div><b>${esc(x.t)}</b><small>${esc(x.s)}</small></div></div>`).join('')}</div>`;
}
function ersBudgetCard(d) {
  const imp = ersImpact(d); if (!imp.length) return `<div class="card"><h3>Budget Impact</h3><p class="muted small">Add items to see the effect on the department's expense budget.</p></div>`;
  const anyOver = imp.some(x => x.over), noBud = imp.every(x => !x.allocated), warn = imp.some(x => ['Near Limit', 'Critical'].includes(x.health));
  return `<div class="card"><h3>Budget Impact Summary</h3>${imp.map(x => `<div class="kvlist" style="margin-bottom:10px"><div><span class="muted">Expense account</span><b>${esc(x.account)}</b></div><div class="small muted" style="margin-top:-4px">${esc(accName(x.account, d.company))}</div>
    <div><span>Annual budget</span><b>${x.allocated ? '₱' + money(x.allocated) : '—'}</b></div><div><span>Actual (posted)</span><b>₱${money(x.actual)}</b></div><div><span>Committed (other open requests)</span><b>₱${money(x.committed)}</b></div>
    <div><span>This request</span><b style="color:var(--primary)">₱${money(x.request)}</b></div><div><span>Remaining after</span><b style="color:${x.over ? 'var(--bad)' : 'var(--ok)'}">${x.allocated ? '₱' + money(x.after) : '—'}</b></div></div>`).join('<hr style="border:0;border-top:1px solid var(--line);margin:8px 0">')}
    ${anyOver ? `<div class="alertbox bad"><span>⚠</span><div><b>Over budget</b>The approver will see this warning.</div></div>` : noBud ? `<div class="alertbox warn"><span>ℹ</span><div><b>No budget set</b>Set an annual budget for this account under Finance → Budgets.</div></div>` : warn ? `<div class="alertbox warn"><span>⚠</span><div><b>Near the limit</b>Above ${ersPct().warn}% of the annual budget.</div></div>` : `<div class="alertbox ok"><span>✓</span><div><b>Within budget</b>This request fits the remaining budget.</div></div>`}</div>`;
}
function ersSummaryCard(d) {
  const ls = d.lines || [];
  return `<div class="card"><h3>Request Summary</h3><div class="kvlist"><div><span>Total items</span><b>${ls.length}</b></div><div><span>Total quantity</span><b>${qtyf(sum(ls, 'qty'))}</b></div><div><span>Total estimated cost</span><b>₱${money(ersTotal(d))}</b></div></div></div>`;
}

/* ---------- New / edit request ---------- */
let ERQ = null;
/* One request screen for employees. kind 'stock' = Material Request (issued from the warehouse);
   kind 'purchase' = Purchase Requisition (items not in stock, non-stock items, services), which Supply Chain turns into quotes and a PO. */
function ersNewReq(kind = 'stock') {
  const u = curUser(), locs = refOptions('locations');
  return { id: '', type: kind === 'purchase' ? 'PR' : 'MR', kind, no: '', company: S.company, date: today(), status: 'Draft', createdBy: u.id, requestedBy: u.id, dept: u.department || '', priority: 'Normal',
    location: S.ersLoc && locs.some(l => l[0] === S.ersLoc) ? S.ersLoc : (locs[0] || [])[0] || '', equipment: '', neededBy: '', purpose: '', lines: [], approvals: [], history: [], dims: {} };
}
/* Budget account for a purchase line: stock items are expensed when issued (issuance account); others hit the Purch. Account */
function ersBuyAcc(co, no) {
  const it = itemOf(no, co); if (!it) return '';
  if (it.type === 'Inventory') return ersAccount(co, no);
  try { return gpAcc(co, 'DOMESTIC', it.genProd, 'purch', 'Purch. Account'); } catch (e) { return ''; }
}
function ersFromPR(pr) {
  const co = pr.company;
  return { ...ersNewReq('purchase'), id: pr.id, no: pr.no, status: pr.status, company: co, date: pr.date, location: pr.location || '', neededBy: pr.needDate || '', purpose: pr.purpose || '',
    dept: pr.dept || '', priority: pr.priority || 'Normal', equipment: pr.equipment || '', requestedBy: pr.requestedBy || pr.createdBy, createdBy: pr.createdBy, approvals: pr.approvals || [], history: pr.history || [],
    lines: (pr.lines || []).filter(l => l.type === 'Item').map(l => ({ item: l.no, description: l.description, uom: l.uom, category: (itemOf(l.no, co) || {}).category, qty: l.qty, estCost: num(l.unitCost), account: l.budgetAcc || ersBuyAcc(co, l.no), issuedQty: 0, issuedValue: 0, purchase: false })) };
}
function ersKind(kind) {
  if (ERQ.kind === kind) return;
  if (kind === 'stock') { const drop = ERQ.lines.filter(l => (itemOf(l.item, ERQ.company) || {}).type !== 'Inventory'); if (drop.length) toast(`Removed ${drop.length} non-stock item(s); they can only be purchased.`); ERQ.lines = ERQ.lines.filter(l => !drop.includes(l)); }
  ERQ.kind = kind; ERQ.type = kind === 'purchase' ? 'PR' : 'MR';
  for (const l of ERQ.lines) l.account = kind === 'purchase' ? ersBuyAcc(ERQ.company, l.item) : ersAccount(ERQ.company, l.item);
  render();
}
route('ersnew', (id, addItem) => {
  if (id && !['new', 'buy'].includes(id)) { const d = DB.docs.find(x => x.id === id); if (!d) return '<div class="card">Request not found.</div>'; ERQ = d.type === 'PR' ? ersFromPR(d) : { ...clone(d), kind: 'stock' }; }
  else if (!ERQ || ERQ.id || ERQ.company !== S.company) ERQ = ersNewReq(id === 'buy' ? 'purchase' : 'stock');
  if (addItem) ersAddLine(addItem, true);
  if (!['Draft', 'Returned'].includes(ERQ.status)) return `<div class="card">Request ${esc(ERQ.no)} is ${esc(ERQ.status)} and can no longer be edited. <a href="${ersLink(ERQ)}">Open it</a>.</div>`;
  AFTER = () => ersBindSearch();
  return ersEditorHtml();
});
function ersEditorHtml() {
  const d = ERQ, co = d.company, u = ersUser(d.requestedBy), buy = d.kind === 'purchase';
  const deptOpts = ersDepts(co), locOpts = refOptions('locations');
  const sub = d.status === 'Returned' ? '<b>Returned for changes.</b> Update the request and submit it again.'
    : buy ? 'Ask Supply Chain to buy items that are not in stock, non-stock items or services. Your approver, then Supply Chain (canvass and PO) act on it.'
      : 'Get items from the warehouse. Your approver, then Supply Chain, then the warehouse act on it.';
  return pageHead(d.id ? `Edit Request ${d.no || ''}` : 'New Request', sub) +
  (d.id ? '' : `<div class="card" style="padding:12px 16px"><div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap"><b>What do you need?</b><div class="segs" role="group" aria-label="Request type">
    <button class="${buy ? '' : 'on'}" onclick="ersKind('stock')">📦 Get from warehouse stock</button><button class="${buy ? 'on' : ''}" onclick="ersKind('purchase')">🛒 Purchase something</button></div>
    <span class="small muted">${buy ? 'Creates a Purchase Requisition.' : 'Creates a Material Request (MRF). If stock runs short, Supply Chain buys the rest for you.'}</span></div></div>`) +
  `<div class="ers-layout"><div>
    <div class="card"><div class="req-head"><span class="ico">${ICO_DOC}</span>
      <div class="kv"><span>Requestor</span><b>${esc(u.name)}</b></div>
      <div class="kv"><span>Company</span><b>${esc(companyName(co))}</b></div>
      <div class="kv"><span>Date Requested</span><b>${esc(d.date)}</b></div>
      <div class="kv"><span>Request No.</span><b>${d.no ? esc(d.no) : '<span class="muted" style="font-weight:400">(assigned when saved)</span>'}</b></div>
      <div class="kv"><span>Type</span><b>${buy ? 'Purchase Requisition' : 'Material Request'}</b></div></div>
      <div class="form-grid" style="margin-top:14px">
        <label class="fld"><span>Department <span class="req">*</span></span><select id="er_dept" onchange="ersHdr()">${optionsHtml(deptOpts, d.dept)}</select></label>
        <label class="fld"><span>${buy ? 'Deliver to (location)' : 'Issue from (warehouse location)'} <span class="req">*</span></span><select id="er_loc" onchange="ersHdr(true)">${optionsHtml(locOpts, d.location)}</select></label>
        <label class="fld">Charge to equipment / asset (optional)${pickHtml('er_eq', 'fixedAssets', d.equipment, 'onchange="ersHdr()"')}</label>
        <label class="fld">Needed by<input type="date" id="er_need" value="${esc(d.neededBy)}" onchange="ersHdr()"></label>
        <label class="fld">Priority<select id="er_pri" onchange="ersHdr()">${optionsHtml(['Normal', 'Urgent', 'Low'].map(x => [x, x]), d.priority, false)}</select></label>
      </div></div>
    <div class="card"><h3>1. Add Items to Request</h3>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><div class="ers-search">${ICO_SEARCH}<input class="search" style="max-width:none" id="er_q" placeholder="Search item by name, code or category…" autocomplete="off"><div class="sugg" id="er_sugg" hidden></div></div>
      <a class="btn outline" href="#/erscat">Browse catalog</a></div>
      <div class="small muted" style="margin:12px 0 6px;font-weight:600">Quick add from common items</div><div class="quickadd">${ersCommon(co, d.location, d.kind).map(no => `<button type="button" onclick="ersAddLine('${esc(no)}')">${ersThumb(no, co, 'sm')}<span>${esc((itemOf(no, co) || {}).description || no)}</span></button>`).join('') || '<span class="muted small">Common items appear here once requests are made.</span>'}</div></div>
    <div class="card"><h3>2. Requested Items</h3><div id="er_lines">${ersLinesHtml()}</div></div>
    <div class="card"><h3>3. Purpose / Justification <span class="req" style="color:var(--bad)">*</span></h3>
      <label class="fld"><textarea id="er_purpose" rows="3" maxlength="500" placeholder="Enter the purpose or justification for this request…" oninput="ERQ.purpose=this.value">${esc(d.purpose)}</textarea></label>
      <div style="display:flex;justify-content:space-between;gap:10px;margin-top:14px;flex-wrap:wrap"><div class="actions"><button class="btn outline" onclick="ersSave(false)">Save as Draft</button>${d.id ? `<button class="btn danger ghost" onclick="ersCancelReq('${d.id}')">${d.no && d.status !== 'Draft' ? 'Cancel request' : 'Delete draft'}</button>` : ''}</div>
      <button class="btn primary" onclick="ersSave(true)">Submit Request</button></div></div>
  </div><div class="ers-side" id="er_side">${ersSideHtml()}</div></div>`;
}
const ersSideHtml = () => ersBudgetCard(ERQ) + ersSummaryCard(ERQ) + `<div class="card"><h3>Workflow</h3>${ersWorkflow(ERQ)}</div>`;
function ersLinesHtml() {
  const d = ERQ, co = d.company;
  if (!d.lines.length) return '<p class="muted" style="margin:0">No items yet. Search above or use quick add.</p>';
  return `<div class="tbl-wrap"><table class="grid"><thead><tr><th>#</th><th>Item</th><th class="num">Available</th><th>Qty</th><th>Unit</th><th class="num">Est. Unit Cost</th><th class="num">Total</th><th></th></tr></thead><tbody>
  ${d.lines.map((l, i) => { const q = ersStock(co, l.item, d.location); return `<tr><td>${i + 1}</td><td><div class="item-cell">${ersThumb(l.item, co)}<div class="t"><b>${esc(l.description)}</b><span class="small muted">${esc(l.item)} · ${esc(ersCatName(l.category, co))}</span></div></div></td>
    <td class="num">${(itemOf(l.item, co) || {}).type === 'Inventory' ? `${ersStockHtml(q, num(l.qty))} <span class="small muted">${esc(l.uom)}</span>` : '<span class="small muted">non-stock</span>'}</td>
    <td><span class="stepper"><button type="button" aria-label="Less" onclick="ersQty(${i},-1)">−</button><input value="${qtyf(l.qty)}" aria-label="Quantity" onchange="ersQty(${i},0,this.value)"><button type="button" aria-label="More" onclick="ersQty(${i},1)">+</button></span></td>
    <td>${esc(l.uom)}</td><td class="num">${money(l.estCost)}</td><td class="num"><b>${money(num(l.qty) * num(l.estCost))}</b></td><td><button class="x" title="Remove" onclick="ersDel(${i})">🗑</button></td></tr>`; }).join('')}
  </tbody></table></div><div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px"><button class="btn danger ghost sm" onclick="ERQ.lines=[];ersRefresh()">Clear all items</button><div>Grand total <b style="font-size:20px;color:var(--primary);margin-left:10px">₱${money(ersTotal(d))}</b></div></div>`;
}
function ersRefresh() { const l = $('#er_lines'); if (l) l.innerHTML = ersLinesHtml(); const s = $('#er_side'); if (s) s.innerHTML = ersSideHtml(); }
function ersHdr(locChanged) {
  ERQ.dept = $('#er_dept').value; ERQ.location = $('#er_loc').value; ERQ.equipment = $('#er_eq').value.trim(); ERQ.neededBy = $('#er_need').value; ERQ.priority = $('#er_pri').value;
  S.ersLoc = ERQ.location; if (locChanged) ersRefresh(); else { const s = $('#er_side'); if (s) s.innerHTML = ersSideHtml(); }
}
function ersAddLine(no, silent) {
  const co = ERQ.company, it = itemOf(no, co), buy = ERQ.kind === 'purchase'; if (!it) return toast(`Item ${no} not found.`, 'err');
  if (!buy && it.type !== 'Inventory') return toast(`${it.description} is not kept in the warehouse. Choose "Purchase something" at the top to request it.`, 'err');
  const ex = ERQ.lines.find(l => l.item === no);
  if (ex) ex.qty = num(ex.qty) + 1;
  else ERQ.lines.push({ item: no, description: it.description, uom: it.uom, category: it.category, qty: 1, estCost: ersCost(co, no), account: buy ? ersBuyAcc(co, no) : ersAccount(co, no), issuedQty: 0, issuedValue: 0, purchase: false });
  if (!silent) { ersRefresh(); toast(`Added ${it.description}.`); }
}
function ersQty(i, step, val) { const l = ERQ.lines[i]; l.qty = Math.max(0, step ? num(l.qty) + step : num(val)); if (!l.qty) l.qty = 1; ersRefresh(); }
function ersDel(i) { ERQ.lines.splice(i, 1); ersRefresh(); }
function ersCommon(co, loc, kind) {
  const buy = kind === 'purchase', cnt = {};
  if (buy) { for (const d of DB.docs) if (d.type === 'PR' && d.company === co) for (const l of d.lines) if (l.type === 'Item') cnt[l.no] = (cnt[l.no] || 0) + 1; }
  else for (const d of ersReqs(co)) for (const l of d.lines) cnt[l.item] = (cnt[l.item] || 0) + 1;
  let list = Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  if (!buy && list.length < 6) { const have = new Set(DB.itemLedger.filter(e => e.company === co && (!loc || e.location === loc)).map(e => e.item)); list = list.concat([...have].filter(x => !list.includes(x))); }
  return list.filter(no => { const it = itemOf(no, co); return it && (buy || it.type === 'Inventory'); }).slice(0, 8);
}
function ersSearch(co, q, loc, limit = 30, kind = 'stock') {
  const t = q.trim().toLowerCase(); if (t.length < 2) return [];
  const words = t.split(/\s+/), buy = kind === 'purchase';
  return M(co).items.filter(i => (buy || i.type === 'Inventory') && !i.blocked && STATUS_USABLE(i) && words.every(w => `${i.no} ${i.description} ${i.category} ${ersCatName(i.category, co)}`.toLowerCase().includes(w))).slice(0, limit);
}
function ersBindSearch() {
  const inp = $('#er_q'), box = $('#er_sugg'); if (!inp) return;
  const show = () => {
    const buy = ERQ.kind === 'purchase', res = ersSearch(ERQ.company, inp.value, ERQ.location, 30, ERQ.kind);
    box.hidden = !inp.value.trim();
    box.innerHTML = res.length ? res.map(i => `<button type="button" data-no="${esc(i.no)}">${ersThumb(i.no, ERQ.company, 'sm')}<span><b>${esc(i.description)}</b><small>${esc(i.no)} · ${esc(ersCatName(i.category, ERQ.company))} · ₱${money(ersCost(ERQ.company, i.no))} / ${esc(i.uom)} · ${i.type === 'Inventory' ? `${qtyf(ersStock(ERQ.company, i.no, ERQ.location))} in stock` : esc(i.type)}</small></span></button>`).join('')
      : `<div style="padding:12px" class="muted small">${inp.value.trim().length < 2 ? 'Type at least 2 letters.' : buy ? 'No item matches. If it is not in the item list yet, ask Supply Chain to create the item first.' : 'No stock item matches. Not kept in the warehouse? Choose "Purchase something" at the top.'}</div>`;
  };
  inp.addEventListener('input', show);
  inp.addEventListener('keydown', e => { if (e.key === 'Escape') box.hidden = true; if (e.key === 'Enter') { const b = box.querySelector('button'); if (b) b.click(); } });
  box.addEventListener('click', e => { const b = e.target.closest('button[data-no]'); if (b) { ersAddLine(b.dataset.no); inp.value = ''; box.hidden = true; inp.focus(); } });
  document.addEventListener('click', e => { if (!e.target.closest('.ers-search')) box.hidden = true; });
}
/** Purchase request → Purchase Requisition document (the one Supply Chain canvasses from) */
function ersSavePR(d, submit) {
  let pr = d.id ? DB.docs.find(x => x.id === d.id) : null;
  if (!pr) { pr = newDoc('PR'); pr.id = uid(); pr.no = nextNo('PR', d.company); pr.createdBy = curUser().id; pr.createdAt = new Date().toISOString(); pr.history = []; DB.docs.push(pr); ersHist(pr, 'Draft saved'); }
  Object.assign(pr, { company: d.company, date: today(), location: d.location, needDate: d.neededBy, purpose: d.purpose, dims: clone(d.dims), requestedBy: d.requestedBy, dept: d.dept,
    priority: d.priority, equipment: d.equipment, ersOrigin: true });
  pr.lines = d.lines.map(l => { const x = { type: 'Item', no: l.item, qty: num(l.qty), location: d.location }; lineDefaults(pr, x); x.unitCost = num(l.estCost) || num(x.unitCost); x.budgetAcc = ersBuyAcc(d.company, l.item); return x; });
  if (submit) {
    const back = ['Rejected', 'Returned'].includes(pr.status);
    pr.status = 'Draft'; validateDoc(pr); submitForApproval(pr, 'PR');
    ersHist(pr, back ? 'Resubmitted' : 'Submitted', `₱${money(sum(pr.lines, l => l.qty * l.unitCost))}`);
  } else pr.status = 'Draft';
  return pr;
}
const ersLink = d => d.type === 'MR' ? `#/ersreq/${d.id}` : ['Draft', 'Returned'].includes(d.status) && d.ersOrigin ? `#/ersnew/${d.id}` : `#/doc/PR/${d.id}`;
async function ersSave(submit) {
  const wasNew = !ERQ.id, buy = ERQ.kind === 'purchase';
  const ok = await commit(() => {
    const d = ERQ;
    d.purpose = ($('#er_purpose') || {}).value ?? d.purpose;
    d.lines = d.lines.filter(l => num(l.qty) > 0);
    const dim = ersDeptDim(d.company); d.dims = dim && d.dept ? { [dim]: d.dept } : {};
    if (submit) {
      if (!d.lines.length) fail('Add at least one item.');
      if (!d.dept) fail('Select the department.');
      if (!d.location) fail(buy ? 'Select the delivery location.' : 'Select the warehouse location to issue from.');
      if (!String(d.purpose || '').trim()) fail('Enter the purpose / justification.');
      if (d.equipment && !faOf(d.equipment, d.company)) fail(`Equipment / asset ${d.equipment} does not exist.`);
    }
    if (buy) { const pr = ersSavePR(d, submit); ERQ = ersFromPR(pr); return; }
    for (const l of d.lines) { l.estCost = ersCost(d.company, l.item) || num(l.estCost); l.account = ersAccount(d.company, l.item); }
    let i = d.id ? DB.docs.findIndex(x => x.id === d.id) : -1;
    if (i < 0) { d.id = uid(); d.no = nextNo('MRF', d.company); DB.docs.push(clone(d)); i = DB.docs.length - 1; ersHist(DB.docs[i], 'Draft saved'); }
    const doc = DB.docs[i]; Object.assign(doc, clone({ ...d, history: doc.history, approvals: doc.approvals }));
    if (submit) {
      const back = doc.status === 'Returned';
      doc.status = 'Draft'; doc.date = today(); submitForApproval(doc, 'MR');
      if (doc.status === 'Approved') doc.status = 'Supply Chain Review';
      ersHist(doc, back ? 'Resubmitted' : 'Submitted', `₱${money(ersTotal(doc))}`);
    } else if (doc.status !== 'Returned') doc.status = 'Draft';
    ERQ = clone(doc);
  }, `${submit ? 'Submitted' : 'Saved draft of'} ${buy ? 'purchase requisition' : 'material request'}`, ERQ.no);
  if (ok === false) { if (wasNew) { ERQ.id = ''; ERQ.no = ''; } return; }
  if (submit) {
    const doc = DB.docs.find(x => x.id === ERQ.id), st = pendingStep(doc);
    toast(`${doc.no} submitted. ${st ? 'Waiting for ' + st.role + '.' : buy ? 'Sent to Supply Chain.' : 'Sent to Supply Chain review.'}`); ERQ = null; go(ersLink(doc));
  } else { toast(`Draft ${ERQ.no} saved.`); go(`#/ersnew/${ERQ.id}`); }
}
async function ersCancelReq(id) {
  const d = DB.docs.find(x => x.id === id);
  if (d && d.status === 'Draft') { const ok = await commit(() => { DB.docs = DB.docs.filter(x => x.id !== id); }, 'Deleted material request draft', d.no); if (ok !== false) { ERQ = null; toast('Draft deleted.'); go('#/ersmy'); } return; }
  ersAsk('Cancel request', 'Reason for cancelling', r => ersAct(id, 'cancel', r), true);
}

/* ---------- request view and stage actions ---------- */
route('ersreq', id => {
  const d = DB.docs.find(x => x.id === id && x.type === 'MR'); if (!d) return '<div class="card">Request not found.</div>';
  const co = d.company, u = ersUser(d.requestedBy || d.createdBy);
  const sc = d.status === 'Supply Chain Review' && ersIsSC(), rel = ['For Release', 'Partially Released'].includes(d.status) && ersIsWH();
  const mine = d.createdBy === curUser().id || d.requestedBy === curUser().id;
  const acts = [];
  if (canApprove(d)) acts.push(`<button class="btn primary" onclick="ersAct('${id}','approve')">Approve</button>`, `<button class="btn outline" onclick="ersAsk('Request changes','What should the requester change?',r=>ersAct('${id}','return',r),true)">Request changes</button>`, `<button class="btn danger ghost" onclick="ersAsk('Reject request','Reason for rejecting',r=>ersAct('${id}','reject',r),true)">Reject</button>`);
  if (sc) acts.push(`<button class="btn" onclick="ersMakePR('${id}')">Create Purchase Requisition for shortages</button>`, `<button class="btn primary" onclick="ersAct('${id}','review')">Complete review → For Release</button>`, `<button class="btn outline" onclick="ersAsk('Request changes','What should the requester change?',r=>ersAct('${id}','return',r),true)">Return to requester</button>`);
  if (rel) acts.push(`<button class="btn primary" onclick="ersRelease('${id}')">Release items and post issue</button>`);
  if (mine && ['Draft', 'Returned'].includes(d.status)) acts.push(`<a class="btn primary" href="#/ersnew/${id}">Edit and submit</a>`);
  if (mine && ['Pending Approval', 'Supply Chain Review', 'For Release', 'Draft', 'Returned'].includes(d.status) && !sum(d.lines, 'issuedQty')) acts.push(`<button class="btn danger ghost" onclick="ersCancelReq('${id}')">${d.status === 'Draft' ? 'Delete draft' : 'Cancel request'}</button>`);
  acts.push(`<button class="btn ghost" onclick="ersDuplicate('${id}')">Duplicate</button>`);
  const glRows = DB.gl.filter(g => g.docType === 'MR' && g.docNo === d.no && g.company === co);
  return pageHead(`Material Request ${d.no}`, `${badge(d.status)} &nbsp;${esc(d.priority || 'Normal')} priority · ${esc(companyName(co))}`, '<a class="btn ghost" href="#/ersmy">← My Requests</a>') +
  `<div class="ers-layout"><div>
    <div class="card"><div class="req-head"><span class="ico">${ICO_DOC}</span>
      <div class="kv"><span>Requestor</span><b>${esc(u.name)}</b></div><div class="kv"><span>Department</span><b>${esc(d.dept)}</b></div>
      <div class="kv"><span>Date Requested</span><b>${esc(d.date)}</b></div><div class="kv"><span>Issue from</span><b>${esc(d.location)}</b></div>
      ${d.equipment ? `<div class="kv"><span>Equipment</span><b>${esc(d.equipment)}</b><span>${esc((faOf(d.equipment, co) || {}).description || '')}</span></div>` : ''}
      ${d.neededBy ? `<div class="kv"><span>Needed by</span><b>${esc(d.neededBy)}</b></div>` : ''}</div>
      <p style="margin:14px 0 0"><span class="muted small">Purpose</span><br>${esc(d.purpose)}</p>
      ${(d.prNos || []).length ? `<p class="small" style="margin:10px 0 0">Purchase Requisitions for shortages: ${d.prNos.map(p => { const pr = DB.docs.find(x => x.type === 'PR' && x.no === p && x.company === co); return pr ? `<a href="#/doc/PR/${pr.id}">${esc(p)}</a>` : esc(p); }).join(', ')}</p>` : ''}</div>
    <div class="card"><div class="lines-head"><h3 style="margin:0">Items</h3>${sc ? '<span class="small muted">Adjust approved quantities, or tick "Buy" for items to purchase instead.</span>' : rel ? '<span class="small muted">Enter the quantity handed over now.</span>' : ''}</div>
    <div class="tbl-wrap"><table class="grid"><thead><tr><th>#</th><th>Item</th><th class="num">In stock</th><th class="num">Requested</th><th class="num">Issued</th>${sc ? '<th>Approved qty</th><th>Buy</th>' : ''}${rel ? '<th>Release now</th>' : ''}<th class="num">Est. Cost</th><th class="num">Total</th></tr></thead><tbody>
    ${d.lines.map((l, i) => { const q = ersStock(co, l.item, d.location), rem = ersRemain(l); return `<tr><td>${i + 1}</td><td><div class="item-cell">${ersThumb(l.item, co, 'sm')}<div class="t"><b>${esc(l.description)}</b><span class="small muted">${esc(l.item)} · ${esc(l.uom)}${l.purchase ? ' · <span class="badge s-ordered">To purchase</span>' : ''}</span></div></div></td>
      <td class="num">${ersStockHtml(q, rem)}</td><td class="num">${qtyf(l.qty)}</td><td class="num">${qtyf(l.issuedQty)}</td>
      ${sc ? `<td><input class="num" style="width:90px;padding:5px 8px;border:1px solid #d5dce8;border-radius:8px" id="sq_${i}" value="${qtyf(l.qty)}"></td><td><input type="checkbox" id="sb_${i}" ${l.purchase ? 'checked' : ''} aria-label="Buy instead"></td>` : ''}
      ${rel ? `<td>${l.purchase || rem <= 0 ? '<span class="muted small">—</span>' : `<input class="num" style="width:90px;padding:5px 8px;border:1px solid #d5dce8;border-radius:8px" id="rq_${i}" value="${qtyf(Math.max(0, Math.min(rem, q)))}">`}</td>` : ''}
      <td class="num">${money(l.issuedQty && l.issuedValue ? l.issuedValue / l.issuedQty : l.estCost)}</td><td class="num">${money(num(l.issuedValue) + (l.purchase ? 0 : rem * num(l.estCost)))}</td></tr>`; }).join('')}
    </tbody><tfoot><tr><td colspan="${5 + (sc ? 2 : 0) + (rel ? 1 : 0) + 1}">Total</td><td class="num">₱${money(ersTotal(d))}</td></tr></tfoot></table></div>
    ${rel ? `<div class="form-grid" style="margin-top:12px;max-width:520px"><label class="fld">Posting date<input type="date" id="rl_date" value="${today()}"></label><label class="fld">Received by<input id="rl_by" placeholder="Name of the person receiving the items"></label></div>` : ''}
    <div class="actions" style="margin-top:14px">${acts.join('')}</div></div>
    ${(d.releases || []).length ? `<div class="card"><h3>Releases (Material Issuance)</h3><div class="tbl-wrap"><table class="grid compact"><thead><tr><th>Date</th><th>Released by</th><th>Received by</th><th>Items</th><th class="num">Cost</th></tr></thead><tbody>${d.releases.map(r => `<tr><td>${esc(r.date)}</td><td>${esc(r.by)}</td><td>${esc(r.receivedBy || '')}</td><td class="small">${r.lines.map(x => `${esc(x.item)} × ${qtyf(x.qty)}`).join(', ')}</td><td class="num">${money(r.value)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
    ${glRows.length ? `<div class="card"><h3>G/L Entries posted</h3><div class="tbl-wrap"><table class="grid compact"><thead><tr><th>Date</th><th>Account</th><th>Name</th><th>Dimensions</th><th>Equipment</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead><tbody>${glRows.map(g => `<tr><td>${esc(g.date)}</td><td>${esc(g.account)}</td><td>${esc(accName(g.account, co))}</td><td class="small">${esc(dimText(g.dims))}</td><td>${esc(g.asset || '')}</td><td class="num">${g.debit ? money(g.debit) : ''}</td><td class="num">${g.credit ? money(g.credit) : ''}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
  </div><div class="ers-side">
    <div class="card"><h3>Workflow</h3>${ersWorkflow(d)}${d.status === 'Pending Approval' && !canApprove(d) ? `<p class="muted small" style="margin:0">${esc(whyCannotApprove(d))}</p>` : ''}</div>
    ${['Pending Approval', 'Supply Chain Review'].includes(d.status) ? ersBudgetCard(d) : ''}
    <div class="card"><h3>History</h3><div class="kvlist">${(d.history || []).slice().reverse().map(h => `<div style="display:block"><b>${esc(h.action)}</b> <span class="muted small">· ${esc(h.by)} · ${esc(h.at.slice(0, 16).replace('T', ' '))}</span>${h.remarks ? `<div class="small muted">${esc(h.remarks)}</div>` : ''}</div>`).join('') || '<span class="muted small">No history.</span>'}</div></div>
  </div></div>`;
});
function ersAsk(title, label, fn, required) {
  modal(title, `<label class="fld">${esc(label)}${required ? ' <span class="req">*</span>' : ''}<textarea id="ask_txt" rows="3"></textarea></label>`, async () => {
    const v = $('#ask_txt').value.trim(); if (required && !v) { toast('Please enter a reason.', 'err'); return false; } await fn(v);
  }, 'Confirm');
}
async function ersAct(id, action, remarks) {
  const labels = { approve: 'Approved', reject: 'Rejected', return: 'Returned for changes', review: 'Supply Chain review completed', cancel: 'Cancelled' };
  const ok = await commit(() => {
    const d = DB.docs.find(x => x.id === id); if (!d) fail('Request not found.');
    if (action === 'approve') { approveStep(d, remarks); if (d.status === 'Approved' && d.type === 'MR') d.status = 'Supply Chain Review'; }
    else if (action === 'reject') { if (d.status === 'Pending Approval') rejectStep(d, remarks); else if (ersIsSC() && d.status === 'Supply Chain Review') d.status = 'Rejected'; else fail('You cannot reject this request at its current stage.'); }
    else if (action === 'return') {
      if (d.status === 'Pending Approval') { if (!canApprove(d)) fail(whyCannotApprove(d)); }
      else if (!(d.status === 'Supply Chain Review' && ersIsSC())) fail('You cannot return this request at its current stage.');
      d.status = 'Returned'; d.approvals = [];
    } else if (action === 'review') {
      if (!(d.status === 'Supply Chain Review' && ersIsSC())) fail('Only Supply Chain can complete the review.');
      d.lines.forEach((l, i) => { const q = $('#sq_' + i), b = $('#sb_' + i); if (q) l.qty = Math.max(num(l.issuedQty), num(q.value)); if (b) l.purchase = b.checked; });
      if (!d.lines.some(l => !l.purchase && ersRemain(l) > 0)) fail('Nothing is left to release. Untick "Buy" or reject the request.');
      d.status = 'For Release';
    } else if (action === 'cancel') {
      if (sum(d.lines, 'issuedQty') > 0) fail('Items were already issued; the request cannot be cancelled.');
      d.status = 'Cancelled';
    }
    ersHist(d, labels[action], remarks);
  }, `Material request: ${labels[action]}`, (DB.docs.find(x => x.id === id) || {}).no);
  if (ok !== false) { toast(`${labels[action]}.`); render(); }
}
async function ersMakePR(id) {
  const d = DB.docs.find(x => x.id === id), co = d.company;
  d.lines.forEach((l, i) => { const q = $('#sq_' + i), b = $('#sb_' + i); if (q) l.qty = Math.max(num(l.issuedQty), num(q.value)); if (b) l.purchase = b.checked; });
  const need = d.lines.map(l => ({ l, short: l.purchase ? ersRemain(l) : r4(ersRemain(l) - Math.max(0, ersStock(co, l.item, d.location))) })).filter(x => x.short > 0);
  if (!need.length) return toast('Every item is in stock. Nothing to purchase.', 'err');
  let prId = '';
  const ok = await commit(() => {
    const pr = newDoc('PR'); Object.assign(pr, { company: co, location: d.location, needDate: d.neededBy || '', purpose: `For ${d.no} (${d.dept}): ${d.purpose}`, dims: clone(d.dims || {}), sourceMR: d.no });
    pr.lines = need.map(x => { const l = { type: 'Item', no: x.l.item, qty: x.short, location: d.location }; lineDefaults(pr, l); l.unitCost = x.l.estCost || l.unitCost; return l; });
    pr.id = uid(); pr.no = nextNo('PR', co); DB.docs.push(pr); prId = pr.id;
    const doc = DB.docs.find(x => x.id === id); doc.lines = d.lines; (doc.prNos = doc.prNos || []).push(pr.no);
    ersHist(doc, 'Purchase Requisition created', `${pr.no}: ${need.map(x => `${x.l.item} × ${qtyf(x.short)}`).join(', ')}`);
  }, 'Created Purchase Requisition from material request', d.no);
  if (ok !== false) { toast('Purchase Requisition created as a draft. Review and send it for approval.'); go(`#/doc/PR/${prId}`); }
}
/** Release: posts the issue. Item ledger at cost (FIFO/average as the engine does), Dr Inventory Adjmt. account with department + equipment, Cr Inventory. */
function postMRRelease(d, date, qtys, receivedBy) {
  const co = d.company, gl = [], rl = [];
  const tmp = { ...d, date, type: 'MR' };
  d.lines.forEach((l, i) => {
    const q = num(qtys[i]); if (!q) return;
    if (q < 0) fail('Release quantity cannot be negative.');
    if (l.purchase) fail(`${l.item} is marked to purchase; it cannot be released from stock.`);
    if (q > ersRemain(l) + 0.0001) fail(`${l.item}: release quantity ${qtyf(q)} is more than the ${qtyf(ersRemain(l))} still to issue.`);
    const it = itemOf(l.item, co); if (!it || it.type !== 'Inventory') fail(`Item ${l.item} is not an inventory item.`);
    const inv = invAccount(co, d.location, it.invPostGroup), adj = ersAccount(co, l.item);
    if (!adj) fail(`No issuance expense account for item group ${it.genProd} (${l.item}). Accounting must set it under Requisitions → Issuance Accounts.`);
    l.account = adj;
    const out = costOutPosted(co, l.item, q);
    postItem(tmp, l.item, d.location, -q, -out.value, -out.exp, 'Negative Adjmt.', '');
    gl.push({ account: adj, debit: out.value, asset: d.equipment || '', dims: d.dims, desc: `${d.no} issue ${l.item} ${it.description}` }, { account: inv, credit: out.value, desc: `${d.no} issue ${l.item}` });
    l.issuedQty = r4(num(l.issuedQty) + q); l.issuedValue = r2(num(l.issuedValue) + out.value);
    rl.push({ item: l.item, qty: q, value: out.value });
  });
  if (!rl.length) fail('Enter at least one quantity to release.');
  if (gl.some(x => x.debit || x.credit)) postGL(tmp, gl);
  (d.releases = d.releases || []).push({ date, by: curUser().name, receivedBy: receivedBy || '', lines: rl, value: r2(sum(rl, 'value')) });
  d.status = d.lines.some(l => !l.purchase && ersRemain(l) > 0.0001) ? 'Partially Released' : 'Released';
  return rl;
}
async function ersRelease(id) {
  const d0 = DB.docs.find(x => x.id === id);
  const qtys = d0.lines.map((l, i) => { const el = $('#rq_' + i); return el ? num(el.value) : 0; });
  const date = $('#rl_date').value || today(), by = $('#rl_by').value.trim();
  if (!by) return toast('Enter who received the items.', 'err');
  const ok = await commit(() => {
    if (!ersIsWH()) fail('Only the Warehouseman can release items.');
    const d = DB.docs.find(x => x.id === id); if (!['For Release', 'Partially Released'].includes(d.status)) fail('This request is not ready for release.');
    const rl = postMRRelease(d, date, qtys, by);
    ersHist(d, d.status === 'Released' ? 'Released' : 'Partially released', `${rl.map(x => `${x.item} × ${qtyf(x.qty)}`).join(', ')} · received by ${by}`);
  }, 'Released items (material issuance)', d0.no);
  if (ok !== false) { toast('Items released. Inventory and G/L are updated.'); render(); }
}
async function ersDuplicate(id) {
  const d = DB.docs.find(x => x.id === id); ERQ = ersNewReq();
  Object.assign(ERQ, { company: d.company, dept: d.dept, location: d.location, equipment: d.equipment, priority: d.priority, purpose: d.purpose,
    lines: d.lines.map(l => ({ item: l.item, description: l.description, uom: l.uom, category: l.category, qty: l.qty, estCost: ersCost(d.company, l.item), account: l.account, issuedQty: 0, issuedValue: 0, purchase: false })) });
  if (d.company !== S.company) { S.company = d.company; }
  toast('Copied into a new request. Review it and submit.'); go('#/ersnew/new');
}

/* ---------- lists ---------- */
/* Rows for both kinds: Material Requests (MR) and Purchase Requisitions (PR) */
const ersItems = d => d.type === 'PR' ? (d.lines || []).filter(l => l.type === 'Item').map(l => l.no) : (d.lines || []).map(l => l.item);
const ersAmt = d => d.type === 'PR' ? r2(sum(d.lines || [], l => num(l.qty) * num(l.unitCost))) : ersTotal(d);
const ersOrdered = d => DB.docs.some(x => x.type === 'PQ' && x.prNo === d.no && x.company === d.company);
function ersWaiting(d) {
  const st = pendingStep(d); if (st) return st.role;
  if (d.type === 'PR') return d.status === 'Approved' ? (ersOrdered(d) ? 'Supply Chain (quotes / PO)' : 'Supply Chain (to canvass)') : d.status === 'Draft' ? 'Requestor' : '';
  return d.status === 'Supply Chain Review' ? 'Supply Chain' : ['For Release', 'Partially Released'].includes(d.status) ? 'Warehouse' : d.status === 'Returned' ? 'Requestor' : '';
}
function ersTable(rows, empty) {
  if (!rows.length) return `<p class="muted" style="margin:0">${empty}</p>`;
  return `<div class="tbl-wrap"><table class="grid"><thead><tr><th>Request No.</th><th>Type</th><th>Date</th><th>Requestor</th><th>Department</th><th>Items</th><th>Purpose</th><th class="num">Est. Total</th><th>Status</th><th>Waiting for</th></tr></thead><tbody>
  ${rows.map(d => { const its = ersItems(d), link = ersLink(d); return `<tr class="link" onclick="go('${link}')"><td><a href="${link}">${esc(d.no)}</a></td><td class="small">${d.type === 'PR' ? '🛒 Purchase' : '📦 Stock'}</td><td>${esc(d.date)}</td><td>${esc(ersUser(d.requestedBy || d.createdBy).name)}</td><td>${esc(d.dept || '')}</td>
    <td><span style="display:inline-flex;gap:4px">${its.slice(0, 3).map(no => ersThumb(no, d.company, 'sm')).join('')}</span>${its.length > 3 ? ` <span class="small muted">+${its.length - 3}</span>` : ''}</td>
    <td class="small" style="max-width:260px">${esc(String(d.purpose || '').slice(0, 80))}</td><td class="num">${money(ersAmt(d))}</td><td>${badge(d.status)}</td>
    <td class="small">${esc(ersWaiting(d))}</td></tr>`; }).join('')}
  </tbody></table></div>`;
}
const ERS_F = { my: 'all', q: 'approve' };
route('ersmy', () => {
  const me = curUser().id;
  const all = DB.docs.filter(d => d.company === S.company && (d.type === 'MR' || (d.type === 'PR' && !d.sourceMR)) && (d.createdBy === me || d.requestedBy === me)).sort((a, b) => ((b.date + b.no) > (a.date + a.no) ? 1 : -1));
  const groups = { all: () => true, draft: d => ['Draft', 'Returned'].includes(d.status), open: d => ERS_OPEN.includes(d.status) || (d.type === 'PR' && d.status === 'Approved'), done: d => d.status === 'Released', closed: d => ['Rejected', 'Cancelled'].includes(d.status) };
  const lbl = { all: 'All', draft: 'Drafts & returned', open: 'In progress', done: 'Released', closed: 'Rejected / cancelled' };
  const rows = all.filter(groups[ERS_F.my]);
  return pageHead('My Requests', `Everything you requested in ${esc(companyName(S.company))}: items from the warehouse (📦) and purchases (🛒).`, '<a class="btn primary" href="#/ersnew/new">+ New Request</a>') +
    `<div class="card"><div class="tbl-tools"><div class="segs">${Object.keys(groups).map(k => `<button class="${ERS_F.my === k ? 'on' : ''}" onclick="ERS_F.my='${k}';render()">${lbl[k]} (${all.filter(groups[k]).length})</button>`).join('')}</div></div>${ersTable(rows, 'No requests here yet.')}</div>`;
});
function ersQueues(co) {
  const reqs = ersReqs(co), prs = DB.docs.filter(d => d.type === 'PR' && d.company === co);
  return { approve: reqs.concat(prs).filter(d => canApprove(d)), review: ersIsSC() ? reqs.filter(d => d.status === 'Supply Chain Review') : [],
    canvass: ersIsSC() ? prs.filter(d => d.status === 'Approved' && !ersOrdered(d)) : [], release: ersIsWH() ? reqs.filter(d => ['For Release', 'Partially Released'].includes(d.status)) : [] };
}
route('ersq', () => {
  const q = ersQueues(S.company), lbl = { approve: 'To approve', review: 'Supply Chain review', canvass: 'To canvass (purchases)', release: 'For release' };
  return pageHead('Requests to Process', `Requests waiting for <b>${esc(curUser().name)}</b>. Switch user (top right) to act as another role.`) +
    `<div class="card"><div class="tbl-tools"><div class="segs">${Object.keys(q).map(k => `<button class="${ERS_F.q === k ? 'on' : ''}" onclick="ERS_F.q='${k}';render()">${lbl[k]} (${q[k].length})</button>`).join('')}</div></div>${ersTable(q[ERS_F.q], 'Nothing is waiting for you here.')}</div>`;
});

/* ---------- dashboard ---------- */
route('ers', () => {
  const co = S.company, reqs = ersReqs(co), me = curUser().id, q = ersQueues(co), ym = today().slice(0, 7);
  const mine = reqs.filter(d => (d.createdBy === me || d.requestedBy === me) && ERS_OPEN.concat(['Draft', 'Returned']).includes(d.status));
  const issued = DB.gl.filter(g => g.company === co && g.docType === 'MR' && g.date.slice(0, 7) === ym);
  const byDept = {}; for (const d of reqs) for (const r of d.releases || []) if (r.date.slice(0, 7) === ym) byDept[d.dept] = (byDept[d.dept] || 0) + r.value;
  const deptRows = Object.entries(byDept).sort((a, b) => b[1] - a[1]); const mx = Math.max(1, ...deptRows.map(x => x[1]));
  return pageHead('Requisitions', `Material requests and issuance for <b>${esc(companyName(co))}</b>. This replaces the Excel MRF/MIF and the Warehouse Inventory Tracker.`, '<a class="btn primary" href="#/ersnew/new">+ New Request</a>') +
    `<div class="tiles"><a class="tile" href="#/ersmy"><span>My open requests</span><b>${mine.length}</b><small>drafts, returned and in progress</small></a>
    <a class="tile" href="#/ersq" onclick="ERS_F.q='approve'"><span>Waiting for my approval</span><b>${q.approve.length}</b><small>approve, return or reject</small></a>
    <a class="tile" href="#/ersq" onclick="ERS_F.q='review'"><span>Supply Chain review</span><b>${reqs.filter(d => d.status === 'Supply Chain Review').length}</b><small>stock check and shortages</small></a>
    <a class="tile" href="#/ersq" onclick="ERS_F.q='release'"><span>For release</span><b>${reqs.filter(d => ['For Release', 'Partially Released'].includes(d.status)).length}</b><small>warehouse to issue</small></a>
    <a class="tile" href="#/report/il"><span>Issued this month</span><b>₱${money(sum(issued, 'debit'))}</b><small>charged to departments</small></a></div>
    <div class="cols2"><div class="card"><h3>Recent requests</h3>${ersTable(reqs.slice().sort((a, b) => (b.no > a.no ? 1 : -1)).slice(0, 8), 'No requests yet. Start with + New Request.')}</div>
    <div class="card"><h3>Issued this month by department</h3>${deptRows.length ? deptRows.map(([k, v]) => `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:13px"><b>${esc(k)}</b><span>₱${money(v)}</span></div><div class="meter"><i style="width:${(v / mx * 100).toFixed(1)}%"></i></div></div>`).join('') : '<p class="muted">No issuance yet this month.</p>'}</div></div>`;
});

/* ---------- item catalog (icons + photos) ---------- */
const ERS_CAT = { q: '', cat: '', loc: '', stock: false, n: 60 };
route('erscat', () => {
  const co = S.company, locs = refOptions('locations'); if (!ERS_CAT.loc) ERS_CAT.loc = S.ersLoc || (locs[0] || [])[0] || '';
  const cats = [...new Set(M(co).items.filter(i => i.type === 'Inventory').map(i => i.category))].sort();
  const words = ERS_CAT.q.toLowerCase().split(/\s+/).filter(Boolean);
  let list = M(co).items.filter(i => i.type === 'Inventory' && (!ERS_CAT.cat || i.category === ERS_CAT.cat) && words.every(w => `${i.no} ${i.description}`.toLowerCase().includes(w)));
  if (ERS_CAT.stock) list = list.filter(i => ersStock(co, i.no, ERS_CAT.loc) > 0);
  const canPhoto = ersIsSC() || ersIsWH();
  AFTER = () => { const s = $('#ec_q'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } };
  return pageHead('Item Catalog', `${list.length.toLocaleString()} stock items in ${esc(MDS(co))} master data. Photos: ${Object.keys(DB.itemPhotos || {}).filter(k => k.startsWith(MDS(co) + '|')).length}.`, '<a class="btn primary" href="#/ersnew/new">+ New Request</a>') +
    `<div class="card"><div class="form-grid"><label class="fld w2">Search<input id="ec_q" value="${esc(ERS_CAT.q)}" placeholder="Name or item code" oninput="ERS_CAT.q=this.value;ERS_CAT.n=60;ersCatRedraw()"></label>
      <label class="fld">Category<select onchange="ERS_CAT.cat=this.value;ERS_CAT.n=60;render()">${optionsHtml(cats.map(c => [c, `${ersCat({ category: c })[0]} ${ersCatName(c, co)}`]), ERS_CAT.cat)}</select></label>
      <label class="fld">Stock at location<select onchange="ERS_CAT.loc=this.value;render()">${optionsHtml(locs, ERS_CAT.loc, false)}</select></label>
      <label class="fld chk"><input type="checkbox" ${ERS_CAT.stock ? 'checked' : ''} onchange="ERS_CAT.stock=this.checked;render()"> Only items in stock</label></div></div>
    <div id="ec_grid">${ersCatGrid(list, canPhoto)}</div>`;
});
let ERS_CAT_T = null;
function ersCatRedraw() { clearTimeout(ERS_CAT_T); ERS_CAT_T = setTimeout(() => { const y = $('#main').scrollTop; render(); $('#main').scrollTop = y; }, 250); }
function ersCatGrid(list, canPhoto) {
  const co = S.company;
  return `<div class="cat-grid">${list.slice(0, ERS_CAT.n).map(i => { const q = ersStock(co, i.no, ERS_CAT.loc), st = q <= 0 ? 'Out of Stock' : 'In Stock', has = (DB.itemPhotos || {})[ersPhotoKey(co, i.no)];
    return `<div class="cat-card"><div class="row" style="justify-content:flex-start;gap:12px">${ersThumb(i.no, co, 'lg')}<div style="min-width:0"><div class="nm">${esc(i.description)}</div><div class="code">${esc(i.no)}</div><div class="small muted">${esc(ersCatName(i.category, co))}</div></div></div>
      <div class="row"><span>${badge(st)}</span><span class="small"><b>${qtyf(q)}</b> ${esc(i.uom)}</span></div><div class="row"><span class="small muted">Est. cost</span><b>₱${money(ersCost(co, i.no))}</b></div>
      <div class="row"><button class="btn sm primary" onclick="ERQ=(ERQ&&!ERQ.id&&ERQ.company===S.company)?ERQ:ersNewReq();ersAddLine('${esc(i.no)}',true);toast('Added to your new request.');">+ Request</button>
      ${canPhoto ? `<span style="display:flex;gap:6px"><label class="btn sm ghost" style="cursor:pointer">${has ? 'Change photo' : 'Add photo'}<input type="file" accept="image/*" hidden onchange="ersPhoto('${esc(i.no)}',this)"></label>${has ? `<button class="btn sm danger ghost" onclick="ersPhoto('${esc(i.no)}',null)">Remove</button>` : ''}</span>` : ''}</div></div>`; }).join('')}</div>
    ${list.length > ERS_CAT.n ? `<div style="text-align:center;margin-top:14px"><button class="btn" onclick="ERS_CAT.n+=60;ersCatRedraw()">Show more (${(list.length - ERS_CAT.n).toLocaleString()} left)</button></div>` : list.length ? '' : '<div class="card muted">No items match.</div>'}`;
}
async function ersPhoto(no, inp) {
  const key = ersPhotoKey(S.company, no);
  if (!inp) { const ok = await commit(() => { delete DB.itemPhotos[key]; }, 'Removed item photo', no); if (ok !== false) { toast('Photo removed.'); render(); } return; }
  const f = inp.files && inp.files[0]; if (!f) return;
  const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
  const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('This file is not an image the browser can read.')); im.src = url; }).catch(e => { toast(e.message, 'err'); return null; });
  if (!img) return;
  const S2 = 240, c = document.createElement('canvas'), sc = Math.min(1, S2 / Math.max(img.width, img.height));
  c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const data = c.toDataURL('image/jpeg', 0.8);
  const ok = await commit(() => { DB.itemPhotos = DB.itemPhotos || {}; DB.itemPhotos[key] = data; }, 'Added item photo', no);
  if (ok !== false) { toast('Photo saved.'); render(); }
}

/* ---------- budget status ---------- */
route('ersbud', yearArg => {
  const co = S.company, yr = yearArg || today().slice(0, 4), p = ersPct();
  const accts = new Set(DB.budgets.filter(b => b.company === co && String(b.year) === yr).map(b => b.account));
  for (const d of ersReqs(co)) if ((d.date || '').slice(0, 4) === yr) for (const l of d.lines) if (l.account) accts.add(l.account);
  const rows = [...accts].sort().map(a => ersBudget(co, a, yr));
  return pageHead('Budget Status', `Expense budgets for <b>${esc(companyName(co))}</b>, ${yr}. Committed = open material requests not yet issued. Warning at ${p.warn}%, critical at ${p.crit}%.`,
    `<a class="btn" href="#/list/budgets">Set budgets</a>${isAdmin() ? `<button class="btn" onclick="ersThresholds()">Thresholds</button>` : ''}`) +
    `<div class="card">${rows.length ? `<div class="tbl-wrap"><table class="grid"><thead><tr><th>Account</th><th>Name</th><th class="num">Annual budget</th><th class="num">Actual</th><th class="num">Committed</th><th class="num">Remaining</th><th style="width:160px">Used</th><th>Status</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${esc(r.account)}</td><td>${esc(accName(r.account, co))}</td><td class="num">${money(r.allocated)}</td><td class="num">${money(r.actual)}</td><td class="num">${money(r.committed)}</td><td class="num" style="color:${r.remaining < 0 ? 'var(--bad)' : 'inherit'}">${r.allocated ? money(r.remaining) : '—'}</td>
      <td>${r.allocated ? `<div class="meter"><i class="${r.used >= p.crit ? 'bad' : r.used >= p.warn ? 'warn' : ''}" style="width:${Math.min(100, r.used).toFixed(1)}%"></i></div><span class="small muted">${r.used.toFixed(1)}%</span>` : ''}</td><td>${badge(r.health)}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted" style="margin:0">No budgets or requests for this year yet. Set annual budgets per expense account under Finance → Budgets.</p>'}</div>`;
});
function ersThresholds() {
  const p = ersPct();
  modal('Budget thresholds', `<div class="form-grid"><label class="fld">Warning at (% used)<input id="th_w" type="number" value="${p.warn}"></label><label class="fld">Critical at (% used)<input id="th_c" type="number" value="${p.crit}"></label></div>`, async () => {
    const ok = await commit(() => { DB.settings.ersWarnPct = num($('#th_w').value); DB.settings.ersCriticalPct = num($('#th_c').value); }, 'Changed budget thresholds');
    if (ok !== false) render();
  });
}

/* ---------- Issuance Accounts setup (expense account charged when items are issued) ---------- */
route('ersacc', () => {
  const co = S.company, m = M(co), set = MDS(co);
  const prods = [...new Set(m.items.filter(i => i.type === 'Inventory').map(i => i.genProd).filter(Boolean))].sort();
  const can = isAdmin() || hasRole('BU Accounting Manager') || hasRole('G/L Accountant') || hasRole('Accounting Manager - Shared Service');
  const rows = prods.map(p => { const s = ersSetupAcc(co, p), n = m.items.filter(i => i.type === 'Inventory' && i.genProd === p).length; const eff = s.override || (s.gsUsable ? s.gs : ''); return { p, s, n, eff }; });
  const missing = rows.filter(r => !r.eff).length;
  return pageHead('Issuance Accounts', `The expense account charged when items are issued from the warehouse, per item group (Gen. Prod. Posting Group), for the <b>${esc(set)}</b> master data. Department and equipment are added as dimensions. ${missing ? `<b style="color:var(--bad)">${missing} of ${rows.length} groups have no account yet</b>; requests for those items cannot be released.` : 'All groups have an account.'}`) +
    `<div class="hint">In your posting setup the Inventory Adjmt. Account is blank for most item groups, and for fuel it is the inventory account itself, so an issue would not reach any expense. Set the account here; it does not change the Inventory Posting Setup.</div>
    <div class="card"><div class="tbl-wrap"><table class="grid"><thead><tr><th>Item group</th><th class="num">Items</th><th>Inventory Adjmt. Account (posting setup)</th><th>Issuance expense account</th><th>Status</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><b>${esc(r.p)}</b><div class="small muted">${esc((m.genProd.find(g => g.code === r.p) || {}).description || '')}</div></td><td class="num">${r.n}</td>
      <td class="small">${r.s.gs ? `${esc(r.s.gs)} ${esc(accName(r.s.gs, co))}${r.s.gsUsable ? '' : ' <span class="badge s-lowstock">is an inventory account</span>'}` : '<span class="muted">blank</span>'}</td>
      <td>${can ? `<span style="display:block;min-width:260px">${pickHtml('', 'accounts', r.s.override, `data-p="${esc(r.p)}" onchange="ersSetIssueAcc(this)"`)}</span>` : esc(r.s.override || '')}</td>
      <td>${r.eff ? `<span class="badge s-active">OK</span> <span class="small muted">${esc(r.eff)} ${esc(accName(r.eff, co))}</span>` : '<span class="badge s-rejected">Missing</span>'}</td></tr>`).join('')}
    </tbody></table></div></div>`;
});
async function ersSetIssueAcc(el) {
  const v = el.value.trim(), p = el.dataset.p, co = S.company;
  if (v && !accOf(v, co)) return toast(`Account ${v} does not exist.`, 'err');
  const ok = await commit(() => { DB.issueAccounts = DB.issueAccounts || {}; const k = `${MDS(co)}|${U(p)}`; if (v) DB.issueAccounts[k] = v; else delete DB.issueAccounts[k]; }, `Issuance account for ${p}: ${v || '(cleared)'}`);
  if (ok !== false) { toast(`Saved: ${p} → ${v || 'cleared'}.`); render(); }
}
