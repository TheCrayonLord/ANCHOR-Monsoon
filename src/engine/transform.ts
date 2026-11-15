// Free transform, perspective and warp rendering by drawing a triangle mesh.
import { Canvas, ctx2d, makeCanvas, Pt, Rect } from './util';

export type Quad = [Pt, Pt, Pt, Pt]; // tl, tr, br, bl

/** Projective map from the unit square to a quad. */
export function squareToQuad(q: Quad) {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  let a, b, c, d, e, f, g, h;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    a = p1.x - p0.x; b = p3.x - p0.x; c = p0.x; d = p1.y - p0.y; e = p3.y - p0.y; f = p0.y; g = 0; h = 0;
  } else {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den;
    a = p1.x - p0.x + g * p1.x; b = p3.x - p0.x + h * p3.x; c = p0.x;
    d = p1.y - p0.y + g * p1.y; e = p3.y - p0.y + h * p3.y; f = p0.y;
  }
  return (u: number, v: number): Pt => { const w = g * u + h * v + 1; return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w }; };
}
/** Inverse: quad point to unit square (numerical, for hit tests and perspective crop). */
export function quadToSquare(q: Quad) {
  const fwd = squareToQuad(q);
  return (p: Pt) => {
    let u = 0.5, v = 0.5;
    for (let i = 0; i < 20; i++) {
      const c = fwd(u, v), du = fwd(u + 1e-4, v), dv = fwd(u, v + 1e-4);
      const j00 = (du.x - c.x) / 1e-4, j01 = (dv.x - c.x) / 1e-4, j10 = (du.y - c.y) / 1e-4, j11 = (dv.y - c.y) / 1e-4;
      const det = j00 * j11 - j01 * j10; if (Math.abs(det) < 1e-12) break;
      const ex = p.x - c.x, ey = p.y - c.y;
      u += (j11 * ex - j01 * ey) / det; v += (-j10 * ex + j00 * ey) / det;
    }
    return { x: u, y: v };
  };
}

function drawTri(x: CanvasRenderingContext2D, img: CanvasImageSource, s0: Pt, s1: Pt, s2: Pt, d0: Pt, d1: Pt, d2: Pt) {
  // expand the clip triangle slightly to hide seams
  const cx = (d0.x + d1.x + d2.x) / 3, cy = (d0.y + d1.y + d2.y) / 3;
  const ex = (p: Pt) => { const dx = p.x - cx, dy = p.y - cy, l = Math.hypot(dx, dy) || 1; return { x: p.x + (dx / l) * 0.7, y: p.y + (dy / l) * 0.7 }; };
  const e0 = ex(d0), e1 = ex(d1), e2 = ex(d2);
  x.save(); x.beginPath(); x.moveTo(e0.x, e0.y); x.lineTo(e1.x, e1.y); x.lineTo(e2.x, e2.y); x.closePath(); x.clip();
  const den = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
  if (Math.abs(den) < 1e-9) { x.restore(); return; }
  const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / den;
  const b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / den;
  const c = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / den;
  const d = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / den;
  const e = d0.x - a * s0.x - c * s0.y, f = d0.y - b * s0.x - d * s0.y;
  x.transform(a, b, c, d, e, f);
  x.drawImage(img, 0, 0);
  x.restore();
}
/** Draw src through mapping f(u,v) (u,v in 0..1 over the source) onto ctx. */
export function meshWarp(x: CanvasRenderingContext2D, src: Canvas, f: (u: number, v: number) => Pt, n = 16, srcRect?: Rect) {
  const sr = srcRect || { x: 0, y: 0, w: src.width, h: src.height };
  const grid: Pt[][] = [];
  for (let j = 0; j <= n; j++) { grid.push([]); for (let i = 0; i <= n; i++) grid[j].push(f(i / n, j / n)); }
  const S = (i: number, j: number): Pt => ({ x: sr.x + (i / n) * sr.w, y: sr.y + (j / n) * sr.h });
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    drawTri(x, src, S(i, j), S(i + 1, j), S(i, j + 1), grid[j][i], grid[j][i + 1], grid[j + 1][i]);
    drawTri(x, src, S(i + 1, j), S(i + 1, j + 1), S(i, j + 1), grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]);
  }
}
export function isAffineQuad(q: Quad) { return Math.abs(q[0].x - q[1].x + q[2].x - q[3].x) < 0.01 && Math.abs(q[0].y - q[1].y + q[2].y - q[3].y) < 0.01; }
/** Render a source canvas into a quad, returning a canvas + its offset. */
export function renderQuad(src: Canvas, q: Quad, srcRect?: Rect): { canvas: Canvas; x: number; y: number } {
  const xs = q.map((p) => p.x), ys = q.map((p) => p.y);
  const x0 = Math.floor(Math.min(...xs)) - 1, y0 = Math.floor(Math.min(...ys)) - 1, x1 = Math.ceil(Math.max(...xs)) + 1, y1 = Math.ceil(Math.max(...ys)) + 1;
  const c = makeCanvas(Math.min(16000, x1 - x0), Math.min(16000, y1 - y0)), x = ctx2d(c);
  x.imageSmoothingQuality = 'high';
  x.translate(-x0, -y0);
  const sr = srcRect || { x: 0, y: 0, w: src.width, h: src.height };
  if (isAffineQuad(q)) {
    const a = (q[1].x - q[0].x) / sr.w, b = (q[1].y - q[0].y) / sr.w, cc = (q[3].x - q[0].x) / sr.h, d = (q[3].y - q[0].y) / sr.h;
    x.transform(a, b, cc, d, q[0].x - a * sr.x - cc * sr.y, q[0].y - b * sr.x - d * sr.y);
    x.drawImage(src, 0, 0);
  } else meshWarp(x, src, squareToQuad(q), 24, sr);
  return { canvas: c, x: x0, y: y0 };
}
/** Bicubic Bezier patch warp with 4x4 control points (row-major). */
export function bezierPatch(cp: Pt[]) {
  const B = (t: number) => [(1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t * t * (1 - t), t ** 3];
  return (u: number, v: number): Pt => {
    const bu = B(u), bv = B(v); let x = 0, y = 0;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const w = bu[i] * bv[j]; x += cp[j * 4 + i].x * w; y += cp[j * 4 + i].y * w; }
    return { x, y };
  };
}
export function patchFromRect(r: Rect): Pt[] { const out: Pt[] = []; for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) out.push({ x: r.x + (r.w * i) / 3, y: r.y + (r.h * j) / 3 }); return out; }
export const WARP_PRESETS = ['custom', 'arc', 'arch', 'bulge', 'flag', 'wave', 'fish', 'rise', 'squeeze', 'twist'];
export function warpPreset(r: Rect, style: string, bend: number): Pt[] {
  const cp = patchFromRect(r), b = bend / 100;
  cp.forEach((p, k) => {
    const i = k % 4, j = Math.floor(k / 4), u = i / 3 * 2 - 1, v = j / 3 * 2 - 1;
    switch (style) {
      case 'arc': p.y -= (1 - u * u) * b * r.h * 0.6; break;
      case 'arch': p.y -= (1 - u * u) * b * r.h * 0.6 * (j === 3 ? 0.4 : 1); break;
      case 'bulge': p.y += v * (1 - u * u) * b * r.h * 0.3; break;
      case 'flag': p.y += Math.sin((i / 3) * Math.PI * 2) * b * r.h * 0.2; break;
      case 'wave': p.y += Math.sin((i / 3) * Math.PI * 2 + j) * b * r.h * 0.2; break;
      case 'fish': p.y += v * (1 - Math.abs(u)) * b * r.h * 0.3; break;
      case 'rise': p.y -= (i / 3) * b * r.h * 0.5; break;
      case 'squeeze': p.x -= u * (1 - v * v) * b * r.w * 0.2; break;
      case 'twist': { const a = b * (1 - Math.hypot(u, v) / 1.5); const cx = r.x + r.w / 2, cy = r.y + r.h / 2, dx = p.x - cx, dy = p.y - cy; p.x = cx + dx * Math.cos(a) - dy * Math.sin(a); p.y = cy + dx * Math.sin(a) + dy * Math.cos(a); break; }
    }
  });
  return cp;
}
