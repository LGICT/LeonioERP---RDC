'use strict';
/* ============ Minimal .xlsx reader (no libraries; uses the browser's built-in unzip) ============ */
async function readXlsx(arrayBuffer, sheetFilter) { // sheetFilter(name) → false skips that sheet
  const buf = new Uint8Array(arrayBuffer), dv = new DataView(arrayBuffer);
  // Find "End of central directory"
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a valid Excel (.xlsx) file.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = {};
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nlen));
    entries[name] = { method, csize, off };
    p += 46 + nlen + xlen + clen;
  }
  async function text(name) {
    const e = entries[name]; if (!e) return null;
    const lnlen = dv.getUint16(e.off + 26, true), lxlen = dv.getUint16(e.off + 28, true);
    const data = buf.subarray(e.off + 30 + lnlen + lxlen, e.off + 30 + lnlen + lxlen + e.csize);
    if (e.method === 0) return dec.decode(data);
    const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(ds).text();
  }
  const unx = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&amp;/g, '&');
  const ss = [];
  const sst = await text('xl/sharedStrings.xml');
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) ss.push(unx([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')));
  const wb = await text('xl/workbook.xml'), rels = await text('xl/_rels/workbook.xml.rels');
  const relMap = {};
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = (m[1].match(/Id="([^"]+)"/) || [])[1], t = (m[1].match(/Target="([^"]+)"/) || [])[1];
    relMap[id] = t;
  }
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const nm = unx((m[1].match(/name="([^"]*)"/) || [])[1] || '');
    if (sheetFilter && !sheetFilter(nm)) continue;
    const rid = (m[1].match(/r:id="([^"]+)"/) || [])[1];
    let target = relMap[rid] || ''; target = target.replace(/^\/?xl\//, ''); if (target.startsWith('/')) target = target.slice(1);
    const xml = await text('xl/' + target); if (!xml) continue;
    const rows = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = (c[1].match(/r="([A-Z]+)\d+"/) || [])[1]; const t = (c[1].match(/t="([^"]+)"/) || [])[1];
        let v = '';
        if (c[2]) {
          if (t === 'inlineStr') v = unx([...c[2].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''));
          else { const vm = c[2].match(/<v>([\s\S]*?)<\/v>/); v = vm ? unx(vm[1]) : ''; if (t === 's' && v !== '') v = ss[+v] ?? ''; }
        }
        let col = 0; for (const ch of ref || 'A') col = col * 26 + ch.charCodeAt(0) - 64;
        row[col - 1] = String(v).replace(/[\r\n\t]+/g, ' ').trim();
      }
      for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
      if (row.some(x => x !== '')) rows.push(row);
    }
    sheets.push({ name: nm, rows });
  }
  return sheets;
}
