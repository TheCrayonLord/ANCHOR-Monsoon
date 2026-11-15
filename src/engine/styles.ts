// Layer effects (drop shadow, glows, stroke, overlays, bevel, satin).
import type { LayerStyles, BlendMode, Gradient } from './types';
import { Canvas, ctx2d, makeCanvas, hexToRgb, clamp } from './util';
import { gaussFloat } from './filters';
import { edt } from './selection';
import { drawBlended } from './blend';
import { renderGradient, fillPattern } from './paint';

export const defaultStyles = (): Required<LayerStyles> => ({
  dropShadow: { enabled: false, color: '#000000', opacity: 0.6, angle: 120, distance: 8, size: 10, spread: 0, blend: 'multiply' },
  innerShadow: { enabled: false, color: '#000000', opacity: 0.6, angle: 120, distance: 5, size: 6, spread: 0, blend: 'multiply' },
  outerGlow: { enabled: false, color: '#ffe9a8', opacity: 0.75, size: 14, spread: 0, blend: 'screen' },
  innerGlow: { enabled: false, color: '#ffe9a8', opacity: 0.75, size: 10, spread: 0, blend: 'screen' },
  stroke: { enabled: false, color: '#000000', size: 3, position: 'outside', opacity: 1, blend: 'normal' },
  colorOverlay: { enabled: false, color: '#6c7cff', opacity: 1, blend: 'normal' },
  gradientOverlay: { enabled: false, gradient: { stops: [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }], opacity: [{ pos: 0, a: 1 }, { pos: 1, a: 1 }] }, shape: 'linear', angle: 90, scale: 100, reverse: false, opacity: 1, blend: 'normal' },
  patternOverlay: { enabled: false, pattern: 'Dots', scale: 1, opacity: 1, blend: 'normal' },
  bevel: { enabled: false, style: 'inner', depth: 100, size: 8, soften: 0, angle: 120, altitude: 30, up: true, highlight: '#ffffff', hOpacity: 0.75, shadow: '#000000', sOpacity: 0.75 },
  satin: { enabled: false, color: '#000000', opacity: 0.5, angle: 19, distance: 11, size: 14, invert: true, blend: 'multiply' },
});
export const STYLE_NAMES: Record<keyof LayerStyles, string> = {
  bevel: 'Bevel & Emboss', stroke: 'Stroke', innerShadow: 'Inner Shadow', innerGlow: 'Inner Glow', satin: 'Satin',
  colorOverlay: 'Color Overlay', gradientOverlay: 'Gradient Overlay', patternOverlay: 'Pattern Overlay', outerGlow: 'Outer Glow', dropShadow: 'Drop Shadow',
};
export function hasStyles(s?: LayerStyles) { return !!s && Object.values(s).some((v: any) => v?.enabled); }

function extent(s: LayerStyles) {
  let e = 0;
  if (s.dropShadow?.enabled) e = Math.max(e, s.dropShadow.distance + s.dropShadow.size * 2);
  if (s.outerGlow?.enabled) e = Math.max(e, s.outerGlow.size * 2);
  if (s.stroke?.enabled) e = Math.max(e, s.stroke.size + 2);
  if (s.bevel?.enabled && s.bevel.style !== 'inner') e = Math.max(e, s.bevel.size + 2);
  return Math.ceil(e) + 2;
}
function colorLayer(alpha: Float32Array, w: number, h: number, color: string, opacity: number): Canvas {
  const c = makeCanvas(w, h), d = new ImageData(w, h), p = d.data, rgb = hexToRgb(color);
  for (let i = 0; i < alpha.length; i++) { p[i * 4] = rgb.r; p[i * 4 + 1] = rgb.g; p[i * 4 + 2] = rgb.b; p[i * 4 + 3] = clamp(alpha[i] * opacity * 255); }
  ctx2d(c).putImageData(d, 0, 0); return c;
}
function shift(a: Float32Array, w: number, h: number, dx: number, dy: number, fill = 0) {
  const out = new Float32Array(a.length).fill(fill), ix = Math.round(dx), iy = Math.round(dy);
  for (let y = 0; y < h; y++) { const sy = y - iy; if (sy < 0 || sy >= h) continue; for (let x = 0; x < w; x++) { const sx = x - ix; if (sx >= 0 && sx < w) out[y * w + x] = a[sy * w + sx]; } }
  return out;
}
function spreadBlur(a: Float32Array, w: number, h: number, size: number, spread: number) {
  let src = a;
  if (spread > 0) {
    const r = (size * spread) / 100, ins = new Uint8Array(w * h); for (let i = 0; i < ins.length; i++) ins[i] = a[i] > 0.5 ? 1 : 0;
    const d = edt(ins, w, h); src = new Float32Array(a.length); for (let i = 0; i < d.length; i++) src[i] = clamp(r + 1 - d[i], 0, 1);
  }
  const blur = (size * (1 - spread / 100)) / 2;
  return blur > 0.3 ? gaussFloat(src, w, h, blur, 1) : src;
}

/** Render content with effects. Returns a new canvas and its offset relative to the content canvas. */
export function applyStyles(content: Canvas, s: LayerStyles, fillOpacity: number): { canvas: Canvas; dx: number; dy: number } {
  const pad = extent(s), w = content.width + pad * 2, h = content.height + pad * 2;
  const out = makeCanvas(w, h), ox = ctx2d(out);
  const src = makeCanvas(w, h); ctx2d(src).drawImage(content, pad, pad);
  const sd = ctx2d(src).getImageData(0, 0, w, h).data;
  const A = new Float32Array(w * h); for (let i = 0; i < A.length; i++) A[i] = sd[i * 4 + 3] / 255;
  const inv = () => { const r = new Float32Array(A.length); for (let i = 0; i < A.length; i++) r[i] = 1 - A[i]; return r; };
  const mulA = (x: Float32Array) => { for (let i = 0; i < x.length; i++) x[i] *= A[i]; return x; };
  const put = (c: Canvas, mode: BlendMode) => drawBlended(out, c, 0, 0, mode, 1);

  // below content
  if (s.dropShadow?.enabled) {
    const d = s.dropShadow, a = (d.angle * Math.PI) / 180;
    const sh = shift(spreadBlur(A, w, h, d.size, d.spread), w, h, -Math.cos(a) * d.distance, Math.sin(a) * d.distance);
    put(colorLayer(sh, w, h, d.color, d.opacity), 'normal');
  }
  if (s.outerGlow?.enabled) { const g = s.outerGlow; put(colorLayer(spreadBlur(A, w, h, g.size, g.spread), w, h, g.color, g.opacity), 'normal'); }
  if (s.bevel?.enabled && (s.bevel.style === 'outer' || s.bevel.style === 'emboss' || s.bevel.style === 'pillow')) void 0;
  // content
  const body = makeCanvas(w, h), bx = ctx2d(body);
  bx.globalAlpha = fillOpacity; bx.drawImage(src, 0, 0); bx.globalAlpha = 1;
  const overlayOn = (c: Canvas, mode: BlendMode, opacity: number) => {
    const t = makeCanvas(w, h), tx = ctx2d(t); tx.drawImage(c, 0, 0); tx.globalCompositeOperation = 'destination-in'; tx.drawImage(src, 0, 0);
    drawBlended(body, t, 0, 0, mode, opacity * fillOpacity);
  };
  if (s.innerShadow?.enabled) {
    const d = s.innerShadow, a = (d.angle * Math.PI) / 180;
    const sh = mulA(shift(spreadBlur(inv(), w, h, d.size, d.spread), w, h, -Math.cos(a) * d.distance, Math.sin(a) * d.distance, 1));
    drawBlended(body, colorLayer(sh, w, h, d.color, d.opacity), 0, 0, d.blend, fillOpacity);
  }
  if (s.innerGlow?.enabled) { const g = s.innerGlow; drawBlended(body, colorLayer(mulA(spreadBlur(inv(), w, h, g.size, g.spread)), w, h, g.color, g.opacity), 0, 0, g.blend, fillOpacity); }
  if (s.satin?.enabled) {
    const st = s.satin, a = (st.angle * Math.PI) / 180, dx = Math.cos(a) * st.distance, dy = Math.sin(a) * st.distance;
    const b = gaussFloat(A, w, h, st.size / 2, 1), s1 = shift(b, w, h, dx, dy), s2 = shift(b, w, h, -dx, -dy), r = new Float32Array(A.length);
    for (let i = 0; i < r.length; i++) { const v = Math.abs(s1[i] - s2[i]); r[i] = (st.invert ? 1 - v : v) * A[i]; }
    drawBlended(body, colorLayer(r, w, h, st.color, st.opacity), 0, 0, st.blend, fillOpacity);
  }
  if (s.colorOverlay?.enabled) { const o = s.colorOverlay; const c = makeCanvas(w, h), x = ctx2d(c); x.fillStyle = o.color; x.fillRect(0, 0, w, h); overlayOn(c, o.blend, o.opacity); }
  if (s.gradientOverlay?.enabled) {
    const g = s.gradientOverlay, a = (g.angle * Math.PI) / 180, len = (Math.max(content.width, content.height) / 2) * (g.scale / 100);
    const cx = w / 2, cy = h / 2, p0 = { x: cx - Math.cos(a) * len, y: cy + Math.sin(a) * len }, p1 = { x: cx + Math.cos(a) * len, y: cy - Math.sin(a) * len };
    const c = makeCanvas(w, h); ctx2d(c).putImageData(renderGradient(w, h, g.gradient as Gradient, g.shape, g.shape === 'linear' || g.shape === 'reflected' ? p0 : { x: cx, y: cy }, p1, g.reverse), 0, 0);
    overlayOn(c, g.blend, g.opacity);
  }
  if (s.patternOverlay?.enabled) { const o = s.patternOverlay; const c = makeCanvas(w, h); fillPattern(ctx2d(c), o.pattern, w, h, o.scale); overlayOn(c, o.blend, o.opacity); }
  if (s.bevel?.enabled) {
    const b = s.bevel, rad = (b.angle * Math.PI) / 180, alt = (b.altitude * Math.PI) / 180;
    const lx = -Math.cos(rad) * Math.cos(alt), ly = Math.sin(rad) * Math.cos(alt), lz = Math.sin(alt);
    // height map from distance inside the shape
    const ins = new Uint8Array(w * h); for (let i = 0; i < ins.length; i++) ins[i] = A[i] < 0.5 ? 1 : 0;
    const dist = edt(ins, w, h);
    let H: Float32Array = new Float32Array(w * h);
    for (let i = 0; i < H.length; i++) {
      const t = clamp(dist[i] / Math.max(1, b.size), 0, 1);
      H[i] = b.style === 'pillow' ? Math.sin(t * Math.PI) : t;
    }
    if (b.style === 'outer' || b.style === 'emboss') { const out2 = new Uint8Array(w * h); for (let i = 0; i < out2.length; i++) out2[i] = A[i] >= 0.5 ? 1 : 0; const d2 = edt(out2, w, h); for (let i = 0; i < H.length; i++) if (A[i] < 0.5) H[i] = -clamp(1 - d2[i] / Math.max(1, b.size), 0, 1) + (b.style === 'emboss' ? 0 : 0); }
    H = gaussFloat(H, w, h, 1 + b.soften / 2, 1);
    const hi = new Float32Array(w * h), lo = new Float32Array(w * h), k = (b.depth / 100) * (b.up ? 1 : -1) * b.size * 0.6;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, nx = (H[i - 1] - H[i + 1]) * k, ny = (H[i - w] - H[i + w]) * k, l = Math.hypot(nx, ny, 1);
      const dot = (nx * lx + ny * ly + lz) / l - lz;
      const region = b.style === 'inner' ? A[i] : b.style === 'outer' ? (1 - A[i]) * (H[i] < 0 ? 1 : 0) : 1;
      if (dot > 0) hi[i] = clamp(dot * 2.2, 0, 1) * region; else lo[i] = clamp(-dot * 2.2, 0, 1) * region;
    }
    const target = b.style === 'inner' ? body : out;
    if (b.style !== 'inner') { ox.globalAlpha = 1; ox.drawImage(body, 0, 0); bx.clearRect(0, 0, w, h); }
    drawBlended(target, colorLayer(hi, w, h, b.highlight, b.hOpacity), 0, 0, 'screen', 1);
    drawBlended(target, colorLayer(lo, w, h, b.shadow, b.sOpacity), 0, 0, 'multiply', 1);
  }
  ox.drawImage(body, 0, 0);
  if (s.stroke?.enabled) {
    const st = s.stroke, r = new Float32Array(A.length);
    const inside = new Uint8Array(w * h), outside = new Uint8Array(w * h);
    for (let i = 0; i < A.length; i++) { inside[i] = A[i] >= 0.5 ? 1 : 0; outside[i] = 1 - inside[i]; }
    const dOut = edt(inside, w, h), dIn = edt(outside, w, h);
    for (let i = 0; i < r.length; i++) {
      if (st.position === 'outside') r[i] = A[i] >= 0.5 ? 0 : clamp(st.size + 0.5 - dOut[i], 0, 1) * (1 - A[i]) + (A[i] > 0 && A[i] < 0.5 ? 1 - A[i] : 0) * 0;
      else if (st.position === 'inside') r[i] = A[i] < 0.5 ? 0 : clamp(st.size + 0.5 - dIn[i], 0, 1) * A[i];
      else r[i] = A[i] >= 0.5 ? clamp(st.size / 2 + 0.5 - dIn[i], 0, 1) : clamp(st.size / 2 + 0.5 - dOut[i], 0, 1);
    }
    drawBlended(out, colorLayer(r, w, h, st.color, st.opacity), 0, 0, st.blend, 1);
  }
  return { canvas: out, dx: -pad, dy: -pad };
}
