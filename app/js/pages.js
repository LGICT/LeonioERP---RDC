'use strict';
/* ============ Pages: dashboard, approvals, master data, fixed assets, reports, admin ============ */
const acctClass = (a) => {
  if (!a) return '';
  const c = (a.category || '').toLowerCase();
  if (c.startsWith('asset')) return 'Asset'; if (c.startsWith('liab')) return 'Liability'; if (c.startsWith('equity')) return 'Equity';
  if (c.startsWith('income')) return 'Income'; if (c.includes('cost') || c.startsWith('expense')) return 'Expense';
  if (a.incomeBalance === 'Income Statement') return /^4/.test(a.no) ? 'Income' : 'Expense';
  return /^1/.test(a.no) ? 'Asset' : /^2/.test(a.no) ? 'Liability' : 'Equity';
};
const glFor = (co) => DB.gl.filter(g => co === 'ALL' || g.company === co);

/* ---------- Dashboard ---------- */
function myApprovals() {
  const out = [];
  for (const d of DB.docs) if (canApprove(d)) out.push({ company: d.company, label: DOCS[d.type].name, no: d.no, party: docParty(d), amount: docTotals(d).total, role: pendingStep(d).role, link: `#/doc/${d.type}/${d.id}` });
  for (const [set, md] of Object.entries(DB.md)) for (const coll of ['vendors', 'customers', 'items']) for (const r of md[coll]) if (r.status === 'Pending Approval' && canApprove(r)) {
    const co = (DB.companies.find(c => c.md === set) || {}).code;
    out.push({ company: co, label: MASTERS[coll].single + ' card', no: r.no, party: r.name || r.description, amount: '', role: pendingStep(r).role, link: `#/card/${coll}/${encodeURIComponent(r.no)}`, set });
  }
  return out;
}
route('home', () => {
  const c = S.company, m = M(c), yr = today().slice(0, 4);
  const bankAccs = new Set(m.bankAccounts.filter(b => !b.company || b.company === c).map(b => (m.bankPostGroups.find(g => g.code === b.postingGroup) || {}).glAccount).filter(Boolean));
  const cash = r2(sum(glFor(c).filter(g => bankAccs.has(g.account)), g => g.debit - g.credit));
  const ar = r2(sum(DB.arLedger.filter(e => e.company === c), remLCY)), ap = r2(sum(DB.apLedger.filter(e => e.company === c), remLCY));
  const inv = r2(sum(DB.itemLedger.filter(e => e.company === c), e => e.value + (e.exp || 0)));
  let inc = 0, exp = 0;
  for (const g of glFor(c).filter(g => g.date.slice(0, 4) === yr)) { const k = acctClass(accOf(g.account, c)); if (k === 'Income') inc += g.credit - g.debit; if (k === 'Expense') exp += g.debit - g.credit; }
  const mine = myApprovals();
  const pending = DB.docs.filter(d => d.company === c && d.status === 'Pending Approval').length;
  const openPO = DB.docs.filter(d => d.company === c && d.type === 'PO' && ['Approved', 'Partially Received', 'Received'].includes(d.status)).length;
  const overdueAP = r2(sum(DB.apLedger.filter(e => e.company === c && e.remaining > 0 && e.due < today()), remLCY));
  const tile = (l, v, sub = '', href = '') => `<a class="tile" ${href ? `href="${href}"` : ''}><span>${l}</span><b>${v}</b><small>${sub}</small></a>`;
  const recent = DB.docs.filter(d => d.company === c).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 8);
  return pageHead(`${companyName(c)}`, `Welcome, ${esc(curUser().name)}. Master Data Set: <b>${esc(MDS(c))}</b> (${m.accounts.length} G/L accounts, ${m.items.length} items, ${m.vendors.length} vendors, ${m.customers.length} customers).`) +
    `<div class="tiles">
      ${tile('Cash in Bank', '₱ ' + money(cash), 'bank posting group accounts', '#/report/gl')}
      ${tile('Receivables', '₱ ' + money(ar), 'customer ledger', '#/report/ar')}
      ${tile('Payables', '₱ ' + money(ap), overdueAP ? `<span class="bad">₱ ${money(overdueAP)} overdue</span>` : 'none overdue', '#/report/ap')}
      ${tile('Inventory Value', '₱ ' + money(inv), 'actual + expected cost', '#/report/inv')}
      ${tile(`Net Income ${yr}`, '₱ ' + money(inc - exp), `Revenue ₱ ${money(inc)}`, '#/report/is')}
      ${tile('Waiting for MY approval', mine.length, `${pending} pending in this company`, '#/approvals')}
      ${tile('Open Purchase Orders', openPO, 'not yet fully invoiced', '#/docs/PO')}
    </div>
    <div class="cols2">
      <div class="card"><h3>Start a process</h3><div class="quick">
        <a class="btn" href="#/doc/PR/new">📝 Purchase Requisition</a><a class="btn" href="#/doc/PI/new">🧾 Purchase Invoice</a>
        <a class="btn" href="#/doc/PAY/new">💸 Payment Journal</a><a class="btn" href="#/doc/SI/new">📄 Sales Invoice</a>
        <a class="btn" href="#/doc/CR/new">💰 Cash Receipt Journal</a><a class="btn" href="#/doc/TO/new">🚚 Transfer Order</a>
        <a class="btn" href="#/doc/IJ/new">⛽ Item Journal (issue fuel/spares)</a><a class="btn" href="#/doc/GJ/new">📒 General Journal</a></div>
        <h3 style="margin-top:18px">Procure-to-Pay (signed To-Be flow)</h3>
        <div class="flow"><span>Requisition</span>→<span>Purchase Quote</span>→<span>Make Order</span>→<span>Post Receipt</span>→<span>Get Receipt Lines</span>→<span>Post Invoice</span>→<span>Payment Journal</span></div>
      </div>
      <div class="card"><h3>Recent documents</h3>${recent.length ? `<table class="grid compact"><tbody>${recent.map(d => `<tr class="link" onclick="go('#/doc/${d.type}/${d.id}')"><td>${esc(d.no)}</td><td>${esc(DOCS[d.type].name)}</td><td>${esc(docParty(d))}</td><td>${badge(d.status)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No documents yet in this company.</p>'}</div>
    </div>`;
});
route('approvals', () => pageHead('Requests to Approve', `Items waiting for a role held by <b>${esc(curUser().name)}</b> (${esc(curUser().roles.join(', '))}). Switch user at the top right to act as another approver.`) +
  `<div class="card">${dataTable('approvals', [{ l: 'Company', k: 'company' }, { l: 'Type', k: 'label' }, { l: 'No.', k: 'no' }, { l: 'Party / Description', k: 'party' }, { l: 'Amount', k: 'amount', f: 'money' }, { l: 'Your step', k: 'role' }], myApprovals(), { link: r => r.link, title: 'Requests to Approve' })}</div>`);

/* ---------- Master data (generic list + card) ---------- */
function masterCanEdit(def) { return !def.adminOnly || isAdmin() || hasRole(def.adminOnly); }
route('list', coll => {
  const def = MASTERS[coll]; if (!def) return '<div class="card">Unknown list</div>';
  let rows = masterColl(coll);
  if (def.companyScoped) rows = rows.filter(r => r.company === S.company);
  if (def.companyField) rows = rows.filter(r => !r.company || r.company === S.company);
  const shown = rows.length > 3000 ? rows.slice(0, 3000) : rows;
  return pageHead(def.title, (def.desc ? esc(def.desc) + '<br>' : '') + (def.md ? `<b>Master Data Set:</b> ${esc(MDS())} (shared by ${esc(DB.companies.filter(c => c.md === MDS()).map(c => c.code).join(', '))})` : '') + (shown.length < rows.length ? ` · showing first 3,000 of ${rows.length} – use Search` : ''),
    masterCanEdit(def) ? `<button class="btn primary" onclick="go('#/card/${coll}/new')">+ New</button>` : `<span class="muted small">Only ${esc(def.adminOnly)} can edit</span>`) +
    `<div class="card">${dataTable('m-' + coll, def.cols, shown, { link: r => `#/card/${coll}/${encodeURIComponent(masterKey(def, r))}`, title: def.title })}</div>`;
});
route('card', (coll, key) => {
  const def = MASTERS[coll]; if (!def) return '<div class="card">Unknown</div>';
  const isNew = key === 'new';
  const rec = isNew ? (def.companyScoped || def.companyField ? { company: S.company, year: today().slice(0, 4) } : {}) : masterColl(coll).find(r => masterKey(def, r) === key);
  if (!rec) return '<div class="card">Record not found.</div>';
  const canEdit = masterCanEdit(def) && rec.status !== 'Pending Approval';
  const keys = def.key.split(',');
  const fields = def.fields.map(f => (keys.includes(f.k) && !isNew) ? { ...f, ro: true } : f);
  const kq = esc(key).replace(/'/g, "\\'");
  let actions = '';
  if (canEdit) actions += `<button class="btn primary" onclick="saveMaster('${coll}','${isNew ? '' : kq}')">💾 Save${def.approval && isNew ? ' & Send Approval Request' : ''}</button>`;
  if (def.approval && canApprove(rec)) actions += `<button class="btn primary" onclick="approveMaster('${coll}','${kq}',true)">✔ Approve</button><button class="btn danger" onclick="approveMaster('${coll}','${kq}',false)">✖ Reject</button>`;
  if (def.approval && rec.status === 'Rejected' && masterCanEdit(def)) actions += `<button class="btn" onclick="resubmitMaster('${coll}','${kq}')">Resubmit</button>`;
  if (!isNew && masterCanEdit(def) && !['vendors', 'customers', 'items', 'accounts', 'companies'].includes(coll)) actions += `<button class="btn danger ghost" onclick="deleteMaster('${coll}','${kq}')">Delete</button>`;
  let extra = '';
  if (coll === 'items' && !isNew) {
    const stock = {};
    for (const e of DB.itemLedger.filter(e => e.item === rec.no && MDS(e.company) === MDS())) { const k = e.company + '|' + e.location; stock[k] = (stock[k] || 0) + e.qty; }
    const rows = Object.entries(stock).filter(([, q]) => Math.abs(q) > 0.0001);
    let acc = ''; try { acc = rec.type === 'Inventory' ? invAccount(S.company, '', rec.invPostGroup) : ''; } catch (e) { acc = '⚠ ' + e.message; }
    extra = `<div class="card"><h3>Posting (resolved from setup)</h3><p class="small">Inventory Account: <b>${esc(acc || '—')}</b>. Purchase/Sales/COGS accounts come from General Posting Setup (vendor/customer Gen. Bus. × <b>${esc(rec.genProd || '')}</b>).</p>
      <h3>Inventory by location</h3>${rows.length ? `<table class="grid compact"><thead><tr><th>Company</th><th>Location</th><th class="num">Quantity</th></tr></thead><tbody>${rows.map(([k, q]) => `<tr><td>${esc(k.split('|')[0])}</td><td>${esc(k.split('|')[1])}</td><td class="num">${qtyf(q)} ${esc(rec.uom)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No inventory.</p>'}</div>`;
  }
  if (coll === 'bankAccounts' && !isNew) {
    const co = rec.company || S.company, led = (DB.bankLedger || []).filter(e => e.company === co && e.bank === rec.code);
    extra = `<div class="card"><h3>Balance ₱ ${money(bankBalance(co, rec.code))}</h3><p class="small">Last statement: <b>${esc(rec.lastStatementNo || '—')}</b> ${rec.lastStatementDate ? 'on ' + esc(rec.lastStatementDate) : ''} · Balance Last Statement ₱ ${money(rec.lastStatementBalance || 0)} · Unreconciled entries: ${led.filter(e => !e.reconciled).length}</p>
      ${dataTable('bled', [{ l: 'Date', k: 'date' }, { l: 'Document No.', k: 'docNo' }, { l: 'Check No.', k: 'checkNo' }, { l: 'Description', k: 'desc' }, { l: 'Amount', k: 'amount', f: 'money' }, { l: 'Reconciled', v: r => r.reconciled ? r.statementNo : '' }], led, { title: rec.code })}</div>`;
  }
  if ((coll === 'vendors' || coll === 'customers') && !isNew) {
    const led = coll === 'vendors' ? DB.apLedger.filter(e => e.vendor === rec.no && MDS(e.company) === MDS()) : DB.arLedger.filter(e => e.customer === rec.no && MDS(e.company) === MDS());
    extra = `<div class="card"><div class="lines-head"><h3>${coll === 'vendors' ? 'Vendor' : 'Customer'} Ledger Entries</h3><button class="btn sm" onclick="go('#/applyent/${coll === 'vendors' ? 'vendor' : 'customer'}/${encodeURIComponent(rec.no)}')">Apply Entries…</button></div>${dataTable('led-' + coll, [{ l: 'Company', k: 'company' }, { l: 'Document No.', k: 'docNo' }, { l: 'Posting Date', k: 'date' }, { l: 'Due Date', k: 'due' }, { l: 'Description', k: 'desc' }, { l: 'Amount', k: 'amount', f: 'money' }, { l: 'Remaining Amount', k: 'remaining', f: 'money' }], led, { title: rec.name })}</div>`;
  }
  return pageHead(`${def.single}: ${isNew ? '(new)' : key.replace(/~/g, ' / ')}`, `${rec.status ? badge(rec.status) : ''} ${def.desc ? esc(def.desc) : ''}`, actions + `<button class="btn ghost" onclick="go('#/list/${coll}')">Back to list</button>`) +
    `<div class="card"><div class="form-grid">${fields.map(f => fieldHtml(f, rec[f.k], 'm', !canEdit)).join('')}</div></div>` + (def.approval ? approvalPanel(rec) : '') + extra;
});
async function saveMaster(coll, key) {
  const def = MASTERS[coll], keys = def.key.split(',');
  const data = readForm(def.fields.filter(f => !(keys.includes(f.k) && key)), 'm');
  let newKey = key;
  const ok = await commit(() => {
    const list = masterColl(coll);
    if (!key) {
      if (def.key === 'id' && coll !== 'users') data.id = uid();
      requireFields(def.fields, data);
      newKey = masterKey(def, data);
      if (list.some(r => masterKey(def, r) === newKey)) fail(`${def.single} ${newKey.replace(/~/g, ' / ')} already exists.`);
      if ((coll === 'vendors' || coll === 'customers') && data.tin && !/^0{3}-?0{3}/.test(data.tin) && data.tin !== 'N/A') { const dup = list.find(r => r.tin === data.tin); if (dup) fail(`TIN ${data.tin} already belongs to ${dup.no} (${dup.name}). Possible duplicate.`); }
      if (def.approval) { data.createdBy = curUser().id; data._isMaster = true; submitForApproval(data, 'MASTER'); delete data._isMaster; }
      list.push(data);
    } else {
      const rec = list.find(r => masterKey(def, r) === key); Object.assign(rec, data);
      requireFields(def.fields, rec);
    }
  }, `${key ? 'Modified' : 'Created'} ${def.single}`, newKey, { md: true });
  if (ok !== false) {
    const rec = masterColl(coll).find(r => masterKey(def, r) === newKey) || {};
    toast(`${def.single} saved.${rec.status === 'Pending Approval' ? ' Sent for approval: ' + pendingStep(rec).role : ''}`);
    const h = `#/card/${coll}/${encodeURIComponent(newKey)}`; if (location.hash === h) render(); else go(h);
  }
}
function findMaster(coll, key) { const def = MASTERS[coll]; return masterColl(coll).find(r => masterKey(def, r) === key); }
function approveMaster(coll, key, approve) {
  modal((approve ? 'Approve ' : 'Reject ') + key, `<label class="fld w3"><span>Comment${approve ? ' (optional)' : ' *'}</span><textarea id="apc" rows="3"></textarea></label>`, async () => {
    const c = $('#apc').value.trim();
    const ok = await commit(() => { const r = findMaster(coll, key); approve ? approveStep(r, c) : rejectStep(r, c); }, `${approve ? 'Approved' : 'Rejected'} ${MASTERS[coll].single}`, key, { md: true });
    if (ok !== false) { toast(approve ? 'Approved.' : 'Rejected.'); render(); } else return false;
  }, approve ? 'Approve' : 'Reject');
}
async function resubmitMaster(coll, key) { const ok = await commit(() => { const r = findMaster(coll, key); r._isMaster = true; submitForApproval(r, 'MASTER'); delete r._isMaster; }, 'Resubmitted', key, { md: true }); if (ok !== false) render(); }
async function deleteMaster(coll, key) {
  if (!confirm('Delete this record?')) return;
  const def = MASTERS[coll];
  const ok = await commit(() => { const list = masterColl(coll); const i = list.findIndex(r => masterKey(def, r) === key); list.splice(i, 1); }, `Deleted ${def.single}`, key, { md: true });
  if (ok !== false) go('#/list/' + coll);
}

/* ---------- Fixed assets ---------- */
const FA_FIELDS = [T('no', 'No.', { req: 1 }), T('description', 'Description', { req: 1, w: 'w2' }), R('classCode', 'FA Class Code', 'faClasses'), R('subclass', 'FA Subclass Code', 'faSubclasses'),
  R('postGroup', 'FA Posting Group', 'faPostGroups', { req: 1 }), R('faLocation', 'FA Location Code', 'faLocations'), R('company', 'Company', 'companies', { req: 1 }), T('serialNo', 'Serial No. / Plate / IMO'),
  T('responsible', 'Responsible Employee'), T('depMethod', 'Depreciation Method', { t: 'select', opts: ['Straight-line', 'User-defined', 'Declining-Balance 1'] }), T('depStart', 'Depreciation Starting Date', { t: 'date' }),
  T('depMonths', 'No. of Depreciation Months', { t: 'number' })];
const faCanEdit = () => isAdmin() || hasRole('G/L Accountant') || hasRole('BU Accounting Manager');
const coFAs = (co) => M(co).fixedAssets.filter(f => !f.company || f.company === co);
route('fa', () => {
  const rows = coFAs(S.company).map(f => ({ ...f, cost: faCost(f.no), accum: faAccum(f.no), nbv: r2(faCost(f.no) - faAccum(f.no)) }));
  return pageHead('Fixed Assets', `Fixed Asset list with Depreciation Book values. Fixed assets are also the "equipment/vessel" on fuel and repair costs. <b>Company:</b> ${esc(companyName(S.company))}`,
    `${faCanEdit() ? `<button class="btn primary" onclick="go('#/facard/new')">+ New</button>` : ''}<button class="btn" onclick="depModal()">Calculate Depreciation…</button>`) +
    `<div class="card">${dataTable('fa', [{ l: 'No.', k: 'no' }, { l: 'Description', k: 'description' }, { l: 'FA Class', k: 'classCode' }, { l: 'Subclass', k: 'subclass' }, { l: 'FA Posting Group', k: 'postGroup' }, { l: 'FA Location', k: 'faLocation' }, { l: 'Acquisition Cost', k: 'cost', f: 'money' }, { l: 'Depreciation', k: 'accum', f: 'money' }, { l: 'Book Value', k: 'nbv', f: 'money' }, { l: 'Status', k: 'status', html: r => badge(r.status) }], rows, { link: r => `#/facard/${encodeURIComponent(r.no)}`, title: 'Fixed Assets' })}</div>`;
});
route('facard', no => {
  const isNew = no === 'new';
  const fa = isNew ? { company: S.company, depMethod: 'Straight-line', depMonths: 60, depStart: today(), status: 'Active' } : coFAs(S.company).find(f => f.no === no) || M().fixedAssets.find(f => f.no === no);
  if (!fa) return '<div class="card">Not found</div>';
  const ed = faCanEdit() && fa.status !== 'Disposed';
  const led = faLed(S.company, fa.no);
  const charges = DB.gl.filter(g => g.asset === fa.no && g.company === S.company && g.debit && g.docType !== 'DEP');
  return pageHead(`Fixed Asset: ${isNew ? '(new)' : fa.no}`, `${badge(fa.status)} ${isNew ? '' : `Acquisition Cost ₱ ${money(faCost(fa.no))} · Depreciation ₱ ${money(faAccum(fa.no))} · Book Value ₱ ${money(faCost(fa.no) - faAccum(fa.no))}`}`,
    (ed ? `<button class="btn primary" onclick="saveFA('${isNew ? '' : esc(fa.no)}')">💾 Save</button>` : '') +
    (!isNew && ed ? `<button class="btn" onclick="faAcquire('${esc(fa.no)}')">FA G/L Journal: Acquisition Cost…</button><button class="btn danger" onclick="faDispose('${esc(fa.no)}')">FA G/L Journal: Disposal…</button>` : '') +
    `<button class="btn ghost" onclick="go('#/fa')">Back</button>`) +
    `<p class="hint">Normally the acquisition cost comes from a Purchase Invoice line of Type "Fixed Asset". Use the FA G/L Journal for opening balances.</p>
    <div class="card"><div class="form-grid">${FA_FIELDS.map(f => fieldHtml(f.k === 'no' && !isNew ? { ...f, ro: true } : f, fa[f.k], 'm', !ed)).join('')}</div></div>
    ${isNew ? '' : `<div class="card"><h3>FA Ledger Entries</h3>${dataTable('faled', [{ l: 'Posting Date', k: 'date' }, { l: 'FA Posting Type', k: 'type' }, { l: 'Period', k: 'period' }, { l: 'Document No.', k: 'docNo' }, { l: 'Amount', k: 'amount', f: 'money' }], led, { title: fa.no + ' ledger', search: false })}</div>
    <div class="card"><h3>Costs charged to this asset (fuel, repairs, etc.)</h3>${dataTable('facost', [{ l: 'Date', k: 'date' }, { l: 'Document', k: 'docNo' }, { l: 'Account', v: r => `${r.account} – ${accName(r.account, r.company)}` }, { l: 'Description', k: 'desc' }, { l: 'Amount', k: 'debit', f: 'money' }], charges, { title: fa.no + ' costs' })}</div>`}`;
});
async function saveFA(no) {
  const data = readForm(FA_FIELDS.filter(f => !(f.k === 'no' && no)), 'm');
  const ok = await commit(() => {
    const list = M().fixedAssets;
    if (!no) { requireFields(FA_FIELDS, data); if (list.some(f => f.no === data.no)) fail(`Fixed Asset ${data.no} already exists.`); data.status = 'Active'; list.push(data); no = data.no; }
    else Object.assign(list.find(f => f.no === no), data);
  }, 'Saved fixed asset', no || data.no, { md: true });
  if (ok !== false) { toast('Fixed asset saved.'); go('#/facard/' + encodeURIComponent(no)); render(); }
}
function faAcquire(no) {
  modal('FA G/L Journal – Acquisition Cost – ' + no, `<div class="form-grid">${fieldHtml({ k: 'date', l: 'Posting Date', t: 'date' }, today(), 'q')}${fieldHtml({ k: 'amount', l: 'Amount', t: 'number' }, '', 'q')}
    ${fieldHtml({ k: 'offset', l: 'Bal. Account No. (G/L)', t: 'ref', ref: 'accounts', w: 'w2' }, '', 'q')}</div>`, async () => {
    const q = readForm([{ k: 'date' }, { k: 'amount', t: 'number' }, { k: 'offset' }], 'q');
    const ok = await commit(() => {
      const fa = M().fixedAssets.find(f => f.no === no); if (q.amount <= 0) fail('Amount must be positive.'); if (!q.offset) fail('Bal. Account No. must have a value.');
      const doc = { id: uid(), type: 'GJ', no: nextNo('GJ', S.company), company: S.company, date: q.date, status: 'Posted', remarks: `Acquisition cost ${fa.no} ${fa.description}`, createdBy: curUser().id, createdAt: new Date().toISOString(), postedAt: new Date().toISOString(), approvals: [],
        lines: [{ accType: 'G/L Account', account: faPG(S.company, fa).acqCost, debit: q.amount, credit: 0, asset: fa.no, desc: 'Acquisition Cost' }, { accType: 'G/L Account', account: q.offset, debit: 0, credit: q.amount, desc: 'Acquisition Cost' }] };
      postGJ(doc); DB.docs.push(doc);
      DB.faLedger.push({ id: uid(), company: S.company, fa: fa.no, date: q.date, type: 'Acquisition Cost', amount: q.amount, docNo: doc.no });
    }, 'Posted FA acquisition', no);
    if (ok !== false) { toast('Acquisition cost posted.'); render(); } else return false;
  }, 'Post');
}
function faDispose(no) {
  modal('FA G/L Journal – Disposal – ' + no, `<div class="form-grid">${fieldHtml({ k: 'date', l: 'Posting Date', t: 'date' }, today(), 'q')}${fieldHtml({ k: 'proceeds', l: 'Proceeds on Disposal (0 if scrapped)', t: 'number' }, 0, 'q')}
    ${fieldHtml({ k: 'acct', l: 'Proceeds received in (G/L account)', t: 'ref', ref: 'accounts', w: 'w2' }, '', 'q')}</div><p class="muted small">Gain/loss accounts come from the FA Posting Group.</p>`, async () => {
    const q = readForm([{ k: 'date' }, { k: 'proceeds', t: 'number' }, { k: 'acct' }], 'q'); let doc;
    const ok = await commit(() => { if (q.proceeds && !q.acct) fail('Choose the account for the proceeds.'); doc = disposeFA(S.company, M().fixedAssets.find(f => f.no === no), q.date, q.proceeds, q.acct); }, 'Posted FA disposal', no);
    if (ok !== false) { toast(`Disposal posted (${doc.no}).`); render(); } else return false;
  }, 'Post');
}
function depModal() {
  const d = new Date(), last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  modal('Calculate Depreciation', `<p>Straight-line depreciation for <b>${esc(companyName(S.company))}</b> using each asset's FA Posting Group. Each month posts once per asset.</p>${fieldHtml({ k: 'date', l: 'Posting Date (period end)', t: 'date' }, `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`, 'q')}`, async () => {
    const dt = $('#q_date').value; let doc;
    const ok = await commit(() => { doc = runDepreciation(S.company, dt); }, 'Calculated depreciation', dt);
    if (ok !== false) { toast(`Depreciation posted: ${doc.no}, ₱ ${money(docTotals(doc).total)}.`); go(`#/doc/DEP/${doc.id}`); } else return false;
  }, 'Calculate & Post');
}

/* ---------- Reports ---------- */
const RF = { company: null, from: null, to: null, account: '' };
function rfInit() { if (!RF.company) RF.company = S.company; if (!RF.from) RF.from = today().slice(0, 4) + '-01-01'; if (!RF.to) RF.to = today(); }
function filterBar(opts) {
  rfInit();
  const f = [fieldHtml({ k: 'company', l: 'Company', t: 'select', opts: [['ALL', 'ALL – Group (before eliminations)'], ...refOptions('companies')], noBlank: 1 }, RF.company, 'rf')];
  if (opts.from) f.push(fieldHtml({ k: 'from', l: 'From', t: 'date' }, RF.from, 'rf'));
  if (opts.to) f.push(fieldHtml({ k: 'to', l: opts.toLabel || 'To', t: 'date' }, RF.to, 'rf'));
  if (opts.account) f.push(fieldHtml({ k: 'account', l: 'G/L Account (blank = all)', t: 'ref', ref: 'accounts' }, RF.account, 'rf'));
  return `<div class="card filters"><div class="form-grid">${f.join('')}</div><button class="btn primary" onclick="runReport()">Run Report</button></div>`;
}
function runReport() { for (const k of ['company', 'from', 'to', 'account']) { const el = document.getElementById('rf_' + k); if (el) RF[k] = el.value.trim(); } render(); }
const inCo = r => RF.company === 'ALL' || r.company === RF.company;
route('report', (name, arg) => { rfInit(); const R = REPORTS[name]; return R ? R(arg) : '<div class="card">Unknown report</div>'; });
function acctRows(filterFn, valFn) {
  const by = new Map();
  for (const g of DB.gl.filter(g => inCo(g) && filterFn(g))) {
    const a = accOf(g.account, g.company) || { no: g.account, name: g.account };
    const k = g.account; const r = by.get(k) || { no: a.no, name: a.name, cls: acctClass(a), cat: a.category || acctClass(a), open: 0, debit: 0, credit: 0, bal: 0 };
    valFn(r, g); by.set(k, r);
  }
  return [...by.values()].sort((a, b) => a.no.localeCompare(b.no));
}
const REPORTS = {
  tb() {
    const rows = acctRows(g => g.date <= RF.to, (r, g) => { const n = g.debit - g.credit; if (g.date < RF.from) r.open += n; else { r.debit += g.debit; r.credit += g.credit; } r.bal += n; })
      .map(r => ({ ...r, open: r2(r.open), debit: r2(r.debit), credit: r2(r.credit), bal: r2(r.bal) }));
    const foot = `<tr><td colspan="3"><b>Total</b></td><td class="num"><b>${money(sum(rows, 'open'))}</b></td><td class="num"><b>${money(sum(rows, 'debit'))}</b></td><td class="num"><b>${money(sum(rows, 'credit'))}</b></td><td class="num"><b>${money(sum(rows, 'bal'))}</b></td></tr>`;
    return pageHead('Trial Balance', 'Posting accounts with activity. Ending balances should total zero.') + filterBar({ from: 1, to: 1 }) +
      `<div class="card">${dataTable('tb', [{ l: 'No.', k: 'no' }, { l: 'Name', k: 'name' }, { l: 'Category', k: 'cat' }, { l: 'Opening', k: 'open', f: 'money' }, { l: 'Debit', k: 'debit', f: 'money' }, { l: 'Credit', k: 'credit', f: 'money' }, { l: 'Balance', k: 'bal', f: 'money' }], rows, { title: 'Trial Balance', foot, link: r => `#/report/gl/${r.no}` })}</div>`;
  },
  is() {
    const rows = acctRows(g => g.date >= RF.from && g.date <= RF.to, (r, g) => { r.bal += g.debit - g.credit; }).filter(r => ['Income', 'Expense'].includes(r.cls) && Math.abs(r.bal) > 0.004);
    const inc = rows.filter(r => r.cls === 'Income').map(r => ({ ...r, amt: -r.bal })), exp = rows.filter(r => r.cls === 'Expense').map(r => ({ ...r, amt: r.bal }));
    const ti = sum(inc, 'amt'), te = sum(exp, 'amt');
    const sec = (t, rs, tot) => `<tr class="sec"><td colspan="2">${t}</td></tr>${rs.map(r => `<tr class="link" onclick="go('#/report/gl/${r.no}')"><td>${r.no} – ${esc(r.name)}</td><td class="num">${money(r.amt)}</td></tr>`).join('')}<tr class="subtot"><td>Total ${t}</td><td class="num">${money(tot)}</td></tr>`;
    return pageHead('Income Statement', `${esc(RF.company === 'ALL' ? 'Group (before intercompany eliminations)' : companyName(RF.company))}, ${RF.from} to ${RF.to}`) + filterBar({ from: 1, to: 1 }) +
      `<div class="card"><table class="grid fs">${sec('Income', inc, ti)}${sec('Cost & Expenses', exp, te)}<tr class="grandtot"><td>NET INCOME / (LOSS)</td><td class="num">${money(ti - te)}</td></tr></table></div>`;
  },
  bs() {
    const rows = acctRows(g => g.date <= RF.to, (r, g) => { r.bal += g.debit - g.credit; });
    const pick = (cls, sign) => rows.filter(r => r.cls === cls && Math.abs(r.bal) > 0.004).map(r => ({ ...r, amt: sign * r.bal }));
    const as = pick('Asset', 1), li = pick('Liability', -1), eq = pick('Equity', -1);
    const ni = -sum(rows.filter(r => ['Income', 'Expense'].includes(r.cls)), 'bal');
    eq.push({ no: '', name: 'Net income / current earnings (not yet closed)', amt: ni });
    const ta = sum(as, 'amt'), tl = sum(li, 'amt'), te = sum(eq, 'amt');
    const sec = (t, rs, tot) => `<tr class="sec"><td colspan="2">${t}</td></tr>${rs.map(r => `<tr><td>${r.no ? r.no + ' – ' : ''}${esc(r.name)}</td><td class="num">${money(r.amt)}</td></tr>`).join('')}<tr class="subtot"><td>Total ${t}</td><td class="num">${money(tot)}</td></tr>`;
    return pageHead('Balance Sheet', `As of ${RF.to}. ${Math.abs(ta - tl - te) < 0.01 ? '✔ Balanced' : '⚠ Not balanced'}`) + filterBar({ to: 1, toLabel: 'As of' }) +
      `<div class="card"><table class="grid fs">${sec('Assets', as, ta)}${sec('Liabilities', li, tl)}${sec('Equity', eq, te)}<tr class="grandtot"><td>TOTAL LIABILITIES & EQUITY</td><td class="num">${money(tl + te)}</td></tr></table></div>`;
  },
  gl(acc) {
    if (acc) RF.account = acc;
    const rows = DB.gl.filter(g => inCo(g) && g.date >= RF.from && g.date <= RF.to && (!RF.account || g.account === RF.account)).sort((a, b) => a.date.localeCompare(b.date));
    let run = RF.account ? r2(sum(DB.gl.filter(g => inCo(g) && g.account === RF.account && g.date < RF.from), g => g.debit - g.credit)) : 0;
    const data = rows.map(g => { run = r2(run + g.debit - g.credit); return { ...g, run }; });
    const docLink = r => { const d = DB.docs.find(x => x.no === r.docNo && x.company === r.company); return d ? `#/doc/${d.type}/${d.id}` : ''; };
    return pageHead('General Ledger Entries', 'All posted G/L entries with dimensions.') + filterBar({ from: 1, to: 1, account: 1 }) +
      `<div class="card">${dataTable('gl', [{ l: 'Posting Date', k: 'date' }, { l: 'Company', k: 'company' }, { l: 'Document No.', k: 'docNo' }, { l: 'G/L Account', v: r => `${r.account} – ${accName(r.account, r.company)}` }, { l: 'Description', k: 'desc' }, { l: 'Source', v: r => r.party ? partyName(r.partyKind, r.party, r.company) : '' }, { l: 'Dimensions', v: r => dimText(r.dims) }, { l: 'FA', k: 'asset' }, { l: 'Debit', k: 'debit', f: 'money' }, { l: 'Credit', k: 'credit', f: 'money' }, ...(RF.account ? [{ l: 'Balance', k: 'run', f: 'money' }] : [])], data, { title: 'GL Entries', link: docLink })}</div>`;
  },
  ap() { return agingReport('ap'); },
  ar() { return agingReport('ar'); },
  inv() {
    const by = new Map();
    for (const e of DB.itemLedger.filter(e => inCo(e) && e.date <= RF.to)) {
      const k = e.company + '|' + e.location + '|' + e.item; const r = by.get(k) || { company: e.company, location: e.location, item: e.item, qty: 0, value: 0, exp: 0 };
      r.qty += e.qty; r.value += e.value; r.exp += e.exp || 0; by.set(k, r);
    }
    const rows = [...by.values()].filter(r => Math.abs(r.qty) > 0.0001 || Math.abs(r.value + r.exp) > 0.01).map(r => { const it = itemOf(r.item, r.company) || {}; return { ...r, qty: r4(r.qty), value: r2(r.value), exp: r2(r.exp), total: r2(r.value + r.exp), desc: it.description, uom: it.uom, group: it.invPostGroup }; });
    return pageHead('Inventory Valuation', 'Quantity and cost per location: actual cost (invoiced) and expected cost (received, not yet invoiced).') + filterBar({ to: 1, toLabel: 'As of' }) +
      `<div class="card">${dataTable('inv', [{ l: 'Company', k: 'company' }, { l: 'Location', k: 'location' }, { l: 'Item No.', k: 'item' }, { l: 'Description', k: 'desc' }, { l: 'Inv. Posting Group', k: 'group' }, { l: 'Quantity', k: 'qty', f: 'qty' }, { l: 'UOM', k: 'uom' }, { l: 'Cost (Actual)', k: 'value', f: 'money' }, { l: 'Cost (Expected)', k: 'exp', f: 'money' }, { l: 'Total', k: 'total', f: 'money' }], rows,
        { title: 'Inventory', foot: `<tr><td colspan="7"><b>Total</b></td><td class="num"><b>${money(sum(rows, 'value'))}</b></td><td class="num"><b>${money(sum(rows, 'exp'))}</b></td><td class="num"><b>${money(sum(rows, 'total'))}</b></td></tr>` })}</div>`;
  },
  il() {
    const rows = DB.itemLedger.filter(e => inCo(e) && e.date >= RF.from && e.date <= RF.to).sort((a, b) => a.date.localeCompare(b.date));
    return pageHead('Item Ledger Entries', 'Every receipt, invoice, issue, transfer, sale and adjustment.') + filterBar({ from: 1, to: 1 }) +
      `<div class="card">${dataTable('il', [{ l: 'Posting Date', k: 'date' }, { l: 'Company', k: 'company' }, { l: 'Document No.', k: 'docNo' }, { l: 'Entry Type', k: 'entryType' }, { l: 'Item No.', k: 'item' }, { l: 'Description', v: r => (itemOf(r.item, r.company) || {}).description }, { l: 'Location', k: 'location' }, { l: 'Bin', k: 'bin' }, { l: 'Quantity', k: 'qty', f: 'qty' }, { l: 'Cost (Actual)', k: 'value', f: 'money' }, { l: 'Cost (Expected)', k: 'exp', f: 'money' }], rows,
        { title: 'Item Ledger', link: r => { const d = DB.docs.find(x => x.no === r.docNo && x.company === r.company); return d ? `#/doc/${d.type}/${d.id}` : ''; } })}</div>`;
  },
  bva() {
    const yr = RF.to.slice(0, 4);
    const keys = new Set([...DB.budgets.filter(b => inCo(b) && String(b.year) === yr).map(b => b.account), ...DB.gl.filter(g => inCo(g) && g.date.slice(0, 4) === yr && acctClass(accOf(g.account, g.company)) === 'Expense').map(g => g.account)]);
    const rows = [...keys].sort().map(a => {
      const bud = sum(DB.budgets.filter(b => inCo(b) && String(b.year) === yr && b.account === a), 'amount');
      const act = r2(sum(DB.gl.filter(g => inCo(g) && g.account === a && g.date.slice(0, 4) === yr && g.date <= RF.to), g => g.debit - g.credit));
      return { account: a, name: accName(a, RF.company === 'ALL' ? S.company : RF.company), budget: bud, actual: act, variance: r2(bud - act), pct: bud ? Math.round(act / bud * 100) + '%' : 'no budget' };
    });
    return pageHead(`Budget vs. Actual ${yr}`, '') + filterBar({ to: 1, toLabel: 'Up to' }) +
      `<div class="card">${dataTable('bva', [{ l: 'Account', k: 'account' }, { l: 'Name', k: 'name' }, { l: 'Budget', k: 'budget', f: 'money' }, { l: 'Actual', k: 'actual', f: 'money' }, { l: 'Remaining', k: 'variance', f: 'money' }, { l: '% Used', k: 'pct' }], rows, { title: 'Budget vs Actual' })}</div>`;
  },
  equip() {
    const by = {};
    for (const g of DB.gl.filter(g => inCo(g) && g.asset && g.date >= RF.from && g.date <= RF.to && acctClass(accOf(g.account, g.company)) === 'Expense')) { const k = g.company + '|' + g.asset + '|' + g.account; by[k] = (by[k] || 0) + g.debit - g.credit; }
    const rows = Object.entries(by).map(([k, v]) => { const [co, a, acc] = k.split('|'); return { asset: a, desc: (faOf(a, co) || {}).description, account: acc, name: accName(acc, co), amount: r2(v) }; }).sort((a, b) => a.asset.localeCompare(b.asset));
    return pageHead('Cost per Equipment / Vessel', 'Fuel, spares, repairs and depreciation charged to each fixed asset.') + filterBar({ from: 1, to: 1 }) +
      `<div class="card">${dataTable('equip', [{ l: 'FA No.', k: 'asset' }, { l: 'Description', k: 'desc' }, { l: 'Account', k: 'account' }, { l: 'Cost Type', k: 'name' }, { l: 'Amount', k: 'amount', f: 'money' }], rows, { title: 'Cost per Equipment', foot: `<tr><td colspan="4"><b>Total</b></td><td class="num"><b>${money(sum(rows, 'amount'))}</b></td></tr>` })}</div>`;
  },
  audit() {
    const rows = DB.audit.filter(a => RF.company === 'ALL' || a.company === RF.company).slice().reverse();
    return pageHead('Change Log (Audit Trail)', 'Every save, approval, rejection, posting and import.') + filterBar({}) +
      `<div class="card">${dataTable('audit', [{ l: 'Date & Time', v: r => r.ts.slice(0, 19).replace('T', ' ') }, { l: 'User', k: 'user' }, { l: 'Company', k: 'company' }, { l: 'Action', k: 'msg' }, { l: 'Reference', k: 'ref' }], rows, { title: 'Audit Trail' })}</div>`;
  }
};
function agingReport(kind) {
  const ledger = kind === 'ap' ? DB.apLedger : DB.arLedger, pk = kind === 'ap' ? 'vendor' : 'customer', asOf = today(), by = {};
  for (const e of ledger.filter(e => inCo(e) && Math.abs(e.remaining) > 0.004)) {
    const k = e.company + '|' + e[pk]; const r = by[k] || (by[k] = { company: e.company, party: e[pk], name: partyName(pk, e[pk], e.company), current: 0, d30: 0, d60: 0, d90: 0, over: 0, total: 0 });
    const late = daysBetween(e.due, asOf), b = late <= 0 ? 'current' : late <= 30 ? 'd30' : late <= 60 ? 'd60' : late <= 90 ? 'd90' : 'over';
    r[b] = r2(r[b] + remLCY(e)); r.total = r2(r.total + remLCY(e));
  }
  const rows = Object.values(by), ft = k => `<td class="num"><b>${money(sum(rows, k))}</b></td>`;
  return pageHead(kind === 'ap' ? 'Aged Accounts Payable' : 'Aged Accounts Receivable', `Remaining amounts by days past due as of ${asOf}. Negative = unapplied payments/advances.`) + filterBar({}) +
    `<div class="card">${dataTable(kind + 'aging', [{ l: 'Company', k: 'company' }, { l: 'No.', k: 'party' }, { l: 'Name', k: 'name' }, { l: 'Not Due', k: 'current', f: 'money' }, { l: '1–30', k: 'd30', f: 'money' }, { l: '31–60', k: 'd60', f: 'money' }, { l: '61–90', k: 'd90', f: 'money' }, { l: 'Over 90', k: 'over', f: 'money' }, { l: 'Balance', k: 'total', f: 'money' }], rows,
      { title: kind.toUpperCase() + ' Aging', link: r => `#/card/${pk}s/${encodeURIComponent(r.party)}`, foot: `<tr><td colspan="3"><b>Total</b></td>${ft('current')}${ft('d30')}${ft('d60')}${ft('d90')}${ft('over')}${ft('total')}</tr>` })}</div>`;
}

/* ---------- Administration ---------- */
route('settings', () => {
  const f = [{ k: 'groupName', l: 'Group Name (printed on documents)' }, { k: 'postingFrom', l: 'Allow Posting From', t: 'date' }, { k: 'postingTo', l: 'Allow Posting To', t: 'date' }, { k: 'budgetControl', l: 'Budget Control (route approvals within/outside budget)', t: 'check' }];
  const m = M(), ser = m.noSeries.map(s => [s.code, `${s.code} – ${s.description || ''}`]);
  return pageHead('Settings & Data', `Data is saved ${serverMode ? 'on this PC in <code>data\\db.json</code> (hourly backups in <code>data\\backups</code>)' : '<b>only in this browser</b> (server not running)'}.`) +
    `<div class="card"><h3>General Ledger Setup</h3><div class="form-grid">${f.map(x => fieldHtml(x, DB.settings[x.k], 's', !isAdmin())).join('')}</div>${isAdmin() ? '<button class="btn primary" onclick="saveSettings()">Save</button>' : ''}</div>
    <div class="card"><h3>Number series per document – Master Data Set ${esc(MDS())}</h3><p class="muted small">Purchases & Payables / Sales & Receivables / Inventory Setup. Pre-filled by matching your No. Series descriptions; blank = a simple ERP series.</p>
      <div class="form-grid">${Object.keys(DOCS).filter(t => !['DEP', 'FAD'].includes(t)).map(t => fieldHtml({ k: t, l: DOCS[t].name, t: 'select', opts: ser }, m.settings.docSeries[t], 'ns', !isAdmin())).join('')}</div>
      ${isAdmin() ? '<button class="btn primary" onclick="saveSeries()">Save Number Series</button>' : ''}</div>
    <div class="card"><h3>Backup & restore</h3>
      <button class="btn" onclick="downloadBackup()">⬇ Download Backup (.json)</button>
      ${isAdmin() ? `<label class="btn">⬆ Restore from Backup<input type="file" accept=".json" style="display:none" onchange="restoreBackup(this)"></label>
      <button class="btn danger ghost" onclick="resetDemo()">Reset (keep master data, erase all transactions)</button>` : ''}</div>
    <div class="card"><h3>Statistics</h3><p>${DB.docs.length} documents · ${DB.gl.length} G/L entries · ${DB.itemLedger.length} item entries · ${DB.audit.length} log records</p></div>`;
});
async function saveSettings() {
  const d = readForm([{ k: 'groupName' }, { k: 'postingFrom' }, { k: 'postingTo' }, { k: 'budgetControl', t: 'check' }], 's');
  const ok = await commit(() => Object.assign(DB.settings, d), 'Updated settings'); if (ok !== false) toast('Settings saved.');
}
async function saveSeries() {
  const ok = await commit(() => { const m = M(); for (const t of Object.keys(DOCS)) { const el = $('#ns_' + t); if (el) m.settings.docSeries[t] = el.value; } }, 'Updated number series mapping', '', { md: true });
  if (ok !== false) toast('Number series saved.');
}
function downloadBackup() { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(DB)], { type: 'application/json' })); a.download = `leonio-erp-backup-${today()}.json`; a.click(); }
function restoreBackup(inp) {
  const f = inp.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = async () => {
    let data; try { data = JSON.parse(r.result); } catch (e) { return toast('Not a valid backup file.', 'err'); }
    if (!data.docs || !data.gl || !data.md) return toast('Not a Leonio ERP v0.2 backup file.', 'err');
    if (!confirm('Replace ALL current data with this backup?')) return;
    DB = data; MD_DIRTY = true; audit('Restored data from backup'); await saveDB(); toast('Backup restored.'); render();
  };
  r.readAsText(f);
}
async function resetDemo() {
  if (!confirm('Erase ALL transactions (documents, ledgers, approvals) but keep master data and setup? Download a backup first if you need it.')) return;
  const ok = await commit(() => { for (const k of ['docs', 'gl', 'itemLedger', 'apLedger', 'arLedger', 'faLedger', 'whseEntries', 'bankLedger', 'applications', 'icTransactions']) DB[k] = []; DB.meta.seq = {}; }, 'Erased all transactions');
  if (ok !== false) { toast('Transactions erased.'); go('#/home'); }
}

/* ---------- Getting started & roadmap ---------- */
route('guide', () => {
  const step = (n, who, what, link) => `<tr><td><b>${n}</b></td><td>${esc(who)}</td><td>${what}</td><td>${link ? `<a href="${link}">Open →</a>` : ''}</td></tr>`;
  return pageHead('Getting Started', 'One full purchase following your signed Procure-to-Pay flow. Use <b>Acting as</b> (top right) to play each person.') +
    `<div class="card"><table class="grid"><thead><tr><th>#</th><th>Act as</th><th>What to do</th><th></th></tr></thead><tbody>
    ${step(1, 'Requester (Technical)', 'Company <b>LLRI</b>. New Purchase Requisition: Location, purpose, a line (Type Item, type part of an item no. to search). <b>Send Approval Request</b>.', '#/doc/PR/new')}
    ${step(2, 'Department Head', '<b>Requests to Approve</b> → open → Approve.', '#/approvals')}
    ${step(3, 'Purchasing Assistant', 'Requisition → <b>Create Purchase Quotes</b> for 2–3 vendors. Open each quote, enter Direct Unit Cost, Save. The requisition shows the canvass comparison.', '#/docs/PR')}
    ${step(4, 'Purchasing Assistant → Executive Assistant', 'Send the chosen quote for approval; EA to the President approves.', '#/docs/PQ')}
    ${step(5, 'Purchasing Assistant → Supply Chain & Admin Head', '<b>Make Order</b> → Send Approval Request → approve the Purchase Order.', '#/docs/PQ')}
    ${step(6, 'Warehouseman', 'Purchase Order → <b>Create Whse. Receipt</b> (at warehouse locations such as LAMI GD Ws; elsewhere <b>Post Receipt</b>). Enter Qty. to Receive and bin, <b>Post Receipt</b>, then on the Put-away choose the Place bin and <b>Register Put-away</b>. Check <b>Bin Contents</b>.', '#/docs/PO')}
    ${step(7, 'AP Accounting Associate', 'Purchase Order → <b>Create Invoice (Get Receipt Lines)</b>. Enter Vendor Invoice No. VAT and EWT come from the VAT/WHT Posting Setup. Send for approval.', '#/docs/PO')}
    ${step(8, 'Approvers', 'General Accounting Supervisor → EA (or SA for ADM/G&A lines) → President if fixed asset → Accounting Manager.', '#/approvals')}
    ${step(9, 'AP Accounting Associate', '<b>Post</b>. Check the G/L Entries: accounts come from Inventory Posting Setup, VAT Posting Setup, WHT Posting Setup and the Vendor Posting Group.', '#/docs/PI')}
    ${step(10, 'Treasury', 'New Payment Journal → vendor → <b>Apply Entries</b> → approvals → Post.', '#/doc/PAY/new')}
    ${step(11, 'Anyone', 'Trial Balance, Aged Accounts Payable, Inventory Valuation, Change Log.', '#/report/tb')}
    </tbody></table></div>
    <div class="card"><h3>Good to know</h3><ul>
    <li>Each company uses its business unit's <b>Master Data Set</b> imported from your configuration packages (Land, Mining, Tankering). LLRI and LAMI share Mining. Admin is set to Mining for now.</li>
    <li>If posting stops with "General Posting Setup does not exist…", the combination is missing in your setup files too. Add it under Posting Setup.</li>
    <li>You cannot approve what you created. Posted documents cannot be edited; use a credit memo or journal.</li>
    <li>To reload updated master files: Administration → Import Master Data.</li></ul></div>`;
});
route('roadmap', () => {
  const ph = [
    ['Done', 'v0.1 Prototype', 'Signed To-Be flows as screens with approvals and reports.', 'done'],
    ['Done', 'v0.2 Master data and posting', 'Your master data imported; posting through General/Inventory/Vendor/Customer/Bank/FA posting groups, VAT and WHT posting setup, dimensions, number series, expected/actual cost, item charges, cash receipt CWT, general journal account types.', 'done'],
    ['Done', 'v0.3 Warehouse', 'Warehouse Receipt → Put-away, Warehouse Shipment → Pick → Post Shipment, Item Reclass. Journal (bin-to-bin), Bin Contents, counts by bin. Still next: lot/serial/expiry tracking.', 'done'],
    ['Done', 'v0.4 Treasury', 'Suggest Vendor Payments, check printing, Void Check, Unapply / Apply Entries, vendor and customer refunds, Transfer of Funds, Bank Acc. Reconciliation, Bank Account Ledger, 13-week Cash Flow Forecast. Still next: prepayment invoices, foreign currency.', 'done'],
    ['Done', 'v0.5 Intercompany', 'IC partners recognised from your affiliate records, IC Outbox/Inbox (accept or reject), sales invoice → purchase invoice and credit memo → purchase credit memo across companies (services and stock), IC Reconciliation, Consolidated Trial Balance with eliminations. Still next: consolidation across different charts of accounts (account mapping).', 'done'],
    ['Done', 'v0.6 Foreign currency', 'Currency Exchange Rates, Currency Code and rate on documents, G/L in PHP, realized gain/loss on application (unrealized reversed to realized), Adjust Exchange Rates for open entries and USD/SGD banks, buying and selling foreign currency between banks.', 'done'],
    ['Done', 'v0.7 Requisitions (ERS) and the ERS look', 'Your ERS joined to the ERP: one New Request for warehouse stock (Material Request) or purchases (Purchase Requisition), with catalog search and category icons, approval by immediate superior or department head (and by amount), Supply Chain review with shortages to a Purchase Requisition, release by the warehouse that posts the issue to inventory and the G/L with department and equipment. Item photos, Budget Status with committed amounts, Issuance Accounts. Approval rules by role, hierarchy, named user and amount range; PI and PO approval levels per your decisions of 8 Nov 2026.', 'done'],
    ['Done', 'v0.8 Sales Contract (NOSPA)', 'Decision 19: contract with buyer, grade, volume, price per WMT, ports, Laycan, shipment no., seller bank and deposit schedule; approval, buyer signature, notarisation, Laycan and vessel confirmation, loading, closing; amendments with approval; deposits become due by milestone; final payment documents checklist.', 'done'],
    ['Done', 'v0.8 Deposit invoices', 'Decision 20: Deposit 1, Deposit 2 and Provisional invoices created from the contract when each milestone is reached, posted to the Sales Prepayments account (Advances from Customers); final invoice from the contract deducts them; settlement shows balance to collect or refund.', 'done'],
    ['Done', 'v0.9 Sales Order', 'Decision 21: Sales Order released, then invoiced in full or in parts with quantity invoiced tracked per line; the Sales Contract creates its order after loading and the final invoice comes from it (deposits deducted). The 50 WMT limit is not copied.', 'done'],
    ['Done', 'v0.10 Vendor accreditation', 'Decisions 10–11: required documents (editable list) recorded by one person and verified by another, approval by the Supply Chain & Admin Head, 12-month validity with renewal and expiry reminders, suspend / blacklist / reinstate, vendor rating; Purchase Orders blocked for vendors that are not accredited once switched on; bank details and payment terms changed only by request (Accounting Shared checks, Treasury approves).', 'done'],
    ['Done', 'v0.11 Request for Quotation', 'Decision 9: RFQ from an approved Purchase Requisition, vendors invited (blacklisted refused), one quote per vendor keyed in with lead time, terms and warranty, technical review by the Technical Head for equipment and spare parts, comparison sheet with lowest valid quote, 3 valid quotes from ₱50,000 or a written justification, reason when not the lowest, award approved through the quote approval rules, then Make Order.', 'done'],
    ['Done', 'v0.12 QAR and quote forms', 'QAR in your Canvass Sheet format (print and Excel) with Prepared by / Approved by from the approval trail; quote entry with the vendor offer per line, part no., extra charges, negotiated discount, VAT, quality, delivery point and inclusions; totals in pesos for foreign quotes; weighted score with editable weights; Excel quote form per vendor, email to the vendor, and upload of the filled form.', 'done'],
    ['Done', 'v0.13 Service acceptance (ASR)', 'Approved Service Report for service POs: the end user records % complete per line, performer, inspector, quality 1–5 and delay reason; timeliness, scope and quality score with exceptions; approval by the head of the requesting department (plus the Supply Chain Manager when there are exceptions); on approval the accepted part is received on the PO, so AP invoices only accepted work; progress reports, revise after rejection, print without prices, and the vendor service record suggests marks in the vendor rating.', 'done'],
    ['Done', 'v0.14 Cash position and bank import', 'Decisions 23–24: bank statement import from the bank\'s CSV or Excel file (columns recognised and remembered per bank account, duplicates skipped), automatic matching by check no., reference or amount and date, manual matching of one bank line to several entries, unidentified deposits to a draft Cash Receipt and bank charges / interest to a draft General Journal, then a Bank Acc. Reconciliation filled from the matches. Daily Cash Position per bank: beginning, receipts, disbursements, ending, outstanding checks, deposits in transit, latest bank statement and difference, payments in process, the next days\' payments and collections, Excel export, and a daily submission reviewed by the Treasury Manager.', 'done'],
    ['Done', 'v0.15 Roles and permissions', 'Administration → Roles & Permissions: per role, View / Create-Edit / Delete-Cancel / Approve / Post for 24 areas and the companies it covers; users can hold several roles; menus, pages, buttons and actions follow the permissions; approvers in Approval Rules need the Approve tick (named superiors always can); System Admin always has full access; built-in role names locked; copy, rename, delete; overview of all roles; import of your roles file by position title (no personal names); every change in the Change Log.', 'done'],
    ['Done', 'v0.16 Approval designer', 'Administration → Approval Designer: the approval chain of each document drawn as steps; per step the approver (role, immediate superior, department head, a named person), when it applies (always, amount from / below / band, budget, G&A, capex …), limits by the creator\'s department or a dimension value such as a vessel, Required or Automatic, and an alternate approver; a separate chain per company where needed; reorder, add, remove, copy to another document or company; draft until published, with the change in the Change Log; "Who would approve this?" names the people for an example document; checks for steps nobody can approve. Also: BIR 2307 and the alphalist of payees, reports grouped and foldable, menu order by drag and drop.', 'done'],
    ['Done', 'v0.17 Standard item descriptions', 'Your 2025 item description template in the ERP: builder with live preview, 100-character limit and duplicate check (on the item card and in Inventory → Item Description Review); the parts kept per item; review Open → For Verification → Reviewed and Closed / Duplicate / For Deletion with bulk approval; import of the 2025 workbook matched by old description.', 'done'],
    ['Done', 'v0.18 Vendor portal (test version)', 'Supplier Portal at #/vp: sign in with email + PIN; RFQs with online quotes into the same Purchase Quote and QAR, decline, award result; POs to view, print and acknowledge with a delivery date; invoice submission with a PDF and status (Submitted, Under review, Approved for payment, Paid, Returned); remittance advice and Form 2307; accreditation documents uploaded for staff to verify. In the ERP: Vendor Portal Accounts and Vendor Portal Inbox (create the Purchase Invoice from a submitted invoice, or return it). Also: Make Order now requires an approved (awarded) quote. Runs only on this PC until logins, a server and ICT\'s security review.', 'done'],
    ['Then', 'Logins and shared database', 'Last in your build order: real user logins with roles, and a shared database so several people can work at the same time. Also needed before suppliers can use the vendor portal from outside.', 'plan'],
    ['Later', 'Finance', 'Recurring journals and allocations, accounting periods and year-end close, FA write-down/appreciation.', 'plan'],
    ['Later', 'Operations & BU modules', 'Fleet, fuel, maintenance work orders, dispatch; shipping voyages; mining production/hauling; land & property.', 'plan'],
    ['Later', 'Go-live readiness', 'Real logins/permissions, proper database and server, BIR CAS registration, parallel run with the current system, data migration of open balances.', 'plan']
  ];
  return pageHead('ERP Roadmap', '') + `<div class="roadmap">${ph.map(p => `<div class="phase ${p[3]}"><div class="ph-tag">${p[0]}</div><div><h3>${p[1]}</h3><p>${p[2]}</p></div></div>`).join('')}</div>`;
});
