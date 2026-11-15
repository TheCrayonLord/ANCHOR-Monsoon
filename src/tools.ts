// Tool behaviours. The canvas view forwards pointer events here in document coordinates.
import { app, paintTarget, requireDoc, layerBounds, ToolId } from './app';
import type { Doc } from './engine/doc';
import { newLayer, flatLayers } from './engine/doc';
import type { Layer, PathPoint, VectorPath } from './engine/types';
import { Stroke, StrokeMode } from './engine/brush';
import * as Sel from './engine/selection';
import { flatten, layerContent, clearCaches, renderLayerAlone } from './engine/render';
import { Canvas, Ctx, ctx2d, makeCanvas, cloneCanvas, Pt, Rect, rectFromPts, rgbToHex, getData, rectIntersect, clamp, lum } from './engine/util';
import { renderGradient, withFgBg } from './engine/paint';
import { healBlend, inpaint, redEye } from './engine/heal';
import { commands, cropDoc, offsetLayer, run } from './cmds';
import * as V from './engine/vector';
import { renderQuad, Quad, meshWarp, bezierPatch, patchFromRect } from './engine/transform';
import { drawBlended } from './engine/blend';

export interface ViewApi {
  zoom: number;
  toScreen(p: Pt): Pt; toDoc(p: Pt): Pt;
  redraw(r?: Rect | null): void; overlay(): void;
  composite(): Canvas;
  pan(dx: number, dy: number): void; setZoom(z: number, at?: Pt): void; rotate(deg: number): void; fitRect(r: Rect): void;
  editText(layerId: string | null): void;
}
export interface PEvt { p: Pt; raw: Pt; shift: boolean; alt: boolean; ctrl: boolean; pressure: number; button: number; dbl?: boolean; pointerType: string }
interface Handler {
  down?(d: Doc, e: PEvt, v: ViewApi): void; move?(d: Doc, e: PEvt, v: ViewApi): void; up?(d: Doc, e: PEvt, v: ViewApi): void;
  hover?(d: Doc, e: PEvt, v: ViewApi): void; overlay?(x: Ctx, d: Doc, v: ViewApi): void; cursor?: (d: Doc) => string;
  commit?(d: Doc, v: ViewApi): void; cancel?(d: Doc, v: ViewApi): void; key?(d: Doc, e: KeyboardEvent, v: ViewApi): boolean;
}

// ---------- shared transient state ----------
export const ts: {
  drag: Pt | null; cur: Pt | null; pts: Pt[]; stroke: Stroke | null; strokeTarget: ReturnType<typeof paintTarget> | null;
  crop: { r: Rect; angle: number; handle: string | null; start?: { r: Rect; p: Pt; angle: number } } | null;
  pcrop: Quad | null; pcropHandle: number;
  transform: TransformSession | null; pen: { pts: PathPoint[]; closed: boolean; target: 'path' | 'shape' } | null; penDrag: number;
  ruler: [Pt, Pt] | null; moveStart: any; info: string; hoverPt: Pt | null; patchSel: boolean; directSel: { pathRef: VectorPath; sp: number; pt: number; part: 'p' | 'i' | 'o' } | null;
  zoomRect: boolean;
} = { drag: null, cur: null, pts: [], stroke: null, strokeTarget: null, crop: null, pcrop: null, pcropHandle: -1, transform: null, pen: null, penDrag: -1, ruler: null, moveStart: null, info: '', hoverPt: null, patchSel: false, directSel: null, zoomRect: false };

export function selOpFrom(e: PEvt): Sel.SelOp {
  if (e.shift && e.alt) return 'intersect';
  if (e.shift) return 'add';
  if (e.alt) return 'subtract';
  return app.opts.selOp;
}
function applySelection(d: Doc, shape: Canvas, op: Sel.SelOp, label: string) {
  if (d.s.selection) d.lastSelection = d.s.selection;
  const m = Sel.combine(d.s.selection, shape, op, d.w, d.h);
  d.s.selection = Sel.isEmpty(m) ? null : m;
  d.commit(label); app.emit();
}
function constrain(a: Pt, b: Pt, e: PEvt): Rect {
  let w = b.x - a.x, h = b.y - a.y;
  const o = app.opts;
  if (o.marqueeStyle === 'fixed-size') { w = Math.sign(w || 1) * o.fixedW; h = Math.sign(h || 1) * o.fixedH; }
  else if (o.marqueeStyle === 'fixed-ratio') { h = Math.sign(h || 1) * Math.abs(w) * (o.fixedH / o.fixedW); }
  else if (e.shift && !ts.moveStart) { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s; }
  if (e.alt && !ts.moveStart) return { x: a.x - w, y: a.y - h, w: Math.abs(w) * 2, h: Math.abs(h) * 2 };
  return rectFromPts(a, { x: a.x + w, y: a.y + h });
}
function sourceImage(d: Doc, all: boolean): ImageData {
  if (all) return getData(flatten(d));
  const l = d.active; if (!l) return getData(flatten(d));
  return getData(renderLayerAlone(d, l, false));
}
const inSel = (d: Doc, p: Pt) => { if (!d.s.selection) return false; const x = Math.floor(p.x), y = Math.floor(p.y); if (x < 0 || y < 0 || x >= d.w || y >= d.h) return false; return ctx2d(d.s.selection).getImageData(x, y, 1, 1).data[0] > 127; };

// ---------- painting ----------
function strokeMode(t: ToolId): StrokeMode {
  return ({ brush: 'paint', pencil: 'paint', eraser: 'erase', clone: 'clone', 'pattern-stamp': 'pattern', 'history-brush': 'history', 'art-history': 'arthistory', heal: 'heal', 'spot-heal': 'spot', remove: 'spot',
    blur: 'blur', sharpen: 'sharpen', smudge: 'smudge', dodge: 'dodge', burn: 'burn', sponge: 'sponge', 'color-replace': 'replace', mixer: 'mixer', 'bg-eraser': 'bgerase' } as Record<string, StrokeMode>)[t];
}
function historySource(d: Doc, l: Layer | null): Canvas | null {
  const h = d.history.find((x) => x.id === app.historySource) || d.history[0];
  const hl = l ? flatLayers(h.state.layers).find((x) => x.id === l.id) : null;
  return hl?.canvas || null;
}
const painter: Handler = {
  down(d, e, v) {
    const tool = app.tool;
    if ((tool === 'clone' || tool === 'heal') && e.alt) { app.cloneSource = { x: e.p.x, y: e.p.y, docId: d.id }; ts.moveStart = null; app.toast('Clone source set'); return; }
    const t = paintTarget(d); if (!t) return;
    const mode = strokeMode(tool);
    let m = mode;
    if (tool === 'eraser' && app.opts.eraseToHistory) m = 'history';
    const isMask = t.kind !== 'layer';
    let color = app.fg, bg = app.bg;
    if (isMask) { const g = (c: string) => { const n = parseInt(c.slice(1), 16); const v = Math.round(lum((n >> 16) & 255, (n >> 8) & 255, n & 255)); return `rgb(${v},${v},${v})`; }; color = g(app.fg); bg = g(app.bg); }
    const brush = tool === 'eraser' || tool === 'bg-eraser' ? app.eraserBrush : app.brush;
    let source: Canvas | undefined, sox = 0, soy = 0, cloneOffset: Pt | undefined;
    if (m === 'clone' || m === 'heal') {
      if (!app.cloneSource) { app.toast('Alt-click (Option-click) to set a source point first.'); return; }
      const sample = app.opts.cloneSample;
      if (sample === 'current' && t.kind === 'layer') { source = cloneCanvas(t.canvas); sox = t.ox; soy = t.oy; }
      else { source = flatten(d); }
      if (!app.opts.cloneAligned || !(ts as any).cloneOff) (ts as any).cloneOff = { x: e.p.x - app.cloneSource.x, y: e.p.y - app.cloneSource.y };
      cloneOffset = (ts as any).cloneOff;
    }
    if (m === 'history' || m === 'arthistory') { const hs = historySource(d, t.layer); if (!hs) { app.toast('The history state has no pixels for this layer.'); return; } source = hs; const hl = t.layer; sox = hl ? (flatLayers((d.history.find((x) => x.id === app.historySource) || d.history[0]).state.layers).find((x) => x.id === hl.id)?.x ?? 0) : 0; soy = hl ? (flatLayers((d.history.find((x) => x.id === app.historySource) || d.history[0]).state.layers).find((x) => x.id === hl.id)?.y ?? 0) : 0; }
    let erase = m === 'erase';
    if (tool === 'pencil' && e.alt === false && (app as any).autoErase) erase = false;
    ts.stroke = new Stroke({
      mode: erase && isMask ? 'erase' : m, brush: { ...brush, pressureSize: brush.pressureSize && e.pointerType === 'pen' }, color, bg, target: t.canvas, ox: t.ox, oy: t.oy,
      selection: t.kind === 'quickmask' ? null : d.s.selection, lockAlpha: t.kind === 'layer' && !!t.layer?.locks.transparency, pencil: tool === 'pencil' || (tool === 'eraser' && app.opts.eraserMode === 'pencil'),
      source, sourceOx: sox, sourceOy: soy, cloneOffset, pattern: app.pattern, strength: app.opts.strength, range: app.opts.range, exposure: app.opts.exposure,
      spongeMode: app.opts.spongeMode, protectTones: app.opts.protectTones, fingerPaint: app.opts.fingerPaint, tolerance: app.opts.tolerance, replaceMode: app.opts.replaceMode,
      mix: app.opts.mixerMix, load: app.opts.mixerLoad, maskPaint: isMask,
    });
    if (tool === 'eraser' && app.opts.eraserMode === 'block') ts.stroke.o.brush = { ...ts.stroke.o.brush, shape: 'square', hardness: 1 };
    ts.stroke.onAir = () => v.redraw(null);
    ts.strokeTarget = t;
    if (e.shift && ts.cur) { ts.stroke.to(ts.cur, e.pressure); }
    const r = ts.stroke.to(e.p, e.pressure); if (t.layer) t.layer.ver++;
    v.redraw(r);
  },
  move(_d, e, v) { if (!ts.stroke) return; const r = ts.stroke.to(e.p, e.pressure); if (ts.strokeTarget?.layer) ts.strokeTarget.layer.ver++; if (r) v.redraw(r); },
  up(d, _e, v) {
    const s = ts.stroke; if (!s) return; s.end(); ts.stroke = null;
    const t = ts.strokeTarget!; const tool = app.tool;
    if ((s.o.mode === 'spot' || s.o.mode === 'heal') && s.total) {
      const pad = s.o.brush.size * (s.o.mode === 'spot' ? 3 : 1) + 4, r = rectIntersect({ x: s.total.x - pad, y: s.total.y - pad, w: s.total.w + pad * 2, h: s.total.h + pad * 2 }, { x: 0, y: 0, w: t.canvas.width, h: t.canvas.height });
      if (r) {
        const tx = ctx2d(t.canvas), orig = ctx2d(s.start).getImageData(r.x, r.y, r.w, r.h), buf = ctx2d(s.buffer!).getImageData(r.x, r.y, r.w, r.h);
        if (s.o.mode === 'spot') {
          const mask = new Uint8Array(r.w * r.h); for (let i = 0; i < mask.length; i++) mask[i] = buf.data[i * 4 + 3] > 10 ? 1 : 0;
          let out: ImageData;
          if (tool === 'remove' || app.opts.spotType === 'content') out = inpaint(orig, mask);
          else { // proximity / texture: sample the surrounding ring with a shifted copy and heal
            const shift = Math.round(s.o.brush.size * 1.2); const src = new ImageData(new Uint8ClampedArray(orig.data), r.w, r.h);
            for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) { const i = (y * r.w + x) * 4, sx = clamp(x + shift, 0, r.w - 1), j = (y * r.w + sx) * 4; for (let c = 0; c < 4; c++) src.data[i + c] = orig.data[j + c]; }
            const mk = new Float32Array(r.w * r.h); for (let i = 0; i < mk.length; i++) mk[i] = mask[i];
            out = healBlend(orig, src, mk);
          }
          const mk = new Float32Array(r.w * r.h); for (let i = 0; i < mk.length; i++) mk[i] = buf.data[i * 4 + 3] / 255;
          const healed = tool === 'remove' || app.opts.spotType === 'content' ? healBlend(orig, out, mk, 3) : out;
          tx.putImageData(healed, r.x, r.y);
        } else {
          const cur = tx.getImageData(r.x, r.y, r.w, r.h), mk = new Float32Array(r.w * r.h);
          for (let i = 0; i < mk.length; i++) mk[i] = Math.min(1, buf.data[i * 4 + 3] / 255 * s.o.brush.opacity);
          tx.putImageData(app.opts.healMode === 'replace' ? cur : healBlend(orig, cur, mk), r.x, r.y);
        }
      }
    }
    if (t.layer) t.layer.ver++;
    d.commit(({ brush: 'Brush Tool', pencil: 'Pencil', eraser: 'Eraser', clone: 'Clone Stamp', heal: 'Healing Brush', 'spot-heal': 'Spot Healing Brush', remove: 'Remove Tool' } as any)[tool] || tool.replace(/-/g, ' ').replace(/^./, (c: string) => c.toUpperCase()));
    ts.strokeTarget = null; v.redraw(null); app.emit();
  },
  cursor: () => 'none',
};

// ---------- selection tools ----------
const marquee: Handler = {
  down(d, e) {
    if (inSel(d, e.p) && !e.shift && !e.alt && app.opts.selOp === 'new') { ts.moveStart = { p: e.p, sel: d.s.selection }; return; }
    ts.drag = e.p; ts.cur = e.p;
  },
  move(d, e, v) {
    if (ts.moveStart) { const dx = Math.round(e.p.x - ts.moveStart.p.x), dy = Math.round(e.p.y - ts.moveStart.p.y); const m = Sel.blankMask(d.w, d.h); ctx2d(m).drawImage(ts.moveStart.sel, dx, dy); d.s.selection = m; v.overlay(); return; }
    ts.cur = e.p; v.overlay();
  },
  up(d, e, v) {
    if (ts.moveStart) { ts.moveStart = null; d.commit('Move Selection'); app.emit(); return; }
    const a = ts.drag!, b = e.p; ts.drag = null; ts.cur = null;
    const tool = app.tool, op = selOpFrom(e);
    if (tool === 'marquee-row' || tool === 'marquee-col') {
      applySelection(d, Sel.shapeMask(d.w, d.h, (x) => tool === 'marquee-row' ? x.fillRect(0, Math.floor(b.y), d.w, 1) : x.fillRect(Math.floor(b.x), 0, 1, d.h)), op, tool === 'marquee-row' ? 'Single Row Marquee' : 'Single Column Marquee');
      return;
    }
    const r = constrain(a, b, e);
    if (r.w < 1 || r.h < 1) { if (op === 'new' && d.s.selection && app.opts.marqueeStyle !== 'fixed-size') { void run('deselect'); } v.overlay(); return; }
    const m = Sel.shapeMask(d.w, d.h, (x) => { if (tool === 'marquee-ellipse') { x.beginPath(); x.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, 7); x.fill(); } else x.fillRect(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)); }, app.opts.feather, tool === 'marquee-ellipse' ? app.opts.antialias : true);
    applySelection(d, m, op, tool === 'marquee-ellipse' ? 'Elliptical Marquee' : 'Rectangular Marquee');
  },
  overlay(x, _d, v) {
    if (!ts.drag || !ts.cur) return;
    const r = constrain(ts.drag, ts.cur, { shift: false, alt: false } as PEvt), a = v.toScreen({ x: r.x, y: r.y }), b = v.toScreen({ x: r.x + r.w, y: r.y + r.h });
    x.save(); x.setLineDash([4, 4]); x.strokeStyle = '#fff'; x.lineWidth = 1;
    x.beginPath(); if (app.tool === 'marquee-ellipse') x.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, 7); else x.rect(a.x, a.y, b.x - a.x, b.y - a.y);
    x.stroke(); x.strokeStyle = '#000'; x.lineDashOffset = 4; x.stroke(); x.restore();
    ts.info = `W: ${Math.round(r.w)} px  H: ${Math.round(r.h)} px`;
  },
  cursor: () => 'crosshair',
};
function magneticSnap(d: Doc, p: Pt): Pt {
  const img = (ts as any).magImg as ImageData; if (!img) return p;
  const r = 6; let best = p, bv = -1;
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
    const x = Math.round(p.x + i), y = Math.round(p.y + j); if (x < 1 || y < 1 || x >= d.w - 1 || y >= d.h - 1) continue;
    const L = (xx: number, yy: number) => { const k = (yy * d.w + xx) * 4; return lum(img.data[k], img.data[k + 1], img.data[k + 2]); };
    const g = Math.abs(L(x + 1, y) - L(x - 1, y)) + Math.abs(L(x, y + 1) - L(x, y - 1)) - Math.hypot(i, j) * 2;
    if (g > bv) { bv = g; best = { x, y }; }
  }
  return best;
}
const lasso: Handler = {
  down(d, e, v) {
    if (app.tool === 'lasso-poly') {
      if (!ts.pts.length) ts.pts = [e.p];
      else {
        const f = ts.pts[0], s0 = v.toScreen(f), s1 = v.toScreen(e.p);
        if (e.dbl || Math.hypot(s0.x - s1.x, s0.y - s1.y) < 8) return finishLasso(d, e);
        ts.pts.push(e.p);
      }
      v.overlay(); return;
    }
    if (app.tool === 'lasso-magnetic') (ts as any).magImg = getData(flatten(d));
    ts.pts = [e.p]; ts.drag = e.p;
  },
  move(d, e, v) { if (app.tool === 'lasso-poly') { ts.cur = e.p; v.overlay(); return; } if (!ts.drag) return; const p = app.tool === 'lasso-magnetic' ? magneticSnap(d, e.p) : e.p; const last = ts.pts[ts.pts.length - 1]; if (Math.hypot(p.x - last.x, p.y - last.y) > 0.7 / v.zoom) ts.pts.push(p); v.overlay(); },
  hover(_d, e, v) { if (app.tool === 'lasso-poly' && ts.pts.length) { ts.cur = e.p; v.overlay(); } },
  up(d, e) { if (app.tool === 'lasso-poly') return; ts.drag = null; finishLasso(d, e); },
  key(d, e) { if (app.tool === 'lasso-poly' && e.key === 'Enter' && ts.pts.length > 2) { finishLasso(d, { shift: e.shiftKey, alt: e.altKey } as PEvt); return true; } if (e.key === 'Escape') { ts.pts = []; return true; } return false; },
  overlay(x, _d, v) {
    if (!ts.pts.length) return;
    x.save(); x.beginPath(); ts.pts.forEach((p, i) => { const s = v.toScreen(p); i ? x.lineTo(s.x, s.y) : x.moveTo(s.x, s.y); });
    if (app.tool === 'lasso-poly' && ts.cur) { const s = v.toScreen(ts.cur); x.lineTo(s.x, s.y); }
    x.strokeStyle = '#000'; x.lineWidth = 1.5; x.stroke(); x.setLineDash([4, 4]); x.strokeStyle = '#fff'; x.stroke(); x.restore();
  },
  cursor: () => 'crosshair',
};
function finishLasso(d: Doc, e: PEvt) {
  const pts = ts.pts; ts.pts = []; ts.cur = null;
  if (pts.length < 3) return;
  if (app.tool === 'patch' || app.tool === 'content-move') { ts.patchSel = true; }
  const m = Sel.shapeMask(d.w, d.h, (x) => { x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.closePath(); x.fill(); }, app.opts.feather, app.opts.antialias);
  applySelection(d, m, selOpFrom(e), 'Lasso');
}
const wand: Handler = {
  down(d, e) {
    const img = sourceImage(d, app.opts.sampleAll);
    const m = Sel.colorMask(img, [e.p], app.opts.tolerance, app.opts.contiguous, app.opts.antialias, app.opts.sampleSize);
    applySelection(d, Sel.writeChannel(m, d.w, d.h), selOpFrom(e), 'Magic Wand');
  },
  cursor: () => 'crosshair',
};
const quickSelect: Handler = {
  down(d, e, v) { (ts as any).qsImg = sourceImage(d, app.opts.sampleAll); (ts as any).qsOp = e.alt ? 'subtract' : d.s.selection && (e.shift || app.opts.selOp !== 'new' || (ts as any).qsContinue) ? 'add' : 'new'; ts.pts = [e.p]; this.move!(d, e, v); },
  move(d, e, v) {
    if (!ts.pts.length) return;
    const img = (ts as any).qsImg as ImageData, r = app.brush.size / 2;
    // region grow from the brush centre, limited to a neighbourhood of the stroke
    const lim = { x: Math.max(0, Math.floor(e.p.x - r * 4)), y: Math.max(0, Math.floor(e.p.y - r * 4)) };
    const w = Math.min(d.w - lim.x, Math.ceil(r * 8)), h = Math.min(d.h - lim.y, Math.ceil(r * 8)); if (w < 1 || h < 1) return;
    const sub = new ImageData(w, h); for (let y = 0; y < h; y++) sub.data.set(img.data.subarray(((y + lim.y) * d.w + lim.x) * 4, ((y + lim.y) * d.w + lim.x + w) * 4), y * w * 4);
    const seeds: Pt[] = []; for (let a = 0; a < 6; a++) seeds.push({ x: e.p.x - lim.x + Math.cos(a) * r * 0.5, y: e.p.y - lim.y + Math.sin(a) * r * 0.5 }); seeds.push({ x: e.p.x - lim.x, y: e.p.y - lim.y });
    const m = Sel.colorMask(sub, seeds, Math.max(18, app.opts.tolerance), true, true);
    const shape = Sel.blankMask(d.w, d.h); ctx2d(shape).drawImage(Sel.writeChannel(m, w, h), lim.x, lim.y);
    const op = (ts as any).qsOp as Sel.SelOp;
    d.s.selection = Sel.combine(d.s.selection, shape, op === 'new' && ts.pts.length > 1 ? 'add' : op, d.w, d.h);
    ts.pts.push(e.p); v.overlay();
  },
  up(d) { ts.pts = []; (ts as any).qsContinue = true; if (d.s.selection && Sel.isEmpty(d.s.selection)) d.s.selection = null; d.commit('Quick Selection'); app.emit(); },
  cursor: () => 'none',
};
const objectSelect: Handler = {
  down(_d, e) { ts.drag = e.p; ts.cur = e.p; },
  move(_d, e, v) { ts.cur = e.p; v.overlay(); },
  up(d, e) {
    const a = ts.drag!; ts.drag = null; const r = rectIntersect(rectFromPts(a, e.p), { x: 0, y: 0, w: d.w, h: d.h });
    if (!r || r.w < 8 || r.h < 8) { void run('selectSubject'); return; }
    const img = ctx2d(flatten(d)).getImageData(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h));
    const m = Sel.selectSubject(img), shape = Sel.blankMask(d.w, d.h); ctx2d(shape).drawImage(Sel.writeChannel(m, img.width, img.height), Math.round(r.x), Math.round(r.y));
    applySelection(d, Sel.featherMask(shape, 1), selOpFrom(e), 'Object Selection');
  },
  overlay: (x, d, v) => marquee.overlay!(x, d, v),
  cursor: () => 'crosshair',
};

// ---------- move ----------
function pickLayerAt(d: Doc, p: Pt): Layer | null {
  const all = flatLayers(d.layers).filter((l) => l.visible && l.kind !== 'group' && l.kind !== 'adjustment').reverse();
  for (const l of all) {
    const c = layerContent(d, l); if (!c) continue;
    const x = Math.floor(p.x - c.x), y = Math.floor(p.y - c.y);
    if (x < 0 || y < 0 || x >= c.canvas.width || y >= c.canvas.height) continue;
    if (ctx2d(c.canvas).getImageData(x, y, 1, 1).data[3] > 10) return l;
  }
  return null;
}
const move: Handler = {
  down(d, e) {
    if (ts.transform) return transformTool.down!(d, e, null as any);
    if (app.opts.autoSelect || e.ctrl) { const l = pickLayerAt(d, e.p); if (l) { let target = l; if (app.opts.autoSelectGroups) { let p = d.parentOf(l.id); while (p?.parent) { target = p.parent; p = d.parentOf(p.parent.id); } } d.setActive(target.id, e.shift); app.emit(); } }
    const ls = d.selectedLayers().filter((l) => !l.locks.position && !l.locks.all);
    // linked layers move together
    const linked = new Set(ls.map((l) => l.linkId).filter(Boolean));
    if (linked.size) flatLayers(d.layers).forEach((l) => { if (l.linkId && linked.has(l.linkId) && !ls.includes(l)) ls.push(l); });
    if (!ls.length) { const l = d.active; if (l && (l.locks.position || l.locks.all)) app.toast(`"${l.name}" is locked for moving.`); return; }
    const l = d.active!;
    if (d.s.selection && l.kind === 'raster' && !app.editMask) {
      const c = d.editable(l), float = makeCanvas(c.width, c.height), fx = ctx2d(float);
      fx.drawImage(c, 0, 0); fx.globalCompositeOperation = 'destination-in'; fx.drawImage(Sel.maskToAlpha(d.s.selection), -l.x, -l.y);
      const base = cloneCanvas(c), bx = ctx2d(base); bx.globalCompositeOperation = 'destination-out'; bx.drawImage(Sel.maskToAlpha(d.s.selection), -l.x, -l.y);
      if (e.alt) { bx.globalCompositeOperation = 'source-over'; bx.drawImage(c, 0, 0); }
      ts.moveStart = { p: e.p, float, base, layer: l, sel: d.s.selection, last: { x: 0, y: 0 } };
    } else ts.moveStart = { p: e.p, layers: ls, last: { x: 0, y: 0 }, dup: e.alt };
    if (e.alt && !d.s.selection) { void run('duplicateLayer'); ts.moveStart.layers = d.selectedLayers(); }
  },
  move(d, e, v) {
    if (ts.transform) return transformTool.move!(d, e, v);
    const m = ts.moveStart; if (!m) return;
    let dx = Math.round(e.p.x - m.p.x), dy = Math.round(e.p.y - m.p.y);
    if (e.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    if (app.view.snap && m.layers) { const b = layerBounds(d, m.layers[0]); if (b) { const s = snapRect(d, { ...b, x: b.x + dx - m.last.x, y: b.y + dy - m.last.y }, v); dx += s.x; dy += s.y; } }
    if (m.float) {
      const c = m.layer.canvas as Canvas, x = ctx2d(c); x.save(); x.globalCompositeOperation = 'copy'; x.drawImage(m.base, 0, 0); x.restore(); x.drawImage(m.float, dx, dy); m.layer.ver++;
      const s = Sel.blankMask(d.w, d.h); ctx2d(s).drawImage(m.sel, dx, dy); d.s.selection = s;
    } else for (const l of m.layers as Layer[]) offsetLayer(l, dx - m.last.x, dy - m.last.y);
    m.last = { x: dx, y: dy };
    ts.info = `ΔX: ${dx} px  ΔY: ${dy} px`;
    d.touch(); v.redraw(null);
  },
  up(d, e, v) {
    if (ts.transform) return transformTool.up!(d, e, v);
    if (!ts.moveStart) return; const moved = ts.moveStart.last.x || ts.moveStart.last.y; ts.moveStart = null;
    if (moved) { clearCaches(); d.commit('Move'); } app.emit();
  },
  key(d, e, v) {
    if (ts.transform) return transformTool.key!(d, e, v);
    const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]; if (!k) return false;
    const n = e.shiftKey ? 10 : 1;
    for (const l of d.selectedLayers()) if (!l.locks.position && !l.locks.all) offsetLayer(l, k[0] * n, k[1] * n);
    clearCaches(); d.commit('Nudge'); app.emit(); return true;
  },
  overlay(x, d, v) {
    if (ts.transform) return transformTool.overlay!(x, d, v);
    if (!app.opts.showTransform) return;
    const l = d.active; if (!l) return; const b = layerBounds(d, l); if (!b) return;
    const a = v.toScreen({ x: b.x, y: b.y }), c = v.toScreen({ x: b.x + b.w, y: b.y + b.h });
    x.save(); x.strokeStyle = '#6c7cff'; x.lineWidth = 1; x.strokeRect(a.x, a.y, c.x - a.x, c.y - a.y); x.restore();
  },
  cursor: () => 'default',
};
function snapRect(d: Doc, r: Rect, v: ViewApi): Pt {
  const th = 6 / v.zoom; let sx = 0, sy = 0, bx = th, by = th;
  const xs = [0, d.w / 2, d.w, ...d.s.guides.filter((g) => g.axis === 'v').map((g) => g.pos)], ys = [0, d.h / 2, d.h, ...d.s.guides.filter((g) => g.axis === 'h').map((g) => g.pos)];
  for (const t of xs) for (const e of [r.x, r.x + r.w / 2, r.x + r.w]) if (Math.abs(t - e) < bx) { bx = Math.abs(t - e); sx = t - e; }
  for (const t of ys) for (const e of [r.y, r.y + r.h / 2, r.y + r.h]) if (Math.abs(t - e) < by) { by = Math.abs(t - e); sy = t - e; }
  return { x: Math.round(sx), y: Math.round(sy) };
}

// ---------- free transform ----------
export interface TransformSession {
  mode: 'free' | 'warp' | 'perspective' | 'distort' | 'skew'; target: 'layer' | 'selection';
  layer: Layer | null; orig: { canvas: Canvas; x: number; y: number } | null; origLayer: Layer | null;
  rect: Rect; quad: Quad; warp: Pt[] | null; handle: string | null; start: any; origSel: Canvas | null;
}
export function startTransform(d: Doc, mode: TransformSession['mode'] = 'free', target: 'layer' | 'selection' = 'layer') {
  if (ts.transform) return;
  let rect: Rect | null, layer: Layer | null = null, orig: TransformSession['orig'] = null;
  if (target === 'selection') { if (!d.s.selection) { app.toast('Make a selection first.'); return; } rect = Sel.maskBounds(d.s.selection); }
  else {
    layer = d.active; if (!layer) return;
    if (layer.locks.all || layer.locks.position) { app.toast('That layer is locked.'); return; }
    if (layer.kind === 'adjustment') { app.toast('Adjustment layers have nothing to transform.'); return; }
    if (layer.kind === 'group' || layer.kind === 'fill') { app.toast('Transforming groups and fill layers is not supported yet. Convert to a smart object first.'); return; }
    if (layer.kind === 'raster' && d.s.selection) {
      // float the selected pixels into their own layer, then transform that
      void run('layerViaCopy', true); layer = d.active!;
    }
    if (layer.kind === 'raster') { const c = layerContent(d, layer)!; const b = Sel.maskBounds(alphaAsGray(c.canvas)); if (!b) return; const t = makeCanvas(b.w, b.h); ctx2d(t).drawImage(c.canvas, -b.x, -b.y); orig = { canvas: t, x: c.x + b.x, y: c.y + b.y }; rect = { x: orig.x, y: orig.y, w: b.w, h: b.h }; }
    else if (layer.kind === 'smart') { const q = layer.smart!.quad; rect = { x: q[0].x, y: q[0].y, w: q[1].x - q[0].x, h: q[3].y - q[0].y }; }
    else rect = layerBounds(d, layer);
  }
  if (!rect) return;
  const quad: Quad = layer?.kind === 'smart' ? layer.smart!.quad.map((p) => ({ ...p })) as Quad : [{ x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y }, { x: rect.x + rect.w, y: rect.y + rect.h }, { x: rect.x, y: rect.y + rect.h }];
  ts.transform = { mode, target, layer, orig, origLayer: layer ? JSON.parse(JSON.stringify({ ...layer, canvas: null, mask: null, smart: layer.smart ? { ...layer.smart, source: null } : undefined })) : null, rect, quad, warp: mode === 'warp' ? patchFromRect(rect) : null, handle: null, start: null, origSel: d.s.selection };
  app.emit();
}
function alphaAsGray(c: Canvas) { const d = getData(c), o = new ImageData(c.width, c.height); for (let i = 0; i < d.data.length; i += 4) { o.data[i] = o.data[i + 1] = o.data[i + 2] = d.data[i + 3]; o.data[i + 3] = 255; } const m = makeCanvas(c.width, c.height); ctx2d(m).putImageData(o, 0, 0); return m; }
function applyTransformPreview(d: Doc, v: ViewApi | null) {
  const t = ts.transform!; const q = t.quad;
  const fromRect = (p: Pt): Pt => { // affine approx (exact for affine quads) mapping original rect to quad
    const u = (p.x - t.rect.x) / t.rect.w, w = (p.y - t.rect.y) / t.rect.h;
    const top = { x: q[0].x + (q[1].x - q[0].x) * u, y: q[0].y + (q[1].y - q[0].y) * u }, bot = { x: q[3].x + (q[2].x - q[3].x) * u, y: q[3].y + (q[2].y - q[3].y) * u };
    return { x: top.x + (bot.x - top.x) * w, y: top.y + (bot.y - top.y) * w };
  };
  if (t.target === 'selection') {
    const src = makeCanvas(t.rect.w, t.rect.h); ctx2d(src).drawImage(t.origSel!, -t.rect.x, -t.rect.y);
    const r = t.warp ? warpRender(src, t.warp) : renderQuad(src, q); const m = Sel.blankMask(d.w, d.h); ctx2d(m).drawImage(r.canvas, r.x, r.y); d.s.selection = m;
  } else {
    const l = t.layer!;
    if (l.kind === 'raster' && t.orig) { const r = t.warp ? warpRender(t.orig.canvas, t.warp) : renderQuad(t.orig.canvas, q); l.canvas = r.canvas; l.x = r.x; l.y = r.y; }
    else if (l.kind === 'smart') { if (!t.warp) l.smart!.quad = q.map((p) => ({ ...p })) as Quad; }
    else if (l.kind === 'shape') { const o = t.origLayer!.shape!; l.shape!.path = V.mapPath(o.path, (x, y) => { const p = fromRect({ x, y }); return [p.x, p.y]; }); }
    else if (l.kind === 'text') {
      const o = t.origLayer!.text!; const a = (q[1].x - q[0].x) / t.rect.w, b = (q[1].y - q[0].y) / t.rect.w, c = (q[3].x - q[0].x) / t.rect.h, dd = (q[3].y - q[0].y) / t.rect.h;
      const m0 = new DOMMatrix([...o.matrix]); const T = new DOMMatrix([a, b, c, dd, q[0].x - a * t.rect.x - c * t.rect.y, q[0].y - b * t.rect.x - dd * t.rect.y]).multiply(m0);
      l.text!.matrix = [T.a, T.b, T.c, T.d, T.e, T.f];
    }
    l.ver++;
  }
  d.touch(); v?.redraw(null);
}
function warpRender(src: Canvas, cp: Pt[]) {
  const xs = cp.map((p) => p.x), ys = cp.map((p) => p.y); const x0 = Math.floor(Math.min(...xs)) - 2, y0 = Math.floor(Math.min(...ys)) - 2;
  const c = makeCanvas(Math.ceil(Math.max(...xs)) - x0 + 4, Math.ceil(Math.max(...ys)) - y0 + 4), x = ctx2d(c); x.translate(-x0, -y0);
  meshWarp(x, src, bezierPatch(cp), 20); return { canvas: c, x: x0, y: y0 };
}
export function refreshTransform(d: Doc) { if (ts.transform) applyTransformPreview(d, (window as any).__monsoonView || null); }
export function commitTransform(d: Doc) { const t = ts.transform; if (!t) return; ts.transform = null; clearCaches(); d.commit(t.mode === 'warp' ? 'Warp' : 'Free Transform'); app.emit(); }
export function cancelTransform(d: Doc) {
  const t = ts.transform; if (!t) return; ts.transform = null;
  d.goto(d.hIndex); clearCaches(); app.emit();
}
export function transformBy(d: Doc, op: 'flipH' | 'flipV' | 'rot90' | 'rot-90' | 'rot180') {
  const t = ts.transform; if (!t) return;
  const q = t.quad, cx = (q[0].x + q[2].x) / 2, cy = (q[0].y + q[2].y) / 2;
  if (op === 'flipH') t.quad = [q[1], q[0], q[3], q[2]];
  else if (op === 'flipV') t.quad = [q[3], q[2], q[1], q[0]];
  else { const a = op === 'rot90' ? Math.PI / 2 : op === 'rot-90' ? -Math.PI / 2 : Math.PI; t.quad = q.map((p) => ({ x: cx + (p.x - cx) * Math.cos(a) - (p.y - cy) * Math.sin(a), y: cy + (p.x - cx) * Math.sin(a) + (p.y - cy) * Math.cos(a) })) as Quad; }
  applyTransformPreview(d, null); app.emit();
}
function handlesOf(t: TransformSession): [string, Pt][] {
  const q = t.quad, mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  if (t.warp) return t.warp.map((p, i) => ['w' + i, p] as [string, Pt]);
  return [['tl', q[0]], ['tr', q[1]], ['br', q[2]], ['bl', q[3]], ['t', mid(q[0], q[1])], ['r', mid(q[1], q[2])], ['b', mid(q[2], q[3])], ['l', mid(q[3], q[0])]];
}
function insideQuad(q: Quad, p: Pt) { let c = false; for (let i = 0, j = 3; i < 4; j = i++) { const a = q[i], b = q[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; }
export const transformTool: Handler = {
  down(d, e, v) {
    const t = ts.transform; if (!t) return;
    const vz = (window as any).__monsoonView as ViewApi;
    const near = handlesOf(t).find(([, p]) => { const s = vz.toScreen(p), r = vz.toScreen(e.p); return Math.hypot(s.x - r.x, s.y - r.y) < 10; });
    const c = { x: (t.quad[0].x + t.quad[2].x) / 2, y: (t.quad[0].y + t.quad[2].y) / 2 };
    t.handle = near ? near[0] : insideQuad(t.quad, e.p) ? 'move' : 'rotate';
    t.start = { p: e.p, quad: t.quad.map((q) => ({ ...q })), warp: t.warp?.map((q) => ({ ...q })), c, ang: Math.atan2(e.p.y - c.y, e.p.x - c.x) };
    void v;
  },
  move(d, e, v) {
    const t = ts.transform; if (!t || !t.handle || !t.start) return;
    const s = t.start, dx = e.p.x - s.p.x, dy = e.p.y - s.p.y, q = s.quad.map((p: Pt) => ({ ...p })) as Quad;
    if (t.handle.startsWith('w')) { const i = +t.handle.slice(1); t.warp = s.warp.map((p: Pt, k: number) => (k === i ? { x: p.x + dx, y: p.y + dy } : p)); }
    else if (t.handle === 'move') { if (t.warp) t.warp = s.warp.map((p: Pt) => ({ x: p.x + dx, y: p.y + dy })); else t.quad = q.map((p) => ({ x: p.x + dx, y: p.y + dy })) as Quad; }
    else if (t.handle === 'rotate') {
      let a = Math.atan2(e.p.y - s.c.y, e.p.x - s.c.x) - s.ang; if (e.shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      t.quad = q.map((p) => ({ x: s.c.x + (p.x - s.c.x) * Math.cos(a) - (p.y - s.c.y) * Math.sin(a), y: s.c.y + (p.x - s.c.x) * Math.sin(a) + (p.y - s.c.y) * Math.cos(a) })) as Quad;
      ts.info = `Angle: ${((a * 180) / Math.PI).toFixed(1)}°`;
    } else {
      const corner = ['tl', 'tr', 'br', 'bl'].indexOf(t.handle);
      const mode = e.ctrl ? 'distort' : t.mode;
      if (corner >= 0 && (mode === 'distort' || mode === 'perspective')) {
        q[corner] = { x: q[corner].x + dx, y: q[corner].y + dy };
        if (mode === 'perspective') { const pair = [1, 0, 3, 2][corner]; q[pair] = { x: q[pair].x - dx, y: q[pair].y + dy }; }
        t.quad = q;
      } else if (mode === 'skew' && corner < 0) {
        const edge = { t: [0, 1], b: [3, 2], l: [0, 3], r: [1, 2] }[t.handle as 't' | 'b' | 'l' | 'r']; const horiz = t.handle === 't' || t.handle === 'b';
        for (const i of edge) q[i] = horiz ? { x: q[i].x + dx, y: q[i].y } : { x: q[i].x, y: q[i].y + dy }; t.quad = q;
      } else {
        // scale in the quad's local frame (supports rotated quads)
        const ux = { x: q[1].x - q[0].x, y: q[1].y - q[0].y }, uy = { x: q[3].x - q[0].x, y: q[3].y - q[0].y };
        const W = Math.hypot(ux.x, ux.y) || 1, H = Math.hypot(uy.x, uy.y) || 1, ex = { x: ux.x / W, y: ux.y / W }, ey = { x: uy.x / H, y: uy.y / H };
        const lx = dx * ex.x + dy * ex.y, ly = dx * ey.x + dy * ey.y;
        let sl = 0, sr = 0, st = 0, sb = 0;
        if (/l/.test(t.handle)) sl = lx; if (/r/.test(t.handle)) sr = lx; if (/^t|tl|tr/.test(t.handle)) st = ly; if (/^b|bl|br/.test(t.handle)) sb = ly;
        let nW = W - sl + sr, nH = H - st + sb;
        const proportional = (e.shift !== !!(app as any).proportionalDefault) && corner >= 0;
        if (proportional) { const k = Math.abs(nW / W) > Math.abs(nH / H) ? nW / W : nH / H; const nW2 = W * k, nH2 = H * k; if (sl) sl = W - nW2; else sr = nW2 - W; if (st) st = H - nH2; else sb = nH2 - H; nW = nW2; nH = nH2; }
        if (e.alt) { const cw = (nW - W) / 2, ch = (nH - H) / 2; sl = -cw; sr = cw; st = -ch; sb = ch; }
        const o = { x: q[0].x + ex.x * sl + ey.x * st, y: q[0].y + ex.y * sl + ey.y * st };
        const nWf = W - sl + sr, nHf = H - st + sb;
        t.quad = [o, { x: o.x + ex.x * nWf, y: o.y + ex.y * nWf }, { x: o.x + ex.x * nWf + ey.x * nHf, y: o.y + ex.y * nWf + ey.y * nHf }, { x: o.x + ey.x * nHf, y: o.y + ey.y * nHf }];
        ts.info = `W: ${((nWf / t.rect.w) * 100).toFixed(1)}%  H: ${((nHf / t.rect.h) * 100).toFixed(1)}%`;
      }
    }
    applyTransformPreview(d, v);
  },
  up(_d, _e, _v) { const t = ts.transform; if (t) { t.handle = null; t.start = null; app.emit(); } },
  key(d, e) { if (e.key === 'Enter') { commitTransform(d); return true; } if (e.key === 'Escape') { cancelTransform(d); return true; } return false; },
  overlay(x, _d, v) {
    const t = ts.transform; if (!t) return;
    x.save(); x.strokeStyle = '#6c7cff'; x.lineWidth = 1.2;
    if (t.warp) {
      const f = bezierPatch(t.warp); x.beginPath();
      for (let i = 0; i <= 3; i++) for (let k = 0; k <= 20; k++) { const s = v.toScreen(f(i / 3, k / 20)); k ? x.lineTo(s.x, s.y) : x.moveTo(s.x, s.y); }
      for (let j = 0; j <= 3; j++) for (let k = 0; k <= 20; k++) { const s = v.toScreen(f(k / 20, j / 3)); k ? x.lineTo(s.x, s.y) : x.moveTo(s.x, s.y); }
      x.stroke();
    } else { x.beginPath(); t.quad.forEach((p, i) => { const s = v.toScreen(p); i ? x.lineTo(s.x, s.y) : x.moveTo(s.x, s.y); }); x.closePath(); x.stroke(); }
    for (const [, p] of handlesOf(t)) { const s = v.toScreen(p); x.fillStyle = '#fff'; x.fillRect(s.x - 4, s.y - 4, 8, 8); x.strokeRect(s.x - 4, s.y - 4, 8, 8); }
    const c = v.toScreen({ x: (t.quad[0].x + t.quad[2].x) / 2, y: (t.quad[0].y + t.quad[2].y) / 2 }); x.beginPath(); x.arc(c.x, c.y, 4, 0, 7); x.stroke();
    x.restore();
  },
  cursor: () => 'default',
};

// ---------- crop ----------
const RATIOS: Record<string, number> = { free: 0, '1:1': 1, '4:5': 4 / 5, '5:7': 5 / 7, '2:3': 2 / 3, '3:2': 3 / 2, '16:9': 16 / 9, '9:16': 9 / 16, '4:3': 4 / 3 };
export function startCrop(d: Doc) { ts.crop = { r: { x: 0, y: 0, w: d.w, h: d.h }, angle: 0, handle: null }; app.emit(); }
export function commitCrop(d: Doc) { const c = ts.crop; if (!c) return; ts.crop = null; cropDoc(d, c.r, app.opts.cropDelete, c.angle); }
const crop: Handler = {
  down(d, e, v) {
    if (!ts.crop) startCrop(d);
    const c = ts.crop!, r = c.r, s = v.toScreen(e.p);
    const hs: [string, Pt][] = [['tl', { x: r.x, y: r.y }], ['tr', { x: r.x + r.w, y: r.y }], ['bl', { x: r.x, y: r.y + r.h }], ['br', { x: r.x + r.w, y: r.y + r.h }], ['t', { x: r.x + r.w / 2, y: r.y }], ['b', { x: r.x + r.w / 2, y: r.y + r.h }], ['l', { x: r.x, y: r.y + r.h / 2 }], ['r', { x: r.x + r.w, y: r.y + r.h / 2 }]];
    const h = hs.find(([, p]) => { const q = v.toScreen(p); return Math.hypot(q.x - s.x, q.y - s.y) < 12; });
    const inside = e.p.x > r.x && e.p.x < r.x + r.w && e.p.y > r.y && e.p.y < r.y + r.h;
    c.handle = h ? h[0] : inside ? 'move' : e.ctrl ? 'new' : 'rotate';
    if (c.handle === 'rotate' && (e.p.x < -20 / v.zoom || e.p.y < -20 / v.zoom || e.p.x > d.w + 20 / v.zoom || e.p.y > d.h + 20 / v.zoom || true)) { /* rotate outside the box */ }
    c.start = { r: { ...r }, p: e.p, angle: c.angle };
  },
  move(_d, e, v) {
    const c = ts.crop; if (!c?.handle || !c.start) return;
    const s = c.start, dx = e.p.x - s.p.x, dy = e.p.y - s.p.y; let r = { ...s.r };
    if (c.handle === 'move') { r.x += dx; r.y += dy; }
    else if (c.handle === 'rotate') { const cx = r.x + r.w / 2, cy = r.y + r.h / 2; const a0 = Math.atan2(s.p.y - cy, s.p.x - cx), a1 = Math.atan2(e.p.y - cy, e.p.x - cx); c.angle = s.angle + ((a1 - a0) * 180) / Math.PI; ts.info = `Angle ${c.angle.toFixed(1)}°`; }
    else {
      if (/l/.test(c.handle)) { r.x += dx; r.w -= dx; } if (/r/.test(c.handle)) r.w += dx;
      if (/^t/.test(c.handle)) { r.y += dy; r.h -= dy; } if (/^b/.test(c.handle)) r.h += dy;
      const ratio = RATIOS[app.opts.cropRatio] || (e.shift ? s.r.w / s.r.h : 0);
      if (ratio) { if (c.handle === 't' || c.handle === 'b') r.w = r.h * ratio; else r.h = r.w / ratio; if (/^t/.test(c.handle)) r.y = s.r.y + s.r.h - r.h; }
      if (r.w < 0) { r.x += r.w; r.w = -r.w; } if (r.h < 0) { r.y += r.h; r.h = -r.h; }
      ts.info = `${Math.round(r.w)} × ${Math.round(r.h)} px`;
    }
    c.r = r; v.overlay();
  },
  up() { if (ts.crop) ts.crop.handle = null; app.emit(); },
  key(d, e) { if (e.key === 'Enter') { commitCrop(d); return true; } if (e.key === 'Escape') { ts.crop = null; app.emit(); return true; } return false; },
  overlay(x, d, v) {
    if (!ts.crop) return; const c = ts.crop, r = c.r;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, a = (c.angle * Math.PI) / 180;
    const P = (px: number, py: number) => v.toScreen({ x: px, y: py });
    x.save();
    // shade outside
    const dc = [P(0, 0), P(d.w, 0), P(d.w, d.h), P(0, d.h)];
    const rot = (px: number, py: number) => { const ux = px - cx, uy = py - cy; return P(cx + ux * Math.cos(-a) - uy * Math.sin(-a), cy + ux * Math.sin(-a) + uy * Math.cos(-a)); };
    const rc = [rot(r.x, r.y), rot(r.x + r.w, r.y), rot(r.x + r.w, r.y + r.h), rot(r.x, r.y + r.h)];
    x.beginPath(); dc.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.closePath(); rc.slice().reverse().forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.closePath();
    x.fillStyle = 'rgba(0,0,0,0.55)'; x.fill('evenodd');
    x.beginPath(); rc.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.closePath(); x.strokeStyle = '#fff'; x.lineWidth = 1; x.stroke();
    const ov = app.opts.cropOverlay; x.strokeStyle = 'rgba(255,255,255,0.5)';
    const lines = ov === 'thirds' ? [1 / 3, 2 / 3] : ov === 'grid' ? [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875] : ov === 'golden' ? [0.382, 0.618] : [];
    for (const t of lines) { const a1 = rot(r.x + r.w * t, r.y), b1 = rot(r.x + r.w * t, r.y + r.h), a2 = rot(r.x, r.y + r.h * t), b2 = rot(r.x + r.w, r.y + r.h * t); x.beginPath(); x.moveTo(a1.x, a1.y); x.lineTo(b1.x, b1.y); x.moveTo(a2.x, a2.y); x.lineTo(b2.x, b2.y); x.stroke(); }
    x.fillStyle = '#fff'; for (const p of [...rc, rot(cx, r.y), rot(cx, r.y + r.h), rot(r.x, cy), rot(r.x + r.w, cy)]) x.fillRect(p.x - 4, p.y - 4, 8, 8);
    x.restore();
  },
  cursor: () => 'crosshair',
};
const perspectiveCrop: Handler = {
  down(d, e, v) {
    if (!ts.pcrop) { ts.pcrop = [{ x: d.w * 0.1, y: d.h * 0.1 }, { x: d.w * 0.9, y: d.h * 0.1 }, { x: d.w * 0.9, y: d.h * 0.9 }, { x: d.w * 0.1, y: d.h * 0.9 }]; app.emit(); }
    const s = v.toScreen(e.p); ts.pcropHandle = ts.pcrop.findIndex((p) => { const q = v.toScreen(p); return Math.hypot(q.x - s.x, q.y - s.y) < 14; });
  },
  move(_d, e, v) { if (ts.pcrop && ts.pcropHandle >= 0) { ts.pcrop[ts.pcropHandle] = e.p; v.overlay(); } },
  up() { ts.pcropHandle = -1; },
  key(d, e) { if (e.key === 'Enter' && ts.pcrop) { commitPerspectiveCrop(d); return true; } if (e.key === 'Escape') { ts.pcrop = null; app.emit(); return true; } return false; },
  overlay(x, _d, v) {
    if (!ts.pcrop) return; x.save(); x.strokeStyle = '#fff'; x.lineWidth = 1.5; x.beginPath(); ts.pcrop.forEach((p, i) => { const s = v.toScreen(p); i ? x.lineTo(s.x, s.y) : x.moveTo(s.x, s.y); }); x.closePath(); x.stroke();
    x.fillStyle = '#6c7cff'; ts.pcrop.forEach((p) => { const s = v.toScreen(p); x.fillRect(s.x - 5, s.y - 5, 10, 10); }); x.restore();
  },
  cursor: () => 'crosshair',
};
export function commitPerspectiveCrop(d: Doc) {
  const q = ts.pcrop!; ts.pcrop = null;
  const w = Math.round((Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y) + Math.hypot(q[2].x - q[3].x, q[2].y - q[3].y)) / 2);
  const h = Math.round((Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y) + Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y)) / 2);
  void run('perspectiveCrop', { quad: q, w, h }); void d;
}

// ---------- sampling & measuring ----------
function sampleAt(d: Doc, p: Pt): string {
  const src = app.opts.eyedropperSample === 'all' ? flatten(d) : (() => { const l = d.active; return l ? renderLayerAlone(d, l, false) : flatten(d); })();
  const n = app.opts.eyedropperSize, r = Math.floor(n / 2), x0 = clamp(Math.floor(p.x) - r, 0, d.w - 1), y0 = clamp(Math.floor(p.y) - r, 0, d.h - 1);
  const dd = ctx2d(src).getImageData(x0, y0, Math.min(n, d.w - x0), Math.min(n, d.h - y0)).data; let R = 0, G = 0, B = 0, k = 0;
  for (let i = 0; i < dd.length; i += 4) { R += dd[i]; G += dd[i + 1]; B += dd[i + 2]; k++; }
  return rgbToHex({ r: R / k, g: G / k, b: B / k });
}
const eyedropper: Handler = {
  down(d, e) { const c = sampleAt(d, e.p); if (e.alt) app.bg = c; else app.fg = c; app.emit(); ts.drag = e.p; },
  move(d, e) { if (!ts.drag) return; const c = sampleAt(d, e.p); if (e.alt) app.bg = c; else app.fg = c; app.emit(); },
  up() { ts.drag = null; },
  cursor: () => 'crosshair',
};
const sampler: Handler = {
  down(d, e) { if (e.alt) { d.s.samplers = d.s.samplers.filter((s) => Math.hypot(s.x - e.p.x, s.y - e.p.y) > 8); } else if (d.s.samplers.length < 10) d.s.samplers.push({ x: Math.floor(e.p.x), y: Math.floor(e.p.y) }); d.commit('Color Sampler'); app.emit(); },
  overlay(x, d, v) { d.s.samplers.forEach((s, i) => { const p = v.toScreen({ x: s.x + 0.5, y: s.y + 0.5 }); x.save(); x.strokeStyle = '#fff'; x.beginPath(); x.arc(p.x, p.y, 6, 0, 7); x.moveTo(p.x - 10, p.y); x.lineTo(p.x + 10, p.y); x.moveTo(p.x, p.y - 10); x.lineTo(p.x, p.y + 10); x.stroke(); x.fillStyle = '#fff'; x.font = '11px sans-serif'; x.fillText(String(i + 1), p.x + 8, p.y - 8); x.restore(); }); },
  cursor: () => 'crosshair',
};
const ruler: Handler = {
  down(_d, e) { ts.ruler = [e.p, e.p]; },
  move(_d, e, v) { if (!ts.ruler || !ts.drag && ts.ruler[0] === ts.ruler[1] && false) return; if (ts.ruler) { let p = e.p; if (e.shift) { const a = Math.round(Math.atan2(p.y - ts.ruler[0].y, p.x - ts.ruler[0].x) / (Math.PI / 4)) * (Math.PI / 4), l = Math.hypot(p.x - ts.ruler[0].x, p.y - ts.ruler[0].y); p = { x: ts.ruler[0].x + Math.cos(a) * l, y: ts.ruler[0].y + Math.sin(a) * l }; } ts.ruler[1] = p; const [a, b] = ts.ruler; ts.info = `L: ${Math.hypot(b.x - a.x, b.y - a.y).toFixed(1)} px  A: ${(-Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI).toFixed(1)}°`; v.overlay(); } },
  up() { app.emit(); },
  overlay(x, _d, v) { if (!ts.ruler) return; const a = v.toScreen(ts.ruler[0]), b = v.toScreen(ts.ruler[1]); x.save(); x.strokeStyle = '#fff'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); x.strokeStyle = '#000'; x.setLineDash([3, 3]); x.stroke(); x.restore(); },
  cursor: () => 'crosshair',
};
export function straightenFromRuler() {
  const d = requireDoc(); if (!ts.ruler) return; const [a, b] = ts.ruler; let ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  if (Math.abs(ang) > 45) ang = ang > 0 ? ang - 90 : ang + 90;
  ts.ruler = null; void run('rotateCanvas', { deg: -ang });
}
const note: Handler = {
  down(d, e) { const hit = d.s.notes.find((n) => Math.hypot(n.x - e.p.x, n.y - e.p.y) < 14); const text = prompt(hit ? 'Edit note (leave empty to delete)' : 'Note', hit?.text || ''); if (text === null) return; if (hit) { if (!text) d.s.notes = d.s.notes.filter((n) => n !== hit); else hit.text = text; } else if (text) d.s.notes.push({ id: String(Date.now()), x: e.p.x, y: e.p.y, text, author: app.opts.noteAuthor, color: app.opts.noteColor }); d.commit('Note'); app.emit(); },
  overlay(x, d, v) { if (!app.view.extras) return; for (const n of d.s.notes) { const p = v.toScreen(n); x.save(); x.fillStyle = n.color; x.strokeStyle = '#333'; x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(p.x + 16, p.y); x.lineTo(p.x + 16, p.y + 12); x.lineTo(p.x + 6, p.y + 12); x.lineTo(p.x, p.y + 18); x.closePath(); x.fill(); x.stroke(); x.restore(); } },
  cursor: () => 'copy',
};
const count: Handler = {
  down(d, e) { if (e.alt) d.s.counts = d.s.counts.filter((c) => Math.hypot(c.x - e.p.x, c.y - e.p.y) > 10); else d.s.counts.push({ x: e.p.x, y: e.p.y }); d.commit('Count'); app.emit(); },
  overlay(x, d, v) { d.s.counts.forEach((c, i) => { const p = v.toScreen(c); x.save(); x.fillStyle = '#00d0ff'; x.font = 'bold 13px sans-serif'; x.beginPath(); x.arc(p.x, p.y, 3, 0, 7); x.fill(); x.fillText(String(i + 1), p.x + 5, p.y - 5); x.restore(); }); },
  cursor: () => 'crosshair',
};

// ---------- retouch ----------
const patch: Handler = {
  down(d, e, v) { if (d.s.selection && inSel(d, e.p)) { ts.moveStart = { p: e.p, sel: d.s.selection }; return; } lasso.down!(d, e, v); },
  move(d, e, v) { if (ts.moveStart) { ts.cur = e.p; v.overlay(); return; } lasso.move!(d, e, v); },
  up(d, e, v) {
    if (!ts.moveStart) return lasso.up!(d, e, v);
    const m = ts.moveStart; ts.moveStart = null; ts.cur = null; const dx = Math.round(e.p.x - m.p.x), dy = Math.round(e.p.y - m.p.y);
    if (!dx && !dy) return;
    const t = paintTarget(d); if (!t) return;
    const sel = m.sel as Canvas, sb = Sel.maskBounds(sel)!; const pad = 12;
    const content = app.tool === 'content-move';
    const R0 = { x: Math.min(sb.x, sb.x + dx) - pad, y: Math.min(sb.y, sb.y + dy) - pad, w: sb.w + Math.abs(dx) + pad * 2, h: sb.h + Math.abs(dy) + pad * 2 };
    const r = rectIntersect({ x: R0.x - t.ox, y: R0.y - t.oy, w: R0.w, h: R0.h }, { x: 0, y: 0, w: t.canvas.width, h: t.canvas.height })!;
    const x = ctx2d(t.canvas), orig = x.getImageData(r.x, r.y, r.w, r.h);
    const selD = ctx2d(sel).getImageData(r.x + t.ox, r.y + t.oy, r.w, r.h).data;
    const shifted = makeCanvas(d.w, d.h); ctx2d(shifted).drawImage(sel, dx, dy); const shD = ctx2d(shifted).getImageData(r.x + t.ox, r.y + t.oy, r.w, r.h).data;
    if (content) {
      // move the selected pixels and synthesise the hole they leave
      const moved = new ImageData(new Uint8ClampedArray(orig.data), r.w, r.h);
      for (let y = 0; y < r.h; y++) for (let xx = 0; xx < r.w; xx++) { const sx = xx - dx, sy = y - dy; if (sx < 0 || sy < 0 || sx >= r.w || sy >= r.h) continue; const i = (y * r.w + xx) * 4, j = (sy * r.w + sx) * 4; const k = shD[i] / 255; if (k) for (let c = 0; c < 4; c++) moved.data[i + c] = orig.data[i + c] + (orig.data[j + c] - orig.data[i + c]) * k; }
      const hole = new Uint8Array(r.w * r.h); for (let i = 0; i < hole.length; i++) hole[i] = selD[i * 4] > 20 && shD[i * 4] < 128 ? 1 : 0;
      const filled = inpaint(moved, hole);
      x.putImageData(filled, r.x, r.y);
      d.s.selection = shifted; if (t.layer) t.layer.ver++; d.commit('Content-Aware Move'); app.emit(); return;
    }
    // patch: fill the selection with pixels from the dragged-to area (source mode) and heal
    const src = new ImageData(new Uint8ClampedArray(orig.data), r.w, r.h), from = app.opts.patchFrom === 'source';
    for (let y = 0; y < r.h; y++) for (let xx = 0; xx < r.w; xx++) {
      const sx = from ? xx + dx : xx - dx, sy = from ? y + dy : y - dy; if (sx < 0 || sy < 0 || sx >= r.w || sy >= r.h) continue;
      const i = (y * r.w + xx) * 4, j = (sy * r.w + sx) * 4; for (let c = 0; c < 4; c++) src.data[i + c] = orig.data[j + c];
    }
    const mk = new Float32Array(r.w * r.h); for (let i = 0; i < mk.length; i++) mk[i] = (from ? selD : shD)[i * 4] / 255;
    const target = from ? orig : orig;
    x.putImageData(app.opts.patchMode === 'content' ? inpaint(orig, Uint8Array.from(mk, (q) => (q > 0.1 ? 1 : 0))) : healBlend(target, src, mk), r.x, r.y);
    if (t.layer) t.layer.ver++; d.commit('Patch Tool'); app.emit();
  },
  overlay(x, d, v) {
    lasso.overlay!(x, d, v);
    if (ts.moveStart && ts.cur) { const dx = ts.cur.x - ts.moveStart.p.x, dy = ts.cur.y - ts.moveStart.p.y; const b = Sel.maskBounds(ts.moveStart.sel)!; const a = v.toScreen({ x: b.x + dx, y: b.y + dy }), c = v.toScreen({ x: b.x + b.w + dx, y: b.y + b.h + dy }); x.save(); x.setLineDash([4, 3]); x.strokeStyle = '#fff'; x.strokeRect(a.x, a.y, c.x - a.x, c.y - a.y); x.restore(); }
  },
  cursor: () => 'crosshair',
};
const redEyeTool: Handler = {
  down(_d, e) { ts.drag = e.p; ts.cur = e.p; },
  move(_d, e, v) { ts.cur = e.p; v.overlay(); },
  up(d, e) {
    const a = ts.drag!; ts.drag = null; let r = rectFromPts(a, e.p); if (r.w < 4) { const s = Math.max(20, Math.min(d.w, d.h) / 25); r = { x: e.p.x - s, y: e.p.y - s, w: s * 2, h: s * 2 }; }
    const t = paintTarget(d); if (!t) return; const R0 = rectIntersect({ x: Math.round(r.x - t.ox), y: Math.round(r.y - t.oy), w: Math.round(r.w), h: Math.round(r.h) }, { x: 0, y: 0, w: t.canvas.width, h: t.canvas.height }); if (!R0) return;
    const img = ctx2d(t.canvas).getImageData(R0.x, R0.y, R0.w, R0.h); redEye(img); ctx2d(t.canvas).putImageData(img, R0.x, R0.y); if (t.layer) t.layer.ver++; d.commit('Red Eye'); app.emit();
  },
  overlay: (x, d, v) => marquee.overlay!(x, d, v),
  cursor: () => 'crosshair',
};
const magicEraser: Handler = {
  down(d, e) {
    const t = paintTarget(d); if (!t || t.kind !== 'layer') return;
    const img = app.opts.sampleAll ? getData(flatten(d)) : (() => { const full = makeCanvas(d.w, d.h); ctx2d(full).drawImage(t.canvas, t.ox, t.oy); return getData(full); })();
    const m = Sel.colorMask(img, [e.p], app.opts.tolerance, app.opts.contiguous, app.opts.antialias);
    const mc = Sel.writeChannel(m, d.w, d.h); const x = ctx2d(t.canvas);
    x.save(); x.globalCompositeOperation = 'destination-out'; x.drawImage(Sel.maskToAlpha(mc), -t.ox, -t.oy); x.restore();
    if (t.layer) { t.layer.ver++; if (t.layer.name === 'Background') t.layer.name = 'Layer 0'; t.layer.locks.transparency = false; }
    d.commit('Magic Eraser'); app.emit();
  },
  cursor: () => 'crosshair',
};

// ---------- fill tools ----------
const gradient: Handler = {
  down(_d, e) { ts.drag = e.p; ts.cur = e.p; },
  move(_d, e, v) { if (!ts.drag) return; let p = e.p; if (e.shift) { const a = Math.round(Math.atan2(p.y - ts.drag.y, p.x - ts.drag.x) / (Math.PI / 4)) * (Math.PI / 4), l = Math.hypot(p.x - ts.drag.x, p.y - ts.drag.y); p = { x: ts.drag.x + Math.cos(a) * l, y: ts.drag.y + Math.sin(a) * l }; } ts.cur = p; v.overlay(); },
  up(d, _e, v) {
    const a = ts.drag!, b = ts.cur!; ts.drag = null; ts.cur = null; if (Math.hypot(b.x - a.x, b.y - a.y) < 1) { v.overlay(); return; }
    const t = paintTarget(d); if (!t) return;
    const g = withFgBg(app.gradient, app.fg, app.bg);
    const img = renderGradient(t.canvas.width, t.canvas.height, g, app.opts.gradShape, { x: a.x - t.ox, y: a.y - t.oy }, { x: b.x - t.ox, y: b.y - t.oy }, app.opts.gradReverse, app.opts.gradDither);
    if (t.kind !== 'layer') for (let i = 0; i < img.data.length; i += 4) { const l = lum(img.data[i], img.data[i + 1], img.data[i + 2]); img.data[i] = img.data[i + 1] = img.data[i + 2] = l; }
    const gc = makeCanvas(t.canvas.width, t.canvas.height); ctx2d(gc).putImageData(img, 0, 0);
    if (d.s.selection && t.kind !== 'quickmask') { const x = ctx2d(gc); x.globalCompositeOperation = 'destination-in'; x.drawImage(Sel.maskToAlpha(d.s.selection), -t.ox, -t.oy); }
    if (t.layer?.locks.transparency && t.kind === 'layer') { const x = ctx2d(t.canvas); x.save(); x.globalAlpha = app.opts.gradOpacity; x.globalCompositeOperation = 'source-atop'; x.drawImage(gc, 0, 0); x.restore(); }
    else drawBlended(t.canvas, gc, 0, 0, app.opts.gradMode as any, app.opts.gradOpacity);
    if (t.layer) t.layer.ver++; d.commit('Gradient'); app.emit();
  },
  overlay(x, _d, v) { if (!ts.drag || !ts.cur) return; const a = v.toScreen(ts.drag), b = v.toScreen(ts.cur); x.save(); x.strokeStyle = '#fff'; x.lineWidth = 2; x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); x.strokeStyle = '#000'; x.lineWidth = 1; x.stroke(); for (const p of [a, b]) { x.fillStyle = '#fff'; x.beginPath(); x.arc(p.x, p.y, 4, 0, 7); x.fill(); x.stroke(); } x.restore(); },
  cursor: () => 'crosshair',
};
const bucket: Handler = {
  down(d, e) {
    const t = paintTarget(d); if (!t) return;
    const img = app.opts.sampleAll ? getData(flatten(d)) : (() => { const full = makeCanvas(d.w, d.h); ctx2d(full).drawImage(t.canvas, t.ox, t.oy); return getData(full); })();
    const m = Sel.colorMask(img, [e.p], app.opts.tolerance, app.opts.contiguous, app.opts.antialias);
    let mc = Sel.writeChannel(m, d.w, d.h); if (d.s.selection) mc = Sel.combine(d.s.selection, mc, 'intersect', d.w, d.h);
    const f = makeCanvas(t.canvas.width, t.canvas.height), fx = ctx2d(f);
    if (app.opts.bucketSource === 'pattern') { const { getPattern } = PAINT; fx.fillStyle = fx.createPattern(getPattern(app.pattern), 'repeat')!; } else fx.fillStyle = t.kind === 'layer' ? app.fg : (() => { const n = parseInt(app.fg.slice(1), 16); const v = Math.round(lum((n >> 16) & 255, (n >> 8) & 255, n & 255)); return `rgb(${v},${v},${v})`; })();
    fx.fillRect(0, 0, f.width, f.height); fx.globalCompositeOperation = 'destination-in'; fx.drawImage(Sel.maskToAlpha(mc), -t.ox, -t.oy);
    if (t.layer?.locks.transparency && t.kind === 'layer') { const x = ctx2d(t.canvas); x.save(); x.globalAlpha = app.brush.opacity; x.globalCompositeOperation = 'source-atop'; x.drawImage(f, 0, 0); x.restore(); }
    else drawBlended(t.canvas, f, 0, 0, app.brush.blend, app.brush.opacity);
    if (t.layer) t.layer.ver++; d.commit('Paint Bucket'); app.emit();
  },
  cursor: () => 'crosshair',
};
import * as PAINT from './engine/paint';

// ---------- vector: shapes, pen, path selection ----------
function shapeStyle() {
  const o = app.opts;
  return {
    fill: { type: o.shapeFillType === 'gradient' ? 'gradient' as const : o.shapeFillType, color: o.shapeFill, gradient: withFgBg(app.gradient, app.fg, app.bg), gradShape: 'linear' as const, angle: 90 },
    stroke: { enabled: o.shapeStrokeOn, color: o.shapeStroke, width: o.shapeStrokeWidth, align: o.shapeStrokeAlign, dash: o.shapeDash ? o.shapeDash.split(/[ ,]+/).map(Number).filter((n) => !isNaN(n)) : [], cap: 'butt' as CanvasLineCap, join: 'miter' as CanvasLineJoin },
  };
}
export function addVector(d: Doc, path: VectorPath, kind: string, rect?: Rect) {
  const mode = app.opts.shapeMode;
  if (mode === 'path') { let wp = d.s.paths.find((p) => p.work); if (!wp) { wp = { id: 'work', name: 'Work Path', path: { subpaths: [] }, work: true }; d.s.paths.push(wp); } wp.path.subpaths.push(...path.subpaths); d.commit('Work Path'); app.emit(); return; }
  if (mode === 'pixels') { const t = paintTarget(d); if (!t) return; const x = ctx2d(t.canvas); x.save(); x.translate(-t.ox, -t.oy); x.fillStyle = app.fg; x.globalAlpha = app.brush.opacity; x.fill(V.pathToPath2D(path)); x.restore(); if (t.layer) t.layer.ver++; d.commit(kind); app.emit(); return; }
  const st = shapeStyle();
  const l = newLayer('shape', d.uniqueName(kind), { shape: { path, fill: st.fill, stroke: st.stroke, meta: { kind, rect, radius: app.opts.radius, sides: app.opts.sides, star: app.opts.star } } });
  d.addLayer(l); d.commit('New ' + kind); app.emit();
}
const shapeTool: Handler = {
  down(_d, e) { ts.drag = e.p; ts.cur = e.p; },
  move(_d, e, v) { ts.cur = e.p; v.overlay(); },
  up(d, e, v) {
    const a = ts.drag!; ts.drag = null; ts.cur = null; const tool = app.tool, o = app.opts;
    if (tool === 'shape-line') { if (Math.hypot(e.p.x - a.x, e.p.y - a.y) < 1) return; addVector(d, V.linePath(a, e.p, o.lineWidth, o.arrowStart, o.arrowEnd), 'Line'); return; }
    let r = constrain(a, e.p, e);
    if (r.w < 2 || r.h < 2) { const s = Math.min(d.w, d.h) / 4; r = { x: e.p.x - s / 2, y: e.p.y - s / 2, w: s, h: s }; }
    const path = tool === 'shape-rect' ? V.rectPath(r, o.radius) : tool === 'shape-ellipse' ? V.ellipsePath(r) : tool === 'shape-triangle' ? V.trianglePath(r) : tool === 'shape-polygon' ? V.polygonPath(r, o.sides, o.star) : V.svgToPath(V.CUSTOM_SHAPES[o.customShape] || V.CUSTOM_SHAPES.Raindrop, r);
    const names: Record<string, string> = { 'shape-rect': 'Rectangle', 'shape-ellipse': 'Ellipse', 'shape-triangle': 'Triangle', 'shape-polygon': 'Polygon', 'shape-custom': o.customShape };
    addVector(d, path, names[tool], r); v.overlay();
  },
  overlay(x, _d, v) {
    if (!ts.drag || !ts.cur) return; const o = app.opts, tool = app.tool;
    let path: VectorPath;
    if (tool === 'shape-line') path = V.linePath(ts.drag, ts.cur, o.lineWidth, o.arrowStart, o.arrowEnd);
    else { const r = rectFromPts(ts.drag, ts.cur); path = tool === 'shape-rect' ? V.rectPath(r, o.radius) : tool === 'shape-ellipse' ? V.ellipsePath(r) : tool === 'shape-triangle' ? V.trianglePath(r) : tool === 'shape-polygon' ? V.polygonPath(r, o.sides, o.star) : V.svgToPath(V.CUSTOM_SHAPES[o.customShape] || '', r); }
    const sp = V.mapPath(path, (px, py) => { const s = v.toScreen({ x: px, y: py }); return [s.x, s.y]; });
    x.save(); x.fillStyle = o.shapeFillType === 'none' ? 'transparent' : o.shapeFill + '99'; x.fill(V.pathToPath2D(sp)); x.strokeStyle = '#6c7cff'; x.stroke(V.pathToPath2D(sp)); x.restore();
  },
  cursor: () => 'crosshair',
};
function catmull(pts: PathPoint[], closed: boolean) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p2 = pts[(i + 1) % n], p = pts[i];
    if (!closed && (i === 0 || i === n - 1)) { p.ix = p.x; p.iy = p.y; p.ox = p.x; p.oy = p.y; continue; }
    const tx = (p2.x - p0.x) / 6, ty = (p2.y - p0.y) / 6; p.ix = p.x - tx; p.iy = p.y - ty; p.ox = p.x + tx; p.oy = p.y + ty; p.smooth = true;
  }
}
export function finishPen(d: Doc, closed: boolean) {
  const pen = ts.pen; ts.pen = null; if (!pen || pen.pts.length < 2) { app.emit(); return; }
  addVector(d, { subpaths: [{ points: pen.pts, closed }] }, 'Shape');
}
const pen: Handler = {
  down(d, e, v) {
    if (!ts.pen) ts.pen = { pts: [], closed: false, target: app.opts.shapeMode === 'shape' ? 'shape' : 'path' };
    const pts = ts.pen.pts;
    if (pts.length > 1) { const s0 = v.toScreen(pts[0]), s1 = v.toScreen(e.p); if (Math.hypot(s0.x - s1.x, s0.y - s1.y) < 8) { finishPen(d, true); return; } }
    if (app.tool === 'freeform-pen') { ts.pen.pts = [V.pp(e.p.x, e.p.y)]; ts.drag = e.p; return; }
    pts.push(V.pp(e.p.x, e.p.y)); ts.penDrag = pts.length - 1;
    if (app.tool === 'curvature-pen') catmull(pts, false);
    v.overlay();
  },
  move(_d, e, v) {
    if (!ts.pen) return;
    if (app.tool === 'freeform-pen') { if (!ts.drag) return; const last = ts.pen.pts[ts.pen.pts.length - 1]; if (Math.hypot(e.p.x - last.x, e.p.y - last.y) > 6 / v.zoom) ts.pen.pts.push(V.pp(e.p.x, e.p.y)); v.overlay(); return; }
    if (ts.penDrag < 0 || app.tool === 'curvature-pen') return;
    const p = ts.pen.pts[ts.penDrag]; p.ox = e.p.x; p.oy = e.p.y; p.ix = 2 * p.x - e.p.x; p.iy = 2 * p.y - e.p.y; p.smooth = true; v.overlay();
  },
  hover(_d, e, v) { ts.hoverPt = e.p; if (ts.pen) v.overlay(); },
  up(d) { ts.penDrag = -1; if (app.tool === 'freeform-pen' && ts.pen) { ts.drag = null; catmull(ts.pen.pts, false); finishPen(d, false); } },
  key(d, e) { if (!ts.pen) return false; if (e.key === 'Enter') { finishPen(d, false); return true; } if (e.key === 'Escape') { ts.pen = null; app.emit(); return true; } if (e.key === 'Backspace') { ts.pen.pts.pop(); return true; } return false; },
  overlay(x, d, v) {
    drawPaths(x, d, v);
    if (!ts.pen || !ts.pen.pts.length) return;
    const sp = V.mapPath({ subpaths: [{ points: ts.pen.pts, closed: false }] }, (px, py) => { const s = v.toScreen({ x: px, y: py }); return [s.x, s.y]; });
    x.save(); x.strokeStyle = '#6c7cff'; x.lineWidth = 1.5; x.stroke(V.pathToPath2D(sp));
    if (ts.hoverPt && app.tool !== 'freeform-pen') { const a = v.toScreen(ts.pen.pts[ts.pen.pts.length - 1]), b = v.toScreen(ts.hoverPt); x.setLineDash([3, 3]); x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); x.setLineDash([]); }
    for (const p of sp.subpaths[0].points) { x.fillStyle = '#fff'; x.fillRect(p.x - 3, p.y - 3, 6, 6); x.strokeRect(p.x - 3, p.y - 3, 6, 6); if (p.smooth) { x.beginPath(); x.moveTo(p.ix, p.iy); x.lineTo(p.ox, p.oy); x.stroke(); } }
    x.restore();
  },
  cursor: () => 'crosshair',
};
/** Paths that the path tools can edit: the active shape layer, then the selected path. */
function editablePaths(d: Doc): { path: VectorPath; layer?: Layer }[] {
  const out: { path: VectorPath; layer?: Layer }[] = [];
  const l = d.active; if (l?.shape) out.push({ path: l.shape.path, layer: l });
  if (l?.vmask) out.push({ path: l.vmask.path, layer: l });
  const sel = (d as any).activePath ? d.s.paths.find((p) => p.id === (d as any).activePath) : d.s.paths.find((p) => p.work);
  if (sel) out.push({ path: sel.path });
  return out;
}
function drawPaths(x: Ctx, d: Doc, v: ViewApi) {
  for (const { path } of editablePaths(d)) {
    const sp = V.mapPath(path, (px, py) => { const s = v.toScreen({ x: px, y: py }); return [s.x, s.y]; });
    x.save(); x.strokeStyle = '#6c7cff'; x.lineWidth = 1; x.stroke(V.pathToPath2D(sp));
    if (app.tool === 'direct-select' || app.tool === 'add-anchor' || app.tool === 'delete-anchor' || app.tool === 'convert-point') for (const s of sp.subpaths) for (const p of s.points) {
      x.fillStyle = '#fff'; x.fillRect(p.x - 3, p.y - 3, 6, 6); x.strokeRect(p.x - 3, p.y - 3, 6, 6);
      if (p.smooth) { x.beginPath(); x.moveTo(p.ix, p.iy); x.lineTo(p.x, p.y); x.lineTo(p.ox, p.oy); x.stroke(); for (const [hx, hy] of [[p.ix, p.iy], [p.ox, p.oy]]) { x.beginPath(); x.arc(hx, hy, 3, 0, 7); x.fill(); x.stroke(); } }
    }
    x.restore();
  }
}
const pathSelect: Handler = {
  down(d, e, v) {
    const paths = editablePaths(d); if (!paths.length) return;
    if (app.tool === 'path-select') { ts.moveStart = { p: e.p, paths, last: { x: 0, y: 0 } }; return; }
    const s = v.toScreen(e.p);
    for (const ep of paths) ep.path.subpaths.forEach((sp, si) => sp.points.forEach((p, pi) => {
      for (const [part, px, py] of [['p', p.x, p.y], ['i', p.ix, p.iy], ['o', p.ox, p.oy]] as ['p' | 'i' | 'o', number, number][]) {
        const q = v.toScreen({ x: px, y: py }); if (Math.hypot(q.x - s.x, q.y - s.y) < 8 && !ts.directSel) ts.directSel = { pathRef: ep.path, sp: si, pt: pi, part };
      }
    }));
    if (ts.directSel) (ts.directSel as any).layer = paths.find((p) => p.path === ts.directSel!.pathRef)?.layer;
  },
  move(d, e, v) {
    if (ts.moveStart?.paths) { const dx = e.p.x - ts.moveStart.p.x, dy = e.p.y - ts.moveStart.p.y; for (const ep of ts.moveStart.paths) { const moved = V.mapPath(ep.path, (x, y) => [x + dx - ts.moveStart.last.x, y + dy - ts.moveStart.last.y]); ep.path.subpaths = moved.subpaths; if (ep.layer) ep.layer.ver++; } ts.moveStart.last = { x: dx, y: dy }; d.touch(); v.redraw(null); return; }
    const ds = ts.directSel; if (!ds) return; const p = ds.pathRef.subpaths[ds.sp].points[ds.pt];
    if (ds.part === 'p') { const dx = e.p.x - p.x, dy = e.p.y - p.y; p.x += dx; p.y += dy; p.ix += dx; p.iy += dy; p.ox += dx; p.oy += dy; }
    else if (ds.part === 'o') { p.ox = e.p.x; p.oy = e.p.y; if (p.smooth && !e.alt) { p.ix = 2 * p.x - p.ox; p.iy = 2 * p.y - p.oy; } }
    else { p.ix = e.p.x; p.iy = e.p.y; if (p.smooth && !e.alt) { p.ox = 2 * p.x - p.ix; p.oy = 2 * p.y - p.iy; } }
    if ((ds as any).layer) (ds as any).layer.ver++; d.touch(); v.redraw(null);
  },
  up(d) { if (ts.moveStart || ts.directSel) { ts.moveStart = null; ts.directSel = null; clearCaches(); d.commit('Edit Path'); app.emit(); } },
  overlay: drawPaths,
  cursor: () => 'default',
};
const anchorTool: Handler = {
  down(d, e, v) {
    const s = v.toScreen(e.p);
    for (const ep of editablePaths(d)) for (const sp of ep.path.subpaths) {
      const i = sp.points.findIndex((p) => { const q = v.toScreen(p); return Math.hypot(q.x - s.x, q.y - s.y) < 8; });
      if (i >= 0) {
        if (app.tool === 'delete-anchor') sp.points.splice(i, 1);
        else if (app.tool === 'convert-point') { const p = sp.points[i]; if (p.smooth) { p.smooth = false; p.ix = p.x; p.iy = p.y; p.ox = p.x; p.oy = p.y; } else { const a = sp.points[(i - 1 + sp.points.length) % sp.points.length], b = sp.points[(i + 1) % sp.points.length]; const tx = (b.x - a.x) / 6, ty = (b.y - a.y) / 6; Object.assign(p, { smooth: true, ix: p.x - tx, iy: p.y - ty, ox: p.x + tx, oy: p.y + ty }); } }
        if (ep.layer) ep.layer.ver++; d.commit('Edit Anchor'); app.emit(); return;
      }
      if (app.tool === 'add-anchor') {
        // nearest segment midpoint test
        const n = sp.closed ? sp.points.length : sp.points.length - 1;
        for (let k = 0; k < n; k++) {
          const a = sp.points[k], b = sp.points[(k + 1) % sp.points.length];
          for (let t = 0.05; t < 1; t += 0.05) {
            const u = 1 - t, x = u * u * u * a.x + 3 * u * u * t * a.ox + 3 * u * t * t * b.ix + t * t * t * b.x, y = u * u * u * a.y + 3 * u * u * t * a.oy + 3 * u * t * t * b.iy + t * t * t * b.y;
            const q = v.toScreen({ x, y }); if (Math.hypot(q.x - s.x, q.y - s.y) < 6) { sp.points.splice(k + 1, 0, V.pp(x, y)); if (ep.layer) ep.layer.ver++; d.commit('Add Anchor Point'); app.emit(); return; }
          }
        }
      }
    }
  },
  overlay: drawPaths,
  cursor: () => 'crosshair',
};

// ---------- type ----------
let pendingPathText: any = null;
const typeTool: Handler = {
  down(d, e, v) {
    const hit = flatLayers(d.layers).reverse().find((l) => l.kind === 'text' && l.visible && (() => { const b = V.textBounds(l.text!); return e.p.x >= b.x && e.p.x <= b.x + b.w && e.p.y >= b.y && e.p.y <= b.y + b.h; })());
    if (hit && !app.tool.includes('mask')) { d.setActive(hit.id); v.editText(hit.id); return; }
    // clicking on a path starts type on that path
    if (!app.tool.includes('mask') && !app.tool.includes('vertical')) {
      const s = v.toScreen(e.p);
      for (const ep of editablePaths(d)) {
        const sp = ep.path.subpaths[0]; if (!sp || sp.points.length < 2) continue; const n = sp.points.length, m = sp.closed ? n : n - 1; let best = Infinity, offset = 0, len = 0, tot = 0; let prev: Pt | null = null;
        for (let k = 0; k < m; k++) { const a = sp.points[k], b = sp.points[(k + 1) % n]; for (let j = 0; j <= 20; j++) { const u = j / 20, w = 1 - u; const q = { x: w * w * w * a.x + 3 * w * w * u * a.ox + 3 * w * u * u * b.ix + u * u * u * b.x, y: w * w * w * a.y + 3 * w * w * u * a.oy + 3 * w * u * u * b.iy + u * u * u * b.y }; if (prev) tot += Math.hypot(q.x - prev.x, q.y - prev.y); prev = q; const qs = v.toScreen(q), dd = Math.hypot(qs.x - s.x, qs.y - s.y); if (dd < best) { best = dd; len = tot; } } }
        offset = tot ? (len / tot) * 100 : 0;
        if (best < 8) {
          const o = app.opts; const text = V.defaultText(0, 0, { font: o.font, size: o.fontSize, weight: o.fontWeight, italic: o.italic, align: 'left', color: app.fg, antialias: o.antialiasText, text: '', path: JSON.parse(JSON.stringify(ep.path)), pathOffset: Math.round(offset) });
          pendingPathText = text; return; // created on pointer up so the editor keeps focus
        }
      }
    }
    ts.drag = e.p; ts.cur = e.p;
  },
  move(_d, e, v) { if (ts.drag) { ts.cur = e.p; v.overlay(); } },
  up(d, e, v) {
    if (pendingPathText) { const l = newLayer('text', 'Text on Path', { text: pendingPathText }); pendingPathText = null; d.addLayer(l); d.touch(); app.emit(); v.editText(l.id); return; }
    if (!ts.drag) return; const a = ts.drag; ts.drag = null; const box = Math.abs(e.p.x - a.x) > 10 ? rectFromPts(a, e.p) : null; ts.cur = null;
    const o = app.opts, vertical = app.tool.includes('vertical');
    const text = V.defaultText(box ? box.x : a.x, box ? box.y : a.y, { font: o.font, size: o.fontSize, weight: o.fontWeight, italic: o.italic, align: o.textAlign, color: app.fg, vertical, boxWidth: box ? box.w : 0, antialias: o.antialiasText, text: '' });
    if (app.tool.includes('mask')) {
      const t = prompt('Text for the type mask', 'Monsoon'); if (!t) return; text.text = t;
      const m = Sel.shapeMask(d.w, d.h, (x) => { V.drawText(x, { ...text, color: '#fff' }); });
      applySelection(d, m, selOpFrom(e), 'Type Mask'); return;
    }
    const l = newLayer('text', 'Text', { text }); d.addLayer(l); d.touch(); app.emit(); v.editText(l.id);
  },
  overlay(x, _d, v) { if (ts.drag && ts.cur && Math.abs(ts.cur.x - ts.drag.x) > 10) { const a = v.toScreen(ts.drag), b = v.toScreen(ts.cur); x.save(); x.setLineDash([3, 3]); x.strokeStyle = '#6c7cff'; x.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); x.restore(); } },
  cursor: () => 'text',
};

// ---------- navigation ----------
const hand: Handler = {
  down(_d, e) { ts.drag = e.raw; },
  move(_d, e, v) { if (!ts.drag) return; v.pan(e.raw.x - ts.drag.x, e.raw.y - ts.drag.y); ts.drag = e.raw; },
  up() { ts.drag = null; },
  cursor: () => (ts.drag ? 'grabbing' : 'grab'),
};
const rotateView: Handler = {
  down(_d, e) { ts.drag = e.raw; },
  move(_d, e, v) { if (!ts.drag) return; const el = document.querySelector('.viewport')!.getBoundingClientRect(); const c = { x: el.width / 2, y: el.height / 2 }; const a0 = Math.atan2(ts.drag.y - c.y, ts.drag.x - c.x), a1 = Math.atan2(e.raw.y - c.y, e.raw.x - c.x); v.rotate(((a1 - a0) * 180) / Math.PI); ts.drag = e.raw; },
  up() { ts.drag = null; },
  cursor: () => 'move',
};
const zoom: Handler = {
  down(_d, e) { ts.drag = e.p; ts.cur = e.p; (ts as any).zraw = e.raw; },
  move(_d, e, v) { if (ts.drag) { ts.cur = e.p; v.overlay(); } },
  up(_d, e, v) {
    const a = ts.drag!; ts.drag = null; ts.cur = null;
    const r = rectFromPts(a, e.p);
    if (r.w * v.zoom > 10 && r.h * v.zoom > 10 && !e.alt) { v.fitRect(r); return; }
    const out = e.alt !== app.opts.zoomOut; v.setZoom(v.zoom * (out ? 1 / 1.5 : 1.5), (ts as any).zraw);
  },
  overlay: (x, d, v) => { if (ts.drag) marquee.overlay!(x, d, v); },
  cursor: () => (app.opts.zoomOut ? 'zoom-out' : 'zoom-in'),
};

// ---------- artboard ----------
function artboardAt(d: Doc, p: Pt): Layer | null { return flatLayers(d.layers).reverse().find((l) => { const a = l.artboard; return !!a && l.visible && p.x >= a.x && p.y >= a.y && p.x <= a.x + a.w && p.y <= a.y + a.h; }) || null; }
const abState: { ab: Layer | null; start: Pt | null; last: Pt } = { ab: null, start: null, last: { x: 0, y: 0 } };
const artboardTool: Handler = {
  down(d, e, v) {
    const hit = artboardAt(d, e.p);
    if (hit && !e.alt) { d.setActive(hit.id); abState.ab = hit; abState.start = e.p; abState.last = { x: 0, y: 0 }; app.emit(); return; }
    ts.drag = e.p; ts.cur = e.p; v.overlay();
  },
  move(d, e, v) {
    if (abState.ab && abState.start) { const dx = Math.round(e.p.x - abState.start.x), dy = Math.round(e.p.y - abState.start.y); offsetLayer(abState.ab, dx - abState.last.x, dy - abState.last.y); abState.last = { x: dx, y: dy }; clearCaches(); d.touch(); v.redraw(null); return; }
    if (ts.drag) { ts.cur = e.p; v.overlay(); }
  },
  up(d) {
    if (abState.ab) { const moved = abState.last.x || abState.last.y; abState.ab = null; abState.start = null; if (moved) { const ab = d.active?.artboard; if (ab && (ab.x < 0 || ab.y < 0 || ab.x + ab.w > d.w || ab.y + ab.h > d.h)) { d.s.width = Math.max(d.w, ab.x + ab.w); d.s.height = Math.max(d.h, ab.y + ab.h); } d.commit('Move Artboard'); } app.emit(); return; }
    if (ts.drag && ts.cur) { const r = rectFromPts(ts.drag, ts.cur); ts.drag = null; ts.cur = null; if (r.w > 8 && r.h > 8) run('newArtboard', { rect: r }); app.emit(); }
  },
  overlay(x, _d, v) {
    if (!ts.drag || !ts.cur) return; const a = v.toScreen(ts.drag), b = v.toScreen(ts.cur);
    x.save(); x.strokeStyle = '#6c7cff'; x.setLineDash([5, 4]); x.lineWidth = 1.5; x.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); x.restore();
  },
  cursor: () => 'crosshair',
};
export const HANDLERS: Partial<Record<ToolId, Handler>> = {
  move, artboard: artboardTool, 'marquee-rect': marquee, 'marquee-ellipse': marquee, 'marquee-row': marquee, 'marquee-col': marquee, lasso, 'lasso-poly': lasso, 'lasso-magnetic': lasso,
  'magic-wand': wand, 'quick-select': quickSelect, 'object-select': objectSelect, crop, 'crop-perspective': perspectiveCrop,
  eyedropper, 'color-sampler': sampler, ruler, note, count,
  'spot-heal': painter, remove: painter, heal: painter, patch, 'content-move': patch, 'red-eye': redEyeTool,
  brush: painter, pencil: painter, 'color-replace': painter, mixer: painter, clone: painter, 'pattern-stamp': painter, 'history-brush': painter, 'art-history': painter,
  eraser: painter, 'bg-eraser': painter, 'magic-eraser': magicEraser, gradient, bucket,
  blur: painter, sharpen: painter, smudge: painter, dodge: painter, burn: painter, sponge: painter,
  pen, 'freeform-pen': pen, 'curvature-pen': pen, 'add-anchor': anchorTool, 'delete-anchor': anchorTool, 'convert-point': anchorTool,
  'path-select': pathSelect, 'direct-select': pathSelect,
  type: typeTool, 'type-vertical': typeTool, 'type-mask': typeTool, 'type-mask-vertical': typeTool,
  'shape-rect': shapeTool, 'shape-ellipse': shapeTool, 'shape-triangle': shapeTool, 'shape-polygon': shapeTool, 'shape-line': shapeTool, 'shape-custom': shapeTool,
  hand, 'rotate-view': rotateView, zoom,
};
export const BRUSH_TOOLS = new Set<ToolId>(['brush', 'pencil', 'eraser', 'bg-eraser', 'clone', 'pattern-stamp', 'history-brush', 'art-history', 'heal', 'spot-heal', 'remove', 'blur', 'sharpen', 'smudge', 'dodge', 'burn', 'sponge', 'color-replace', 'mixer', 'quick-select']);
export function handlerFor(t: ToolId): Handler { return ts.transform ? transformTool : HANDLERS[t] || hand; }
export { commands };

(window as any).__tools = HANDLERS;
