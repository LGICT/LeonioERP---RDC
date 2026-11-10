'use strict';
/* ============ Core utilities, data store, UI helpers, router ============ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (x, n = 2) => String(x).padStart(n, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const addDays = (iso, days) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + (+days || 0)); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const num = v => { const x = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(x) ? x : 0; };
const r2 = x => Math.round((num(x) + Number.EPSILON) * 100) / 100;
const r4 = x => Math.round((num(x) + Number.EPSILON) * 10000) / 10000;
const money = x => num(x).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyf = x => num(x).toLocaleString('en-PH', { maximumFractionDigits: 3 });
const sum = (arr, f) => arr.reduce((s, x) => s + num(typeof f === 'function' ? f(x) : x[f]), 0);
const clone = o => JSON.parse(JSON.stringify(o));
const fail = msg => { throw new Error(msg); };

/* ---------- Session (per browser) ---------- */
const S = {
  get company() { return localStorage.getItem('erp.company') || (DB.companies.find(c => c.code === 'LAMI') || DB.companies[0] || {}).code; }, // LAMI is the pilot company
  set company(v) { localStorage.setItem('erp.company', v); },
  get userId() { return localStorage.getItem('erp.user') || 'u01'; },
  set userId(v) { localStorage.setItem('erp.user', v); }
};
const curUser = () => DB.users.find(u => u.id === S.userId) || DB.users[0];
/* Master data set (one per business unit, like a BC company's setup) */
const MDS = co => (DB.companies.find(c => c.code === (co || S.company)) || {}).md;
const M = co => DB.md[MDS(co)] || emptyMD('(none)');
const hasRole = r => (curUser().roles || []).includes(r);
const isAdmin = () => hasRole('System Admin');
const companyName = c => (DB.companies.find(x => x.code === c) || {}).name || c;

/* ---------- Data store ---------- */
/* Two stores: "db" = transactions & settings (saved on every action), "md" = master data sets
   (chart of accounts, items, vendors, posting setup – large, saved only when masters change). */
let DB = null, serverMode = true, MD_DIRTY = false;
const VER = { db: 0, md: 0 };
const LS_KEY = 'leonio-erp-db';
const VOLATILE = ['settings', 'noSeriesLines', 'bankAccounts', 'fixedAssets']; // small master tables changed by postings
const volSnap = () => JSON.stringify(Object.fromEntries(Object.entries(DB.md || {}).map(([k, m]) => [k, VOLATILE.map(t => m[t])])));
function volRestore(s) { const o = JSON.parse(s); for (const [k, arr] of Object.entries(o)) if (DB.md[k]) VOLATILE.forEach((t, i) => { DB.md[k][t] = arr[i]; }); }
/* The small master tables that postings change (number series, bank cards, fixed-asset status) travel with the
   transaction store, so everyday saves never rewrite the large master-data file. */
const dbOnly = () => { const { md, mdVol, ...rest } = DB; rest.mdVol = Object.fromEntries(Object.entries(md || {}).map(([k, m]) => [k, Object.fromEntries(VOLATILE.map(t => [t, m[t]]))])); return rest; };
function applyVol() { if (!DB.mdVol) return; for (const [k, v] of Object.entries(DB.mdVol)) if (DB.md[k]) for (const t of VOLATILE) if (v[t] !== undefined) DB.md[k][t] = v[t]; delete DB.mdVol; }

async function getStore(name) {
  const r = await fetch('/api/' + name, { cache: 'no-store' });
  if (!r.ok) throw new Error('no server');
  VER[name] = +r.headers.get('X-Version') || 0;
  const t = await r.text();
  return t.trim() ? JSON.parse(t) : null;
}
async function putStore(name, body) {
  const r = await fetch('/api/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Base-Version': String(VER[name]) }, body });
  if (r.status === 409) {
    alert('Another user or browser tab saved changes first. The page will reload with the latest data; please redo your last action.');
    location.reload(); throw new Error('Data conflict - reloading');
  }
  if (!r.ok) throw new Error('Could not save data: ' + (await r.text()));
  VER[name] = +r.headers.get('X-Version') || VER[name] + 1;
}
async function loadDB() {
  let md = null;
  try { DB = await getStore('db'); md = await getStore('md'); }
  catch (e) {
    serverMode = false;
    try { DB = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (_) { DB = null; }
    if (DB) md = DB.md;
  }
  if (!DB) { DB = await buildSeedDB(); MD_DIRTY = true; await saveDB(); return; }
  DB.md = md || DB.md || {};
  applyVol();
  if (!md && serverMode) { MD_DIRTY = true; await saveDB(); }
}
async function saveDB() {
  DB.meta.rev = (DB.meta.rev || 0) + 1; OPT_CACHE.clear();
  if (!serverMode) { localStorage.setItem(LS_KEY, JSON.stringify(DB)); MD_DIRTY = false; return; }
  if (MD_DIRTY) { await putStore('md', JSON.stringify(DB.md)); MD_DIRTY = false; }
  await putStore('db', JSON.stringify(dbOnly()));
}
const markMD = () => { MD_DIRTY = true; };

/** Run a change; roll back if anything fails. opts.md = the change edits master data (full master snapshot). */
async function commitAsync(fn, auditMsg, ref, opts = {}) {
  const snap = JSON.stringify(dbOnly()), vol = volSnap(), mdSnap = opts.md ? JSON.stringify(DB.md) : null;
  try {
    const res = await fn();
    if (opts.md) MD_DIRTY = true;
    if (auditMsg) audit(auditMsg, ref);
    await saveDB();
    return res === undefined ? true : res;
  } catch (e) {
    const md = mdSnap ? JSON.parse(mdSnap) : DB.md;
    DB = JSON.parse(snap); delete DB.mdVol; DB.md = md;
    if (!mdSnap) volRestore(vol);
    OPT_CACHE.clear();
    toast(e.message || String(e), 'err'); console.error(e);
    return false;
  }
}
const commit = (fn, auditMsg, ref, opts) => commitAsync(fn, auditMsg, ref, opts);

function audit(msg, ref) {
  DB.audit.push({ id: uid(), ts: new Date().toISOString(), user: curUser().name, company: S.company, msg, ref: ref || '' });
}

/** Next document number: uses the BC No. Series mapped to the document type, else a simple prefix series */
function incStr(s) {
  const m = String(s).match(/^(.*?)(\d+)(\D*)$/); if (!m) return s + '1';
  const n = String(+m[2] + 1).padStart(m[2].length, '0');
  return m[1] + n + m[3];
}
function nextNo(prefix, company) {
  const md = DB.md && DB.md[MDS(company)];
  const code = md && md.settings.docSeries[prefix];
  const line = code && md.noSeriesLines.find(l => l.series === code);
  if (line && (line.lastUsed || line.startNo)) {
    line.lastUsed = line.lastUsed ? incStr(line.lastUsed) : line.startNo;
    return line.lastUsed;
  }
  DB.meta.seq[prefix] = (DB.meta.seq[prefix] || 0) + 1;
  return `${prefix}-${pad(DB.meta.seq[prefix], 5)}`;
}

/* ---------- Toast & modal ---------- */
function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + type; t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), type === 'err' ? 7000 : 3500);
}

let MODAL_OK = null;
function modal(title, bodyHtml, onOk, okLabel = 'OK', wide = false) {
  MODAL_OK = onOk;
  $('#modal').innerHTML = `<div class="modal-box ${wide ? 'wide' : ''}"><div class="modal-head"><h3>${esc(title)}</h3><button class="x" onclick="closeModal()">×</button></div>
    <div class="modal-body">${bodyHtml}</div>
    <div class="modal-foot"><button class="btn ghost" onclick="closeModal()">Cancel</button>${onOk ? `<button class="btn primary" onclick="modalOk()">${esc(okLabel)}</button>` : ''}</div></div>`;
  $('#modal').classList.add('open');
  const first = $('#modal input, #modal select, #modal textarea'); if (first) first.focus();
}
async function modalOk() { if (!MODAL_OK) return closeModal(); const r = await MODAL_OK($('#modal')); if (r !== false) closeModal(); }
function closeModal() { $('#modal').classList.remove('open'); $('#modal').innerHTML = ''; MODAL_OK = null; }

/* ---------- Reference lookups ---------- */
const STATUS_USABLE = r => !r.status || r.status === 'Approved' || r.status === 'Active';
const OPT_CACHE = new Map();
function refOptions(ref, opts = {}) {
  const co = opts.company || S.company;
  const ck = ref + '|' + co + '|' + (DB.meta.rev || 0);
  if (OPT_CACHE.has(ck)) return OPT_CACHE.get(ck);
  const m = M(co), cd = (r, d) => [r.code, d ? `${r.code} – ${d}` : r.code];
  let o;
  if (ref.startsWith('dim:')) { const dim = ref.slice(4); o = m.dimValues.filter(v => v.dim === dim && (!v.type || /standard/i.test(v.type))).map(v => cd(v, v.name)); }
  else if (ref.startsWith('bins:')) { const loc = ref.slice(5); o = m.bins.filter(b => b.location === loc).map(b => cd(b, b.description)); }
  else switch (ref) {
    case 'companies': o = DB.companies.map(c => [c.code, `${c.code} – ${c.name}`]); break;
    case 'locations': o = m.locations.filter(l => !l.inTransit).map(l => cd(l, l.name)); break;
    case 'transitLocations': o = m.locations.filter(l => l.inTransit).map(l => cd(l, l.name)); break;
    case 'accounts': o = m.accounts.filter(a => a.type === 'Posting' && !a.blocked).map(a => [a.no, `${a.no} – ${a.name}`]); break;
    case 'items': o = m.items.filter(STATUS_USABLE).map(i => [i.no, `${i.no} – ${i.description}`]); break;
    case 'invItems': o = m.items.filter(i => STATUS_USABLE(i) && i.type === 'Inventory').map(i => [i.no, `${i.no} – ${i.description}`]); break;
    case 'itemCharges': o = m.itemCharges.map(i => [i.no, `${i.no} – ${i.description}`]); break;
    case 'vendors': o = m.vendors.filter(STATUS_USABLE).map(v => [v.no, `${v.no} – ${v.name}`]); break;
    case 'customers': o = m.customers.filter(STATUS_USABLE).map(v => [v.no, `${v.no} – ${v.name}`]); break;
    case 'bankAccounts': o = m.bankAccounts.filter(b => !b.company || b.company === co).map(b => cd(b, b.name)); break;
    case 'fixedAssets': o = m.fixedAssets.filter(f => (!f.company || f.company === co) && f.status !== 'Disposed').map(f => [f.no, `${f.no} – ${f.description}`]); break;
    case 'dimensions': o = m.dimensions.map(d => cd(d, d.name)); break;
    case 'users': o = DB.users.map(u => [u.id, u.name]); break;
    case 'roles': o = ROLES.map(r => [r, r]); break;
    default: o = (m[ref] || []).map(r => cd(r, r.description || r.name));
  }
  OPT_CACHE.set(ck, o);
  return o;
}
const lookupName = (ref, key) => { const o = refOptions(ref).find(x => x[0] === key); return o ? o[1] : key; };
const accOf = (no, co) => M(co).accounts.find(a => a.no === no);
const accName = (no, co) => (accOf(no, co) || {}).name || no;
const itemOf = (no, co) => M(co).items.find(i => i.no === no);
const vendorOf = (no, co) => M(co).vendors.find(v => v.no === no);
const customerOf = (no, co) => M(co).customers.find(v => v.no === no);
const faOf = (no, co) => M(co).fixedAssets.find(f => f.no === no);
const partyName = (kind, no, co) => kind === 'vendor' ? (vendorOf(no, co) || {}).name || no : kind === 'customer' ? (customerOf(no, co) || {}).name || no : no;

/* Big lists (thousands of items/vendors) use a type-ahead box instead of a dropdown */
const BIG_LIST = 150;
const HUGE_LIST = 1500; // above this, the suggestion list is filled with the best matches as you type
const dlOpts = list => list.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
function dataListId(ref) {
  const id = 'dl-' + ref.replace(/[^\w]/g, '_');
  if (!document.getElementById(id)) {
    const dl = document.createElement('datalist'); dl.id = id;
    const opts = refOptions(ref);
    dl.innerHTML = dlOpts(opts.length > HUGE_LIST ? opts.slice(0, 50) : opts);
    $('#dls').appendChild(dl);
  }
  return id;
}
function dlFill(inp, ref) {
  const q = inp.value.trim().toLowerCase(); if (!q) return;
  const words = q.split(/\s+/), out = [];
  for (const o of refOptions(ref)) { const s = o[1].toLowerCase(); if (words.every(w => s.includes(w))) { out.push(o); if (out.length >= 50) break; } }
  document.getElementById(dataListId(ref)).innerHTML = dlOpts(out);
}
function pickHtml(id, ref, val, attrs = '') {
  const opts = refOptions(ref);
  if (opts.length > BIG_LIST) return `<input type="text" ${id ? `id="${id}"` : ''} list="${dataListId(ref)}" value="${esc(val ?? '')}" placeholder="type no. or name to search…" ${opts.length > HUGE_LIST ? `oninput="dlFill(this,'${ref}')"` : ''} ${attrs}>`;
  return `<select ${id ? `id="${id}"` : ''} ${attrs}>${optionsHtml(opts, val)}</select>`;
}

/* ---------- Form fields ---------- */
function optionsHtml(opts, val, blank = true) {
  return (blank ? '<option value=""></option>' : '') + opts.map(o => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return `<option value="${esc(v)}" ${String(v) === String(val ?? '') ? 'selected' : ''}>${esc(l)}</option>`;
  }).join('');
}
function fieldHtml(f, val, prefix = 'f', ro = false) {
  const id = `${prefix}_${f.k}`;
  const dis = (ro || f.ro) ? 'disabled' : '';
  let input;
  switch (f.t) {
    case 'select': input = `<select id="${id}" ${dis} ${f.onchange ? `onchange="${f.onchange}"` : ''}>${optionsHtml(f.opts, val, !f.noBlank)}</select>`; break;
    case 'ref': input = pickHtml(id, f.ref, val, `${dis} ${f.onchange ? `onchange="${f.onchange}"` : ''}`); break;
    case 'check': input = `<input type="checkbox" id="${id}" ${val ? 'checked' : ''} ${dis}>`; break;
    case 'multi': input = `<div class="multi" id="${id}">${f.opts.map(o => `<label><input type="checkbox" value="${esc(o)}" ${(val || []).includes(o) ? 'checked' : ''} ${dis}> ${esc(o)}</label>`).join('')}</div>`; break;
    case 'textarea': input = `<textarea id="${id}" rows="2" ${dis}>${esc(val)}</textarea>`; break;
    case 'number': input = `<input type="number" step="any" id="${id}" value="${esc(val ?? '')}" ${dis}>`; break;
    case 'date': input = `<input type="date" id="${id}" value="${esc(val ?? '')}" ${dis}>`; break;
    default: input = `<input type="text" id="${id}" value="${esc(val ?? '')}" ${dis} ${f.ph ? `placeholder="${esc(f.ph)}"` : ''}>`;
  }
  return `<label class="fld ${f.w || ''} ${f.t === 'check' ? 'chk' : ''}"><span>${esc(f.l)}${f.req ? ' <b class="req">*</b>' : ''}</span>${input}</label>`;
}
function readForm(fields, prefix = 'f') {
  const o = {};
  for (const f of fields) {
    const el = document.getElementById(`${prefix}_${f.k}`);
    if (!el || f.ro) continue;
    if (f.t === 'check') o[f.k] = el.checked;
    else if (f.t === 'multi') o[f.k] = $$('input:checked', el).map(x => x.value);
    else if (f.t === 'number') o[f.k] = num(el.value);
    else o[f.k] = el.value.trim();
  }
  return o;
}
function requireFields(fields, obj) {
  for (const f of fields) if (f.req && (obj[f.k] === '' || obj[f.k] == null)) fail(`Please fill in "${f.l}".`);
}

/* ---------- Data tables with search + CSV export ---------- */
const TABLES = {};
function cellVal(c, r) { return c.v ? c.v(r) : r[c.k]; }
function cellFmt(c, r) {
  const v = cellVal(c, r);
  if (c.f === 'money') return v === '' || v == null ? '' : money(v);
  if (c.f === 'qty') return v === '' || v == null ? '' : qtyf(v);
  return v ?? '';
}
function dataTable(id, cols, rows, opts = {}) {
  TABLES[id] = { cols, rows, title: opts.title || id };
  const isNum = c => c.f === 'money' || c.f === 'qty' || c.num;
  const head = cols.map(c => `<th class="${isNum(c) ? 'num' : ''}">${esc(c.l)}</th>`).join('');
  const body = rows.length ? rows.map(r => {
    const link = opts.link ? opts.link(r) : null;
    return `<tr ${link ? `class="link" onclick="location.hash='${link}'"` : ''}>${cols.map(c =>
      `<td class="${isNum(c) ? 'num' : ''}">${c.html ? c.html(r) : esc(cellFmt(c, r))}</td>`).join('')}</tr>`;
  }).join('') : `<tr><td colspan="${cols.length}" class="empty">No records found.</td></tr>`;
  return `<div class="tbl-tools">${opts.search === false ? '<span></span>' : `<input class="search" placeholder="Search…" oninput="filterTable(this,'${id}')">`}
    <span class="muted small">${rows.length} record(s)</span><button class="btn sm ghost" onclick="exportCSV('${id}')">⬇ Export to Excel (CSV)</button></div>
    <div class="tbl-wrap"><table class="grid" id="t-${id}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${opts.foot ? `<tfoot>${opts.foot}</tfoot>` : ''}</table></div>`;
}
function filterTable(inp, id) {
  const q = inp.value.toLowerCase();
  $$(`#t-${id} tbody tr`).forEach(tr => { tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none'; });
}
function exportCSV(id) {
  const t = TABLES[id]; if (!t) return;
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [t.cols.map(c => q(c.l)).join(',')].concat(t.rows.map(r => t.cols.map(c => {
    const v = cellVal(c, r); return q(c.f === 'money' ? r2(v) : v);
  }).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `${t.title.replace(/[^\w-]+/g, '_')}_${today()}.csv`; a.click();
}

const badge = s => `<span class="badge s-${String(s || '').replace(/[^a-z]/gi, '').toLowerCase()}">${esc(s)}</span>`;

/* ---------- Router ---------- */
const ROUTES = {};
function route(name, fn) { ROUTES[name] = fn; }
function go(hash) { location.hash = hash; }
function render() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, ...args] = h.split('/').map(decodeURIComponent);
  const fn = ROUTES[name || 'home'] || ROUTES.home;
  let html;
  try { html = fn(...args); } catch (e) { console.error(e); html = `<div class="card err">Error: ${esc(e.message)}</div>`; }
  $('#dls').innerHTML = '';
  $('#main').innerHTML = html;
  $('#main').scrollTop = 0;
  $$('#nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#/' + h || ('#/' + h).startsWith(a.getAttribute('href') + '/')));
  renderTopbar();
  if (typeof AFTER === 'function') { const f = AFTER; AFTER = null; f(); }
}
let AFTER = null;
window.addEventListener('hashchange', render);

function pageHead(title, sub = '', actions = '') {
  return `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}</div><div class="actions">${actions}</div></div>`;
}
