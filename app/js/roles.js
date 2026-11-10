'use strict';
/* ============ Roles and permissions (backlog: "Roles and permissions editor") ============
   Each role has, per area of the ERP, the actions View / Create-Edit / Delete-Cancel / Approve / Post, and the
   companies it covers (all, or chosen ones). A user may hold several roles; the permissions add up. Menus, pages,
   buttons and actions follow the permissions of the user in "Acting as". Approval Rules still decide WHO approves a
   given document; a role-based approval step also needs the Approve tick for that area (a named person — immediate
   superior, department head, specific user — may always act on their own step). System Admin always has full access.
   The roles file (Excel, one sheet per department) can be imported: roles are created per position title from the
   modules, permission columns and business units ticked; people's names are not imported.
   Loaded after main.js so it can wrap the menu and top bar. */

const PERM_ACTS = [['view', 'View'], ['create', 'Create / Edit'], ['delete', 'Delete / Cancel'], ['approve', 'Approve / Reject'], ['post', 'Post']];
const PA = (k, g, l, acts, docs = [], hint = '') => ({ k, g, l, acts, docs, hint });
const PERM_AREAS = [
  PA('req', 'Requisitions', 'Requests (material and purchase requisitions)', 'VCDAP', ['MR', 'PR'], 'Post = release stock from the warehouse'),
  PA('rfq', 'Purchasing', 'RFQ and purchase quotes', 'VCDA', ['RFQ', 'PQ']),
  PA('po', 'Purchasing', 'Purchase orders', 'VCDA', ['PO']),
  PA('rcpt', 'Purchasing', 'Goods receipts', 'VP', ['RR'], 'Post = receive goods on a PO'),
  PA('asr', 'Purchasing', 'Service acceptance (ASR)', 'VCDA', ['ASR']),
  PA('pi', 'Purchasing', 'Purchase invoices and returns', 'VCDAP', ['PI', 'PRET']),
  PA('vendors', 'Purchasing', 'Vendors and accreditation', 'VCDA', ['VACC', 'VBANK']),
  PA('nospa', 'Sales', 'Sales contracts (NOSPA)', 'VCDA', ['NOSPA']),
  PA('so', 'Sales', 'Sales orders', 'VCDA', ['SO']),
  PA('si', 'Sales', 'Sales invoices and credit memos', 'VCDAP', ['SI', 'SCM']),
  PA('customers', 'Sales', 'Customers', 'VCDA'),
  PA('pay', 'Treasury', 'Payments (disbursements)', 'VCDAP', ['PAY']),
  PA('cr', 'Treasury', 'Collections (cash receipts)', 'VCDAP', ['CR']),
  PA('bank', 'Treasury', 'Banks: transfers, reconciliation, statements, cash position', 'VCDAP', ['FT', 'BREC'], 'Approve = review the daily cash position'),
  PA('items', 'Inventory', 'Items, locations and bins', 'VCDA'),
  PA('invjnl', 'Inventory', 'Transfers, item and physical inventory journals', 'VCDAP', ['TO', 'IJ', 'PC']),
  PA('whse', 'Warehouse', 'Warehouse receipts, put-aways, shipments, picks', 'VCDAP', ['WR', 'PA', 'WS', 'PK', 'RJ']),
  PA('ic', 'Intercompany', 'Intercompany inbox / outbox and consolidation', 'VCP'),
  PA('gj', 'Finance', 'General journals', 'VCDAP', ['GJ']),
  PA('coa', 'Finance', 'Chart of accounts, budgets, currencies', 'VCDAP', ['FXA']),
  PA('fa', 'Finance', 'Fixed assets and depreciation', 'VCDP', ['DEP', 'FAD']),
  PA('reports', 'Reports', 'Financial and management reports', 'V'),
  PA('setup', 'Setup', 'Posting setup, VAT / WHT, number series, other setup', 'VC'),
  PA('admin', 'Administration', 'Users, roles, approval rules, companies, data import', 'VCD')
];
const PERM_AREA = Object.fromEntries(PERM_AREAS.map(a => [a.k, a]));
const ACT_LETTER = { view: 'V', create: 'C', delete: 'D', approve: 'A', post: 'P' };
const DOC_AREA = Object.fromEntries(PERM_AREAS.flatMap(a => a.docs.map(t => [t, a.k])));
const MASTER_AREA = { vendors: 'vendors', vendDocReqs: 'vendors', customers: 'customers', items: 'items', locations: 'items', bins: 'items', itemCategories: 'items', itemCharges: 'items', uom: 'items',
  accounts: 'coa', budgets: 'coa', currencies: 'coa', fxRates: 'coa', bankAccounts: 'bank', faClasses: 'fa', faSubclasses: 'fa', faLocations: 'fa', faPostGroups: 'fa',
  companies: 'admin', users: 'admin', approvalRules: 'admin' };
const REPORT_AREA = { inv: 'invjnl', il: 'invjnl', bankled: 'bank', cashflow: 'bank', icrec: 'ic', consol: 'ic', audit: 'admin' };
const ROUTE_AREA = { ersnew: 'req', ersreq: 'req', ersmy: 'req', ersq: 'req', ers: 'req', erscat: 'req', ersbud: 'req', ersacc: 'setup', rfq: 'rfq', asr: 'asr', nospa: 'nospa', vendacc: 'vendors',
  bankimp: 'bank', cashpos: 'bank', applyent: 'bank', ic: 'ic', icpartners: 'ic', fxadjust: 'coa', fa: 'fa', facard: 'fa', bincontents: 'whse', bcimport: 'admin', mdcheck: 'admin', coverage: 'admin', roles: 'admin', settings: 'setup', bir: 'reports', apflow: 'admin', itemdesc: 'req', vpacc: 'vendors', vpinbox: 'vendors' };
// role names the program itself looks for: they cannot be renamed or deleted here
const BUILTIN_ROLES = ['System Admin', 'Department Head', 'Purchasing Assistant', 'Supply Chain Specialist', 'Supply Chain & Admin Head', 'Warehouseman', 'AP Accounting Associate', 'General Accounting Supervisor',
  'Commercial Manager', 'President', 'Accounting Manager - Shared Service', 'BU Accounting Manager', 'G/L Accountant', 'Treasury Supervisor', 'Treasury Assistant Manager', 'Billing / Sales Associate',
  'Supply Chain Manager', 'Supply Chain VP', 'CLG', 'CFO', 'Technical Head', 'Executive Assistant to the President', 'ICT Head'];

const areaOfDoc = t => DOC_AREA[t] || null;
function areaOfRoute(name, args) {
  if (name === 'doc' || name === 'docs') return areaOfDoc(args[0]);
  if (name === 'list' || name === 'card') return MASTER_AREA[args[0]] || 'setup';
  if (name === 'report') return REPORT_AREA[args[0]] || 'reports';
  return ROUTE_AREA[name] || null;
}
const permOn = () => !(DB.settings.perm && DB.settings.perm.enforce === false);
/** May the user do `act` in `area` (in the current company)? */
function can(area, act = 'view', user) {
  const u = user || curUser(); if (!u || !area || !permOn()) return true;
  const roles = u.roles || []; if (roles.includes('System Admin')) return true;
  const co = S.company;
  for (const r of roles) {
    const d = (DB.roleDefs || {})[r]; if (!d) continue;
    if (d.companies && d.companies.length && !d.companies.includes(co)) continue;
    const p = (d.perms || {})[area] || {};
    if (p[act] || (act === 'view' && PERM_ACTS.some(([k]) => p[k]))) return true;
  }
  return false;
}
const permMsg = (area, act) => `Your role does not allow "${(PERM_ACTS.find(a => a[0] === act) || [, act])[1]}" for ${(PERM_AREA[area] || {}).l || area}${S.company ? ` in ${S.company}` : ''}. Ask the System Administrator (Administration → Roles & Permissions).`;
function permCheck(area, act) { if (!can(area, act)) fail(permMsg(area, act)); }
function userCompanies(u) {
  u = u || curUser(); const all = DB.companies.map(c => c.code); if (!permOn() || (u.roles || []).includes('System Admin')) return all;
  const out = new Set();
  for (const r of u.roles || []) { const d = (DB.roleDefs || {})[r]; if (!d) continue; if (!d.companies || !d.companies.length) return all; d.companies.forEach(c => out.add(c)); }
  return out.size ? all.filter(c => out.has(c)) : all;
}

/* ---------- default roles (from your current roles; edit them in the editor) ---------- */
function permSeed() {
  const S2 = spec => Object.fromEntries(Object.entries(spec).map(([a, s]) => [a, Object.fromEntries(PERM_ACTS.map(([k]) => [k, s.includes(ACT_LETTER[k])]))]));
  const base = { req: 'VC' }, R = (spec, desc) => ({ perms: S2({ ...base, ...spec }), desc });
  return {
    'System Admin': R({}, 'Full access to everything (cannot be limited).'),
    'Requester': R({ req: 'VCD', asr: 'VC' }, 'Any employee: makes material and purchase requests; records services received.'),
    'Department Head': R({ req: 'VCDA', asr: 'VCA', po: 'V', reports: 'V' }, 'Approves requests and accepts services for the department.'),
    'Purchasing Assistant': R({ req: 'VC', rfq: 'VCD', po: 'VCD', rcpt: 'V', asr: 'V', pi: 'V', vendors: 'VC', items: 'V' }, 'Canvass, quotes and purchase orders.'),
    'Supply Chain Specialist': R({ req: 'VC', rfq: 'VCD', po: 'VCD', rcpt: 'V', asr: 'V', pi: 'V', vendors: 'VC', items: 'V', invjnl: 'V' }, 'Canvass, quotes, purchase orders, transfers.'),
    'Supply Chain & Admin Head': R({ req: 'VCA', rfq: 'VCDA', po: 'VCDA', rcpt: 'V', asr: 'VA', pi: 'V', vendors: 'VCDA', items: 'V', invjnl: 'V', reports: 'V' }, 'Heads Supply Chain; accredits vendors.'),
    'Supply Chain Manager': R({ req: 'VCA', rfq: 'VCA', po: 'VCA', rcpt: 'V', asr: 'VCA', pi: 'V', vendors: 'VCA', items: 'V', invjnl: 'V', reports: 'V' }, 'First PO approver; ASR exceptions.'),
    'Supply Chain VP': R({ req: 'V', rfq: 'VA', po: 'VA', asr: 'VA', vendors: 'VA', reports: 'V' }, 'Second PO approver.'),
    'CLG': R({ po: 'VA', reports: 'V' }, 'Executive approver (currently not in the PO approval rule).'),
    'Technical Head': R({ req: 'VC', rfq: 'VC', asr: 'V', items: 'V' }, 'Technical review of quotes.'),
    'Warehouseman': R({ req: 'VP', po: 'V', rcpt: 'VP', asr: 'V', items: 'V', invjnl: 'VC', whse: 'VCP' }, 'Receives and releases stock.'),
    'AP Accounting Associate': R({ po: 'V', rcpt: 'V', asr: 'V', pi: 'VCDP', pay: 'VC', vendors: 'V', reports: 'V' }, 'Enters and posts purchase invoices; prepares payments.'),
    'General Accounting Supervisor': R({ po: 'V', pi: 'VCAP', pay: 'V', gj: 'VC', vendors: 'VA', coa: 'V', reports: 'V' }, 'First invoice approver; checks bank-detail changes.'),
    'Accounting Manager - Shared Service': R({ pi: 'VCDAP', si: 'VCDAP', gj: 'VCAP', vendors: 'VCA', customers: 'VCA', items: 'VCA', coa: 'VCA', invjnl: 'VA', fa: 'VCP', setup: 'VC', reports: 'V', nospa: 'V', so: 'V' }, 'Approves invoices, credit memos and master data.'),
    'BU Accounting Manager': R({ pi: 'V', si: 'V', gj: 'VCDAP', invjnl: 'VCAP', whse: 'VA', coa: 'VC', fa: 'VCP', items: 'V', reports: 'V', setup: 'V' }, 'Approves journals and inventory adjustments.'),
    'G/L Accountant': R({ gj: 'VCP', coa: 'V', fa: 'VCP', reports: 'V' }, 'Journals and fixed assets.'),
    'Executive Assistant to the President': R({ rfq: 'VA', po: 'V', reports: 'V' }, 'Approves quote awards.'),
    'Special Assistant to the President': R({ rfq: 'V', po: 'V', reports: 'V' }, ''),
    'Commercial Manager': R({ rfq: 'VA', nospa: 'VC', so: 'VC', si: 'V', customers: 'V', reports: 'V' }, 'Sales contracts; quote awards outside budget.'),
    'President': R({ rfq: 'VA', po: 'V', pi: 'V', pay: 'VA', nospa: 'VA', so: 'V', si: 'V', bank: 'V', reports: 'V' }, 'Approves large payments and sales contracts.'),
    'CFO': R({ pi: 'VA', pay: 'VA', bank: 'VA', gj: 'V', coa: 'V', reports: 'V' }, 'Approves invoices of ₱500,000 and above; reviews cash.'),
    'Treasury Supervisor': R({ pay: 'VCAP', cr: 'VCP', bank: 'VCAP', vendors: 'V', customers: 'V', reports: 'V' }, 'Payments, collections, bank statements.'),
    'Treasury Assistant Manager': R({ pay: 'VCAP', cr: 'VCAP', bank: 'VCAP', vendors: 'VA', coa: 'VC', reports: 'V' }, 'Treasury Manager: approves payments, reviews cash position.'),
    'Billing / Sales Associate': R({ nospa: 'VC', so: 'VCD', si: 'VCD', customers: 'VC', cr: 'V', reports: 'V' }, 'Contracts, sales orders and invoices.'),
    'ICT Head': R({ admin: 'VCD', vendors: 'VA', customers: 'VA', items: 'VA', setup: 'VC' }, 'System administration; approves new master data.')
  };
}
/* every role-based step in Approval Rules gets Approve for its area, so nothing stops working */
function permGrantApprovers(defs) {
  const added = [];
  for (const r of DB.approvalRules || []) {
    if (r.approverType && r.approverType !== 'Role') continue;
    const area = areaOfDoc(r.docType) || (r.docType === 'MASTER' ? 'vendors' : null); if (!area) continue;
    const d = defs[r.role]; if (!d) continue;
    d.perms[area] = d.perms[area] || {}; if (!d.perms[area].approve) { d.perms[area].approve = true; added.push(`${r.role}: ${area}`); }
    if (r.docType === 'MASTER') for (const a of ['customers', 'items']) { d.perms[a] = d.perms[a] || {}; d.perms[a].approve = true; d.perms[a].view = true; }
  }
  return added;
}
function permSyncRoles() { const names = Object.keys(DB.roleDefs || {}); const rest = names.filter(n => n !== 'System Admin').sort((a, b) => a.localeCompare(b)); ROLES.splice(0, ROLES.length, 'System Admin', ...rest); }
function permMigrate() {
  let ch = false;
  if (!DB.roleDefs) {
    const seed = permSeed(); DB.roleDefs = {};
    for (const name of new Set([...ROLES, ...DB.users.flatMap(u => u.roles || [])])) DB.roleDefs[name] = { name, desc: '', companies: [], perms: {}, ...(seed[name] || { perms: permSeed().Requester.perms }) };
    permGrantApprovers(DB.roleDefs); ch = true;
  }
  if (!DB.settings.perm) { DB.settings.perm = { enforce: true }; ch = true; }
  permSyncRoles();
  return ch;
}

/* ---------- enforcement: routes, menu, company list, buttons, actions ---------- */
for (const [name, fn] of Object.entries(ROUTES)) {
  ROUTES[name] = (...args) => {
    const a = areaOfRoute(name, args);
    if (a && !can(a, 'view')) return permDenied(a, 'view');
    if (a && args[1] === 'new' && ['doc', 'card'].includes(name) && !can(a, 'create')) return permDenied(a, 'create');
    let html = fn(...args);
    if (name === 'list' && typeof html === 'string') html = html.replace(/<span class="muted small">Only [^<]*can edit<\/span>/, '<span class="muted small">View only (your role)</span>');
    if (name === 'docs' && a && !can(a, 'create') && typeof html === 'string') html = html.replace(/<a[^>]*href="#\/doc\/[A-Za-z]+\/new"[^>]*>[\s\S]*?<\/a>/g, '').replace(/<button[^>]*go\('#\/doc\/[A-Za-z]+\/new'\)[^>]*>[\s\S]*?<\/button>/g, '');
    return html;
  };
}
function permDenied(area, act) {
  return pageHead('No access', '') + `<div class="card"><div class="alertbox warn"><span>🔒</span><div><b>${esc(curUser().name)} cannot open this page</b>${esc(permMsg(area, act))}</div></div>
    <p class="small muted" style="margin:10px 0 0">Roles: ${esc((curUser().roles || []).join(', ') || 'none')}. You can switch user with <b>Acting as</b> at the top.</p></div>`;
}
const _renderNav_perm = renderNav;
renderNav = function () {
  _renderNav_perm();
  if (!DB || !DB.roleDefs) return;
  for (const a of $$('#nav a')) { const h = (a.getAttribute('href') || '').replace(/^#\/?/, ''), [n, ...args] = h.split('/').map(decodeURIComponent), ar = areaOfRoute(n, args); if (ar && !can(ar, 'view')) a.remove(); }
  for (const s of $$('#nav .nav-sub-wrap')) if (!s.querySelector('a')) s.remove(); // sub-group with no links left
  for (const g of $$('#nav .nav-group')) if (!g.querySelector('a')) g.remove();
};
const _renderTopbar_perm = renderTopbar;
renderTopbar = function () {
  if (DB && DB.roleDefs) { const ok = userCompanies(); if (!ok.includes(S.company)) S.company = ok[0]; }
  _renderTopbar_perm();
  if (DB && DB.roleDefs) { const ok = new Set(userCompanies()); for (const o of [...$('#co').options]) if (!ok.has(o.value)) o.remove(); }
};
const _switchUser_perm = switchUser;
switchUser = function (v) { S.userId = v; const ok = userCompanies(); if (!ok.includes(S.company)) S.company = ok[0]; renderNav(); _switchUser_perm(v); };
const _switchCompany_perm = switchCompany;
switchCompany = function (v) { _switchCompany_perm(v); renderNav(); };
/* buttons on document pages */
const _whseHides_perm = whseHides;
whseHides = function (label) {
  if (_whseHides_perm(label)) return true;
  const t = ED && ED.type, a = areaOfDoc(t); if (!a) return false;
  if (/Print/.test(label) || /Approve|Reject/.test(label)) return false;
  if (/^Delete/.test(label)) return !can(a, 'delete');
  if (/Post Receipt/.test(label)) return !can(t === 'TO' ? 'invjnl' : 'rcpt', 'post');
  if (/Void Check|Unapply|Apply Entries/.test(label)) return !can(a, 'post');
  if (/Make Order/.test(label)) return !can('po', 'create');
  if (/Create Invoice/.test(label)) return !can('pi', 'create');
  if (/Create RFQ|Create Purchase Quotes/.test(label)) return !can('rfq', 'create');
  if (/Service Completion|Service report/.test(label)) return !can('asr', 'create');
  if (/Create Sales Invoice/.test(label)) return !can('si', 'create');
  if (/Post/.test(label)) return !can(a, 'post');
  if (/Save|Send Approval|Release|Reopen|Cancel Approval|Suggest|Calculate|Create Whse|Get /.test(label)) return !can(a, 'create');
  return false;
};
/* approvals: the approval rule names who; a role-based step also needs the Approve tick */
const _canApprove_perm = canApprove;
canApprove = function (o) {
  if (!_canApprove_perm(o)) return false;
  const st = o && (pendingStep(o) || (o.approvals || []).find(a => a.status === 'Pending'));
  if (st && st.userId) return true;
  const a = o && o.type ? areaOfDoc(o.type) : null;
  return !a || can(a, 'approve');
};
const _whyCannot_perm = whyCannotApprove;
whyCannotApprove = function (o) {
  const w = _whyCannot_perm(o); if (w) return w;
  const st = o && pendingStep(o); if (!st || st.userId) return '';
  const a = o.type ? areaOfDoc(o.type) : null;
  return a && !can(a, 'approve') ? permMsg(a, 'approve') : '';
};
/* actions */
const _storeED_perm = storeED;
storeED = function () { permCheck(areaOfDoc(ED.type), 'create'); return _storeED_perm(); };
const _postReceipt_perm = postReceipt;
postReceipt = function (po, rr) { if (!rr.asrId) permCheck(rr.fromWhse ? 'whse' : 'rcpt', 'post'); return _postReceipt_perm(po, rr); };
const _masterCanEdit_perm = masterCanEdit;
masterCanEdit = function (def) { const coll = Object.keys(MASTERS).find(k => MASTERS[k] === def); const a = MASTER_AREA[coll] || 'setup'; return permOn() && DB.roleDefs ? can(a, 'create') : _masterCanEdit_perm(def); };
function permGate(name, area, act) {
  const f = window[name]; if (typeof f !== 'function') return;
  window[name] = function (...args) { const a = typeof area === 'function' ? area(...args) : area; if (!can(a, act)) { toast(permMsg(a, act), 'err'); return false; } return f.apply(this, args); };
}
permGate('deleteDoc', () => areaOfDoc(ED.type), 'delete');
permGate('postDoc', () => areaOfDoc(ED.type), 'post');
permGate('saveMaster', coll => MASTER_AREA[coll] || 'setup', 'create');
for (const [n, a] of [['pqMakePO', 'po'], ['poCreatePI', 'pi'], ['rfqFromPR', 'rfq'], ['prCreatePQ', 'rfq'], ['rfqInvite', 'rfq'], ['rfqSend', 'rfq'], ['rfqQuote', 'rfq'], ['rfqDecline', 'rfq'], ['rfqAward', 'rfq'], ['rfqCancel', 'rfq'], ['qarUpload', 'rfq'],
  ['asrNew', 'asr'], ['asrSave', 'asr'], ['asrSubmit', 'asr'], ['asrRevise', 'asr'], ['soCreateSI', 'si'], ['ncMakeSO', 'so'], ['ncMakeDepInv', 'si'], ['ncSave', 'nospa'], ['ersSave', 'req'], ['ersMakePR', 'req'],
  ['bkImport', 'bank'], ['bkCreate', 'bank'], ['bkMakeBrec', 'bank'], ['bkMatch', 'bank'], ['bkRematch', 'bank'], ['bkUnmatch', 'bank'], ['cpSubmit', 'bank'], ['vaSubmit', 'vendors'], ['vaChangeReq', 'vendors'], ['vaRate', 'vendors'],
  ['toShip', 'invjnl'], ['toReceive', 'invjnl'], ['fxAdjustPost', 'coa']]) permGate(n, a, 'create');
permGate('ncDelete', 'nospa', 'delete'); permGate('asrDelete', 'asr', 'delete');
permGate('ersRelease', 'req', 'post'); permGate('cpReview', 'bank', 'approve');
for (const n of ['whPostReceipt', 'whPostShipment', 'whRegister']) permGate(n, 'whse', 'post');
for (const n of ['whCreateReceipt', 'whCreateShipment', 'whCreatePick']) permGate(n, 'whse', 'create');
if (NAV) { const g = NAV.find(x => x[0] === 'Administration'); if (g && !g[1].some(l => l[0] === '#/roles')) g[1].unshift(['#/roles', 'Roles & Permissions']); }

/* ---------- the editor ---------- */
const RP = { role: '', draft: null, tab: 'edit', q: '' };
route('roles', () => {
  if (!DB.roleDefs) permMigrate();
  const defs = DB.roleDefs, names = ROLES.filter(n => defs[n]), editable = can('admin', 'create');
  if (!RP.role || !defs[RP.role]) RP.role = names.find(n => n !== 'System Admin') || names[0];
  if (!RP.draft || RP.draft._for !== RP.role) RP.draft = { ...clone(defs[RP.role]), _for: RP.role, _name: RP.role };
  const cnt = n => DB.users.filter(u => (u.roles || []).includes(n)).length;
  const list = names.filter(n => !RP.q || n.toLowerCase().includes(RP.q.toLowerCase()));
  return pageHead('Roles & Permissions', `What each role may do, per area and company. Users get roles under <a href="#/list/users">Users & Roles</a>; who approves which document is set in <a href="#/list/approvalRules">Approval Rules</a>. ${permOn() ? '' : '<b class="bad">Permissions are switched OFF: everyone can do everything.</b>'}`,
    `<div class="segs"><button class="${RP.tab === 'edit' ? 'on' : ''}" onclick="RP.tab='edit';render()">Edit a role</button><button class="${RP.tab === 'all' ? 'on' : ''}" onclick="RP.tab='all';render()">All roles at a glance</button></div>
    ${editable ? `<button class="btn" onclick="rpImport()">⬆ Import roles file (Excel)</button> <button class="btn" onclick="rpSettings()">Settings</button>` : ''}`) +
  (RP.tab === 'all' ? rpOverview(names) : `<div class="rp-grid"><div class="card" style="align-self:start"><div style="display:flex;gap:6px;margin-bottom:8px"><input placeholder="Search roles…" value="${esc(RP.q)}" oninput="RP.q=this.value;rpList()" style="flex:1;padding:6px 9px;border:1px solid #d5dce8;border-radius:8px">
      ${editable ? '<button class="btn sm primary" onclick="rpNew()">+ New</button>' : ''}</div><div id="rp_list">${rpListHtml(list, cnt)}</div></div>
    <div>${rpEditor(RP.draft, editable, cnt)}</div></div>`);
});
{ const f = ROUTES.roles; ROUTES.roles = () => can('admin', 'view') ? f() : permDenied('admin', 'view'); }
function rpListHtml(list, cnt) {
  return `<div class="rp-roles">${list.map(n => `<a href="#/roles" class="${n === RP.role ? 'on' : ''}" onclick="RP.role=${esc(JSON.stringify(n))};RP.draft=null;render();return false"><span>${esc(n)}${BUILTIN_ROLES.includes(n) ? ' <span title="Used by built-in steps: cannot be renamed or deleted">🔒</span>' : ''}</span><small>${cnt(n)} user${cnt(n) === 1 ? '' : 's'}</small></a>`).join('')}</div>`;
}
function rpList() { const cnt = n => DB.users.filter(u => (u.roles || []).includes(n)).length; $('#rp_list').innerHTML = rpListHtml(ROLES.filter(n => DB.roleDefs[n] && (!RP.q || n.toLowerCase().includes(RP.q.toLowerCase()))), cnt); }
function rpApproverAreas(name) {
  const out = {}; for (const r of DB.approvalRules || []) if (r.role === name && (!r.approverType || r.approverType === 'Role')) { const a = areaOfDoc(r.docType) || (r.docType === 'MASTER' ? 'vendors' : null); if (a) (out[a] = out[a] || []).push(r.docType); }
  return out;
}
function rpEditor(d, editable, cnt) {
  const sys = d._for === 'System Admin', ro = !editable || sys, built = BUILTIN_ROLES.includes(d._for), apAreas = rpApproverAreas(d._for);
  const users = DB.users.filter(u => (u.roles || []).includes(d._for)), others = DB.users.filter(u => !(u.roles || []).includes(d._for));
  const groups = [...new Set(PERM_AREAS.map(a => a.g))];
  const cell = (a, k) => { if (!a.acts.includes(ACT_LETTER[k])) return '<td class="rp-na">—</td>'; const on = sys || !!((d.perms[a.k] || {})[k]), warn = k === 'approve' && apAreas[a.k] && !on;
    return `<td class="rp-c ${on ? 'on' : ''}"><input type="checkbox" ${on ? 'checked' : ''} ${ro ? 'disabled' : ''} onchange="rpTick('${a.k}','${k}',this.checked)" aria-label="${esc(a.l)}: ${k}">${warn ? `<span class="bad" title="Approver in Approval Rules for ${esc(apAreas[a.k].join(', '))}">⚠</span>` : ''}</td>`; };
  const warns = Object.entries(apAreas).filter(([a]) => !sys && !((d.perms[a] || {}).approve));
  return `<div class="card"><div class="form-grid">
      <label class="fld"><span>Role name</span><input id="rp_name" value="${esc(d._name)}" ${ro || built ? 'disabled' : ''} onchange="RP.draft._name=this.value.trim()"></label>
      <label class="fld w2"><span>Description</span><input id="rp_desc" value="${esc(d.desc || '')}" ${ro ? 'disabled' : ''} onchange="RP.draft.desc=this.value"></label>
      <div class="fld w3"><span>Companies this role covers</span><div class="rp-cos"><label><input type="checkbox" ${!(d.companies || []).length ? 'checked' : ''} ${ro ? 'disabled' : ''} onchange="rpCo('ALL',this.checked)"> All companies</label>
        ${DB.companies.map(c => `<label><input type="checkbox" ${(d.companies || []).includes(c.code) ? 'checked' : ''} ${ro ? 'disabled' : ''} onchange="rpCo('${c.code}',this.checked)"> ${esc(c.code)} – ${esc(c.name)}</label>`).join('')}</div></div></div>
      ${sys ? '<div class="alertbox"><span>ℹ</span><div><b>System Admin always has full access</b>It cannot be limited, so that someone can always fix the setup.</div></div>' : ''}
      ${warns.length ? `<div class="alertbox warn"><span>⚠</span><div><b>Approver without the Approve tick</b>This role approves ${esc(warns.map(([a, t]) => `${t.join('/')} (${PERM_AREA[a].l})`).join('; '))} in Approval Rules but cannot approve here. Tick Approve or change the rule.</div></div>` : ''}
      <div style="margin-top:10px"><b>Users with this role (${users.length}):</b> ${users.map(u => `<span class="chip">${esc(u.name)}${editable && !sys ? ` <a href="#/roles" onclick="rpUser('${u.id}',false);return false" title="Remove">×</a>` : ''}</span>`).join(' ') || '<span class="muted small">none</span>'}
      ${editable && !sys && others.length ? `<select onchange="if(this.value)rpUser(this.value,true)" style="margin-left:6px;padding:4px 6px;border:1px solid #d5dce8;border-radius:7px"><option value="">+ Give to a user…</option>${others.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select>` : ''}</div></div>
    <div class="card"><div class="lines-head"><h3 style="margin:0">Permissions</h3>${ro ? '' : `<span style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm ghost" onclick="rpAll('view')">View all</button><button class="btn sm ghost" onclick="rpAll('none')">Clear all</button></span>`}</div>
      <div class="tbl-wrap"><table class="grid compact rp-m"><thead><tr><th>Area</th>${PERM_ACTS.map(([k, l]) => `<th class="num">${ro ? esc(l) : `<a href="#/roles" onclick="rpCol('${k}');return false" title="Tick or clear the whole column">${esc(l)}</a>`}</th>`).join('')}${ro ? '' : '<th></th>'}</tr></thead><tbody>
      ${groups.map(g => `<tr class="rp-g"><td colspan="${ro ? 6 : 7}">${esc(g)}</td></tr>` + PERM_AREAS.filter(a => a.g === g).map(a => `<tr><td>${esc(a.l)}${a.hint ? `<div class="small muted">${esc(a.hint)}</div>` : ''}</td>${PERM_ACTS.map(([k]) => cell(a, k)).join('')}${ro ? '' : `<td><a href="#/roles" class="small" onclick="rpRow('${a.k}');return false">row</a></td>`}</tr>`).join('')).join('')}</tbody></table></div>
      <p class="small muted" style="margin:8px 0 0">Any tick also gives View. The permissions of all of a user's roles add up. Who approves a particular document is still set in Approval Rules.</p></div>
    ${ro ? '' : `<div class="card" style="margin:12px 0 0;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
      ${!built ? `<button class="btn danger ghost" onclick="rpDelete()">Delete role</button>` : ''}<button class="btn" onclick="rpCopy()">Copy as new role</button><button class="btn ghost" onclick="RP.draft=null;render()">Discard changes</button><button class="btn primary" onclick="rpSave()">💾 Save role</button></div>`}`;
}
function rpTick(a, k, on) { const p = RP.draft.perms[a] = RP.draft.perms[a] || {}; p[k] = on; if (on && k !== 'view') p.view = true; if (!on && k === 'view') for (const [x] of PERM_ACTS) p[x] = false; render(); }
function rpRow(a) { const ar = PERM_AREA[a], p = RP.draft.perms[a] = RP.draft.perms[a] || {}, all = PERM_ACTS.filter(([k]) => ar.acts.includes(ACT_LETTER[k])).every(([k]) => p[k]); for (const [k] of PERM_ACTS) p[k] = !all && ar.acts.includes(ACT_LETTER[k]); render(); }
function rpCol(k) { const areas = PERM_AREAS.filter(a => a.acts.includes(ACT_LETTER[k])), all = areas.every(a => (RP.draft.perms[a.k] || {})[k]); for (const a of areas) { const p = RP.draft.perms[a.k] = RP.draft.perms[a.k] || {}; p[k] = !all; if (!all) p.view = true; } render(); }
function rpAll(mode) { for (const a of PERM_AREAS) RP.draft.perms[a.k] = Object.fromEntries(PERM_ACTS.map(([k]) => [k, mode === 'view' && k === 'view'])); render(); }
function rpCo(c, on) { const d = RP.draft; if (c === 'ALL') d.companies = on ? [] : DB.companies.map(x => x.code); else { const s = new Set(d.companies && d.companies.length ? d.companies : DB.companies.map(x => x.code)); on ? s.add(c) : s.delete(c); d.companies = s.size === DB.companies.length ? [] : [...s]; if (!s.size) { toast('A role must cover at least one company.', 'err'); d.companies = [c]; } } render(); }
function rpDiff(a, b) {
  const out = [];
  for (const ar of PERM_AREAS) for (const [k] of PERM_ACTS) { const x = !!((a.perms || {})[ar.k] || {})[k], y = !!((b.perms || {})[ar.k] || {})[k]; if (x !== y) out.push(`${y ? '+' : '−'}${ACT_LETTER[k]} ${ar.k}`); }
  if (JSON.stringify(a.companies || []) !== JSON.stringify(b.companies || [])) out.push(`companies: ${(b.companies || []).join(',') || 'all'}`);
  return out.join(', ');
}
async function rpSave() {
  const d = RP.draft, old = DB.roleDefs[d._for], name = (d._name || '').trim();
  const ok = await commit(() => {
    permCheck('admin', 'create');
    if (!name) fail('The role needs a name.');
    if (name !== d._for) { if (BUILTIN_ROLES.includes(d._for)) fail(`${d._for} is used by built-in steps and cannot be renamed.`); if (DB.roleDefs[name]) fail(`Role ${name} already exists.`); }
    const rec = { name, desc: d.desc || '', companies: d.companies || [], perms: clone(d.perms) };
    if (name !== d._for) {
      delete DB.roleDefs[d._for];
      for (const u of DB.users) u.roles = (u.roles || []).map(r => r === d._for ? name : r);
      for (const r of DB.approvalRules) if (r.role === d._for) r.role = name;
    }
    DB.roleDefs[name] = rec; permSyncRoles();
  }, `Changed role ${name}: ${rpDiff(old || {}, d) || 'no permission change'}`, name);
  if (ok !== false) { RP.role = name; RP.draft = null; toast('Role saved.'); renderNav(); render(); }
}
function rpNew() {
  modal('New role', `<label class="fld w3"><span>Role name (e.g. the position title)</span><input id="rpn"></label><p class="small muted">It starts with "make requests" only; tick the rest after.</p>`, async () => {
    const n = $('#rpn').value.trim(); if (!n) { toast('Enter a name.', 'err'); return false; }
    const ok = await commit(() => { permCheck('admin', 'create'); if (DB.roleDefs[n]) fail(`Role ${n} already exists.`); DB.roleDefs[n] = { name: n, desc: '', companies: [], perms: { req: { view: true, create: true } } }; permSyncRoles(); }, `Created role ${n}`, n);
    if (ok !== false) { RP.role = n; RP.draft = null; render(); } else return false;
  }, 'Create');
}
function rpCopy() {
  modal(`Copy ${RP.draft._for}`, `<label class="fld w3"><span>Name of the new role</span><input id="rpn" value="${esc(RP.draft._for)} (copy)"></label>`, async () => {
    const n = $('#rpn').value.trim(), src = RP.draft; if (!n) { toast('Enter a name.', 'err'); return false; }
    const ok = await commit(() => { permCheck('admin', 'create'); if (DB.roleDefs[n]) fail(`Role ${n} already exists.`); DB.roleDefs[n] = { name: n, desc: src.desc || '', companies: clone(src.companies || []), perms: clone(src.perms) }; permSyncRoles(); }, `Created role ${n} as a copy of ${src._for}`, n);
    if (ok !== false) { RP.role = n; RP.draft = null; render(); } else return false;
  }, 'Copy');
}
async function rpDelete() {
  const n = RP.draft._for, users = DB.users.filter(u => (u.roles || []).includes(n)), rules = DB.approvalRules.filter(r => r.role === n);
  if (users.length) return toast(`Remove the role from ${users.length} user(s) first: ${users.map(u => u.name).join(', ')}.`, 'err');
  if (rules.length) return toast(`The role is an approver in ${rules.length} approval rule(s) (${[...new Set(rules.map(r => r.docType))].join(', ')}). Change those rules first.`, 'err');
  if (!confirm(`Delete role ${n}?`)) return;
  const ok = await commit(() => { permCheck('admin', 'delete'); if (BUILTIN_ROLES.includes(n)) fail('Built-in roles cannot be deleted.'); delete DB.roleDefs[n]; permSyncRoles(); }, `Deleted role ${n}`, n);
  if (ok !== false) { RP.role = ''; RP.draft = null; render(); }
}
async function rpUser(uid_, add) {
  const n = RP.draft._for;
  const ok = await commit(() => { permCheck('admin', 'create'); const u = DB.users.find(x => x.id === uid_); const s = new Set(u.roles || []); add ? s.add(n) : s.delete(n); if (!s.size) fail(`${u.name} would have no role left. Give another role first.`); u.roles = [...s]; }, `${add ? 'Gave' : 'Removed'} role ${n} ${add ? 'to' : 'from'} user`, uid_);
  if (ok !== false) { RP.draft = { ...RP.draft }; render(); }
}
function rpSettings() {
  modal('Roles & Permissions settings', `<label class="fld chk w3"><span>Apply permissions (when off, every user can do everything, as before)</span><input type="checkbox" id="rps_on" ${permOn() ? 'checked' : ''}></label>
    <p class="small muted">Until real logins are built, anyone can still pick another user in "Acting as". Permissions show what each person will be able to do and keep day-to-day use tidy.</p>`, async () => {
    const ok = await commit(() => { permCheck('admin', 'create'); DB.settings.perm = { enforce: $('#rps_on').checked }; }, `Permissions ${$('#rps_on').checked ? 'switched on' : 'switched off'}`);
    if (ok !== false) { renderNav(); render(); } else return false;
  });
}
function rpOverview(names) {
  const letters = (d, a) => PERM_ACTS.filter(([k]) => d._sys || ((d.perms || {})[a.k] || {})[k]).filter(([k]) => a.acts.includes(ACT_LETTER[k])).map(([k]) => ACT_LETTER[k]).join('');
  return `<div class="card"><p class="small muted" style="margin:0 0 8px">V view · C create/edit · D delete/cancel · A approve · P post. Click a role to edit it.</p><div class="tbl-wrap"><table class="grid compact rp-o"><thead><tr><th>Role</th><th>Companies</th>${PERM_AREAS.map(a => `<th title="${esc(a.l)}">${esc(a.k)}</th>`).join('')}</tr></thead><tbody>
    ${names.map(n => { const d = { ...DB.roleDefs[n], _sys: n === 'System Admin' }; return `<tr class="link" onclick="RP.role=${esc(JSON.stringify(n))};RP.draft=null;RP.tab='edit';render()"><td><b>${esc(n)}</b></td><td class="small">${(d.companies || []).length ? esc(d.companies.join(', ')) : 'All'}</td>${PERM_AREAS.map(a => `<td class="small" style="text-align:center">${letters(d, a)}</td>`).join('')}</tr>`; }).join('')}</tbody></table></div>
    <p class="small muted" style="margin:8px 0 0">${PERM_AREAS.map(a => `<b>${a.k}</b> ${esc(a.l)}`).join(' · ')}</p></div>`;
}

/* ---------- import the roles file (one sheet per department) ---------- */
const RP_COLS = [[/purchase quote/i, ['rfq']], [/purchase order/i, ['po']], [/purchase invoice/i, ['pi']], [/sales quote|sales order/i, ['so']], [/sales invoice/i, ['si']], [/warehouse receipt/i, ['whse', 'rcpt']],
  [/item journal|physical journal/i, ['invjnl']], [/cash disbursement/i, ['pay']], [/cash receipts/i, ['cr']], [/general journal/i, ['gj']], [/cash management/i, ['bank']], [/financial management|philtax/i, ['reports']],
  [/customer card/i, ['customers']], [/vendor card/i, ['vendors']], [/item card|warehouse card/i, ['items']], [/chart of accounts/i, ['coa']], [/fixed asset/i, ['fa']], [/intercompany|consolidation/i, ['ic']], [/backup|full access/i, ['admin']]];
const RP_ACTS = [[/read\/?view/i, 'view'], [/create/i, 'create'], [/delete/i, 'delete'], [/approval\/reject|^approval\b/i, 'approve'], [/posting/i, 'post']];
const RP_BU = [[/^mining$/i, ['LAMI', 'LLRI']], [/^tankering$/i, ['TANK']], [/^land$/i, ['LAND']]];
const RP_DUTY = [[/purchase order/i, 'po'], [/purchase invoice/i, 'pi'], [/quot|canvass|rfq/i, 'rfq'], [/vendor/i, 'vendors'], [/customer/i, 'customers'], [/item card|items?\b/i, 'items'], [/disbursement|payment|check|cheque/i, 'pay'],
  [/collection|cash receipt|official receipt/i, 'cr'], [/general journal|journal entr/i, 'gj'], [/fixed asset/i, 'fa'], [/bank/i, 'bank'], [/sales invoice|billing/i, 'si'], [/sales order/i, 'so'], [/report|financial statement|trial balance/i, 'reports'],
  [/chart of account/i, 'coa'], [/transfer order|stock transfer/i, 'invjnl'], [/warehouse|receiv/i, 'whse'], [/purchase requ|requisition|request/i, 'req']];
function rpParse(sheets) {
  const out = {};
  for (const sh of sheets) {
    const rows = sh.rows || [], hi = rows.findIndex((r, i) => i < 6 && r.some(c => /position title/i.test(c)) && r.some(c => /read\/?\s*view/i.test(c))); if (hi < 0) continue;
    const H = rows[hi], col = re => H.findIndex(c => re.test(c)), posC = col(/position title/i), dutyC = col(/duties/i);
    const modCols = H.map((h, i) => { const m = RP_COLS.find(([re]) => re.test(h)); return m ? [i, m[1]] : null; }).filter(Boolean);
    const actCols = H.map((h, i) => { const m = RP_ACTS.find(([re]) => re.test(h)); return m ? [i, m[1]] : null; }).filter(Boolean);
    const buCols = H.map((h, i) => { const m = RP_BU.find(([re]) => re.test(String(h).trim())); return m ? [i, m[1]] : null; }).filter(Boolean);
    const ticked = (r, i) => String(r[i] || '').trim() !== '';
    for (const r of rows.slice(hi + 1)) {
      const pos = String(r[posC] || '').trim(); if (!pos || /position title/i.test(pos)) continue;
      const o = out[pos] = out[pos] || { name: pos, sheets: new Set(), perms: {}, cos: new Set(), lines: 0 };
      o.sheets.add(sh.name); o.lines++;
      let areas = [...new Set(modCols.filter(([i]) => ticked(r, i)).flatMap(([, a]) => a))];
      if (!areas.length) { const d = String(r[dutyC] || ''); const m = RP_DUTY.find(([re]) => re.test(d)); if (m) areas = [m[1]]; }
      let acts = actCols.filter(([i]) => ticked(r, i)).map(([, a]) => a); if (!acts.length && areas.length) acts = ['view'];
      for (const a of areas) { const p = o.perms[a] = o.perms[a] || {}; for (const k of acts) if (PERM_AREA[a].acts.includes(ACT_LETTER[k])) p[k] = true; p.view = true; }
      buCols.filter(([i]) => ticked(r, i)).forEach(([, cs]) => cs.forEach(c => o.cos.add(c)));
    }
  }
  return Object.values(out).map(o => ({ ...o, sheets: [...o.sheets], cos: [...o.cos].filter(c => DB.companies.some(x => x.code === c)) })).sort((a, b) => a.name.localeCompare(b.name));
}
let RP_IMP = null;
function rpImport() {
  modal('Import the roles file', `<p class="small">Choose your <b>Roles and Permission</b> Excel file (one sheet per department). A role is made for each <b>position title</b>, from the modules, the permission columns (Read/View, Create, Delete, Approval, Posting) and the business units ticked. People's names are not imported: give the roles to users afterwards.</p>
    <label class="fld w3"><span>Excel file (.xlsx)</span><input type="file" accept=".xlsx" onchange="rpImportRead(this)"></label><div id="rp_imp"></div>`, () => rpImportDo(), 'Import selected roles', true);
}
async function rpImportRead(inp) {
  const f = inp.files && inp.files[0]; if (!f) return;
  let sheets; try { sheets = await readXlsx(await f.arrayBuffer()); } catch (e) { return toast('This file cannot be read. Choose the .xlsx roles file.', 'err'); }
  RP_IMP = rpParse(sheets);
  if (!RP_IMP.length) { $('#rp_imp').innerHTML = '<div class="alertbox warn"><span>⚠</span><div><b>No roles found</b>The sheets need a header row with "Position Title" and "Read/View Only".</div></div>'; return; }
  $('#rp_imp').innerHTML = `<p class="small" style="margin:8px 0"><b>${RP_IMP.length}</b> position titles found in ${new Set(RP_IMP.flatMap(r => r.sheets)).size} sheets. Existing roles with the same name get the new ticks added (nothing is removed).</p>
    <div class="tbl-wrap" style="max-height:340px"><table class="grid compact"><thead><tr><th><input type="checkbox" checked onchange="$$('.rpi').forEach(x=>x.checked=this.checked)"></th><th>Position title → role</th><th>Sheets</th><th>Permissions</th><th>Companies</th><th></th></tr></thead><tbody>
    ${RP_IMP.map((r, i) => `<tr><td><input type="checkbox" class="rpi" value="${i}" checked></td><td><b>${esc(r.name)}</b></td><td class="small">${esc(r.sheets.join(', '))}</td>
      <td class="small">${Object.entries(r.perms).map(([a, p]) => `${a}:${PERM_ACTS.filter(([k]) => p[k]).map(([k]) => ACT_LETTER[k]).join('')}`).join(' ') || '<span class="muted">none recognised</span>'}</td><td class="small">${r.cos.join(', ') || 'All'}</td><td>${DB.roleDefs[r.name] ? badge('Exists') : badge('New')}</td></tr>`).join('')}</tbody></table></div>`;
}
async function rpImportDo() {
  if (!RP_IMP) { toast('Choose the roles file first.', 'err'); return false; }
  const pick = $$('.rpi').filter(x => x.checked).map(x => RP_IMP[+x.value]); if (!pick.length) { toast('Tick at least one role.', 'err'); return false; }
  let nNew = 0, nUpd = 0;
  const ok = await commit(() => {
    permCheck('admin', 'create');
    for (const r of pick) {
      const d = DB.roleDefs[r.name];
      if (d) { nUpd++; for (const [a, p] of Object.entries(r.perms)) { const q = d.perms[a] = d.perms[a] || {}; for (const k in p) if (p[k]) q[k] = true; } }
      else { nNew++; DB.roleDefs[r.name] = { name: r.name, desc: `From the roles file (${r.sheets.join(', ')})`, companies: r.cos.length === DB.companies.length ? [] : r.cos, perms: { req: { view: true, create: true }, ...clone(r.perms) } }; }
    }
    permSyncRoles();
  }, `Imported roles file: ${pick.length} roles`);
  if (ok === false) return false;
  toast(`${nNew} role(s) created, ${nUpd} updated. Give them to users under Users & Roles or on the role page.`); RP.draft = null; render();
}
