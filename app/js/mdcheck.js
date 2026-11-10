'use strict';
/* ============ Master Data Check: the consistency checks Business Central enforces at posting time ============ */
function mdChecks(set) {
  const m = DB.md[set], acc = new Set(m.accounts.filter(a => a.type === 'Posting').map(a => a.no));
  const codes = arr => new Set(arr.map(x => U(x.code)));
  const gBus = codes(m.genBus), gProd = codes(m.genProd), vBus = codes(m.vatBus), vProd = codes(m.vatProd), wBus = codes(m.whtBus), wProd = codes(m.whtProd);
  const vpg = codes(m.vendPostGroups), cpg = codes(m.custPostGroups), fapg = codes(m.faPostGroups), bpg = codes(m.bankPostGroups);
  const invOk = g => m.invSetup.some(s => U(s.group) === U(g) && s.inventory) || m.invPostGroups.some(x => U(x.code) === U(g) && x.inventory);
  const gs = (b, p) => m.genSetup.find(r => U(r.bus) === U(b) && U(r.prod) === U(p));
  const C = [];
  const add = (area, check, list, bad, show, fix) => C.push({ area, check, total: list.length, bad: list.filter(bad), show, fix });
  add('Vendors', 'Vendor Posting Group exists', m.vendors, v => !vpg.has(U(v.postingGroup)), v => `${v.no} (${v.postingGroup || 'blank'})`, 'Set a valid Vendor Posting Group on the vendor card.');
  add('Vendors', 'Gen. Bus. and VAT Bus. Posting Group exist', m.vendors, v => !gBus.has(U(v.genBus)) || !vBus.has(U(v.vatBus)), v => `${v.no} (${v.genBus || '—'}/${v.vatBus || '—'})`, 'Fill Gen. Bus. and VAT Bus. Posting Group.');
  add('Vendors', 'WHT Bus. Posting Group exists', m.vendors, v => v.whtBus && !wBus.has(U(v.whtBus)), v => `${v.no} (${v.whtBus})`, 'Use VCORP, VIND or VNOWHT.');
  const curOk = c => !c || U(c) === 'PHP' || m.currencies.some(x => U(x.code) === U(c));
  add('Currencies', 'Vendor/customer/bank currency codes exist in Currencies', [...m.vendors.map(v => ({ k: 'Vendor', no: v.no, c: v.currency })), ...m.customers.map(v => ({ k: 'Customer', no: v.no, c: v.currency })), ...m.bankAccounts.map(b => ({ k: 'Bank', no: b.code, c: b.currency }))], x => !curOk(x.c), x => `${x.k} ${x.no} (${x.c})`, 'Use a valid currency code (blank or PHP = pesos).');
  add('Currencies', 'Foreign currencies have gain/loss accounts', m.currencies.filter(c => U(c.code) !== 'PHP'), c => ['realizedGain', 'realizedLoss', 'unrealizedGain', 'unrealizedLoss'].some(k => !c[k] || !acc.has(c[k])), c => c.code, 'Fill the Realized/Unrealized Gains and Losses accounts on the currency.');
  add('Currencies', 'Exchange rate entered for currencies in use', [...new Set([...m.vendors, ...m.customers, ...m.bankAccounts].map(x => U(x.currency || '')).filter(c => c && c !== 'PHP' && m.currencies.some(x => U(x.code) === c)))], c => !(DB.fxRates || []).some(r => U(r.currency) === c), c => c, 'Enter rates under Treasury → Currency Exchange Rates.');
  add('Vendors', 'VAT Registration No. (TIN) filled', m.vendors, v => !v.tin, v => v.no, 'Required by your Vendor Card Master flow.');
  add('Customers', 'Customer Posting Group exists', m.customers, v => !cpg.has(U(v.postingGroup)), v => `${v.no} (${v.postingGroup || 'blank'})`, 'Set a valid Customer Posting Group.');
  add('Customers', 'Gen. Bus. and VAT Bus. Posting Group exist', m.customers, v => !gBus.has(U(v.genBus)) || !vBus.has(U(v.vatBus)), v => `${v.no} (${v.genBus || '—'}/${v.vatBus || '—'})`, 'Fill Gen. Bus. and VAT Bus. Posting Group.');
  add('Items', 'Gen. Prod. Posting Group exists', m.items, i => !gProd.has(U(i.genProd)), i => `${i.no} (${i.genProd || 'blank'})`, 'Add the Gen. Prod. Posting Group or correct the item.');
  add('Items', 'VAT Prod. Posting Group exists', m.items, i => !vProd.has(U(i.vatProd)), i => `${i.no} (${i.vatProd || 'blank'})`, 'Set the VAT Prod. Posting Group.');
  add('Items', 'WHT Prod. Posting Group exists', m.items, i => i.whtProd && !wProd.has(U(i.whtProd)), i => `${i.no} (${i.whtProd})`, 'Use a valid ATC code (e.g. WC158, WI010, NWHT).');
  add('Items', 'Inventory items have an Inventory Posting Setup', m.items.filter(i => i.type === 'Inventory'), i => !invOk(i.invPostGroup), i => `${i.no} (${i.invPostGroup || 'blank'})`, 'Add an Inventory Posting Setup line for the group, or set the item Type to Non-Inventory.');
  add('Items', 'Purchase account found (DOMESTIC × Gen. Prod.) for non-inventory/service items', m.items.filter(i => i.type !== 'Inventory'), i => { const r = gs('DOMESTIC', i.genProd); return !r || !r.purch; }, i => `${i.no} (${i.genProd})`, 'Add a General Posting Setup line DOMESTIC × group with a Purch. Account.');
  add('Items', 'Inventory Adjmt. Account found (item journals, physical counts)', m.items.filter(i => i.type === 'Inventory'), i => !m.genSetup.some(r => U(r.prod) === U(i.genProd) && r.invAdj), i => `${i.no} (${i.genProd})`, 'Fill Inventory Adjmt. Account in General Posting Setup for this group.');
  add('Items', 'Sales and COGS Account found (inventory items with a unit price)', m.items.filter(i => i.type === 'Inventory' && num(i.unitPrice) > 0), i => { const r = gs('DOMESTIC', i.genProd); return !r || !r.cogs || !r.sales; }, i => `${i.no} (${i.genProd})`, 'Fill Sales and COGS Account in General Posting Setup.');
  add('Posting Setup', 'General Posting Setup accounts exist in the chart of accounts', m.genSetup, g => ['sales', 'purch', 'cogs', 'invAdj', 'salesCM', 'purchCM'].some(k => g[k] && !acc.has(g[k])), g => `${g.bus || '(blank)'}×${g.prod}`, 'Correct the account number or add the G/L account.');
  add('Posting Setup', 'Inventory Posting Setup accounts exist in the chart of accounts', m.invSetup, g => g.inventory && !acc.has(g.inventory), g => `${g.location || ''} ${g.group} (${g.inventory})`, 'Correct the Inventory Account.');
  add('Posting Setup', 'Vendor/Customer/Bank posting group accounts exist', [...m.vendPostGroups.map(g => ({ code: g.code, a: g.payables })), ...m.custPostGroups.map(g => ({ code: g.code, a: g.receivables })), ...m.bankPostGroups.map(g => ({ code: g.code, a: g.glAccount }))], g => !acc.has(g.a), g => `${g.code} (${g.a || 'blank'})`, 'Correct the account.');
  add('VAT / WHT', 'VAT Posting Setup accounts exist in the chart of accounts', m.vatSetup, g => ['salesAcc', 'purchAcc'].some(k => g[k] && !acc.has(g[k])), g => `${g.bus}×${g.prod}`, 'Correct the VAT account.');
  add('VAT / WHT', 'VAT setup exists for every vendor VAT Bus. × item VAT Prod. combination in use', [...new Set(m.vendors.map(v => v.vatBus).filter(Boolean))].flatMap(b => [...new Set(m.items.map(i => i.vatProd).filter(Boolean))].map(p => ({ b, p }))), x => !m.vatSetup.some(s => U(s.bus) === U(x.b) && U(s.prod) === U(x.p)), x => `${x.b}×${x.p}`, 'Add the VAT Posting Setup line (posting is blocked when this combination is used).');
  add('VAT / WHT', 'WHT Posting Setup accounts exist in the chart of accounts', m.whtSetup, g => ['payableAcc', 'prepaidAcc'].some(k => g[k] && !acc.has(g[k])), g => `${g.bus}×${g.prod}`, 'Correct the WHT account.');
  add('Fixed Assets', 'FA Posting Group exists', m.fixedAssets, f => !fapg.has(U(f.postGroup)), f => `${f.no} (${f.postGroup || 'blank'})`, 'Set the FA Posting Group (or Default FA Posting Group on the subclass).');
  add('Fixed Assets', 'FA Posting Group accounts exist in the chart of accounts', m.faPostGroups, g => !g.acqCost || ['acqCost', 'accumDep', 'depExp'].some(k => g[k] && !acc.has(g[k])), g => g.code, 'Correct the FA posting accounts.');
  add('Banks', 'Bank Acc. Posting Group exists', m.bankAccounts, b => !bpg.has(U(b.postingGroup)), b => `${b.code} (${b.postingGroup || 'blank'})`, 'Set the Bank Acc. Posting Group.');
  add('Number Series', 'Each document type is mapped to a No. Series', Object.keys(DOCS).filter(t => !['DEP', 'FAD', 'PR'].includes(t) && !DOCS[t].noSeries), t => !m.settings.docSeries[t], t => DOCS[t].name, 'Map it in Settings → Number series.');
  return C;
}
route('mdcheck', (setArg) => {
  const set = setArg || MDS();
  const checks = mdChecks(set), issues = checks.filter(c => c.bad.length);
  const notes = (DB.md[set].importNotes || []).map(n => `<li>${esc(n)}</li>`).join('');
  return pageHead(`Master Data Check – ${set}`, `The checks the ERP applies when posting, run against the imported configuration package. <b>${checks.length - issues.length}</b> of ${checks.length} checks pass. Fix the rest in the configuration package and re-import, or directly in the ERP.`,
    Object.keys(DB.md).map(s => `<button class="btn ${s === set ? 'primary' : ''}" onclick="go('#/mdcheck/${s}')">${s}</button>`).join('')) +
    (notes ? `<div class="card"><h3>Corrected automatically during import</h3><ul>${notes}</ul></div>` : '') +
    `<div class="card"><table class="grid"><thead><tr><th>Area</th><th>Check</th><th class="num">Records</th><th class="num">Problems</th><th>Examples</th><th>How to fix</th></tr></thead><tbody>
    ${checks.map(c => `<tr><td>${esc(c.area)}</td><td>${esc(c.check)}</td><td class="num">${c.total}</td><td class="num">${c.bad.length ? `<span class="badge s-rejected">${c.bad.length}</span>` : '<span class="badge s-posted">OK</span>'}</td>
      <td class="small">${esc(c.bad.slice(0, 5).map(c.show).join(', '))}${c.bad.length > 5 ? ' …' : ''}</td><td class="small">${c.bad.length ? esc(c.fix) : ''}</td></tr>`).join('')}</tbody></table></div>`;
});
