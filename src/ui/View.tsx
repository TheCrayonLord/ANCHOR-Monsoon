// The canvas viewport: draws the composite with zoom, pan and rotation, overlays, and routes pointer input to tools.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { app } from '../app';
import type { Doc } from '../engine/doc';
import { flatLayers } from '../engine/doc';
import { renderDoc } from '../engine/render';
import { outlinePath } from '../engine/selection';
import { Canvas, ctx2d, makeCanvas, Pt, Rect, getData } from '../engine/util';
import { handlerFor, ts, ViewApi, PEvt, BRUSH_TOOLS } from '../tools';
import * as V from '../engine/vector';
import { openFiles, run } from '../cmds';

const composites = new WeakMap<Doc, { canvas: Canvas; version: number; w: number; h: number }>();
export function getComposite(d: Doc): Canvas {
  let c = composites.get(d);
  if (!c) { c = { canvas: makeCanvas(d.w, d.h), version: -1, w: 0, h: 0 }; composites.set(d, c); }
  if (c.version !== d.version || c.w !== d.w || c.h !== d.h) { renderDoc(d, c.canvas, c.w === d.w && c.h === d.h && !d.full ? d.dirtyRect : null); c.version = d.version; c.w = d.w; c.h = d.h; d.dirtyRect = null; d.full = false; }
  return c.canvas;
}
const antsCache = new WeakMap<Canvas, Path2D>();
const qmCache = new WeakMap<Canvas, { v: number; c: Canvas }>();
let checker: CanvasPattern | null = null;

export function View() {
  useSyncExternalStore(app.subscribe, app.getVersion);
  const d = app.doc;
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const rulerH = useRef<HTMLCanvasElement>(null), rulerV = useRef<HTMLCanvasElement>(null);
  const [textEdit, setTextEdit] = useState<string | null>(null);
  const st = useRef({ raf: 0, ants: 0, space: false, pointers: new Map<number, Pt>(), pinch: null as null | { dist: number; zoom: number; mid: Pt }, hover: null as Pt | null, tempHand: false, size: { w: 0, h: 0 }, lastDoc: '' });

  const api: ViewApi = {
    get zoom() { return app.doc?.zoom || 1; },
    toScreen(p) { const d = app.doc!; const { w, h } = st.current.size; const a = (d.rotation * Math.PI) / 180, x = (p.x - d.w / 2) * d.zoom, y = (p.y - d.h / 2) * d.zoom; return { x: w / 2 + d.panX + x * Math.cos(a) - y * Math.sin(a), y: h / 2 + d.panY + x * Math.sin(a) + y * Math.cos(a) }; },
    toDoc(p) { const d = app.doc!; const { w, h } = st.current.size; const a = (-d.rotation * Math.PI) / 180, x = p.x - w / 2 - d.panX, y = p.y - h / 2 - d.panY; return { x: (x * Math.cos(a) - y * Math.sin(a)) / d.zoom + d.w / 2, y: (x * Math.sin(a) + y * Math.cos(a)) / d.zoom + d.h / 2 }; },
    redraw(r) { const d = app.doc; if (!d) return; if (r !== undefined) d.touch(r); schedule(); },
    overlay() { schedule(); },
    composite() { return getComposite(app.doc!); },
    pan(dx, dy) { const d = app.doc!; d.panX += dx; d.panY += dy; schedule(); },
    setZoom(z, at) { const d = app.doc!; z = Math.max(0.01, Math.min(64, z)); const { w, h } = st.current.size; const c = at || { x: w / 2, y: h / 2 }; const dp = api.toDoc(c); d.zoom = z; const s = api.toScreen(dp); d.panX += c.x - s.x; d.panY += c.y - s.y; schedule(); app.emit(); },
    rotate(deg) { const d = app.doc!; d.rotation = (d.rotation + deg) % 360; schedule(); app.emit(); },
    fitRect(r) { const d = app.doc!; const { w, h } = st.current.size; d.zoom = Math.max(0.01, Math.min(64, Math.min((w - 40) / r.w, (h - 40) / r.h))); d.panX = (d.w / 2 - (r.x + r.w / 2)) * d.zoom; d.panY = (d.h / 2 - (r.y + r.h / 2)) * d.zoom; d.rotation = 0; schedule(); app.emit(); },
    editText(id) { setTextEdit(id); },
  };
  (window as any).__monsoonView = api;

  function schedule() { if (!st.current.raf) st.current.raf = requestAnimationFrame(draw); }
  function draw() {
    st.current.raf = 0;
    const c = cv.current, el = wrap.current, d = app.doc; if (!c || !el) return;
    const dpr = window.devicePixelRatio || 1, W = el.clientWidth, H = el.clientHeight;
    st.current.size = { w: W, h: H };
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.style.width = W + 'px'; c.style.height = H + 'px'; }
    const x = c.getContext('2d')!; x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg') || '#1b1c22'; x.fillRect(0, 0, W, H);
    if (!d) return;
    const comp = getComposite(d);
    x.save();
    x.translate(W / 2 + d.panX, H / 2 + d.panY); x.rotate((d.rotation * Math.PI) / 180); x.scale(d.zoom, d.zoom); x.translate(-d.w / 2, -d.h / 2);
    if (app.view.screenMode !== 'full' || true) { x.shadowColor = 'rgba(0,0,0,0.45)'; x.shadowBlur = 16; x.fillStyle = '#fff'; x.fillRect(0, 0, d.w, d.h); x.shadowBlur = 0; }
    if (!checker || (checker as any).__z !== app.prefs.checker) { const s = app.prefs.checker === 'small' ? 4 : app.prefs.checker === 'large' ? 16 : 8, cc = makeCanvas(s * 2, s * 2), cx = ctx2d(cc); cx.fillStyle = '#fff'; cx.fillRect(0, 0, s * 2, s * 2); if (app.prefs.checker !== 'none') { cx.fillStyle = '#cfcfd4'; cx.fillRect(0, 0, s, s); cx.fillRect(s, s, s, s); } checker = x.createPattern(cc, 'repeat'); (checker as any).__z = app.prefs.checker; }
    const abs = flatLayers(d.layers).filter((l) => l.artboard && l.visible);
    if (abs.length) { x.fillStyle = '#2a2d40'; x.fillRect(0, 0, d.w, d.h); x.save(); x.scale(1 / d.zoom, 1 / d.zoom); x.fillStyle = checker!; for (const l of abs) { const a = l.artboard!; x.fillRect(a.x * d.zoom, a.y * d.zoom, a.w * d.zoom, a.h * d.zoom); } x.restore(); }
    else { x.save(); x.scale(1 / d.zoom, 1 / d.zoom); x.fillStyle = checker!; x.fillRect(0, 0, d.w * d.zoom, d.h * d.zoom); x.restore(); }
    x.imageSmoothingEnabled = d.zoom < 2; x.imageSmoothingQuality = 'high';
    const l = d.active;
    if (app.showMask && l?.mask) { x.fillStyle = l.mask.bg ? '#fff' : '#000'; x.fillRect(0, 0, d.w, d.h); x.drawImage(l.mask.canvas, l.mask.x, l.mask.y); }
    else if (app.view.channel !== 'rgb') x.drawImage(channelView(d, comp, app.view.channel), 0, 0);
    else x.drawImage(comp, 0, 0);
    if (d.quickMask && d.s.selection) {
      let q = qmCache.get(d.s.selection);
      if (!q || q.v !== d.version) { const s = getData(d.s.selection), o = new ImageData(d.w, d.h); for (let i = 0; i < s.data.length; i += 4) { o.data[i] = 255; o.data[i + 3] = (255 - s.data[i]) * 0.5; } const qc = makeCanvas(d.w, d.h); ctx2d(qc).putImageData(o, 0, 0); q = { v: d.version, c: qc }; qmCache.set(d.s.selection, q); }
      x.drawImage(q.c, 0, 0);
    }
    // pixel grid
    if (app.view.pixelGrid && d.zoom >= 10) { x.beginPath(); const vx0 = 0, vy0 = 0; for (let i = vx0; i <= d.w; i++) { x.moveTo(i, 0); x.lineTo(i, d.h); } for (let j = vy0; j <= d.h; j++) { x.moveTo(0, j); x.lineTo(d.w, j); } x.strokeStyle = 'rgba(128,128,128,0.35)'; x.lineWidth = 1 / d.zoom; x.stroke(); }
    if (app.view.grid && app.view.extras) { x.beginPath(); const g = app.view.gridSize; for (let i = g; i < d.w; i += g) { x.moveTo(i, 0); x.lineTo(i, d.h); } for (let j = g; j < d.h; j += g) { x.moveTo(0, j); x.lineTo(d.w, j); } x.strokeStyle = 'rgba(120,140,255,0.45)'; x.lineWidth = 1 / d.zoom; x.stroke(); }
    if (app.view.guides && app.view.extras) { x.beginPath(); for (const g of d.s.guides) { if (g.axis === 'v') { x.moveTo(g.pos, -1e5); x.lineTo(g.pos, 1e5); } else { x.moveTo(-1e5, g.pos); x.lineTo(1e5, g.pos); } } x.strokeStyle = '#2fd0ff'; x.lineWidth = 1 / d.zoom; x.stroke(); }
    // artboard outlines and names
    if (app.view.extras) for (const ab of flatLayers(d.layers)) { const a = ab.artboard; if (!a || !ab.visible) continue; const on = ab.id === d.s.activeId; x.strokeStyle = on ? '#6c7cff' : 'rgba(150,160,200,0.7)'; x.lineWidth = (on ? 2 : 1) / d.zoom; x.strokeRect(a.x, a.y, a.w, a.h); x.fillStyle = on ? '#9fa9ff' : '#9aa0c0'; x.font = `${12 / d.zoom}px Inter, system-ui, sans-serif`; x.fillText(ab.name, a.x, a.y - 6 / d.zoom); }
    // marching ants
    if (d.s.selection && !d.quickMask && app.view.showSelection && app.view.extras && !ts.transform) {
      let p = antsCache.get(d.s.selection); if (!p) { p = outlinePath(d.s.selection); antsCache.set(d.s.selection, p); }
      x.lineWidth = 1 / d.zoom; x.setLineDash([4 / d.zoom, 4 / d.zoom]); x.strokeStyle = '#000'; x.lineDashOffset = -st.current.ants / d.zoom; x.stroke(p); x.strokeStyle = '#fff'; x.lineDashOffset = -st.current.ants / d.zoom + 4 / d.zoom; x.stroke(p); x.setLineDash([]);
    }
    // text layer outline while editing
    if (textEdit) { const tl = d.find(textEdit); if (tl?.text) { const b = V.textBounds(tl.text); x.strokeStyle = '#6c7cff'; x.lineWidth = 1 / d.zoom; x.strokeRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4); } }
    x.restore();
    if (app.view.proof !== 'none') c.style.filter = app.view.proof === 'grayscale' ? 'grayscale(1)' : app.view.proof === 'cmyk' ? 'saturate(0.82) contrast(0.95)' : 'url(#deuteranopia)'; else c.style.filter = '';
    // tool overlays
    const h = handlerFor(app.tool);
    if (app.view.extras) { for (const t of ['note', 'color-sampler', 'count'] as const) { const hh = (handlerForName(t)); if (hh !== h) hh?.overlay?.(x, d, api); } }
    h.overlay?.(x, d, api);
    // brush cursor
    const hv = st.current.hover;
    if (hv && (BRUSH_TOOLS.has(app.tool) ) && !ts.transform) {
      const b = app.tool === 'eraser' || app.tool === 'bg-eraser' ? app.eraserBrush : app.brush, s = api.toScreen(hv), r = Math.max(1.5, (b.size / 2) * d.zoom);
      x.save(); x.beginPath(); x.ellipse(s.x, s.y, r, r * (b.shape === 'round' ? b.roundness : 1), ((b.angle + d.rotation) * Math.PI) / 180, 0, 7); x.strokeStyle = 'rgba(0,0,0,0.7)'; x.lineWidth = 2; x.stroke(); x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 1; x.stroke();
      x.beginPath(); x.moveTo(s.x - 3, s.y); x.lineTo(s.x + 3, s.y); x.moveTo(s.x, s.y - 3); x.lineTo(s.x, s.y + 3); x.stroke();
      if ((app.tool === 'clone' || app.tool === 'heal') && app.cloneSource && (ts as any).cloneOff && ts.stroke) { const src = api.toScreen({ x: hv.x - (ts as any).cloneOff.x, y: hv.y - (ts as any).cloneOff.y }); x.beginPath(); x.arc(src.x, src.y, r, 0, 7); x.setLineDash([3, 3]); x.stroke(); }
      x.restore();
    }
    drawRulers(d);
  }
  function handlerForName(t: any) { return (handlerFor as any)(t) === handlerFor(app.tool) ? null : (window as any).__tools?.[t] || null; }
  function drawRulers(d: Doc) {
    if (!app.view.rulers) return;
    const H = rulerH.current, Vv = rulerV.current; if (!H || !Vv) return;
    const dpr = window.devicePixelRatio || 1, { w, h } = st.current.size;
    for (const [c, horiz] of [[H, true], [Vv, false]] as [HTMLCanvasElement, boolean][]) {
      const len = horiz ? w : h; c.width = len * dpr; c.height = 18 * dpr; c.style.width = (horiz ? len : 18) + 'px'; c.style.height = (horiz ? 18 : len) + 'px';
      if (!horiz) { c.width = 18 * dpr; c.height = len * dpr; }
      const x = c.getContext('2d')!; x.setTransform(dpr, 0, 0, dpr, 0, 0); x.fillStyle = '#23242b'; x.fillRect(0, 0, horiz ? len : 18, horiz ? 18 : len);
      x.fillStyle = '#9aa0b4'; x.strokeStyle = '#5b6074'; x.font = '9px sans-serif'; x.lineWidth = 1;
      const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]; const step = steps.find((s) => s * d.zoom >= 50) || 5000;
      const o = api.toScreen({ x: 0, y: 0 }), origin = horiz ? o.x : o.y;
      const start = Math.floor(-origin / (step * d.zoom)) - 1, end = Math.ceil((len - origin) / (step * d.zoom)) + 1;
      x.beginPath();
      for (let i = start; i <= end; i++) {
        for (let k = 0; k < 10; k++) { const p = origin + (i * step + (k * step) / 10) * d.zoom; const tl = k === 0 ? 18 : k === 5 ? 8 : 4; if (horiz) { x.moveTo(p + 0.5, 18); x.lineTo(p + 0.5, 18 - tl); } else { x.moveTo(18, p + 0.5); x.lineTo(18 - tl, p + 0.5); } }
        const p = origin + i * step * d.zoom; if (horiz) x.fillText(String(i * step), p + 2, 9); else { x.save(); x.translate(9, p + 2); x.rotate(-Math.PI / 2); x.fillText(String(i * step), -x.measureText(String(i * step)).width - 2, 0); x.restore(); }
      }
      x.stroke();
      if (st.current.hover) { const s = api.toScreen(st.current.hover); x.strokeStyle = '#6c7cff'; x.beginPath(); if (horiz) { x.moveTo(s.x, 0); x.lineTo(s.x, 18); } else { x.moveTo(0, s.y); x.lineTo(18, s.y); } x.stroke(); }
    }
  }

  // fit new documents to the window
  useEffect(() => {
    if (!d || st.current.lastDoc === d.id) { schedule(); return; }
    st.current.lastDoc = d.id;
    requestAnimationFrame(() => { const el = wrap.current; if (!el) return; st.current.size = { w: el.clientWidth, h: el.clientHeight }; if (d.zoom === 1 && d.panX === 0 && !(d as any).fitted) { (d as any).fitted = true; api.fitRect({ x: 0, y: 0, w: d.w, h: d.h }); if (d.zoom > 1) { d.zoom = 1; d.panX = 0; d.panY = 0; } } schedule(); });
  });
  useEffect(() => {
    const ro = new ResizeObserver(() => schedule()); if (wrap.current) ro.observe(wrap.current);
    const t = setInterval(() => { const dd = app.doc; if (dd?.s.selection && !dd.quickMask) { st.current.ants = (st.current.ants + 1) % 8; schedule(); } }, 120);
    const kd = (e: KeyboardEvent) => { if (e.code === 'Space' && !(e.target as HTMLElement)?.closest('input,textarea,[contenteditable]')) { st.current.space = true; if (wrap.current) wrap.current.style.cursor = 'grab'; e.preventDefault(); } };
    const ku = (e: KeyboardEvent) => { if (e.code === 'Space') { st.current.space = false; if (wrap.current) wrap.current.style.cursor = ''; } };
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    return () => { ro.disconnect(); clearInterval(t); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }, []);

  function evt(e: React.PointerEvent | PointerEvent): PEvt {
    const r = wrap.current!.getBoundingClientRect(), raw = { x: e.clientX - r.left, y: e.clientY - r.top };
    return { p: api.toDoc(raw), raw, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, pressure: e.pointerType === 'pen' ? e.pressure || 0.5 : 1, button: e.button, pointerType: e.pointerType, dbl: e.detail >= 2 };
  }
  function onDown(e: React.PointerEvent) {
    const d = app.doc; if (!d) return;
    if (textEdit) { setTextEdit(null); d.commit('Type'); app.emit(); }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const s = st.current; const ev = evt(e); s.pointers.set(e.pointerId, ev.raw);
    if (s.pointers.size === 2) { // pinch zoom: cancel any stroke in progress
      const [a, b] = [...s.pointers.values()]; s.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: d.zoom, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      if (ts.stroke) { ts.stroke.end(); ts.stroke = null; d.goto(d.hIndex); } ts.drag = null; ts.moveStart = null; return;
    }
    if (s.space || e.button === 1 || app.tool === 'hand') { s.tempHand = true; ts.drag = ev.raw; return; }
    if (e.button === 2) return;
    try { handlerFor(app.tool).down?.(d, ev, api); } catch (err: any) { app.toast(err?.message || String(err), 'error'); console.error(err); }
    schedule();
  }
  function onMove(e: React.PointerEvent) {
    const d = app.doc; if (!d) return; const s = st.current, ev = evt(e);
    s.hover = ev.p;
    if (s.pointers.has(e.pointerId)) s.pointers.set(e.pointerId, ev.raw);
    if (s.pinch && s.pointers.size === 2) { const [a, b] = [...s.pointers.values()]; const dist = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; d.panX += mid.x - s.pinch.mid.x; d.panY += mid.y - s.pinch.mid.y; s.pinch.mid = mid; api.setZoom(s.pinch.zoom * (dist / s.pinch.dist), mid); return; }
    if (s.tempHand) { if (ts.drag) { api.pan(ev.raw.x - ts.drag.x, ev.raw.y - ts.drag.y); ts.drag = ev.raw; } return; }
    const h = handlerFor(app.tool);
    if (s.pointers.size) {
      const native = (e.nativeEvent as any).getCoalescedEvents?.() as PointerEvent[] | undefined;
      if (native && native.length > 1 && ts.stroke) for (const ce of native) h.move?.(d, evt(ce), api); else h.move?.(d, ev, api);
    } else h.hover?.(d, ev, api);
    if (BRUSH_TOOLS.has(app.tool) || app.view.rulers) schedule();
    const info = document.getElementById('status-pos'); if (info) info.textContent = `X: ${Math.floor(ev.p.x)}  Y: ${Math.floor(ev.p.y)}${ts.info ? '   ' + ts.info : ''}`;
  }
  function onUp(e: React.PointerEvent) {
    const d = app.doc; if (!d) return; const s = st.current; s.pointers.delete(e.pointerId);
    if (s.pinch) { if (s.pointers.size < 2) s.pinch = null; return; }
    if (s.tempHand) { s.tempHand = false; ts.drag = null; return; }
    try { handlerFor(app.tool).up?.(d, evt(e), api); } catch (err: any) { app.toast(err?.message || String(err), 'error'); console.error(err); }
    ts.info = ''; schedule();
  }
  function onWheel(e: React.WheelEvent) {
    const d = app.doc; if (!d) return;
    const r = wrap.current!.getBoundingClientRect(), at = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (e.ctrlKey || e.metaKey || e.altKey) api.setZoom(d.zoom * Math.pow(1.0018, -e.deltaY * (e.deltaMode ? 30 : 1)), at);
    else api.pan(-e.deltaX - (e.shiftKey ? e.deltaY : 0), e.shiftKey ? 0 : -e.deltaY);
  }
  useEffect(() => { const el = wrap.current; if (!el) return; const f = (e: WheelEvent) => e.preventDefault(); el.addEventListener('wheel', f, { passive: false }); return () => el.removeEventListener('wheel', f); }, []);

  // ruler drags create guides
  function guideDrag(axis: 'h' | 'v') {
    return (e: React.PointerEvent) => {
      const d = app.doc; if (!d) return; (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const up = (ev: PointerEvent) => { (e.target as HTMLElement).removeEventListener('pointerup', up as any); const r = wrap.current!.getBoundingClientRect(); const p = api.toDoc({ x: ev.clientX - r.left, y: ev.clientY - r.top }); const pos = Math.round(axis === 'h' ? p.y : p.x); if (pos > 0 && pos < (axis === 'h' ? d.h : d.w)) void run('newGuide', { axis, pos }); };
      (e.target as HTMLElement).addEventListener('pointerup', up as any);
    };
  }

  const cursor = !d ? 'default' : st.current.space ? 'grab' : handlerFor(app.tool).cursor?.(d) || 'default';
  return (
    <div className="view-wrap">
      {app.view.rulers && d && <div className="rulers"><div className="ruler-corner" /><canvas ref={rulerH} className="ruler-h" onPointerDown={guideDrag('h')} /><canvas ref={rulerV} className="ruler-v" onPointerDown={guideDrag('v')} /></div>}
      <div ref={wrap} className={'viewport' + (app.view.rulers && d ? ' with-rulers' : '')} style={{ cursor }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onPointerLeave={() => { st.current.hover = null; schedule(); }} onWheel={onWheel} onContextMenu={(e) => e.preventDefault()} onDoubleClick={(e) => { const d = app.doc; if (d && app.tool === 'lasso-poly') handlerFor('lasso-poly').down?.(d, { ...evt(e as any), dbl: true }, api); }}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const files = [...e.dataTransfer.files]; if (!files.length) return; if (app.doc && !e.shiftKey) files.forEach((f) => run('place', f)); else openFiles(files); }}>
        <canvas ref={cv} className="main-canvas" />
        {!d && <Welcome />}
        {textEdit && d && <TextEditor d={d} id={textEdit} api={api} onDone={() => { setTextEdit(null); d.commit('Type'); app.emit(); }} />}
        <svg width="0" height="0" style={{ position: 'absolute' }}><filter id="deuteranopia"><feColorMatrix type="matrix" values="0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0" /></filter></svg>
      </div>
    </div>
  );
}

const chanCache = new WeakMap<Canvas, { key: string; c: Canvas }>();
function channelView(d: Doc, comp: Canvas, ch: string): Canvas {
  const key = d.version + ch, hit = chanCache.get(comp); if (hit && hit.key === key) return hit.c;
  let src: ImageData; const out = new ImageData(d.w, d.h);
  if (ch === 'r' || ch === 'g' || ch === 'b') { src = getData(comp); const k = { r: 0, g: 1, b: 2 }[ch]; for (let i = 0; i < src.data.length; i += 4) { out.data[i] = out.data[i + 1] = out.data[i + 2] = src.data[i + k]; out.data[i + 3] = 255; } }
  else { const a = d.s.channels.find((c) => c.id === ch); if (a) { src = getData(a.canvas); out.data.set(src.data); } }
  const c = makeCanvas(d.w, d.h); ctx2d(c).putImageData(out, 0, 0); chanCache.set(comp, { key, c }); return c;
}

function TextEditor({ d, id, api, onDone }: { d: Doc; id: string; api: ViewApi; onDone: () => void }) {
  const l = d.find(id); const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, [id]);
  if (!l?.text) return null;
  const t = l.text, b = V.textBounds(t), p = api.toScreen({ x: b.x, y: b.y }), z = d.zoom;
  return (
    <textarea ref={ref} className="text-editor" value={t.text} placeholder="Type here"
      style={{ left: p.x, top: p.y, minWidth: Math.max(60, (t.boxWidth || b.w) * z + 20), minHeight: Math.max(t.size * z * 1.3, b.h * z + 8), font: `${t.italic ? 'italic ' : ''}${t.weight} ${t.size * z}px ${t.font}`, lineHeight: (t.leading || t.size * 1.2) * z + 'px', textAlign: t.align === 'justify' ? 'left' : t.align, transform: t.align === 'center' && !t.boxWidth ? 'translateX(0)' : undefined }}
      onChange={(e) => { t.text = e.target.value; l.name = e.target.value.split('\n')[0].slice(0, 40) || 'Text'; l.ver++; d.touch(); app.emit(); }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { if (!t.text.trim()) { d.removeLayer(id); } onDone(); } }}
      onBlur={() => { if (!t.text.trim()) d.removeLayer(id); onDone(); }} />
  );
}

function Welcome() {
  return (
    <div className="welcome" onPointerDown={(e) => e.stopPropagation()}>
      <img src="./icon.svg" alt="" width={72} height={72} />
      <h1>ANCHOR Monsoon</h1>
      <p>Layered image editing that runs on your device. Nothing is uploaded.</p>
      <div className="welcome-actions">
        <button className="btn primary" onClick={() => app.openDialog('new')}>New document</button>
        <button className="btn" onClick={() => run('open')}>Open…</button>
        <button className="btn" onClick={() => app.openDialog('recent')}>Recent files</button>
      </div>
      <p className="hint">Drop images or PSD files anywhere to open them. Paste an image to start from the clipboard.</p>
    </div>
  );
}
export type { Rect };
