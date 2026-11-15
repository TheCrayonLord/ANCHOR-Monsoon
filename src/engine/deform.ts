// Puppet warp (moving least squares), perspective warp (plane homography) and content-aware scale (seam carving).
import { Canvas, ctx2d, makeCanvas, Pt, Rect } from './util';
import { meshWarp, Quad } from './transform';

export interface Pin { src: Pt; dst: Pt }
export type PuppetMode = 'rigid' | 'normal' | 'distort';

/** Moving-least-squares deformation driven by pins. Rigid keeps shapes, normal allows scale, distort spreads influence wider. */
export function puppetMap(pins: Pin[], mode: PuppetMode = 'rigid') {
  const alpha = mode === 'distort' ? 1 : 2;
  return (v: Pt): Pt => {
    if (!pins.length) return v;
    if (pins.length === 1) return { x: v.x + pins[0].dst.x - pins[0].src.x, y: v.y + pins[0].dst.y - pins[0].src.y };
    let sw = 0, px = 0, py = 0, qx = 0, qy = 0;
    const w = pins.map((p) => { const d2 = (p.src.x - v.x) ** 2 + (p.src.y - v.y) ** 2; return d2 < 1e-6 ? 1e12 : 1 / Math.pow(d2, alpha); });
    pins.forEach((p, i) => { sw += w[i]; px += w[i] * p.src.x; py += w[i] * p.src.y; qx += w[i] * p.dst.x; qy += w[i] * p.dst.y; });
    px /= sw; py /= sw; qx /= sw; qy /= sw;
    // complex number sum of conj(p^) * q^ gives the best rotation (and scale)
    let re = 0, im = 0, pp = 0;
    pins.forEach((p, i) => {
      const ax = p.src.x - px, ay = p.src.y - py, bx = p.dst.x - qx, by = p.dst.y - qy;
      re += w[i] * (ax * bx + ay * by); im += w[i] * (ax * by - ay * bx); pp += w[i] * (ax * ax + ay * ay);
    });
    let a = 1, b = 0;
    if (mode === 'rigid') { const m = Math.hypot(re, im); if (m > 1e-12) { a = re / m; b = im / m; } }
    else if (pp > 1e-12) { a = re / pp; b = im / pp; }
    const dx = v.x - px, dy = v.y - py;
    return { x: qx + dx * a - dy * b, y: qy + dx * b + dy * a };
  };
}

/** Homography that maps quad `from` onto quad `to` (both tl, tr, br, bl). */
export function homography(from: Quad, to: Quad): (p: Pt) => Pt {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i], { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) { // Gaussian elimination with pivoting
    let piv = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    const d = A[c][c]; if (Math.abs(d) < 1e-12) return (p) => p;
    for (let k = c; k < 9; k++) A[c][k] /= d;
    for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c]; if (f) for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k]; }
  }
  const h = A.map((r) => r[8]);
  return (p) => { let w = h[6] * p.x + h[7] * p.y + 1; if (w < 0.05) w = 0.05; return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w }; };
}

/** Render src (placed at rect) through a point mapping, returning the new canvas and its offset. */
export function deformRender(src: Canvas, rect: Rect, map: (p: Pt) => Pt, n = 28) {
  const f = (u: number, v: number) => map({ x: rect.x + u * rect.w, y: rect.y + v * rect.h });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const p = f(i / n, j / n); x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  x0 = Math.floor(x0) - 2; y0 = Math.floor(y0) - 2;
  const c = makeCanvas(Math.max(1, Math.min(16000, Math.ceil(x1) - x0 + 4)), Math.max(1, Math.min(16000, Math.ceil(y1) - y0 + 4))), x = ctx2d(c);
  x.imageSmoothingQuality = 'high'; x.translate(-x0, -y0);
  meshWarp(x, src, f, n);
  return { canvas: c, x: x0, y: y0 };
}

// ---------- content-aware scale ----------
function isSkin(r: number, g: number, b: number) {
  return r > 95 && g > 40 && b > 20 && r > g && r > b && r - Math.min(g, b) > 15 && Math.abs(r - g) > 15;
}
interface Grid { px: Uint32Array<any>; lum: Float32Array<any>; prot: Float32Array<any>; w: number; h: number }
function energy(g: Grid) {
  const { lum, prot, w, h } = g, e = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const r = y * w, up = (y > 0 ? y - 1 : y) * w, dn = (y < h - 1 ? y + 1 : y) * w;
    for (let x = 0; x < w; x++) {
      const l = x > 0 ? x - 1 : x, rr = x < w - 1 ? x + 1 : x;
      e[r + x] = Math.abs(lum[r + rr] - lum[r + l]) + Math.abs(lum[dn + x] - lum[up + x]) + prot[r + x];
    }
  }
  return e;
}
/** Lowest-energy vertical seam (one x per row). */
function findSeam(g: Grid): Int32Array {
  const { w, h } = g, e = energy(g), M = new Float32Array(w * h);
  M.set(e.subarray(0, w));
  for (let y = 1; y < h; y++) {
    const r = y * w, p = r - w;
    for (let x = 0; x < w; x++) {
      let m = M[p + x]; if (x > 0 && M[p + x - 1] < m) m = M[p + x - 1]; if (x < w - 1 && M[p + x + 1] < m) m = M[p + x + 1];
      M[r + x] = e[r + x] + m;
    }
  }
  const seam = new Int32Array(h); let bx = 0, last = (h - 1) * w;
  for (let x = 1; x < w; x++) if (M[last + x] < M[last + bx]) bx = x;
  seam[h - 1] = bx;
  for (let y = h - 2; y >= 0; y--) {
    const r = y * w, px = seam[y + 1]; let b = px;
    if (px > 0 && M[r + px - 1] < M[r + b]) b = px - 1; if (px < w - 1 && M[r + px + 1] < M[r + b]) b = px + 1;
    seam[y] = b;
  }
  return seam;
}
function removeSeam(g: Grid, seam: Int32Array, idx?: Int32Array): Int32Array | undefined {
  const { w, h } = g, nw = w - 1;
  const px = new Uint32Array(nw * h), lum = new Float32Array(nw * h), prot = new Float32Array(nw * h), ni = idx ? new Int32Array(nw * h) : undefined;
  for (let y = 0; y < h; y++) {
    const s = seam[y], o = y * w, n = y * nw;
    px.set(g.px.subarray(o, o + s), n); px.set(g.px.subarray(o + s + 1, o + w), n + s);
    lum.set(g.lum.subarray(o, o + s), n); lum.set(g.lum.subarray(o + s + 1, o + w), n + s);
    prot.set(g.prot.subarray(o, o + s), n); prot.set(g.prot.subarray(o + s + 1, o + w), n + s);
    if (idx && ni) { ni.set(idx.subarray(o, o + s), n); ni.set(idx.subarray(o + s + 1, o + w), n + s); }
  }
  g.px = px; g.lum = lum; g.prot = prot; g.w = nw;
  return ni;
}
function avg(a: number, b: number) {
  return (((a & 0xff) + (b & 0xff)) >> 1) | ((((a >>> 8) & 0xff) + ((b >>> 8) & 0xff)) >> 1) << 8 | ((((a >>> 16) & 0xff) + ((b >>> 16) & 0xff)) >> 1) << 16 | ((((a >>> 24) & 0xff) + ((b >>> 24) & 0xff)) >> 1) << 24;
}
function makeGrid(px: Uint32Array, w: number, h: number, prot: Float32Array): Grid {
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { const p = px[i], a = (p >>> 24) / 255; lum[i] = (0.299 * (p & 0xff) + 0.587 * ((p >>> 8) & 0xff) + 0.114 * ((p >>> 16) & 0xff)) * a; }
  return { px, lum, prot, w, h };
}
/** Change the width only, by removing or duplicating low-energy seams. */
function scaleWidth(px: Uint32Array, w: number, h: number, prot: Float32Array, tw: number): { px: Uint32Array; prot: Float32Array; w: number } {
  if (tw === w) return { px, prot, w };
  if (tw < w) {
    const g = makeGrid(px, w, h, prot);
    while (g.w > tw) removeSeam(g, findSeam(g));
    return { px: g.px, prot: g.prot, w: g.w };
  }
  // enlarge: find up to half the width in seams at a time, then duplicate them
  let cur = { px, prot, w };
  while (cur.w < tw) {
    const k = Math.min(tw - cur.w, Math.max(1, Math.floor(cur.w / 2)));
    const g = makeGrid(cur.px.slice(), cur.w, h, cur.prot.slice());
    let idx: Int32Array = new Int32Array(cur.w * h); for (let y = 0; y < h; y++) for (let x = 0; x < cur.w; x++) idx[y * cur.w + x] = x;
    const dup = new Uint8Array(cur.w * h);
    for (let s = 0; s < k; s++) { const seam = findSeam(g); for (let y = 0; y < h; y++) dup[y * cur.w + idx[y * g.w + seam[y]]]++; idx = removeSeam(g, seam, idx)!; }
    const nw = cur.w + k, out = new Uint32Array(nw * h), op = new Float32Array(nw * h);
    for (let y = 0; y < h; y++) {
      let n = y * nw; const o = y * cur.w;
      for (let x = 0; x < cur.w; x++) {
        const p = cur.px[o + x]; out[n] = p; op[n++] = cur.prot[o + x];
        for (let c = 0; c < dup[o + x]; c++) { out[n] = avg(p, cur.px[o + Math.min(cur.w - 1, x + 1)]); op[n++] = cur.prot[o + x]; }
      }
    }
    cur = { px: out, prot: op, w: nw };
  }
  return cur;
}
function transpose<T extends Uint32Array | Float32Array>(a: T, w: number, h: number): T {
  const o = new (a.constructor as any)(w * h) as T;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o[x * h + y] = a[y * w + x];
  return o;
}
/** Content-aware scale. `protect` is an optional 0..255 mask (same size) of areas to keep; `skin` also protects skin tones. */
export function seamCarve(img: ImageData, tw: number, th: number, protect?: Uint8ClampedArray | null, skin = false): ImageData {
  const w = img.width, h = img.height;
  tw = Math.max(1, Math.round(tw)); th = Math.max(1, Math.round(th));
  let px: Uint32Array = new Uint32Array(img.data.buffer.slice(0)), prot: Float32Array = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (protect && protect[i] > 127) prot[i] = 1e5;
    if (skin) { const p = px[i]; if (isSkin(p & 0xff, (p >>> 8) & 0xff, (p >>> 16) & 0xff)) prot[i] = 1e5; }
  }
  let r = scaleWidth(px, w, h, prot, tw);
  px = transpose(r.px, r.w, h); prot = transpose(r.prot, r.w, h);
  const r2 = scaleWidth(px, h, r.w, prot, th); // transposed: width is the image height
  const out = transpose(r2.px, r2.w, r.w);
  return new ImageData(new Uint8ClampedArray(out.buffer as ArrayBuffer), r.w, r2.w);
}
