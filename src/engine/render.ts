// Compositor: renders the layer tree into a document-sized canvas, optionally just a dirty rectangle.
import type { Layer, Mask } from './types';
import type { Doc } from './doc';
import { Canvas, ctx2d, makeCanvas, Rect, rectIntersect, rectRound, hexToRgb } from './util';
import { drawBlended, blendBuffers } from './blend';
import { applyAdjustment } from './adjust';
import { applyStyles, hasStyles } from './styles';
import { drawShape, drawText } from './vector';
import { renderGradient, fillPattern, withFgBg } from './paint';
import { renderQuad } from './transform';
import { FILTER_MAP } from './filterdefs';
import { blurChannel } from './filters';

interface Placed { canvas: Canvas; x: number; y: number }
const contentCache = new Map<string, { key: string; v: Placed }>();
const styleCache = new Map<string, { key: string; v: Placed }>();
const maskCache = new WeakMap<Canvas, { key: string; v: Canvas }>();
export const renderEnv = { fg: '#000000', bg: '#ffffff' };

function keyOf(l: Layer, d: Doc) {
  switch (l.kind) {
    case 'text': return JSON.stringify(l.text) + d.w + 'x' + d.h;
    case 'shape': return JSON.stringify(l.shape) + d.w + 'x' + d.h;
    case 'fill': return JSON.stringify(l.fill) + d.w + 'x' + d.h + renderEnv.fg + renderEnv.bg;
    case 'smart': return l.ver + JSON.stringify(l.smart!.quad) + JSON.stringify(l.smart!.filters) + l.smart!.source.width;
    default: return String(l.ver);
  }
}
/** The layer's own pixels (before effects, mask and opacity) placed in document space. */
export function layerContent(d: Doc, l: Layer): Placed | null {
  if (l.kind === 'raster') return l.canvas ? { canvas: l.canvas, x: l.x, y: l.y } : null;
  if (l.kind === 'group' || l.kind === 'adjustment') return null;
  const key = keyOf(l, d), hit = contentCache.get(l.id);
  if (hit && hit.key === key) return hit.v;
  let v: Placed;
  if (l.kind === 'text') { const c = makeCanvas(d.w, d.h); drawText(ctx2d(c), l.text!); v = { canvas: c, x: 0, y: 0 }; }
  else if (l.kind === 'shape') {
    const c = makeCanvas(d.w, d.h), x = ctx2d(c), s = l.shape!;
    let style: any;
    if (s.fill.type === 'gradient' && s.fill.gradient) {
      const g = makeCanvas(d.w, d.h), a = ((s.fill.angle ?? 90) * Math.PI) / 180, cx = d.w / 2, cy = d.h / 2, len = Math.max(d.w, d.h) / 2;
      ctx2d(g).putImageData(renderGradient(d.w, d.h, s.fill.gradient, s.fill.gradShape || 'linear', { x: cx - Math.cos(a) * len, y: cy + Math.sin(a) * len }, { x: cx + Math.cos(a) * len, y: cy - Math.sin(a) * len }), 0, 0);
      style = x.createPattern(g, 'no-repeat');
    } else if (s.fill.type === 'pattern') { const p = makeCanvas(d.w, d.h); fillPattern(ctx2d(p), s.fill.pattern || 'Dots', d.w, d.h); style = x.createPattern(p, 'no-repeat'); }
    drawShape(x, s, 0, 0, style);
    v = { canvas: c, x: 0, y: 0 };
  } else if (l.kind === 'fill') {
    const c = makeCanvas(d.w, d.h), x = ctx2d(c), f = l.fill!;
    if (f.type === 'color') { x.fillStyle = f.color; x.fillRect(0, 0, d.w, d.h); }
    else if (f.type === 'pattern') fillPattern(x, f.pattern, d.w, d.h, f.patScale);
    else {
      const a = (f.angle * Math.PI) / 180, len = (Math.hypot(d.w, d.h) / 2) * (f.scale / 100), cx = d.w / 2, cy = d.h / 2;
      const radial = f.shape !== 'linear' && f.shape !== 'reflected';
      x.putImageData(renderGradient(d.w, d.h, withFgBg(f.gradient, renderEnv.fg, renderEnv.bg), f.shape, radial ? { x: cx, y: cy } : { x: cx - Math.cos(a) * len, y: cy + Math.sin(a) * len }, { x: cx + Math.cos(a) * len, y: cy - Math.sin(a) * len }, f.reverse), 0, 0);
    }
    v = { canvas: c, x: 0, y: 0 };
  } else {
    const sm = l.smart!; let src = sm.source;
    // smart filters run on the source before placement, like a re-editable stack
    for (const f of sm.filters) {
      if (!f.enabled) continue;
      const def = FILTER_MAP[f.filter]; if (!def) continue;
      const id = ctx2d(src).getImageData(0, 0, src.width, src.height);
      const out = def.run(id, f.params, { fg: renderEnv.fg, bg: renderEnv.bg, scale: 1 });
      const nc = makeCanvas(src.width, src.height); ctx2d(nc).drawImage(src, 0, 0);
      const t = makeCanvas(src.width, src.height); ctx2d(t).putImageData(out, 0, 0);
      drawBlended(nc, t, 0, 0, f.blend, f.opacity);
      src = nc;
    }
    const r = renderQuad(src, sm.quad);
    v = { canvas: r.canvas, x: r.x, y: r.y };
  }
  contentCache.set(l.id, { key, v });
  return v;
}
function styled(d: Doc, l: Layer, p: Placed): Placed {
  if (!l.styles || l.stylesOn === false || !hasStyles(l.styles)) {
    if (l.fillOpacity >= 1) return p;
    const c = makeCanvas(p.canvas.width, p.canvas.height), x = ctx2d(c); x.globalAlpha = l.fillOpacity; x.drawImage(p.canvas, 0, 0);
    return { canvas: c, x: p.x, y: p.y };
  }
  const key = keyOf(l, d) + '|' + l.ver + JSON.stringify(l.styles) + l.fillOpacity + p.canvas.width + ',' + p.x + ',' + p.y;
  const hit = styleCache.get(l.id);
  if (hit && hit.key === key) return hit.v;
  // crop to content bounds + effects for speed
  const r = applyStyles(p.canvas, l.styles, l.fillOpacity);
  const v = { canvas: r.canvas, x: p.x + r.dx, y: p.y + r.dy };
  styleCache.set(l.id, { key, v });
  return v;
}
export function maskAlpha(m: Mask): Canvas {
  const key = m.density + ':' + m.feather, hit = maskCache.get(m.canvas);
  if (hit && hit.key === key) return hit.v;
  const w = m.canvas.width, h = m.canvas.height, d = ctx2d(m.canvas).getImageData(0, 0, w, h), p = d.data;
  let ch: ArrayLike<number> | null = null;
  if (m.feather > 0) { const g = new Uint8ClampedArray(w * h); for (let i = 0; i < g.length; i++) g[i] = p[i * 4]; ch = blurChannel(g, w, h, m.feather / 2); }
  for (let i = 0; i < w * h; i++) { const v = ch ? ch[i] : p[i * 4]; p[i * 4 + 3] = 255 - (255 - v) * m.density; p[i * 4] = p[i * 4 + 1] = p[i * 4 + 2] = 0; }
  const c = makeCanvas(w, h); ctx2d(c).putImageData(d, 0, 0);
  maskCache.set(m.canvas, { key, v: c });
  return c;
}
/** Apply a mask to a region canvas R (positioned at rect origin). */
function applyMask(t: Canvas, R: Rect, m: Mask) {
  const a = take(t.width, t.height), ax = ctx2d(a);
  if (m.bg) { ax.fillStyle = '#000'; ax.fillRect(0, 0, a.width, a.height); ax.clearRect(m.x - R.x, m.y - R.y, m.canvas.width, m.canvas.height); }
  ax.drawImage(maskAlpha(m), m.x - R.x, m.y - R.y);
  const x = ctx2d(t); x.save(); x.globalCompositeOperation = 'destination-in'; x.drawImage(a, 0, 0); x.restore();
  give(a);
}

// --- region canvas pool ---
const pool: Canvas[] = [];
function take(w: number, h: number): Canvas { const c = pool.pop() || makeCanvas(w, h); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } else ctx2d(c).clearRect(0, 0, w, h); return c; }
function give(c: Canvas) { if (pool.length < 24) pool.push(c); }

function placeInto(t: Canvas, R: Rect, p: Placed, alpha = 1) { const x = ctx2d(t); x.globalAlpha = alpha; x.drawImage(p.canvas, p.x - R.x, p.y - R.y); x.globalAlpha = 1; }

function adjustRegion(t: Canvas, R: Rect, l: Layer, d: Doc) {
  const x = ctx2d(t), img = x.getImageData(0, 0, t.width, t.height), src = new Uint8ClampedArray(img.data);
  const adj = new ImageData(new Uint8ClampedArray(img.data), t.width, t.height);
  applyAdjustment(adj.data, l.adj!);
  let mask: Uint8ClampedArray | null = null;
  if (l.mask && l.mask.enabled) {
    const mc = take(t.width, t.height), mx = ctx2d(mc); mx.fillStyle = '#000'; mx.fillRect(0, 0, mc.width, mc.height);
    applyMaskGray(mc, R, l.mask); mask = mx.getImageData(0, 0, mc.width, mc.height).data; give(mc);
  }
  const o = img.data, k = l.opacity;
  if (l.blend === 'normal') {
    for (let i = 0; i < o.length; i += 4) { const m = (mask ? mask[i] / 255 : 1) * k; if (!m) continue; o[i] = src[i] + (adj.data[i] - src[i]) * m; o[i + 1] = src[i + 1] + (adj.data[i + 1] - src[i + 1]) * m; o[i + 2] = src[i + 2] + (adj.data[i + 2] - src[i + 2]) * m; }
  } else {
    for (let i = 0; i < o.length; i += 4) adj.data[i + 3] = src[i + 3];
    blendBuffers(o, adj.data, l.blend, k, mask);
    for (let i = 0; i < o.length; i += 4) o[i + 3] = src[i + 3];
  }
  void d;
  x.putImageData(img, 0, 0);
}
function applyMaskGray(mc: Canvas, R: Rect, m: Mask) {
  const x = ctx2d(mc); x.fillStyle = m.bg ? '#fff' : '#000'; x.fillRect(0, 0, mc.width, mc.height);
  x.drawImage(m.canvas, m.x - R.x, m.y - R.y);
  if (m.density < 1) { x.fillStyle = `rgba(255,255,255,${1 - m.density})`; x.fillRect(0, 0, mc.width, mc.height); }
}

/** Render a single layer's final pixels (content, effects, mask, clipped layers) into a region canvas. */
function layerRegion(d: Doc, l: Layer, clipped: Layer[], R: Rect, backdrop: Canvas | null): Canvas | null {
  let t: Canvas;
  if (l.kind === 'group') {
    t = take(R.w, R.h);
    renderList(d, l.children!, t, R);
  } else {
    const p = layerContent(d, l); if (!p) return null;
    const s = styled(d, l, p);
    t = take(R.w, R.h); placeInto(t, R, s);
  }
  if (l.mask && l.mask.enabled) applyMask(t, R, l.mask);
  if (clipped.length) {
    const baseAlpha = take(R.w, R.h); ctx2d(baseAlpha).drawImage(t, 0, 0);
    for (const c of clipped) {
      if (!c.visible) continue;
      if (c.kind === 'adjustment') { adjustRegion(t, R, c, d); continue; }
      const cr = layerRegion(d, c, [], R, null); if (!cr) continue;
      const cx = ctx2d(cr); cx.globalCompositeOperation = 'destination-in'; cx.drawImage(baseAlpha, 0, 0); cx.globalCompositeOperation = 'source-over';
      drawBlended(t, cr, 0, 0, c.blend === 'pass-through' ? 'normal' : c.blend, c.opacity);
      give(cr);
    }
    // restore base alpha (blending may not exceed it)
    const tx = ctx2d(t); tx.globalCompositeOperation = 'destination-in'; tx.drawImage(baseAlpha, 0, 0); tx.globalCompositeOperation = 'source-over';
    give(baseAlpha);
  }
  void backdrop;
  return t;
}

export function renderList(d: Doc, layers: Layer[], target: Canvas, R: Rect) {
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    const clipped: Layer[] = [];
    let j = i + 1; while (j < layers.length && layers[j].clip) clipped.push(layers[j++]);
    if (l.clip && i > 0) continue; // drawn with its base
    i = j - 1;
    if (!l.visible) continue;
    if (l.kind === 'adjustment') { adjustRegion(target, R, l, d); continue; }
    if (l.kind === 'group' && l.blend === 'pass-through' && !clipped.length) {
      const t = take(R.w, R.h); ctx2d(t).drawImage(target, 0, 0);
      renderList(d, l.children!, t, R);
      if (l.mask && l.mask.enabled) applyMask(t, R, l.mask);
      if (l.opacity >= 1 && !(l.mask && l.mask.enabled)) { const x = ctx2d(target); x.save(); x.globalCompositeOperation = 'copy'; x.drawImage(t, 0, 0); x.restore(); }
      else { const x = ctx2d(target); x.globalAlpha = l.opacity; x.drawImage(t, 0, 0); x.globalAlpha = 1; }
      give(t); continue;
    }
    const t = layerRegion(d, l, clipped, R, target); if (!t) continue;
    drawBlended(target, t, 0, 0, l.blend === 'pass-through' ? 'normal' : l.blend, l.opacity);
    give(t);
  }
}

/** Render the document (or a rectangle of it) into `out` (document-sized). */
export function renderDoc(d: Doc, out: Canvas, rect?: Rect | null, layers = d.layers) {
  if (out.width !== d.w || out.height !== d.h) { out.width = d.w; out.height = d.h; }
  const R = rect ? rectIntersect(rectRound(rect), { x: 0, y: 0, w: d.w, h: d.h }) : { x: 0, y: 0, w: d.w, h: d.h };
  if (!R) return;
  const t = take(R.w, R.h);
  renderList(d, layers, t, R);
  const x = ctx2d(out); x.save(); x.globalCompositeOperation = 'copy'; x.beginPath(); x.rect(R.x, R.y, R.w, R.h); x.clip(); x.drawImage(t, R.x, R.y); x.restore();
  give(t);
}
/** Flattened copy of the document (optionally on a background colour). */
export function flatten(d: Doc, bg?: string, layers = d.layers): Canvas {
  const c = makeCanvas(d.w, d.h); renderDoc(d, c, null, layers);
  if (bg) { const b = makeCanvas(d.w, d.h), x = ctx2d(b); x.fillStyle = bg; x.fillRect(0, 0, d.w, d.h); x.drawImage(c, 0, 0); return b; }
  return c;
}
/** A single layer rendered alone with its mask and effects (for merges and rasterize). */
export function renderLayerAlone(d: Doc, l: Layer, withStyles = true): Canvas {
  const c = makeCanvas(d.w, d.h); const R = { x: 0, y: 0, w: d.w, h: d.h };
  const copy = { ...l, visible: true, clip: false, opacity: 1, blend: 'normal' as const, styles: withStyles ? l.styles : undefined };
  renderList(d, [copy], c, R);
  return c;
}
export function clearCaches(id?: string) { if (id) { contentCache.delete(id); styleCache.delete(id); } else { contentCache.clear(); styleCache.clear(); } }
export const colorOf = (hex: string) => hexToRgb(hex);
