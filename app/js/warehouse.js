'use strict';
/* ============ Warehouse (Business Central basic warehouse):
   Inbound:  Purchase Order / Transfer Order → Create Whse. Receipt → Post Receipt → Put-away → Register Put-away
   Outbound: Sales Invoice / Transfer Order → Create Whse. Shipment → Create Pick → Register Pick → Post Shipment
   Bin-to-bin and location reclassification: Item Reclass. Journal ============ */

Object.assign(DOCS, {
  WR: { name: 'Warehouse Receipt', plural: 'Warehouse Receipts', lines: 'whsercpt', post: false, system: true, whse: true, bc: 'Warehouse Receipt → Post Receipt',
    desc: 'Created from a Purchase Order or an incoming Transfer Order ("Create Whse. Receipt"). Enter the actual Qty. to Receive and the bin, then Post Receipt. If the location requires put-away, a Put-away is created.',
    head: [{ k: 'location', l: 'Location Code', t: 'ref', ref: 'locations', ro: 1 }, { k: 'date', l: 'Posting Date', t: 'date', req: 1 }, { k: 'drNo', l: 'Vendor Shipment No. (DR)' }, { k: 'remarks', l: 'Remarks', t: 'textarea', w: 'w2' }] },
  PA: { name: 'Warehouse Put-away', plural: 'Warehouse Put-aways', lines: 'putaway', post: false, system: true, whse: true, bc: 'Warehouse Put-away → Register Put-away',
    desc: 'Move received items from the receiving bin (Take) to their storage bin (Place), then Register Put-away.',
    head: [{ k: 'location', l: 'Location Code', t: 'ref', ref: 'locations', ro: 1 }, { k: 'date', l: 'Registering Date', t: 'date', req: 1 }, { k: 'remarks', l: 'Remarks', t: 'textarea', w: 'w2' }] },
  WS: { name: 'Warehouse Shipment', plural: 'Warehouse Shipments', lines: 'whseship', post: false, system: true, whse: true, bc: 'Warehouse Shipment → Create Pick → Post Shipment',
    desc: 'Created from an approved Sales Invoice or Transfer Order ("Create Whse. Shipment"). Create the Pick, register it, then Post Shipment.',
    head: [{ k: 'location', l: 'Location Code', t: 'ref', ref: 'locations', ro: 1 }, { k: 'date', l: 'Posting Date', t: 'date', req: 1 }, { k: 'remarks', l: 'Remarks', t: 'textarea', w: 'w2' }] },
  PK: { name: 'Warehouse Pick', plural: 'Warehouse Picks', lines: 'pick', post: false, system: true, whse: true, bc: 'Warehouse Pick → Register Pick',
    desc: 'Take the items from their storage bin and place them in the shipment bin, then Register Pick.',
    head: [{ k: 'location', l: 'Location Code', t: 'ref', ref: 'locations', ro: 1 }, { k: 'date', l: 'Registering Date', t: 'date', req: 1 }, { k: 'remarks', l: 'Remarks', t: 'textarea', w: 'w2' }] },
  RJ: { name: 'Item Reclass. Journal', plural: 'Item Reclass. Journals', lines: 'reclass', post: true, bc: 'Item Reclassification Journal (New Location Code / New Bin Code)',
    desc: 'Bin-to-bin transfer or reclassification between locations (e.g. Mine to Mine Ore Yard, vessel bins). Approved, then posted.',
    head: [{ k: 'date', l: 'Posting Date', t: 'date', req: 1 }, { k: 'remarks', l: 'Description', t: 'textarea', w: 'w2', req: 1 }] }
});
POSTERS.RJ = postRJ;
if (!DOC_TYPES_FOR_RULES.includes('RJ')) DOC_TYPES_FOR_RULES.push('RJ');

const srcLink = l => { const d = DB.docs.find(x => x.id === l.srcId); return d ? `${DOCS[d.type].name} ${d.no}` : l.srcNo; };
const binsRef = loc => 'bins:' + (loc || '');
function suggestBin(co, loc, item, exclude = []) {
  const c = binContents(co, loc).filter(x => x.item === item && x.qty > 0 && !exclude.map(U).includes(U(x.bin))).sort((a, b) => b.qty - a.qty);
  return c[0] ? c[0].bin : '';
}
const WH_COLS = {
  whsercpt: () => [{ k: 'src', l: 'Source Document', t: 'calcFn', fn: srcLink }, { k: 'item', l: 'Item No.', t: 'ro' }, { k: 'description', l: 'Description', t: 'ro' }, { k: 'uom', l: 'UOM', t: 'ro' },
    { k: 'qtyOutstanding', l: 'Qty. Outstanding', t: 'ro', f: 'qty' }, { k: 'qtyToReceive', l: 'Qty. to Receive', t: 'number', w: 110 }, { k: 'qtyReceived', l: 'Qty. Received', t: 'ro', f: 'qty' },
    { k: 'bin', l: 'Bin Code', t: 'refFn', refFn: () => binsRef(ED.location), w: 160 }],
  putaway: () => [{ k: 'item', l: 'Item No.', t: 'ro' }, { k: 'description', l: 'Description', t: 'ro' }, { k: 'qty', l: 'Quantity', t: 'ro', f: 'qty' },
    { k: 'takeBin', l: 'Take: Bin Code', t: 'ro' }, { k: 'placeBin', l: 'Place: Bin Code', t: 'refFn', refFn: () => binsRef(ED.location), w: 170 },
    { k: 'inPlace', l: 'Already in Place bin', t: 'calcFn', fn: l => l.placeBin ? qtyf(binQty(ED.company, ED.location, l.placeBin, l.item)) : '' }],
  whseship: () => [{ k: 'src', l: 'Source Document', t: 'calcFn', fn: srcLink }, { k: 'item', l: 'Item No.', t: 'ro' }, { k: 'description', l: 'Description', t: 'ro' }, { k: 'uom', l: 'UOM', t: 'ro' },
    { k: 'qty', l: 'Qty. to Ship', t: 'ro', f: 'qty' }, { k: 'qtyPicked', l: 'Qty. Picked', t: 'ro', f: 'qty' },
    { k: 'bin', l: 'Bin Code (shipment bin)', t: 'refFn', refFn: () => binsRef(ED.location), w: 170 }],
  pick: () => [{ k: 'item', l: 'Item No.', t: 'ro' }, { k: 'description', l: 'Description', t: 'ro' }, { k: 'qty', l: 'Quantity', t: 'ro', f: 'qty' },
    { k: 'takeBin', l: 'Take: Bin Code', t: 'refFn', refFn: () => binsRef(ED.location), w: 170 }, { k: 'avail', l: 'Available in Take bin', t: 'calcFn', fn: l => l.takeBin ? qtyf(binQty(ED.company, ED.location, l.takeBin, l.item)) : '' },
    { k: 'placeBin', l: 'Place: Bin Code', t: 'ro' }],
  reclass: () => [{ k: 'item', l: 'Item No.', t: 'ref', ref: 'invItems', w: 200 }, { k: 'description', l: 'Description', t: 'ro' }, { k: 'location', l: 'Location Code', t: 'ref', ref: 'locations', w: 150 },
    { k: 'bin', l: 'Bin Code', t: 'refFn', refFn: l => binsRef(l.location), w: 140 }, { k: 'newLocation', l: 'New Location Code', t: 'ref', ref: 'locations', w: 150 },
    { k: 'newBin', l: 'New Bin Code', t: 'refFn', refFn: l => binsRef(l.newLocation || l.location), w: 140 }, { k: 'qty', l: 'Quantity', t: 'number', w: 90 },
    { k: 'avail', l: 'Available', t: 'calcFn', fn: l => l.item && l.location ? qtyf(l.bin ? binQty(ED.company, l.location, l.bin, l.item) : onHand(ED.company, l.item, l.location)) : '' }]
};

/* ---------- Buttons on source documents and warehouse documents ---------- */
const invLines = d => (d.lines || []).filter(l => (l.type === 'Item' || !l.type) && (itemOf(l.no || l.item, d.company) || {}).type === 'Inventory');
function whseButtons(btn) {
  const d = ED, s = d.status, co = d.company;
  if (d.type === 'PO' && ['Approved', 'Partially Received'].includes(s) && needsWhse(co, d.location, 'requireReceive') && invLines(d).some(l => num(l.qty) > num(l.qtyReceived)))
    btn('Create Whse. Receipt ➜', 'whCreateReceipt()', 'primary');
  if (d.type === 'TO' && s === 'Approved' && needsWhse(co, d.fromLoc, 'requireShipment')) btn('Create Whse. Shipment ➜', 'whCreateShipment()', 'primary');
  if (d.type === 'TO' && s === 'Shipped' && needsWhse(co, d.toLoc, 'requireReceive')) btn('Create Whse. Receipt ➜', 'whCreateReceipt()', 'primary');
  if (d.type === 'SI' && s === 'Approved' && needsWhse(co, d.location, 'requireShipment') && invLines(d).length) btn('Create Whse. Shipment ➜', 'whCreateShipment()', 'primary');
  if (d.type === 'WR' && s === 'Open') { btn('💾 Save', 'saveDoc()'); btn('Post Receipt', 'whPostReceipt()', 'primary'); }
  if (d.type === 'PA' && s === 'Open') { btn('💾 Save', 'saveDoc()'); btn('Register Put-away', 'whRegister()', 'primary'); }
  if (d.type === 'PK' && s === 'Open') { btn('💾 Save', 'saveDoc()'); btn('Register Pick', 'whRegister()', 'primary'); }
  if (d.type === 'WS' && s === 'Open') {
    btn('💾 Save', 'saveDoc()');
    if (needsWhse(co, d.location, 'requirePick')) btn('Create Pick', 'whCreatePick()');
    btn('Post Shipment', 'whPostShipment()', 'primary');
  }
}
/** Which normal buttons to hide because warehouse handling is required (BC would refuse them) */
function whseHides(label) {
  const d = ED, co = d.company;
  if (d.type === 'TO' && /Post Shipment/.test(label) && needsWhse(co, d.fromLoc, 'requireShipment')) return true;
  if (d.type === 'TO' && /Post Receipt at Destination/.test(label) && needsWhse(co, d.toLoc, 'requireReceive')) return true;
  if (d.type === 'SI' && /Post/.test(label) && needsWhse(co, d.location, 'requireShipment') && invLines(d).length) return true;
  if (d.type === 'PO' && /Post Receipt/.test(label) && needsWhse(co, d.location, 'requireReceive') && !d.lines.some(l => !invLines(d).includes(l) && num(l.qty) > num(l.qtyReceived))) return true;
  return false;
}

/* ---------- Inbound ---------- */
function openWhseQty(srcId, srcLine, type) {
  return sum(DB.docs.filter(x => x.type === type && x.status === 'Open').flatMap(x => x.lines).filter(l => l.srcId === srcId && l.srcLine === srcLine), l => num(type === 'WR' ? l.qtyToReceive : l.qty));
}
async function whCreateReceipt() {
  let wr;
  const ok = await commit(() => {
    const src = dbDoc(), co = src.company;
    const isTO = src.type === 'TO', loc = isTO ? src.toLoc : src.location, L = locOf(co, loc) || {};
    const lines = isTO
      ? src.lines.map((l, i) => ({ l, i, out: num(l.qtyShipped) - num(l.qtyReceived) })).filter(x => x.out > 0 && !openWhseQty(src.id, x.i, 'WR'))
        .map(x => ({ srcType: 'TO', srcId: src.id, srcNo: src.no, srcLine: x.i, item: x.l.item, description: x.l.description, uom: x.l.uom, qtyOutstanding: x.out, qtyToReceive: x.out, qtyReceived: 0, bin: defaultBin(co, loc, 'receive') }))
      : src.lines.map((l, i) => ({ l, i, out: r4(num(l.qty) - num(l.qtyReceived) - openWhseQty(src.id, i, 'WR')) })).filter(x => x.out > 0 && invLines(src).includes(x.l))
        .map(x => ({ srcType: 'PO', srcId: src.id, srcNo: src.no, srcLine: x.i, item: x.l.no, description: x.l.description, uom: x.l.uom, qtyOutstanding: x.out, qtyToReceive: x.out, qtyReceived: 0, bin: defaultBin(co, loc, 'receive') }));
    if (!lines.length) fail('There are no warehouse receipt lines to create (nothing outstanding, or already on an open Warehouse Receipt).');
    wr = { id: uid(), type: 'WR', no: nextNo('WR', co), company: co, date: today(), status: 'Open', location: loc, srcNo: src.no, createdBy: curUser().id, createdAt: new Date().toISOString(), approvals: [], lines };
    DB.docs.push(wr);
  }, 'Created warehouse receipt', ED.no);
  if (ok !== false) { toast(`Warehouse Receipt ${wr.no} created. Enter the actual quantities and bins, then Post Receipt.`); go(`#/doc/WR/${wr.id}`); }
}
async function whPostReceipt() {
  let pa = null;
  const ok = await commit(() => {
    storeED(); const wr = dbDoc(), co = wr.company, L = locOf(co, wr.location) || {};
    const toPost = wr.lines.filter(l => num(l.qtyToReceive) > 0);
    if (!toPost.length) fail('There is nothing to post: enter a Qty. to Receive.');
    for (const l of toPost) {
      if (num(l.qtyToReceive) > num(l.qtyOutstanding) + 0.0001) fail(`Qty. to Receive for ${l.item} cannot be more than ${qtyf(l.qtyOutstanding)}.`);
      if (L.binMandatory && !l.bin) fail(`Bin Code must have a value for item ${l.item}.`);
    }
    for (const srcId of new Set(toPost.map(l => l.srcId))) {
      const src = DB.docs.find(x => x.id === srcId), ls = toPost.filter(l => l.srcId === srcId);
      if (src.type === 'PO') {
        const rr = { id: uid(), type: 'RR', no: nextNo('RR', co), company: co, date: wr.date, status: 'Posted', vendor: src.vendor, location: wr.location, poNo: src.no, drNo: wr.drNo, remarks: `Whse. Receipt ${wr.no}`, dims: clone(src.dims || {}), fromWhse: true,
          createdBy: curUser().id, createdAt: new Date().toISOString(), postedAt: new Date().toISOString(), approvals: [],
          lines: ls.map(l => { const pl = src.lines[l.srcLine]; return { poLine: l.srcLine, type: pl.type, no: pl.no, description: pl.description, uom: pl.uom, qty: num(l.qtyToReceive), unitCost: lineCalc(src, { ...pl, qty: 1 }).base * docRate(src), bin: l.bin }; }) };
        postReceipt(src, rr); delete rr.fromWhse; DB.docs.push(rr);
      } else {
        for (const l of ls) if (Math.abs(num(l.qtyToReceive) - num(l.qtyOutstanding)) > 0.0001) fail(`Transfer receipts must receive the full shipped quantity (${qtyf(l.qtyOutstanding)}) of ${l.item}.`);
        ls.forEach(l => { src.lines[l.srcLine].toBin = l.bin; });
        src._fromWhse = true; receiveTO(src, wr.date); delete src._fromWhse;
      }
    }
    for (const l of toPost) { l.qtyReceived = r4(num(l.qtyReceived) + num(l.qtyToReceive)); l.qtyOutstanding = r4(num(l.qtyOutstanding) - num(l.qtyToReceive)); }
    if (L.requirePutaway) {
      pa = { id: uid(), type: 'PA', no: nextNo('PA', co), company: co, date: wr.date, status: 'Open', location: wr.location, srcNo: wr.no, createdBy: curUser().id, createdAt: new Date().toISOString(), approvals: [],
        lines: toPost.map(l => ({ item: l.item, description: l.description, uom: l.uom, qty: num(l.qtyToReceive), takeBin: l.bin, placeBin: suggestBin(co, wr.location, l.item, [l.bin]) })) };
      DB.docs.push(pa);
    }
    wr.lines.forEach(l => { l.qtyToReceive = l.qtyOutstanding; });
    wr.postedAt = new Date().toISOString();
    if (wr.lines.every(l => num(l.qtyOutstanding) <= 0.0001)) wr.status = 'Posted';
  }, 'Posted warehouse receipt', ED.no);
  if (ok !== false) { toast(pa ? `Receipt posted. Put-away ${pa.no} created – choose the Place bins and Register.` : 'Receipt posted.'); if (pa) go(`#/doc/PA/${pa.id}`); else afterChange(ok); }
}

/* ---------- Outbound ---------- */
async function whCreateShipment() {
  let ws;
  const ok = await commit(() => {
    const src = dbDoc(), co = src.company, isTO = src.type === 'TO', loc = isTO ? src.fromLoc : src.location, L = locOf(co, loc) || {};
    if (DB.docs.some(x => x.type === 'WS' && x.status === 'Open' && x.lines.some(l => l.srcId === src.id))) fail('An open Warehouse Shipment already exists for this document.');
    const lines = (isTO ? src.lines.map((l, i) => ({ l, i, item: l.item })) : src.lines.map((l, i) => ({ l, i, item: l.no })).filter(x => invLines(src).includes(x.l)))
      .map(x => ({ srcType: src.type, srcId: src.id, srcNo: src.no, srcLine: x.i, item: x.item, description: x.l.description, uom: x.l.uom, qty: num(x.l.qty), qtyPicked: 0, bin: defaultBin(co, loc, 'ship') }));
    if (!lines.length) fail('There are no inventory lines to ship.');
    ws = { id: uid(), type: 'WS', no: nextNo('WS', co), company: co, date: today(), status: 'Open', location: loc, srcNo: src.no, createdBy: curUser().id, createdAt: new Date().toISOString(), approvals: [], lines };
    DB.docs.push(ws);
  }, 'Created warehouse shipment', ED.no);
  if (ok !== false) { toast(`Warehouse Shipment ${ws.no} created.${needsWhse(S.company, ws.location, 'requirePick') ? ' Set the shipment bin, then Create Pick.' : ''}`); go(`#/doc/WS/${ws.id}`); }
}
async function whCreatePick() {
  let pk;
  const ok = await commit(() => {
    storeED(); const ws = dbDoc(), co = ws.company;
    const lines = [];
    ws.lines.forEach((l, i) => {
      const open = r4(num(l.qty) - num(l.qtyPicked) - sum(DB.docs.filter(x => x.type === 'PK' && x.status === 'Open').flatMap(x => x.lines).filter(p => p.wsId === ws.id && p.wsLine === i), 'qty'));
      if (open <= 0) return;
      if (!l.bin) fail(`Set the shipment Bin Code for ${l.item} first (Place bin of the pick).`);
      lines.push({ wsId: ws.id, wsLine: i, item: l.item, description: l.description, uom: l.uom, qty: open, takeBin: suggestBin(co, ws.location, l.item, [l.bin]), placeBin: l.bin });
    });
    if (!lines.length) fail('Nothing to handle: everything is already picked or on an open pick.');
    pk = { id: uid(), type: 'PK', no: nextNo('PK', co), company: co, date: today(), status: 'Open', location: ws.location, srcNo: ws.no, createdBy: curUser().id, createdAt: new Date().toISOString(), approvals: [], lines };
    DB.docs.push(pk);
  }, 'Created pick', ED.no);
  if (ok !== false) { toast(`Pick ${pk.no} created. Check the Take bins and Register Pick.`); go(`#/doc/PK/${pk.id}`); }
}
async function whRegister() {
  const ok = await commit(() => {
    storeED(); const d = dbDoc();
    for (const l of d.lines) {
      if (d.type === 'PA' && !l.placeBin) fail(`Place: Bin Code must have a value for item ${l.item}.`);
      if (d.type === 'PK' && !l.takeBin) fail(`Take: Bin Code must have a value for item ${l.item}.`);
      whseMove(d, l.item, d.location, l.takeBin, l.placeBin, num(l.qty));
      if (d.type === 'PK') { const ws = DB.docs.find(x => x.id === l.wsId); ws.lines[l.wsLine].qtyPicked = r4(num(ws.lines[l.wsLine].qtyPicked) + num(l.qty)); }
    }
    d.status = 'Registered'; d.postedAt = new Date().toISOString();
  }, `Registered ${ED.type === 'PA' ? 'put-away' : 'pick'}`, ED.no);
  if (ok !== false) { toast(ED.type === 'PA' ? 'Put-away registered. Items are in their storage bins.' : 'Pick registered. Items are in the shipment bin – Post the Shipment.'); if (ED.type === 'PK') { const ws = DB.docs.find(x => x.no === ED.srcNo && x.type === 'WS' && x.company === ED.company); if (ws) return go(`#/doc/WS/${ws.id}`); } afterChange(ok); }
}
async function whPostShipment() {
  const ok = await commit(() => {
    storeED(); const ws = dbDoc(), co = ws.company, L = locOf(co, ws.location) || {};
    for (const l of ws.lines) {
      if (L.requirePick && num(l.qtyPicked) < num(l.qty) - 0.0001) fail(`Nothing to ship for ${l.item}: register the pick first (picked ${qtyf(l.qtyPicked)} of ${qtyf(l.qty)}).`);
      if (L.binMandatory && !l.bin) fail(`Bin Code must have a value for item ${l.item}.`);
    }
    for (const srcId of new Set(ws.lines.map(l => l.srcId))) {
      const src = DB.docs.find(x => x.id === srcId), ls = ws.lines.filter(l => l.srcId === srcId);
      src.date = ws.date;
      if (src.type === 'TO') { ls.forEach(l => { src.lines[l.srcLine].fromBin = l.bin; }); src._fromWhse = true; shipTO(src); delete src._fromWhse; }
      else {
        if (src.status !== 'Approved') fail(`${src.no} must be Approved before shipping.`);
        ls.forEach(l => { src.lines[l.srcLine].bin = l.bin; });
        src._fromWhse = true; POSTERS[src.type](src); delete src._fromWhse;
        src.status = 'Posted'; src.postedAt = new Date().toISOString(); src.postedBy = curUser().id;
      }
    }
    ws.status = 'Posted'; ws.postedAt = new Date().toISOString();
  }, 'Posted warehouse shipment', ED.no);
  if (ok !== false) { toast('Shipment posted.'); afterChange(ok); }
}

/* ---------- Item Reclass. Journal ---------- */
function postRJ(d) {
  const co = d.company, gl = [];
  for (const l of d.lines) {
    const it = itemOf(l.item, co); if (!it || it.type !== 'Inventory') fail(`Item ${l.item} is not an inventory item.`);
    const to = l.newLocation || l.location, qty = num(l.qty);
    if (!l.location) fail(`Location Code must have a value for ${l.item}.`);
    if (to === l.location) { if (!l.bin || !l.newBin) fail(`Bin Code and New Bin Code must have a value for ${l.item}.`); whseMove(d, l.item, l.location, l.bin, l.newBin, qty); continue; }
    const out = costOut(co, l.item, qty);
    postItem(d, l.item, l.location, -qty, -out.value, -out.exp, 'Transfer (Reclass.)', l.bin);
    postItem(d, l.item, to, qty, out.value, out.exp, 'Transfer (Reclass.)', l.newBin);
    const a1 = invAccount(co, l.location, it.invPostGroup), a2 = invAccount(co, to, it.invPostGroup);
    if (a1 !== a2 && out.value) gl.push({ account: a2, debit: out.value, desc: `Reclass ${l.item}` }, { account: a1, credit: out.value, desc: `Reclass ${l.item}` });
  }
  if (gl.length) postGL(d, gl); else checkPeriod(d.date);
}

/* ---------- Bin Contents page ---------- */
route('bincontents', (loc) => {
  const co = S.company;
  const locs = M(co).locations.filter(l => l.binMandatory).map(l => [l.code, `${l.code} – ${l.name}`]);
  const sel = loc || '';
  const rows = binContents(co, sel || undefined).map(r => ({ ...r, desc: (itemOf(r.item, co) || {}).description, uom: (itemOf(r.item, co) || {}).uom }))
    .sort((a, b) => (a.location + a.bin + a.item).localeCompare(b.location + b.bin + b.item));
  const flags = sel ? (() => { const L = locOf(co, sel) || {}; return ['requireReceive', 'requirePutaway', 'requireShipment', 'requirePick', 'binMandatory'].filter(f => L[f]).map(f => f.replace('require', 'Require ').replace('binMandatory', 'Bin Mandatory')).join(' · '); })() : '';
  return pageHead('Bin Contents', `Quantity per bin (receipts, put-aways, picks, shipments, reclassifications). ${flags ? '<b>' + esc(sel) + ':</b> ' + esc(flags) : ''}`,
    `<select onchange="go('#/bincontents/'+encodeURIComponent(this.value))">${optionsHtml(locs, sel)}</select>`) +
    `<div class="card">${dataTable('bins', [{ l: 'Location', k: 'location' }, { l: 'Bin Code', k: 'bin' }, { l: 'Item No.', k: 'item' }, { l: 'Description', k: 'desc' }, { l: 'Quantity', k: 'qty', f: 'qty' }, { l: 'UOM', k: 'uom' }], rows, { title: 'Bin Contents' })}</div>`;
});
function whseEntriesPanel() {
  const w = (DB.whseEntries || []).filter(e => e.docNo === ED.no && e.company === ED.company);
  const il = ED.type === 'WR' ? [] : [];
  if (!w.length) return '';
  return `<div class="card"><h3>Warehouse Entries</h3><table class="grid compact"><thead><tr><th>Date</th><th>Entry Type</th><th>Location</th><th>Bin</th><th>Item</th><th class="num">Quantity</th></tr></thead><tbody>
    ${w.map(e => `<tr><td>${e.date}</td><td>${esc(e.entryType)}</td><td>${esc(e.location)}</td><td>${esc(e.bin)}</td><td>${esc(e.item)}</td><td class="num">${qtyf(e.qty)}</td></tr>`).join('')}</tbody></table></div>`;
}
/** Receipt/shipment bin: the location card's Receipt/Shipment Bin Code, else the bin in the RECEIVE/SHIP zone */
function defaultBin(co, loc, kind) {
  const L = locOf(co, loc) || {};
  if (kind === 'receive' && L.receiptBin && binExists(co, loc, L.receiptBin)) return L.receiptBin;
  if (kind === 'ship' && L.shipmentBin && binExists(co, loc, L.shipmentBin)) return L.shipmentBin;
  const re = kind === 'receive' ? /^RECEIV/i : /^SHIP/i;
  const b = M(co).bins.find(x => x.location === loc && (re.test(x.zone || '') || re.test(x.code)));
  return b ? b.code : '';
}
