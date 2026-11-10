'use strict';
/* ============ Sales Order (decision 21) ============
   BC Sales Order → Release → "Create Sales Invoice" for the quantity to invoice now. Partial invoicing is tracked per line
   (Quantity Invoiced); the order is Completed when everything is invoiced. Ore sales: the Sales Contract creates the order
   after loading, and invoices made from that order are final invoices that deduct the posted deposits.
   The 50 WMT per invoice limit of the current process is not copied (decision 21). */

DOCS.SO = { name: 'Sales Order', plural: 'Sales Orders', party: 'customer', lines: 'sales', post: false, tax: true, bc: 'Sales Order → Release → Create Sales Invoice',
  desc: 'Customer order for ore, fuel, equipment and other services. Once released (approved), invoices are created from it, in full or in parts.',
  head: [PARTY.customer, { k: 'date', l: 'Order Date', t: 'date', req: 1 }, ...CUR_FIELDS, { k: 'shipDate', l: 'Shipment Date', t: 'date' }, { k: 'location', l: 'Location Code', t: 'ref', ref: 'locations' },
    { k: 'customerPO', l: 'External Document No. (contract / customer PO)' }, { k: 'paymentTerms', l: 'Payment Terms Code', t: 'ref', ref: 'paymentTerms' }, ...POSTING_FIELDS(), { k: 'remarks', l: 'Remarks', t: 'textarea', w: 'w2' }] };
SALES_DOCS.push('SO');
DOC_TYPES_FOR_RULES.push('SO');

const soRemain = l => r4(num(l.qty) - num(l.qtyInvoiced));
const soOpenSI = so => DB.docs.find(x => x.type === 'SI' && x.soId === so.id && !['Posted', 'Cancelled', 'Rejected'].includes(x.status));
const soInvoices = so => DB.docs.filter(x => x.type === 'SI' && x.soId === so.id);

/* buttons on the Sales Order page (hook called by docActions) */
function extraButtons(btn) {
  const d = ED; if (!d || d.type !== 'SO') return;
  if (['Approved', 'Partially Invoiced'].includes(d.status) && (d.lines || []).some(l => soRemain(l) > 0)) btn('Create Sales Invoice ➜', 'soCreateSI()', 'primary');
}
async function soCreateSI() {
  let newId = '';
  const ok = await commit(() => {
    const so = dbDoc(); if (!['Approved', 'Partially Invoiced'].includes(so.status)) fail('Release (approve) the Sales Order first.');
    const open = soOpenSI(so); if (open) fail(`Invoice ${open.no} from this order is still ${open.status.toLowerCase()}. Post or delete it first.`);
    const lines = so.lines.map((l, i) => ({ l, i, rem: soRemain(l) })).filter(x => x.rem > 0);
    if (!lines.length) fail('Everything on this order is already invoiced.');
    const si = newDoc('SI');
    const keep = ['customer', 'currency', 'exchRate', 'location', 'customerPO', 'paymentTerms', 'genBus', 'vatBus', 'whtBus', 'pricesInclVat', 'postingGroup'];
    for (const k of keep) si[k] = clone(so[k] ?? '');
    Object.assign(si, { company: so.company, date: today(), dims: clone(so.dims || {}), soId: so.id, soNo: so.no, remarks: `From Sales Order ${so.no}. ${so.remarks || ''}`.trim() });
    si.dueDate = addDays(si.date, (M(si.company).paymentTerms.find(t => t.code === si.paymentTerms) || {}).days || 0);
    if (so.nospaId) si.finalOf = so.nospaId;           // ore: invoice from the contract's order is the final invoice
    si.lines = lines.map(x => ({ ...clone(x.l), qty: x.rem, soLine: x.i, qtyInvoiced: undefined }));
    si.id = uid(); si.no = nextNo('SI', si.company); si.createdBy = curUser().id; si.createdAt = new Date().toISOString();
    DB.docs.push(si); newId = si.id;
  }, 'Created Sales Invoice from Sales Order', ED.no);
  if (ok !== false) { toast('Sales Invoice created as a draft with the quantities still to invoice. Lower a quantity to invoice part now.'); go(`#/doc/SI/${newId}`); }
}
/* an invoice from an order may not bill more than is left on the order */
const _validateDoc_so = validateDoc;
validateDoc = function (d) {
  _validateDoc_so(d);
  if (d.type !== 'SI' || !d.soId) return;
  const so = DB.docs.find(x => x.id === d.soId); if (!so) return;
  for (const l of d.lines) {
    if (l.soLine == null) continue;
    const ol = so.lines[l.soLine]; if (!ol) continue;
    if (num(l.qty) > soRemain(ol) + 0.0001) fail(`${l.no}: ${qtyf(l.qty)} is more than the ${qtyf(soRemain(ol))} still to invoice on Sales Order ${so.no}.`);
  }
};
/* posting the invoice updates Quantity Invoiced and the order status */
const _postSI_so = POSTERS.SI;
POSTERS.SI = function (d) {
  _postSI_so(d);
  if (!d.soId) return;
  const so = DB.docs.find(x => x.id === d.soId); if (!so) return;
  for (const l of d.lines) if (l.soLine != null && so.lines[l.soLine]) so.lines[l.soLine].qtyInvoiced = r4(num(so.lines[l.soLine].qtyInvoiced) + num(l.qty));
  so.status = so.lines.every(l => soRemain(l) <= 0.0001) ? 'Completed' : 'Partially Invoiced';
};
/* related documents and the invoicing status on both pages */
const _relatedPanel_so = relatedPanel;
relatedPanel = function () {
  const d = ED, base = _relatedPanel_so();
  if (!d) return base;
  if (d.type === 'SO' && d.id) {
    const inv = soInvoices(d), c = d.nospaId ? DB.docs.find(x => x.id === d.nospaId) : null;
    return `<div class="card"><h3>Invoicing</h3><table class="grid compact"><thead><tr><th>Item / account</th><th class="num">Ordered</th><th class="num">Invoiced</th><th class="num">To invoice</th></tr></thead><tbody>
      ${(d.lines || []).map(l => `<tr><td>${esc(l.no)} ${esc(l.description || '')}</td><td class="num">${qtyf(l.qty)}</td><td class="num">${qtyf(l.qtyInvoiced || 0)}</td><td class="num"><b>${qtyf(soRemain(l))}</b></td></tr>`).join('')}</tbody></table>
      ${inv.length ? `<p style="margin:10px 0 0">${inv.map(s => `<a class="chip" href="#/doc/SI/${s.id}">Sales Invoice ${esc(s.no)} ${badge(s.status)}</a>`).join(' ')}</p>` : ''}
      ${c ? `<p class="small" style="margin:10px 0 0">Order for sales contract <a href="#/nospa/${c.id}">${esc(c.no)}</a>. Invoices made from it are final invoices and deduct the posted deposits.</p>` : ''}</div>` + base;
  }
  if (d.type === 'SI' && d.soId) {
    const so = DB.docs.find(x => x.id === d.soId);
    if (so) return `<div class="card"><h3>Sales Order</h3><p style="margin:0">Created from <a href="#/doc/SO/${so.id}">Sales Order ${esc(so.no)}</a> ${badge(so.status)}. You can lower quantities to invoice part of the order now.</p></div>` + base;
  }
  return base;
};

/* ---------- Sales Contract → Sales Order ---------- */
const ncSOOf = c => DB.docs.find(x => x.type === 'SO' && x.nospaId === c.id && !['Cancelled', 'Rejected'].includes(x.status));
async function ncMakeSO() {
  let newId = '';
  const ok = await commit(() => {
    if (!ncCanBill() && !ncCanEdit()) fail('Only the Commercial Manager or Accounting can create the Sales Order.');
    const c = DB.docs.find(x => x.id === NC.id);
    if (ncSOOf(c)) fail('A Sales Order already exists for this contract.');
    ncPrepayAcc(c);
    const so = newDoc('SO');
    Object.assign(so, { company: c.company, customer: c.customer, date: today() });
    copyPartyToDoc(so);
    Object.assign(so, { currency: isFCY(c.currency) ? c.currency : '', customerPO: c.contractRef, dims: clone(c.dims || {}), nospaId: c.id, shipDate: c.blDate || '',
      remarks: `Sales contract ${c.no}. Vessel ${c.vesselName || '—'}, B/L ${c.blDate || '—'}. Quantity per Certificate of Weight.` });
    const l = { type: 'Item', no: c.item, qty: num(c.loadedWmt) || num(c.volume) }; lineDefaults(so, l); l.price = num(c.price);
    so.lines = [l];
    so.id = uid(); so.no = nextNo('SO', so.company); so.createdBy = curUser().id; so.createdAt = new Date().toISOString();
    DB.docs.push(so); newId = so.id;
    ersHist(c, 'Sales Order created', so.no);
  }, 'Created Sales Order from sales contract', NC.no);
  if (ok !== false) { toast('Sales Order created as a draft. Set the final quantity (COW), price adjustments and location, then release it.'); NC = null; go(`#/doc/SO/${newId}`); }
}
