'use strict';
/* ============ Number series for master data (vendors, customers, items, fixed assets, employees, bank accounts) ============
   As in BC (Purchases & Payables "Vendor Nos.", Sales & Receivables "Customer Nos.", Inventory Setup "Item Nos." …):
   each master has a default series (Settings → Number series for master data), and a new card can use another
   series of the same kind (e.g. Customer-Domestic or Customer-Foreign; for items the series matching the item
   category is chosen automatically). If No. is left blank it is assigned on save. Because the exported series have
   no "last no. used", the next number is the highest number already in use in that series + 1 (never reused).
   A number typed by hand is kept (manual numbers allowed), but must not exist yet. */

const MSERIES = {
  vendors: { l: 'Vendor Nos.', key: 'no', re: /vend|supplier/i, pref: ['VEND'] },
  customers: { l: 'Customer Nos.', key: 'no', re: /cust/i, pref: ['CUST', 'CUSTD'] },
  items: { l: 'Item Nos.', key: 'no', re: /^items?\b/i, pref: ['ITEM'] },
  fixedAssets: { l: 'Fixed Asset Nos.', key: 'no', re: /^fixed asset$/i, pref: ['FA'] },
  employees: { l: 'Employee Nos.', key: 'no', re: /^employee/i, pref: ['EMP'] },
  bankAccounts: { l: 'Bank Account Nos.', key: 'code', re: /^bank$/i, pref: ['BANK'] }
};
const msLine = (co, code) => M(co).noSeriesLines.find(l => l.series === code && (l.startNo || l.lastUsed));
const msPattern = (co, code) => { const l = msLine(co, code); if (!l) return null; const s = l.startNo || l.lastUsed, m = String(s).match(/^(.*?)(\d+)$/); return m ? { prefix: m[1], width: m[2].length, start: +m[2], line: l } : null; };
/** series that fit this master (by description), usable ones first */
function msList(coll, co) {
  const d = MSERIES[coll]; if (!d) return [];
  return M(co).noSeries.filter(n => d.re.test(n.description || '') && !/journal|reclass/i.test(n.description || '')).map(n => ({ code: n.code, desc: n.description, p: msPattern(co, n.code) }));
}
const msUse = (coll, co, p, rows) => { const key = MSERIES[coll].key; return (rows || M(co)[coll] || []).filter(r => { const s = String(r[key] || ''); return s.startsWith(p.prefix) && s.length === p.prefix.length + p.width && /^\d+$/.test(s.slice(p.prefix.length)); }).length; };
function msDefault(coll, co) {
  const set = (M(co).settings.masterSeries || {})[coll]; if (set) return set;
  const list = msList(coll, co).filter(x => x.p), d = MSERIES[coll];
  // the series your existing records use most; else the standard code (VEND, CUST …)
  const best = list.map(x => ({ x, n: msUse(coll, co, x.p) })).sort((a, b) => b.n - a.n)[0];
  return (best && best.n ? best.x : (list.find(x => d.pref.includes(x.code)) || list[0]) || {}).code || '';
}
/** the next free number in a series (peek = do not reserve) */
function msNext(coll, code, co) {
  const p = msPattern(co, code); if (!p) return '';
  const key = MSERIES[coll].key, re = new RegExp('^' + p.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d{' + p.width + '})$');
  let max = p.start - 1;
  for (const r of M(co)[coll] || []) { const m = String(r[key] || '').match(re); if (m) max = Math.max(max, +m[1]); }
  const lu = String(p.line.lastUsed || '').match(re); if (lu) max = Math.max(max, +lu[1]);
  return p.prefix + String(max + 1).padStart(p.width, '0');
}
function msReserve(coll, code, no, co) { const p = msPattern(co, code); if (p && String(no).startsWith(p.prefix)) p.line.lastUsed = no; }
/** item category → the item series with the same prefix (SPP → SPP…), else the default */
function msForCategory(cat, co) {
  if (!cat) return msDefault('items', co);
  const list = msList('items', co).filter(x => x.p), same = M(co).items.filter(i => i.category === cat);
  // the series most used by items already in this category (e.g. category LAB → LAB0000…)
  const best = list.map(x => ({ x, n: msUse('items', co, x.p, same) })).sort((a, b) => b.n - a.n)[0];
  if (best && best.n) return best.x.code;
  const hit = list.find(x => x.p.prefix.replace(/[-_]$/, '').toUpperCase() === String(cat).toUpperCase());
  return hit ? hit.code : msDefault('items', co);
}

/* ---------- new cards: a No. Series choice and the next number ---------- */
const MS_PICK = {}; // coll → chosen series for the card being created
function msBox(coll, co) {
  const list = msList(coll, co).filter(x => x.p); if (!list.length) return '';
  const cur = MS_PICK[coll] || msDefault(coll, co);
  return `<div class="card ms-box"><div class="form-grid"><label class="fld w2"><span>No. Series</span><select id="ms_series" onchange="MS_PICK['${coll}']=this.value;msShow('${coll}')">${optionsHtml(list.map(x => [x.code, `${x.code} – ${x.desc} (${x.p.prefix}${'#'.repeat(x.p.width)})`]), cur, false)}</select></label>
    <div class="fld"><span>Next No.</span><div id="ms_next" style="font-weight:700;padding:7px 0">${esc(msNext(coll, cur, co))}</div></div></div>
    <p class="small muted" style="margin:6px 0 0">Leave <b>No.</b> blank and it is assigned from this series when you save. You may also type a number yourself.</p></div>`;
}
function msShow(coll) { const el = $('#ms_next'), s = $('#ms_series'); if (el && s) el.textContent = msNext(coll, s.value, S.company); const no = $('#m_no') || $('#m_code'); if (no && !no.value) no.placeholder = `(assigned on save: ${el ? el.textContent : ''})`; }
const _routeCard_ms = ROUTES.card;
ROUTES.card = (coll, key) => {
  let html = _routeCard_ms(coll, key);
  if (!MSERIES[coll] || key !== 'new' || typeof html !== 'string') return html;
  MS_PICK[coll] = coll === 'items' ? msDefault('items', S.company) : (MS_PICK[coll] || msDefault(coll, S.company));
  const box = msBox(coll, S.company); if (!box) return html;
  html = html.replace('<div class="card"><div class="form-grid">', box + '<div class="card"><div class="form-grid">');
  setTimeout(() => {
    msShow(coll);
    if (coll === 'items') { const c = $('#m_category'); if (c) c.addEventListener('change', () => { const s = msForCategory(c.value, S.company); MS_PICK.items = s; const sel = $('#ms_series'); if (sel) sel.value = s; msShow('items'); }); }
  }, 0);
  return html;
};
// make the No. field optional on new cards with a series (it is filled before saving)
for (const coll of Object.keys(MSERIES)) { const def = MASTERS[coll]; if (!def) continue; const f = (def.fields || []).find(x => x.k === def.key.split(',')[0]); if (f) f.reqIfNoSeries = true; }
const _saveMaster_ms = saveMaster;
saveMaster = async function (coll, key) {
  let reserved = null;
  if (MSERIES[coll] && !key) {
    const k = MSERIES[coll].key, el = $('#m_' + k), sel = $('#ms_series');
    if (el && !el.value.trim() && sel && sel.value) { const no = msNext(coll, sel.value, S.company); if (no) { el.value = no; reserved = { code: sel.value, no }; } }
  }
  const res = await _saveMaster_ms(coll, key);
  const saved = reserved && (M()[coll] || []).some(r => r[MSERIES[coll].key] === reserved.no);
  if (saved) { await commit(() => msReserve(coll, reserved.code, reserved.no, S.company), ''); toast(`${MASTERS[coll].single} ${reserved.no} created.`); }
  else if (reserved) { const el = $('#m_' + MSERIES[coll].key); if (el) el.value = ''; }
  return res;
};
/* fixed assets have their own card */
const _routeFa_ms = ROUTES.facard;
ROUTES.facard = no => {
  let html = _routeFa_ms(no); if (no !== 'new' || typeof html !== 'string') return html;
  const box = msBox('fixedAssets', S.company); if (!box) return html;
  setTimeout(() => msShow('fixedAssets'), 0);
  return html.replace('<div class="card"><div class="form-grid">', box + '<div class="card"><div class="form-grid">');
};
const _saveFA_ms = saveFA;
saveFA = async function (no) {
  let reserved = null;
  if (!no) { const el = $('#m_no'), sel = $('#ms_series'); if (el && !el.value.trim() && sel && sel.value) { const n = msNext('fixedAssets', sel.value, S.company); if (n) { el.value = n; reserved = { code: sel.value, no: n }; } } }
  const res = await _saveFA_ms(no);
  if (reserved && M().fixedAssets.some(f => f.no === reserved.no)) await commit(() => msReserve('fixedAssets', reserved.code, reserved.no, S.company), '');
  return res;
};

/* ---------- Settings: default series per master ---------- */
const _routeSettings_ms = ROUTES.settings;
ROUTES.settings = (...a) => {
  const html = _routeSettings_ms(...a); if (typeof html !== 'string') return html;
  const co = S.company, ed = isAdmin() || (typeof can === 'function' && can('setup', 'create'));
  const rows = Object.entries(MSERIES).map(([coll, d]) => { const list = msList(coll, co), cur = msDefault(coll, co);
    return `<tr><td><b>${esc(d.l)}</b><div class="small muted">${esc(MASTERS[coll] ? MASTERS[coll].title : coll)}</div></td>
      <td>${list.length ? `<select id="mss_${coll}" ${ed ? '' : 'disabled'}>${optionsHtml([['', '— none (type the No. by hand) —'], ...list.map(x => [x.code, `${x.code} – ${x.desc}${x.p ? '' : ' (no number range)'}`])], cur, false)}</select>` : '<span class="muted small">no series of this kind in your setup</span>'}</td>
      <td class="small">${cur && msPattern(co, cur) ? esc(msNext(coll, cur, co)) : '—'}</td><td class="small muted">${list.filter(x => x.p).length > 1 ? `${list.filter(x => x.p).length} series to choose from on the card` : ''}</td></tr>`; }).join('');
  const box = `<div class="card"><h3>Number series for master data – Master Data Set ${esc(MDS())}</h3><p class="muted small">New vendors, customers, items, fixed assets, employees and bank accounts get their No. from these series (another series of the same kind can be chosen on the new card; items follow their category). The next number continues after the highest number already in use.</p>
    <div class="tbl-wrap"><table class="grid compact"><thead><tr><th>Master</th><th>Default series</th><th>Next No.</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    ${ed ? '<button class="btn primary" style="margin-top:8px" onclick="msSave()">Save master series</button>' : ''}</div>`;
  return html.replace('<div class="card"><h3>Backup & restore</h3>', box + '<div class="card"><h3>Backup & restore</h3>');
};
async function msSave() {
  const ok = await commit(() => { const m = M(); m.settings.masterSeries = m.settings.masterSeries || {}; for (const coll of Object.keys(MSERIES)) { const el = $('#mss_' + coll); if (el) m.settings.masterSeries[coll] = el.value; } }, 'Updated master data number series', MDS());
  if (ok !== false) { toast('Master data number series saved.'); render(); }
}
