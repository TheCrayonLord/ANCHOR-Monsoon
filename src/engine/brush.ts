// Brush engine: dab-based painting with a stroke buffer (so opacity caps accumulation like a real stroke).
import { Canvas, ctx2d, makeCanvas, Rect, rectUnion, rectIntersect, rectRound, cloneCanvas, hexToRgb, rgbToHsl, hslToRgb, clamp, lum, Pt } from './util';
import { drawBlended } from './blend';
import type { BlendMode } from './types';
import { getPattern } from './paint';

export type TipShape = 'round' | 'square' | 'spatter' | 'chalk' | 'grass' | 'rain' | 'star' | 'custom';
export interface BrushSettings {
  size: number; hardness: number; spacing: number; angle: number; roundness: number;
  opacity: number; flow: number; smoothing: number; blend: BlendMode;
  shape: TipShape; customTip?: string;
  sizeJitter: number; angleJitter: number; roundJitter: number; scatter: number; count: number;
  hueJitter: number; fgbgJitter: number; brightJitter: number;
  pressureSize: boolean; pressureOpacity: boolean; airbrush: boolean;
  wetEdges: boolean; noise: boolean; flipX: boolean;
}
export const defaultBrush = (): BrushSettings => ({
  size: 30, hardness: 0.8, spacing: 0.25, angle: 0, roundness: 1, opacity: 1, flow: 1, smoothing: 0.1, blend: 'normal', shape: 'round',
  sizeJitter: 0, angleJitter: 0, roundJitter: 0, scatter: 0, count: 1, hueJitter: 0, fgbgJitter: 0, brightJitter: 0,
  pressureSize: true, pressureOpacity: false, airbrush: false, wetEdges: false, noise: false, flipX: false,
});
export interface BrushPreset { name: string; s: Partial<BrushSettings> }
export const BRUSH_PRESETS: BrushPreset[] = [
  { name: 'Soft Round', s: { shape: 'round', hardness: 0, spacing: 0.1 } },
  { name: 'Hard Round', s: { shape: 'round', hardness: 1, spacing: 0.1 } },
  { name: 'Soft Airbrush', s: { shape: 'round', hardness: 0, flow: 0.1, airbrush: true, spacing: 0.08 } },
  { name: 'Inking Pen', s: { shape: 'round', hardness: 1, pressureSize: true, spacing: 0.05, smoothing: 0.5 } },
  { name: 'Square', s: { shape: 'square', hardness: 1, spacing: 0.15 } },
  { name: 'Spatter', s: { shape: 'spatter', hardness: 0.8, scatter: 1.2, sizeJitter: 0.5, angleJitter: 1, spacing: 0.4 } },
  { name: 'Chalk', s: { shape: 'chalk', hardness: 0.6, spacing: 0.2, angleJitter: 0.3, roundness: 0.9 } },
  { name: 'Grass', s: { shape: 'grass', spacing: 0.35, sizeJitter: 0.6, angleJitter: 0.15, scatter: 0.8, hueJitter: 0.08, fgbgJitter: 0.5 } },
  { name: 'Rain Streaks', s: { shape: 'rain', spacing: 0.5, scatter: 2, sizeJitter: 0.5, count: 2 } },
  { name: 'Star Scatter', s: { shape: 'star', spacing: 0.9, scatter: 2.5, sizeJitter: 0.7, angleJitter: 1, hueJitter: 0.3 } },
  { name: 'Calligraphy', s: { shape: 'round', hardness: 1, roundness: 0.25, angle: 45, spacing: 0.05 } },
  { name: 'Watercolor', s: { shape: 'round', hardness: 0.2, wetEdges: true, flow: 0.4, spacing: 0.1, opacity: 0.8 } },
];

const customTips = new Map<string, Canvas>();
export function defineBrushTip(name: string, gray: Canvas) { customTips.set(name, gray); BRUSH_PRESETS.push({ name, s: { shape: 'custom', customTip: name, spacing: 0.25 } }); }
export function customTipNames() { return [...customTips.keys()]; }

const tipCache = new Map<string, Canvas>();
/** Alpha tip (white with alpha) at a given diameter. */
export function makeTip(b: BrushSettings, size: number, angle: number, round: number, aa = true): Canvas {
  const key = [b.shape, b.customTip, Math.round(size * 2) / 2, b.hardness, Math.round(angle), round.toFixed(2), aa].join('|');
  const hit = tipCache.get(key); if (hit) return hit;
  const s = Math.max(1, Math.ceil(size) + 2), c = makeCanvas(s, s), x = ctx2d(c), r = size / 2;
  x.translate(s / 2, s / 2); x.rotate((angle * Math.PI) / 180); x.scale(1, Math.max(0.05, round));
  if (b.shape === 'round') {
    if (!aa) { x.fillStyle = '#fff'; x.beginPath(); x.arc(0, 0, Math.max(0.5, r), 0, 7); x.fill(); }
    else {
      const g = x.createRadialGradient(0, 0, 0, 0, 0, Math.max(0.5, r));
      const hd = clamp(b.hardness, 0, 1);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      if (hd > 0) g.addColorStop(Math.min(0.99, hd), 'rgba(255,255,255,1)');
      if (hd < 1) { for (let k = 1; k <= 4; k++) { const t = hd + (1 - hd) * (k / 5); g.addColorStop(t, `rgba(255,255,255,${(1 - (k / 5)) ** 2})`); } }
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.beginPath(); x.arc(0, 0, Math.max(0.5, r), 0, 7); x.fill();
    }
  } else if (b.shape === 'square') { x.fillStyle = '#fff'; x.fillRect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6); }
  else if (b.shape === 'spatter') { x.fillStyle = '#fff'; for (let i = 0; i < 18; i++) { const a = Math.random() * 7, d = Math.random() * r * 0.9, rr = Math.random() * r * 0.18 + 0.5; x.globalAlpha = 0.5 + Math.random() * 0.5; x.beginPath(); x.arc(Math.cos(a) * d, Math.sin(a) * d, rr, 0, 7); x.fill(); } }
  else if (b.shape === 'chalk') { x.fillStyle = '#fff'; for (let i = 0; i < size * 3; i++) { const a = Math.random() * 7, d = Math.sqrt(Math.random()) * r; x.globalAlpha = Math.random() * 0.8; x.fillRect(Math.cos(a) * d, Math.sin(a) * d, 1.2, 1.2); } }
  else if (b.shape === 'grass') { x.strokeStyle = '#fff'; x.lineWidth = Math.max(1, r * 0.12); x.lineCap = 'round'; for (let i = 0; i < 4; i++) { x.beginPath(); const bx = (Math.random() - 0.5) * r * 0.6; x.moveTo(bx, r); x.quadraticCurveTo(bx + (Math.random() - 0.5) * r * 0.6, 0, bx + (Math.random() - 0.5) * r, -r); x.stroke(); } }
  else if (b.shape === 'rain') { x.strokeStyle = '#fff'; x.lineCap = 'round'; x.lineWidth = Math.max(1, r * 0.1); x.beginPath(); x.moveTo(r * 0.2, -r); x.lineTo(-r * 0.2, r); x.stroke(); }
  else if (b.shape === 'star') { x.fillStyle = '#fff'; x.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, k = i % 2 ? 0.42 : 1; x.lineTo(Math.cos(a) * r * k, Math.sin(a) * r * k); } x.closePath(); x.fill(); }
  else if (b.shape === 'custom' && b.customTip && customTips.has(b.customTip)) {
    const g = customTips.get(b.customTip)!; const sc = size / Math.max(g.width, g.height);
    // gray: black = paint. convert to alpha
    const t = makeCanvas(g.width, g.height), tx = ctx2d(t), d = ctx2d(g).getImageData(0, 0, g.width, g.height);
    for (let i = 0; i < d.data.length; i += 4) { const v = 255 - lum(d.data[i], d.data[i + 1], d.data[i + 2]); d.data[i + 3] = Math.min(d.data[i + 3], v); d.data[i] = d.data[i + 1] = d.data[i + 2] = 255; }
    tx.putImageData(d, 0, 0); x.drawImage(t, (-g.width * sc) / 2, (-g.height * sc) / 2, g.width * sc, g.height * sc);
  }
  if (tipCache.size > 120) tipCache.delete(tipCache.keys().next().value!);
  if (b.shape === 'round' || b.shape === 'square' || b.shape === 'star' || b.shape === 'custom') tipCache.set(key, c);
  return c;
}
function colorize(tip: Canvas, color: string): Canvas {
  const c = makeCanvas(tip.width, tip.height), x = ctx2d(c);
  x.drawImage(tip, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  return c;
}

export type StrokeMode = 'paint' | 'erase' | 'clone' | 'pattern' | 'history' | 'heal' | 'spot' | 'blur' | 'sharpen' | 'smudge' | 'dodge' | 'burn' | 'sponge' | 'replace' | 'mixer' | 'bgerase' | 'arthistory';
export interface StrokeOpts {
  mode: StrokeMode; brush: BrushSettings; color: string; bg: string;
  target: Canvas; ox: number; oy: number; // target canvas and its position in document space
  selection?: Canvas | null; // doc-sized gray mask
  lockAlpha?: boolean; pencil?: boolean; autoErase?: boolean;
  source?: Canvas; sourceOx?: number; sourceOy?: number; cloneOffset?: Pt; aligned?: boolean; // clone / heal / history
  pattern?: string; strength?: number; range?: 'shadows' | 'midtones' | 'highlights'; exposure?: number; spongeMode?: 'saturate' | 'desaturate'; protectTones?: boolean;
  fingerPaint?: boolean; tolerance?: number; replaceMode?: 'hue' | 'saturation' | 'color' | 'luminosity';
  wet?: number; load?: number; mix?: number; maskPaint?: boolean; // painting on grayscale mask
}

export class Stroke {
  o: StrokeOpts; start: Canvas; buffer: Canvas | null = null;
  last: Pt | null = null; smoothPt: Pt | null = null; carry = 0; dirty: Rect | null = null; total: Rect | null = null;
  selAlpha: Canvas | null = null; smudgeBuf: ImageData | null = null; bgSample: number[] | null = null;
  dabs: { x: number; y: number; s: number }[] = [];
  private airTimer: any = 0;
  constructor(o: StrokeOpts) {
    this.o = o;
    this.start = cloneCanvas(o.target);
    const buffered = ['paint', 'erase', 'clone', 'pattern', 'history', 'heal', 'spot', 'arthistory'].includes(o.mode);
    if (buffered) this.buffer = makeCanvas(o.target.width, o.target.height);
    if (o.selection) {
      // selection as alpha, aligned to the target canvas
      const a = makeCanvas(o.target.width, o.target.height), d = ctx2d(o.selection).getImageData(0, 0, o.selection.width, o.selection.height);
      for (let i = 0; i < d.data.length; i += 4) { d.data[i + 3] = d.data[i]; }
      const t = makeCanvas(o.selection.width, o.selection.height); ctx2d(t).putImageData(d, 0, 0);
      ctx2d(a).drawImage(t, -o.ox, -o.oy); this.selAlpha = a;
    }
  }
  /** Add a point in document coordinates. pressure 0..1. Returns the dirty rect in document coordinates. */
  to(p: Pt, pressure = 1): Rect | null {
    const b = this.o.brush;
    // lazy smoothing
    if (!this.smoothPt) this.smoothPt = { ...p };
    else { const k = 1 - clamp(b.smoothing, 0, 0.95); this.smoothPt = { x: this.smoothPt.x + (p.x - this.smoothPt.x) * k, y: this.smoothPt.y + (p.y - this.smoothPt.y) * k }; }
    const q = this.smoothPt;
    const size = Math.max(1, b.size * (b.pressureSize ? Math.max(0.05, pressure) : 1));
    const spacing = Math.max(0.5, size * b.spacing);
    if (!this.last) { this.dab(q, size, pressure); this.last = { ...q }; }
    else {
      const dx = q.x - this.last.x, dy = q.y - this.last.y, dist = Math.hypot(dx, dy);
      let t = spacing - this.carry;
      while (t <= dist) { this.dab({ x: this.last.x + (dx * t) / dist, y: this.last.y + (dy * t) / dist }, size, pressure); t += spacing; }
      this.carry = dist - (t - spacing);
      this.last = { ...q };
    }
    if (b.airbrush && !this.airTimer && this.buffer) {
      this.airTimer = setInterval(() => { if (this.last) { this.dab(this.last, size, pressure); this.flush(); this.onAir?.(); } }, 60);
    }
    return this.flush();
  }
  onAir?: () => void;
  private dab(p: Pt, size: number, pressure: number) {
    const b = this.o.brush;
    for (let n = 0; n < Math.max(1, b.count); n++) {
      let s = size * (1 - Math.random() * b.sizeJitter);
      const ang = b.angle + (Math.random() - 0.5) * 360 * b.angleJitter;
      const rnd = clamp(b.roundness * (1 - Math.random() * b.roundJitter), 0.05, 1);
      let x = p.x, y = p.y;
      if (b.scatter) { x += (Math.random() - 0.5) * 2 * b.scatter * size; y += (Math.random() - 0.5) * 2 * b.scatter * size; }
      s = Math.max(1, s);
      const tip = makeTip(b, s, ang, rnd, !this.o.pencil);
      const tx = x - this.o.ox - tip.width / 2, ty = y - this.o.oy - tip.height / 2;
      const r: Rect = rectRound({ x: tx, y: ty, w: tip.width, h: tip.height });
      const alpha = b.flow * (b.pressureOpacity ? pressure : 1);
      this.dabs.push({ x, y, s });
      this.apply(tip, tx, ty, r, alpha, s);
      this.dirty = rectUnion(this.dirty, r);
    }
  }
  private dabColor(): string {
    const b = this.o.brush; let c = this.o.color;
    if (b.fgbgJitter && Math.random() < b.fgbgJitter) c = this.o.bg;
    if (b.hueJitter || b.brightJitter) {
      const rgb = hexToRgb(c); let [h, s, l] = rgbToHsl(rgb.r, rgb.g, rgb.b);
      h += (Math.random() - 0.5) * 360 * b.hueJitter; l = clamp(l + (Math.random() - 0.5) * b.brightJitter, 0, 1);
      const o = hslToRgb(h, s, l); c = `rgb(${o.r | 0},${o.g | 0},${o.b | 0})`;
    }
    return c;
  }
  private apply(tip: Canvas, tx: number, ty: number, r: Rect, alpha: number, size: number) {
    const o = this.o, m = o.mode;
    if (this.buffer) {
      const bx = ctx2d(this.buffer); bx.globalAlpha = alpha;
      if (m === 'paint' || m === 'spot' || m === 'erase') bx.drawImage(m === 'paint' ? colorize(tip, this.dabColor()) : tip, tx, ty);
      else if (m === 'pattern') {
        const d = makeCanvas(tip.width, tip.height), dx = ctx2d(d); const pat = dx.createPattern(getPattern(o.pattern || 'Dots'), 'repeat')!;
        pat.setTransform(new DOMMatrix().translate(-tx - o.ox, -ty - o.oy)); dx.fillStyle = pat; dx.fillRect(0, 0, d.width, d.height);
        dx.globalCompositeOperation = 'destination-in'; dx.drawImage(tip, 0, 0); bx.drawImage(d, tx, ty);
      } else if (m === 'clone' || m === 'heal' || m === 'history' || m === 'arthistory') {
        const src = o.source!; const off = m === 'history' || m === 'arthistory' ? { x: 0, y: 0 } : o.cloneOffset || { x: 0, y: 0 };
        const d = makeCanvas(tip.width, tip.height), dx = ctx2d(d);
        let sx = tx + o.ox - off.x - (o.sourceOx || 0), sy = ty + o.oy - off.y - (o.sourceOy || 0);
        if (m === 'arthistory') { sx += (Math.random() - 0.5) * size; sy += (Math.random() - 0.5) * size; }
        dx.drawImage(src, -sx, -sy);
        dx.globalCompositeOperation = 'destination-in'; dx.drawImage(tip, 0, 0); bx.drawImage(d, tx, ty);
      }
      bx.globalAlpha = 1;
      return;
    }
    // direct-modification tools
    const tc = ctx2d(o.target), area = rectIntersect(r, { x: 0, y: 0, w: o.target.width, h: o.target.height }); if (!area) return;
    const img = tc.getImageData(area.x, area.y, area.w, area.h), d = img.data;
    const ta = ctx2d(tip).getImageData(area.x - Math.round(tx) , area.y - Math.round(ty), area.w, area.h).data;
    const sel = this.selAlpha ? ctx2d(this.selAlpha).getImageData(area.x, area.y, area.w, area.h).data : null;
    const k = (o.strength ?? 0.5) * alpha;
    const W = area.w, H = area.h;
    const weight = (i: number) => (ta[i + 3] / 255) * k * (sel ? sel[i + 3] / 255 : 1);
    if (m === 'blur' || m === 'sharpen') {
      const src = new Uint8ClampedArray(d);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, w = weight(i); if (!w) continue;
        for (let c = 0; c < 3; c++) {
          let s = 0, n = 0;
          for (let j = -1; j <= 1; j++) for (let q = -1; q <= 1; q++) { const yy = clamp(y + j, 0, H - 1), xx = clamp(x + q, 0, W - 1); s += src[(yy * W + xx) * 4 + c]; n++; }
          const avg = s / n;
          d[i + c] = m === 'blur' ? src[i + c] + (avg - src[i + c]) * w : src[i + c] + (src[i + c] - avg) * w * 1.5;
        }
      }
    } else if (m === 'smudge' || m === 'mixer') {
      if (!this.smudgeBuf || this.smudgeBuf.width !== W || this.smudgeBuf.height !== H) {
        this.smudgeBuf = new ImageData(new Uint8ClampedArray(d), W, H);
        if (o.fingerPaint || m === 'mixer') { const c = hexToRgb(o.color); for (let i = 0; i < d.length; i += 4) { this.smudgeBuf.data[i] = c.r; this.smudgeBuf.data[i + 1] = c.g; this.smudgeBuf.data[i + 2] = c.b; this.smudgeBuf.data[i + 3] = 255; } }
      }
      const sb = this.smudgeBuf.data, mix = m === 'mixer' ? (o.mix ?? 0.5) : 1;
      for (let i = 0; i < d.length; i += 4) {
        const w = weight(i) * mix; if (!w) continue;
        for (let c = 0; c < 4; c++) { const nv = d[i + c] + (sb[i + c] - d[i + c]) * w; sb[i + c] = sb[i + c] + (d[i + c] - sb[i + c]) * (1 - (o.strength ?? 0.5)) * 0.5; d[i + c] = nv; }
      }
      if (m === 'mixer') { const c = hexToRgb(o.color), load = o.load ?? 0.5; for (let i = 0; i < sb.length; i += 4) { sb[i] += (c.r - sb[i]) * load * 0.2; sb[i + 1] += (c.g - sb[i + 1]) * load * 0.2; sb[i + 2] += (c.b - sb[i + 2]) * load * 0.2; } }
    } else if (m === 'dodge' || m === 'burn') {
      const exp = (o.exposure ?? 0.5) * (m === 'dodge' ? 1 : -1), range = o.range || 'midtones';
      for (let i = 0; i < d.length; i += 4) {
        const w = weight(i) / Math.max(0.01, o.strength ?? 0.5) * 0.5; if (!w) continue;
        const l = lum(d[i], d[i + 1], d[i + 2]) / 255;
        const rw = range === 'shadows' ? (1 - l) ** 2 : range === 'highlights' ? l * l : 1 - Math.abs(l - 0.5) * 2;
        const f = 1 + exp * rw * w * 0.6;
        for (let c = 0; c < 3; c++) d[i + c] = o.protectTones ? 255 * Math.pow(d[i + c] / 255, 1 / f) : d[i + c] * f;
      }
    } else if (m === 'sponge') {
      const sat = o.spongeMode === 'desaturate' ? -1 : 1;
      for (let i = 0; i < d.length; i += 4) {
        const w = weight(i); if (!w) continue; const l = lum(d[i], d[i + 1], d[i + 2]);
        for (let c = 0; c < 3; c++) d[i + c] = l + (d[i + c] - l) * (1 + sat * w * 0.5);
      }
    } else if (m === 'replace' || m === 'bgerase') {
      if (!this.bgSample) { const ci = (Math.floor(H / 2) * W + Math.floor(W / 2)) * 4; this.bgSample = [d[ci], d[ci + 1], d[ci + 2]]; }
      const [sr, sg, sb2] = this.bgSample, tol = (o.tolerance ?? 30) * 2.55, c = hexToRgb(o.color);
      const [th, ts] = rgbToHsl(c.r, c.g, c.b);
      for (let i = 0; i < d.length; i += 4) {
        const w = (ta[i + 3] / 255) * (sel ? sel[i + 3] / 255 : 1); if (!w) continue;
        const dist = Math.max(Math.abs(d[i] - sr), Math.abs(d[i + 1] - sg), Math.abs(d[i + 2] - sb2)); if (dist > tol) continue;
        const f = w * (1 - dist / Math.max(1, tol) * 0.5);
        if (m === 'bgerase') d[i + 3] = d[i + 3] * (1 - f);
        else {
          const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]); const mode = o.replaceMode || 'color';
          const nn = hslToRgb(mode === 'saturation' ? h : th, mode === 'hue' ? s : ts, mode === 'luminosity' ? lum(c.r, c.g, c.b) / 255 : l);
          d[i] += (nn.r - d[i]) * f; d[i + 1] += (nn.g - d[i + 1]) * f; d[i + 2] += (nn.b - d[i + 2]) * f;
        }
      }
    }
    tc.putImageData(img, area.x, area.y);
  }
  /** Composite the stroke buffer into the target over the dirty area. Returns the dirty rect in document space. */
  flush(): Rect | null {
    const r = this.dirty; if (!r) return null;
    this.dirty = null; this.total = rectUnion(this.total, r);
    const area = rectIntersect(r, { x: 0, y: 0, w: this.o.target.width, h: this.o.target.height });
    if (!area) return null;
    if (this.buffer) {
      const o = this.o, x = ctx2d(o.target);
      x.save(); x.globalCompositeOperation = 'copy'; x.beginPath(); x.rect(area.x, area.y, area.w, area.h); x.clip(); x.drawImage(this.start, 0, 0); x.restore();
      let src = this.buffer;
      if (this.selAlpha || o.brush.wetEdges || o.brush.noise) {
        src = makeCanvas(area.w, area.h); const sx = ctx2d(src); sx.drawImage(this.buffer, -area.x, -area.y);
        if (o.brush.wetEdges) { sx.globalCompositeOperation = 'source-in'; sx.globalAlpha = 0.6; sx.drawImage(this.buffer, -area.x, -area.y); sx.globalAlpha = 1; }
        if (o.brush.noise) { const dd = sx.getImageData(0, 0, area.w, area.h); for (let i = 3; i < dd.data.length; i += 4) dd.data[i] *= 0.7 + Math.random() * 0.3; sx.putImageData(dd, 0, 0); }
        if (this.selAlpha) { sx.globalCompositeOperation = 'destination-in'; sx.drawImage(this.selAlpha, -area.x, -area.y); }
        src = (() => { const full = makeCanvas(1, 1); void full; return src; })();
        this.compose(src, area.x, area.y, area);
      } else this.compose(src, 0, 0, area);
    }
    return { x: area.x + this.o.ox, y: area.y + this.o.oy, w: area.w, h: area.h };
  }
  private compose(src: Canvas, sx: number, sy: number, area: Rect) {
    const o = this.o, x = ctx2d(o.target), op = o.brush.opacity;
    if (o.mode === 'erase') {
      if (o.maskPaint) { // erasing on a mask paints the background colour
        const t = makeCanvas(src.width, src.height), tx = ctx2d(t); tx.drawImage(src, 0, 0); tx.globalCompositeOperation = 'source-in'; tx.fillStyle = o.bg; tx.fillRect(0, 0, t.width, t.height);
        x.save(); x.globalAlpha = op; x.drawImage(t, sx, sy); x.restore(); return;
      }
      x.save(); x.globalAlpha = op; x.globalCompositeOperation = 'destination-out'; x.beginPath(); x.rect(area.x, area.y, area.w, area.h); x.clip(); x.drawImage(src, sx, sy); x.restore(); return;
    }
    if (o.mode === 'spot') { // show the stroke while painting, healed on release
      x.save(); x.globalAlpha = 0.45; x.beginPath(); x.rect(area.x, area.y, area.w, area.h); x.clip();
      const t = makeCanvas(src.width, src.height), tx = ctx2d(t); tx.drawImage(src, 0, 0); tx.globalCompositeOperation = 'source-in'; tx.fillStyle = '#7f7f7f'; tx.fillRect(0, 0, t.width, t.height);
      x.drawImage(t, sx, sy); x.restore(); return;
    }
    if (o.lockAlpha) { x.save(); x.globalAlpha = op; x.globalCompositeOperation = 'source-atop'; x.beginPath(); x.rect(area.x, area.y, area.w, area.h); x.clip(); x.drawImage(src, sx, sy); x.restore(); return; }
    drawBlended(o.target, src, sx, sy, o.brush.blend, op, area);
  }
  end() { if (this.airTimer) clearInterval(this.airTimer); this.airTimer = 0; this.flush(); }
}
