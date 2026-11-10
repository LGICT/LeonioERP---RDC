'use strict';
/* ============ Deposit invoices (Deposit 1, Deposit 2, Provisional) and the final invoice — decision 20 ============
   A deposit invoice is a Sales Invoice made from the sales contract. It posts Dr Receivables / Cr Sales Prepayments Account
   (General Posting Setup of the buyer × commodity; in the Mining setup 2124080 Advances from Customers), as Business Central's
   prepayment invoices do. It follows the normal Sales Invoice approval (Accounting Shared Manager) and is collected through the
   Cash Receipt Journal. The final invoice bills the loaded quantity and deducts every posted deposit invoice:
   Dr Sales Prepayments / Cr Receivables, with any exchange difference to realized gain/loss. */
const ncCanBill = () => isAdmin() || ['Billing / Sales Associate', 'General Accounting Supervisor', 'Accounting Manager - Shared Service'].some(hasRole);
const ncFinalOf = c => DB.docs.find(s => s.type === 'SI' && s.finalOf === c.id && !['Cancelled', 'Rejected'].includes(s.status));
function ncPrepayAcc(c) {
  const co = c.company, it = itemOf(c.item, co), cu = customerOf(c.customer, co);
  const row = it && cu ? genSetupRow(co, cu.genBus, it.genProd) : null;
  if (!row || !row.salesPrepay) fail(`Sales Prepayments Account is missing in General Posting Setup for ${cu ? cu.genBus : '?'} × ${it ? it.genProd : '?'}. Add it under Posting Setup → General Posting Setup.`);
  return row.salesPrepay;
}
function ncNewSI(c, extra) {
  const si = newDoc('SI');
  Object.assign(si, { company: c.company, customer: c.customer, date: today() });
  copyPartyToDoc(si);
  Object.assign(si, { currency: isFCY(c.currency) ? c.currency : '', customerPO: c.contractRef, dims: clone(c.dims || {}), ...extra });
  si.id = uid(); si.no = nextNo('SI', c.company); si.createdBy = curUser().id; si.createdAt = new Date().toISOString();
  return si;
}
async function ncMakeDepInv(i) {
  let newId = '';
  const ok = await commit(() => {
    if (!ncCanBill()) fail('Only Accounting (billing) can create the invoice.');
    const c = DB.docs.find(x => x.id === NC.id), x = c.deposits[i], s = ncDepStatus(c, x);
    if (s.st !== 'Due') fail(`${x.label} is ${s.st.toLowerCase()}; it cannot be invoiced now.`);
    const it = itemOf(c.item, c.company), acc = ncPrepayAcc(c), amt = ncDepAmt(c, x);
    // VAT on the deposit follows your "Contract Deposit - Foreign / Local" item (NONVATS for foreign buyers), else the commodity's
    const cu = customerOf(c.customer, c.company), foreign = U(cu.genBus) === 'FOREIGN' || isFCY(c.currency);
    const depItems = M(c.company).items.filter(i => U(i.genProd) === 'CONTRACT DEPOSIT');
    const depItem = depItems.find(i => /foreign/i.test(i.description) === foreign) || depItems[0];
    const vatProd = depItem && vatRow(c.company, cu.vatBus, depItem.vatProd) ? depItem.vatProd : it.vatProd;
    const si = ncNewSI(c, { dueDate: s.due, prepay: { contractId: c.id, contractNo: c.no, uid: x.uid, label: x.label },
      remarks: `${x.label} (pro forma) for ${c.no}, contract no. ${c.contractRef}. Shipment ${c.shipmentNo || '—'}.` });
    si.lines = [{ type: 'G/L Account', no: acc, description: `${x.label}: ${x.basis === 'Fixed amount' ? 'fixed amount' : num(x.pct) + '% of contract value'} – ${c.no} (${qtyf(c.volume)} WMT × ${c.currency} ${money(c.price)})`,
      qty: 1, price: amt, uom: '', vatProd, genProd: it.genProd, whtProd: '' }];
    DB.docs.push(si); newId = si.id;
    ersHist(c, `${x.label} invoice created`, `${si.no} · ${c.currency} ${money(amt)}`);
  }, 'Created deposit invoice from sales contract', NC.no);
  if (ok !== false) { toast('Deposit invoice created as a draft. Check it and send it for approval.'); NC = null; go(`#/doc/SI/${newId}`); }
}
async function ncMakeFinal() {
  let newId = '';
  const ok = await commit(() => {
    if (!ncCanBill()) fail('Only Accounting (billing) can create the invoice.');
    const c = DB.docs.find(x => x.id === NC.id);
    if (ncFinalOf(c)) fail('A final invoice already exists for this contract.');
    ncPrepayAcc(c);
    const pend = c.deposits.filter(x => { const s = ncDepStatus(c, x); return s.inv && s.inv.status !== 'Posted'; });
    if (pend.length) fail(`Post or cancel the open deposit invoice(s) first: ${pend.map(x => `${x.label} ${ncDepStatus(c, x).inv.no}`).join(', ')}.`);
    const si = ncNewSI(c, { finalOf: c.id, remarks: `Final invoice for ${c.no}, contract no. ${c.contractRef}. Vessel ${c.vesselName || '—'}, B/L ${c.blDate || '—'}. Quantity per Certificate of Weight; posted deposit invoices are deducted when this invoice is posted.` });
    const l = { type: 'Item', no: c.item, qty: num(c.loadedWmt) || num(c.volume) }; lineDefaults(si, l); l.price = num(c.price);
    si.lines = [l];
    DB.docs.push(si); newId = si.id;
    ersHist(c, 'Final invoice created', si.no);
  }, 'Created final invoice from sales contract', NC.no);
  if (ok !== false) { toast('Final invoice created as a draft. Enter the final quantity (COW), price adjustments and the location, then send it for approval.'); NC = null; go(`#/doc/SI/${newId}`); }
}
/* deductions of the posted deposit invoices, worked out when the final invoice is posted */
function ncDeductions(si) {
  const c = DB.docs.find(x => x.id === si.finalOf); if (!c) return [];
  let left = docTotals(si).total; const out = [];
  for (const x of c.deposits) {
    const s = ncDepStatus(c, x); if (!s.inv || s.inv.status !== 'Posted' || x.deductedIn) continue;
    const e = ncArOf(c.company, s.inv.no); if (!e) continue;
    const amt = r2(Math.min(num(e.amount), left)); if (amt <= 0) break; left = r2(left - amt);
    out.push({ x, inv: s.inv.no, label: x.label, amount: amt, rate: num(e.rate) || 1 });
  }
  return out;
}
const _postSI_nc = POSTERS.SI;
POSTERS.SI = function (d) {
  _postSI_nc(d);
  if (!d.finalOf) return;
  const c = DB.docs.find(x => x.id === d.finalOf), co = d.company, cu = customerOf(d.customer, co), R = docRate(d), acc = ncPrepayAcc(c), ar = customerReceivables(co, cu);
  const ded = ncDeductions(d); if (!ded.length) return;
  const gl = [];
  for (const k of ded) {
    const lcyDep = r2(k.amount * k.rate), lcyAR = r2(k.amount * R);
    gl.push({ account: acc, debit: lcyDep, desc: `Deduct ${k.label} ${k.inv}` }, { account: ar, credit: lcyAR, desc: `Deduct ${k.label} ${k.inv}` });
    const fx = isFCY(d.currency) ? fxLine(co, d.currency, lcyAR - lcyDep, true, `Exchange difference on ${k.label}`) : null; if (fx) gl.push(fx);
    k.x.deductedIn = d.no;
  }
  postGL(d, gl, 'customer', d.customer);
  const tot = r2(sum(ded, 'amount')), e = ncArOf(co, d.no);
  if (e) { e.amount = r2(num(e.amount) - tot); e.remaining = r2(num(e.remaining) - tot); }
  d.prepayDeducted = ded.map(k => ({ label: k.label, inv: k.inv, amount: k.amount }));
  ersHist(c, 'Final invoice posted', `${d.no}: ${d.currency || 'PHP'} ${money(docTotals(d).total)} less deposits ${money(tot)}`);
};
/* panel on the Sales Invoice page */
const _relatedPanel_nc = relatedPanel;
relatedPanel = function () {
  const d = ED, base = _relatedPanel_nc();
  if (!d || d.type !== 'SI' || !(d.prepay || d.finalOf)) return base;
  const c = DB.docs.find(x => x.id === (d.prepay ? d.prepay.contractId : d.finalOf)); if (!c) return base;
  let html;
  if (d.prepay) {
    let acc = ''; try { acc = ncPrepayAcc(c); } catch (e) { }
    html = `<p style="margin:0">This is the <b>${esc(d.prepay.label)}</b> invoice for sales contract <a href="#/nospa/${c.id}">${esc(c.no)}</a>. When posted it is recorded as an advance from the buyer (${esc(acc)} ${esc(accName(acc, c.company))}), not as sales; the final invoice deducts it.</p>`;
  } else {
    const ded = d.status === 'Posted' ? (d.prepayDeducted || []) : ncDeductions(d), tot = r2(sum(ded, 'amount')), total = docTotals(d).total, cur = d.currency || 'PHP';
    html = `<p style="margin:0 0 8px">Final invoice for sales contract <a href="#/nospa/${c.id}">${esc(c.no)}</a>. ${d.status === 'Posted' ? 'Deposits deducted:' : 'These posted deposit invoices will be deducted when this invoice is posted:'}</p>
      <table class="grid compact"><tbody>${ded.map(k => `<tr><td>${esc(k.label)}</td><td>${esc(k.inv)}</td><td class="num">${esc(cur)} ${money(k.amount)}</td></tr>`).join('') || '<tr><td class="empty">No posted deposit invoices.</td></tr>'}</tbody>
      <tfoot><tr><td colspan="2">Invoice total</td><td class="num">${esc(cur)} ${money(total)}</td></tr><tr><td colspan="2">Less deposits</td><td class="num">${esc(cur)} ${money(tot)}</td></tr><tr><td colspan="2"><b>Amount due from the buyer</b></td><td class="num"><b>${esc(cur)} ${money(total - tot)}</b></td></tr></tfoot></table>`;
  }
  return `<div class="card"><h3>Sales contract</h3>${html}</div>` + base;
};
/* settlement statement on the contract: deposits vs total charges → refund or balance to collect (Gap 29) */
function ncSettlementCard(c) {
  const fin = ncFinalOf(c), cur = c.currency;
  const deps = c.deposits.map(x => ({ x, s: ncDepStatus(c, x) }));
  const invoiced = r2(sum(deps.filter(o => o.s.inv && o.s.inv.status === 'Posted'), o => ncDepAmt(c, o.x)));
  const collected = r2(sum(deps, o => num(o.s.paid)));
  const charges = fin ? docTotals(fin).total : r2((num(c.loadedWmt) || num(c.volume)) * num(c.price));
  let finPaid = 0; if (fin && fin.status === 'Posted') { const e = ncArOf(c.company, fin.no); if (e) finPaid = r2(num(e.amount) - num(e.remaining)); }
  const bal = r2(charges - collected - finPaid);
  return `<div class="card"><h3>Settlement</h3><div class="kvlist">
    <div><span>Total charges${fin ? ` (${esc(fin.no)}${fin.status !== 'Posted' ? ', ' + esc(fin.status.toLowerCase()) : ''})` : ' (estimate)'}</span><b>${esc(cur)} ${money(charges)}</b></div>
    <div><span>Deposits invoiced</span><b>${esc(cur)} ${money(invoiced)}</b></div><div><span>Deposits collected</span><b>${esc(cur)} ${money(collected)}</b></div>
    ${finPaid ? `<div><span>Collected on final invoice</span><b>${esc(cur)} ${money(finPaid)}</b></div>` : ''}
    <div><span>${bal < 0 ? 'Refund to the buyer' : 'Balance to collect'}</span><b style="color:${bal < 0 ? 'var(--bad)' : 'var(--primary)'}">${esc(cur)} ${money(Math.abs(bal))}</b></div></div>
    ${bal < -0.005 ? '<p class="small muted" style="margin:8px 0 0">Deposits exceed the charges. Treasury refunds the buyer through the Cash Receipt Journal (Refund).</p>' : ''}</div>`;
}
