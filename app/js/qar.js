'use strict';
/* ============ Quotation Analysis Report (QAR), weighted scoring, quote forms ============
   Follows your "Canvass Sheet – Commercial Evaluation" (QAR samples of 9 Nov 2026): supplier block, lines with MR/PR,
   part no., each vendor's offer, unit price and amount, extra charges, VAT, negotiated discount, total, warranty,
   lead time, terms of payment, delivery point / shipyard, inclusions, "Please see attached offered quotes",
   Prepared by / Approved by. Adds what the samples lacked: totals in pesos for foreign quotes and a weighted score.
   Quote form: an Excel file per vendor (download, attach to your email), filled by the vendor and uploaded back. */

/* ---------- quote totals: lines + extra charges − discount ---------- */
function qarRate(pq) { try { return docRate(pq); } catch (e) { return 0; } }
function qarTotal(pq) {
  const t = docTotals(pq), extras = r2(sum(pq.extraCharges || [], 'amount')), disc = r2(num(pq.discount));
  const total = r2(t.subtotal + t.vat + extras - disc), R = qarRate(pq);   // vendor price before withholding tax
  return { net: t.subtotal, vat: t.vat, extras, discount: disc, total, php: R ? r2(total * R) : null, rate: R };
}
rfqComparison = function (r) {
  const pqs = rfqPQs(r).filter(p => rfqPriced(p)), valid = pqs.filter(p => rfqQuoteState(r, p) === 'Valid');
  const tot = p => { const q = qarTotal(p); return q.php == null ? q.total : q.php; };
  const lowest = valid.slice().sort((a, b) => tot(a) - tot(b))[0];
  return { pqs, valid, lowest, tot, scores: qarScores(r, valid, tot) };
};

/* ---------- weighted scoring (weights in RFQ settings) ---------- */
const QAR_W = [['price', 'Price (total in pesos)', 40], ['lead', 'Delivery lead time', 20], ['terms', 'Payment terms', 15], ['warranty', 'Warranty', 10], ['rating', 'Vendor rating', 10], ['quality', 'Quality (OEM / genuine)', 5]];
const qarWeights = () => Object.assign(Object.fromEntries(QAR_W.map(([k, , w]) => [k, w])), (DB.settings.rfq || {}).weights || {});
function qarTermsScore(s) {
  const t = String(s || '').toLowerCase(); if (!t.trim()) return 50;
  if (/prepay|advance|c\.?o\.?d|cash on|before delivery|100% *(dp|down)/.test(t)) return 10;
  if (/(\d+)\s*%\s*(dp|down)/.test(t)) return 40;
  const m = t.match(/(\d+)\s*(working\s*)?days?/); if (m) return Math.min(100, Math.round(num(m[1]) / 60 * 100));
  return 50;
}
function qarWarrantyScore(s) {
  const t = String(s || '').toLowerCase(); if (!t.trim()) return 0;
  const y = t.match(/(\d+)\s*(year|yr)/), m = t.match(/(\d+)\s*(month|mo)/);
  const months = y ? num(y[1]) * 12 : m ? num(m[1]) : null;
  return months == null ? 50 : Math.min(100, Math.round(months / 12 * 100));
}
const qarQualityScore = s => /oem|genuine|original/i.test(s || '') ? 100 : /replace|compatib|after/i.test(s || '') ? 50 : 70;
function qarScores(r, valid, tot) {
  const w = qarWeights(), W = sum(QAR_W, ([k]) => num(w[k])) || 1, out = {};
  if (!valid.length) return out;
  const low = Math.min(...valid.map(tot)), leads = valid.map(p => num(p.leadTimeDays)).filter(x => x > 0), short = leads.length ? Math.min(...leads) : 0;
  for (const p of valid) {
    const lr = vaLastRating(vaRec(p.vendor, p.company));
    const s = { price: tot(p) > 0 ? Math.round(low / tot(p) * 100) : 0, lead: num(p.leadTimeDays) > 0 ? Math.round(short / num(p.leadTimeDays) * 100) : 50,
      terms: qarTermsScore(p.quoteTerms), warranty: qarWarrantyScore(p.warranty), rating: lr ? lr.score : 60, quality: qarQualityScore(p.qualityTag) };
    out[p.id] = { parts: s, score: Math.round(sum(QAR_W, ([k]) => num(w[k]) * s[k]) / W) };
  }
  const ranked = Object.entries(out).sort((a, b) => b[1].score - a[1].score);
  ranked.forEach(([id], i) => { out[id].rank = i + 1; });
  out._best = ranked[0] && ranked[0][0];
  return out;
}

/* ---------- comparison sheet on screen ---------- */
rfqCompareHtml = function (r, cmp, st, buy) {
  const co = r.company, can = buy && st === 'For award', tech = rfqNeedsTech(r), sc = cmp.scores;
  const row = (label, f, cls = '') => `<tr class="${cls}"><td>${label}</td><td></td>${cmp.pqs.map(p => `<td class="num">${f(p)}</td>`).join('')}</tr>`;
  return `<div class="card"><h3>Comparison sheet</h3><div class="tbl-wrap"><table class="grid"><thead><tr><th>Item</th><th class="num">Qty</th>${cmp.pqs.map(p => `<th class="num">${esc(p.vendor)}<div class="small muted" style="font-weight:400">${esc(partyName('vendor', p.vendor, co)).slice(0, 26)}</div></th>`).join('')}</tr></thead><tbody>
    ${r.lines.map((l, i) => { const prices = cmp.pqs.map(p => num((p.lines[i] || {}).unitCost)), lo = Math.min(...prices.filter(x => x > 0)); return `<tr><td>${esc(l.description || l.no)}${l.partNo ? `<div class="small muted">${esc(l.partNo)}</div>` : ''}</td><td class="num">${qtyf(l.qty)}</td>${cmp.pqs.map((p, k) => { const pl = p.lines[i] || {}; return `<td class="num" style="${prices[k] === lo ? 'color:var(--ok);font-weight:700' : ''}">${prices[k] ? money(prices[k]) : '—'}${pl.offer ? `<div class="small muted" style="font-weight:400;max-width:180px;margin-left:auto">${esc(pl.offer)}</div>` : ''}</td>`; }).join('')}</tr>`; }).join('')}
    ${row('Total net of price', p => money(qarTotal(p).net))}${row('VAT', p => money(qarTotal(p).vat))}${row('Extra charges', p => qarTotal(p).extras ? money(qarTotal(p).extras) : '—')}${row('Discount', p => qarTotal(p).discount ? '−' + money(qarTotal(p).discount) : '—')}
    ${row('<b>Total</b>', p => `<b>${esc(p.currency || 'PHP')} ${money(qarTotal(p).total)}</b>${p.currency ? `<div class="small muted">${qarTotal(p).php == null ? 'no exchange rate' : '₱' + money(qarTotal(p).php)}</div>` : ''}`)}
    ${row('Quality', p => esc(p.qualityTag || '—'))}${row('Lead time', p => p.leadTimeDays ? esc(p.leadTimeDays) + ' days' : '—')}${row('Payment terms', p => `<span class="small">${esc(p.quoteTerms || p.paymentTerms || '—')}</span>`)}
    ${row('Warranty', p => `<span class="small">${esc(p.warranty || '—')}</span>`)}${row('Delivery point / shipyard', p => `<span class="small">${esc(p.deliveryPoint || '—')}</span>`)}${row('Valid until', p => `<span class="small">${esc(p.validUntil || '—')}</span>`)}
    ${row('Technical', p => { const s = rfqQuoteState(r, p); return badge(s === 'Valid' ? (tech ? (r.tech[p.id] || {}).result : 'Valid') : s); })}${row('Accreditation', p => badge(vaStatus(p.vendor, co)))}
    ${row('<b>Score</b> <span class="small muted">(weighted)</span>', p => sc[p.id] ? `<b>${sc[p.id].score}</b> <span class="small muted">#${sc[p.id].rank}</span>` : '—')}
    ${row('<b>Lowest / best score</b>', p => [cmp.lowest && cmp.lowest.id === p.id ? '★ lowest' : '', sc._best === p.id ? '◆ best score' : ''].filter(Boolean).join('<br>'), 'best')}
    ${can ? row('', p => rfqQuoteState(r, p) === 'Valid' && vaStatus(p.vendor, co) !== 'Blacklisted' ? `<button class="btn sm ${cmp.lowest && cmp.lowest.id === p.id ? 'primary' : ''}" onclick="rfqAward('${r.id}','${p.id}')">Award</button>` : '') : ''}
  </tbody></table></div><p class="small muted" style="margin:8px 0 0">Green = lowest price per item. Score weights: ${QAR_W.map(([k, l]) => `${l} ${qarWeights()[k]}%`).join(', ')} (RFQ settings). Choosing anything but the lowest valid quote needs a reason.</p></div>`;
};

/* ---------- quote entry with the QAR fields ---------- */
const QAR_HDR = [{ k: 'vendorQuoteNo', l: 'Vendor quote no.' }, { k: 'date', l: 'Quote date', t: 'date' }, { k: 'validUntil', l: 'Valid until', t: 'date' }, { k: 'currency', l: 'Currency (blank = PHP)', t: 'ref', ref: 'currencies' },
  { k: 'leadTimeDays', l: 'Lead time (days)', t: 'number' }, { k: 'quoteTerms', l: 'Terms of payment offered' }, { k: 'warranty', l: 'Warranty' }, { k: 'qualityTag', l: 'Quality', t: 'select', opts: ['', 'OEM', 'Genuine', 'Original', 'Replacement / compatible'].map(x => [x, x]) },
  { k: 'deliveryPoint', l: 'Delivery point / shipyard' }, { k: 'inclusions', l: 'Inclusions', w: 'w2' }, { k: 'discount', l: 'Negotiated discount (amount)', t: 'number' }, { k: 'pricesInclVat', l: 'Prices include VAT', t: 'check' }, { k: 'remarks', l: 'Remarks / scope of work', t: 'textarea', w: 'w3' }];
rfqQuote = function (id, pqId) {
  const pq = DB.docs.find(x => x.id === pqId), ex = (pq.extraCharges || []).concat([{}, {}, {}]).slice(0, Math.max(3, (pq.extraCharges || []).length));
  modal(`Quote from ${pq.vendor} – ${partyName('vendor', pq.vendor, pq.company)}`, `<div class="form-grid">${QAR_HDR.map(f => fieldHtml(f, pq[f.k], 'qh')).join('')}</div>
    <table class="grid" style="margin-top:12px"><thead><tr><th>Item</th><th class="num">Qty</th><th>Vendor's offer (brand / model / part no.)</th><th>Unit price</th></tr></thead><tbody>
    ${pq.lines.map((l, i) => `<tr><td>${esc(l.description || l.no)}${l.partNo ? `<div class="small muted">${esc(l.partNo)}</div>` : ''}</td><td class="num">${qtyf(l.qty)}</td><td><input id="qo_${i}" style="width:100%;padding:5px 8px;border:1px solid #d5dce8;border-radius:8px" value="${esc(l.offer || '')}"></td><td><input id="qp_${i}" class="num" style="width:130px;padding:5px 8px;border:1px solid #d5dce8;border-radius:8px" value="${num(l.unitCost) || ''}"></td></tr>`).join('')}</tbody></table>
    <h3 style="margin-top:14px">Extra charges <span class="small muted" style="font-weight:400">(mobilization, delivery, allowances)</span></h3>
    ${ex.map((c, i) => `<div style="display:flex;gap:8px;margin-bottom:6px"><input id="qx_d${i}" placeholder="Description" style="flex:1;padding:5px 8px;border:1px solid #d5dce8;border-radius:8px" value="${esc(c.desc || '')}"><input id="qx_a${i}" class="num" placeholder="Amount" style="width:130px;padding:5px 8px;border:1px solid #d5dce8;border-radius:8px" value="${c.amount || ''}"></div>`).join('')}`, async () => {
    const h = readForm(QAR_HDR, 'qh'), prices = pq.lines.map((l, i) => num($('#qp_' + i).value)), offers = pq.lines.map((l, i) => $('#qo_' + i).value.trim());
    const extras = ex.map((c, i) => ({ desc: $('#qx_d' + i).value.trim(), amount: num($('#qx_a' + i).value) })).filter(c => c.desc || c.amount);
    if (prices.some(p => p <= 0)) { toast('Enter a price for every item. If the vendor did not quote an item, mark the vendor as declined or ask for a full quote.', 'err'); return false; }
    if (h.currency && !M(pq.company).currencies.some(c => U(c.code) === U(h.currency))) { toast(`Currency ${h.currency} is not set up.`, 'err'); return false; }
    const ok = await commit(() => qarApplyQuote(id, pqId, h, prices, offers, extras), 'Entered vendor quote', pq.no);
    if (ok !== false) { toast('Quote saved.'); render(); } else return false;
  }, 'Save quote', true);
};
function qarApplyQuote(id, pqId, h, prices, offers, extras) {
  const d = DB.docs.find(x => x.id === pqId), r = DB.docs.find(x => x.id === id);
  Object.assign(d, h); d.currency = h.currency ? U(h.currency) : ''; d.exchRate = d.currency ? safeRate(d.currency, d.date || today()) : '';
  d.discount = num(h.discount); d.extraCharges = extras; d.pricesInclVat = !!h.pricesInclVat;
  d.lines.forEach((l, i) => { l.unitCost = prices[i]; l.offer = offers[i] || ''; l.partNo = (r.lines[i] || {}).partNo || ''; });
  const inv = r.vendors.find(v => v.pqId === pqId); inv.status = 'Quoted'; inv.quotedAt = today();
  if (r.tech) delete r.tech[pqId];
  ersHist(r, `Quote entered: ${d.vendor}`, `${d.currency || 'PHP'} ${money(qarTotal(d).total)}`);
}
async function qarSetPart(id, i, v) { const ok = await commit(() => { const r = DB.docs.find(x => x.id === id); r.lines[i].partNo = v.trim(); for (const p of rfqPQs(r)) if (p.lines[i]) p.lines[i].partNo = v.trim(); }, 'RFQ part no.'); if (ok !== false) toast('Part no. saved.'); }

/* ---------- tools card: quote forms and QAR ---------- */
function qarToolsHtml(r, st, buy) {
  if (r.status === 'Draft') return '';
  const co = r.company, open = ['Receiving quotes', 'Technical review', 'For award'].includes(st);
  return `<div class="card"><div class="lines-head"><h3 style="margin:0">Quote forms and QAR</h3><span style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm primary" onclick="qarPrint('${r.id}')">🖨 Print QAR</button><button class="btn sm" onclick="qarExport('${r.id}')">Export QAR to Excel</button></span></div>
    ${buy && open ? `<p class="small muted" style="margin:0 0 8px">Download each vendor's quote form (Excel), attach it to your email, and upload it when the vendor sends it back filled in. Prices, offers, terms and charges are then filled in for you.</p>
    <div class="tbl-wrap"><table class="grid compact"><tbody>${r.vendors.filter(v => v.pqId && v.status !== 'Declined').map(v => { const ven = vendorOf(v.vendor, co) || {}; return `<tr><td><b>${esc(v.vendor)}</b> ${esc(ven.name || '')}<div class="small muted">${esc(ven.email || 'no email on the vendor card')}</div></td>
      <td style="white-space:nowrap;text-align:right"><button class="btn sm" onclick="qarForm('${r.id}','${v.pqId}')">⬇ Quote form</button> <button class="btn sm" onclick="qarMail('${r.id}','${v.pqId}')">✉ Email</button>
      <label class="btn sm" style="cursor:pointer">⬆ Upload filled form<input type="file" accept=".xlsx" hidden onchange="qarUpload('${r.id}','${v.pqId}',this)"></label></td></tr>`; }).join('')}</tbody></table></div>` : ''}</div>`;
}

/* ---------- minimal .xlsx writer (stored zip, inline strings) ---------- */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zipStore(files) {
  const enc = new TextEncoder(), parts = [], cd = []; let off = 0;
  for (const [name, text] of files) {
    const nb = enc.encode(name), db = enc.encode(text), crc = crc32(db);
    const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint32(14, crc, true); lh.setUint32(18, db.length, true); lh.setUint32(22, db.length, true); lh.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(lh.buffer), nb, db);
    const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint32(16, crc, true); ch.setUint32(20, db.length, true); ch.setUint32(24, db.length, true); ch.setUint16(28, nb.length, true); ch.setUint32(42, off, true);
    cd.push(new Uint8Array(ch.buffer), nb); off += 30 + nb.length + db.length;
  }
  const cdSize = cd.reduce((s, x) => s + x.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...cd, new Uint8Array(e.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
function xlsxBlob(sheetName, rows, widths = []) {
  const x = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const col = n => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const data = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => v === '' || v == null ? '' : typeof v === 'number' && isFinite(v) ? `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>` : `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`).join('')}</row>`).join('');
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', P = 'http://schemas.openxmlformats.org/package/2006/relationships';
  return zipStore([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${P}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${M}" xmlns:r="${R}"><sheets><sheet name="${x(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${P}"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${M}">${cols}<sheetData>${data}</sheetData></worksheet>`]]);
}
function downloadBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
const fileSafe = s => String(s).replace(/[^\w.-]+/g, '_');

/* ---------- vendor quote form: download, email, upload ---------- */
const QF_FIELDS = [['currency', 'Currency (blank = PHP)'], ['pricesInclVat', 'Prices include VAT (Yes / No)'], ['discount', 'Discount (amount)'], ['leadTimeDays', 'Delivery lead time (days)'], ['quoteTerms', 'Terms of payment'],
  ['warranty', 'Warranty'], ['validUntil', 'Quote valid until (date)'], ['qualityTag', 'Quality (OEM / Genuine / Original / Replacement)'], ['deliveryPoint', 'Delivery point / shipyard'], ['inclusions', 'Inclusions'], ['vendorQuoteNo', 'Your quotation no.'], ['remarks', 'Remarks']];
function qarForm(id, pqId) {
  const r = DB.docs.find(x => x.id === id), pq = DB.docs.find(x => x.id === pqId), co = r.company, c = DB.companies.find(x => x.code === co) || {};
  const rows = [[`${c.legalName || c.name || co} – REQUEST FOR QUOTATION`], [], ['RFQ No.', r.no], ['Requisition', r.prNo], ['Vendor', `${pq.vendor} – ${partyName('vendor', pq.vendor, co)}`], ['Please reply by', r.dueDate], ['Delivery to', r.location || ''], ['Reference (do not change)', `RFQ|${r.id}|${pq.id}`], [],
    ['Please fill in columns G and H for every line, the extra charges if any, and the terms below. Save and send this file back.'], [],
    ['Line', 'Item No.', 'Description', 'Part No.', 'Qty', 'Unit', 'Your offer (brand / model / part no.)', 'Unit price']]
    .concat(r.lines.map((l, i) => [i + 1, l.no, l.description || '', l.partNo || '', num(l.qty), l.uom || '', '', '']))
    .concat([[], ['Extra charges', 'Description', '', '', '', '', '', 'Amount'], ['Extra charge 1'], ['Extra charge 2'], ['Extra charge 3'], [], ['Terms']])
    .concat(QF_FIELDS.map(([, l]) => [l, '']));
  downloadBlob(xlsxBlob('Quote', rows, [30, 14, 46, 18, 8, 8, 42, 14]), fileSafe(`${r.no}_${pq.vendor}_quote_form.xlsx`));
  toast('Quote form downloaded. Attach it to your email to the vendor.');
}
function qarMail(id, pqId) {
  const r = DB.docs.find(x => x.id === id), pq = DB.docs.find(x => x.id === pqId), co = r.company, ven = vendorOf(pq.vendor, co) || {}, c = DB.companies.find(x => x.code === co) || {};
  const body = `Dear ${ven.contact || 'Sir/Madam'},\n\nPlease send us your best quotation for the items below by ${r.dueDate}, using the attached quote form (${fileSafe(`${r.no}_${pq.vendor}_quote_form.xlsx`)}).\n\n${r.lines.map((l, i) => `${i + 1}. ${l.description || l.no}${l.partNo ? ' (' + l.partNo + ')' : ''} — ${qtyf(l.qty)} ${l.uom || ''}`).join('\n')}\n\nDelivery to: ${r.location || '—'}\nRFQ No.: ${r.no}\n\nThank you,\n${curUser().name}\n${c.legalName || c.name || co} – Supply Chain`;
  if (!ven.email) toast('This vendor has no email on its card; your email program opens without an address.', 'err');
  location.href = `mailto:${encodeURIComponent(ven.email || '')}?subject=${encodeURIComponent(`RFQ ${r.no} – ${c.legalName || c.name || co}`)}&body=${encodeURIComponent(body)}`;
}
const xlDate = v => { const n = num(v); if (n > 20000 && n < 80000 && /^\d+(\.\d+)?$/.test(String(v))) { const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000); return d.toISOString().slice(0, 10); } const s = String(v || '').trim(); const d = new Date(s); return s && !isNaN(d) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : ''; };
async function qarUpload(id, pqId, inp) {
  const f = inp.files && inp.files[0]; if (!f) return;
  let sheets; try { sheets = await readXlsx(await f.arrayBuffer()); } catch (e) { return toast('This file cannot be read. Upload the Excel (.xlsx) quote form.', 'err'); }
  const rows = (sheets[0] || {}).rows || [], A = r => String(r[0] || '').trim(), find = l => rows.find(r => A(r).toLowerCase() === l.toLowerCase());
  const ref = String((find('Reference (do not change)') || [])[1] || '').split('|');
  if (ref[0] !== 'RFQ' || ref[1] !== id || ref[2] !== pqId) return toast('This form belongs to another RFQ or vendor. Download the form for this vendor and use that one.', 'err');
  const r = DB.docs.find(x => x.id === id), pq = DB.docs.find(x => x.id === pqId);
  const hi = rows.findIndex(x => A(x) === 'Line'); if (hi < 0) return toast('The item table is missing from the form.', 'err');
  const prices = pq.lines.map(() => 0), offers = pq.lines.map(() => '');
  for (let k = hi + 1; k < rows.length && /^\d+$/.test(A(rows[k])); k++) { const i = num(A(rows[k])) - 1; if (i >= 0 && i < prices.length) { offers[i] = String(rows[k][6] || '').trim(); prices[i] = num(rows[k][7]); } }
  const extras = ['Extra charge 1', 'Extra charge 2', 'Extra charge 3'].map(l => find(l)).filter(Boolean).map(x => ({ desc: String(x[1] || '').trim(), amount: num(x[7]) })).filter(c => c.desc || c.amount);
  const h = { vendorQuoteNo: '', date: today() };
  for (const [k, l] of QF_FIELDS) { const v = (find(l) || [])[1]; h[k] = v == null ? '' : String(v).trim(); }
  h.validUntil = xlDate(h.validUntil); h.leadTimeDays = num(h.leadTimeDays) || ''; h.discount = num(h.discount); h.pricesInclVat = /^y/i.test(h.pricesInclVat) ? true : /^n/i.test(h.pricesInclVat) ? false : !!pq.pricesInclVat;
  if (h.currency && U(h.currency) !== 'PHP' && !M(pq.company).currencies.some(c => U(c.code) === U(h.currency))) return toast(`Currency ${h.currency} in the form is not set up.`, 'err');
  if (U(h.currency) === 'PHP') h.currency = '';
  const missing = prices.map((p, i) => p > 0 ? null : i + 1).filter(Boolean);
  if (missing.length) return toast(`The form has no price for line(s) ${missing.join(', ')}. Ask the vendor for a complete quote, or enter it by hand.`, 'err');
  const ok = await commit(() => { qarApplyQuote(id, pqId, h, prices, offers, extras); ersHist(DB.docs.find(x => x.id === id), `Quote form uploaded: ${pq.vendor}`, f.name); }, 'Uploaded vendor quote form', pq.no);
  if (ok !== false) { toast(`Quote from ${pq.vendor} loaded from the form.`); render(); }
}

/* ---------- QAR: data, print, Excel ---------- */
function qarData(id) {
  const r = DB.docs.find(x => x.id === id), co = r.company, c = DB.companies.find(x => x.code === co) || {}, cmp = rfqComparison(r), pqs = cmp.pqs, sc = cmp.scores;
  const aw = r.award && DB.docs.find(x => x.id === r.award.pqId), user = uid2 => (DB.users.find(u => u.id === uid2) || {}).name || '';
  const sup = pqs.map(p => ({ p, v: vendorOf(p.vendor, co) || {}, t: qarTotal(p) }));
  return { r, co, c, cmp, pqs, sc, aw, sup, prepared: user(r.createdBy), title: (DB.settings.rfq || {}).qarTitle || 'Canvass Sheet' };
}
function qarRows(D) {
  const { r, sup, sc, cmp, aw } = D, tech = rfqNeedsTech(r);
  const perSup = f => sup.flatMap(s => { const v = f(s); return [v, '', '']; });
  const rows = [[`${D.c.legalName || D.c.name || D.co} – ${D.title}`], ['Commercial Evaluation'], [`RFQ ${r.no} · Requisition ${r.prNo} · ${r.date}`], [],
    ['Supplier Name', '', '', '', '', ''].concat(perSup(s => `${s.v.name || s.p.vendor}`)),
    ['Address:', '', '', '', '', ''].concat(perSup(s => s.v.address || '')), ['Address 2:', '', '', '', '', ''].concat(perSup(s => s.v.city || '')),
    ['Attention To:', '', '', '', '', ''].concat(perSup(s => s.v.contact || '')), ['Phone No.', '', '', '', '', ''].concat(perSup(s => s.v.phone || '')), ['Email', '', '', '', '', ''].concat(perSup(s => s.v.email || '')),
    ['MR/PR', 'ITEM', 'DESCRIPTION', 'Part No.', 'Qty', 'UNIT'].concat(sup.flatMap(s => [`Offer${s.p.currency ? ' (' + s.p.currency + ')' : ''}`, 'Unit Price', 'Amount']))];
  r.lines.forEach((l, i) => rows.push([i === 0 ? r.prNo : '', i + 1, l.description || l.no, l.partNo || '', num(l.qty), l.uom || ''].concat(sup.flatMap(s => { const pl = s.p.lines[i] || {}; return [pl.offer || '', r2(num(pl.unitCost)), r2(num(pl.unitCost) * num(pl.qty))]; }))));
  const tail = (label, f) => rows.push([label, '', '', '', '', ''].concat(sup.flatMap(s => ['', '', f(s)])));
  const maxEx = Math.max(0, ...sup.map(s => (s.p.extraCharges || []).length));
  for (let k = 0; k < maxEx; k++) rows.push([k === 0 ? 'Extra charges' : '', '', '', '', '', ''].concat(sup.flatMap(s => { const e = (s.p.extraCharges || [])[k]; return e ? [e.desc, '', r2(e.amount)] : ['', '', '']; })));
  tail('Total Net of Price', s => s.t.net); tail('VAT', s => s.t.vat); tail('Discount', s => s.t.discount ? -s.t.discount : ''); tail('Total', s => s.t.total);
  if (sup.some(s => s.p.currency)) tail('Total in PHP', s => s.t.php == null ? 'no rate' : s.t.php);
  tail('Quality', s => s.p.qualityTag || ''); tail('Warranty', s => s.p.warranty || ''); tail('Delivery Lead Time', s => s.p.leadTimeDays ? `${s.p.leadTimeDays} days` : '');
  tail('Terms of Payment', s => s.p.quoteTerms || s.p.paymentTerms || ''); tail('Delivery point / Shipyard', s => s.p.deliveryPoint || ''); tail('Inclusions', s => s.p.inclusions || '');
  if (tech) tail('Technical review', s => ((r.tech || {})[s.p.id] || {}).result || rfqQuoteState(r, s.p));
  tail('Score (weighted)', s => sc[s.p.id] ? `${sc[s.p.id].score} (#${sc[s.p.id].rank})` : '');
  tail('Remarks', s => [cmp.lowest && cmp.lowest.id === s.p.id ? 'Lowest valid quote' : '', sc._best === s.p.id ? 'Best score' : '', aw && aw.id === s.p.id ? 'AWARDED' : ''].filter(Boolean).join(' · '));
  return rows;
}
function qarSign(D) {
  const steps = D.aw ? (D.aw.approvals || []).map(a => ({ who: a.by || '', role: a.role, at: a.at ? a.at.slice(0, 10) : '', status: a.status })) : [];
  const tech = Object.values(D.r.tech || {}).map(t => t.by).filter((v, i, a) => v && a.indexOf(v) === i);
  return { prepared: { who: D.prepared, role: 'Supply Chain', at: D.r.sentAt || D.r.date }, tech, steps };
}
function qarPrint(id) {
  const D = qarData(id), rows = qarRows(D), S2 = qarSign(D), n = D.sup.length;
  const cell = v => typeof v === 'number' ? `<td class="n">${v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>` : `<td>${esc(v ?? '')}</td>`;
  const hdr = rows.slice(4, 10), lines = rows.slice(10), w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups to print the QAR.', 'err');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QAR ${esc(D.r.no)}</title><style>
    @page{size:A4 landscape;margin:10mm} body{font:11px Arial,sans-serif;color:#000;margin:0} h1{font-size:15px;margin:0} h2{font-size:12px;margin:2px 0 6px;font-weight:600}
    table{border-collapse:collapse;width:100%;margin-bottom:8px} td,th{border:1px solid #555;padding:3px 4px;vertical-align:top} th{background:#e8edf5} td.n{text-align:right;white-space:nowrap}
    .sup td:first-child{font-weight:700;width:12%} .aw{background:#fff3c4} .sign{display:grid;grid-template-columns:repeat(${Math.min(4, 2 + S2.steps.length)},1fr);gap:18px;margin-top:22px} .sign div{border-top:1px solid #000;padding-top:3px;font-size:10px}
  </style></head><body><h1>${esc(rows[0][0])}</h1><h2>${esc(rows[1][0])} · ${esc(rows[2][0])}</h2>
  <table class="sup"><tbody>${hdr.map(r => `<tr><td>${esc(r[0])}</td>${D.sup.map((s, k) => `<td colspan="3" class="${D.aw && D.aw.id === s.p.id ? 'aw' : ''}">${esc(r[6 + k * 3] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>
  <table><thead><tr>${lines[0].map((h, i) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${lines.slice(1).map(r => `<tr>${r.map(cell).join('')}</tr>`).join('')}</tbody></table>
  <p>Please see attached offered quotes.${D.r.award && D.r.award.reason ? ` <b>Reason for award:</b> ${esc(D.r.award.reason)}.` : ''}${D.r.award && D.r.award.justification ? ` <b>Justification (fewer quotes):</b> ${esc(D.r.award.justification)}.` : ''}</p>
  <div class="sign"><div>Prepared by: <b>${esc(S2.prepared.who)}</b><br>${esc(S2.prepared.role)} · ${esc(S2.prepared.at || '')}</div>${S2.tech.length ? `<div>Technical review: <b>${esc(S2.tech.join(', '))}</b><br>Technical</div>` : ''}
  ${S2.steps.map(s => `<div>Approved by: <b>${esc(s.status === 'Approved' ? s.who : '')}</b><br>${esc(s.role)} · ${esc(s.status === 'Approved' ? s.at : s.status)}</div>`).join('') || '<div>Approved by:<br>&nbsp;</div>'}</div>
  <p style="font-size:9px;color:#555;margin-top:14px">Printed from the Leonio ERP on ${new Date().toLocaleString('en-PH')}. ${n} supplier(s). Amounts in each supplier's currency${D.sup.some(s => s.p.currency) ? '; totals also in PHP' : ''}.</p>
  <script>setTimeout(()=>window.print(),300)<\/script></body></html>`);
  w.document.close();
}
function qarExport(id) {
  const D = qarData(id), rows = qarRows(D), S2 = qarSign(D);
  rows.push([], ['Please see attached offered quotes.'], ['Prepared by', S2.prepared.who, S2.prepared.role, S2.prepared.at || '']);
  if (S2.tech.length) rows.push(['Technical review', S2.tech.join(', ')]);
  S2.steps.forEach(s => rows.push(['Approved by', s.status === 'Approved' ? s.who : '', s.role, s.status === 'Approved' ? s.at : s.status]));
  if (D.r.award && D.r.award.reason) rows.push(['Reason for award', D.r.award.reason]);
  if (D.r.award && D.r.award.justification) rows.push(['Justification', D.r.award.justification]);
  downloadBlob(xlsxBlob('QAR', rows, [22, 6, 40, 16, 7, 7].concat(D.sup.flatMap(() => [34, 12, 14]))), fileSafe(`QAR_${D.r.no}_${D.r.prNo}.xlsx`));
  toast('QAR exported to Excel.');
}

/* ---------- RFQ settings: weights and title ---------- */
rfqSettings = function () {
  const c = rfqCfg(), w = qarWeights();
  modal('RFQ settings', `<div class="form-grid"><label class="fld">Minimum valid quotes<input type="number" id="rs_min" value="${c.minQuotes}"></label><label class="fld">From amount (₱)<input type="number" id="rs_th" value="${c.threshold}"></label>
    <label class="fld">Quote deadline (days)<input type="number" id="rs_due" value="${c.dueDays}"></label><label class="fld">QAR title<input id="rs_title" value="${esc((DB.settings.rfq || {}).qarTitle || 'Canvass Sheet')}"></label>
    <label class="fld w3">Item categories that need a technical review<input id="rs_cat" value="${esc(c.techCategories)}"></label></div>
    <h3 style="margin-top:12px">Score weights (%)</h3><div class="form-grid">${QAR_W.map(([k, l]) => `<label class="fld">${esc(l)}<input type="number" id="rw_${k}" value="${w[k]}"></label>`).join('')}</div>
    <p class="small muted">Fixed asset lines always need a technical review. Weights are relative; they need not add up to 100.</p>`, async () => {
    const weights = Object.fromEntries(QAR_W.map(([k]) => [k, num($('#rw_' + k).value)]));
    if (!sum(Object.values(weights), x => x)) { toast('At least one weight must be above zero.', 'err'); return false; }
    const ok = await commit(() => { DB.settings.rfq = { ...(DB.settings.rfq || {}), minQuotes: num($('#rs_min').value) || 3, threshold: num($('#rs_th').value), dueDays: num($('#rs_due').value) || 3, techCategories: $('#rs_cat').value.trim(), qarTitle: $('#rs_title').value.trim() || 'Canvass Sheet', weights }; }, 'Changed RFQ settings');
    if (ok !== false) render(); else return false;
  }, 'Save', true);
};

/* ---------- Make Order: carry extra charges and discount to the PO remarks ---------- */
const _pqMakePO_qar = pqMakePO;
pqMakePO = async function () {
  const pq = dbDoc(); await _pqMakePO_qar();
  const t = pq && qarTotal(pq); if (!pq || !(t.extras || t.discount)) return;
  const po = DB.docs.filter(x => x.type === 'PO' && x.pqNo === pq.no && x.company === pq.company).pop(); if (!po) return;
  const note = `From quote ${pq.no}: ${(pq.extraCharges || []).map(e => `${e.desc} ${money(e.amount)}`).join(', ')}${t.discount ? `; discount ${money(t.discount)}` : ''}. Add these to the PO lines (item charge or G/L) before releasing.`;
  await commit(() => { po.remarks = [po.remarks, note].filter(Boolean).join(' | '); }, 'PO note: quote charges', po.no);
  toast('The quote has extra charges or a discount. They are noted in the PO remarks; add them as PO lines before releasing.', 'err');
};
