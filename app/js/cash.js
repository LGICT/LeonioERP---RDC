'use strict';
/* ============ Bank statement import and the daily Cash Position (decisions 23–24, gaps 30 and 35) ============
   Bank statement import: upload the bank's CSV or Excel statement for one bank account. The columns are recognised
   from the header (date, description, reference / check no., debit and credit or a signed amount, running balance);
   the mapping can be corrected and is remembered per bank account (BC: Bank Statement File Setup; default date
   format mm/dd/yyyy as in CPD-TRY-003-01). Lines already imported are skipped. Each line is matched automatically
   with the open Bank Account Ledger entries: by check no., by a reference that names the ERP document, or by amount
   within a few days. What is left can be matched by hand (one bank line to several ERP entries), or turned into a
   draft Cash Receipt Journal (unidentified deposit), or a draft General Journal for bank charges or interest.
   "Create Bank Reconciliation" then fills a Bank Acc. Reconciliation with the matched entries, to be posted as usual.
   Daily Cash Position: per bank account the book balance at the start of the day, receipts, disbursements and the
   ending balance; what has not cleared the bank yet; the latest bank statement balance; the next days' payments and
   collections; and a daily submission that the Treasury Manager reviews. Replaces the Excel Cash Position Report. */

const BK_ACC_DEFAULT = { LAND: { charges: '7110010', interest: '4121010' }, MINING: { charges: '8130020', interest: '8110050' }, TANK: { charges: '7110010', interest: '7100010' } };
const bkCfg = () => Object.assign({ dateTol: 5, horizon: 7 }, DB.settings.bankImport || {});
const bkAcc = (co, k) => ((((DB.settings.bankImport || {}).acc || {})[MDS(co)]) || {})[k] || (BK_ACC_DEFAULT[MDS(co)] || {})[k] || '';
const bkStmts = co => (DB.bankStmts || []).filter(s => !co || s.company === co);
const bkBanks = co => M(co).bankAccounts.filter(b => !b.company || b.company === co);
const bkUsed = (exceptLine) => { const u = new Set(); for (const s of DB.bankStmts || []) for (const l of s.lines) if (l !== exceptLine) for (const id of l.entryIds || []) u.add(id); return u; };
const bkOpenLines = co => bkStmts(co).flatMap(s => s.lines.filter(l => !(l.entryIds || []).length).map(l => ({ s, l })));
const bkBadgeCount = () => canTreasury() ? bkOpenLines(S.company).length : 0;
const bkDigits = s => String(s || '').replace(/\D/g, '').replace(/^0+/, '');
const bkSame = (a, b) => Math.abs(num(a) - num(b)) < 0.005;

/* ---------- reading the file ---------- */
function bkCSV(text) {
  const first = text.split(/\r?\n/).slice(0, 15).join('\n'), cnt = c => first.split(c).length - 1;
  const sep = [',', ';', '\t', '|'].sort((a, b) => cnt(b) - cnt(a))[0];
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.map(r => r.map(c => String(c).trim())).filter(r => r.some(Boolean));
}
const BK_MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function bkDate(v, fmt) {
  if (v == null || v === '') return '';
  const s = String(v).trim();
  if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(s)) { const n = Math.floor(num(v)); if (n > 20000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10); }
  const ok = (y, mo, d) => (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) ? `${y}-${pad(mo)}-${pad(d)}` : '';
  let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/); if (m) return ok(m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/); if (m) { let y = +m[3]; if (y < 100) y += 2000; return fmt === 'DMY' ? ok(y, +m[2], +m[1]) : ok(y, +m[1], +m[2]); }
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s,]+(\d{2,4})/); if (m && BK_MON[m[2].toLowerCase()]) { let y = +m[3]; if (y < 100) y += 2000; return ok(y, BK_MON[m[2].toLowerCase()], +m[1]); }
  m = s.match(/^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/); if (m && BK_MON[m[1].toLowerCase()]) return ok(m[3], BK_MON[m[1].toLowerCase()], +m[2]);
  return '';
}
function bkAmt(v) {
  if (v == null || v === '') return 0; if (typeof v === 'number') return v;
  const s = String(v).trim(), neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /-\s*$/.test(s) || /\bDR\b/i.test(s);
  const n = parseFloat(s.replace(/[^0-9.]/g, '')) || 0; return neg ? -n : n;
}
function bkGuess(rows) {
  const h = rows.findIndex((r, i) => i < 25 && r.some(c => /date/i.test(c)) && r.some(c => /amount|debit|credit|withdraw|deposit/i.test(c)));
  const H = h >= 0 ? rows[h].map(c => String(c).toLowerCase()) : [];
  const f = (...res) => { for (const re of res) { const i = H.findIndex(c => re.test(c)); if (i >= 0) return i; } return -1; };
  const g = { head: h, date: f(/transaction date|txn date|trans\.? date|posting date|post date/, /^date$/, /date/), desc: f(/description|particular|narration|details|remarks|transaction type/),
    ref: f(/check|cheque|chk/, /reference|ref\.? ?no|document|serial|trace/), debit: f(/debit|withdraw|^dr\b/), credit: f(/credit|deposit|^cr\b/), amt: f(/^amount|amount$/), bal: f(/balance/), fmt: 'MDY', flip: false };
  if (g.desc === g.date) g.desc = -1;
  g.mode = g.debit >= 0 && g.credit >= 0 ? 'split' : 'single';
  if (g.date >= 0) { const vals = rows.slice(h + 1, h + 40).map(r => String(r[g.date] || '')).filter(x => /^\d{1,2}[-\/.]\d{1,2}[-\/.]/.test(x)); if (vals.some(x => +x.split(/[-\/.]/)[0] > 12)) g.fmt = 'DMY'; }
  return g;
}
function bkLines(rows, m) {
  const out = [];
  for (const r of rows.slice(m.head + 1)) {
    const date = bkDate(r[m.date], m.fmt); if (!date) continue;
    let amount = m.mode === 'split' ? Math.abs(bkAmt(r[m.credit])) - Math.abs(bkAmt(r[m.debit])) : bkAmt(r[m.amt]);
    if (m.flip) amount = -amount; amount = r2(amount); if (!amount) continue;
    out.push({ date, desc: m.desc >= 0 ? String(r[m.desc] || '') : '', ref: m.ref >= 0 ? String(r[m.ref] || '') : '', amount, balance: m.bal >= 0 && String(r[m.bal] ?? '') !== '' ? r2(bkAmt(r[m.bal])) : null });
  }
  return out;
}
const bkKey = l => [l.date, r2(l.amount), String(l.ref).trim().toLowerCase(), String(l.desc).trim().toLowerCase().replace(/\s+/g, ' ')].join('|');

/* ---------- import screen ---------- */
let BK_TMP = null;
function bkImport(bank) {
  if (!canTreasury()) return toast('Only Treasury can import bank statements.', 'err');
  const co = S.company, banks = bkBanks(co);
  if (!banks.length) return toast(`${companyName(co)} has no bank accounts.`, 'err');
  BK_TMP = { bank: bank || banks[0].code, rows: null, map: null, file: '' };
  modal('Import bank statement', `<div class="form-grid"><label class="fld w2"><span>Bank account *</span><select id="bk_bank" onchange="BK_TMP.bank=this.value;if(BK_TMP.rows)bkMapForm()">${optionsHtml(banks.map(b => [b.code, `${b.code} – ${b.name}${b.currency ? ' (' + b.currency + ')' : ''}`]), BK_TMP.bank, false)}</select></label>
    <label class="fld"><span>Statement file (CSV or Excel) *</span><input type="file" id="bk_file" accept=".csv,.txt,.xlsx" onchange="bkRead(this)"></label></div>
    <div id="bk_map"><p class="small muted">Download the statement from the bank's online banking as CSV or Excel and choose it here. The columns are recognised automatically; you can correct them once and the ERP remembers them for this bank account.</p></div>`, () => bkDoImport(), 'Import', true);
}
async function bkRead(inp) {
  const f = inp.files && inp.files[0]; if (!f) return;
  try {
    if (/\.xlsx$/i.test(f.name)) { const sh = await readXlsx(await f.arrayBuffer()); BK_TMP.rows = ((sh[0] || {}).rows || []).map(r => r.map(c => c == null ? '' : c)); }
    else BK_TMP.rows = bkCSV(await f.text());
  } catch (e) { return toast('This file cannot be read. Use the CSV or Excel (.xlsx) statement from the bank.', 'err'); }
  BK_TMP.file = f.name; bkMapForm();
}
function bkMapForm() {
  const rows = BK_TMP.rows, saved = (DB.bankFormats || {})[`${S.company}|${BK_TMP.bank}`];
  BK_TMP.map = Object.assign(bkGuess(rows), saved && saved.width === Math.max(...rows.slice(0, 30).map(r => r.length)) ? saved.map : {});
  const m = BK_TMP.map, width = Math.max(...rows.slice(0, 40).map(r => r.length)), H = m.head >= 0 ? rows[m.head] : [];
  const colOpts = [[-1, '— none —'], ...Array.from({ length: width }, (_, i) => [i, `${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}: ${String(H[i] ?? '').slice(0, 28)}`])];
  const sel = (k, l) => `<label class="fld"><span>${l}</span><select data-k="${k}" onchange="bkMapSet(this)">${optionsHtml(colOpts, m[k], false)}</select></label>`;
  $('#bk_map').innerHTML = `<div class="form-grid" style="margin-top:6px">
    <label class="fld"><span>Header row</span><select data-k="head" onchange="bkMapSet(this)">${optionsHtml([[-1, 'No header'], ...rows.slice(0, 25).map((r, i) => [i, `Row ${i + 1}: ${r.filter(Boolean).slice(0, 3).join(' | ').slice(0, 40)}`])], m.head, false)}</select></label>
    ${sel('date', 'Date *')}<label class="fld"><span>Date format</span><select data-k="fmt" onchange="bkMapSet(this)">${optionsHtml([['MDY', 'mm/dd/yyyy'], ['DMY', 'dd/mm/yyyy']], m.fmt, false)}</select></label>
    ${sel('desc', 'Description')}${sel('ref', 'Reference / check no.')}
    <label class="fld"><span>Amounts</span><select data-k="mode" onchange="bkMapSet(this)">${optionsHtml([['split', 'Debit and credit columns'], ['single', 'One signed amount column']], m.mode, false)}</select></label>
    ${m.mode === 'split' ? sel('debit', 'Debit / withdrawal (money out)') + sel('credit', 'Credit / deposit (money in)') : sel('amt', 'Amount') + `<label class="fld chk"><span>Reverse the sign (bank shows withdrawals as +)</span><input type="checkbox" data-k="flip" ${m.flip ? 'checked' : ''} onchange="bkMapSet(this)"></label>`}
    ${sel('bal', 'Running balance')}</div><div id="bk_prev"></div>`;
  bkPreview();
}
function bkMapSet(el) { const k = el.dataset.k; BK_TMP.map[k] = el.type === 'checkbox' ? el.checked : ['fmt', 'mode'].includes(k) ? el.value : +el.value; if (k === 'mode' || k === 'head') bkMapForm(); else bkPreview(); }
function bkPreview() {
  const co = S.company, ls = bkLines(BK_TMP.rows, BK_TMP.map), seen = new Set(bkStmts(co).filter(s => s.bank === BK_TMP.bank).flatMap(s => s.lines.map(bkKey)));
  const dup = ls.filter(l => seen.has(bkKey(l))).length, inn = sum(ls.filter(l => l.amount > 0), 'amount'), out = sum(ls.filter(l => l.amount < 0), 'amount');
  const last = ls.filter(l => l.balance != null).pop();
  BK_TMP.lines = ls;
  $('#bk_prev').innerHTML = ls.length ? `<p class="small" style="margin:10px 0 6px"><b>${ls.length}</b> transactions, ${esc(ls[0].date)} to ${esc(ls[ls.length - 1].date)} · in <b>${money(inn)}</b> · out <b>${money(-out)}</b>${dup ? ` · <span class="bad">${dup} already imported (skipped)</span>` : ''}</p>
    <div class="tbl-wrap" style="max-height:220px"><table class="grid compact"><thead><tr><th>Date</th><th>Description</th><th>Reference</th><th class="num">Amount</th><th class="num">Balance</th></tr></thead><tbody>
    ${ls.slice(0, 12).map(l => `<tr><td>${esc(l.date)}</td><td>${esc(l.desc)}</td><td>${esc(l.ref)}</td><td class="num ${l.amount < 0 ? 'bad' : ''}">${money(l.amount)}</td><td class="num">${l.balance == null ? '' : money(l.balance)}</td></tr>`).join('')}</tbody></table></div>
    <div class="form-grid" style="margin-top:8px"><label class="fld"><span>Statement ending balance *</span><input type="number" step="any" id="bk_close" value="${last ? last.balance : ''}"></label>
    <label class="fld"><span>Statement no.</span><input id="bk_no" value="${esc(BK_TMP.bank + '-' + ls[ls.length - 1].date.replace(/-/g, ''))}"></label></div>`
    : '<div class="alertbox warn" style="margin-top:10px"><span>⚠</span><div><b>No transactions recognised</b>Check the header row, the date column and the amount columns.</div></div>';
}
async function bkDoImport() {
  if (!BK_TMP || !BK_TMP.lines || !BK_TMP.lines.length) { toast('Choose a statement file with transactions first.', 'err'); return false; }
  const closing = $('#bk_close').value.trim(); if (closing === '') { toast('Enter the statement ending balance (it is on the statement).', 'err'); return false; }
  let id = '', res = {};
  const ok = await commit(() => {
    const co = S.company, bank = BK_TMP.bank;
    if (!DB.bankStmts) DB.bankStmts = []; if (!DB.bankFormats) DB.bankFormats = {};
    const seen = new Set(bkStmts(co).filter(s => s.bank === bank).flatMap(s => s.lines.map(bkKey)));
    const lines = BK_TMP.lines.filter(l => !seen.has(bkKey(l))).map(l => ({ id: uid(), ...l, entryIds: [], how: '' }));
    if (!lines.length) fail('Every transaction in this file was already imported.');
    let no = $('#bk_no').value.trim() || `${bank}-${today().replace(/-/g, '')}`; while (DB.bankStmts.some(s => s.company === co && s.no === no)) no += '-2';
    const close = r2(num(closing)), first = lines[0];
    const opening = first.balance != null ? r2(first.balance - first.amount) : r2(close - sum(lines, 'amount'));
    const st = { id: uid(), company: co, bank, no, fileName: BK_TMP.file, from: lines[0].date, to: lines[lines.length - 1].date, opening, closing: close, lines, importedBy: curUser().name, importedAt: new Date().toISOString(), skipped: BK_TMP.lines.length - lines.length };
    if (Math.abs(r2(opening + sum(lines, 'amount')) - close) > 0.009) st.warning = `Opening ${money(opening)} plus the transactions (${money(sum(lines, 'amount'))}) does not equal the ending balance ${money(close)}. Some lines may be missing from the file.`;
    DB.bankStmts.push(st); DB.bankFormats[`${co}|${bank}`] = { map: { ...BK_TMP.map }, width: Math.max(...BK_TMP.rows.slice(0, 30).map(r => r.length)) };
    res = bkAutoMatch(st); id = st.id;
  }, 'Imported bank statement', BK_TMP.bank);
  if (ok === false) return false;
  toast(`Imported. ${res.matched} of ${res.total} lines matched automatically.`); go(`#/bankimp/${id}`);
}

/* ---------- matching ---------- */
function bkCandidates(st, line, used) {
  return (DB.bankLedger || []).filter(e => e.company === st.company && e.bank === st.bank && !e.reconciled && !used.has(e.id) && Math.sign(e.amount) === Math.sign(line.amount));
}
function bkRefs(e) {
  const d = DB.docs.find(x => x.company === e.company && x.no === e.docNo) || {};
  return [e.docNo, e.checkNo, d.checkNo, d.orNo, d.refNo, d.vendorInvoiceNo].filter(x => x && String(x).length >= 3).map(x => String(x).toLowerCase());
}
function bkAutoMatch(st) {
  const tol = num(bkCfg().dateTol), used = bkUsed(), open = st.lines.filter(l => !(l.entryIds || []).length);
  const take = (l, e, how) => { l.entryIds = [e.id]; l.how = how; used.add(e.id); };
  for (const l of open) { if (l.draftNo) { const e = bkCandidates(st, l, used).find(e => e.docNo === l.draftNo && bkSame(e.amount, l.amount)); if (e) take(l, e, 'Created from this statement'); } }
  for (const l of open.filter(l => !l.entryIds.length)) {
    const ld = bkDigits(l.ref) || bkDigits((String(l.desc).match(/(?:check|chk|cheque)\D{0,4}(\d{4,})/i) || [])[1]);
    if (!ld) continue; const e = bkCandidates(st, l, used).find(e => e.checkNo && bkDigits(e.checkNo) === ld && bkSame(e.amount, l.amount)); if (e) take(l, e, 'Check no. and amount');
  }
  for (const l of open.filter(l => !l.entryIds.length)) {
    const txt = `${l.ref} ${l.desc}`.toLowerCase(); const e = bkCandidates(st, l, used).find(e => bkSame(e.amount, l.amount) && bkRefs(e).some(r => txt.includes(r))); if (e) take(l, e, 'Reference and amount');
  }
  for (const l of open.filter(l => !l.entryIds.length)) {
    const c = bkCandidates(st, l, used).filter(e => bkSame(e.amount, l.amount) && Math.abs(asrDaysBK(e.date, l.date)) <= tol);
    const rivals = st.lines.filter(x => x !== l && !x.entryIds.length && bkSame(x.amount, l.amount)).length;
    if (c.length === 1 && !rivals) take(l, c[0], `Amount, within ${tol} days`);
  }
  return { matched: st.lines.filter(l => l.entryIds.length).length, total: st.lines.length };
}
const asrDaysBK = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
async function bkRematch(id) {
  let r; const ok = await commit(() => { r = bkAutoMatch(DB.bankStmts.find(s => s.id === id)); }, 'Bank statement auto-match');
  if (ok !== false) { toast(`${r.matched} of ${r.total} lines matched.`); render(); }
}
async function bkUnmatch(id, lid) {
  const ok = await commit(() => { const s = DB.bankStmts.find(x => x.id === id), l = s.lines.find(x => x.id === lid); if (s.brecPosted) fail('This statement is already reconciled.'); l.entryIds = []; l.how = ''; }, 'Bank statement line unmatched');
  if (ok !== false) render();
}
function bkMatch(id, lid) {
  const s = DB.bankStmts.find(x => x.id === id), l = s.lines.find(x => x.id === lid), used = bkUsed(l);
  const c = bkCandidates(s, l, used).filter(e => Math.abs(asrDaysBK(e.date, l.date)) <= 60).sort((a, b) => Math.abs(a.amount - l.amount) - Math.abs(b.amount - l.amount));
  modal(`Match bank line ${money(l.amount)} (${l.date})`, `<p class="small">${esc(l.desc)} ${esc(l.ref)}</p>${c.length ? `<p class="small muted">Tick the ERP entries that make up this bank line (for example several collections deposited together). The total must equal ${money(l.amount)}.</p>
    <div class="tbl-wrap" style="max-height:320px"><table class="grid compact"><thead><tr><th></th><th>Date</th><th>Document</th><th>Check no.</th><th>Description</th><th class="num">Amount</th></tr></thead><tbody>
    ${c.map(e => `<tr><td><input type="checkbox" class="bkm" value="${e.id}" data-a="${e.amount}" onchange="bkMatchSum(${l.amount})"></td><td>${esc(e.date)}</td><td>${esc(e.docNo)}</td><td>${esc(e.checkNo || '')}</td><td>${esc(e.desc)}</td><td class="num">${money(e.amount)}</td></tr>`).join('')}</tbody></table></div><p id="bkm_sum" class="small" style="margin:8px 0 0">Selected: 0.00</p>`
    : '<p class="muted">No open ERP entries of the same direction in the 60 days around this date. Record it first (Create entry), then match.</p>'}`, async () => {
    const ids = $$('.bkm').filter(x => x.checked).map(x => x.value), tot = r2(sum($$('.bkm').filter(x => x.checked), x => num(x.dataset.a)));
    if (!ids.length) { toast('Tick at least one entry.', 'err'); return false; }
    if (!bkSame(tot, l.amount)) { toast(`The ticked entries total ${money(tot)}, not ${money(l.amount)}.`, 'err'); return false; }
    const ok = await commit(() => { const x = DB.bankStmts.find(y => y.id === id).lines.find(y => y.id === lid); x.entryIds = ids; x.how = `Matched by ${curUser().name}`; }, 'Bank statement line matched');
    if (ok !== false) render(); else return false;
  }, 'Match', true);
}
function bkMatchSum(target) { const t = r2(sum($$('.bkm').filter(x => x.checked), x => num(x.dataset.a))); const el = $('#bkm_sum'); el.innerHTML = `Selected: <b class="${bkSame(t, target) ? '' : 'bad'}">${money(t)}</b> of ${money(target)}`; }
/* bank lines not in the ERP yet: unidentified deposit → draft Cash Receipt; charges / interest → draft General Journal */
async function bkCreate(id, lid, kind) {
  let doc;
  const ok = await commit(() => {
    const s = DB.bankStmts.find(x => x.id === id), l = s.lines.find(x => x.id === lid), co = s.company, amt = Math.abs(l.amount), note = `Bank statement ${s.no}: ${l.desc} ${l.ref}`.trim();
    if (l.draftNo && DB.docs.some(d => d.company === co && d.no === l.draftNo && d.status !== 'Posted')) fail(`Draft ${l.draftNo} was already created for this line.`);
    const base = { id: uid(), company: co, date: l.date, status: 'Draft', createdBy: curUser().id, createdAt: new Date().toISOString(), approvals: [], dims: {}, remarks: note };
    if (kind === 'receipt') {
      if (l.amount <= 0) fail('Only money in can become a cash receipt.');
      doc = { ...base, type: 'CR', no: nextNo('CR', co), customer: '', docKind: 'Payment', bank: s.bank, method: 'Online / Fund Transfer', orNo: '', amount: amt, lines: [] };
    } else {
      if (bankCurrency(co, s.bank)) fail(`Bank ${s.bank} is a ${bankCurrency(co, s.bank)} account: record charges or interest with a General Journal in PHP against the G/L account, or ask Accounting.`);
      const acc = bkAcc(co, kind === 'interest' ? 'interest' : 'charges'); if (!acc) fail('Set the bank charges and interest accounts in Bank Statement settings first.');
      if (kind === 'interest' && l.amount <= 0) fail('Interest is money in.'); if (kind === 'charges' && l.amount >= 0) fail('Bank charges are money out.');
      const batch = (M(co).journalBatches.find(b => /general|gen/i.test(b.template)) || {}).name || '';
      doc = { ...base, type: 'GJ', no: nextNo('GJ', co), batch, lines: kind === 'interest'
        ? [{ accType: 'Bank Account', account: s.bank, desc: note, debit: amt, credit: 0 }, { accType: 'G/L Account', account: acc, desc: note, debit: 0, credit: amt }]
        : [{ accType: 'G/L Account', account: acc, desc: note, debit: amt, credit: 0 }, { accType: 'Bank Account', account: s.bank, desc: note, debit: 0, credit: amt }] };
    }
    DB.docs.push(doc); l.draftNo = doc.no; l.draftId = doc.id;
  }, 'Created entry from bank statement line');
  if (ok !== false) { toast(`${doc.type === 'CR' ? 'Cash Receipt' : 'General Journal'} ${doc.no} created as a draft${doc.type === 'CR' ? ': choose the customer and apply the invoice' : ''}. Send it for approval and post it; the line is then matched automatically.`); go(`#/doc/${doc.type}/${doc.id}`); }
}
/* matched entries → Bank Acc. Reconciliation (posted with the usual approval) */
async function bkMakeBrec(id) {
  let brec;
  const ok = await commit(() => {
    const s = DB.bankStmts.find(x => x.id === id), co = s.company;
    if (s.brecId) { const b = DB.docs.find(x => x.id === s.brecId); if (b && b.status !== 'Rejected') { brec = b; return; } }
    const matched = new Set(s.lines.flatMap(l => l.entryIds || []));
    if (!matched.size) fail('Match at least one line first.');
    const inUse = new Set(DB.docs.filter(x => x.type === 'BREC' && x.status !== 'Posted' && x.id !== s.brecId).flatMap(x => x.lines.map(l => l.entryId)));
    const lines = (DB.bankLedger || []).filter(e => e.company === co && e.bank === s.bank && !e.reconciled && e.date <= s.to && !inUse.has(e.id) || matched.has(e.id))
      .filter((e, i, a) => a.indexOf(e) === i).sort((a, b) => a.date.localeCompare(b.date))
      .map(e => ({ entryId: e.id, date: e.date, docNo: e.docNo, checkNo: e.checkNo, desc: e.desc, amount: e.amount, match: matched.has(e.id) }));
    const bk = bankOf(co, s.bank), first = !bk.lastStatementNo;
    brec = { id: uid(), type: 'BREC', no: nextNo('BREC', co), company: co, date: s.to, bank: s.bank, statementNo: s.no, endingBalance: s.closing, remarks: `From imported statement ${s.no}`, status: 'Draft',
      createdBy: curUser().id, createdAt: new Date().toISOString(), approvals: [], dims: {}, lines, stmtId: s.id };
    if (first) brec.lastBalance = s.opening;
    DB.docs.push(brec); s.brecId = brec.id;
  }, 'Created bank reconciliation from statement');
  if (ok !== false) { const t = brecTotals(brec); toast(Math.abs(t.diff) < 0.01 ? 'Reconciliation ready: difference is zero. Send it for approval and post.' : `Reconciliation created. Difference ${money(t.diff)}: match or record the remaining lines first.`); go(`#/doc/BREC/${brec.id}`); }
}
const _postBREC_bk = POSTERS.BREC;
POSTERS.BREC = function (d) { _postBREC_bk(d); const s = (DB.bankStmts || []).find(x => x.id === d.stmtId || (x.company === d.company && x.no === d.statementNo && x.bank === d.bank)); if (s) { s.brecPosted = d.no; s.brecId = d.id; } };
function bkSettings() {
  const c = bkCfg(), co = S.company;
  modal('Bank statement settings', `<div class="form-grid"><label class="fld">Match by amount within (days)<input type="number" id="bks_tol" value="${c.dateTol}"></label><label class="fld">Cash position: look ahead (days)<input type="number" id="bks_h" value="${c.horizon}"></label>
    <label class="fld">Bank charges account (${esc(MDS(co))})${pickHtml('bks_ch', 'accounts', bkAcc(co, 'charges'))}</label><label class="fld">Interest income account (${esc(MDS(co))})${pickHtml('bks_in', 'accounts', bkAcc(co, 'interest'))}</label></div>`, async () => {
    const ok = await commit(() => { const s = DB.settings.bankImport = Object.assign({}, DB.settings.bankImport || {}, { dateTol: num($('#bks_tol').value) || 5, horizon: num($('#bks_h').value) || 7 }); s.acc = s.acc || {}; s.acc[MDS(co)] = { charges: $('#bks_ch').value.trim(), interest: $('#bks_in').value.trim() }; }, 'Changed bank statement settings');
    if (ok !== false) render(); else return false;
  });
}

/* ---------- statements list and card ---------- */
route('bankimp', id => id ? bkCard(id) : bkList());
function bkList() {
  const co = S.company, ss = bkStmts(co).slice().sort((a, b) => (b.to + b.importedAt).localeCompare(a.to + a.importedAt)), open = bkOpenLines(co);
  return pageHead('Bank Statement Import', `Import the bank's CSV or Excel statement for <b>${esc(companyName(co))}</b>; lines are matched with the Bank Account Ledger automatically.`,
    `${canTreasury() ? '<button class="btn primary" onclick="bkImport()">⬆ Import statement</button> <button class="btn" onclick="bkSettings()">Settings</button>' : ''} <a class="btn" href="#/cashpos">Daily Cash Position</a>`) +
  `<div class="tiles"><a class="tile"><span>Statements</span><b>${ss.length}</b><small>imported</small></a><a class="tile"><span>Lines to match</span><b>${open.length}</b><small>on the bank, not yet in the ERP</small></a>
    <a class="tile"><span>Not reconciled</span><b>${ss.filter(s => !s.brecPosted).length}</b><small>statements</small></a></div>
  <div class="card">${ss.length ? `<div class="tbl-wrap"><table class="grid"><thead><tr><th>Statement</th><th>Bank</th><th>Period</th><th class="num">Opening</th><th class="num">Ending</th><th class="num">Lines</th><th class="num">Matched</th><th>Status</th></tr></thead><tbody>
    ${ss.map(s => { const m = s.lines.filter(l => l.entryIds.length).length; return `<tr class="link" onclick="go('#/bankimp/${s.id}')"><td><b>${esc(s.no)}</b><div class="small muted">${esc(s.fileName || '')}</div></td><td>${esc(s.bank)}</td><td>${esc(s.from)} – ${esc(s.to)}</td><td class="num">${money(s.opening)}</td><td class="num">${money(s.closing)}</td><td class="num">${s.lines.length}</td><td class="num">${m}</td><td>${badge(s.brecPosted ? 'Reconciled' : m === s.lines.length ? 'Matched' : 'Open')}</td></tr>`; }).join('')}</tbody></table></div>`
    : '<p class="muted" style="margin:0">No statements yet. Click "Import statement".</p>'}</div>`;
}
function bkCard(id) {
  const s = (DB.bankStmts || []).find(x => x.id === id); if (!s) return '<div class="card">Statement not found.</div>';
  const co = s.company, tr = canTreasury() && !s.brecPosted, b = bankOf(co, s.bank), matched = s.lines.filter(l => l.entryIds.length), un = s.lines.filter(l => !l.entryIds.length);
  const used = new Set(s.lines.flatMap(l => l.entryIds)), allUsed = bkUsed();
  const notOnBank = (DB.bankLedger || []).filter(e => e.company === co && e.bank === s.bank && !e.reconciled && e.date <= s.to && !allUsed.has(e.id));
  const ent = id => (DB.bankLedger || []).find(e => e.id === id) || {}, docLink = no => { const d = DB.docs.find(x => x.company === co && x.no === no); return d ? `<a href="#/doc/${d.type}/${d.id}">${esc(no)}</a>` : esc(no); };
  const brec = s.brecId && DB.docs.find(x => x.id === s.brecId);
  return pageHead(`Bank Statement ${s.no}`, `${badge(s.brecPosted ? 'Reconciled' : un.length ? 'Open' : 'Matched')} &nbsp;<b>${esc(s.bank)}</b> ${esc(b.name || '')} · ${esc(s.from)} to ${esc(s.to)} · imported by ${esc(s.importedBy)}${s.skipped ? ` · ${s.skipped} duplicate line(s) skipped` : ''}`, '<a class="btn ghost" href="#/bankimp">← Statements</a>') +
  `${s.warning ? `<div class="alertbox warn"><span>⚠</span><div><b>Balances do not add up</b>${esc(s.warning)}</div></div>` : ''}
  <div class="tiles"><a class="tile"><span>Opening balance</span><b>${money(s.opening)}</b><small>per bank</small></a><a class="tile"><span>Ending balance</span><b>${money(s.closing)}</b><small>${esc(s.to)}</small></a>
    <a class="tile"><span>Matched</span><b>${matched.length} / ${s.lines.length}</b><small>lines</small></a><a class="tile"><span>Not in the ERP yet</span><b>${money(sum(un, 'amount'))}</b><small>${un.length} line(s)</small></a></div>
  <div class="card"><div class="lines-head"><h3 style="margin:0">Statement lines</h3>${tr ? `<span style="display:flex;gap:8px"><button class="btn sm" onclick="bkRematch('${id}')">Run automatic matching</button></span>` : ''}</div>
    <div class="tbl-wrap"><table class="grid compact"><thead><tr><th>Date</th><th>Description</th><th>Reference</th><th class="num">Amount</th><th class="num">Balance</th><th>ERP entry</th><th></th></tr></thead><tbody>
    ${s.lines.map(l => `<tr><td>${esc(l.date)}</td><td>${esc(l.desc)}</td><td>${esc(l.ref)}</td><td class="num ${l.amount < 0 ? 'bad' : ''}">${money(l.amount)}</td><td class="num">${l.balance == null ? '' : money(l.balance)}</td>
      <td class="small">${l.entryIds.length ? `${l.entryIds.map(i => docLink(ent(i).docNo)).join(', ')} <span class="muted">· ${esc(l.how)}</span>` : l.draftNo ? `<span class="muted">draft ${docLink(l.draftNo)} not posted yet</span>` : '<span class="bad">not matched</span>'}</td>
      <td style="white-space:nowrap">${tr ? (l.entryIds.length ? `<button class="btn sm ghost" onclick="bkUnmatch('${id}','${l.id}')">Unmatch</button>` : `<button class="btn sm" onclick="bkMatch('${id}','${l.id}')">Match…</button> ${l.amount > 0 ? `<button class="btn sm ghost" onclick="bkCreate('${id}','${l.id}','receipt')">Cash receipt</button> <button class="btn sm ghost" onclick="bkCreate('${id}','${l.id}','interest')">Interest</button>` : `<button class="btn sm ghost" onclick="bkCreate('${id}','${l.id}','charges')">Bank charge</button>`}`) : ''}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="card"><h3>In the ERP but not on this statement (up to ${esc(s.to)})</h3>${notOnBank.length ? `<p class="small muted" style="margin:0 0 8px">Outstanding checks and deposits not yet credited by the bank. They stay open for the next statement.</p><div class="tbl-wrap"><table class="grid compact"><thead><tr><th>Date</th><th>Document</th><th>Check no.</th><th>Description</th><th class="num">Amount</th></tr></thead><tbody>
    ${notOnBank.map(e => `<tr><td>${esc(e.date)}</td><td>${docLink(e.docNo)}</td><td>${esc(e.checkNo || '')}</td><td>${esc(e.desc)}</td><td class="num">${money(e.amount)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted" style="margin:0">None.</p>'}</div>
  <div class="card" style="margin:12px 0 0;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
    ${brec ? `<a class="btn ${s.brecPosted ? '' : 'primary'}" href="#/doc/BREC/${brec.id}">Bank reconciliation ${esc(brec.no)} (${esc(brec.status)})</a>` : tr ? `<button class="btn primary" onclick="bkMakeBrec('${id}')">Create Bank Reconciliation ➜</button>` : ''}</div>`;
}

/* ---------- Daily Cash Position ---------- */
const CP = { date: '', co: '', all: false };
function cpData(date, scope, all) {
  const cos = scope === 'ALL' ? DB.companies.map(c => c.code) : [scope], led = DB.bankLedger || [], prev = addDays(date, -1), h = num(bkCfg().horizon);
  const rows = [];
  for (const co of cos) for (const b of bkBanks(co)) {
    const L = led.filter(e => e.company === co && e.bank === b.code), cur = isFCY(b.currency) ? U(b.currency) : '';
    const begin = r2(sum(L.filter(e => e.date <= prev), 'amount')), today_ = L.filter(e => e.date === date);
    const rin = r2(sum(today_.filter(e => e.amount > 0), 'amount')), rout = r2(sum(today_.filter(e => e.amount < 0), 'amount')), end = r2(begin + rin + rout);
    const st = bkStmts(co).filter(s => s.bank === b.code && s.to <= date).sort((x, y) => (x.to + x.importedAt).localeCompare(y.to + y.importedAt)).pop();
    const used = bkUsed(), unc = L.filter(e => e.date <= date && !e.reconciled && !used.has(e.id));
    const oc = r2(sum(unc.filter(e => e.amount < 0), 'amount')), dit = r2(sum(unc.filter(e => e.amount > 0), 'amount'));
    const pend = DB.docs.filter(d => d.company === co && d.type === 'PAY' && ['Pending Approval', 'Approved'].includes(d.status) && d.bank === b.code);
    const pendAmt = r2(sum(pend, d => docTotals(d).total));
    const rate = cur ? (num(safeRate(cur, date)) || 0) : 1;
    let diff = null;
    if (st) { const usedSt = new Set(bkStmts(co).filter(x => x.bank === b.code && x.to <= st.to).flatMap(x => x.lines.flatMap(l => l.entryIds))); const book = sum(L.filter(e => e.date <= st.to), 'amount'), notOn = sum(L.filter(e => e.date <= st.to && !e.reconciled && !usedSt.has(e.id)), 'amount'); diff = r2(st.closing - (book - notOn)); }
    const active = L.length || st || pend.length;
    if (!all && !active) continue;
    const firstSt = bkStmts(co).filter(s => s.bank === b.code).sort((x, y) => x.from.localeCompare(y.from))[0], firstOpen = firstSt && !L.some(e => e.date < firstSt.from) ? firstSt.opening : null;
    rows.push({ co, bank: b.code, name: b.name, acctNo: b.bankAccountNo || '', cur: cur || 'PHP', begin, rin, rout, end, oc, dit, st, diff, pendAmt, firstOpen, rate, endPHP: rate ? r2(end * rate) : null, moves: today_ });
  }
  const inScope = e => cos.includes(e.company), until = addDays(date, h);
  const openPayLines = new Set(DB.docs.filter(d => inScope(d) && d.type === 'PAY' && !['Posted', 'Cancelled'].includes(d.status)).flatMap(d => (d.lines || []).map(l => l.entryId)));
  const apDue = DB.apLedger.filter(e => inScope(e) && e.remaining > 0.004 && e.due <= until && !openPayLines.has(e.id));
  const arDue = DB.arLedger.filter(e => inScope(e) && e.remaining > 0.004 && e.due <= until);
  const pays = DB.docs.filter(d => inScope(d) && d.type === 'PAY' && ['Pending Approval', 'Approved'].includes(d.status));
  const php = rows.reduce((s, r) => s + (r.endPHP || 0), 0), apAmt = r2(sum(apDue, remLCY)), arAmt = r2(sum(arDue, remLCY)), payAmt = r2(sum(pays, d => docTotals(d).total * (() => { try { return docRate(d); } catch (e) { return 1; } })()));
  const byCur = {}; for (const r of rows) { const c = byCur[r.cur] = byCur[r.cur] || { cur: r.cur, begin: 0, rin: 0, rout: 0, end: 0, oc: 0, dit: 0, endPHP: 0 }; for (const k of ['begin', 'rin', 'rout', 'end', 'oc', 'dit']) c[k] = r2(c[k] + r[k]); c.endPHP = r2(c.endPHP + (r.endPHP || 0)); }
  const unmatched = cos.flatMap(co => bkOpenLines(co)).filter(x => x.l.date <= date);
  return { date, scope, cos, rows, byCur: Object.values(byCur), php: r2(php), apDue, arDue, pays, apAmt, arAmt, payAmt, projected: r2(php - apAmt - payAmt + arAmt), until, unmatched, h };
}
route('cashpos', () => {
  if (!CP.date) CP.date = today(); if (!CP.co) CP.co = S.company;
  const D = cpData(CP.date, CP.co, CP.all), many = D.cos.length > 1, tr = canTreasury();
  const snaps = (DB.cashPos || []).filter(x => x.scope === CP.co).sort((a, b) => b.date.localeCompare(a.date) || b.preparedAt.localeCompare(a.preparedAt)).slice(0, 10), mine = snaps.find(x => x.date === CP.date);
  const docLink = (co, no) => { const d = DB.docs.find(x => x.company === co && x.no === no); return d ? `<a href="#/doc/${d.type}/${d.id}">${esc(no)}</a>` : esc(no); };
  const m = v => `<span class="${v < 0 ? 'bad' : ''}">${money(v)}</span>`;
  return pageHead('Daily Cash Position', `Bank balances per the ERP books for <b>${CP.co === 'ALL' ? 'the whole group' : esc(companyName(CP.co))}</b> on <b>${esc(CP.date)}</b>, what has not cleared the bank, the latest bank statement, and the next ${D.h} days.`,
    `<button class="btn" onclick="cpExport()">⬇ Excel</button> <button class="btn" onclick="window.print()">🖨 Print</button> <a class="btn" href="#/bankimp">Bank statements</a>`) +
  `<div class="card filters"><div class="form-grid"><label class="fld"><span>Date</span><input type="date" id="cp_d" value="${esc(CP.date)}"></label>
    <label class="fld"><span>Company</span><select id="cp_co">${optionsHtml([['ALL', 'ALL – Group'], ...refOptions('companies')], CP.co, false)}</select></label>
    <label class="fld chk"><span>Show bank accounts without activity</span><input type="checkbox" id="cp_all" ${CP.all ? 'checked' : ''}></label></div>
    <button class="btn primary" onclick="CP.date=$('#cp_d').value||today();CP.co=$('#cp_co').value;CP.all=$('#cp_all').checked;render()">Show</button></div>
  <div class="tiles">${D.byCur.map(c => `<a class="tile"><span>Cash in bank (${esc(c.cur)})</span><b>${money(c.end)}</b><small>${c.cur === 'PHP' ? `in ${money(c.rin)} · out ${money(-c.rout)} today` : `≈ ₱${money(c.endPHP)}`}</small></a>`).join('')}
    <a class="tile"><span>Total in pesos</span><b>₱${money(D.php)}</b><small>foreign banks at the day's rate</small></a>
    <a class="tile"><span>Projected in ${D.h} days</span><b class="${D.projected < 0 ? 'bad' : ''}">₱${money(D.projected)}</b><small>after payments and collections due</small></a></div>
  ${D.unmatched.length ? `<div class="alertbox warn"><span>⚠</span><div><b>${D.unmatched.length} bank statement line(s) are not in the ERP yet</b>Total ${money(sum(D.unmatched, x => x.l.amount))}. Open <a href="#/bankimp">Bank Statement Import</a> to match them or record them, so the position is complete.</div></div>` : ''}
  <div class="card"><h3>Bank accounts</h3><div class="tbl-wrap"><table class="grid"><thead><tr>${many ? '<th>Company</th>' : ''}<th>Bank</th><th>Cur.</th><th class="num">Beginning</th><th class="num">Receipts</th><th class="num">Disbursements</th><th class="num">Ending (book)</th><th class="num">Not yet cleared: checks</th><th class="num">Deposits in transit</th><th class="num">Per bank statement</th><th class="num">Difference</th><th class="num">Payments in process</th></tr></thead><tbody>
    ${D.rows.length ? D.rows.map(r => `<tr>${many ? `<td>${esc(r.co)}</td>` : ''}<td><b>${esc(r.bank)}</b><div class="small muted">${esc(r.name)}</div></td><td>${esc(r.cur)}</td><td class="num">${m(r.begin)}</td><td class="num">${money(r.rin)}</td><td class="num">${money(-r.rout)}</td><td class="num"><b>${m(r.end)}</b>${r.cur !== 'PHP' && r.endPHP != null ? `<div class="small muted">₱${money(r.endPHP)}</div>` : ''}</td>
      <td class="num">${money(-r.oc)}</td><td class="num">${money(r.dit)}</td><td class="num">${r.st ? `${money(r.st.closing)}<div class="small muted"><a href="#/bankimp/${r.st.id}">${esc(r.st.to)}</a></div>` : '<span class="muted small">no statement</span>'}</td>
      <td class="num">${r.diff == null ? '' : Math.abs(r.diff) < 0.01 ? '<span style="color:var(--ok)">0.00</span>' : `<span class="bad">${money(r.diff)}</span>${r.firstOpen != null && Math.abs(r.diff - r.firstOpen) < 0.01 ? '<div class="small muted">= opening balance not yet posted in the ERP</div>' : ''}`}</td><td class="num">${r.pendAmt ? money(r.pendAmt) : ''}</td></tr>`).join('')
      : `<tr><td colspan="${many ? 12 : 11}" class="empty">No bank activity. Tick "Show bank accounts without activity" to list every account.</td></tr>`}</tbody>
    <tfoot>${D.byCur.map(c => `<tr><td colspan="${many ? 3 : 2}"><b>Total ${esc(c.cur)}</b></td><td class="num">${m(c.begin)}</td><td class="num">${money(c.rin)}</td><td class="num">${money(-c.rout)}</td><td class="num"><b>${m(c.end)}</b></td><td class="num">${money(-c.oc)}</td><td class="num">${money(c.dit)}</td><td colspan="3"></td></tr>`).join('')}</tfoot></table></div>
    <p class="small muted" style="margin:8px 0 0">Book balances come from the Bank Account Ledger (posted payments, collections, transfers and journals). <b>Difference</b> = latest bank statement balance less the book balance on that date adjusted for items not yet on the bank; it should be zero. Opening balances from the previous system must be posted once (General Journal, Account Type Bank Account) for the books to agree with the bank.</p></div>
  <div class="ers-layout"><div>
    <div class="card"><h3>Movements on ${esc(D.date)}</h3>${D.rows.some(r => r.moves.length) ? `<div class="tbl-wrap"><table class="grid compact"><thead><tr>${many ? '<th>Co.</th>' : ''}<th>Bank</th><th>Document</th><th>Check no.</th><th>Description</th><th class="num">In</th><th class="num">Out</th></tr></thead><tbody>
      ${D.rows.flatMap(r => r.moves.map(e => `<tr>${many ? `<td>${esc(r.co)}</td>` : ''}<td>${esc(r.bank)}</td><td>${docLink(r.co, e.docNo)}</td><td>${esc(e.checkNo || '')}</td><td>${esc(e.desc)}</td><td class="num">${e.amount > 0 ? money(e.amount) : ''}</td><td class="num">${e.amount < 0 ? money(-e.amount) : ''}</td></tr>`)).join('')}</tbody></table></div>` : '<p class="muted" style="margin:0">No receipts or disbursements posted on this date.</p>'}</div>
    <div class="card"><h3>Next ${D.h} days (to ${esc(D.until)})</h3><div class="kvlist">
      <div><span>Payment journals in approval / approved, not posted (${D.pays.length})</span><b>₱${money(D.payAmt)}</b></div>
      <div><span>Vendor invoices due, not yet in a payment journal (${D.apDue.length}), incl. overdue</span><b>₱${money(D.apAmt)}</b></div>
      <div><span>Customer invoices due (${D.arDue.length}), incl. overdue</span><b>₱${money(D.arAmt)}</b></div>
      <div><span><b>Projected cash</b> = total in pesos − payments − vendor invoices + customer invoices</span><b class="${D.projected < 0 ? 'bad' : ''}">₱${money(D.projected)}</b></div></div>
      ${D.pays.length ? `<table class="grid compact" style="margin-top:10px"><thead><tr><th>Payment</th><th>Vendor</th><th>Bank</th><th>Status</th><th class="num">Amount</th></tr></thead><tbody>${D.pays.map(d => `<tr><td>${docLink(d.company, d.no)}</td><td>${esc(partyName('vendor', d.vendor, d.company))}</td><td>${esc(d.bank || '')}</td><td>${badge(d.status)}</td><td class="num">${money(docTotals(d).total)}</td></tr>`).join('')}</tbody></table>` : ''}
      <p class="small muted" style="margin:8px 0 0">The 13-week view is in <a href="#/report/cashflow">Cash Flow Forecast</a>.</p></div>
  </div><div class="ers-side">
    <div class="card"><h3>Daily submission</h3>${mine ? `<p style="margin:0 0 8px">${badge(mine.reviewedBy ? 'Reviewed' : 'Submitted')} by ${esc(mine.preparedBy)}${mine.reviewedBy ? `, reviewed by ${esc(mine.reviewedBy)}` : ''}.</p>` : `<p class="small muted" style="margin:0 0 8px">Not yet submitted for ${esc(D.date)}.</p>`}
      ${tr && !mine ? `<button class="btn primary sm" onclick="cpSubmit()">Submit today's position</button>` : ''}
      ${mine && !mine.reviewedBy && cpCanReview() && mine.preparedById !== curUser().id ? `<button class="btn primary sm" onclick="cpReview('${mine.id}')">✔ Mark as reviewed</button>` : ''}
      ${mine && !mine.reviewedBy && mine.preparedById === curUser().id ? '<p class="small muted" style="margin:6px 0 0">Waiting for the Treasury Manager (Treasury Assistant Manager) to review.</p>' : ''}
      ${snaps.length ? `<table class="grid compact" style="margin-top:10px"><thead><tr><th>Date</th><th class="num">Total ₱</th><th>Status</th></tr></thead><tbody>${snaps.map(x => `<tr><td><a href="#/cashpos" onclick="CP.date='${x.date}'">${esc(x.date)}</a></td><td class="num">${money(x.php)}</td><td>${badge(x.reviewedBy ? 'Reviewed' : 'Submitted')}</td></tr>`).join('')}</tbody></table>` : ''}</div>
  </div></div>`;
});
const cpCanReview = () => isAdmin() || hasRole('Treasury Assistant Manager') || hasRole('CFO');
async function cpSubmit() {
  const D = cpData(CP.date, CP.co, false);
  const ok = await commit(() => {
    if (!DB.cashPos) DB.cashPos = [];
    if (DB.cashPos.some(x => x.scope === CP.co && x.date === CP.date)) fail('The position for this date was already submitted.');
    DB.cashPos.push({ id: uid(), scope: CP.co, date: CP.date, php: D.php, projected: D.projected, rows: D.rows.map(r => ({ co: r.co, bank: r.bank, cur: r.cur, begin: r.begin, rin: r.rin, rout: r.rout, end: r.end, endPHP: r.endPHP, oc: r.oc, dit: r.dit, stmt: r.st ? r.st.closing : null, diff: r.diff })),
      unmatched: D.unmatched.length, preparedBy: curUser().name, preparedById: curUser().id, preparedAt: new Date().toISOString() });
  }, 'Submitted daily cash position', CP.date);
  if (ok !== false) { toast('Submitted. The Treasury Manager can now review it.'); render(); }
}
async function cpReview(id) {
  const ok = await commit(() => { const x = DB.cashPos.find(y => y.id === id); if (x.preparedById === curUser().id) fail('You submitted this position, so someone else must review it.'); if (!cpCanReview()) fail('Only the Treasury Manager (Treasury Assistant Manager) or the CFO can review the cash position.'); x.reviewedBy = curUser().name; x.reviewedAt = new Date().toISOString(); }, 'Reviewed daily cash position');
  if (ok !== false) { toast('Marked as reviewed.'); render(); }
}
function cpExport() {
  const D = cpData(CP.date, CP.co, CP.all), many = D.cos.length > 1;
  const rows = [[`Daily Cash Position – ${CP.co === 'ALL' ? 'Leonio Group' : companyName(CP.co)}`], [`As of ${D.date}`], [],
    [...(many ? ['Company'] : []), 'Bank', 'Account no.', 'Currency', 'Beginning', 'Receipts', 'Disbursements', 'Ending (book)', 'Ending (PHP)', 'Outstanding checks', 'Deposits in transit', 'Per bank statement', 'Statement date', 'Difference', 'Payments in process']];
  for (const r of D.rows) rows.push([...(many ? [r.co] : []), r.bank, r.acctNo, r.cur, r.begin, r.rin, -r.rout, r.end, r.endPHP ?? '', -r.oc, r.dit, r.st ? r.st.closing : '', r.st ? r.st.to : '', r.diff ?? '', r.pendAmt || '']);
  rows.push([]); for (const c of D.byCur) rows.push([...(many ? [''] : []), `Total ${c.cur}`, '', '', c.begin, c.rin, -c.rout, c.end, c.endPHP]);
  rows.push([], ['Total in pesos', D.php], [`Next ${D.h} days (to ${D.until})`], ['Payment journals in approval / approved', D.payAmt], ['Vendor invoices due (not in a payment journal)', D.apAmt], ['Customer invoices due', D.arAmt], ['Projected cash', D.projected]);
  if (D.unmatched.length) rows.push([], [`${D.unmatched.length} bank statement line(s) not yet in the ERP`, sum(D.unmatched, x => x.l.amount)]);
  rows.push([], ['Movements', '', '', 'In', 'Out'], ...D.rows.flatMap(r => r.moves.map(e => [r.bank, e.docNo, e.desc, e.amount > 0 ? e.amount : '', e.amount < 0 ? -e.amount : ''])));
  const snap = (DB.cashPos || []).find(x => x.scope === CP.co && x.date === CP.date);
  rows.push([], ['Prepared by', snap ? snap.preparedBy : curUser().name], ['Reviewed by', snap && snap.reviewedBy ? snap.reviewedBy : '']);
  downloadBlob(xlsxBlob('Cash Position', rows, [14, 18, 16, 10, 16, 16, 16, 16, 16, 16, 16, 16, 12, 14, 16]), fileSafe(`Cash_Position_${CP.co}_${D.date}.xlsx`));
  toast('Cash position exported to Excel.');
}
