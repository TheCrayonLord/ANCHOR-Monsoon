// Menu commands. Every command goes through run() so actions can record and replay it.
import { app, requireDoc, applyToPixels, paintTarget, rasterizeLayer, workRect, layerBounds, newDocument } from './app';
import { Doc, newLayer, walk, flatLayers, own } from './engine/doc';
import type { AdjType, Layer, LayerStyles, BlendMode } from './engine/types';
import { ADJ_DEFAULTS, ADJ_LABELS, applyAdjustment, autoColor, autoContrast, autoTone, desaturate, equalize } from './engine/adjust';
import { FILTER_MAP } from './engine/filterdefs';
import * as Sel from './engine/selection';
import { clearCaches, flatten, renderLayerAlone, layerContent } from './engine/render';
import { Canvas, ctx2d, makeCanvas, cloneCanvas, Rect, download, rectIntersect, hexToRgb, uid, alphaBounds, getData, lum } from './engine/util';
import { inpaint } from './engine/heal';
import { definePattern, getPattern, renderGradient } from './engine/paint';
import { defineBrushTip } from './engine/brush';
import { exportDoc, EXT, ExportFormat, openFile, saveNative, savePsd, exportLayers, addRecent, fileToCanvas, docFromCanvas, OPEN_ACCEPT, dropRecovery } from './engine/io';
import { renderQuad, Quad } from './engine/transform';
import { defaultStyles } from './engine/styles';
import { pathToPath2D } from './engine/vector';

type Cmd = (args?: any) => any;
export const commands: Record<string, Cmd> = {};
const def = (id: string, fn: Cmd) => { commands[id] = fn; };
export async function run(id: string, args?: any, label?: string) {
  const fn = commands[id];
  if (!fn) { app.toast(`Unknown command ${id}`, 'error'); return; }
  try {
    const r = await fn(args);
    if (app.recording && r !== false && !NO_RECORD.has(id)) {
      const a = app.actions.find((x) => x.id === app.recording);
      a?.steps.push({ cmd: id, args, label: label || id });
      app.emit();
    }
    return r;
  } catch (e: any) { console.error(e); app.toast(e?.message || String(e), 'error'); }
}
const NO_RECORD = new Set(['undo', 'redo', 'open', 'new', 'zoomIn', 'zoomOut', 'fit', 'actual', 'toggle', 'dialog', 'save', 'saveAs', 'export']);

const done = (d: Doc, label: string) => { d.commit(label); app.emit(); };
const active = () => { const d = requireDoc(); const l = d.active; if (!l) throw new Error('Select a layer first.'); return { d, l }; };

// ---------------- File ----------------
def('new', (a: { name: string; w: number; h: number; bg: string; res?: number }) => newDocument(a.name, a.w, a.h, a.bg, a.res));
export function pickFiles(accept = OPEN_ACCEPT, multiple = true): Promise<File[]> {
  return new Promise((res) => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.multiple = multiple; i.id = 'file-input';
    i.onchange = () => { res([...(i.files || [])]); i.remove(); }; i.style.display = 'none'; document.body.appendChild(i); i.click();
  });
}
export async function openFiles(files: File[]) {
  for (const f of files) {
    try { const d = await openFile(f); app.addDoc(d); addRecent(d); }
    catch (e: any) { app.toast(`Couldn't open ${f.name}: ${e?.message || e}`, 'error'); }
  }
}
def('open', async () => { await openFiles(await pickFiles()); });
def('close', () => { const d = app.doc; if (!d) return; if (d.dirty && !confirm(`Close "${d.name}" without saving?`)) return; dropRecovery(d.id); app.closeDoc(d.id); });
def('closeAll', () => { for (const d of [...app.docs]) { if (d.dirty && !confirm(`Close "${d.name}" without saving?`)) continue; dropRecovery(d.id); app.closeDoc(d.id); } });
async function saveBlob(blob: Blob, name: string, d?: Doc) {
  const w = window as any;
  if (w.showSaveFilePicker) {
    try {
      const ext = name.split('.').pop();
      const h = await w.showSaveFilePicker({ suggestedName: name, types: [{ description: ext!.toUpperCase(), accept: { [blob.type || 'application/octet-stream']: ['.' + ext] } }] });
      const s = await h.createWritable(); await s.write(blob); await s.close(); if (d) d.fileHandle = h; return true;
    } catch (e: any) { if (e?.name === 'AbortError') return false; }
  }
  download(blob, name); return true;
}
def('save', async () => {
  const d = requireDoc();
  const blob = await saveNative(d);
  if (d.fileHandle) { try { const s = await d.fileHandle.createWritable(); await s.write(blob); await s.close(); d.dirty = false; app.toast('Saved'); app.emit(); return; } catch { /* fall through */ } }
  if (await saveBlob(blob, d.name + '.monsoon', d)) { d.dirty = false; addRecent(d); app.toast(`Saved ${d.name}.monsoon`); app.emit(); }
});
def('saveAs', async (fmt: ExportFormat = 'monsoon') => {
  const d = requireDoc(); const blob = fmt === 'psd' ? savePsd(d) : await exportDoc(d, fmt);
  if (await saveBlob(blob, `${d.name}.${EXT[fmt]}`)) { if (fmt === 'monsoon' || fmt === 'psd') d.dirty = false; app.toast(`Saved ${d.name}.${EXT[fmt]}`); app.emit(); }
});
def('export', async (a: { fmt: ExportFormat; quality?: number; scale?: number; name?: string }) => {
  const d = requireDoc(); const blob = await exportDoc(d, a.fmt, a.quality, a.scale || 1);
  await saveBlob(blob, `${a.name || d.name}.${EXT[a.fmt]}`);
});
def('quickExport', async () => { const d = requireDoc(); download(await exportDoc(d, 'png'), d.name + '.png'); });
def('exportLayers', async (a: { fmt: ExportFormat; trim: boolean }) => { const d = requireDoc(); download(await exportLayers(d, a?.fmt || 'png', a?.trim ?? true), d.name + '-layers.zip'); });
def('place', async (file?: File) => {
  const d = requireDoc(); const f = file || (await pickFiles('image/*,.psd,.tif,.tiff,.heic', false))[0]; if (!f) return false;
  const src = await fileToCanvas(f, f.name);
  const sc = Math.min(1, (d.w * 0.8) / src.width, (d.h * 0.8) / src.height), w = src.width * sc, h = src.height * sc, x = (d.w - w) / 2, y = (d.h - h) / 2;
  const l = newLayer('smart', f.name.replace(/\.[^.]+$/, ''), { smart: { source: src, name: f.name, quad: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], filters: [] } });
  d.addLayer(l); done(d, 'Place Embedded');
});
def('print', () => {
  const d = requireDoc(); const url = flatten(d).toDataURL('image/png'); const wnd = window.open('', '_blank'); if (!wnd) { app.toast('Allow pop-ups to print.', 'error'); return; }
  wnd.document.write(`<title>${d.name}</title><style>@page{margin:10mm}body{margin:0;display:flex;justify-content:center}img{max-width:100%;max-height:100vh}</style><img src="${url}" onload="setTimeout(()=>{print();},200)">`); wnd.document.close();
});
def('revert', () => { const d = requireDoc(); d.goto(0); app.emit(); });
def('duplicateDoc', () => {
  const d = requireDoc(); const n = new Doc(d.name + ' copy', d.w, d.h, (nd) => { nd.s = JSON.parse('null') || d.snapshot(); });
  app.addDoc(n);
});

// ---------------- Edit ----------------
def('undo', () => { const d = requireDoc(); d.undo(); clearCaches(); app.emit(); });
def('redo', () => { const d = requireDoc(); d.redo(); clearCaches(); app.emit(); });
let clipboard: { canvas: Canvas; x: number; y: number } | null = null;
function selectionPixels(d: Doc, merged: boolean): { canvas: Canvas; x: number; y: number } | null {
  const src = merged ? { canvas: flatten(d), x: 0, y: 0 } : (() => { const l = d.active; if (!l) return null; const p = l.kind === 'raster' ? layerContent(d, l) : { canvas: renderLayerAlone(d, l), x: 0, y: 0 }; return p; })();
  if (!src) return null;
  const r = workRect(d), c = makeCanvas(r.w, r.h), x = ctx2d(c);
  x.drawImage(src.canvas, src.x - r.x, src.y - r.y);
  if (d.s.selection) { x.globalCompositeOperation = 'destination-in'; x.drawImage(Sel.maskToAlpha(d.s.selection), -r.x, -r.y); }
  return { canvas: c, x: r.x, y: r.y };
}
async function toSystemClipboard(c: Canvas) {
  try { const b = await new Promise<Blob>((res) => c.toBlob((x) => res(x!), 'image/png')); await (navigator.clipboard as any).write([new (window as any).ClipboardItem({ 'image/png': b })]); } catch { /* not allowed */ }
}
def('copy', () => { const d = requireDoc(); clipboard = selectionPixels(d, false); if (clipboard) toSystemClipboard(clipboard.canvas); app.toast('Copied'); });
def('copyMerged', () => { const d = requireDoc(); clipboard = selectionPixels(d, true); if (clipboard) toSystemClipboard(clipboard.canvas); app.toast('Copied merged'); });
def('cut', () => { const d = requireDoc(); clipboard = selectionPixels(d, false); if (clipboard) toSystemClipboard(clipboard.canvas); commands.clear(); });
def('clear', () => {
  const d = requireDoc(); const t = paintTarget(d); if (!t) return false;
  const x = ctx2d(t.canvas);
  if (t.kind === 'mask') { x.save(); if (d.s.selection) { const m = Sel.maskToAlpha(d.s.selection); const f = makeCanvas(t.canvas.width, t.canvas.height), fx = ctx2d(f); fx.fillStyle = '#000'; fx.fillRect(0, 0, f.width, f.height); fx.globalCompositeOperation = 'destination-in'; fx.drawImage(m, -t.ox, -t.oy); x.drawImage(f, 0, 0); } else { x.fillStyle = '#000'; x.fillRect(0, 0, t.canvas.width, t.canvas.height); } x.restore(); }
  else if (t.layer?.locks.transparency) { fillSelection(d, t.canvas, t.ox, t.oy, app.bg, 1, 'normal'); }
  else { x.save(); x.globalCompositeOperation = 'destination-out'; if (d.s.selection) x.drawImage(Sel.maskToAlpha(d.s.selection), -t.ox, -t.oy); else x.fillRect(0, 0, t.canvas.width, t.canvas.height); x.restore(); }
  done(d, 'Clear');
});
async function readSystemClipboard(): Promise<Canvas | null> {
  try {
    const items = await (navigator.clipboard as any).read();
    for (const it of items) for (const t of it.types) if (t.startsWith('image/')) { const b = await it.getType(t); return fileToCanvas(b, 'clip.png'); }
  } catch { /* denied */ }
  return null;
}
export async function pasteCanvas(c: Canvas, mode: 'center' | 'inplace' | 'into' = 'center', at?: { x: number; y: number }) {
  if (!app.doc) { app.addDoc(docFromCanvas('Untitled', c, 'Layer 1')); return; }
  const d = app.doc; const l = newLayer('raster', d.uniqueName('Layer'));
  l.canvas = cloneCanvas(c);
  if (mode === 'inplace' && at) { l.x = at.x; l.y = at.y; } else { l.x = Math.round((d.w - c.width) / 2); l.y = Math.round((d.h - c.height) / 2); }
  if (mode === 'into' && d.s.selection) l.mask = { canvas: cloneCanvas(d.s.selection), x: 0, y: 0, bg: 0, enabled: true, linked: false, density: 1, feather: 0 };
  d.addLayer(l); if (mode === 'into') d.s.selection = null; done(d, 'Paste');
}
def('paste', async (mode: 'center' | 'inplace' | 'into' = 'center') => {
  const sys = await readSystemClipboard();
  if (sys && (!clipboard || sys.width !== clipboard.canvas.width || sys.height !== clipboard.canvas.height)) return pasteCanvas(sys, mode === 'inplace' ? 'center' : mode);
  if (!clipboard) { app.toast('The clipboard is empty.'); return false; }
  return pasteCanvas(clipboard.canvas, mode, { x: clipboard.x, y: clipboard.y });
});
export function fillSelection(d: Doc, target: Canvas, ox: number, oy: number, style: string | CanvasPattern | Canvas, opacity: number, mode: BlendMode, preserve = false) {
  const f = makeCanvas(target.width, target.height), fx = ctx2d(f);
  if (style instanceof HTMLCanvasElement) fx.drawImage(style, -ox, -oy);
  else { fx.fillStyle = style; fx.fillRect(0, 0, f.width, f.height); }
  if (d.s.selection) { fx.globalCompositeOperation = 'destination-in'; fx.drawImage(Sel.maskToAlpha(d.s.selection), -ox, -oy); }
  const x = ctx2d(target);
  if (preserve) { x.save(); x.globalAlpha = opacity; x.globalCompositeOperation = 'source-atop'; x.drawImage(f, 0, 0); x.restore(); }
  else import('./engine/blend').then(() => void 0);
  if (!preserve) { const { drawBlended } = BL; drawBlended(target, f, 0, 0, mode, opacity); }
}
import * as BL from './engine/blend';
def('fill', async (a: { use: string; color?: string; pattern?: string; mode?: BlendMode; opacity?: number; preserve?: boolean }) => {
  const d = requireDoc();
  if (a.use === 'content') return commands.contentAwareFill();
  const t = paintTarget(d); if (!t) return false;
  let style: any;
  if (a.use === 'pattern') style = ctx2d(t.canvas).createPattern(getPattern(a.pattern || app.pattern), 'repeat');
  else if (a.use === 'history') { const h = d.history[0].state; const l0 = h.layers.find((q) => q.id === t.layer?.id); if (!l0?.canvas) return false; style = l0.canvas; }
  else style = a.use === 'fg' ? app.fg : a.use === 'bg' ? app.bg : a.use === 'black' ? '#000' : a.use === 'white' ? '#fff' : a.use === 'gray' ? '#808080' : a.color || app.fg;
  if (t.kind !== 'layer' && typeof style === 'string') { const c = hexToRgb(style.length === 4 ? style.replace(/#(.)(.)(.)/, '#$1$1$2$2$3$3') : style); const v = Math.round(lum(c.r, c.g, c.b)); style = `rgb(${v},${v},${v})`; }
  fillSelection(d, t.canvas, t.ox, t.oy, style, a.opacity ?? 1, a.mode || 'normal', a.preserve || t.layer?.locks.transparency);
  if (t.layer) t.layer.ver++;
  done(d, 'Fill');
});
def('stroke', (a: { width: number; color: string; location: 'inside' | 'center' | 'outside'; opacity?: number; mode?: BlendMode }) => {
  const d = requireDoc(); if (!d.s.selection) { app.toast('Make a selection to stroke.'); return false; }
  const t = paintTarget(d); if (!t) return false;
  const sel = d.s.selection, w = a.width;
  let ring: Canvas;
  if (a.location === 'outside') ring = diffMask(Sel.expandMask(sel, w), sel);
  else if (a.location === 'inside') ring = diffMask(sel, Sel.contractMask(sel, w));
  else ring = diffMask(Sel.expandMask(sel, w / 2), Sel.contractMask(sel, w / 2));
  const f = makeCanvas(d.w, d.h), fx = ctx2d(f); fx.fillStyle = a.color; fx.fillRect(0, 0, d.w, d.h); fx.globalCompositeOperation = 'destination-in'; fx.drawImage(Sel.maskToAlpha(ring), 0, 0);
  BL.drawBlended(t.canvas, f, -t.ox, -t.oy, a.mode || 'normal', a.opacity ?? 1);
  if (t.layer) t.layer.ver++;
  done(d, 'Stroke');
});
function diffMask(a: Canvas, b: Canvas) { const c = cloneCanvas(a), x = ctx2d(c); x.globalCompositeOperation = 'darken'; x.drawImage(Sel.invertMask(b), 0, 0); return c; }
def('contentAwareFill', () => {
  const d = requireDoc(); if (!d.s.selection) { app.toast('Select the area to fill first.'); return false; }
  const t = paintTarget(d); if (!t) return false;
  const sb = Sel.maskBounds(d.s.selection, 8); if (!sb) return false;
  const pad = Math.max(40, Math.round(Math.max(sb.w, sb.h) * 1.2));
  const R0 = rectIntersect({ x: sb.x - pad - t.ox, y: sb.y - pad - t.oy, w: sb.w + pad * 2, h: sb.h + pad * 2 }, { x: 0, y: 0, w: t.canvas.width, h: t.canvas.height })!;
  const img = ctx2d(t.canvas).getImageData(R0.x, R0.y, R0.w, R0.h);
  const sd = ctx2d(Sel.expandMask(d.s.selection, 2)).getImageData(R0.x + t.ox, R0.y + t.oy, R0.w, R0.h).data;
  const mask = new Uint8Array(R0.w * R0.h); for (let i = 0; i < mask.length; i++) mask[i] = sd[i * 4] > 20 ? 1 : 0;
  const out = inpaint(img, mask);
  // blend the edge softly using the original (feathered) selection
  const so = ctx2d(d.s.selection).getImageData(R0.x + t.ox, R0.y + t.oy, R0.w, R0.h).data;
  for (let i = 0; i < mask.length; i++) { const k = Math.max(so[i * 4] / 255, mask[i] ? 0.999 : 0); for (let c = 0; c < 4; c++) out.data[i * 4 + c] = img.data[i * 4 + c] + (out.data[i * 4 + c] - img.data[i * 4 + c]) * k; }
  ctx2d(t.canvas).putImageData(out, R0.x, R0.y); if (t.layer) t.layer.ver++;
  done(d, 'Content-Aware Fill');
});
def('definePattern', () => { const d = requireDoc(); const p = selectionPixels(d, true); if (!p) return false; const name = prompt('Pattern name', `Pattern ${Date.now() % 1000}`); if (!name) return false; definePattern(name, p.canvas); app.pattern = name; app.toast(`Pattern "${name}" defined`); app.emit(); });
def('defineBrush', () => {
  const d = requireDoc(); const p = selectionPixels(d, true); if (!p) return false;
  const name = prompt('Brush name', `Sampled Brush ${Date.now() % 1000}`); if (!name) return false;
  const g = makeCanvas(p.canvas.width, p.canvas.height), x = ctx2d(g); x.fillStyle = '#fff'; x.fillRect(0, 0, g.width, g.height); x.drawImage(p.canvas, 0, 0);
  defineBrushTip(name, g); app.brush = { ...app.brush, shape: 'custom', customTip: name, size: Math.max(p.canvas.width, p.canvas.height) }; app.toast(`Brush "${name}" defined`); app.emit();
});
def('purge', () => { const d = requireDoc(); const s = d.history[d.hIndex]; d.history = [s]; d.hIndex = 0; app.toast('History cleared'); app.emit(); });

// ---------------- Image ----------------
for (const t of Object.keys(ADJ_DEFAULTS) as AdjType[]) def('adj:' + t, (p?: any) => {
  if (!p) { app.openDialog('adjust', { type: t }); return false; }
  return applyToPixels(ADJ_LABELS[t], (img) => { applyAdjustment(img.data, { type: t, p }); });
});
def('autoTone', () => applyToPixels('Auto Tone', (i) => { autoTone(i.data); }));
def('autoContrast', () => applyToPixels('Auto Contrast', (i) => { autoContrast(i.data); }));
def('autoColor', () => applyToPixels('Auto Color', (i) => { autoColor(i.data); }));
def('desaturate', () => applyToPixels('Desaturate', (i) => { desaturate(i.data); }));
def('equalize', () => applyToPixels('Equalize', (i) => { equalize(i.data); }));
def('replaceColor', (a: any) => import('./engine/adjust').then((m) => applyToPixels('Replace Color', (i) => { m.replaceColor(i.data, a.color, a.fuzz, a.hue, a.sat, a.light); })));

function transformAllLayers(d: Doc, w: number, h: number, mapCanvas: (c: Canvas, x: number, y: number) => { canvas: Canvas; x: number; y: number }, mapPt: (x: number, y: number) => [number, number], label: string) {
  const fix = (l: Layer) => {
    if (l.canvas) { const r = mapCanvas(l.canvas, l.x, l.y); l.canvas = r.canvas; l.x = r.x; l.y = r.y; l.ver++; }
    if (l.mask) { const r = mapCanvas(l.mask.canvas, l.mask.x, l.mask.y); l.mask.canvas = r.canvas; l.mask.x = r.x; l.mask.y = r.y; }
    if (l.text) { const [x, y] = mapPt(l.text.x, l.text.y); const sx = w / d.w; void sx; l.text.x = x; l.text.y = y; }
    if (l.shape) { const { mapPath } = VEC; l.shape.path = mapPath(l.shape.path, mapPt); }
    if (l.smart) l.smart.quad = l.smart.quad.map((p) => { const [x, y] = mapPt(p.x, p.y); return { x, y }; }) as any;
    l.children?.forEach(fix);
  };
  d.s.layers.forEach(fix);
  if (d.s.selection) d.s.selection = mapCanvas(d.s.selection, 0, 0).canvas;
  d.s.guides = []; d.s.width = w; d.s.height = h;
  // keep selection doc-sized
  if (d.s.selection && (d.s.selection.width !== w || d.s.selection.height !== h)) d.s.selection = null;
  clearCaches(); done(d, label);
}
import * as VEC from './engine/vector';
def('imageSize', (a: { w: number; h: number; resample?: string; res?: number }) => {
  const d = requireDoc(); const sx = a.w / d.w, sy = a.h / d.h;
  if (a.res) d.s.resolution = a.res;
  transformAllLayers(d, a.w, a.h, (c, x, y) => {
    const n = makeCanvas(Math.max(1, Math.round(c.width * sx)), Math.max(1, Math.round(c.height * sy))), nx = ctx2d(n);
    nx.imageSmoothingEnabled = a.resample !== 'nearest'; nx.imageSmoothingQuality = 'high';
    // step down for quality when shrinking a lot
    let src = c; while (src.width * sx < src.width / 2 && a.resample !== 'nearest') { const h = makeCanvas(src.width / 2, src.height / 2); const hx = ctx2d(h); hx.imageSmoothingQuality = 'high'; hx.drawImage(src, 0, 0, h.width, h.height); src = h; }
    nx.drawImage(src, 0, 0, n.width, n.height);
    return { canvas: n, x: Math.round(x * sx), y: Math.round(y * sy) };
  }, (x, y) => [x * sx, y * sy], 'Image Size');
  walk(d.layers, (l) => { if (l.text) { l.text.size *= sy; l.text.boxWidth *= sx; } });
});
def('canvasSize', (a: { w: number; h: number; anchor: [number, number]; color?: string }) => {
  const d = requireDoc(); const dx = Math.round((a.w - d.w) * a.anchor[0]), dy = Math.round((a.h - d.h) * a.anchor[1]);
  const bgLayer = d.layers[0];
  transformAllLayers(d, a.w, a.h, (c, x, y) => ({ canvas: c, x: x + dx, y: y + dy }), (x, y) => [x + dx, y + dy], 'Canvas Size');
  if (bgLayer?.name === 'Background' && bgLayer.canvas && a.color !== 'transparent') {
    const c = makeCanvas(a.w, a.h), x = ctx2d(c); x.fillStyle = a.color || app.bg; x.fillRect(0, 0, a.w, a.h); x.drawImage(bgLayer.canvas, bgLayer.x, bgLayer.y);
    bgLayer.canvas = c; bgLayer.x = 0; bgLayer.y = 0; bgLayer.ver++;
  }
  if (d.s.selection) d.s.selection = null;
  app.emit();
});
function rotateCanvas(c: Canvas, x: number, y: number, deg: number, W: number, H: number, nW: number, nH: number, flipH = false, flipV = false) {
  // rotate around the document centre
  const rad = (deg * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const corners = [[x, y], [x + c.width, y], [x, y + c.height], [x + c.width, y + c.height]].map(([px, py]) => mapRot(px, py));
  function mapRot(px: number, py: number) { let ux = px - W / 2, uy = py - H / 2; if (flipH) ux = -ux; if (flipV) uy = -uy; return [ux * cos - uy * sin + nW / 2, ux * sin + uy * cos + nH / 2]; }
  const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
  const x0 = Math.floor(Math.min(...xs)), y0 = Math.floor(Math.min(...ys));
  const n = makeCanvas(Math.ceil(Math.max(...xs)) - x0, Math.ceil(Math.max(...ys)) - y0), nx = ctx2d(n);
  nx.translate(-x0 + nW / 2, -y0 + nH / 2); nx.rotate(rad); if (flipH) nx.scale(-1, 1); if (flipV) nx.scale(1, -1); nx.translate(-W / 2, -H / 2);
  nx.drawImage(c, x, y);
  return { canvas: n, x: x0, y: y0, map: mapRot };
}
def('rotateCanvas', (a: { deg?: number; flipH?: boolean; flipV?: boolean }) => {
  const d = requireDoc(); const deg = a.deg || 0, W = d.w, H = d.h, rad = (deg * Math.PI) / 180;
  const nW = Math.round(Math.abs(W * Math.cos(rad)) + Math.abs(H * Math.sin(rad))), nH = Math.round(Math.abs(W * Math.sin(rad)) + Math.abs(H * Math.cos(rad)));
  const mp = (px: number, py: number): [number, number] => { let ux = px - W / 2, uy = py - H / 2; if (a.flipH) ux = -ux; if (a.flipV) uy = -uy; return [ux * Math.cos(rad) - uy * Math.sin(rad) + nW / 2, ux * Math.sin(rad) + uy * Math.cos(rad) + nH / 2]; };
  transformAllLayers(d, nW, nH, (c, x, y) => { const r = rotateCanvas(c, x, y, deg, W, H, nW, nH, a.flipH, a.flipV); return r; }, mp, a.flipH ? 'Flip Canvas Horizontal' : a.flipV ? 'Flip Canvas Vertical' : 'Rotate Canvas');
  const bg = d.layers[0]; if (bg?.name === 'Background' && deg % 90 !== 0 && bg.canvas) { const c = makeCanvas(nW, nH), x = ctx2d(c); x.fillStyle = app.bg; x.fillRect(0, 0, nW, nH); x.drawImage(bg.canvas, bg.x, bg.y); bg.canvas = c; bg.x = 0; bg.y = 0; }
});
export function cropDoc(d: Doc, r: Rect, deletePixels = true, angle = 0) {
  r = { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) };
  if (angle) {
    // rotate everything around the crop centre first, then crop
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rad = (-angle * Math.PI) / 180;
    const fix = (l: Layer) => {
      const rot = (c: Canvas, x: number, y: number) => { const n = makeCanvas(r.w, r.h), nx = ctx2d(n); nx.translate(r.w / 2, r.h / 2); nx.rotate(rad); nx.translate(-cx, -cy); nx.drawImage(c, x, y); return n; };
      if (l.canvas) { l.canvas = rot(l.canvas, l.x, l.y); l.x = 0; l.y = 0; l.ver++; }
      if (l.mask) { const m = makeCanvas(r.w, r.h), mx = ctx2d(m); mx.fillStyle = l.mask.bg ? '#fff' : '#000'; mx.fillRect(0, 0, r.w, r.h); mx.drawImage(rot(l.mask.canvas, l.mask.x, l.mask.y), 0, 0); l.mask.canvas = m; l.mask.x = 0; l.mask.y = 0; }
      if (l.kind !== 'raster' && l.kind !== 'group' && l.kind !== 'adjustment' && l.kind !== 'fill') { const c = renderLayerAlone(d, { ...l, mask: undefined }, false); l.kind = 'raster'; l.canvas = rot(c, 0, 0); l.x = 0; l.y = 0; delete l.text; delete l.shape; delete l.smart; }
      l.children?.forEach(fix);
    };
    d.s.layers.forEach(fix); d.s.width = r.w; d.s.height = r.h; d.s.selection = null; d.s.guides = []; clearCaches(); done(d, 'Crop'); return;
  }
  const fix = (l: Layer) => {
    if (l.canvas) {
      if (deletePixels) { const n = makeCanvas(r.w, r.h); ctx2d(n).drawImage(l.canvas, l.x - r.x, l.y - r.y); l.canvas = n; l.x = 0; l.y = 0; }
      else { l.x -= r.x; l.y -= r.y; }
      l.ver++;
    }
    if (l.mask) { l.mask.x -= r.x; l.mask.y -= r.y; }
    if (l.text) { l.text.x -= r.x; l.text.y -= r.y; }
    if (l.shape) l.shape.path = VEC.mapPath(l.shape.path, (x, y) => [x - r.x, y - r.y]);
    if (l.smart) l.smart.quad = l.smart.quad.map((p) => ({ x: p.x - r.x, y: p.y - r.y })) as any;
    l.children?.forEach(fix);
  };
  d.s.layers.forEach(fix);
  d.s.width = r.w; d.s.height = r.h; d.s.selection = null;
  d.s.guides = d.s.guides.map((g) => ({ ...g, pos: g.pos - (g.axis === 'v' ? r.x : r.y) }));
  d.s.notes.forEach((n) => { n.x -= r.x; n.y -= r.y; });
  clearCaches(); done(d, 'Crop');
}
def('crop', (a?: { rect: Rect; delete?: boolean; angle?: number }) => { const d = requireDoc(); const r = a?.rect || (d.s.selection && Sel.maskBounds(d.s.selection)); if (!r) { app.toast('Make a selection to crop to.'); return false; } cropDoc(d, r, a?.delete ?? true, a?.angle || 0); });
def('perspectiveCrop', (a: { quad: Quad; w: number; h: number }) => {
  const d = requireDoc(); const f = flatten(d);
  const { quadToSquare } = TR; const inv = quadToSquare(a.quad);
  void inv;
  // render the quad region into an output rectangle by mapping output -> source with the forward homography
  const { squareToQuad } = TR; const fwd = squareToQuad(a.quad);
  const out = new ImageData(a.w, a.h), src = getData(f), p = [0, 0, 0, 0];
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) { const s = fwd((x + 0.5) / a.w, (y + 0.5) / a.h); FL.sampleBilinear(src.data, f.width, f.height, s.x, s.y, p); const i = (y * a.w + x) * 4; out.data[i] = p[0]; out.data[i + 1] = p[1]; out.data[i + 2] = p[2]; out.data[i + 3] = p[3]; }
  const c = makeCanvas(a.w, a.h); ctx2d(c).putImageData(out, 0, 0);
  d.s.layers = [newLayer('raster', 'Background', { canvas: c })]; d.s.width = a.w; d.s.height = a.h; d.s.selection = null; d.s.activeId = d.s.layers[0].id; d.s.selectedIds = [d.s.activeId];
  clearCaches(); done(d, 'Perspective Crop');
});
import * as TR from './engine/transform';
import * as FL from './engine/filters';
def('trim', (a: { based: 'transparent' | 'topleft' | 'bottomright' }) => {
  const d = requireDoc(); const f = flatten(d); let b: Rect | null;
  if (!a || a.based === 'transparent') b = alphaBounds(f);
  else {
    const dd = getData(f).data, w = f.width, h = f.height, ref = a.based === 'topleft' ? 0 : (w * h - 1) * 4;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (Math.abs(dd[i] - dd[ref]) + Math.abs(dd[i + 1] - dd[ref + 1]) + Math.abs(dd[i + 2] - dd[ref + 2]) + Math.abs(dd[i + 3] - dd[ref + 3]) > 8) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = y; } }
    b = x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  if (b) cropDoc(d, b);
});
def('revealAll', () => {
  const d = requireDoc(); let r: Rect = { x: 0, y: 0, w: d.w, h: d.h };
  walk(d.layers, (l) => { if (l.canvas) { const b = alphaBounds(l.canvas); if (b) r = { x: Math.min(r.x, b.x + l.x), y: Math.min(r.y, b.y + l.y), w: 0, h: 0 }; } });
  let x1 = d.w, y1 = d.h; walk(d.layers, (l) => { if (l.canvas) { const b = alphaBounds(l.canvas); if (b) { x1 = Math.max(x1, b.x + b.w + l.x); y1 = Math.max(y1, b.y + b.h + l.y); } } });
  cropDoc(d, { x: r.x, y: r.y, w: x1 - r.x, h: y1 - r.y }, true);
});
def('mode', (m: string) => {
  const d = requireDoc();
  const conv = (fn: (img: ImageData) => void) => { walk(d.layers, (l) => { if (l.canvas) { l.canvas = own(l.canvas); const im = getData(l.canvas); fn(im); ctx2d(l.canvas).putImageData(im, 0, 0); l.ver++; } if (l.text) { const c = hexToRgb(l.text.color); const v = Math.round(lum(c.r, c.g, c.b)); if (m !== 'rgb' && m !== 'cmyk') l.text.color = `#${v.toString(16).padStart(2, '0').repeat(3)}`; } }); };
  if (m === 'grayscale') conv((i) => desaturate(i.data));
  else if (m === 'bitmap') conv((i) => { const dd = i.data, w = i.width, h = i.height, e = new Float32Array(w * h); for (let p = 0; p < w * h; p++) e[p] = lum(dd[p * 4], dd[p * 4 + 1], dd[p * 4 + 2]); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = y * w + x, o = e[p], n = o < 128 ? 0 : 255, er = o - n; dd[p * 4] = dd[p * 4 + 1] = dd[p * 4 + 2] = n; if (x + 1 < w) e[p + 1] += er * 7 / 16; if (y + 1 < h) { if (x > 0) e[p + w - 1] += er * 3 / 16; e[p + w] += er * 5 / 16; if (x + 1 < w) e[p + w + 1] += er / 16; } } });
  else if (m === 'indexed') { return app.openDialog('indexed'); }
  else if (m === 'duotone') { app.openDialog('adjust', { type: 'gradientMap' }); return false; }
  d.s.mode = m as any; clearCaches(); done(d, `Mode: ${m}`);
});
def('indexed', async (a: { colors: number; dither: boolean }) => {
  const d = requireDoc(); const { quantize, applyPalette } = await import('gifenc');
  walk(d.layers, (l) => {
    if (!l.canvas) return; l.canvas = own(l.canvas); const im = getData(l.canvas);
    const pal = quantize(im.data, a.colors); const idx = applyPalette(im.data, pal);
    for (let i = 0; i < idx.length; i++) { const c = pal[idx[i]]; im.data[i * 4] = c[0]; im.data[i * 4 + 1] = c[1]; im.data[i * 4 + 2] = c[2]; }
    ctx2d(l.canvas).putImageData(im, 0, 0); l.ver++;
  });
  d.s.mode = 'indexed'; clearCaches(); done(d, 'Indexed Color');
});

// ---------------- Layer ----------------
def('newLayer', (name?: string) => { const d = requireDoc(); const l = newLayer('raster', name || d.uniqueName('Layer')); l.canvas = makeCanvas(d.w, d.h); d.addLayer(l); done(d, 'New Layer'); });
def('newGroup', () => { const d = requireDoc(); const g = newLayer('group', d.uniqueName('Group')); d.addLayer(g); done(d, 'New Group'); });
def('groupLayers', () => {
  const d = requireDoc(); const ls = d.selectedLayers(); if (!ls.length) return false;
  const first = d.parentOf(ls[0].id)!; const g = newLayer('group', d.uniqueName('Group'));
  const idx = Math.max(...ls.map((l) => d.parentOf(l.id)!.index));
  for (const l of ls) { const p = d.parentOf(l.id)!; p.list.splice(p.index, 1); }
  g.children = ls.sort((a, b) => 0 * (a.ver - b.ver));
  first.list.splice(Math.min(first.list.length, idx - ls.length + 1), 0, g);
  d.setActive(g.id); done(d, 'Group Layers');
});
def('ungroup', () => {
  const { d, l } = active(); if (l.kind !== 'group') return false;
  const p = d.parentOf(l.id)!; p.list.splice(p.index, 1, ...l.children!); d.setActive(l.children![l.children!.length - 1]?.id || null); done(d, 'Ungroup Layers');
});
function dupLayer(d: Doc, l: Layer): Layer {
  const c: Layer = JSON.parse(JSON.stringify({ ...l, canvas: undefined, mask: undefined, smart: undefined, children: undefined }));
  c.id = uid('L'); c.name = l.name + ' copy';
  if (l.canvas) c.canvas = l.canvas; // shared until edited (frozen by history)
  if (l.mask) c.mask = { ...l.mask };
  if (l.smart) c.smart = { ...l.smart, quad: l.smart.quad.map((p) => ({ ...p })) as any, filters: l.smart.filters.map((f) => ({ ...f, id: uid('F') })) };
  if (l.children) c.children = l.children.map((ch) => { const x = dupLayer(d, ch); x.name = ch.name; return x; });
  return c;
}
def('duplicateLayer', () => {
  const d = requireDoc(); d.snapshot(); // freeze canvases so the copies share safely
  for (const l of d.selectedLayers()) { const c = dupLayer(d, l); const p = d.parentOf(l.id)!; p.list.splice(p.index + 1, 0, c); d.setActive(c.id); }
  done(d, 'Duplicate Layer');
});
def('deleteLayer', () => { const d = requireDoc(); const ls = d.selectedLayers(); if (!ls.length) return false; for (const l of ls) d.removeLayer(l.id); done(d, 'Delete Layer'); });
def('layerViaCopy', (cut?: boolean) => {
  const d = requireDoc(); const p = selectionPixels(d, false); if (!p) return false;
  if (cut) { const t = paintTarget(d); if (t) { const x = ctx2d(t.canvas); x.save(); x.globalCompositeOperation = 'destination-out'; if (d.s.selection) x.drawImage(Sel.maskToAlpha(d.s.selection), -t.ox, -t.oy); else x.fillRect(0, 0, t.canvas.width, t.canvas.height); x.restore(); } }
  const l = newLayer('raster', d.uniqueName('Layer')); l.canvas = p.canvas; l.x = p.x; l.y = p.y; d.addLayer(l);
  done(d, cut ? 'Layer via Cut' : 'Layer via Copy');
});
def('newAdjustment', (t: AdjType) => {
  const d = requireDoc(); const l = newLayer('adjustment', ADJ_LABELS[t] + ' 1', { adj: { type: t, p: ADJ_DEFAULTS[t]() } });
  l.name = d.uniqueName(ADJ_LABELS[t]);
  l.mask = { canvas: d.s.selection ? cloneCanvas(d.s.selection) : Sel.blankMask(d.w, d.h, 255), x: 0, y: 0, bg: d.s.selection ? 0 : 255, enabled: true, linked: true, density: 1, feather: 0 };
  d.addLayer(l); d.s.selection = null; app.panelsOpen.properties = true; done(d, 'New ' + ADJ_LABELS[t] + ' Layer');
});
def('newFill', (a: { type: 'color' | 'gradient' | 'pattern'; color?: string }) => {
  const d = requireDoc();
  const l = newLayer('fill', a.type === 'color' ? d.uniqueName('Color Fill') : a.type === 'gradient' ? d.uniqueName('Gradient Fill') : d.uniqueName('Pattern Fill'), {
    fill: { type: a.type, color: a.color || app.fg, gradient: app.gradient, shape: 'linear', angle: 90, scale: 100, reverse: false, pattern: app.pattern, patScale: 1 },
  });
  if (d.s.selection) { l.mask = { canvas: cloneCanvas(d.s.selection), x: 0, y: 0, bg: 0, enabled: true, linked: true, density: 1, feather: 0 }; d.s.selection = null; }
  d.addLayer(l); done(d, 'New Fill Layer');
});
def('mask', (kind: 'reveal' | 'hide' | 'revealSel' | 'hideSel' | 'delete' | 'apply' | 'toggle' | 'invert' | 'link') => {
  const { d, l } = active();
  if (kind === 'delete') { delete l.mask; app.editMask = false; }
  else if (kind === 'toggle') { if (l.mask) l.mask.enabled = !l.mask.enabled; }
  else if (kind === 'link') { if (l.mask) l.mask.linked = !l.mask.linked; }
  else if (kind === 'invert') { if (l.mask) { const m = d.editableMask(l); m.canvas = Sel.invertMask(m.canvas); m.bg = 255 - m.bg; } }
  else if (kind === 'apply') {
    if (!l.mask || l.kind !== 'raster') return false; const c = d.editable(l), x = ctx2d(c);
    x.save(); x.globalCompositeOperation = 'destination-in'; x.drawImage(Sel.maskToAlpha(l.mask.canvas, l.mask.density), l.mask.x - l.x, l.mask.y - l.y); x.restore(); delete l.mask; app.editMask = false;
  } else {
    if (l.mask && !confirm('Replace the existing mask?')) return false;
    let m: Canvas;
    if ((kind === 'revealSel' || kind === 'hideSel') && d.s.selection) m = kind === 'revealSel' ? cloneCanvas(d.s.selection) : Sel.invertMask(d.s.selection);
    else m = Sel.blankMask(d.w, d.h, kind === 'hide' ? 0 : 255);
    const bg = kind === 'reveal' ? 255 : kind === 'hide' ? 0 : kind === 'hideSel' ? 255 : 0;
    l.mask = { canvas: m, x: 0, y: 0, bg, enabled: true, linked: true, density: 1, feather: 0 };
    if (kind.endsWith('Sel')) d.s.selection = null;
    app.editMask = true;
  }
  l.ver++; done(d, 'Layer Mask');
});
def('clip', () => { const { d, l } = active(); l.clip = !l.clip; done(d, l.clip ? 'Create Clipping Mask' : 'Release Clipping Mask'); });
def('arrange', (dir: 'front' | 'forward' | 'backward' | 'back') => {
  const d = requireDoc(); const ls = d.selectedLayers(); if (!ls.length) return false;
  for (const l of dir === 'forward' || dir === 'front' ? [...ls].reverse() : ls) {
    const p = d.parentOf(l.id)!; p.list.splice(p.index, 1);
    const to = dir === 'front' ? p.list.length : dir === 'back' ? (p.list[0]?.name === 'Background' && !p.parent ? 1 : 0) : dir === 'forward' ? Math.min(p.list.length, p.index + 1) : Math.max(0, p.index - 1);
    p.list.splice(to, 0, l);
  }
  done(d, 'Arrange');
});
export function moveLayerTo(d: Doc, id: string, targetId: string | null, where: 'above' | 'below' | 'inside') {
  const l = d.find(id); if (!l || id === targetId) return;
  // prevent moving a group into itself
  let bad = false; if (l.children && targetId) walk(l.children, (c) => { if (c.id === targetId) bad = true; }); if (bad) return;
  const p = d.parentOf(id)!; p.list.splice(p.index, 1);
  if (!targetId) { d.s.layers.push(l); }
  else if (where === 'inside') { const g = d.find(targetId)!; g.children!.push(l); }
  else { const t = d.parentOf(targetId)!; t.list.splice(where === 'above' ? t.index + 1 : t.index, 0, l); }
  done(d, 'Move Layer');
}
def('align', (how: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' | 'dist-h' | 'dist-v') => {
  const d = requireDoc(); const ls = d.selectedLayers().filter((l) => !l.locks.position && !l.locks.all);
  const ref: Rect = d.s.selection ? Sel.maskBounds(d.s.selection)! : ls.length > 1 ? ls.map((l) => layerBounds(d, l)!).filter(Boolean).reduce((a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) })) : { x: 0, y: 0, w: d.w, h: d.h };
  const items = ls.map((l) => ({ l, b: layerBounds(d, l) })).filter((x) => x.b) as { l: Layer; b: Rect }[];
  if (how.startsWith('dist')) {
    const hz = how === 'dist-h'; items.sort((a, b) => (hz ? a.b.x + a.b.w / 2 - b.b.x - b.b.w / 2 : a.b.y + a.b.h / 2 - b.b.y - b.b.h / 2));
    if (items.length < 3) return false;
    const c0 = hz ? items[0].b.x + items[0].b.w / 2 : items[0].b.y + items[0].b.h / 2, c1 = hz ? items[items.length - 1].b.x + items[items.length - 1].b.w / 2 : items[items.length - 1].b.y + items[items.length - 1].b.h / 2;
    items.forEach((it, i) => { const target = c0 + ((c1 - c0) * i) / (items.length - 1), cur = hz ? it.b.x + it.b.w / 2 : it.b.y + it.b.h / 2; offsetLayer(it.l, hz ? target - cur : 0, hz ? 0 : target - cur); });
  } else for (const { l, b } of items) {
    let dx = 0, dy = 0;
    if (how === 'left') dx = ref.x - b.x; if (how === 'right') dx = ref.x + ref.w - b.x - b.w; if (how === 'hcenter') dx = ref.x + ref.w / 2 - b.x - b.w / 2;
    if (how === 'top') dy = ref.y - b.y; if (how === 'bottom') dy = ref.y + ref.h - b.y - b.h; if (how === 'vcenter') dy = ref.y + ref.h / 2 - b.y - b.h / 2;
    offsetLayer(l, Math.round(dx), Math.round(dy));
  }
  done(d, 'Align');
});
export function offsetLayer(l: Layer, dx: number, dy: number) {
  if (!dx && !dy) return;
  if (l.canvas && l.kind === 'raster') { l.x += dx; l.y += dy; }
  if (l.mask && l.mask.linked) { l.mask.x += dx; l.mask.y += dy; }
  if (l.text) { l.text.x += dx; l.text.y += dy; }
  if (l.shape) l.shape.path = VEC.mapPath(l.shape.path, (x, y) => [x + dx, y + dy]);
  if (l.smart) l.smart.quad = l.smart.quad.map((p) => ({ x: p.x + dx, y: p.y + dy })) as any;
  if (l.fill && l.mask && !l.mask.linked) { /* fills cover everything */ }
  if (l.artboard) { l.artboard.x += dx; l.artboard.y += dy; }
  if (l.vmask) l.vmask.path = VEC.mapPath(l.vmask.path, (x, y) => [x + dx, y + dy]);
  l.children?.forEach((c) => offsetLayer(c, dx, dy));
  l.ver++;
}
def('mergeDown', () => {
  const { d, l } = active(); const p = d.parentOf(l.id)!; const below = p.list[p.index - 1];
  if (!below) { app.toast('There is no layer below to merge into.'); return false; }
  if (!below.visible) { app.toast('The layer below is hidden.'); return false; }
  const c = makeCanvas(d.w, d.h); renderAll(d, [below, l], c);
  below.kind = 'raster'; below.canvas = c; below.x = 0; below.y = 0; delete below.mask; delete below.text; delete below.shape; delete below.smart; delete below.fill; delete below.adj; delete below.styles; delete below.children;
  below.opacity = 1; below.blend = 'normal'; below.fillOpacity = 1; below.ver++;
  p.list.splice(p.index, 1); d.setActive(below.id); clearCaches(); done(d, 'Merge Down');
});
function renderAll(d: Doc, ls: Layer[], c: Canvas) { RR.renderList(d, ls, c, { x: 0, y: 0, w: d.w, h: d.h }); }
import * as RR from './engine/render';
def('mergeSelected', () => {
  const d = requireDoc(); const ls = d.selectedLayers(); if (ls.length < 2) return commands.mergeDown();
  const all = flatLayers(d.layers), ordered = all.filter((l) => ls.includes(l));
  const c = makeCanvas(d.w, d.h); renderAll(d, ordered, c);
  const top = ordered[ordered.length - 1]; const p = d.parentOf(top.id)!;
  const m = newLayer('raster', top.name, { canvas: c });
  p.list.splice(p.index + 1, 0, m); for (const l of ordered) d.removeLayer(l.id); d.setActive(m.id); clearCaches(); done(d, 'Merge Layers');
});
def('mergeVisible', () => {
  const d = requireDoc(); const c = makeCanvas(d.w, d.h); renderAll(d, d.layers, c);
  const hidden = d.layers.filter((l) => !l.visible);
  const m = newLayer('raster', 'Merged', { canvas: c }); d.s.layers = [m, ...hidden]; d.setActive(m.id); clearCaches(); done(d, 'Merge Visible');
});
def('stampVisible', () => { const d = requireDoc(); const c = makeCanvas(d.w, d.h); renderAll(d, d.layers, c); const m = newLayer('raster', d.uniqueName('Layer'), { canvas: c }); d.s.layers.push(m); d.setActive(m.id); done(d, 'Stamp Visible'); });
def('flatten', () => {
  const d = requireDoc(); const c = flatten(d, '#ffffff'); const l = newLayer('raster', 'Background', { canvas: c, locks: { pixels: false, position: true, transparency: true, all: false } });
  d.s.layers = [l]; d.setActive(l.id); clearCaches(); done(d, 'Flatten Image');
});
def('rasterize', (what?: string) => {
  const d = requireDoc();
  for (const l of d.selectedLayers()) {
    if (what === 'style' && l.styles) { const c = renderLayerAlone(d, { ...l, mask: undefined }, true); l.kind = 'raster'; l.canvas = c; l.x = 0; l.y = 0; delete l.styles; delete l.text; delete l.shape; delete l.smart; l.ver++; continue; }
    if (l.kind === 'text' || l.kind === 'shape' || l.kind === 'smart' || l.kind === 'fill') rasterizeLayer(d, l);
  }
  clearCaches(); done(d, 'Rasterize Layer');
});
def('toSmart', () => {
  const d = requireDoc(); const ls = d.selectedLayers(); if (!ls.length) return false;
  const all = flatLayers(d.layers).filter((l) => ls.includes(l));
  const c = makeCanvas(d.w, d.h); renderAll(d, all, c);
  const b = alphaBounds(c) || { x: 0, y: 0, w: d.w, h: d.h }; const src = makeCanvas(b.w, b.h); ctx2d(src).drawImage(c, -b.x, -b.y);
  const top = all[all.length - 1], p = d.parentOf(top.id)!;
  const s = newLayer('smart', top.name, { smart: { source: src, name: top.name, quad: [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }], filters: [] } });
  p.list.splice(p.index + 1, 0, s); for (const l of all) d.removeLayer(l.id); d.setActive(s.id); done(d, 'Convert to Smart Object');
});
def('editSmart', () => {
  const { d, l } = active(); if (!l.smart) return false;
  const n = docFromCanvas(l.smart.name.replace(/\.[^.]+$/, '') + ' (contents)', cloneCanvas(l.smart.source), 'Layer 0');
  (n as any).smartParent = { docId: d.id, layerId: l.id }; app.addDoc(n);
  app.toast('Edit the contents, then use Layer > Smart Objects > Update Parent to apply them.');
});
def('updateSmartParent', () => {
  const d = requireDoc(); const sp = (d as any).smartParent; if (!sp) { app.toast('This document is not smart object contents.'); return false; }
  const parent = app.docs.find((x) => x.id === sp.docId); const l = parent?.find(sp.layerId); if (!parent || !l?.smart) return false;
  l.smart.source = flatten(d); l.ver++; clearCaches(l.id); parent.commit('Update Smart Object'); app.activeId = parent.id; app.emit();
});
def('replaceSmart', async () => {
  const { d, l } = active(); if (!l.smart) return false; const f = (await pickFiles('image/*', false))[0]; if (!f) return false;
  l.smart.source = await fileToCanvas(f, f.name); l.smart.name = f.name; l.ver++; clearCaches(l.id); done(d, 'Replace Contents');
});
def('setStyles', (a: { styles: LayerStyles | undefined; label?: string }) => { const { d, l } = active(); l.styles = a.styles; l.stylesOn = true; l.ver++; done(d, a.label || 'Layer Style'); });
let copiedStyle: LayerStyles | null = null;
def('copyStyle', () => { const { l } = active(); copiedStyle = l.styles ? JSON.parse(JSON.stringify(l.styles)) : null; });
def('pasteStyle', () => { const d = requireDoc(); if (!copiedStyle) return false; for (const l of d.selectedLayers()) { l.styles = JSON.parse(JSON.stringify(copiedStyle)); l.ver++; } done(d, 'Paste Layer Style'); });
def('clearStyle', () => { const d = requireDoc(); for (const l of d.selectedLayers()) { delete l.styles; l.ver++; } done(d, 'Clear Layer Style'); });
def('quickStyle', (name: string) => {
  const s = defaultStyles();
  const presets: Record<string, Partial<LayerStyles>> = {
    'Soft Shadow': { dropShadow: { ...s.dropShadow, enabled: true, distance: 6, size: 18, opacity: 0.45 } },
    'Glow': { outerGlow: { ...s.outerGlow, enabled: true, color: '#9fd3ff', size: 22 } },
    'Outline': { stroke: { ...s.stroke, enabled: true, size: 4, color: '#ffffff' } },
    'Embossed': { bevel: { ...s.bevel, enabled: true, size: 10 }, dropShadow: { ...s.dropShadow, enabled: true, distance: 3, size: 6, opacity: 0.4 } },
    'Rain Glass': { bevel: { ...s.bevel, enabled: true, size: 14, soften: 4, altitude: 50 }, innerGlow: { ...s.innerGlow, enabled: true, color: '#ffffff', size: 8, opacity: 0.5 }, gradientOverlay: { ...s.gradientOverlay, enabled: true, opacity: 0.25, blend: 'overlay' } },
    'Neon': { stroke: { ...s.stroke, enabled: true, size: 3, color: '#ff4fd8' }, outerGlow: { ...s.outerGlow, enabled: true, color: '#ff4fd8', size: 26, opacity: 0.9 } },
    'Sticker': { stroke: { ...s.stroke, enabled: true, size: 10, color: '#ffffff' }, dropShadow: { ...s.dropShadow, enabled: true, distance: 4, size: 8, opacity: 0.35 } },
  };
  return commands.setStyles({ styles: presets[name] as LayerStyles, label: 'Style: ' + name });
});
def('lockAll', () => { const d = requireDoc(); for (const l of d.selectedLayers()) l.locks.all = !l.locks.all; done(d, 'Lock Layers'); });
def('toggleVisibility', (id?: string) => { const d = requireDoc(); const l = id ? d.find(id) : d.active; if (!l) return false; l.visible = !l.visible; done(d, l.visible ? 'Show Layer' : 'Hide Layer'); });
def('layerProps', (a: Partial<Layer> & { id?: string }) => { const d = requireDoc(); const l = a.id ? d.find(a.id) : d.active; if (!l) return false; const { id, ...rest } = a; void id; Object.assign(l, rest); l.ver++; done(d, 'Layer Properties'); });
def('linkLayers', () => { const d = requireDoc(); const ls = d.selectedLayers(); const id = ls.every((l) => l.linkId && l.linkId === ls[0].linkId) ? undefined : uid('k'); ls.forEach((l) => { l.linkId = id; }); done(d, id ? 'Link Layers' : 'Unlink Layers'); });
def('layerComp', (a: { op: 'new' | 'apply' | 'update' | 'delete'; id?: string; name?: string }) => {
  const d = requireDoc();
  const capture = () => { const o: any = {}; walk(d.layers, (l) => { o[l.id] = { visible: l.visible, x: l.x, y: l.y, opacity: l.opacity, stylesOn: l.stylesOn }; }); return o; };
  if (a.op === 'new') d.s.comps.push({ id: uid('C'), name: a.name || `Layer Comp ${d.s.comps.length + 1}`, layers: capture() });
  else if (a.op === 'update') { const c = d.s.comps.find((x) => x.id === a.id); if (c) c.layers = capture(); }
  else if (a.op === 'delete') d.s.comps = d.s.comps.filter((x) => x.id !== a.id);
  else { const c = d.s.comps.find((x) => x.id === a.id); if (!c) return false; walk(d.layers, (l) => { const s = c.layers[l.id]; if (s) { const dx = s.x - l.x, dy = s.y - l.y; l.visible = s.visible; l.opacity = s.opacity; l.stylesOn = s.stylesOn; if (l.kind === 'raster') { l.x = s.x; l.y = s.y; } else if (dx || dy) void 0; l.ver++; } }); }
  done(d, 'Layer Comp');
});

// ---------------- Select ----------------
function setSel(d: Doc, m: Canvas | null, label: string) { if (d.s.selection) d.lastSelection = d.s.selection; d.s.selection = m && !Sel.isEmpty(m) ? m : null; done(d, label); }
def('selectAll', () => { const d = requireDoc(); setSel(d, Sel.blankMask(d.w, d.h, 255), 'Select All'); });
def('deselect', () => { const d = requireDoc(); if (!d.s.selection) return false; setSel(d, null, 'Deselect'); });
def('reselect', () => { const d = requireDoc(); if (!d.lastSelection) return false; setSel(d, d.lastSelection, 'Reselect'); });
def('inverse', () => { const d = requireDoc(); setSel(d, d.s.selection ? Sel.invertMask(d.s.selection) : Sel.blankMask(d.w, d.h, 255), 'Select Inverse'); });
def('selectAllLayers', () => { const d = requireDoc(); d.s.selectedIds = flatLayers(d.layers).map((l) => l.id); app.emit(); return false; });
def('modify', (a: { op: 'expand' | 'contract' | 'feather' | 'border' | 'smooth'; px: number }) => {
  const d = requireDoc(); const s = d.s.selection; if (!s) { app.toast('Make a selection first.'); return false; }
  const f = { expand: Sel.expandMask, contract: Sel.contractMask, feather: Sel.featherMask, border: Sel.borderMask, smooth: Sel.smoothMask }[a.op];
  setSel(d, f(s, a.px), a.op[0].toUpperCase() + a.op.slice(1));
});
def('grow', (similar?: boolean) => {
  const d = requireDoc(); const s = d.s.selection; if (!s) return false;
  const img = getData(flatten(d)), sd = getData(s).data, seeds: { x: number; y: number }[] = [];
  for (let y = 0; y < d.h; y += 3) for (let x = 0; x < d.w; x += 3) if (sd[(y * d.w + x) * 4] > 200) seeds.push({ x, y });
  const sample = seeds.filter((_, i) => i % Math.max(1, Math.floor(seeds.length / 60)) === 0).slice(0, 60);
  const m = Sel.colorMask(img, sample, app.opts.tolerance, !similar);
  const c = Sel.writeChannel(m, d.w, d.h); setSel(d, Sel.combine(s, c, 'add', d.w, d.h), similar ? 'Similar' : 'Grow');
});
def('colorRange', (a: { mode: string; colors: [number, number, number][]; fuzz: number; invert: boolean }) => {
  const d = requireDoc(); const img = getData(flatten(d)); setSel(d, Sel.writeChannel(Sel.colorRange(img, a.mode, a.colors, a.fuzz, a.invert), d.w, d.h), 'Color Range');
});
def('selectSubject', async (a?: { quick?: boolean }) => {
  const d = requireDoc();
  if (!a?.quick && app.prefs?.aiSubject !== false) {
    try {
      const AI = await import('./engine/ai');
      const m = await AI.subjectMask(flatten(d), (text, frac) => app.setBusy({ text, frac }));
      app.setBusy(null); setSel(d, m, 'Select Subject'); return;
    } catch (e: any) { app.setBusy(null); app.toast((e?.message || 'The AI model could not run.') + ' Using quick selection instead.', 'error'); }
  }
  const img = getData(flatten(d)); setSel(d, Sel.featherMask(Sel.writeChannel(Sel.selectSubject(img), d.w, d.h), 1.5), 'Select Subject');
});
def('removeBackground', async () => {
  const d = requireDoc(); const l = d.active;
  if (!l || l.kind === 'group' || l.kind === 'adjustment') { app.toast('Select a picture layer first.'); return false; }
  const saved = d.s.selection; await commands.selectSubject();
  if (!d.s.selection) { d.s.selection = saved; app.toast('No subject was found.'); return false; }
  if (l.locks.all || l.locks.position || l.name === 'Background') { l.locks = { ...l.locks, all: false, position: false, pixels: false }; }
  await commands.mask('revealSel'); d.s.selection = saved; d.commit('Remove Background'); app.emit();
});
def('selectSky', () => { const d = requireDoc(); const img = getData(flatten(d)); setSel(d, Sel.featherMask(Sel.writeChannel(Sel.selectSky(img), d.w, d.h), 2), 'Select Sky'); });
def('selectLayerPixels', (id?: string) => {
  const d = requireDoc(); const l = id ? d.find(id) : d.active; if (!l) return false;
  const c = renderLayerAlone(d, l, false), m = makeCanvas(d.w, d.h), dd = getData(c), o = new ImageData(d.w, d.h);
  for (let i = 0; i < dd.data.length; i += 4) { o.data[i] = o.data[i + 1] = o.data[i + 2] = dd.data[i + 3]; o.data[i + 3] = 255; }
  ctx2d(m).putImageData(o, 0, 0); setSel(d, m, 'Load Selection');
});
def('saveSelection', (name?: string) => { const d = requireDoc(); if (!d.s.selection) return false; d.s.channels.push({ id: uid('A'), name: name || `Alpha ${d.s.channels.length + 1}`, canvas: d.s.selection }); done(d, 'Save Selection'); });
def('loadSelection', (a: { id: string; op?: Sel.SelOp; invert?: boolean }) => {
  const d = requireDoc(); const ch = d.s.channels.find((c) => c.id === a.id); if (!ch) return false;
  let m = ch.canvas; if (a.invert) m = Sel.invertMask(m); setSel(d, Sel.combine(d.s.selection, m, a.op || 'new', d.w, d.h), 'Load Selection');
});
def('deleteChannel', (id: string) => { const d = requireDoc(); d.s.channels = d.s.channels.filter((c) => c.id !== id); done(d, 'Delete Channel'); });
def('quickMask', () => {
  const d = requireDoc(); d.quickMask = !d.quickMask;
  if (d.quickMask && !d.s.selection) d.s.selection = Sel.blankMask(d.w, d.h, 0);
  if (!d.quickMask && d.s.selection && Sel.isEmpty(d.s.selection)) d.s.selection = null;
  done(d, d.quickMask ? 'Enter Quick Mask' : 'Exit Quick Mask');
});
def('selectAndMask', (a: { smooth: number; feather: number; contrast: number; shift: number; output: 'selection' | 'mask' | 'layer' }) => {
  const d = requireDoc(); let m = d.s.selection; if (!m) { app.toast('Make a selection first.'); return false; }
  if (a.smooth) m = Sel.smoothMask(m, a.smooth);
  if (a.shift > 0) m = Sel.expandMask(m, (a.shift / 100) * 10); else if (a.shift < 0) m = Sel.contractMask(m, (-a.shift / 100) * 10);
  if (a.feather) m = Sel.featherMask(m, a.feather);
  if (a.contrast) { const ch = Sel.readChannel(m), k = 1 + a.contrast / 25; for (let i = 0; i < ch.length; i++) ch[i] = (ch[i] - 128) * k + 128; m = Sel.writeChannel(ch, d.w, d.h); }
  if (a.output === 'selection') return setSel(d, m, 'Select and Mask');
  d.s.selection = m;
  if (a.output === 'mask') return commands.mask('revealSel');
  return commands.layerViaCopy();
});
def('pathToSelection', (a: { id: string; feather?: number; op?: Sel.SelOp }) => {
  const d = requireDoc(); const p = d.s.paths.find((x) => x.id === a.id); if (!p) return false;
  const m = Sel.shapeMask(d.w, d.h, (x) => x.fill(pathToPath2D(p.path)), a.feather || 0);
  setSel(d, Sel.combine(d.s.selection, m, a.op || 'new', d.w, d.h), 'Make Selection');
});
def('fillPath', (id: string) => { const d = requireDoc(); const p = d.s.paths.find((x) => x.id === id); const t = paintTarget(d); if (!p || !t) return false; const x = ctx2d(t.canvas); x.save(); x.translate(-t.ox, -t.oy); x.fillStyle = app.fg; x.fill(pathToPath2D(p.path)); x.restore(); if (t.layer) t.layer.ver++; done(d, 'Fill Path'); });
def('strokePath', (id: string) => {
  const d = requireDoc(); const p = d.s.paths.find((x) => x.id === id); const t = paintTarget(d); if (!p || !t) return false;
  const x = ctx2d(t.canvas); x.save(); x.translate(-t.ox, -t.oy); x.strokeStyle = app.fg; x.lineWidth = Math.max(1, app.brush.size * 0.3); x.lineCap = 'round'; x.lineJoin = 'round'; x.globalAlpha = app.brush.opacity; x.stroke(pathToPath2D(p.path)); x.restore();
  if (t.layer) t.layer.ver++; done(d, 'Stroke Path');
});
def('selectionToPath', () => {
  const d = requireDoc(); if (!d.s.selection) return false;
  // trace the outline with a coarse marching-squares contour of the biggest region
  const ch = Sel.readChannel(d.s.selection), w = d.w, h = d.h, step = Math.max(2, Math.round(Math.max(w, h) / 400));
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && ch[y * w + x] >= 128;
  let sx = -1, sy = -1; outer: for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (on(x, y)) { sx = x; sy = y; break outer; }
  if (sx < 0) return false;
  const pts: { x: number; y: number }[] = []; let x = sx, y = sy, dir = 0; const dirs = [[step, 0], [0, step], [-step, 0], [0, -step]];
  for (let i = 0; i < 20000; i++) {
    pts.push({ x, y });
    for (let k = 0; k < 4; k++) { const nd = (dir + 3 + k) % 4, nx = x + dirs[nd][0], ny = y + dirs[nd][1]; if (on(nx, ny)) { dir = nd; x = nx; y = ny; break; } }
    if (x === sx && y === sy && i > 2) break;
  }
  const simplified = pts.filter((_, i) => i % 3 === 0);
  d.s.paths.push({ id: uid('P'), name: `Path ${d.s.paths.length + 1}`, path: { subpaths: [{ closed: true, points: simplified.map((p) => VEC.pp(p.x, p.y)) }] } });
  done(d, 'Make Work Path');
});

// ---------------- Filter ----------------
def('filter', (a: { id: string; params?: any }) => {
  const def0 = FILTER_MAP[a.id]; if (!def0) return false;
  if (!a.params && def0.params.length) { app.openDialog('filter', { id: a.id }); return false; }
  const d = requireDoc(); const l = d.active;
  const params = a.params || {};
  app.lastFilter = { id: a.id, params };
  if (l?.kind === 'smart' && !app.editMask) {
    l.smart!.filters.push({ id: uid('F'), name: def0.name, filter: a.id, params, enabled: true, opacity: 1, blend: 'normal' }); l.ver++; clearCaches(l.id);
    done(d, def0.name); return;
  }
  const margin = def0.generates ? 0 : 64;
  return applyToPixels(def0.name, (img) => def0.run(img, params, { fg: app.fg, bg: app.bg, scale: 1 }), { margin });
});
def('lastFilter', () => { if (!app.lastFilter) return false; return commands.filter(app.lastFilter); });
def('removeSmartFilter', (id: string) => { const { d, l } = active(); if (!l.smart) return false; l.smart.filters = l.smart.filters.filter((f) => f.id !== id); l.ver++; done(d, 'Delete Smart Filter'); });
def('toggleSmartFilter', (id: string) => { const { d, l } = active(); const f = l.smart?.filters.find((x) => x.id === id); if (!f) return false; f.enabled = !f.enabled; l.ver++; done(d, 'Toggle Smart Filter'); });
def('applyCanvas', (a: { canvas: Canvas; label: string; layerId: string; x?: number; y?: number }) => {
  const d = requireDoc(); const l = d.find(a.layerId); if (!l) return false; l.canvas = a.canvas; if (a.x !== undefined) { l.x = a.x; l.y = a.y!; } l.ver++; done(d, a.label);
});

// ---------------- View ----------------
def('toggle', (k: keyof typeof app.view) => { (app.view as any)[k] = !(app.view as any)[k]; app.emit(); return false; });
def('clearGuides', () => { const d = requireDoc(); d.s.guides = []; done(d, 'Clear Guides'); });
def('newGuide', (a: { axis: 'h' | 'v'; pos: number }) => { const d = requireDoc(); d.s.guides.push(a); done(d, 'New Guide'); });
def('guideLayout', (a: { cols: number; rows: number; margin: number; gutter: number }) => {
  const d = requireDoc(); const m = a.margin, g = a.gutter;
  const add = (axis: 'h' | 'v', pos: number) => d.s.guides.push({ axis, pos: Math.round(pos) });
  add('v', m); add('v', d.w - m); add('h', m); add('h', d.h - m);
  const cw = (d.w - 2 * m - g * (a.cols - 1)) / a.cols; for (let i = 1; i < a.cols; i++) { add('v', m + i * cw + (i - 1) * g); if (g) add('v', m + i * cw + i * g); }
  const rh = (d.h - 2 * m - g * (a.rows - 1)) / a.rows; for (let i = 1; i < a.rows; i++) { add('h', m + i * rh + (i - 1) * g); if (g) add('h', m + i * rh + i * g); }
  done(d, 'New Guide Layout');
});

// ---------------- Actions ----------------
def('playAction', async (id: string) => {
  const a = app.actions.find((x) => x.id === id); if (!a) return false;
  const rec = app.recording; app.recording = null;
  try { for (const s of a.steps) await run(s.cmd, s.args); } finally { app.recording = rec; }
  app.toast(`Played "${a.name}"`);
});
def('batch', async (a: { actionId: string; fmt: ExportFormat }) => {
  const files = await pickFiles('image/*,.psd,.monsoon', true); if (!files.length) return false;
  const JSZip = (await import('jszip')).default; const zip = new JSZip(); const keep = app.activeId;
  for (const f of files) {
    const d = await openFile(f); app.addDoc(d);
    await commands.playAction(a.actionId);
    zip.file(`${d.name}.${EXT[a.fmt]}`, await exportDoc(d, a.fmt)); app.closeDoc(d.id);
  }
  app.activeId = keep; download(await zip.generateAsync({ type: 'blob' }), 'batch.zip'); app.emit();
});

export const ADJ_TYPES = Object.keys(ADJ_DEFAULTS) as AdjType[];
export { renderGradient, inpaint, Sel };

// ---------------- Artboards ----------------
export const ARTBOARD_PRESETS: [string, number, number][] = [
  ['Phone 1179 × 2556', 1179, 2556], ['Phone 1080 × 1920', 1080, 1920], ['Tablet 2048 × 2732', 2048, 2732], ['Web 1920 × 1080', 1920, 1080], ['Web 1440 × 900', 1440, 900],
  ['Square post 1080', 1080, 1080], ['Portrait post 1080 × 1350', 1080, 1350], ['Story 1080 × 1920', 1080, 1920], ['Banner 1200 × 628', 1200, 628], ['Icon 1024', 1024, 1024], ['A4 2480 × 3508', 2480, 3508],
];
export const artboards = (d: Doc) => flatLayers(d.layers).filter((l) => l.artboard);
function growCanvas(d: Doc, W: number, H: number) {
  if (W <= d.w && H <= d.h) return;
  const dx = 0, dy = 0; d.s.width = Math.max(W, d.w); d.s.height = Math.max(H, d.h); void dx; void dy;
  clearCaches();
}
def('newArtboard', (a: { rect?: Rect; w?: number; h?: number; name?: string; bg?: string | null } = {}) => {
  const d = requireDoc(); const abs = artboards(d);
  let r = a.rect;
  if (!r) {
    const w = a.w || d.w, h = a.h || d.h;
    if (!abs.length && !a.w) r = { x: 0, y: 0, w: d.w, h: d.h };
    else { const right = abs.length ? Math.max(...abs.map((l) => l.artboard!.x + l.artboard!.w)) + 100 : 0; r = { x: right, y: 0, w, h }; }
  }
  r = { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) };
  growCanvas(d, r.x + r.w, r.y + r.h);
  const g = newLayer('group', a.name || `Artboard ${abs.length + 1}`, { blend: 'normal', artboard: { ...r, bg: a.bg === undefined ? '#ffffff' : a.bg } });
  d.s.layers.push(g); d.setActive(g.id); done(d, 'New Artboard');
  setTimeout(() => commands.fit?.(), 0);
});
def('artboardFromLayers', () => {
  const d = requireDoc(); const ls = d.selectedLayers().filter((l) => !l.artboard); if (!ls.length) return false;
  let b: Rect | null = null; for (const l of ls) { const r = layerBounds(d, l); if (r) b = b ? { x: Math.min(b.x, r.x), y: Math.min(b.y, r.y), w: Math.max(b.x + b.w, r.x + r.w) - Math.min(b.x, r.x), h: Math.max(b.y + b.h, r.y + r.h) - Math.min(b.y, r.y) } : r; }
  const r = b || { x: 0, y: 0, w: d.w, h: d.h };
  const g = newLayer('group', `Artboard ${artboards(d).length + 1}`, { blend: 'normal', artboard: { x: r.x, y: r.y, w: r.w, h: r.h, bg: null } });
  const first = d.parentOf(ls[0].id)!; const idx = first.index;
  for (const l of ls) { const p = d.parentOf(l.id)!; p.list.splice(p.index, 1); }
  g.children = ls.reverse().reverse(); d.s.layers.splice(Math.min(idx, d.s.layers.length), 0, g); d.setActive(g.id); done(d, 'Artboard from Layers');
});
def('setArtboard', (a: { id?: string; x?: number; y?: number; w?: number; h?: number; bg?: string | null; name?: string }) => {
  const d = requireDoc(); const l = d.find(a.id || d.s.activeId); if (!l?.artboard) return false;
  const ab = l.artboard; if (a.x !== undefined || a.y !== undefined) offsetLayer(l, Math.round((a.x ?? ab.x) - ab.x), Math.round((a.y ?? ab.y) - ab.y));
  if (a.w) ab.w = Math.round(a.w); if (a.h) ab.h = Math.round(a.h); if (a.bg !== undefined) ab.bg = a.bg; if (a.name) l.name = a.name;
  growCanvas(d, ab.x + ab.w, ab.y + ab.h); l.ver++; done(d, 'Edit Artboard');
});
def('exportArtboards', async (a: { fmt?: ExportFormat } = {}) => {
  const d = requireDoc(); const abs = artboards(d); if (!abs.length) { app.toast('This document has no artboards.'); return false; }
  const fmt = a.fmt || 'png'; const JSZip = (await import('jszip')).default; const zip = new JSZip(); const { exportCanvas } = await import('./engine/io');
  for (const l of abs) { const ab = l.artboard!; const full = flatten(d, undefined, [{ ...l, visible: true }]); const c = makeCanvas(ab.w, ab.h); ctx2d(c).drawImage(full, -ab.x, -ab.y); zip.file(`${l.name.replace(/[^\w\- ]+/g, '_')}.${EXT[fmt]}`, await exportCanvas(c, fmt)); }
  download(await zip.generateAsync({ type: 'blob' }), d.name + '-artboards.zip'); return false;
});

// ---------------- Vector masks ----------------
def('vectorMask', (kind: 'reveal' | 'fromPath' | 'delete' | 'toggle' | 'rasterize' | 'fromShape') => {
  const { d, l } = active();
  if (kind === 'delete') delete l.vmask;
  else if (kind === 'toggle') { if (l.vmask) l.vmask.enabled = !l.vmask.enabled; }
  else if (kind === 'rasterize') {
    if (!l.vmask) return false; const m = Sel.shapeMask(d.w, d.h, (x) => { x.fillStyle = '#fff'; x.fill(pathToPath2D(l.vmask!.path), 'evenodd'); }, l.vmask.feather);
    if (l.mask) { const mm = d.editableMask(l); const x = ctx2d(mm.canvas); x.globalCompositeOperation = 'multiply'; x.drawImage(m, -mm.x, -mm.y); x.globalCompositeOperation = 'source-over'; }
    else l.mask = { canvas: m, x: 0, y: 0, bg: 0, enabled: true, linked: true, density: l.vmask.density, feather: 0 };
    delete l.vmask;
  } else {
    let path: any;
    if (kind === 'fromPath') { const p = (d as any).activePath ? d.s.paths.find((x) => x.id === (d as any).activePath) : d.s.paths.find((x) => x.work) || d.s.paths[d.s.paths.length - 1]; if (!p) { app.toast('Draw a path with the Pen tool (Path mode) first.'); return false; } path = JSON.parse(JSON.stringify(p.path)); }
    else { const b = layerBounds(d, l) || { x: 0, y: 0, w: d.w, h: d.h }; path = VEC.rectPath(b, 0); }
    l.vmask = { path, enabled: true, feather: 0, density: 1 };
  }
  l.ver++; clearCaches(l.id); done(d, 'Vector Mask');
});

// ---------- content-aware scale ----------
import * as DFM from './engine/deform';
commands.contentAwareScale = (a: { w: number; h: number; protectSel?: boolean; skin?: boolean }) => {
  const d = requireDoc(); const l = d.active;
  if (!l || l.kind !== 'raster' || !l.canvas) { app.toast('Content-Aware Scale works on a pixel layer. Rasterize it first.', 'error'); return false; }
  if (l.locks.all || l.locks.pixels) { app.toast('That layer is locked.', 'error'); return false; }
  const c = l.canvas, img = getData(c);
  let prot: Uint8ClampedArray | null = null;
  if (a.protectSel && d.s.selection) {
    const m = makeCanvas(c.width, c.height); ctx2d(m).drawImage(d.s.selection, -l.x, -l.y);
    const md = getData(m).data; prot = new Uint8ClampedArray(c.width * c.height); for (let i = 0; i < prot.length; i++) prot[i] = md[i * 4];
  }
  const out = DFM.seamCarve(img, a.w, a.h, prot, !!a.skin);
  const n = makeCanvas(out.width, out.height); ctx2d(n).putImageData(out, 0, 0);
  l.canvas = n; l.ver++;
  if (a.protectSel) d.s.selection = null;
  clearCaches(); d.commit('Content-Aware Scale'); app.emit(); return true;
};
