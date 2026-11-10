'use strict';
/* ============ BIR withholding tax: Form 2307 and the Alphalist of Payees (MAP / QAP) ============
   Replaces the first reports of the current Philtax customization. Source: posted Purchase Invoices and Purchase
   Credit Memos (returns), line by line: the supplier's TIN and address from the vendor card, the ATC = WHT Product
   Posting Group (WC158, WC160 …; shown as WI… for individual suppliers, WHT Bus. group VIND), the rate and the tax
   from the WHT Posting Setup, the income payment = the line's amount before VAT, in pesos. Only expanded withholding
   tax (EWT) is included; final tax (FWT) belongs on Form 2306. The tax withheld is reconciled with the EWT payable
   accounts in the G/L. The company's TIN, branch, RDO and the signatory are kept in BIR settings per company.
   The BIR .dat file (Alphalist Data Entry) is not produced yet: it will copy a file your current system produced. */

const BIR = { co: '', year: '', kind: 'Q', q: '', m: '', tab: 'qap' };
const birCfg = co => Object.assign((() => { const c = DB.companies.find(x => x.code === co) || {}; return { name: c.legalName || c.name || co, tin: c.tin || '', branch: '0000', rdo: '', address: c.address || '', zip: '', sigName: '', sigTitle: '', sigTin: '' }; })(), ((DB.settings.bir || {})[co]) || {});
const birTin = t => { const d = String(t || '').replace(/\D/g, ''); return { tin: d.slice(0, 9), branch: (d.slice(9) || '0').padStart(4, '0').slice(-4), fmt: d.length >= 9 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6, 9)}-${(d.slice(9) || '0').padStart(4, '0').slice(-4)}` : String(t || '') }; };
const birAtc = (code, vendor) => vendor && vendor.whtBus === 'VIND' && /^WC/.test(code) ? 'WI' + code.slice(2) : code;
function birPeriod() {
  const y = +BIR.year;
  if (BIR.kind === 'M') { const m = +BIR.m; return { from: `${y}-${pad(m)}-01`, to: addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`, -1), months: [m], label: `${['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m]} ${y}` }; }
  const q = +BIR.q, m1 = (q - 1) * 3 + 1, endM = m1 + 2;
  return { from: `${y}-${pad(m1)}-01`, to: addDays(endM === 12 ? `${y + 1}-01-01` : `${y}-${pad(endM + 1)}-01`, -1), months: [m1, m1 + 1, m1 + 2], label: `Q${q} ${y}` };
}
/** EWT detail lines from posted purchase invoices and credit memos */
function birLines(co, from, to) {
  const md = M(co), out = [];
  for (const d of DB.docs.filter(x => x.company === co && ['PI', 'PRET'].includes(x.type) && x.status === 'Posted' && x.date >= from && x.date <= to)) {
    const v = vendorOf(d.vendor, co) || { no: d.vendor, name: d.vendor }, sign = d.type === 'PRET' ? -1 : 1;
    let R = 1; try { R = docRate(d); } catch (e) { }
    for (const l of d.lines || []) {
      const c = lineCalc(d, l); if (!c.wht || !c.ws) continue;
      if (c.ws.whtType && c.ws.whtType !== 'EWT') continue;
      const prod = (md.whtProd.find(p => p.code === l.whtProd) || {});
      out.push({ date: d.date, month: +d.date.slice(5, 7), docType: d.type, docNo: d.no, docId: d.id, extNo: d.vendorInvoiceNo || '', vendor: v.no, name: v.name, tin: v.tin || '', address: [v.address, v.address2, v.city].filter(Boolean).join(', '),
        ind: v.whtBus === 'VIND', atc: birAtc(l.whtProd, v), nature: prod.description || l.whtProd, rate: num(c.ws.pct), base: r2(sign * c.base * R), tax: r2(sign * c.wht * R) });
    }
  }
  return out;
}
function birAlphalist(lines) {
  const by = new Map();
  for (const l of lines) { const k = `${l.vendor}|${l.atc}|${l.rate}`; const r = by.get(k) || { ...l, base: 0, tax: 0, docs: 0 }; r.base = r2(r.base + l.base); r.tax = r2(r.tax + l.tax); r.docs++; by.set(k, r); }
  return [...by.values()].filter(r => Math.abs(r.base) > 0.004 || Math.abs(r.tax) > 0.004).sort((a, b) => a.name.localeCompare(b.name) || a.atc.localeCompare(b.atc)).map((r, i) => ({ ...r, seq: i + 1 }));
}
/** EWT credited in the G/L for the same documents (control total) */
function birGL(co, from, to) {
  const md = M(co), accs = new Set(md.whtSetup.filter(w => (!w.whtType || w.whtType === 'EWT') && w.payableAcc).map(w => w.payableAcc));
  const docs = new Set(DB.docs.filter(x => x.company === co && ['PI', 'PRET'].includes(x.type) && x.status === 'Posted' && x.date >= from && x.date <= to).map(x => x.no));
  return r2(sum(DB.gl.filter(g => g.company === co && docs.has(g.docNo) && accs.has(g.account)), g => num(g.credit) - num(g.debit)));
}

route('bir', () => {
  if (!BIR.co || !DB.companies.some(c => c.code === BIR.co)) BIR.co = S.company;
  if (!BIR.year) { BIR.year = today().slice(0, 4); BIR.q = String(Math.ceil(+today().slice(5, 7) / 3)); BIR.m = String(+today().slice(5, 7)); }
  const co = BIR.co, P = birPeriod(), L = birLines(co, P.from, P.to), A = birAlphalist(L), cfg = birCfg(co), gl = birGL(co, P.from, P.to);
  const totB = r2(sum(A, 'base')), totT = r2(sum(A, 'tax')), noTin = A.filter(r => birTin(r.tin).tin.length < 9), noAddr = [...new Set(A.filter(r => !r.address).map(r => r.name))];
  const payees = [...new Set(A.map(r => r.vendor))];
  const yrs = Array.from({ length: 4 }, (_, i) => String(+today().slice(0, 4) - i));
  const warn = [];
  if (!birTin(cfg.tin).tin || birTin(cfg.tin).tin.length < 9) warn.push(`The TIN of ${esc(cfg.name)} is not set. Fill it in under BIR settings before printing.`);
  if (!cfg.address) warn.push('The company\'s registered address is not set (BIR settings).');
  if (noTin.length) warn.push(`${noTin.length} payee line(s) without a valid TIN: ${esc([...new Set(noTin.map(r => r.name))].join(', '))}. Fix the vendor card.`);
  if (noAddr.length) warn.push(`No registered address on the vendor card of: ${esc(noAddr.join(', '))}.`);
  if (Math.abs(gl - totT) > 0.01) warn.push(`Tax withheld per this list (₱${money(totT)}) differs from the EWT payable credited in the G/L for the same documents (₱${money(gl)}).`);
  return pageHead('BIR Withholding Tax', `Expanded withholding tax on posted purchase invoices of <b>${esc(cfg.name)}</b>: the Alphalist of Payees (attachment to the ${BIR.kind === 'Q' ? '1601-EQ' : '0619-E'}) and Form 2307 per supplier.`,
    `${can('setup', 'create') ? `<button class="btn" onclick="birSettings()">BIR settings</button>` : ''}`) +
  `<div class="card filters"><div class="form-grid">
    <label class="fld"><span>Company</span><select id="bi_co">${optionsHtml(DB.companies.filter(c => userCompanies().includes(c.code)).map(c => [c.code, `${c.code} – ${c.name}`]), co, false)}</select></label>
    <label class="fld"><span>Year</span><select id="bi_y">${optionsHtml(yrs, BIR.year, false)}</select></label>
    <label class="fld"><span>Period</span><select id="bi_k">${optionsHtml([['Q', 'Quarter (QAP / 2307)'], ['M', 'Month (MAP)']], BIR.kind, false)}</select></label>
    <label class="fld"><span>${BIR.kind === 'Q' ? 'Quarter' : 'Month'}</span><select id="bi_p">${BIR.kind === 'Q' ? optionsHtml([['1', 'Q1 (Jan–Mar)'], ['2', 'Q2 (Apr–Jun)'], ['3', 'Q3 (Jul–Sep)'], ['4', 'Q4 (Oct–Dec)']], BIR.q, false) : optionsHtml(Array.from({ length: 12 }, (_, i) => [String(i + 1), new Date(2000, i, 1).toLocaleString('en', { month: 'long' })]), BIR.m, false)}</select></label></div>
    <button class="btn primary" onclick="BIR.co=$('#bi_co').value;BIR.year=$('#bi_y').value;const k=$('#bi_k').value;if(k===BIR.kind){BIR.kind==='Q'?BIR.q=$('#bi_p').value:BIR.m=$('#bi_p').value}BIR.kind=k;render()">Show</button></div>
  <div class="tiles"><a class="tile"><span>Payees</span><b>${payees.length}</b><small>${esc(P.label)}</small></a><a class="tile"><span>Income payments</span><b>₱${money(totB)}</b><small>subject to EWT</small></a>
    <a class="tile"><span>Tax withheld</span><b>₱${money(totT)}</b><small>G/L: ₱${money(gl)} ${Math.abs(gl - totT) < 0.01 ? '✔' : '⚠'}</small></a><a class="tile"><span>Documents</span><b>${new Set(L.map(l => l.docNo)).size}</b><small>posted invoices / credit memos</small></a></div>
  ${warn.length ? `<div class="alertbox warn"><span>⚠</span><div><b>Check before filing</b>${warn.join('<br>')}</div></div>` : ''}
  <div class="card"><div class="lines-head"><div class="segs"><button class="${BIR.tab === 'qap' ? 'on' : ''}" onclick="BIR.tab='qap';render()">Alphalist of Payees (${BIR.kind === 'Q' ? 'QAP' : 'MAP'})</button>${BIR.kind === 'Q' ? `<button class="${BIR.tab === '2307' ? 'on' : ''}" onclick="BIR.tab='2307';render()">Form 2307 per supplier</button>` : ''}<button class="${BIR.tab === 'det' ? 'on' : ''}" onclick="BIR.tab='det';render()">Details by document</button></div>
    <span style="display:flex;gap:8px;flex-wrap:wrap">${A.length ? `<button class="btn sm" onclick="birExport()">⬇ Excel</button>${BIR.kind === 'Q' ? `<button class="btn sm primary" onclick="bir2307All()">🖨 Print all 2307</button>` : ''}` : ''}</span></div>
  ${!A.length ? `<p class="muted" style="margin:0">No expanded withholding tax on posted purchase invoices in ${esc(P.label)}.</p>` : BIR.tab === '2307' && BIR.kind === 'Q' ? bir2307List(A, P) : BIR.tab === 'det' ? birDetail(L) : birQapTable(A, totB, totT)}</div>
  <p class="small muted">Income payment = the invoice line amount before VAT, in pesos; credit memos reduce it. Individual suppliers (WHT Bus. group VIND) are shown with WI codes. The BIR .dat file for the Alphalist Data Entry will be added once we have a sample file from your current system.</p>`;
});
function birQapTable(A, totB, totT) {
  return `<div class="tbl-wrap"><table class="grid compact"><thead><tr><th class="num">Seq.</th><th>TIN</th><th>Registered name</th><th>ATC</th><th>Nature of income payment</th><th class="num">Rate</th><th class="num">Income payment</th><th class="num">Tax withheld</th></tr></thead><tbody>
    ${A.map(r => `<tr><td class="num">${r.seq}</td><td style="white-space:nowrap">${esc(birTin(r.tin).fmt)}</td><td>${esc(r.name)}${r.ind ? ' <span class="small muted">(individual)</span>' : ''}</td><td>${esc(r.atc)}</td><td class="small">${esc(r.nature)}</td><td class="num">${r.rate}%</td><td class="num">${money(r.base)}</td><td class="num">${money(r.tax)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="6"><b>Total</b></td><td class="num"><b>${money(totB)}</b></td><td class="num"><b>${money(totT)}</b></td></tr></tfoot></table></div>`;
}
function birDetail(L) {
  return `<div class="tbl-wrap"><table class="grid compact"><thead><tr><th>Date</th><th>Document</th><th>Supplier invoice</th><th>Supplier</th><th>ATC</th><th class="num">Rate</th><th class="num">Income payment</th><th class="num">Tax withheld</th></tr></thead><tbody>
    ${L.map(l => `<tr class="link" onclick="go('#/doc/${l.docType}/${l.docId}')"><td>${esc(l.date)}</td><td>${esc(l.docNo)}</td><td>${esc(l.extNo)}</td><td>${esc(l.name)}</td><td>${esc(l.atc)}</td><td class="num">${l.rate}%</td><td class="num">${money(l.base)}</td><td class="num">${money(l.tax)}</td></tr>`).join('')}</tbody></table></div>`;
}
function bir2307List(A, P) {
  const by = {}; for (const r of A) (by[r.vendor] = by[r.vendor] || { name: r.name, tin: r.tin, base: 0, tax: 0, atcs: [] }), by[r.vendor].base += r.base, by[r.vendor].tax += r.tax, by[r.vendor].atcs.push(r.atc);
  return `<div class="tbl-wrap"><table class="grid compact"><thead><tr><th>Supplier</th><th>TIN</th><th>ATC</th><th class="num">Income payments</th><th class="num">Tax withheld</th><th></th></tr></thead><tbody>
    ${Object.entries(by).map(([v, x]) => `<tr><td><b>${esc(x.name)}</b> <span class="small muted">${esc(v)}</span></td><td>${esc(birTin(x.tin).fmt)}</td><td>${esc([...new Set(x.atcs)].join(', '))}</td><td class="num">${money(x.base)}</td><td class="num">${money(x.tax)}</td>
      <td><button class="btn sm primary" onclick="bir2307(['${v.replace(/'/g, "\\'")}'])">🖨 2307</button></td></tr>`).join('')}</tbody></table></div><p class="small muted" style="margin:8px 0 0">One certificate per supplier for ${esc(P.label)}, income payments split by month of the quarter.</p>`;
}
function bir2307All() { const P = birPeriod(), A = birAlphalist(birLines(BIR.co, P.from, P.to)); bir2307([...new Set(A.map(r => r.vendor))]); }
function bir2307(vendors) {
  const co = BIR.co, P = birPeriod(), L = birLines(co, P.from, P.to), cfg = birCfg(co), w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups to print the 2307.', 'err');
  const f = d => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`, box = (n, l, v, wide) => `<div class="b ${wide ? 'w' : ''}"><span>${n}</span><label>${l}</label><div>${esc(v || '')}</div></div>`;
  const m$ = v => v ? Number(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
  const ptin = birTin(cfg.tin);
  const pages = vendors.map(vno => {
    const ls = L.filter(l => l.vendor === vno); if (!ls.length) return '';
    const v = ls[0], vt = birTin(v.tin), rows = {};
    for (const l of ls) { const k = `${l.atc}|${l.rate}`; const r = rows[k] = rows[k] || { atc: l.atc, nature: l.nature, rate: l.rate, m: [0, 0, 0], tax: 0 }; r.m[P.months.indexOf(l.month)] += l.base; r.tax += l.tax; }
    const R = Object.values(rows), tot = [0, 1, 2].map(i => sum(R, r => r.m[i])), tt = sum(R, 'tax');
    return `<section class="pg"><div class="hd"><div><b>BIR Form No. 2307</b><br><small>January 2018 (ENCS)</small></div><div class="t">Certificate of Creditable Tax<br>Withheld at Source</div><div class="r"><small>Republic of the Philippines<br>Department of Finance<br>Bureau of Internal Revenue</small></div></div>
      <div class="row">${box('1', 'For the Period From (MM/DD/YYYY)', f(P.from))}${box('', 'To (MM/DD/YYYY)', f(P.to))}</div>
      <h3>Part I – Payee Information</h3>
      <div class="row">${box('2', 'Taxpayer Identification Number (TIN)', vt.fmt, 1)}</div><div class="row">${box('3', 'Payee\'s Name (Last Name, First Name, Middle Name for Individual OR Registered Name for Non-Individual)', v.name, 1)}</div>
      <div class="row">${box('4', 'Registered Address', v.address, 1)}${box('4A', 'ZIP Code', '')}</div><div class="row">${box('5', 'Foreign Address, if applicable', '', 1)}</div>
      <h3>Part II – Payor Information</h3>
      <div class="row">${box('6', 'Taxpayer Identification Number (TIN)', ptin.fmt, 1)}</div><div class="row">${box('7', 'Payor\'s Name (Last Name, First Name, Middle Name for Individual OR Registered Name for Non-Individual)', cfg.name, 1)}</div>
      <div class="row">${box('8', 'Registered Address', cfg.address, 1)}${box('8A', 'ZIP Code', cfg.zip)}</div>
      <h3>Part III – Details of Monthly Income Payments and Taxes Withheld</h3>
      <table><thead><tr><th rowspan="2">Income Payments Subject to Expanded Withholding Tax</th><th rowspan="2">ATC</th><th colspan="4">AMOUNT OF INCOME PAYMENTS</th><th rowspan="2">Tax Withheld for the Quarter</th></tr><tr><th>1st Month of the Quarter</th><th>2nd Month of the Quarter</th><th>3rd Month of the Quarter</th><th>Total</th></tr></thead><tbody>
        ${R.map(r => `<tr><td>${esc(r.nature)} (${r.rate}%)</td><td>${esc(r.atc)}</td>${r.m.map(x => `<td class="n">${m$(x)}</td>`).join('')}<td class="n">${m$(sum(r.m, x => x))}</td><td class="n">${m$(r.tax)}</td></tr>`).join('')}
        ${Array.from({ length: Math.max(0, 4 - R.length) }, () => '<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>').join('')}
        <tr class="tot"><td>Total</td><td></td>${tot.map(x => `<td class="n">${m$(x)}</td>`).join('')}<td class="n">${m$(sum(tot, x => x))}</td><td class="n">${m$(tt)}</td></tr>
        <tr><th colspan="7" style="text-align:left">Money Payments Subject to Withholding of Business Tax (Government &amp; Private)</th></tr>
        <tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td></tr><tr class="tot"><td>Total</td><td></td><td></td><td></td><td></td><td></td><td></td></tr></tbody></table>
      <p class="decl">We declare under the penalties of perjury that this certificate has been made in good faith, verified by us, and to the best of our knowledge and belief, is true and correct, pursuant to the provisions of the National Internal Revenue Code, as amended, and the regulations issued under authority thereof. Further, we give our consent to the processing of our information as contemplated under the Data Privacy Act of 2012 (R.A. No. 10173) for legitimate and lawful purposes.</p>
      <div class="sig"><div><b>${esc(cfg.sigName)}</b>${cfg.sigTitle ? ` – ${esc(cfg.sigTitle)}` : ''}${cfg.sigTin ? ` – TIN ${esc(cfg.sigTin)}` : ''}<br>Signature over Printed Name of Payor/Payor's Authorized Representative/Tax Agent<br>(Indicate Title/Designation and TIN)</div>
        <div class="row3"><span>Tax Agent Accreditation No./ Attorney's Roll No. (if applicable)</span><span>Date of Issue (MM/DD/YYYY)</span><span>Date of Expiry (MM/DD/YYYY)</span></div>
        <div style="margin-top:18px"><b>CONFORME:</b><br><br>Signature over Printed Name of Payee/Payee's Authorized Representative/Tax Agent<br>(Indicate Title/Designation and TIN)</div>
        <div class="row3"><span>Tax Agent Accreditation No./ Attorney's Roll No. (if applicable)</span><span>Date of Issue (MM/DD/YYYY)</span><span>Date of Expiry (MM/DD/YYYY)</span></div></div>
      <p class="ft">System-generated from the Leonio ERP on ${new Date().toLocaleString('en-PH')} · ${esc(cfg.name)} · ${esc(P.label)} · documents ${esc([...new Set(ls.map(l => l.docNo + (l.extNo ? ' (' + l.extNo + ')' : '')))].join(', '))}</p></section>`;
  }).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>BIR 2307 ${esc(P.label)}</title><style>@page{size:A4;margin:10mm} body{font:10.5px Arial,sans-serif;color:#000;margin:0}
    .pg{page-break-after:always;border:1.5px solid #000;padding:8px 10px} .pg:last-child{page-break-after:auto}
    .hd{display:grid;grid-template-columns:1fr 2fr 1fr;align-items:center;border-bottom:1.5px solid #000;padding-bottom:6px;margin-bottom:6px} .hd .t{text-align:center;font-size:15px;font-weight:700} .hd .r{text-align:right}
    h3{background:#000;color:#fff;font-size:10.5px;margin:8px 0 4px;padding:3px 6px} .row{display:flex;gap:6px;margin-bottom:4px} .b{border:1px solid #000;padding:2px 5px;min-width:120px;position:relative} .b.w{flex:1}
    .b span{font-weight:700;margin-right:4px} .b label{font-size:8.5px} .b div{font-size:11.5px;font-weight:600;min-height:14px}
    table{border-collapse:collapse;width:100%} td,th{border:1px solid #000;padding:3px 4px;font-size:9.5px;vertical-align:top} th{background:#e9e9e9} td.n{text-align:right;white-space:nowrap} tr.tot td{font-weight:700}
    .decl{font-size:9px;margin:8px 0} .sig{font-size:9px;text-align:center} .row3{display:grid;grid-template-columns:2fr 1fr 1fr;border-top:1px solid #000;margin-top:16px;padding-top:2px}
    .ft{font-size:8px;color:#444;margin:8px 0 0}</style></head><body>${pages}<script>setTimeout(()=>window.print(),300)<\/script></body></html>`);
  w.document.close();
}
function birExport() {
  const co = BIR.co, P = birPeriod(), A = birAlphalist(birLines(co, P.from, P.to)), cfg = birCfg(co), pt = birTin(cfg.tin);
  const rows = [[`${BIR.kind === 'Q' ? 'QUARTERLY' : 'MONTHLY'} ALPHALIST OF PAYEES (${BIR.kind === 'Q' ? 'QAP – attachment to BIR Form 1601-EQ' : 'MAP – attachment to BIR Form 0619-E'})`], [`For the period ${P.label} (${P.from} to ${P.to})`],
    [`TIN: ${pt.fmt}`], [`Withholding agent: ${cfg.name}`], [], ['Seq. No.', 'TIN', 'Branch Code', 'Registered Name', 'Last Name', 'First Name', 'Middle Name', 'ATC', 'Nature of Income Payment', 'Tax Rate (%)', 'Amount of Income Payment', 'Amount of Tax Withheld']];
  for (const r of A) { const t = birTin(r.tin); rows.push([r.seq, t.tin, t.branch, r.ind ? '' : r.name, r.ind ? r.name : '', '', '', r.atc, r.nature, r.rate, r.base, r.tax]); }
  rows.push([], ['', '', '', 'Grand Total', '', '', '', '', '', '', r2(sum(A, 'base')), r2(sum(A, 'tax'))]);
  downloadBlob(xlsxBlob(BIR.kind === 'Q' ? 'QAP' : 'MAP', rows, [8, 12, 8, 36, 20, 14, 14, 8, 40, 8, 16, 16]), fileSafe(`${BIR.kind === 'Q' ? 'QAP' : 'MAP'}_${co}_${P.label.replace(/\s+/g, '_')}.xlsx`));
  toast('Alphalist exported to Excel.');
}
function birSettings() {
  const co = BIR.co || S.company, c = birCfg(co);
  const F = [{ k: 'name', l: 'Registered name (withholding agent)', w: 'w2' }, { k: 'tin', l: 'TIN (000-000-000-0000)' }, { k: 'rdo', l: 'RDO code' }, { k: 'address', l: 'Registered address', w: 'w2' }, { k: 'zip', l: 'ZIP code' },
    { k: 'sigName', l: 'Signatory (authorized representative)' }, { k: 'sigTitle', l: 'Title / designation' }, { k: 'sigTin', l: 'Signatory TIN' }];
  modal(`BIR settings – ${co}`, `<div class="form-grid">${F.map(f => fieldHtml(f, c[f.k], 'bs')).join('')}</div><p class="small muted">Printed on Form 2307 and the alphalists. The TIN and address are also saved on the company card.</p>`, async () => {
    const v = readForm(F, 'bs');
    if (v.tin && birTin(v.tin).tin.length < 9) { toast('The TIN needs 9 digits (plus the 3–4 digit branch code).', 'err'); return false; }
    const ok = await commit(() => { if (!can('setup', 'create')) fail(permMsg('setup', 'create')); DB.settings.bir = DB.settings.bir || {}; DB.settings.bir[co] = v; const cc = DB.companies.find(x => x.code === co); if (cc) { cc.tin = v.tin; cc.address = v.address; } }, 'Changed BIR settings', co);
    if (ok !== false) render(); else return false;
  }, 'Save', true);
}
