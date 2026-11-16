// Application state: open documents, tools, colours, options and view settings.
import { Doc, newLayer, flatLayers } from './engine/doc';
import type { Gradient, GradientShape, Layer } from './engine/types';
import { defaultBrush, BrushSettings } from './engine/brush';
import { GRADIENT_PRESETS } from './engine/paint';
import { renderEnv, clearCaches } from './engine/render';
import { Canvas, ctx2d, makeCanvas, Rect, rectIntersect, getData } from './engine/util';
import { maskBounds } from './engine/selection';

export type ToolId =
  | 'move' | 'artboard' | 'marquee-rect' | 'marquee-ellipse' | 'marquee-row' | 'marquee-col' | 'lasso' | 'lasso-poly' | 'lasso-magnetic'
  | 'object-select' | 'quick-select' | 'magic-wand' | 'crop' | 'crop-perspective' | 'slice' | 'frame'
  | 'eyedropper' | 'color-sampler' | 'ruler' | 'note' | 'count'
  | 'spot-heal' | 'remove' | 'heal' | 'patch' | 'content-move' | 'red-eye'
  | 'brush' | 'pencil' | 'color-replace' | 'mixer'
  | 'clone' | 'pattern-stamp' | 'history-brush' | 'art-history'
  | 'eraser' | 'bg-eraser' | 'magic-eraser'
  | 'gradient' | 'bucket'
  | 'blur' | 'sharpen' | 'smudge' | 'dodge' | 'burn' | 'sponge'
  | 'pen' | 'freeform-pen' | 'curvature-pen' | 'add-anchor' | 'delete-anchor' | 'convert-point'
  | 'type' | 'type-vertical' | 'type-mask' | 'type-mask-vertical'
  | 'path-select' | 'direct-select'
  | 'shape-rect' | 'shape-ellipse' | 'shape-triangle' | 'shape-polygon' | 'shape-line' | 'shape-custom'
  | 'hand' | 'rotate-view' | 'zoom';

export interface ToolOptions {
  selOp: 'new' | 'add' | 'subtract' | 'intersect'; feather: number; antialias: boolean; marqueeStyle: 'normal' | 'fixed-ratio' | 'fixed-size'; fixedW: number; fixedH: number;
  tolerance: number; contiguous: boolean; sampleAll: boolean; sampleSize: number;
  autoSelect: boolean; autoSelectGroups: boolean; showTransform: boolean;
  cropRatio: string; cropDelete: boolean; cropOverlay: 'thirds' | 'grid' | 'golden' | 'none';
  cloneAligned: boolean; cloneSample: 'current' | 'below' | 'all'; healMode: 'normal' | 'replace'; spotType: 'content' | 'texture' | 'proximity';
  patchMode: 'normal' | 'content'; patchFrom: 'source' | 'destination'; moveMode: 'move' | 'extend';
  strength: number; fingerPaint: boolean; range: 'shadows' | 'midtones' | 'highlights'; exposure: number; protectTones: boolean; spongeMode: 'saturate' | 'desaturate';
  replaceMode: 'hue' | 'saturation' | 'color' | 'luminosity'; mixerWet: number; mixerLoad: number; mixerMix: number;
  eraserMode: 'brush' | 'pencil' | 'block'; eraseToHistory: boolean;
  gradShape: GradientShape; gradReverse: boolean; gradDither: boolean; gradOpacity: number; gradMode: string;
  bucketSource: 'fg' | 'pattern';
  shapeMode: 'shape' | 'path' | 'pixels'; shapeFill: string; shapeFillType: 'color' | 'none' | 'gradient'; shapeStroke: string; shapeStrokeOn: boolean; shapeStrokeWidth: number; shapeStrokeAlign: 'inside' | 'center' | 'outside'; shapeDash: string;
  radius: number; sides: number; star: number; lineWidth: number; arrowStart: boolean; arrowEnd: boolean; customShape: string;
  font: string; fontSize: number; fontWeight: number; italic: boolean; textAlign: 'left' | 'center' | 'right' | 'justify'; textColor: string; antialiasText: boolean;
  penRubber: boolean; sampleRuler: boolean; eyedropperSize: number; eyedropperSample: 'current' | 'all';
  zoomOut: boolean; scrubby: boolean; pressureSize: boolean;
  noteAuthor: string; noteColor: string;
}
const defaultOptions = (): ToolOptions => ({
  selOp: 'new', feather: 0, antialias: true, marqueeStyle: 'normal', fixedW: 64, fixedH: 64,
  tolerance: 32, contiguous: true, sampleAll: false, sampleSize: 1,
  autoSelect: false, autoSelectGroups: false, showTransform: false,
  cropRatio: 'free', cropDelete: true, cropOverlay: 'thirds',
  cloneAligned: true, cloneSample: 'current', healMode: 'normal', spotType: 'content',
  patchMode: 'normal', patchFrom: 'source', moveMode: 'move',
  strength: 0.5, fingerPaint: false, range: 'midtones', exposure: 0.5, protectTones: true, spongeMode: 'desaturate',
  replaceMode: 'color', mixerWet: 0.5, mixerLoad: 0.5, mixerMix: 0.5,
  eraserMode: 'brush', eraseToHistory: false,
  gradShape: 'linear', gradReverse: false, gradDither: true, gradOpacity: 1, gradMode: 'normal',
  bucketSource: 'fg',
  shapeMode: 'shape', shapeFill: '#6c7cff', shapeFillType: 'color', shapeStroke: '#000000', shapeStrokeOn: false, shapeStrokeWidth: 3, shapeStrokeAlign: 'inside', shapeDash: '',
  radius: 0, sides: 5, star: 0, lineWidth: 4, arrowStart: false, arrowEnd: false, customShape: 'Raindrop',
  font: 'Inter, Helvetica, Arial, sans-serif', fontSize: 48, fontWeight: 400, italic: false, textAlign: 'left', textColor: '#000000', antialiasText: true,
  penRubber: false, sampleRuler: false, eyedropperSize: 1, eyedropperSample: 'all',
  zoomOut: false, scrubby: true, pressureSize: true,
  noteAuthor: '', noteColor: '#ffd84d',
});

export interface ViewOptions { rulers: boolean; grid: boolean; gridSize: number; guides: boolean; snap: boolean; lockGuides: boolean; extras: boolean; pixelGrid: boolean; screenMode: 'standard' | 'full-menu' | 'full'; proof: 'none' | 'grayscale' | 'cmyk' | 'deuteranopia'; showSelection: boolean; channel: 'rgb' | 'r' | 'g' | 'b' | string }
export interface Toast { id: number; text: string; kind?: 'info' | 'error' }
export interface RecordedStep { cmd: string; args?: any; label: string }
export interface Action { id: string; name: string; steps: RecordedStep[] }

export const FONTS = [
  'Inter, Helvetica, Arial, sans-serif', 'Georgia, serif', 'Times New Roman, serif', 'Courier New, monospace', 'Arial Black, sans-serif', 'Verdana, sans-serif',
  'Trebuchet MS, sans-serif', 'Impact, sans-serif', 'Palatino, serif', 'Garamond, serif', 'Brush Script MT, cursive', 'Comic Sans MS, cursive', 'system-ui, sans-serif', 'ui-monospace, monospace',
];

type Listener = () => void;
class AppState {
  docs: Doc[] = [];
  activeId: string | null = null;
  tool: ToolId = 'move';
  lastInGroup: Record<string, ToolId> = {};
  fg = '#000000'; bg = '#ffffff';
  brush: BrushSettings = defaultBrush();
  eraserBrush: BrushSettings = { ...defaultBrush(), hardness: 0.9 };
  opts: ToolOptions = defaultOptions();
  gradient: Gradient = GRADIENT_PRESETS[0];
  pattern = 'Dots';
  swatches: string[] = ['#000000', '#ffffff', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#30b0c7', '#007aff', '#5856d6', '#af52de', '#ff2d55', '#a2845e', '#8e8e93', '#1c1c1e', '#6c7cff', '#9fd3ff', '#3b4fa8', '#0b1026', '#f2e8cf'];
  view: ViewOptions = { rulers: true, grid: false, gridSize: 32, guides: true, snap: true, lockGuides: false, extras: true, pixelGrid: true, screenMode: 'standard', proof: 'none', showSelection: true, channel: 'rgb' };
  editMask = false; // painting goes to the active layer's mask
  showMask = false; // view the mask alone
  toasts: Toast[] = [];
  dialog: { kind: string; props?: any } | null = null;
  actions: Action[] = [];
  recording: string | null = null;
  lastFilter: { id: string; params: any } | null = null;
  cloneSource: { x: number; y: number; docId: string } | null = null;
  historySource: number | null = null; // history state id for history brush
  version = 0;
  prefs = { historyStates: 50, autosaveMinutes: 2, theme: 'dark' as 'dark' | 'light' | 'storm', units: 'px' as 'px' | 'in' | 'cm', interfaceScale: 1, checker: 'medium' as 'small' | 'medium' | 'large' | 'none', aiSubject: true };
  panelsOpen: Record<string, boolean> = { layers: true, properties: true, color: true, history: true };
  mobilePanel: string | null = null;
  private listeners = new Set<Listener>();

  subscribe = (fn: Listener) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;
  emit() { this.version++; renderEnv.fg = this.fg; renderEnv.bg = this.bg; for (const l of [...this.listeners]) l(); }

  get doc(): Doc | null { return this.docs.find((d) => d.id === this.activeId) || null; }
  addDoc(d: Doc) { d.maxHistory = this.prefs.historyStates; this.docs.push(d); this.activeId = d.id; this.editMask = false; this.emit(); }
  closeDoc(id: string) {
    this.docs = this.docs.filter((d) => d.id !== id); clearCaches();
    if (this.activeId === id) this.activeId = this.docs[this.docs.length - 1]?.id || null;
    this.emit();
  }
  setTool(t: ToolId) { this.tool = t; this.emit(); }
  busy: { text: string; frac: number } | null = null;
  setBusy(b: { text: string; frac: number } | null) { this.busy = b; this.emit(); }
  toast(text: string, kind: 'info' | 'error' = 'info') {
    const id = Date.now() + Math.random(); this.toasts.push({ id, text, kind }); this.emit();
    setTimeout(() => { this.toasts = this.toasts.filter((t) => t.id !== id); this.emit(); }, kind === 'error' ? 6000 : 3200);
  }
  openDialog(kind: string, props?: any) { this.dialog = { kind, props }; this.emit(); }
  closeDialog() { this.dialog = null; this.emit(); }
  swapColors() { [this.fg, this.bg] = [this.bg, this.fg]; this.emit(); }
  resetColors() { this.fg = '#000000'; this.bg = '#ffffff'; this.emit(); }
}
export const app = new AppState();
(window as any).__monsoon = app;

// ---------- helpers used by tools and commands ----------
export function requireDoc(): Doc { const d = app.doc; if (!d) throw new Error('Open or create a document first.'); return d; }

/** The canvas that painting should modify: mask, quick mask, or layer pixels. */
export function paintTarget(d: Doc): { canvas: Canvas; ox: number; oy: number; kind: 'layer' | 'mask' | 'quickmask'; layer: Layer | null } | null {
  if (d.quickMask) { const c = d.editableSelection(); return { canvas: c, ox: 0, oy: 0, kind: 'quickmask', layer: null }; }
  const l = d.active; if (!l) return null;
  if (app.editMask && l.mask) { const m = d.editableMask(l); return { canvas: m.canvas, ox: m.x, oy: m.y, kind: 'mask', layer: l }; }
  if (l.locks.all || l.locks.pixels) { app.toast(`"${l.name}" is locked. Unlock it in the Layers panel to edit its pixels.`, 'error'); return null; }
  if (l.kind === 'group' || l.kind === 'adjustment') { app.toast('Select a pixel layer to paint on. Groups and adjustment layers have no pixels.', 'error'); return null; }
  if (l.kind !== 'raster') { rasterizeLayer(d, l); app.toast(`"${l.name}" was rasterized so it can be painted on.`); }
  const c = d.editable(l); return { canvas: c, ox: l.x, oy: l.y, kind: 'layer', layer: l };
}
export function rasterizeLayer(d: Doc, l: Layer) {
  // lazily imported to avoid a cycle
  const { renderLayerAlone } = require_render();
  const c = renderLayerAlone(d, { ...l, mask: undefined, opacity: 1, fillOpacity: 1 } as Layer, false);
  l.kind = 'raster'; l.canvas = c; l.x = 0; l.y = 0; delete l.text; delete l.shape; delete l.fill; delete l.smart; l.ver++;
  clearCaches(l.id);
}
import * as R from './engine/render';
function require_render() { return R; }

/** Selection bounds or the whole document. */
export function workRect(d: Doc): Rect {
  if (d.s.selection) { const b = maskBounds(d.s.selection); if (b) return b; }
  return { x: 0, y: 0, w: d.w, h: d.h };
}
/**
 * Run a pixel function on the active layer limited to the selection. fn receives region pixels and returns new pixels.
 * Smart objects get a smart filter instead when `smart` is given.
 */
export function applyToPixels(label: string, fn: (img: ImageData, rect: Rect) => ImageData | void, opts: { margin?: number; target?: Canvas } = {}) {
  const d = requireDoc();
  const t = paintTarget(d); if (!t) return false;
  const c = t.canvas;
  const sel = d.s.selection;
  const wr = workRect(d), m = opts.margin ?? 0;
  const R0 = rectIntersect({ x: wr.x - t.ox - m, y: wr.y - t.oy - m, w: wr.w + m * 2, h: wr.h + m * 2 }, { x: 0, y: 0, w: c.width, h: c.height });
  if (!R0) return false;
  const x = ctx2d(c), before = x.getImageData(R0.x, R0.y, R0.w, R0.h);
  const work = new ImageData(new Uint8ClampedArray(before.data), R0.w, R0.h);
  const res = fn(work, { x: R0.x + t.ox, y: R0.y + t.oy, w: R0.w, h: R0.h }) || work;
  if (sel) {
    const sd = ctx2d(sel).getImageData(R0.x + t.ox, R0.y + t.oy, R0.w, R0.h).data, o = res.data, b = before.data;
    for (let i = 0; i < o.length; i += 4) { const k = sd[i] / 255; if (k >= 1) continue; for (let ch = 0; ch < 4; ch++) o[i + ch] = b[i + ch] + (o[i + ch] - b[i + ch]) * k; }
  }
  if (t.layer && t.layer.locks.transparency && t.kind === 'layer') { const o = res.data, b = before.data; for (let i = 3; i < o.length; i += 4) o[i] = b[i]; }
  x.putImageData(res, R0.x, R0.y);
  if (t.layer) t.layer.ver++;
  d.commit(label);
  app.emit();
  return true;
}
export function layerBounds(d: Doc, l: Layer): Rect | null {
  const p = R.layerContent(d, l);
  if (!p) {
    if (l.kind === 'group') { let r: Rect | null = null; for (const c of l.children!) { const b = layerBounds(d, c); if (b) r = r ? { x: Math.min(r.x, b.x), y: Math.min(r.y, b.y), w: Math.max(r.x + r.w, b.x + b.w) - Math.min(r.x, b.x), h: Math.max(r.y + r.h, b.y + b.h) - Math.min(r.y, b.y) } : b; } return r; }
    return null;
  }
  const d0 = getData(p.canvas).data, w = p.canvas.width, h = p.canvas.height;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d0[(y * w + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  return x1 < 0 ? null : { x: x0 + p.x, y: y0 + p.y, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
export function newDocument(name: string, w: number, h: number, bg: 'white' | 'black' | 'transparent' | 'bg' | string = 'white', resolution = 72) {
  const d = new Doc(name, w, h, (doc) => {
    const l = newLayer('raster', bg === 'transparent' ? 'Layer 1' : 'Background');
    l.canvas = makeCanvas(w, h);
    if (bg !== 'transparent') { const x = ctx2d(l.canvas); x.fillStyle = bg === 'white' ? '#fff' : bg === 'black' ? '#000' : bg === 'bg' ? app.bg : bg; x.fillRect(0, 0, w, h); l.locks = { pixels: false, position: true, transparency: true, all: false }; }
    doc.s.layers.push(l); doc.s.activeId = l.id; doc.s.selectedIds = [l.id]; doc.s.resolution = resolution;
  });
  app.addDoc(d);
  return d;
}
export { flatLayers };
