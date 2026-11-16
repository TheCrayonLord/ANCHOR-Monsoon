// Frame animation: frames store each layer's visibility, opacity and position. Exports animated GIF.
import { useEffect, useMemo, useState } from 'react';
import { app, requireDoc } from '../app';
import { commands, run } from '../cmds';
import { walk } from '../engine/doc';
import type { Doc } from '../engine/doc';
import type { AnimFrame } from '../engine/types';
import { flatten, clearCaches } from '../engine/render';
import { ctx2d, makeCanvas, download, uid } from '../engine/util';
import { Select } from './controls';
import * as I from 'lucide-react';

function capture(d: Doc): AnimFrame['layers'] {
  const o: AnimFrame['layers'] = {};
  walk(d.layers, (l) => { o[l.id] = { visible: l.visible, opacity: l.opacity, x: l.x, y: l.y }; });
  return o;
}
export function applyFrame(d: Doc, f: AnimFrame) {
  walk(d.layers, (l) => {
    const s = f.layers[l.id]; if (!s) return;
    if (l.visible !== s.visible || l.opacity !== s.opacity || l.x !== s.x || l.y !== s.y) { l.visible = s.visible; l.opacity = s.opacity; if (l.kind === 'raster') { l.x = s.x; l.y = s.y; } l.ver++; }
  });
  clearCaches();
}
/** Copy the document's current layer state into the selected frame, so edits made on the canvas are kept. */
function syncCurrent(d: Doc) {
  const fr = d.s.frames; if (!fr?.length) return;
  const i = Math.min(d.s.frameIndex || 0, fr.length - 1); fr[i] = { ...fr[i], layers: capture(d) };
}
const done = (d: Doc, label: string) => { d.touch(); d.commit(label); app.emit(); return true; };

commands.animFrames = (a: { op: string; i?: number; ms?: number; count?: number; to?: number; loop?: number }) => {
  const d = requireDoc();
  const op = a.op; let fr = d.s.frames ? d.s.frames.map((f) => ({ ...f })) : [];
  const cur = Math.min(d.s.frameIndex || 0, Math.max(0, fr.length - 1));
  const set = (frames: AnimFrame[], idx: number) => { d.s.frames = frames; d.s.frameIndex = Math.max(0, Math.min(idx, frames.length - 1)); if (frames.length) applyFrame(d, frames[d.s.frameIndex]); };
  if (op === 'create') { set([{ id: uid('F'), delay: 100, layers: capture(d) }], 0); return done(d, 'Create Frame Animation'); }
  if (op === 'clear') { d.s.frames = undefined; d.s.frameIndex = 0; return done(d, 'Delete Animation'); }
  if (!fr.length) { set([{ id: uid('F'), delay: 100, layers: capture(d) }], 0); fr = d.s.frames!.map((f) => ({ ...f })); }
  fr[cur] = { ...fr[cur], layers: capture(d) };
  switch (op) {
    case 'add': fr.splice(cur + 1, 0, { ...fr[cur], id: uid('F'), layers: JSON.parse(JSON.stringify(fr[cur].layers)) }); set(fr, cur + 1); return done(d, 'New Frame');
    case 'delete': if (fr.length < 2) { app.toast('An animation needs at least one frame.'); return false; } fr.splice(cur, 1); set(fr, Math.min(cur, fr.length - 1)); return done(d, 'Delete Frame');
    case 'select': { const i = Math.max(0, Math.min(a.i ?? 0, fr.length - 1)); set(fr, i); return done(d, 'Select Frame'); }
    case 'delay': { const ms = Math.max(0, a.ms ?? 100); fr = fr.map((f, k) => (a.i === undefined || a.i === k ? { ...f, delay: ms } : f)); set(fr, cur); return done(d, 'Frame Delay'); }
    case 'reverse': fr.reverse(); set(fr, fr.length - 1 - cur); return done(d, 'Reverse Frames');
    case 'move': { const to = Math.max(0, Math.min(a.to ?? cur, fr.length - 1)); const [f] = fr.splice(cur, 1); fr.splice(to, 0, f); set(fr, to); return done(d, 'Move Frame'); }
    case 'loop': d.s.animLoop = a.loop ?? 0; set(fr, cur); return done(d, 'Looping');
    case 'tween': {
      const n = Math.max(1, Math.min(50, a.count ?? 5)), A = fr[cur], B = fr[(cur + 1) % fr.length];
      if (fr.length < 2) { app.toast('Add a second frame to tween between.'); return false; }
      const mids: AnimFrame[] = [];
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1), layers: AnimFrame['layers'] = {};
        for (const id of new Set([...Object.keys(A.layers), ...Object.keys(B.layers)])) {
          const p = A.layers[id] || B.layers[id], q = B.layers[id] || A.layers[id];
          const pa = p.visible ? p.opacity : 0, qa = q.visible ? q.opacity : 0;
          layers[id] = { visible: p.visible || q.visible, opacity: pa + (qa - pa) * t, x: Math.round(p.x + (q.x - p.x) * t), y: Math.round(p.y + (q.y - p.y) * t) };
        }
        mids.push({ id: uid('F'), delay: A.delay, layers });
      }
      fr.splice(cur + 1, 0, ...mids); set(fr, cur); return done(d, 'Tween');
    }
    case 'fromLayers': {
      const tops = d.layers.filter((l) => !l.artboard), bg = tops[0]?.name === 'Background' ? tops[0] : null, items = tops.filter((l) => l !== bg);
      if (!items.length) { app.toast('Add some layers first. Each layer becomes one frame.'); return false; }
      const base = capture(d);
      const frames = items.map((l) => { const layers = JSON.parse(JSON.stringify(base)) as AnimFrame['layers']; for (const o of items) { layers[o.id].visible = o === l; } return { id: uid('F'), delay: 100, layers }; });
      set(frames, 0); return done(d, 'Make Frames From Layers');
    }
  }
  return false;
};

commands.exportGif = async (a: { loop?: number } = {}) => {
  const d = requireDoc(); if (!d.s.frames?.length) { app.toast('Create a frame animation first (Window > Timeline).'); return false; }
  syncCurrent(d);
  const blob = await renderGif(d, a.loop ?? d.s.animLoop ?? 0);
  download(blob, d.name.replace(/\.[^.]+$/, '') + '.gif'); app.toast(`Saved an animated GIF with ${d.s.frames.length} frames.`); return true;
};
export async function renderGif(d: Doc, loop = 0, maxSide = 0): Promise<Blob> {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const fr = d.s.frames!, cur = d.s.frameIndex || 0, s = maxSide ? Math.min(1, maxSide / Math.max(d.w, d.h)) : 1;
  const w = Math.max(1, Math.round(d.w * s)), h = Math.max(1, Math.round(d.h * s));
  const g = GIFEncoder(); const c = makeCanvas(w, h), x = ctx2d(c);
  try {
    fr.forEach((f, k) => {
      applyFrame(d, f); x.clearRect(0, 0, w, h); x.drawImage(flatten(d), 0, 0, w, h);
      const px = x.getImageData(0, 0, w, h).data;
      const pal = quantize(px, 256, { format: 'rgba4444', oneBitAlpha: true }); const idx = applyPalette(px, pal, 'rgba4444');
      const ti = pal.findIndex((p: number[]) => p[3] === 0);
      g.writeFrame(idx, w, h, { palette: pal, delay: f.delay, transparent: ti >= 0, transparentIndex: Math.max(0, ti), repeat: k === 0 ? (loop === 0 ? 0 : loop === 1 ? -1 : loop - 1) : undefined, dispose: 2 });
    });
  } finally { applyFrame(d, fr[cur]); d.touch(); }
  g.finish(); return new Blob([g.bytes()], { type: 'image/gif' });
}

let timer: any = null;
export function TimelinePanel({ d }: { d: Doc }) {
  const fr = d.s.frames, cur = d.s.frameIndex || 0;
  const [playing, setPlaying] = useState(false), [tw, setTw] = useState(5);
  const key = fr ? JSON.stringify(fr.map((f) => [f.id, f.layers])) + ':' + d.hIndex : '';
  const thumbs = useMemo(() => {
    if (!fr?.length || playing) return [] as string[];
    syncCurrent(d);
    const s = Math.min(1, 96 / Math.max(d.w, d.h)), c = makeCanvas(Math.max(1, Math.round(d.w * s)), Math.max(1, Math.round(d.h * s))), x = ctx2d(c);
    const out = fr.map((f) => { applyFrame(d, f); x.clearRect(0, 0, c.width, c.height); x.drawImage(flatten(d), 0, 0, c.width, c.height); return c.toDataURL(); });
    applyFrame(d, fr[cur]); return out;
  }, [key, playing]);
  useEffect(() => () => { clearTimeout(timer); timer = null; }, []);
  const play = () => {
    if (!fr?.length) return; syncCurrent(d); setPlaying(true);
    let i = cur, loops = 0; const lim = d.s.animLoop || 0;
    const step = () => {
      const f = d.s.frames?.[i]; if (!f) { stop(); return; }
      applyFrame(d, f); d.s.frameIndex = i; d.touch(); app.emit();
      i++; if (i >= (d.s.frames?.length || 0)) { i = 0; loops++; if (lim && loops >= lim) { timer = setTimeout(stop, f.delay || 100); return; } }
      timer = setTimeout(step, Math.max(20, f.delay || 100));
    };
    step();
  };
  const stop = () => { clearTimeout(timer); timer = null; setPlaying(false); const f = d.s.frames?.[d.s.frameIndex || 0]; if (f) { applyFrame(d, f); d.touch(); app.emit(); } };
  (window as any).__monsoonAnim = { play, stop, renderGif: (loop?: number, max?: number) => renderGif(d, loop, max) };
  if (!fr?.length) return (<div className="timeline">
    <p className="muted">Animate by changing layer visibility, opacity and position from frame to frame, then save an animated GIF.</p>
    <div className="row"><button className="btn sm primary" onClick={() => run('animFrames', { op: 'create' })}>Create Frame Animation</button><button className="btn sm" onClick={() => run('animFrames', { op: 'fromLayers' })}>Make Frames From Layers</button></div>
  </div>);
  const DELAYS: [string, string][] = [['0', 'No delay'], ['50', '0.05 s'], ['100', '0.1 s'], ['200', '0.2 s'], ['500', '0.5 s'], ['1000', '1 s'], ['2000', '2 s'], ['5000', '5 s']];
  return (<div className="timeline">
    <div className="frames" role="list">
      {fr.map((f, i) => <div key={f.id} role="listitem" className={'frame' + (i === cur ? ' on' : '')} onClick={() => !playing && run('animFrames', { op: 'select', i })}>
        <span className="fnum">{i + 1}</span>
        {thumbs[i] ? <img src={thumbs[i]} alt={`Frame ${i + 1}`} /> : <div className="fph" />}
        <select value={String(f.delay)} onClick={(e) => e.stopPropagation()} onChange={(e) => run('animFrames', { op: 'delay', i, ms: +e.target.value })}>
          {(DELAYS.some(([v]) => +v === f.delay) ? DELAYS : [...DELAYS, [String(f.delay), (f.delay / 1000).toFixed(2) + ' s'] as [string, string]]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>)}
    </div>
    <div className="row tl-controls">
      <Select value={String(d.s.animLoop || 0)} options={[['0', 'Forever'], ['1', 'Once'], ['3', '3 times']]} onChange={(v) => run('animFrames', { op: 'loop', loop: +v })} />
      <button className="icon-btn" title="First frame" disabled={playing} onClick={() => run('animFrames', { op: 'select', i: 0 })}><I.SkipBack size={14} /></button>
      <button className="icon-btn" title="Previous frame" disabled={playing} onClick={() => run('animFrames', { op: 'select', i: (cur - 1 + fr.length) % fr.length })}><I.ChevronLeft size={14} /></button>
      <button className="icon-btn" title={playing ? 'Stop' : 'Play'} onClick={() => (playing ? stop() : play())}>{playing ? <I.Square size={14} /> : <I.Play size={14} />}</button>
      <button className="icon-btn" title="Next frame" disabled={playing} onClick={() => run('animFrames', { op: 'select', i: (cur + 1) % fr.length })}><I.ChevronRight size={14} /></button>
      <span className="sep" />
      <button className="icon-btn" title="Duplicate frame" disabled={playing} onClick={() => run('animFrames', { op: 'add' })}><I.CopyPlus size={14} /></button>
      <button className="icon-btn" title={`Tween ${tw} frames to the next frame`} disabled={playing || fr.length < 2} onClick={() => run('animFrames', { op: 'tween', count: tw })}><I.Blend size={14} /></button>
      <input className="num tiny" type="number" min={1} max={50} value={tw} title="Frames to add when tweening" onChange={(e) => setTw(Math.max(1, Math.min(50, +e.target.value || 1)))} />
      <button className="icon-btn" title="Reverse frames" disabled={playing} onClick={() => run('animFrames', { op: 'reverse' })}><I.ArrowLeftRight size={14} /></button>
      <button className="icon-btn" title="Delete frame" disabled={playing || fr.length < 2} onClick={() => run('animFrames', { op: 'delete' })}><I.Trash2 size={14} /></button>
      <span className="pspacer" />
      <button className="btn sm" onClick={() => run('exportGif')}>Save GIF</button>
    </div>
    <p className="muted small">Frame {cur + 1} of {fr.length}. Change layer visibility, opacity or position and the selected frame keeps it.</p>
  </div>);
}
