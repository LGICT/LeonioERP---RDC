'use strict';
/* ============ Navigation, top bar, startup ============ */
const NAV = [
  ['Home', [['#/home', 'Role Center'], ['#/approvals', 'Requests to Approve', 'appr'], ['#/guide', 'Getting Started']]],
  ['Requisitions', [['#/ers', 'Dashboard'], ['#/ersnew/new', 'New Request'], ['#/ersmy', 'My Requests'], ['#/ersq', 'Requests to Process', 'ersq'], ['#/erscat', 'Item Catalog'], ['#/ersbud', 'Budget Status'], ['#/ersacc', 'Issuance Accounts']]],
  ['Purchasing', [['#/docs/PR', 'Purchase Requisitions'], ['#/rfq', 'Requests for Quotation (RFQ)', 'rfq'], ['#/docs/PQ', 'Purchase Quotes'], ['#/docs/PO', 'Purchase Orders'], ['#/asr', 'Service Acceptance (ASR)', 'asr'], ['#/docs/RR', 'Posted Purchase Receipts'],
    ['#/docs/PI', 'Purchase Invoices'], ['#/docs/PRET', 'Purchase Credit Memos'], ['#/docs/PAY', 'Payment Journals'], ['#/list/vendors', 'Vendors'], ['#/vendacc', 'Vendor Accreditation', 'vacc'], ['#/list/vendDocReqs', 'Vendor Document Requirements']]],
  ['Sales', [['#/nospa', 'Sales Contracts (NOSPA)'], ['#/docs/SO', 'Sales Orders'], ['#/docs/SI', 'Sales Invoices'], ['#/docs/SCM', 'Sales Credit Memos'], ['#/docs/CR', 'Cash Receipt Journals'], ['#/list/customers', 'Customers']]],
  ['Treasury', [['#/docs/PAY', 'Payment Journals'], ['#/docs/CR', 'Cash Receipt Journals'], ['#/docs/FT', 'Transfers of Funds'], ['#/cashpos', 'Daily Cash Position'], ['#/bankimp', 'Bank Statement Import', 'bkimp'], ['#/docs/BREC', 'Bank Acc. Reconciliations'],
    ['#/report/bankled', 'Bank Account Ledger'], ['#/report/cashflow', 'Cash Flow Forecast'], ['#/list/bankAccounts', 'Bank Accounts'],
    ['#/list/fxRates', 'Currency Exchange Rates'], ['#/fxadjust', 'Adjust Exchange Rates'], ['#/docs/FXA', 'Exchange Rate Adjustments'], ['#/list/currencies', 'Currencies']]],
  ['Inventory', [['#/list/items', 'Items'], ['#/itemdesc', 'Item Description Review'], ['#/report/inv', 'Inventory Valuation'], ['#/docs/TO', 'Transfer Orders'], ['#/docs/IJ', 'Item Journals'], ['#/docs/PC', 'Phys. Inventory Journals'],
    ['#/report/il', 'Item Ledger Entries'], ['#/list/locations', 'Locations'], ['#/list/itemCharges', 'Item Charges']]],
  ['Warehouse', [['#/docs/WR', 'Warehouse Receipts'], ['#/docs/PA', 'Put-aways'], ['#/docs/WS', 'Warehouse Shipments'], ['#/docs/PK', 'Picks'],
    ['#/docs/RJ', 'Item Reclass. Journals'], ['#/bincontents', 'Bin Contents'], ['#/list/bins', 'Bins']]],
  ['Intercompany', [['#/ic', 'IC Inbox / Outbox', 'ic'], ['#/icpartners', 'IC Partners'], ['#/report/icrec', 'IC Reconciliation'], ['#/report/consol', 'Consolidated Trial Balance']]],
  ['Finance', [['#/docs/GJ', 'General Journals'], ['#/list/accounts', 'Chart of Accounts'], ['#/report/gl', 'G/L Entries'], ['#/list/bankAccounts', 'Bank Accounts'], ['#/list/dimensions', 'Dimensions'],
    ['#/list/dimValues', 'Dimension Values'], ['#/list/budgets', 'Budgets']]],
  ['Fixed Assets', [['#/fa', 'Fixed Assets'], ['#/docs/DEP', 'Depreciation Runs'], ['#/report/equip', 'Cost per Equipment / Vessel'], ['#/list/faPostGroups', 'FA Posting Groups'], ['#/list/faClasses', 'FA Classes'], ['#/list/faSubclasses', 'FA Subclasses']]],
  // '-' entries are sub-headings inside a menu group
  ['Reports', [['-', 'Financial statements'], ['#/report/tb', 'Trial Balance'], ['#/report/is', 'Income Statement'], ['#/report/bs', 'Balance Sheet'], ['#/report/gl', 'G/L Entries'], ['#/report/bva', 'Budget vs. Actual'],
    ['-', 'Receivables & payables'], ['#/report/ar', 'Aged Accounts Receivable'], ['#/report/ap', 'Aged Accounts Payable'],
    ['-', 'Treasury'], ['#/cashpos', 'Daily Cash Position'], ['#/report/cashflow', 'Cash Flow Forecast'], ['#/report/bankled', 'Bank Account Ledger'],
    ['-', 'Inventory'], ['#/report/inv', 'Inventory Valuation'], ['#/report/il', 'Item Ledger Entries'], ['#/report/equip', 'Cost per Equipment / Vessel'],
    ['-', 'Tax (BIR)'], ['#/bir', 'Withholding Tax: 2307, QAP / MAP'],
    ['-', 'Intercompany'], ['#/report/icrec', 'IC Reconciliation'], ['#/report/consol', 'Consolidated Trial Balance'],
    ['-', 'Audit'], ['#/report/audit', 'Change Log']]],
  ['Posting Setup', [['#/list/genSetup', 'General Posting Setup'], ['#/list/genBus', 'Gen. Bus. Posting Groups'], ['#/list/genProd', 'Gen. Prod. Posting Groups'], ['#/list/invSetup', 'Inventory Posting Setup'],
    ['#/list/invPostGroups', 'Inventory Posting Groups'], ['#/list/vendPostGroups', 'Vendor Posting Groups'], ['#/list/custPostGroups', 'Customer Posting Groups'], ['#/list/bankPostGroups', 'Bank Acc. Posting Groups']]],
  ['VAT & Withholding Tax', [['#/list/vatSetup', 'VAT Posting Setup'], ['#/list/vatBus', 'VAT Bus. Posting Groups'], ['#/list/vatProd', 'VAT Prod. Posting Groups'], ['#/list/whtSetup', 'WHT Posting Setup'], ['#/list/whtBus', 'WHT Bus. Posting Groups'], ['#/list/whtProd', 'WHT Prod. Posting Groups']]],
  ['Other Setup', [['#/list/paymentTerms', 'Payment Terms'], ['#/list/paymentMethods', 'Payment Methods'], ['#/list/noSeries', 'No. Series'], ['#/list/journalBatches', 'Journal Batches'], ['#/list/uom', 'Units of Measure'],
    ['#/list/itemCategories', 'Item Categories'], ['#/list/currencies', 'Currencies'], ['#/list/faLocations', 'FA Locations'], ['#/list/employees', 'Employees']]],
  ['Administration', [['#/bcimport', 'Import Master Data'], ['#/mdcheck', 'Master Data Check'], ['#/list/users', 'Users & Roles'], ['#/apflow', 'Approval Designer'], ['#/list/approvalRules', 'Approval Rules'], ['#/list/companies', 'Companies'], ['#/settings', 'Settings & Backup']]],
  ['ERP Project', [['#/roadmap', 'Roadmap']]]
];
/* Sidebar groups fold open/closed (remembered in this browser); the group of the current page always opens */
let NAV_OPEN = (() => { try { return JSON.parse(localStorage.getItem('leonio-erp-nav') || 'null'); } catch (e) { return null; } })() || ['Home', 'Requisitions'];
/* Sub-groups inside a group ('-' entries in NAV) fold open/closed too; remembered as "Group/Sub" */
let NAV_SUB_OPEN = (() => { try { return JSON.parse(localStorage.getItem('leonio-erp-navsub') || 'null'); } catch (e) { return null; } })() || [];
/* Menu order: every user can drag groups, sub-groups and items into their own order (saved per user in DB.navOrder:
   { groups: [group…], items: { [group or "group/sub"]: [href or "-sub"…] } }). Items not in the saved order keep their place at the end. */
const navOrder = () => ((DB && DB.navOrder) || {})[S.userId] || null;
function navSorted(list, keyOf, saved) {
  if (!saved || !saved.length) return list;
  const pos = new Map(saved.map((k, i) => [k, i]));
  return list.map((x, i) => ({ x, i, p: pos.has(keyOf(x)) ? pos.get(keyOf(x)) : saved.length + i })).sort((a, b) => a.p - b.p || a.i - b.i).map(o => o.x);
}
function navBlocks(links) { // split a group's links into blocks: a single link, or a sub-group with its links
  const out = []; let cur = null;
  for (const x of links) { if (x[0] === '-') { cur = { sub: x[1], links: [] }; out.push(cur); } else if (cur) cur.links.push(x); else out.push({ link: x }); }
  return out;
}
function navLinksHtml(g, links) {
  const ord = navOrder(), items = (ord && ord.items) || {};
  const link = ([h, l, b]) => `<a href="${h}" draggable="true" data-k="${esc(h)}">${esc(l)}${b ? '<span class="nbadge" id="nb-' + b + '"></span>' : ''}</a>`;
  return navSorted(navBlocks(links), b => b.sub ? '-' + b.sub : b.link[0], items[g]).map(b => {
    if (!b.sub) return link(b.link);
    const s = `${g}/${b.sub}`, open = NAV_SUB_OPEN.includes(s);
    return `<div class="nav-sub-wrap ${open ? '' : 'collapsed'}" data-s="${esc(s)}" data-k="${esc('-' + b.sub)}" draggable="true"><button type="button" class="nav-sub" aria-expanded="${open}" onclick="toggleNavSub(this)">${esc(b.sub)}<span class="chev">▾</span></button>${navSorted(b.links, x => x[0], items[s]).map(link).join('')}</div>`;
  }).join('');
}
function renderNav() {
  const ord = navOrder();
  $('#nav').innerHTML = navSorted(NAV, x => x[0], ord && ord.groups).map(([g, links]) => `<div class="nav-group ${NAV_OPEN.includes(g) ? '' : 'collapsed'}" data-g="${esc(g)}" data-k="${esc(g)}" draggable="true"><button type="button" class="nav-title" aria-expanded="${NAV_OPEN.includes(g)}" onclick="toggleNav(this)">${esc(g)}<span class="chev">▾</span></button>${navLinksHtml(g, links)}</div>`).join('')
    + (ord ? `<button type="button" class="nav-reset" onclick="navResetOrder()" title="Put the menu back in the standard order">↺ Reset menu order</button>` : '');
}
/* drag and drop: an item moves within its own group or sub-group; groups move among groups */
let NAV_DRAG = null;
function navDragInit() {
  const nav = $('#nav'); if (!nav || nav._dnd) return; nav._dnd = true;
  const clear = () => $$('#nav .drop-before, #nav .drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
  const target = e => { if (!NAV_DRAG) return null; const t = e.target.closest('[data-k]'); if (!t || t === NAV_DRAG) return null; let c = t; while (c && c.parentElement !== NAV_DRAG.parentElement) c = c.parentElement.closest('[data-k]'); return c && c !== NAV_DRAG ? c : null; };
  nav.addEventListener('dragstart', e => { const el = e.target.closest && e.target.closest('[draggable="true"]'); if (!el) return; NAV_DRAG = el; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', el.dataset.k); } catch (x) { } e.stopPropagation(); });
  nav.addEventListener('dragover', e => { const t = target(e); clear(); if (!t) return; e.preventDefault(); const r = t.getBoundingClientRect(), after = e.clientY > r.top + Math.min(r.height, 34) / 2; t.classList.add(after ? 'drop-after' : 'drop-before'); });
  nav.addEventListener('dragleave', e => { if (!nav.contains(e.relatedTarget)) clear(); });
  nav.addEventListener('drop', e => { const t = target(e); if (!t) return; e.preventDefault(); const after = t.classList.contains('drop-after'); clear(); t.parentElement.insertBefore(NAV_DRAG, after ? t.nextSibling : t); navSaveOrder(); });
  nav.addEventListener('dragend', () => { if (NAV_DRAG) NAV_DRAG.classList.remove('dragging'); NAV_DRAG = null; clear(); });
}
async function navSaveOrder() {
  const keys = (parent, sel) => [...parent.children].filter(x => x.matches(sel)).map(x => x.dataset.k);
  const old = navOrder() || { groups: [], items: {} }, ord = { groups: keys($('#nav'), '.nav-group'), items: { ...old.items } };
  // keep groups this user cannot see where they were
  for (const g of old.groups || []) if (!ord.groups.includes(g)) ord.groups.push(g);
  for (const g of $$('#nav .nav-group')) { ord.items[g.dataset.g] = keys(g, 'a, .nav-sub-wrap'); for (const s of g.querySelectorAll('.nav-sub-wrap')) ord.items[s.dataset.s] = keys(s, 'a'); }
  const ok = await commit(() => { DB.navOrder = DB.navOrder || {}; DB.navOrder[S.userId] = ord; }, '');
  if (ok !== false) { renderNav(); if (typeof render === 'function') { $$('#nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === location.hash || location.hash.startsWith(a.getAttribute('href') + '/'))); renderTopbar(); } }
}
async function navResetOrder() {
  if (!confirm('Put the menu back in the standard order?')) return;
  const ok = await commit(() => { if (DB.navOrder) delete DB.navOrder[S.userId]; }, '');
  if (ok !== false) { renderNav(); render(); toast('Menu order reset.'); }
}
function toggleNavSub(btn) {
  const w = btn.parentElement, s = w.dataset.s, open = w.classList.toggle('collapsed') === false;
  btn.setAttribute('aria-expanded', open);
  NAV_SUB_OPEN = open ? [...new Set(NAV_SUB_OPEN.concat(s))] : NAV_SUB_OPEN.filter(x => x !== s);
  try { localStorage.setItem('leonio-erp-navsub', JSON.stringify(NAV_SUB_OPEN)); } catch (e) { }
}
function toggleNav(btn) {
  const grp = btn.parentElement, g = grp.dataset.g, open = grp.classList.toggle('collapsed') === false;
  btn.setAttribute('aria-expanded', open);
  NAV_OPEN = open ? [...new Set(NAV_OPEN.concat(g))] : NAV_OPEN.filter(x => x !== g);
  try { localStorage.setItem('leonio-erp-nav', JSON.stringify(NAV_OPEN)); } catch (e) { }
}
function renderTopbar() {
  const act = $('#nav a.active');
  if (act) { const grp = act.closest('.nav-group'); if (grp && grp.classList.contains('collapsed')) { grp.classList.remove('collapsed'); grp.querySelector('.nav-title').setAttribute('aria-expanded', 'true'); } }
  if (act) { const sw = act.closest('.nav-sub-wrap'); if (sw && sw.classList.contains('collapsed')) { sw.classList.remove('collapsed'); sw.querySelector('.nav-sub').setAttribute('aria-expanded', 'true'); } }
  const tt = $('#toptitle'); if (tt) tt.textContent = act ? `${act.closest('.nav-group').dataset.g} · ${act.firstChild.textContent}` : (($('#main h1') || {}).textContent || '');
  const eq = ersQueues(S.company), en = eq.approve.length + eq.review.length + eq.canvass.length + eq.release.length;
  const be = $('#nb-ersq'); if (be) { be.textContent = en || ''; be.style.display = en ? '' : 'none'; }
  const vn = typeof vaBadgeCount === 'function' ? vaBadgeCount() : 0, bv = $('#nb-vacc'); if (bv) { bv.textContent = vn || ''; bv.style.display = vn ? '' : 'none'; }
  const an = typeof asrBadgeCount === 'function' ? asrBadgeCount() : 0, ba = $('#nb-asr'); if (ba) { ba.textContent = an || ''; ba.style.display = an ? '' : 'none'; }
  const kn = typeof bkBadgeCount === 'function' ? bkBadgeCount() : 0, bk = $('#nb-bkimp'); if (bk) { bk.textContent = kn || ''; bk.style.display = kn ? '' : 'none'; }
  const rn = typeof rfqBadgeCount === 'function' ? rfqBadgeCount() : 0, br = $('#nb-rfq'); if (br) { br.textContent = rn || ''; br.style.display = rn ? '' : 'none'; }
  $('#co').innerHTML = optionsHtml(refOptions('companies'), S.company, false);
  $('#usr').innerHTML = optionsHtml(DB.users.map(u => [u.id, `${u.name}`]), S.userId, false);
  const n = myApprovals().length;
  const b = $('#nb-appr'); if (b) { b.textContent = n || ''; b.style.display = n ? '' : 'none'; }
  const icn = (DB.icTransactions || []).filter(t => t.to === S.company && t.status === 'Pending').length;
  const bi = $('#nb-ic'); if (bi) { bi.textContent = icn || ''; bi.style.display = icn ? '' : 'none'; }
  $('#mode').textContent = serverMode ? '● Saved on this PC' : '● Browser only';
  $('#mode').className = serverMode ? 'mode ok' : 'mode warn';
}
function switchCompany(v) { S.company = v; if (/^#\/(doc|card|facard)\//.test(location.hash)) go(location.hash.startsWith('#/doc/') ? '#/docs/' + location.hash.split('/')[2] : '#/home'); render(); }
function switchUser(v) { S.userId = v; toast(`Now acting as ${curUser().name} (${curUser().roles.join(', ')}).`); render(); }

/** Upgrade data saved by an older version (adds new tables, rules and number-series mappings) */
async function migrate() {
  let changed = false;
  if (!DB.whseEntries) { DB.whseEntries = []; changed = true; }
  if (!DB.bankLedger) { DB.bankLedger = []; changed = true; }
  if (!DB.applications) { DB.applications = []; changed = true; }
  if (!DB.icTransactions) { DB.icTransactions = []; changed = true; }
  if (!DB.fxRates) { DB.fxRates = []; changed = true; }
  // Gain/loss accounts per currency, as in the Currency sheets of your configuration packages
  const FXACC = { MINING: ['8120010', '8120030', '8120020', '8120040'], LAND: ['7110032', '7110032', '7110031', '7110031'], TANK: ['7110032', '7110032', '7110031', '7110031'] };
  for (const [set, m] of Object.entries(DB.md)) for (const c of m.currencies) if (!c.realizedGain && FXACC[set] && isFCY(c.code)) {
    [c.realizedGain, c.realizedLoss, c.unrealizedGain, c.unrealizedLoss] = FXACC[set]; MD_DIRTY = true; changed = true;
  }
  // Legal names as found in the affiliate vendor/customer records of the master files
  const LEGAL = { ADMIN: 'Leonio Group Corp.', LAND: 'Leonio Land Holdings Inc.', LLRI: 'Lift Logistics Resources Incorporated', LAMI: 'LNL Archipelago Minerals Incorporated' };
  for (const c of DB.companies) if (c.legalName === undefined) { c.legalName = LEGAL[c.code] || ''; changed = true; }
  for (const [t, role] of [['RJ', 'BU Accounting Manager'], ['FT', 'Treasury Assistant Manager'], ['BREC', 'Treasury Assistant Manager']])
    if (!DB.approvalRules.some(r => r.docType === t)) { DB.approvalRules.push({ id: uid(), docType: t, seq: 10, role, cond: 'always', amount: 0 }); changed = true; }
  // Decisions of 8 Nov 2026: ERS requisitions, approver hierarchy, PI and PO approval levels
  if (!DB.meta.dec20261108) {
    DB.itemPhotos = DB.itemPhotos || {};
    const addU = (id, name, roles, department, reportsTo) => { if (!DB.users.some(u => u.id === id)) DB.users.push({ id, name, roles, email: '', department, reportsTo }); };
    addU('u19', 'Supply Chain Manager', ['Supply Chain Manager'], 'SC', 'u20'); addU('u20', 'Supply Chain VP', ['Supply Chain VP'], 'SC', '');
    addU('u21', 'CLG', ['CLG'], 'EXEC', ''); addU('u22', 'CFO', ['CFO'], 'ACCTG', '');
    const ORG = { u02: ['TECH', 'u03'], u03: ['TECH', ''], u04: ['SC', 'u19'], u05: ['SC', 'u20'], u06: ['SC', 'u19'], u07: ['ACCTG', 'u08'], u08: ['ACCTG', 'u13'], u13: ['ACCTG', 'u22'], u14: ['ACCTG', 'u22'], u15: ['TREAS', 'u16'], u16: ['TREAS', 'u22'], u18: ['ICT', ''] };
    for (const u of DB.users) if (ORG[u.id] && u.department === undefined) [u.department, u.reportsTo] = ORG[u.id];
    const rule = (docType, seq, role, cond, amount, approverType) => ({ id: uid(), docType, seq, role, cond, amount: amount || 0, approverType: approverType || 'Role' });
    if (!DB.approvalRules.some(r => r.docType === 'MR')) DB.approvalRules.push(rule('MR', 10, 'Department Head', 'always', 0, 'Immediate superior'), rule('MR', 20, 'Department Head', 'amountGte', 50000, 'Department head'));
    DB.approvalRules = DB.approvalRules.filter(r => !['PI', 'PO'].includes(r.docType)).concat(
      rule('PI', 10, 'General Accounting Supervisor', 'always'), rule('PI', 20, 'Accounting Manager - Shared Service', 'always'), rule('PI', 30, 'CFO', 'amountGte', 500000),
      rule('PO', 10, 'Supply Chain Manager', 'always'), rule('PO', 20, 'Supply Chain VP', 'always')); // CLG step removed 9 Nov 2026 (owner's request)
    DB.meta.dec20261108 = true; changed = true;
  }
  // Purchase Requisitions are approved by the requester's immediate superior (falls back to the Department Head role)
  if (!DB.meta.dec20261108b) {
    for (const r of DB.approvalRules) if (r.docType === 'PR' && !r.approverType && r.role === 'Department Head') r.approverType = 'Immediate superior';
    DB.meta.dec20261108b = true; changed = true;
  }
  // Sales Contract (NOSPA) approval: President (CPD-HR-001-01 NOSPA approval). Change it under Approval Rules.
  if (!DB.approvalRules.some(r => r.docType === 'NOSPA')) { DB.approvalRules.push({ id: uid(), docType: 'NOSPA', seq: 10, role: 'President', cond: 'always', amount: 0, approverType: 'Role' }); changed = true; }
  if (typeof vaMigrate === 'function' && vaMigrate()) changed = true;
  if (typeof rfqMigrate === 'function' && rfqMigrate()) changed = true;
  if (typeof asrMigrate === 'function' && asrMigrate()) changed = true;
  if (typeof permMigrate === 'function' && permMigrate()) changed = true;
  const NEWDOCS = ['WR', 'PA', 'WS', 'PK', 'RJ', 'FT', 'BREC', 'SO'];
  for (const m of Object.values(DB.md)) {
    if (NEWDOCS.some(t => !(t in m.settings.docSeries))) {
      autoMapSeries(m); for (const t of NEWDOCS) if (!(t in m.settings.docSeries)) m.settings.docSeries[t] = '';
      MD_DIRTY = true; changed = true;
    }
  }
  if (changed) await saveDB();
}
(async function init() {
  try {
    await loadDB();
    await migrate();
    if (!DB.companies.find(c => c.code === S.company)) S.company = DB.companies[0].code;
    renderNav(); navDragInit();
    if (!location.hash) location.hash = '#/home';
    render();
  } catch (e) {
    console.error(e);
    document.body.innerHTML = `<div style="padding:40px;font-family:sans-serif"><h2>Could not start the ERP</h2><pre>${esc(e.stack || e)}</pre></div>`;
  }
})();
