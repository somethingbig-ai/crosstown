// unpack.js (perf lane, download size): turns a packed file (.dz.bin, made by lanes/perf/dl/tools/pack.mjs) back into the bytes of the file it was
// made from. The same code runs in the page's worker (worker.js), on the main thread as the fallback (dl.js), and in node for the proof (verify.mjs).
// A packed file is: a list of SEGMENTS that tile the original file end to end, and the segments' bytes, each segment rearranged (never rounded:
// every step below is a permutation of bytes or a wrap-around integer difference, undone exactly here) so that zstd packs them smaller, then
// grouped by kind of data and zstd-packed in chunks.
//   header  u32 'DLZ1', rawLen, nSeg, tabRaw, tabComp, nChunks, flags, then nChunks x (raw, comp)
//   table   nSeg x 3 u32: len, tf | stride << 8 | comp << 24, class      (zstd-packed when tabComp != tabRaw)
//   chunks  the rearranged bytes, segments ordered by class then by place in the file; a chunk with comp == raw is stored as it is
// tf: 0 as is; 1 one plane per component; 2 one plane per byte; 3 difference to the element before, then one plane per component;
//     4 difference to the element before, then one plane per byte. (stride = bytes per element, comp = bytes per component)
export const MAGIC = 0x315a4c44;
const TA = { 1: Uint8Array, 2: Uint16Array, 4: Uint32Array };
export function unpack(src, zstd) {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength); if (dv.getUint32(0, true) !== MAGIC) throw new Error('not a packed file');
  const rawLen = dv.getUint32(4, true), nSeg = dv.getUint32(8, true), tabRaw = dv.getUint32(12, true), tabComp = dv.getUint32(16, true), nCh = dv.getUint32(20, true);
  let p = 28 + nCh * 8;
  const tb = tabComp === tabRaw ? src.slice(p, p + tabComp) : zstd.decode(src.subarray(p, p + tabComp), tabRaw); p += tabComp;
  if (tb.byteLength !== nSeg * 12) throw new Error('packed file: bad table');
  const tab = new Uint32Array(tb.buffer, tb.byteOffset, nSeg * 3);
  const T = new Uint8Array(rawLen); let t = 0;
  for (let i = 0; i < nCh; i++) { const raw = dv.getUint32(28 + i * 8, true), comp = dv.getUint32(32 + i * 8, true), part = src.subarray(p, p + comp);
    if (comp === raw) T.set(part, t); else { const d = zstd.decode(part, raw); if (d.byteLength !== raw) throw new Error('packed file: bad chunk'); T.set(d, t); } t += raw; p += comp; }
  if (t !== rawLen) throw new Error('packed file: bad length');
  // where each class starts in T
  let nClass = 0; for (let i = 0; i < nSeg; i++) nClass = Math.max(nClass, tab[i * 3 + 2] + 1);
  const at = new Float64Array(nClass + 1); for (let i = 0; i < nSeg; i++) at[tab[i * 3 + 2] + 1] += tab[i * 3]; for (let c = 0; c < nClass; c++) at[c + 1] += at[c];
  const out = new Uint8Array(rawLen); let q = 0;
  for (let i = 0; i < nSeg; i++) {
    const len = tab[i * 3], w = tab[i * 3 + 1], tf = w & 255, s = (w >>> 8) & 65535, c = w >>> 24, cl = tab[i * 3 + 2], o = at[cl]; at[cl] += len;
    if (tf === 0) out.set(T.subarray(o, o + len), q);
    else {
      const n = len / s, k = s / c;
      if (tf === 1 || tf === 3) {
        const A = TA[c], tmp = new A(n * k), d = tf === 3;
        for (let j = 0; j < k; j++) { const pl = new A(T.slice(o + j * n * c, o + (j + 1) * n * c).buffer); let acc = 0; if (d) for (let e = 0, x = j; e < n; e++, x += k) { acc = (acc + pl[e]) | 0; tmp[x] = acc; } else for (let e = 0, x = j; e < n; e++, x += k) tmp[x] = pl[e]; }
        out.set(new Uint8Array(tmp.buffer), q);
      } else if (tf === 2) { for (let b = 0; b < s; b++) { const base = o + b * n; for (let e = 0, x = q + b; e < n; e++, x += s) out[x] = T[base + e]; } }
      else if (tf === 4) {
        const tmp = new Uint8Array(len); for (let b = 0; b < s; b++) { const base = o + b * n; for (let e = 0, x = b; e < n; e++, x += s) tmp[x] = T[base + e]; }
        const v = new TA[c](tmp.buffer); for (let x = k; x < n * k; x++) v[x] += v[x - k];
        out.set(tmp, q);
      } else throw new Error('packed file: unknown step ' + tf);
    }
    q += len;
  }
  if (q !== rawLen) throw new Error('packed file: segments do not fill the file');
  return out;
}
