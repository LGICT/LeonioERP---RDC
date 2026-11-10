'use strict';
/* ============ Item description builder and review (your 2025 "Item Description Update" template) ============
   The description is built from parts, in the order of the template formula:
   General Description · Model · Part No. · Characteristics · Dimension + unit · Color · Classification · Brand,
   with at most 100 characters (the item Description field). Model is kept in capitals, empty parts and double spaces
   are dropped, and similar existing items are shown before saving (the same item under several departments).
   The parts are kept per item (DB.itemDesc, keyed by master data set and item no.) so they can be searched and reused.
   Review flow as in the template: Open → For Verification → Reviewed and Closed, or Duplicate / For Deletion.
   Approving writes the new description to the item (several at once, one save). The 2025 workbook can be imported:
   each department sheet's rows are matched to items by their old description. */

const ID_MAJOR = [['CONSUMABLES', 'CON'], ['SPARE PARTS', 'SPR'], ['TOOLS & EQUIPMENT', 'TOE'], ['PPE', 'PPE'], ['OFFICE SUPPLIES', 'OFS'], ['CLEANING MATERIALS', 'CLM'], ['ELECTRICAL SUPPLIES', 'ELE'],
  ['MECHANICAL SUPPLIES', 'MEC'], ['CONSTRUCTION MATERIALS', 'CNS'], ['IT & COMMUNICATION', 'ITC'], ['PANTRY SUPPLIES', 'PTS']];
const ID_CLASS = ['', 'OEM', 'Genuine', 'Second Hand', 'Fabricated'];
const ID_UNITS = ['', 'mm', 'cm', 'm', 'in', 'ft', 'kg', 'g', 'ton', 'L', 'ml', 'gal', 'cu.m', 'sq.m', 'Ah', 'V', 'W', 'HP'];
const ID_STATUS = ['Open', 'For Verification', 'Reviewed and Closed', 'Duplicate', 'For Deletion'];
const ID_PARTS = [['gen', 'General Description *'], ['model', 'Model'], ['partNo', 'Part Number'], ['chars', 'Characteristics'], ['dim', 'Dimension (L x W x H) / thickness / capacity'], ['dimUnit', 'Unit'], ['color', 'Color'], ['cls', 'Classification'], ['brand', 'Brand']];
const ID_MAX = 100;
const idKey = (set, no) => `${set}|${no}`;
const idRec = (no, co) => ((DB.itemDesc || {})[idKey(MDS(co), no)]) || null;
const idClean = s => String(s || '').replace(/\s+/g, ' ').trim();
function idBuild(a) {
  const dim = idClean(a.dim) ? `${idClean(a.dim)}${a.dimUnit ? ' ' + a.dimUnit : ''}` : '';
  return [a.gen, idClean(a.model).toUpperCase(), a.partNo, a.chars, dim, a.color, a.cls, a.brand].map(idClean).filter(Boolean).join(' ');
}
const ID_STOP = new Set(['for', 'and', 'with', 'the', 'of', 'cap', 'pc', 'pcs', 'brand', 'each', 'type', 'size']);
const idTokens = s => new Set(String(s || '').toLowerCase().replace(/(\d)\s*(x)\s*(\d)/g, '$1x$3').replace(/(\d)([a-z]{1,3})\b/g, '$1 $2')
  .split(/[^a-z0-9./x#-]+/).map(t => t.replace(/\.+$/, '')).map(t => /^[a-z]{4,}s$/.test(t) && !/ss$/.test(t) ? t.slice(0, -1) : t)
  .filter(t => (t.length > 1 || /\d/.test(t)) && !ID_STOP.has(t)));
const ID_UNITWORDS = new Set(['in', 'mm', 'cm', 'm', 'ft', 'kg', 'g', 'ton', 'l', 'ml', 'gal', 'ltr', 'ltrs', 'pr', 'ply', 'roll', 'box', 'set', 'pad', 'bx']);
const idWords = s => [...idTokens(s)].filter(t => /^[a-z]+$/.test(t) && !ID_UNITWORDS.has(t));
const idSame = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a)));
/** existing items whose words mostly match (sizes and units ignored; "Envelop" = "Envelope", "Sacks" = "Sack") */
function idSimilar(desc, co, exceptNo, limit = 6) {
  const a = idWords(desc), an = [...idTokens(desc)].filter(t => /\d/.test(t)); if (!a.length) return [];
  return M(co).items.filter(i => i.no !== exceptNo).map(i => {
    const b = idWords(i.description); if (!b.length) return null;
    const n = a.filter(x => b.some(y => idSame(x, y))).length, s = n / Math.min(a.length, b.length);
    const bn = [...idTokens(i.description)].filter(t => /\d/.test(t)), num = an.filter(x => bn.includes(x)).length;
    return { i, s, n, num };
  }).filter(x => x && x.n >= 1 && x.s >= 0.75).sort((x, y) => y.s - x.s || y.num - x.num || y.n - x.n).slice(0, limit).map(x => x.i);
}
// as in the 2025 exercise: departments / requesters fill in the parts; whoever may approve items verifies
const idCanPropose = () => typeof can !== 'function' || can('items', 'create') || can('req', 'create');
const idCanApprove = () => typeof can !== 'function' || can('items', 'approve');

/* ---------- the builder (modal) ---------- */
let ID_B = null; // { mode: 'card' | 'propose', no, co, a }
function idBuilder(mode, no) {
  const co = S.company, it = no ? itemOf(no, co) : null, r = no ? idRec(no, co) : null;
  ID_B = { mode, no, co, a: Object.assign({ major: '', cat: '', gen: '', model: '', partNo: '', chars: '', dim: '', dimUnit: '', color: '', cls: '', brand: '' }, it ? idFromItem(it) : {}, r && r.attr || {}) };
  if (!ID_B.a.gen && it && mode !== 'card-new') ID_B.a.gen = '';
  const cats = [...new Set(Object.values(DB.itemDesc || {}).map(x => (x.attr || {}).cat).filter(Boolean))].sort();
  const inp = (k, l, w, extra = '') => `<label class="fld ${w || ''}"><span>${l}</span><input id="idb_${k}" value="${esc(ID_B.a[k] || '')}" oninput="idChange()" ${extra}></label>`;
  const sel = (k, l, opts, w) => `<label class="fld ${w || ''}"><span>${l}</span><select id="idb_${k}" onchange="idChange()">${optionsHtml(opts, ID_B.a[k] || '', false)}</select></label>`;
  modal(`Description builder${it ? ` – ${it.no}` : ''}`, `${it ? `<p class="small muted" style="margin:0 0 8px">Current description: <b>${esc(it.description)}</b></p>` : ''}
    <div class="form-grid">
      ${sel('major', 'Major category', [['', ''], ...ID_MAJOR.map(([n, c]) => [n, `${n} (${c})`])])}
      ${inp('cat', 'Category', '', 'list="idb_cats" placeholder="e.g. Operations Supply"')}<datalist id="idb_cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      ${inp('gen', 'General Description * (what it is)', 'w2', 'placeholder="e.g. Plastic Bag, Hydraulic Hose, Safety Shoes"')}
      ${inp('model', 'Model (capitals)', '', 'style="text-transform:uppercase"')}${inp('partNo', 'Part Number (if any)')}
      ${inp('chars', 'Characteristics', 'w2', 'placeholder="e.g. Heavy duty, 3-ply, steel toe"')}
      ${inp('dim', 'Dimension: L x W x H / thickness / capacity', '', 'placeholder="e.g. 20 x 40 x .003"')}${sel('dimUnit', 'Unit', ID_UNITS.map(x => [x, x || '—']))}
      ${inp('color', 'Color (if any)')}${sel('cls', 'Classification', ID_CLASS.map(x => [x, x || '—']))}${inp('brand', 'Brand (if any)')}</div>
    <div class="idb-out"><div class="small muted">New description</div><div id="idb_desc" class="idb-desc"></div><div id="idb_len" class="small"></div></div>
    <div id="idb_dup"></div>`, () => idApply(), mode === 'card' ? 'Use this description' : 'Send for verification', true);
  idChange();
}
function idChange() {
  if (!ID_B) return;
  for (const [k] of [['major'], ['cat'], ...ID_PARTS]) { const el = $('#idb_' + k); if (el) ID_B.a[k] = el.value; }
  const d = idBuild(ID_B.a), n = d.length, el = $('#idb_desc'); if (!el) return;
  el.textContent = d || '—';
  $('#idb_len').innerHTML = `<span class="${n > ID_MAX ? 'bad' : ''}">${n} / ${ID_MAX} characters</span>${n > ID_MAX ? ' – shorten the characteristics or the general description' : ''}`;
  const sim = d.length >= 3 ? idSimilar(d, ID_B.co, ID_B.no) : [];
  $('#idb_dup').innerHTML = sim.length ? `<div class="alertbox warn" style="margin-top:10px"><span>⚠</span><div><b>Similar items already exist</b>Check that this is not the same item under another department:<br>${sim.map(i => `<span class="small">${esc(i.no)} – ${esc(i.description)}</span>`).join('<br>')}</div></div>` : '';
}
async function idApply() {
  idChange(); const a = { ...ID_B.a, model: idClean(ID_B.a.model).toUpperCase() }, d = idBuild(a);
  if (!idClean(a.gen)) { toast('Enter the General Description (what the item is).', 'err'); return false; }
  if (d.length > ID_MAX) { toast(`The description has ${d.length} characters; the limit is ${ID_MAX}.`, 'err'); return false; }
  if (ID_B.mode === 'card') {
    const el = $('#m_description'); if (el) el.value = d;
    for (const [k, v] of Object.entries(a)) { const el = $("#m_" + k); if (el) el.value = v; }
    toast('Description filled in. Save the item card to keep it.'); return;
  }
  const ok = await commit(() => {
    if (!idCanPropose()) fail('Your role cannot propose item descriptions (needs Requests or Items: Create).');
    DB.itemDesc = DB.itemDesc || {}; const k = idKey(MDS(ID_B.co), ID_B.no), r = DB.itemDesc[k] = DB.itemDesc[k] || { history: [] };
    Object.assign(r, { attr: a, proposal: d, status: 'For Verification', by: curUser().name, byId: curUser().id, at: new Date().toISOString(), dupOf: '' });
    r.history.push({ at: r.at, by: r.by, action: 'Proposed', text: d });
  }, 'Item description proposed', ID_B.no);
  if (ok === false) return false; toast('Sent for verification.'); render();
}
/* item card: the description parts are real item fields (and list columns, filters, reports);
   when General Description is filled, the Description is generated from them on save */
const ID_FIELDS = [
  { k: 'major', l: 'Major Category', t: 'select', opts: [['', ''], ...ID_MAJOR.map(([n]) => [n, n])] },
  { k: 'gen', l: 'General Description (what it is)' }, { k: 'model', l: 'Model' }, { k: 'partNo', l: 'Part Number' },
  { k: 'chars', l: 'Characteristics', w: 'w2' }, { k: 'dim', l: 'Dimension (L x W x H / thickness / capacity)' },
  { k: 'dimUnit', l: 'Dimension Unit', t: 'select', opts: ID_UNITS.map(x => [x, x]) }, { k: 'color', l: 'Color' },
  { k: 'cls', l: 'Classification', t: 'select', opts: ID_CLASS.map(x => [x, x]) }, { k: 'brand', l: 'Brand' },
  { k: 'lengthCm', l: 'Length (cm)', t: 'number' }, { k: 'widthCm', l: 'Width (cm)', t: 'number' }, { k: 'heightCm', l: 'Height (cm)', t: 'number' },
  { k: 'weightKg', l: 'Weight (kg)', t: 'number' }, { k: 'shelfLifeDays', l: 'Shelf Life (days)', t: 'number' }, { k: 'leadTimeDays', l: 'Lead Time (days)', t: 'number' }];
(() => { const f = MASTERS.items.fields, i = f.findIndex(x => x.k === 'description') + 1; f.splice(i, 0, ...ID_FIELDS);
  MASTERS.items.cols.splice(2, 0, { l: 'Major Category', k: 'major' }, { l: 'Brand', k: 'brand' }, { l: 'Part No.', k: 'partNo' }); })();
const idFromItem = it => Object.fromEntries(['major', 'cat', ...ID_PARTS.map(p => p[0])].map(k => [k, it[k] || '']));
// live preview: typing a part updates the Description box on the item card
document.addEventListener('input', e => idCardSync(e)); document.addEventListener('change', e => idCardSync(e));
function idCardSync(e) {
  if (!e.target || !/^m_(gen|model|partNo|chars|dim|dimUnit|color|cls|brand)$/.test(e.target.id || '')) return;
  const a = {}; for (const [k] of ID_PARTS) a[k] = ($('#m_' + k) || {}).value || '';
  const d = $('#m_description'); if (d && idClean(a.gen)) d.value = idBuild(a);
}
const _saveMaster_id = saveMaster;
saveMaster = async function (coll, key) {
  if (coll === 'items') {
    const a = {}; for (const [k] of ID_PARTS) a[k] = ($('#m_' + k) || {}).value || '';
    if ($('#m_model')) $('#m_model').value = idClean(a.model).toUpperCase();
    if (idClean(a.gen)) {
      const d = idBuild(a); if (d.length > ID_MAX) return toast(`The description has ${d.length} characters; the limit is ${ID_MAX}. Shorten the parts.`, 'err');
      $('#m_description').value = d;
      if (!key) { const sim = idSimilar(d, S.company, ''); if (sim.length && !confirm(`Similar items already exist:\n${sim.map(i => `${i.no} – ${i.description}`).join('\n')}\n\nCreate this item anyway?`)) return; }
    }
  }
  return _saveMaster_id(coll, key);
};

/* ---------- review worklist ---------- */
const IDF = { st: 'For Verification', q: '', cat: '', sel: new Set(), page: 0 };
route('itemdesc', () => {
  const co = S.company, set = MDS(co), items = M(co).items, recs = DB.itemDesc || {};
  const row = i => ({ i, r: recs[idKey(set, i.no)] || null });
  const all = items.map(row), stOf = x => (x.r && x.r.status) || 'Open';
  const counts = Object.fromEntries(ID_STATUS.map(s => [s, all.filter(x => stOf(x) === s).length]));
  const q = IDF.q.toLowerCase();
  const rows = all.filter(x => stOf(x) === IDF.st && (!IDF.cat || x.i.category === IDF.cat) && (!q || `${x.i.no} ${x.i.description} ${(x.r && x.r.proposal) || ''}`.toLowerCase().includes(q)));
  const per = 100, pages = Math.max(1, Math.ceil(rows.length / per)); if (IDF.page >= pages) IDF.page = 0;
  const shown = rows.slice(IDF.page * per, IDF.page * per + per), apr = idCanApprove(), prop = idCanPropose();
  return pageHead('Item Description Review', `Standard item names for <b>${esc(set)}</b>, from your 2025 template: General Description · Model · Part No. · Characteristics · Dimension · Color · Classification · Brand, max ${ID_MAX} characters. Propose a new description, then Supply Chain verifies and approves it.`,
    `${prop ? '<button class="btn" onclick="idImport()">⬆ Import 2025 workbook</button>' : ''}`) +
  `<div class="tiles">${ID_STATUS.map(s => `<a class="tile" href="#/itemdesc" onclick="IDF.st='${s}';IDF.page=0;IDF.sel.clear()" style="${IDF.st === s ? 'outline:2px solid var(--primary)' : ''}"><span>${s}</span><b>${counts[s]}</b><small>${s === 'Open' ? 'not yet reviewed' : s === 'For Verification' ? 'waiting for approval' : s === 'Reviewed and Closed' ? 'standard name in use' : s === 'Duplicate' ? 'same as another item' : 'to be blocked'}</small></a>`).join('')}</div>
  <div class="card"><div class="tbl-tools" style="gap:8px;flex-wrap:wrap"><input class="search" placeholder="Search no. or description…" value="${esc(IDF.q)}" onchange="IDF.q=this.value;IDF.page=0;render()">
    <select onchange="IDF.cat=this.value;IDF.page=0;render()">${optionsHtml([['', 'All item categories'], ...[...new Set(items.map(i => i.category))].sort().map(c => [c, c])], IDF.cat, false)}</select>
    <span class="muted small">${rows.length} item(s)</span>
    ${apr && IDF.st === 'For Verification' && rows.length ? `<span style="flex:1"></span><button class="btn sm" onclick="idSelAll(${JSON.stringify(shown.map(x => x.i.no)).replace(/"/g, '&quot;')})">Select page</button><button class="btn sm primary" onclick="idApprove()">✔ Approve selected (${IDF.sel.size})</button>` : ''}</div>
  ${shown.length ? `<div class="tbl-wrap"><table class="grid compact"><thead><tr>${apr && IDF.st === 'For Verification' ? '<th></th>' : ''}<th>No.</th><th>Category</th><th>Current description</th><th>${IDF.st === 'Open' ? '' : 'New description'}</th><th>By</th><th></th></tr></thead><tbody>
    ${shown.map(({ i, r }) => `<tr>${apr && IDF.st === 'For Verification' ? `<td><input type="checkbox" ${IDF.sel.has(i.no) ? 'checked' : ''} onchange="this.checked?IDF.sel.add('${esc(i.no)}'):IDF.sel.delete('${esc(i.no)}');render()"></td>` : ''}
      <td><a href="#/card/items/${encodeURIComponent(i.no)}">${esc(i.no)}</a></td><td class="small">${esc(i.category || '')}</td><td>${esc(i.description)}</td>
      <td>${r && r.proposal ? `<b>${esc(r.proposal)}</b>` : ''}${r && r.dupOf ? `<div class="small">duplicate of <a href="#/card/items/${encodeURIComponent(r.dupOf)}">${esc(r.dupOf)}</a></div>` : ''}${r && r.note ? `<div class="small muted">${esc(r.note)}</div>` : ''}</td>
      <td class="small">${r ? esc(r.by || '') : ''}</td>
      <td style="white-space:nowrap">${prop && ['Open', 'For Verification'].includes(IDF.st) ? `<button class="btn sm" onclick="idBuilder('propose','${esc(i.no)}')">🧩 ${r && r.proposal ? 'Edit' : 'Build'}</button> ` : ''}${prop && IDF.st !== 'Reviewed and Closed' ? `<button class="btn sm ghost" onclick="idMark('${esc(i.no)}')">Mark…</button>` : ''}${apr && IDF.st === 'For Verification' && r && r.byId !== curUser().id ? ` <button class="btn sm ghost" onclick="idBack('${esc(i.no)}')">Return</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
    ${pages > 1 ? `<div style="display:flex;gap:8px;justify-content:center;margin-top:8px"><button class="btn sm" ${IDF.page ? '' : 'disabled'} onclick="IDF.page--;render()">‹ Prev</button><span class="small muted" style="align-self:center">Page ${IDF.page + 1} of ${pages}</span><button class="btn sm" ${IDF.page < pages - 1 ? '' : 'disabled'} onclick="IDF.page++;render()">Next ›</button></div>` : ''}`
    : '<p class="muted" style="margin:0">No items here.</p>'}</div>
  <p class="small muted">Approving writes the new description to the item card. Anyone who may create items can propose; approving needs the Approve permission for Items (Roles & Permissions), and nobody approves their own proposal.</p>`;
});
function idSelAll(nos) { const all = nos.every(n => IDF.sel.has(n)); nos.forEach(n => all ? IDF.sel.delete(n) : IDF.sel.add(n)); render(); }
async function idApprove() {
  const nos = [...IDF.sel]; if (!nos.length) return toast('Tick the items to approve.', 'err');
  let done = 0, skipped = [];
  const ok = await commit(() => {
    if (!idCanApprove()) fail(permMsg('items', 'approve'));
    const co = S.company, set = MDS(co);
    for (const no of nos) {
      const r = (DB.itemDesc || {})[idKey(set, no)], it = itemOf(no, co);
      if (!r || r.status !== 'For Verification' || !r.proposal || !it) continue;
      if (r.byId === curUser().id) { skipped.push(no); continue; }
      r.history.push({ at: new Date().toISOString(), by: curUser().name, action: 'Approved', text: `${it.description} → ${r.proposal}` });
      r.oldDesc = it.description; it.description = r.proposal; Object.assign(it, Object.fromEntries(Object.entries(r.attr || {}).filter(([k, v]) => v && k !== "cat"))); r.status = 'Reviewed and Closed'; r.approvedBy = curUser().name; r.approvedAt = new Date().toISOString(); r.proposal = ''; done++;
    }
    if (!done) fail(skipped.length ? 'You proposed these yourself, so someone else must approve them.' : 'Nothing to approve.');
  }, `Approved ${nos.length} item description(s)`, nos.slice(0, 10).join(', '), { md: true });
  if (ok !== false) { IDF.sel.clear(); toast(`${done} description(s) approved and written to the items.${skipped.length ? ` ${skipped.length} skipped (your own proposals).` : ''}`); render(); }
}
async function idBack(no) {
  ersAsk(`Return ${no}`, 'Why (what to correct)?', async t => {
    const ok = await commit(() => { if (!idCanApprove()) fail(permMsg('items', 'approve')); const r = DB.itemDesc[idKey(MDS(), no)]; r.status = 'Open'; r.note = `Returned: ${t}`; r.history.push({ at: new Date().toISOString(), by: curUser().name, action: 'Returned', text: t }); }, 'Item description returned', no);
    if (ok !== false) render();
  }, true);
}
function idMark(no) {
  modal(`Mark ${no}`, `<div class="form-grid"><label class="fld"><span>Status</span><select id="idm_st">${optionsHtml(['Duplicate', 'For Deletion', 'Open'].map(x => [x, x]), 'Duplicate', false)}</select></label>
    <label class="fld"><span>Duplicate of item no. (keep this one)</span><input id="idm_dup" placeholder="e.g. ADM0000391"></label><label class="fld w3"><span>Remarks</span><input id="idm_note"></label></div>
    <p class="small muted">Marking does not change the item yet: blocking duplicates and items for deletion is done on the item card once Supply Chain agrees.</p>`, async () => {
    const st = $('#idm_st').value, dup = $('#idm_dup').value.trim().toUpperCase(), note = $('#idm_note').value.trim();
    if (st === 'Duplicate' && !itemOf(dup, S.company)) { toast('Enter the item no. this one duplicates.', 'err'); return false; }
    const ok = await commit(() => { if (!idCanPropose()) fail('Your role cannot propose item descriptions (needs Requests or Items: Create).'); DB.itemDesc = DB.itemDesc || {}; const k = idKey(MDS(), no), r = DB.itemDesc[k] = DB.itemDesc[k] || { history: [] };
      Object.assign(r, { status: st, dupOf: st === 'Duplicate' ? dup : '', note, by: curUser().name, byId: curUser().id, at: new Date().toISOString() }); r.history.push({ at: r.at, by: r.by, action: st, text: [dup, note].filter(Boolean).join(' · ') }); }, `Item marked ${st}`, no);
    if (ok !== false) render(); else return false;
  }, 'Save');
}

/* ---------- import the 2025 workbook (department sheets) ---------- */
let ID_IMP = null;
function idImport() {
  modal('Import the 2025 Item Description Update workbook', `<p class="small">Choose the workbook. Each department sheet with the columns <b>Existing / Old Description</b> and <b>General Description</b> is read; rows are matched to items of <b>${esc(MDS())}</b> by their old description (same words, ignoring capitals and spaces). Matched rows become proposals <b>For Verification</b> (or Duplicate / For Deletion as marked in the file). Nothing on the items changes until a proposal is approved.</p>
    <label class="fld w3"><span>Workbook (.xlsx)</span><input type="file" accept=".xlsx" onchange="idImportRead(this)"></label><div id="id_imp"></div>`, () => idImportDo(), 'Import', true);
}
const idNorm = s => String(s || '').toLowerCase().replace(/[“”"]/g, '"').replace(/['’`]{2}/g, '"').replace(/\s+/g, ' ').trim();
function idParse(sheets, co) {
  const byDesc = new Map(); for (const i of M(co).items) { const k = idNorm(i.description); byDesc.set(k, (byDesc.get(k) || []).concat(i)); }
  const out = [], stats = { sheets: [], rows: 0, matched: 0, many: 0, none: 0 };
  for (const sh of sheets) {
    const rows = sh.rows || [], hi = rows.findIndex((r, i) => i < 5 && r.some(c => /existing.*old description/i.test(c)) && r.some(c => /general description/i.test(c))); if (hi < 0) continue;
    const H = rows[hi], c = re => H.findIndex(x => re.test(x));
    const C = { old: c(/existing.*old/i), dept: c(/^dept/i), major: c(/major category/i), cat: c(/^category/i), gen: c(/general description/i), model: c(/^model/i), partNo: c(/part number/i), chars: c(/characteristic/i), dim: c(/dimension \(/i), dimUnit: c(/dimension unit/i), color: c(/^colou?r/i), cls: c(/classification/i), brand: c(/^brand/i), st: c(/^status/i), by: c(/by whom/i), rem: c(/remarks/i) };
    let n = 0;
    for (const r of rows.slice(hi + 1)) {
      const old = String(r[C.old] || '').trim(), gen = String(r[C.gen] || '').trim(); if (!old || !gen) continue;
      n++; stats.rows++;
      const v = k => C[k] >= 0 ? String(r[C[k]] || '').trim() : '';
      const attr = { major: v('major').toUpperCase(), cat: v('cat'), gen, model: v('model').toUpperCase(), partNo: v('partNo'), chars: v('chars'), dim: v('dim'), dimUnit: v('dimUnit'), color: v('color'), cls: v('cls'), brand: v('brand') };
      const st0 = v('st'), st = /delet/i.test(st0) ? 'For Deletion' : /duplicate/i.test(st0) ? 'Duplicate' : 'For Verification';
      const hits = byDesc.get(idNorm(old)) || [];
      if (!hits.length) { stats.none++; continue; }
      if (hits.length > 1) stats.many++;
      for (const it of hits) { out.push({ no: it.no, cur: it.description, attr, desc: idBuild(attr), st, st0, sheet: sh.name, dept: v('dept'), rem: v('rem') }); stats.matched++; }
    }
    if (n) stats.sheets.push(`${sh.name} (${n})`);
  }
  return { out, stats };
}
async function idImportRead(inp) {
  const f = inp.files && inp.files[0]; if (!f) return;
  $('#id_imp').innerHTML = '<p class="small muted">Reading the workbook… (large files take a little while)</p>';
  let sheets; try { sheets = await readXlsx(await f.arrayBuffer(), nm => !/^(summary|item movement|split|duplicates|wh inventory|from business central|pivot|fm dashboard|for validation|progress|consolidate|categories|drop down)/i.test(nm)); }
  catch (e) { $('#id_imp').innerHTML = ''; return toast('This file cannot be read. Choose the .xlsx workbook.', 'err'); }
  ID_IMP = idParse(sheets, S.company);
  const s = ID_IMP.stats, too = ID_IMP.out.filter(x => x.desc.length > ID_MAX).length;
  $('#id_imp').innerHTML = `<p class="small" style="margin:8px 0">Sheets: ${esc(s.sheets.join(', ') || 'none recognised')}<br><b>${s.rows}</b> rows · <b>${s.matched}</b> item(s) matched · ${s.none} row(s) with no item of that description${s.many ? ` · ${s.many} row(s) matched several items (all get the proposal)` : ''}${too ? ` · <span class="bad">${too} over ${ID_MAX} characters</span>` : ''}</p>
    ${ID_IMP.out.length ? `<div class="tbl-wrap" style="max-height:300px"><table class="grid compact"><thead><tr><th>Item</th><th>Current</th><th>New (from the template)</th><th>Status in file</th></tr></thead><tbody>${ID_IMP.out.slice(0, 60).map(x => `<tr><td>${esc(x.no)}</td><td class="small">${esc(x.cur)}</td><td><b>${esc(x.desc)}</b></td><td class="small">${esc(x.st0 || '')}</td></tr>`).join('')}</tbody></table></div>${ID_IMP.out.length > 60 ? `<p class="small muted">…and ${ID_IMP.out.length - 60} more.</p>` : ''}` : ''}`;
}
async function idImportDo() {
  if (!ID_IMP || !ID_IMP.out.length) { toast('Choose the workbook first (with matched rows).', 'err'); return false; }
  let n = 0;
  const ok = await commit(() => {
    if (!idCanPropose()) fail('Your role cannot propose item descriptions (needs Requests or Items: Create).');
    DB.itemDesc = DB.itemDesc || {}; const set = MDS();
    for (const x of ID_IMP.out) {
      const k = idKey(set, x.no), r = DB.itemDesc[k] = DB.itemDesc[k] || { history: [] };
      if (r.status === 'Reviewed and Closed') continue;
      Object.assign(r, { attr: x.attr, proposal: x.desc.slice(0, ID_MAX), status: x.st, note: `2025 template, ${x.sheet}${x.st0 ? ' – ' + x.st0 : ''}${x.rem ? ' – ' + x.rem : ''}`, by: curUser().name, byId: curUser().id, at: new Date().toISOString(), dupOf: '' });
      r.history.push({ at: r.at, by: r.by, action: 'Imported from the 2025 workbook', text: x.desc }); n++;
    }
  }, 'Imported the 2025 item description workbook', '');
  if (ok === false) return false;
  toast(`${n} proposal(s) imported. Someone other than you approves them under For Verification.`); IDF.st = 'For Verification'; render();
}
