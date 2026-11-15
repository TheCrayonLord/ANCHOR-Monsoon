// Selections are document-sized opaque grayscale canvases (white = selected).
import { Canvas, ctx2d, makeCanvas, Rect, Pt, lum, clamp, getData } from './util';
import { blurChannel } from './filters';

export type SelOp = 'new' | 'add' | 'subtract' | 'intersect';

export function blankMask(w: number, h: number, v = 0): Canvas {
  const c = makeCanvas(w, h); const x = ctx2d(c); x.fillStyle = v ? `rgb(${v},${v},${v})` : '#000'; x.fillRect(0, 0, w, h); return c;
}
/** Combine a white-on-black shape mask into the selection using a selection operation. */
export function combine(sel: Canvas | null, shape: Canvas, op: SelOp, w: number, h: number): Canvas {
  const out = op === 'new' || !sel ? blankMask(w, h) : (() => { const c = makeCanvas(w, h); ctx2d(c).drawImage(sel, 0, 0); return c; })();
  const x = ctx2d(out);
  if (op === 'new' || op === 'add' || !sel) { x.globalCompositeOperation = 'lighten'; x.drawImage(shape, 0, 0); }
  else if (op === 'subtract') { const inv = invertMask(shape); x.globalCompositeOperation = 'darken'; x.drawImage(inv, 0, 0); }
  else if (op === 'intersect') { x.globalCompositeOperation = 'darken'; x.drawImage(shape, 0, 0); }
  x.globalCompositeOperation = 'source-over';
  return out;
}
export function shapeMask(w: number, h: number, draw: (x: CanvasRenderingContext2D) => void, feather = 0, aa = true): Canvas {
  const c = blankMask(w, h); const x = ctx2d(c);
  x.fillStyle = '#fff'; x.strokeStyle = '#fff'; x.imageSmoothingEnabled = aa;
  draw(x);
  if (!aa) hardenMask(c);
  return feather > 0 ? featherMask(c, feather) : c;
}
function hardenMask(c: Canvas) { const d = getData(c); const p = d.data; for (let i = 0; i < p.length; i += 4) { const v = p[i] >= 128 ? 255 : 0; p[i] = p[i + 1] = p[i + 2] = v; } ctx2d(c).putImageData(d, 0, 0); }
export function invertMask(m: Canvas): Canvas {
  const c = makeCanvas(m.width, m.height); const x = ctx2d(c);
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.globalCompositeOperation = 'difference'; x.drawImage(m, 0, 0); return c;
}
function readChannel(m: Canvas): Uint8ClampedArray { const d = getData(m).data, out = new Uint8ClampedArray(m.width * m.height); for (let i = 0; i < out.length; i++) out[i] = d[i * 4]; return out; }
function writeChannel(ch: ArrayLike<number>, w: number, h: number): Canvas {
  const c = makeCanvas(w, h), d = new ImageData(w, h), p = d.data;
  for (let i = 0; i < ch.length; i++) { const v = ch[i]; p[i * 4] = p[i * 4 + 1] = p[i * 4 + 2] = v; p[i * 4 + 3] = 255; }
  ctx2d(c).putImageData(d, 0, 0); return c;
}
export { readChannel, writeChannel };
export function featherMask(m: Canvas, r: number): Canvas { return writeChannel(blurChannel(readChannel(m), m.width, m.height, r / 2), m.width, m.height); }

/** Grayscale mask to an alpha-only canvas for destination-in compositing. */
export function maskToAlpha(m: Canvas, density = 1, invertOutside = 0): Canvas {
  const d = getData(m), p = d.data;
  for (let i = 0; i < p.length; i += 4) { const v = 255 - (255 - p[i]) * density; p[i + 3] = v; p[i] = p[i + 1] = p[i + 2] = 0; }
  const c = makeCanvas(m.width, m.height); ctx2d(c).putImageData(d, 0, 0); void invertOutside; return c;
}
export function isEmpty(m: Canvas): boolean { const d = getData(m).data; for (let i = 0; i < d.length; i += 4) if (d[i] > 0) return false; return true; }
export function maskBounds(m: Canvas, thr = 0): Rect | null {
  const d = getData(m).data, w = m.width, h = m.height; let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4] > thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Euclidean distance transform (Felzenszwalb & Huttenlocher).
function edt1d(f: Float32Array, n: number, d: Float32Array, v: Int32Array, z: Float32Array) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
}
/** Distance from each pixel to the nearest pixel where inside[i] is true. */
export function edt(inside: Uint8Array | boolean[], w: number, h: number): Float32Array {
  const INF = 1e20, g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = inside[i] ? 0 : INF;
  const n = Math.max(w, h), f = new Float32Array(n), d = new Float32Array(n), v = new Int32Array(n), z = new Float32Array(n + 1);
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; edt1d(f, h, d, v, z); for (let y = 0; y < h; y++) g[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = g[y * w + x]; edt1d(f, w, d, v, z); for (let x = 0; x < w; x++) g[y * w + x] = Math.sqrt(d[x]); }
  return g;
}
export function expandMask(m: Canvas, r: number): Canvas {
  const ch = readChannel(m), w = m.width, h = m.height, ins = new Uint8Array(w * h);
  for (let i = 0; i < ins.length; i++) ins[i] = ch[i] >= 128 ? 1 : 0;
  const d = edt(ins, w, h), out = new Uint8ClampedArray(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i] <= r ? 255 : d[i] < r + 1 ? (r + 1 - d[i]) * 255 : 0;
  return writeChannel(out, w, h);
}
export function contractMask(m: Canvas, r: number): Canvas { return invertMask(expandMask(invertMask(m), r)); }
export function borderMask(m: Canvas, r: number): Canvas {
  const a = expandMask(m, r / 2), b = contractMask(m, r / 2), w = m.width, h = m.height;
  const A = readChannel(a), B = readChannel(b), out = new Uint8ClampedArray(w * h);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, A[i] - B[i]);
  return featherMask(writeChannel(out, w, h), 1);
}
export function smoothMask(m: Canvas, r: number): Canvas {
  const b = blurChannel(readChannel(m), m.width, m.height, r), out = new Uint8ClampedArray(b.length);
  for (let i = 0; i < b.length; i++) out[i] = clamp((b[i] - 128) * 4 + 128);
  return writeChannel(out, m.width, m.height);
}

/** Flood/global colour-similarity mask (Magic Wand, Grow, Similar, Paint Bucket). */
export function colorMask(img: ImageData, seeds: Pt[], tol: number, contiguous: boolean, aa = true, sampleSize = 1): Uint8ClampedArray {
  const { width: w, height: h, data: d } = img, out = new Uint8ClampedArray(w * h);
  const refs = seeds.map((s) => {
    const r = Math.floor(sampleSize / 2); let R = 0, G = 0, B = 0, A = 0, n = 0;
    for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) { const x = clamp(Math.floor(s.x) + k, 0, w - 1), y = clamp(Math.floor(s.y) + j, 0, h - 1), i = (y * w + x) * 4; R += d[i]; G += d[i + 1]; B += d[i + 2]; A += d[i + 3]; n++; }
    return [R / n, G / n, B / n, A / n];
  });
  const near = (i: number) => {
    for (const c of refs) if (Math.abs(d[i] - c[0]) <= tol && Math.abs(d[i + 1] - c[1]) <= tol && Math.abs(d[i + 2] - c[2]) <= tol && Math.abs(d[i + 3] - c[3]) <= tol) return true;
    return false;
  };
  if (!contiguous) { for (let p = 0; p < w * h; p++) if (near(p * 4)) out[p] = 255; }
  else {
    const stack: number[] = [];
    for (const s of seeds) { const x = Math.floor(s.x), y = Math.floor(s.y); if (x >= 0 && y >= 0 && x < w && y < h) stack.push(y * w + x); }
    while (stack.length) {
      const p = stack.pop()!;
      if (out[p] || !near(p * 4)) continue;
      // scanline fill
      let x = p % w; const y = (p - x) / w; let l = x, r = x;
      while (l > 0 && !out[y * w + l - 1] && near((y * w + l - 1) * 4)) l--;
      while (r < w - 1 && !out[y * w + r + 1] && near((y * w + r + 1) * 4)) r++;
      for (x = l; x <= r; x++) {
        out[y * w + x] = 255;
        if (y > 0 && !out[(y - 1) * w + x]) stack.push((y - 1) * w + x);
        if (y < h - 1 && !out[(y + 1) * w + x]) stack.push((y + 1) * w + x);
      }
    }
  }
  if (aa) {
    const b = blurChannel(out, w, h, 0.6);
    for (let i = 0; i < out.length; i++) out[i] = Math.max(out[i], b[i] * 0.9);
  }
  return out;
}

/** Color Range: fuzziness-based global selection from sampled colours or tonal ranges. */
export function colorRange(img: ImageData, mode: string, colors: [number, number, number][], fuzz: number, invert = false): Uint8ClampedArray {
  const { width: w, height: h, data: d } = img, out = new Uint8ClampedArray(w * h);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4, r = d[i], g = d[i + 1], b = d[i + 2], l = lum(r, g, b);
    let v = 0;
    if (mode === 'sampled') {
      for (const c of colors) { const dist = Math.sqrt((r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2); v = Math.max(v, clamp(1 - dist / Math.max(1, fuzz * 1.7), 0, 1)); }
    } else if (mode === 'highlights') v = clamp((l - 170) / 40, 0, 1);
    else if (mode === 'midtones') v = clamp(1 - Math.abs(l - 128) / 70, 0, 1);
    else if (mode === 'shadows') v = clamp((85 - l) / 40, 0, 1);
    else if (mode === 'skin') { const isSkin = r > 95 && g > 40 && b > 20 && r > g && r > b && r - Math.min(g, b) > 15 && Math.abs(r - g) > 15; v = isSkin ? 1 : 0; }
    else {
      const hue = (() => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx === mn) return -1; let hh = mx === r ? (g - b) / (mx - mn) : mx === g ? 2 + (b - r) / (mx - mn) : 4 + (r - g) / (mx - mn); hh *= 60; return hh < 0 ? hh + 360 : hh; })();
      const centers: Record<string, number> = { reds: 0, yellows: 60, greens: 120, cyans: 180, blues: 240, magentas: 300 };
      const s = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
      if (hue >= 0) { const dd = Math.abs(((hue - centers[mode] + 540) % 360) - 180); v = clamp(1 - (dd - 15) / 25, 0, 1) * clamp(s * 3, 0, 1); }
    }
    out[p] = (invert ? 1 - v : v) * 255;
  }
  return out;
}

/** Marching-ants outline as a Path2D in document coordinates. */
export function outlinePath(m: Canvas): Path2D {
  const ch = readChannel(m), w = m.width, h = m.height, path = new Path2D();
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && ch[y * w + x] >= 128;
  // horizontal edges
  for (let y = 0; y <= h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const edge = x < w && on(x, y) !== on(x, y - 1);
      if (edge && start < 0) start = x;
      if (!edge && start >= 0) { path.moveTo(start, y); path.lineTo(x, y); start = -1; }
    }
  }
  for (let x = 0; x <= w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const edge = y < h && on(x, y) !== on(x - 1, y);
      if (edge && start < 0) start = y;
      if (!edge && start >= 0) { path.moveTo(x, start); path.lineTo(x, y); start = -1; }
    }
  }
  return path;
}

/** Heuristic subject mask: saliency from colour contrast against the border, refined with a graph-free threshold. */
export function selectSubject(img: ImageData): Uint8ClampedArray {
  const { width: w, height: h, data: d } = img, out = new Uint8ClampedArray(w * h);
  // background model: average colour of border pixels (k=4 clusters by simple binning)
  const samples: number[][] = [];
  for (let x = 0; x < w; x += 4) { samples.push(px(x, 0)); samples.push(px(x, h - 1)); }
  for (let y = 0; y < h; y += 4) { samples.push(px(0, y)); samples.push(px(w - 1, y)); }
  function px(x: number, y: number) { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]]; }
  const cents = kmeans(samples, 5);
  const sal = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4; let best = 1e9;
    for (const c of cents) best = Math.min(best, (d[i] - c[0]) ** 2 + (d[i + 1] - c[1]) ** 2 + (d[i + 2] - c[2]) ** 2);
    const x = p % w, y = (p - x) / w, cx = (x / w - 0.5) * 2, cy = (y / h - 0.5) * 2;
    sal[p] = Math.sqrt(best) * (1.2 - 0.5 * (cx * cx + cy * cy));
  }
  const b = blurChannel(sal, w, h, Math.max(2, Math.min(w, h) / 120));
  let mx = 0; for (let i = 0; i < b.length; i++) if (b[i] > mx) mx = b[i];
  // Otsu threshold
  const hist = new Float32Array(256); for (let i = 0; i < b.length; i++) hist[Math.floor((b[i] / (mx || 1)) * 255)]++;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sb = 0, wb = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) { wb += hist[t]; if (!wb) continue; const wf = b.length - wb; if (!wf) break; sb += t * hist[t]; const mb = sb / wb, mf = (sum - sb) / wf, v = wb * wf * (mb - mf) ** 2; if (v > best) { best = v; thr = t; } }
  for (let i = 0; i < out.length; i++) out[i] = (b[i] / (mx || 1)) * 255 > thr ? 255 : 0;
  // keep the largest connected component(s) touching the centre region and fill holes
  return fillHoles(largestComponents(out, w, h), w, h);
}
function kmeans(pts: number[][], k: number) {
  let c = pts.filter((_, i) => i % Math.max(1, Math.floor(pts.length / k)) === 0).slice(0, k).map((p) => [...p]);
  for (let it = 0; it < 8; it++) {
    const acc = c.map(() => [0, 0, 0, 0]);
    for (const p of pts) { let bi = 0, bd = 1e9; c.forEach((q, j) => { const dd = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2; if (dd < bd) { bd = dd; bi = j; } }); acc[bi][0] += p[0]; acc[bi][1] += p[1]; acc[bi][2] += p[2]; acc[bi][3]++; }
    c = c.map((q, j) => acc[j][3] ? [acc[j][0] / acc[j][3], acc[j][1] / acc[j][3], acc[j][2] / acc[j][3]] : q);
  }
  return c;
}
function largestComponents(m: Uint8ClampedArray, w: number, h: number) {
  const lab = new Int32Array(w * h).fill(-1), sizes: number[] = []; let id = 0;
  for (let p = 0; p < w * h; p++) {
    if (!m[p] || lab[p] >= 0) continue;
    const st = [p]; lab[p] = id; let n = 0;
    while (st.length) { const q = st.pop()!; n++; const x = q % w, y = (q - x) / w; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const r = Y * w + X; if (m[r] && lab[r] < 0) { lab[r] = id; st.push(r); } } }
    sizes.push(n); id++;
  }
  if (!sizes.length) return m;
  const mx = Math.max(...sizes), out = new Uint8ClampedArray(w * h);
  for (let p = 0; p < w * h; p++) if (lab[p] >= 0 && sizes[lab[p]] >= mx * 0.15) out[p] = 255;
  return out;
}
function fillHoles(m: Uint8ClampedArray, w: number, h: number) {
  const outside = new Uint8Array(w * h), st: number[] = [];
  for (let x = 0; x < w; x++) { st.push(x, (h - 1) * w + x); } for (let y = 0; y < h; y++) { st.push(y * w, y * w + w - 1); }
  while (st.length) { const q = st.pop()!; if (outside[q] || m[q]) continue; outside[q] = 1; const x = q % w, y = (q - x) / w; if (x > 0) st.push(q - 1); if (x < w - 1) st.push(q + 1); if (y > 0) st.push(q - w); if (y < h - 1) st.push(q + w); }
  const out = new Uint8ClampedArray(w * h); for (let i = 0; i < out.length; i++) out[i] = outside[i] ? 0 : 255; return out;
}
/** Sky: bright, low-saturation-or-blue region connected to the top edge. */
export function selectSky(img: ImageData): Uint8ClampedArray {
  const { width: w, height: h, data: d } = img;
  const seeds: Pt[] = []; for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 20))) seeds.push({ x, y: 1 });
  const m = new Uint8ClampedArray(w * h), st: number[] = seeds.map((s) => s.y * w + s.x);
  const skyish = (i: number) => { const r = d[i], g = d[i + 1], b = d[i + 2], l = lum(r, g, b); return (b >= r - 10 && l > 90) || l > 200; };
  while (st.length) { const q = st.pop()!; if (m[q] || !skyish(q * 4)) continue; m[q] = 255; const x = q % w, y = (q - x) / w; if (x > 0) st.push(q - 1); if (x < w - 1) st.push(q + 1); if (y > 0) st.push(q - w); if (y < h - 1) st.push(q + w); }
  return m;
}
