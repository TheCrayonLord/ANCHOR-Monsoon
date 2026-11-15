// Vector paths (pen tool, shape layers, custom shapes) and text layout.
import type { PathPoint, ShapeData, SubPath, TextData, VectorPath } from './types';
import type { Pt, Rect } from './util';

export const pp = (x: number, y: number, smooth = false): PathPoint => ({ x, y, ix: x, iy: y, ox: x, oy: y, smooth });
export function pathToPath2D(p: VectorPath, ox = 0, oy = 0): Path2D {
  const P = new Path2D();
  for (const sp of p.subpaths) {
    const pts = sp.points; if (!pts.length) continue;
    P.moveTo(pts[0].x + ox, pts[0].y + oy);
    const n = sp.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      P.bezierCurveTo(a.ox + ox, a.oy + oy, b.ix + ox, b.iy + oy, b.x + ox, b.y + oy);
    }
    if (sp.closed) P.closePath();
  }
  return P;
}
export function pathBounds(p: VectorPath): Rect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sp of p.subpaths) for (const q of sp.points) for (const [x, y] of [[q.x, q.y], [q.ix, q.iy], [q.ox, q.oy]]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export function mapPath(p: VectorPath, f: (x: number, y: number) => [number, number]): VectorPath {
  return { subpaths: p.subpaths.map((sp) => ({ ...sp, points: sp.points.map((q) => { const [x, y] = f(q.x, q.y), [ix, iy] = f(q.ix, q.iy), [ox, oy] = f(q.ox, q.oy); return { ...q, x, y, ix, iy, ox, oy }; }) })) };
}
export function rectPath(r: Rect, radius = 0): VectorPath {
  const { x, y, w, h } = r, k = 0.5523, rr = Math.min(radius, w / 2, h / 2);
  if (rr <= 0) return { subpaths: [{ closed: true, points: [pp(x, y), pp(x + w, y), pp(x + w, y + h), pp(x, y + h)] }] };
  const c = (px: number, py: number, ix: number, iy: number, ox: number, oy: number): PathPoint => ({ x: px, y: py, ix, iy, ox, oy, smooth: true });
  return { subpaths: [{ closed: true, points: [
    c(x + rr, y, x + rr - rr * k, y, x + rr, y), c(x + w - rr, y, x + w - rr, y, x + w - rr + rr * k, y),
    c(x + w, y + rr, x + w, y + rr - rr * k, x + w, y + rr), c(x + w, y + h - rr, x + w, y + h - rr, x + w, y + h - rr + rr * k),
    c(x + w - rr, y + h, x + w - rr + rr * k, y + h, x + w - rr, y + h), c(x + rr, y + h, x + rr, y + h, x + rr - rr * k, y + h),
    c(x, y + h - rr, x, y + h - rr + rr * k, x, y + h - rr), c(x, y + rr, x, y + rr, x, y + rr - rr * k),
  ] }] };
}
export function ellipsePath(r: Rect): VectorPath {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rx = r.w / 2, ry = r.h / 2, k = 0.5523;
  const c = (x: number, y: number, dx: number, dy: number): PathPoint => ({ x, y, ix: x - dx, iy: y - dy, ox: x + dx, oy: y + dy, smooth: true });
  return { subpaths: [{ closed: true, points: [c(cx, cy - ry, rx * k, 0), c(cx + rx, cy, 0, ry * k), c(cx, cy + ry, -rx * k, 0), c(cx - rx, cy, 0, -ry * k)] }] };
}
export function polygonPath(r: Rect, sides: number, star = 0): VectorPath {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rx = r.w / 2, ry = r.h / 2, pts: PathPoint[] = [];
  const n = star > 0 ? sides * 2 : sides;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n, k = star > 0 && i % 2 ? 1 - star / 100 : 1;
    pts.push(pp(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k));
  }
  return { subpaths: [{ closed: true, points: pts }] };
}
export function trianglePath(r: Rect): VectorPath { return { subpaths: [{ closed: true, points: [pp(r.x + r.w / 2, r.y), pp(r.x + r.w, r.y + r.h), pp(r.x, r.y + r.h)] }] }; }
export function linePath(a: Pt, b: Pt, width: number, arrowStart = false, arrowEnd = false): VectorPath {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len * width / 2, ny = dx / len * width / 2, ux = dx / len, uy = dy / len;
  const aw = width * 3, al = width * 4;
  const pts: PathPoint[] = [];
  const s = arrowStart ? { x: a.x + ux * al, y: a.y + uy * al } : a, e = arrowEnd ? { x: b.x - ux * al, y: b.y - uy * al } : b;
  if (arrowStart) { pts.push(pp(a.x, a.y), pp(s.x - ux * 0 + -uy * aw / 2 * 1, s.y + ux * aw / 2)); }
  pts.push(pp(s.x + nx, s.y + ny), pp(e.x + nx, e.y + ny));
  if (arrowEnd) pts.push(pp(e.x - uy * aw / 2, e.y + ux * aw / 2), pp(b.x, b.y), pp(e.x + uy * aw / 2, e.y - ux * aw / 2));
  pts.push(pp(e.x - nx, e.y - ny), pp(s.x - nx, s.y - ny));
  if (arrowStart) pts.push(pp(s.x + uy * aw / 2, s.y - ux * aw / 2));
  return { subpaths: [{ closed: true, points: pts }] };
}

// Original custom shapes, defined on a 100x100 grid as SVG path data.
export const CUSTOM_SHAPES: Record<string, string> = {
  Raindrop: 'M50 5 C50 5 15 50 15 68 C15 87 31 97 50 97 C69 97 85 87 85 68 C85 50 50 5 50 5 Z',
  Anchor: 'M46 10 A8 8 0 1 1 54 10 L54 22 L66 22 L66 30 L54 30 L54 82 C66 80 76 72 80 60 L72 60 L86 44 L94 60 L88 60 C84 78 68 92 50 92 C32 92 16 78 12 60 L6 60 L14 44 L28 60 L20 60 C24 72 34 80 46 82 L46 30 L34 30 L34 22 L46 22 Z',
  Heart: 'M50 88 C20 66 6 50 6 32 C6 18 17 8 30 8 C39 8 46 13 50 20 C54 13 61 8 70 8 C83 8 94 18 94 32 C94 50 80 66 50 88 Z',
  Cloud: 'M26 78 C12 78 4 68 4 57 C4 46 13 37 24 38 C26 25 37 16 50 16 C64 16 74 25 76 37 C88 37 96 46 96 57 C96 69 87 78 76 78 Z',
  Lightning: 'M58 4 L20 56 L46 56 L38 96 L80 40 L54 40 L64 4 Z',
  Check: 'M8 52 L22 38 L40 56 L78 16 L92 30 L40 84 Z',
  Cross: 'M22 8 L50 36 L78 8 L92 22 L64 50 L92 78 L78 92 L50 64 L22 92 L8 78 L36 50 L8 22 Z',
  'Arrow Right': 'M4 38 L60 38 L60 16 L96 50 L60 84 L60 62 L4 62 Z',
  'Speech Bubble': 'M10 12 L90 12 C95 12 98 15 98 20 L98 62 C98 67 95 70 90 70 L42 70 L20 90 L24 70 L10 70 C5 70 2 67 2 62 L2 20 C2 15 5 12 10 12 Z',
  Leaf: 'M10 90 C10 40 40 10 92 8 C90 60 60 90 10 90 Z M10 90 L60 40',
  Wave: 'M0 60 C15 40 35 40 50 60 C65 80 85 80 100 60 L100 100 L0 100 Z',
  Gear: 'M43 4 L57 4 L59 16 L68 20 L78 13 L87 22 L80 32 L84 41 L96 43 L96 57 L84 59 L80 68 L87 78 L78 87 L68 80 L59 84 L57 96 L43 96 L41 84 L32 80 L22 87 L13 78 L20 68 L16 59 L4 57 L4 43 L16 41 L20 32 L13 22 L22 13 L32 20 L41 16 Z M50 34 A16 16 0 1 0 50.1 34 Z',
  Crescent: 'M62 6 C38 10 20 30 20 54 C20 78 40 96 64 96 C76 96 86 92 94 84 C70 86 48 68 48 44 C48 28 54 14 62 6 Z',
  Sun: 'M50 28 A22 22 0 1 1 49.9 28 Z M47 2 L53 2 L53 18 L47 18 Z M47 82 L53 82 L53 98 L47 98 Z M2 47 L18 47 L18 53 L2 53 Z M82 47 L98 47 L98 53 L82 53 Z',
  Flag: 'M14 4 L22 4 L22 96 L14 96 Z M22 8 C40 0 56 18 86 8 L86 52 C56 62 40 44 22 52 Z',
  Badge: 'M50 2 L61 14 L77 10 L80 26 L95 33 L88 48 L95 63 L80 70 L77 86 L61 82 L50 94 L39 82 L23 86 L20 70 L5 63 L12 48 L5 33 L20 26 L23 10 L39 14 Z',
};
/** Parse simple SVG path data (M L C A Z) into a VectorPath fitted into rect r. */
export function svgToPath(d: string, r: Rect): VectorPath {
  const tok = d.match(/[MLCAZ]|-?\d*\.?\d+/gi) || [];
  const sx = r.w / 100, sy = r.h / 100, X = (v: number) => r.x + v * sx, Y = (v: number) => r.y + v * sy;
  const subs: SubPath[] = []; let cur: SubPath | null = null; let i = 0, cmd = '';
  const num = () => parseFloat(tok[i++]);
  while (i < tok.length) {
    if (/[MLCAZ]/i.test(tok[i])) cmd = tok[i++].toUpperCase();
    if (cmd === 'M') { cur = { closed: false, points: [pp(X(num()), Y(num()))] }; subs.push(cur); cmd = 'L'; }
    else if (cmd === 'L') { cur!.points.push(pp(X(num()), Y(num()))); }
    else if (cmd === 'C') { const c1x = X(num()), c1y = Y(num()), c2x = X(num()), c2y = Y(num()), x = X(num()), y = Y(num()); const last = cur!.points[cur!.points.length - 1]; last.ox = c1x; last.oy = c1y; cur!.points.push({ x, y, ix: c2x, iy: c2y, ox: x, oy: y, smooth: true }); }
    else if (cmd === 'A') {
      const rx = num() * sx, ry = num() * sy; num(); num(); num(); const x = X(num()), y = Y(num());
      // approximate arc (used for full circles) by an ellipse around the midpoint
      const last = cur!.points[0]; const cx = (last.x + x) / 2 + (Math.abs(last.x - x) < 1 ? 0 : 0), cy = last.y + ry;
      const e = ellipsePath({ x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 });
      cur!.points = e.subpaths[0].points; cur!.closed = true;
    }
    else if (cmd === 'Z') { if (cur) cur.closed = true; }
    else i++;
  }
  // close-point duplicates
  for (const s of subs) { const a = s.points[0], b = s.points[s.points.length - 1]; if (s.closed && s.points.length > 1 && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01) { a.ix = b.ix; a.iy = b.iy; s.points.pop(); } }
  return { subpaths: subs };
}

export function drawShape(x: CanvasRenderingContext2D, s: ShapeData, ox = 0, oy = 0, fillStyle?: string | CanvasGradient | CanvasPattern) {
  const P = pathToPath2D(s.path, ox, oy);
  if (s.fill.type !== 'none') { x.fillStyle = fillStyle || s.fill.color; x.fill(P, 'nonzero'); }
  if (s.stroke.enabled && s.stroke.width > 0) {
    x.save();
    x.strokeStyle = s.stroke.color; x.lineCap = s.stroke.cap; x.lineJoin = s.stroke.join; x.setLineDash(s.stroke.dash.map((d) => d * s.stroke.width));
    if (s.stroke.align === 'center') { x.lineWidth = s.stroke.width; x.stroke(P); }
    else if (s.stroke.align === 'inside') { x.clip(P); x.lineWidth = s.stroke.width * 2; x.stroke(P); }
    else {
      x.lineWidth = s.stroke.width * 2;
      const c = document.createElement('canvas'); c.width = x.canvas.width; c.height = x.canvas.height; const cx = c.getContext('2d')!;
      cx.strokeStyle = s.stroke.color; cx.lineWidth = s.stroke.width * 2; cx.lineJoin = s.stroke.join; cx.setLineDash(s.stroke.dash.map((d) => d * s.stroke.width)); cx.stroke(P);
      cx.globalCompositeOperation = 'destination-out'; cx.fill(P);
      x.drawImage(c, 0, 0);
    }
    x.restore();
  }
}

// ---- text ----
export function fontString(t: TextData, size = t.size) {
  return `${t.italic || t.faux.italic ? 'italic ' : ''}${t.faux.bold ? 700 : t.weight} ${size}px ${t.font}`;
}
export function layoutText(x: CanvasRenderingContext2D, t: TextData): { lines: string[]; widths: number[]; lineH: number } {
  x.font = fontString(t);
  try { (x as any).letterSpacing = `${(t.tracking / 1000) * t.size}px`; } catch { /* unsupported */ }
  const lineH = t.leading > 0 ? t.leading : t.size * 1.2;
  let text = t.text;
  if (t.caps === 'all') text = text.toUpperCase();
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    if (t.boxWidth > 0 && !t.vertical) {
      const words = para.split(/(\s+)/); let line = '';
      for (const wd of words) { const test = line + wd; if (x.measureText(test).width * t.scaleX / 100 > t.boxWidth && line.trim()) { lines.push(line.trimEnd()); line = wd.trimStart(); } else line = test; }
      lines.push(line);
    } else lines.push(para);
  }
  return { lines, widths: lines.map((l) => x.measureText(l).width), lineH };
}
// ---- rich text (character styles and type on a path) ----
export const isRich = (t: TextData) => !!(t.runs && t.runs.length) || !!t.path;
interface Glyph { ch: string; x: number; y: number; w: number; font: string; color: string; size: number; underline: boolean; strike: boolean; rot?: number }
function styleAt(t: TextData, i: number) {
  let s = { color: t.color, size: t.size, weight: t.faux.bold ? 700 : t.weight, italic: t.italic || t.faux.italic, underline: t.underline, strike: t.strike, font: t.font, baseline: t.baseline, tracking: t.tracking };
  for (const r of t.runs || []) if (i >= r.start && i < r.end) s = { ...s, ...Object.fromEntries(Object.entries(r).filter(([k, v]) => v !== undefined && k !== 'start' && k !== 'end')) } as any;
  return s;
}
const measureCtx = () => document.createElement('canvas').getContext('2d')!;
/** Positions every character in layer space (before the layer matrix). */
export function layoutRich(t: TextData): { glyphs: Glyph[]; bounds: Rect } {
  const x = measureCtx(); const text = t.caps === 'all' ? t.text.toUpperCase() : t.text; const sx = t.scaleX / 100;
  const chars = [...text].map((ch, i) => { const s = styleAt(t, i); const font = `${s.italic ? 'italic ' : ''}${s.weight} ${s.size}px ${s.font}`; x.font = font; return { ch, s, font, w: (x.measureText(ch).width + (s.tracking / 1000) * s.size) * sx }; });
  const glyphs: Glyph[] = [];
  if (t.path) {
    // flatten the path into a polyline with cumulative lengths
    const pts: Pt[] = [];
    for (const sp of t.path.subpaths) { const n = sp.points.length, m = sp.closed ? n : n - 1; for (let k = 0; k < m; k++) { const a = sp.points[k], b = sp.points[(k + 1) % n]; for (let j = 0; j <= 24; j++) { const u = j / 24, v = 1 - u; pts.push({ x: v * v * v * a.x + 3 * v * v * u * a.ox + 3 * v * u * u * b.ix + u * u * u * b.x, y: v * v * v * a.y + 3 * v * v * u * a.oy + 3 * v * u * u * b.iy + u * u * u * b.y }); } } break; }
    const L = [0]; for (let k = 1; k < pts.length; k++) L.push(L[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
    const total = L[L.length - 1] || 1, width = chars.reduce((a, c) => a + c.w, 0);
    let s0 = (t.pathOffset || 0) / 100 * total; if (t.align === 'center') s0 += (total - width) / 2; else if (t.align === 'right') s0 += total - width;
    const at = (s: number) => { let k = 1; while (k < L.length - 1 && L[k] < s) k++; const a = pts[k - 1], b = pts[k], f = (s - L[k - 1]) / Math.max(1e-6, L[k] - L[k - 1]); return { p: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, ang: Math.atan2(b.y - a.y, b.x - a.x) }; };
    let cur = s0;
    for (const c of chars) { const mid = cur + c.w / 2; cur += c.w; if (mid < 0 || mid > total || c.ch === '\n') continue; const { p, ang } = at(mid); const off = -c.s.baseline; glyphs.push({ ch: c.ch, x: p.x - Math.sin(ang) * off, y: p.y + Math.cos(ang) * off, w: c.w, font: c.font, color: c.s.color, size: c.s.size, underline: c.s.underline, strike: c.s.strike, rot: ang }); }
  } else {
    // break into lines (paragraph breaks and box wrapping)
    const lines: (typeof chars)[] = []; let line: typeof chars = [], lw = 0, lastSpace = -1;
    for (const c of chars) {
      if (c.ch === '\n') { lines.push(line); line = []; lw = 0; lastSpace = -1; continue; }
      line.push(c); lw += c.w; if (c.ch === ' ') lastSpace = line.length - 1;
      if (t.boxWidth > 0 && lw > t.boxWidth && lastSpace > 0) { const rest = line.splice(lastSpace + 1); line.pop(); lines.push(line); line = rest; lw = rest.reduce((a, r) => a + r.w, 0); lastSpace = -1; }
    }
    lines.push(line);
    let y = t.y;
    lines.forEach((ln, li) => {
      const maxSize = Math.max(t.size, ...ln.map((c) => c.s.size)), lh = t.leading > 0 ? t.leading : maxSize * 1.2;
      if (li > 0 || t.boxWidth > 0) y += li === 0 ? maxSize : lh;
      const w = ln.reduce((a, c) => a + c.w, 0);
      let cx = t.x + (t.indent || 0);
      if (t.boxWidth > 0) { if (t.align === 'center') cx = t.x + (t.boxWidth - w) / 2; else if (t.align === 'right') cx = t.x + t.boxWidth - w; }
      else { if (t.align === 'center') cx = t.x - w / 2; else if (t.align === 'right') cx = t.x - w; }
      for (const c of ln) { glyphs.push({ ch: c.ch, x: cx, y: y - c.s.baseline, w: c.w, font: c.font, color: c.s.color, size: c.s.size, underline: c.s.underline, strike: c.s.strike }); cx += c.w; }
    });
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const g of glyphs) { const r = g.rot ? g.size : 0; x0 = Math.min(x0, g.x - r); x1 = Math.max(x1, g.x + g.w + r); y0 = Math.min(y0, g.y - g.size - r); y1 = Math.max(y1, g.y + g.size * 0.3 + r); }
  if (!glyphs.length) { x0 = t.x; y0 = t.y - t.size; x1 = t.x + 10; y1 = t.y; }
  return { glyphs, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}
function drawRich(x: CanvasRenderingContext2D, t: TextData) {
  const { glyphs } = layoutRich(t); const sy = t.scaleY / 100, sx = t.scaleX / 100;
  x.textBaseline = 'alphabetic';
  for (const g of glyphs) {
    x.font = g.font; x.fillStyle = g.color; x.save(); x.translate(g.x, g.y);
    if (g.rot !== undefined) { x.rotate(g.rot); x.scale(sx, sy); x.textAlign = 'center'; x.fillText(g.ch, 0, 0); }
    else { x.scale(sx, sy); x.textAlign = 'left'; x.fillText(g.ch, 0, 0); const w = g.w / sx; if (g.underline) x.fillRect(0, g.size * 0.12, w, Math.max(1, g.size / 16)); if (g.strike) x.fillRect(0, -g.size * 0.3, w, Math.max(1, g.size / 16)); }
    x.restore();
  }
}
/** Keep character styles attached to the right letters after the text is edited. */
export function shiftRuns(runs: TextData['runs'], before: string, after: string): TextData['runs'] {
  if (!runs || !runs.length || before === after) return runs;
  let p = 0; while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let s = 0; while (s < before.length - p && s < after.length - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  const oldEnd = before.length - s, delta = after.length - before.length;
  const map = (i: number) => (i <= p ? i : i >= oldEnd ? i + delta : p + Math.max(0, Math.min(after.length - s - p, i - p)));
  return runs.map((r) => ({ ...r, start: map(r.start), end: r.end > p && r.end <= oldEnd && delta > 0 ? r.end + delta : map(r.end) })).filter((r) => r.end > r.start);
}
/** Apply a style to a character range, splitting existing runs so later styles win. */
export function styleRange(t: TextData, start: number, end: number, style: Partial<TextData['runs'] extends (infer R)[] | undefined ? R : never>) {
  const runs = (t.runs || []).flatMap((r) => { if (r.end <= start || r.start >= end) return [r]; const out = []; if (r.start < start) out.push({ ...r, end: start }); out.push({ ...r, start: Math.max(r.start, start), end: Math.min(r.end, end), ...style }); if (r.end > end) out.push({ ...r, start: end }); return out; });
  // parts of the range not covered by a run get a new run
  const covered = runs.filter((r) => r.start < end && r.end > start).sort((a, b) => a.start - b.start); let c = start; const add = [];
  for (const r of covered) { if (r.start > c) add.push({ start: c, end: r.start, ...style }); c = Math.max(c, r.end); }
  if (c < end) add.push({ start: c, end, ...style });
  t.runs = [...runs, ...add].sort((a, b) => a.start - b.start);
}
/** Draw a text layer into a context in document space. */
export function drawText(x: CanvasRenderingContext2D, t: TextData) {
  x.save();
  if (isRich(t)) { x.setTransform(x.getTransform().multiply(new DOMMatrix([...t.matrix]))); if (!t.antialias) x.imageSmoothingEnabled = false; drawRich(x, t); x.restore(); return; }
  const m = x.getTransform().multiply(new DOMMatrix([...t.matrix]));
  x.setTransform(m);
  const { lines, widths, lineH } = layoutText(x, t);
  x.fillStyle = t.color; x.textBaseline = 'alphabetic';
  if (!t.antialias) x.imageSmoothingEnabled = false;
  const sx = t.scaleX / 100, sy = t.scaleY / 100;
  if (t.vertical) {
    x.textAlign = 'center';
    lines.forEach((line, li) => { [...line].forEach((ch, ci) => x.fillText(ch, t.x - li * lineH, t.y + ci * t.size * 1.05 - t.baseline)); });
    x.restore(); return;
  }
  const warp = t.warp.style !== 'none' && t.warp.bend !== 0;
  lines.forEach((line, li) => {
    const w = widths[li] * sx;
    let lx = t.x + (t.indent || 0);
    if (t.boxWidth > 0) { if (t.align === 'center') lx = t.x + (t.boxWidth - w) / 2; else if (t.align === 'right') lx = t.x + t.boxWidth - w; }
    else { if (t.align === 'center') lx = t.x - w / 2; else if (t.align === 'right') lx = t.x - w; }
    const ly = t.y + li * lineH + (t.boxWidth > 0 ? t.size : 0) - t.baseline;
    if (!warp) {
      x.save(); x.translate(lx, ly); x.scale(sx, sy);
      if (t.align === 'justify' && t.boxWidth > 0 && li < lines.length - 1) {
        const words = line.split(' '), total = words.reduce((a, wd) => a + x.measureText(wd).width, 0), gap = (t.boxWidth / sx - total) / Math.max(1, words.length - 1);
        let cx = 0; for (const wd of words) { x.fillText(wd, cx, 0); cx += x.measureText(wd).width + gap; }
      } else x.fillText(line, 0, 0);
      if (t.underline) x.fillRect(0, t.size * 0.12, widths[li], Math.max(1, t.size / 16));
      if (t.strike) x.fillRect(0, -t.size * 0.3, widths[li], Math.max(1, t.size / 16));
      x.restore();
    } else {
      // per-character warp
      const bend = t.warp.bend / 100; let cx = 0;
      for (const ch of line) {
        const cw = x.measureText(ch).width * sx, u = (cx + cw / 2) / Math.max(1, w) * 2 - 1;
        let dy = 0, rot = 0, scl = 1;
        switch (t.warp.style) {
          case 'arc': dy = -bend * (1 - u * u) * t.size * 1.5; rot = bend * u * 0.6; break;
          case 'arch': dy = -bend * (1 - u * u) * t.size * 1.5; break;
          case 'bulge': scl = 1 + bend * (1 - u * u) * 0.6; break;
          case 'flag': dy = Math.sin(u * Math.PI) * bend * t.size * 0.5; break;
          case 'wave': dy = Math.sin(u * Math.PI * 2) * bend * t.size * 0.4; break;
          case 'rise': dy = -u * bend * t.size; rot = -bend * 0.2; break;
        }
        x.save(); x.translate(lx + cx + cw / 2, ly + dy); x.rotate(rot); x.scale(sx * scl, sy * scl); x.textAlign = 'center'; x.fillText(ch, 0, 0); x.restore();
        cx += cw;
      }
    }
  });
  x.restore();
}
export function textBounds(t: TextData): Rect {
  if (isRich(t)) { const b = layoutRich(t).bounds; const m = new DOMMatrix([...t.matrix]); const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map(([a, c]) => m.transformPoint(new DOMPoint(a, c))); const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
  const c = document.createElement('canvas').getContext('2d')!;
  const { lines, widths, lineH } = layoutText(c, t);
  const w = t.boxWidth > 0 ? t.boxWidth : Math.max(1, ...widths) * t.scaleX / 100;
  const h = lines.length * lineH;
  let x = t.x; if (!t.boxWidth) { if (t.align === 'center') x -= w / 2; else if (t.align === 'right') x -= w; }
  const y = t.boxWidth ? t.y : t.y - t.size;
  if (t.vertical) return { x: t.x - lines.length * lineH, y: t.y - t.size, w: lines.length * lineH + t.size, h: Math.max(...lines.map((l) => l.length)) * t.size * 1.05 };
  const m = new DOMMatrix([...t.matrix]);
  const pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([a, b]) => m.transformPoint(new DOMPoint(a, b)));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
export const defaultText = (x: number, y: number, o: Partial<TextData> = {}): TextData => ({
  text: 'Text', x, y, font: 'Inter, Helvetica, Arial, sans-serif', size: 48, weight: 400, italic: false, color: '#000000', align: 'left', leading: 0, tracking: 0,
  underline: false, strike: false, caps: 'none', vertical: false, boxWidth: 0, matrix: [1, 0, 0, 1, 0, 0], warp: { style: 'none', bend: 50 }, antialias: true,
  faux: { bold: false, italic: false }, baseline: 0, scaleX: 100, scaleY: 100, indent: 0, spaceBefore: 0, spaceAfter: 0, ...o,
});
