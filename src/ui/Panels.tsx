// Docked panels: Layers, Channels, Paths, History, Properties, Adjustments, Color, Swatches and more.
import { useEffect, useRef, useState } from 'react';
import { app, flatLayers } from '../app';
import type { Doc } from '../engine/doc';
import type { Layer, AdjType } from '../engine/types';
import { run, moveLayerTo, ADJ_TYPES, ARTBOARD_PRESETS } from '../cmds';
import { layerContent, maskAlpha, flatten } from '../engine/render';
import { ctx2d, makeCanvas, hexToRgb, rgbToHex, rgbToHsv, hsvToRgb, rgbToCmyk, rgbToLab, getData } from '../engine/util';
import { Slider, Select, Check, ColorChip, Num, Seg } from './controls';
import { blendOpts } from './OptionsBar';
import { ADJ_LABELS, histogram } from '../engine/adjust';
import { AdjEditor } from './AdjEditor';
import { STYLE_NAMES, hasStyles } from '../engine/styles';
import { BRUSH_PRESETS, makeTip } from '../engine/brush';
import { GRADIENT_PRESETS, gradientCss, patternNames, getPattern } from '../engine/paint';
import { CUSTOM_SHAPES, svgToPath, pathToPath2D } from '../engine/vector';
import { FONTS } from '../app';
import { getComposite } from './View';
import { clearCaches } from '../engine/render';
import { selectTool } from './Toolbar';
import * as I from 'lucide-react';
import * as V from '../engine/vector';
import { TimelinePanel } from './Timeline';

const thumbs = new Map<string, { key: string; url: string }>();
function thumb(d: Doc, l: Layer, mask = false): string {
  const key = l.ver + ':' + (mask ? 'm' : '') + (l.text ? l.text.text + l.text.color : '') + (l.shape ? JSON.stringify(l.shape.fill) : '') + (l.fill ? JSON.stringify(l.fill) : '') + d.w + 'x' + d.h + (l.mask?.canvas.width || '');
  const id = l.id + (mask ? 'm' : ''), hit = thumbs.get(id); if (hit && hit.key === key) return hit.url;
  const s = 36 / Math.max(d.w, d.h), c = makeCanvas(Math.max(1, d.w * s), Math.max(1, d.h * s)), x = ctx2d(c);
  if (mask && l.mask) { x.fillStyle = l.mask.bg ? '#fff' : '#000'; x.fillRect(0, 0, c.width, c.height); x.drawImage(l.mask.canvas, l.mask.x * s, l.mask.y * s, l.mask.canvas.width * s, l.mask.canvas.height * s); }
  else { const p = layerContent(d, l); if (p) x.drawImage(p.canvas, p.x * s, p.y * s, p.canvas.width * s, p.canvas.height * s); }
  const url = c.toDataURL(); thumbs.set(id, { key, url }); return url;
}

function Panel({ id, title, tabs, children, actions }: { id: string; title?: string; tabs?: [string, string][]; children: React.ReactNode; actions?: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section className={'panel' + (collapsed ? ' collapsed' : '')} data-panel={id}>
      <header>
        {tabs ? tabs.map(([k, l]) => <button key={k} className={'ptab' + (app.panelsOpen['_tab_' + id] === (k as any) || (!app.panelsOpen['_tab_' + id] && k === tabs[0][0]) ? ' on' : '')} onClick={() => { (app.panelsOpen as any)['_tab_' + id] = k; app.emit(); }}>{l}</button>) : <span className="ptitle">{title}</span>}
        <span className="pspacer" />{actions}
        <button className="icon-btn" title={collapsed ? 'Expand' : 'Collapse'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <I.ChevronDown size={14} /> : <I.ChevronUp size={14} />}</button>
        <button className="icon-btn" title="Close panel" onClick={() => { for (const k of (tabs ? tabs.map((t) => t[0]) : [id])) app.panelsOpen[k] = false; app.panelsOpen[id] = false; app.emit(); }}><I.X size={14} /></button>
      </header>
      {!collapsed && <div className="pbody">{children}</div>}
    </section>
  );
}
const tabOf = (id: string, def: string) => ((app.panelsOpen as any)['_tab_' + id] as string) || def;

// ---------------- Layers ----------------
function LayerRow({ d, l, depth }: { d: Doc; l: Layer; depth: number }) {
  const sel = d.s.selectedIds.includes(l.id), act = d.s.activeId === l.id;
  const [rename, setRename] = useState(false);
  const kindIcon = l.kind === 'text' ? <I.Type size={14} /> : l.kind === 'adjustment' ? <I.Contrast size={14} /> : l.artboard ? <I.Frame size={14} /> : l.kind === 'group' ? (l.collapsed ? <I.Folder size={14} /> : <I.FolderOpen size={14} />) : l.kind === 'smart' ? <I.FileImage size={14} /> : null;
  return (
    <>
      <div className={'layer-row' + (sel ? ' sel' : '') + (act ? ' act' : '') + (l.clip ? ' clipped' : '')} style={{ paddingLeft: 4 + depth * 14 }} draggable
        data-id={l.id}
        onDragStart={(e) => { e.dataTransfer.setData('text/layer', l.id); e.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={(e) => { e.preventDefault(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); const y = e.clientY - r.top; (e.currentTarget as HTMLElement).dataset.drop = l.kind === 'group' && y > r.height * 0.3 && y < r.height * 0.7 ? 'in' : y < r.height / 2 ? 'above' : 'below'; }}
        onDragLeave={(e) => { delete (e.currentTarget as HTMLElement).dataset.drop; }}
        onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/layer'); const where = (e.currentTarget as HTMLElement).dataset.drop; delete (e.currentTarget as HTMLElement).dataset.drop; if (id) moveLayerTo(d, id, l.id, where === 'in' ? 'inside' : where === 'above' ? 'above' : 'below'); }}
        onClick={(e) => { if (e.altKey) { run('selectLayerPixels', l.id); return; } d.setActive(l.id, e.shiftKey || e.ctrlKey || e.metaKey); app.editMask = false; app.showMask = false; app.emit(); }}
        onDoubleClick={() => { if (l.kind === 'text') { selectTool('type'); (window as any).__monsoonView?.editText(l.id); } else if (l.kind === 'smart') run('editSmart'); else app.openDialog('layerStyle'); }}>
        <button className="eye" title="Show or hide" onClick={(e) => { e.stopPropagation(); if (e.altKey) { const all = flatLayers(d.layers); const solo = all.every((x) => x === l || !x.visible); all.forEach((x) => { x.visible = solo || x === l; }); d.commit('Show/Hide'); app.emit(); } else run('toggleVisibility', l.id); }}>{l.visible ? <I.Eye size={14} /> : <I.EyeOff size={14} className="dim" />}</button>
        {l.kind === 'group' && <button className="twisty" onClick={(e) => { e.stopPropagation(); l.collapsed = !l.collapsed; app.emit(); }}>{l.collapsed ? '▸' : '▾'}</button>}
        {l.clip && <span className="clip-arrow">↳</span>}
        {l.kind === 'adjustment' || l.kind === 'group' ? <span className="lthumb icon">{kindIcon}</span> : <img className={'lthumb' + (act && !app.editMask ? ' on' : '')} src={thumb(d, l)} alt="" onClick={() => { app.editMask = false; }} />}
        {l.linkId && <I.Link size={11} className="dim" />}
        {l.mask && <img className={'lthumb mask' + (app.editMask && act ? ' on' : '') + (l.mask.enabled ? '' : ' off')} src={thumb(d, l, true)} alt="mask" title="Layer mask. Click to edit, Alt-click to view, Shift-click to disable"
          onClick={(e) => { e.stopPropagation(); d.setActive(l.id); if (e.shiftKey) { run('mask', 'toggle'); return; } if (e.altKey) { app.showMask = !app.showMask; } app.editMask = true; app.emit(); }} />}
        {l.vmask && <span className={'lthumb vmask' + (l.vmask.enabled ? '' : ' off')} title="Vector mask. Edit it with the Path Selection or Direct Selection tool." onClick={(e) => { e.stopPropagation(); d.setActive(l.id); selectTool('direct-select'); }}><svg width="30" height="26" viewBox={`0 0 ${d.w} ${d.h}`}><rect width={d.w} height={d.h} fill="#555" /><path d={vpathD(l.vmask.path)} fill="#fff" fillRule="evenodd" /></svg></span>}
        {rename ? <input className="lname-edit" autoFocus defaultValue={l.name} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRename(false); }} onBlur={(e) => { setRename(false); if (e.target.value && e.target.value !== l.name) run('layerProps', { id: l.id, name: e.target.value }); }} onClick={(e) => e.stopPropagation()} />
          : <span className="lname" onDoubleClick={(e) => { e.stopPropagation(); setRename(true); }} style={l.color ? { borderLeft: `3px solid ${l.color}`, paddingLeft: 4 } : undefined}>{l.name}</span>}
        <span className="lbadges">
          {kindIcon && l.kind !== 'group' && l.kind !== 'adjustment' && <span className="dim">{kindIcon}</span>}
          {hasStyles(l.styles) && <span className="fx" title="Layer effects" onClick={(e) => { e.stopPropagation(); d.setActive(l.id); app.openDialog('layerStyle'); }}>fx</span>}
          {(l.locks.all || l.locks.pixels || l.locks.position || l.locks.transparency) && <I.Lock size={11} className="dim" />}
        </span>
      </div>
      {l.smart && l.smart.filters.length > 0 && <div className="smart-filters" style={{ paddingLeft: 40 + depth * 14 }}>
        <div className="sf-head"><I.SlidersHorizontal size={11} /> Smart Filters</div>
        {[...l.smart.filters].reverse().map((f) => <div key={f.id} className="sf-row"><button className="eye" onClick={() => { d.setActive(l.id); run('toggleSmartFilter', f.id); }}>{f.enabled ? <I.Eye size={12} /> : <I.EyeOff size={12} className="dim" />}</button><span onDoubleClick={() => { d.setActive(l.id); app.openDialog('filter', { id: f.filter, smartId: f.id }); }}>{f.name}</span><button className="icon-btn" title="Delete filter" onClick={() => { d.setActive(l.id); run('removeSmartFilter', f.id); }}><I.Trash2 size={11} /></button></div>)}
      </div>}
      {l.kind === 'group' && !l.collapsed && [...l.children!].reverse().map((c) => <LayerRow key={c.id} d={d} l={c} depth={depth + 1} />)}
    </>
  );
}
function LayersPanel({ d }: { d: Doc }) {
  const l = d.active;
  const [filter, setFilter] = useState<'all' | 'raster' | 'adjustment' | 'text' | 'shape' | 'smart'>('all');
  const set = (p: Partial<Layer>, label: string) => { if (!l) return; Object.assign(l, p); l.ver++; d.touch(); app.emit(); clearTimeout((window as any).__lt); (window as any).__lt = setTimeout(() => { d.commit(label); app.emit(); }, 400); };
  const rows = filter === 'all' ? [...d.layers].reverse() : flatLayers(d.layers).filter((x) => x.kind === filter).reverse();
  return (<>
    <div className="layer-top">
      <Select value={filter} options={[['all', 'All kinds'], ['raster', 'Pixel'], ['adjustment', 'Adjustment'], ['text', 'Type'], ['shape', 'Shape'], ['smart', 'Smart Object']]} onChange={setFilter} />
      <Select value={l?.blend || 'normal'} options={blendOpts(l?.kind === 'group')} onChange={(v) => set({ blend: v }, 'Blending Change')} title="Blend mode" />
    </div>
    <div className="layer-top">
      <Slider label="Opacity" value={Math.round((l?.opacity ?? 1) * 100)} min={0} max={100} unit="%" onChange={(v) => set({ opacity: v / 100 }, 'Opacity Change')} />
    </div>
    <div className="layer-top">
      <span className="lbl">Lock</span>
      {l && ([['transparency', <I.Grid2x2 size={13} />, 'Lock transparent pixels'], ['pixels', <I.Brush size={13} />, 'Lock image pixels'], ['position', <I.Move size={13} />, 'Lock position'], ['all', <I.Lock size={13} />, 'Lock all']] as [keyof Layer['locks'], React.ReactNode, string][]).map(([k, ic, t]) =>
        <button key={k} className={'icon-btn' + (l.locks[k] ? ' on' : '')} title={t} onClick={() => { l.locks[k] = !l.locks[k]; d.commit('Lock'); app.emit(); }}>{ic}</button>)}
      <Slider label="Fill" value={Math.round((l?.fillOpacity ?? 1) * 100)} min={0} max={100} unit="%" onChange={(v) => set({ fillOpacity: v / 100 }, 'Fill Opacity Change')} />
    </div>
    <div className="layer-list" onDragOver={(e) => e.preventDefault()}>
      {rows.map((x) => <LayerRow key={x.id} d={d} l={x} depth={0} />)}
    </div>
    <div className="pfoot">
      <button className="icon-btn" title="Link layers" onClick={() => run('linkLayers')}><I.Link size={14} /></button>
      <button className="icon-btn" title="Add a layer style" onClick={() => app.openDialog('layerStyle')}><span className="fx">fx</span></button>
      <button className="icon-btn" title="Add layer mask" onClick={() => run('mask', d.s.selection ? 'revealSel' : 'reveal')}><I.SquareDot size={14} /></button>
      <AdjMenu />
      <button className="icon-btn" title="Create a new group" onClick={() => run('newGroup')}><I.FolderPlus size={14} /></button>
      <button className="icon-btn" title="Create a new layer" onClick={() => run('newLayer')}><I.FilePlus size={14} /></button>
      <button className="icon-btn" title="Delete layer" onClick={() => run('deleteLayer')}><I.Trash2 size={14} /></button>
    </div>
  </>);
}
function AdjMenu() {
  const [open, setOpen] = useState(false);
  return (<span className="popwrap"><button className="icon-btn" title="Create new fill or adjustment layer" onClick={() => setOpen(!open)}><I.Contrast size={14} /></button>
    {open && <div className="popmenu up" onPointerLeave={() => setOpen(false)}>
      {(['color', 'gradient', 'pattern'] as const).map((t) => <button key={t} onClick={() => { setOpen(false); run('newFill', { type: t }); }}>{t === 'color' ? 'Solid Color' : t[0].toUpperCase() + t.slice(1)}…</button>)}
      <div className="menu-sep" />
      {ADJ_TYPES.map((t) => <button key={t} onClick={() => { setOpen(false); run('newAdjustment', t); }}>{ADJ_LABELS[t]}…</button>)}
    </div>}</span>);
}

// ---------------- Channels / Paths ----------------
function ChannelsPanel({ d }: { d: Doc }) {
  const comp = getComposite(d), s = 36 / Math.max(d.w, d.h);
  const chThumb = (k: number) => { const c = makeCanvas(d.w * s, d.h * s), x = ctx2d(c); x.drawImage(comp, 0, 0, c.width, c.height); const im = x.getImageData(0, 0, c.width, c.height); for (let i = 0; i < im.data.length; i += 4) { const v = k < 0 ? im.data[i] : im.data[i + k]; if (k >= 0) { im.data[i] = im.data[i + 1] = im.data[i + 2] = v; } im.data[i + 3] = 255; } x.putImageData(im, 0, 0); return c.toDataURL(); };
  const row = (id: string, name: string, src: string, key?: string) => <div key={id} className={'layer-row' + (app.view.channel === id ? ' sel' : '')} onClick={() => { app.view.channel = app.view.channel === id && id !== 'rgb' ? 'rgb' : id; app.emit(); }}><img className="lthumb" src={src} alt="" /><span className="lname">{name}</span>{key && <kbd>{key}</kbd>}</div>;
  return (<>
    {row('rgb', d.s.mode === 'grayscale' ? 'Gray' : 'RGB', thumb(d, { ...d.layers[0], id: '__comp', ver: d.version, kind: 'raster', canvas: comp, x: 0, y: 0 } as Layer), 'Ctrl+2')}
    {d.s.mode !== 'grayscale' && <>{row('r', 'Red', chThumb(0), 'Ctrl+3')}{row('g', 'Green', chThumb(1), 'Ctrl+4')}{row('b', 'Blue', chThumb(2), 'Ctrl+5')}</>}
    {d.s.channels.map((c) => <div key={c.id} className={'layer-row' + (app.view.channel === c.id ? ' sel' : '')} onClick={() => { app.view.channel = app.view.channel === c.id ? 'rgb' : c.id; app.emit(); }} onDoubleClick={() => { const n = prompt('Channel name', c.name); if (n) { c.name = n; app.emit(); } }}>
      <img className="lthumb" src={(() => { const t = makeCanvas(d.w * s, d.h * s); ctx2d(t).drawImage(c.canvas, 0, 0, t.width, t.height); return t.toDataURL(); })()} alt="" /><span className="lname">{c.name}</span>
      <button className="icon-btn" title="Load as selection" onClick={(e) => { e.stopPropagation(); run('loadSelection', { id: c.id, op: e.shiftKey ? 'add' : e.altKey ? 'subtract' : 'new' }); }}><I.SquareDashed size={13} /></button>
      <button className="icon-btn" title="Delete channel" onClick={(e) => { e.stopPropagation(); run('deleteChannel', c.id); }}><I.Trash2 size={13} /></button></div>)}
    <div className="pfoot"><button className="icon-btn" title="Save selection as channel" disabled={!d.s.selection} onClick={() => run('saveSelection')}><I.SquareDot size={14} /></button><button className="icon-btn" title="Load channel as selection" disabled={!d.s.channels.length} onClick={() => d.s.channels[0] && run('loadSelection', { id: d.s.channels[d.s.channels.length - 1].id })}><I.SquareDashed size={14} /></button></div>
  </>);
}
function PathsPanel({ d }: { d: Doc }) {
  const ap = (d as any).activePath as string | undefined;
  return (<>
    {!d.s.paths.length && <p className="muted">Use the Pen or a shape tool in Path mode to make a path.</p>}
    {d.s.paths.map((p) => <div key={p.id} className={'layer-row' + (ap === p.id ? ' sel' : '')} onClick={() => { (d as any).activePath = p.id; app.emit(); }} onDoubleClick={() => { const n = prompt('Path name', p.name); if (n) { p.name = n; p.work = false; app.emit(); } }}>
      <span className="lthumb icon"><svg width="30" height="24" viewBox={`0 0 ${d.w} ${d.h}`}><path d={(() => { let s = ''; for (const sp of p.path.subpaths) { sp.points.forEach((q, i) => { s += (i ? 'L' : 'M') + q.x.toFixed(0) + ' ' + q.y.toFixed(0) + ' '; }); if (sp.closed) s += 'Z '; } return s; })()} fill="none" stroke="currentColor" strokeWidth={Math.max(d.w, d.h) / 40} /></svg></span>
      <span className="lname" style={p.work ? { fontStyle: 'italic' } : undefined}>{p.name}</span></div>)}
    <div className="pfoot">
      <button className="icon-btn" title="Fill path with foreground colour" disabled={!ap} onClick={() => run('fillPath', ap)}><I.PaintBucket size={14} /></button>
      <button className="icon-btn" title="Stroke path with brush" disabled={!ap} onClick={() => run('strokePath', ap)}><I.CircleDashed size={14} /></button>
      <button className="icon-btn" title="Load path as selection" disabled={!ap} onClick={() => run('pathToSelection', { id: ap })}><I.SquareDashed size={14} /></button>
      <button className="icon-btn" title="Make work path from selection" disabled={!d.s.selection} onClick={() => run('selectionToPath')}><I.Spline size={14} /></button>
      <button className="icon-btn" title="Delete path" disabled={!ap} onClick={() => { d.s.paths = d.s.paths.filter((p) => p.id !== ap); d.commit('Delete Path'); app.emit(); }}><I.Trash2 size={14} /></button>
    </div>
  </>);
}

// ---------------- History / Actions / Comps ----------------
function HistoryPanel({ d }: { d: Doc }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector('.act')?.scrollIntoView({ block: 'nearest' }); }, [d.hIndex, d.history.length]);
  const src = app.historySource ?? d.history[0]?.id;
  return (<>
    <div className="history-list" ref={ref}>
      {d.snapshots.map((s) => <div key={s.id} className="hist-row snap" onClick={() => { d.restoreSnapshot(s); clearCaches(); app.emit(); }}><button className={'hb' + (src === s.id ? ' on' : '')} title="Set the source for the history brush" onClick={(e) => { e.stopPropagation(); app.historySource = s.id; app.emit(); }}><I.Brush size={11} /></button><I.Camera size={12} /> {s.label}</div>)}
      {d.history.map((h, i) => <div key={h.id} className={'hist-row' + (i === d.hIndex ? ' act' : '') + (i > d.hIndex ? ' future' : '')} onClick={() => { d.goto(i); clearCaches(); app.emit(); }}>
        <button className={'hb' + (src === h.id ? ' on' : '')} title="Set the source for the history brush" onClick={(e) => { e.stopPropagation(); app.historySource = h.id; app.emit(); }}><I.Brush size={11} /></button>{h.label}</div>)}
    </div>
    <div className="pfoot"><button className="icon-btn" title="New snapshot" onClick={() => { d.takeSnapshot(); app.emit(); }}><I.Camera size={14} /></button><button className="icon-btn" title="New document from current state" onClick={() => run('duplicateDoc')}><I.Files size={14} /></button><button className="icon-btn" title="Step backward" onClick={() => run('undo')}><I.Undo2 size={14} /></button><button className="icon-btn" title="Step forward" onClick={() => run('redo')}><I.Redo2 size={14} /></button></div>
  </>);
}
const DEFAULT_ACTIONS = () => [
  { id: 'a-vig', name: 'Soft Vignette', steps: [{ cmd: 'filter', args: { id: 'vignette', params: { amount: 45, midpoint: 35 } }, label: 'Vignette' }] },
  { id: 'a-sepia', name: 'Sepia Toning', steps: [{ cmd: 'newAdjustment', args: 'bw', label: 'Black & White Layer' }, { cmd: 'newAdjustment', args: 'photoFilter', label: 'Photo Filter Layer' }] },
  { id: 'a-pop', name: 'Pop Contrast', steps: [{ cmd: 'autoContrast', label: 'Auto Contrast' }, { cmd: 'filter', args: { id: 'unsharp', params: { amount: 80, radius: 1.2, threshold: 2 } }, label: 'Unsharp Mask' }] },
  { id: 'a-web', name: 'Web Size 1600px', steps: [{ cmd: 'webResize', args: 1600, label: 'Resize to 1600px' }] },
  { id: 'a-frame', name: 'White Frame', steps: [{ cmd: 'frame', args: 40, label: 'Add 40px frame' }] },
  { id: 'a-mono', name: 'Moody Monochrome', steps: [{ cmd: 'desaturate', label: 'Desaturate' }, { cmd: 'adj:curves', args: { rgb: [[0, 10], [64, 50], [192, 205], [255, 245]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] }, label: 'Curves' }, { cmd: 'filter', args: { id: 'addnoise', params: { amount: 4, dist: 'gaussian', mono: true } }, label: 'Grain' }] },
];
function ActionsPanel() {
  if (!app.actions.length) { app.actions = DEFAULT_ACTIONS(); }
  const [sel, setSel] = useState<string | null>(null);
  return (<>
    <div className="history-list">
      {app.actions.map((a) => <div key={a.id}><div className={'hist-row' + (sel === a.id ? ' act' : '')} onClick={() => setSel(a.id)} onDoubleClick={() => run('playAction', a.id)}><I.ListVideo size={12} /> {a.name} {app.recording === a.id && <span className="rec">● REC</span>}</div>
        {sel === a.id && a.steps.map((s, i) => <div key={i} className="hist-row sub"><span>{s.label}</span><button className="icon-btn" title="Delete step" onClick={() => { a.steps.splice(i, 1); app.emit(); }}><I.X size={11} /></button></div>)}</div>)}
    </div>
    <div className="pfoot">
      <button className="icon-btn" title="Stop recording" onClick={() => { app.recording = null; app.emit(); }}><I.Square size={14} /></button>
      <button className={'icon-btn' + (app.recording ? ' rec' : '')} title="Begin recording" disabled={!sel} onClick={() => { app.recording = sel; app.toast('Recording. Menu commands you run are added to the action.'); app.emit(); }}><I.Circle size={14} /></button>
      <button className="icon-btn" title="Play selection" disabled={!sel || !app.doc} onClick={() => sel && run('playAction', sel)}><I.Play size={14} /></button>
      <button className="icon-btn" title="Create new action" onClick={() => { const n = prompt('Action name', `Action ${app.actions.length + 1}`); if (!n) return; const a = { id: 'a' + Date.now(), name: n, steps: [] }; app.actions.push(a); setSel(a.id); app.recording = a.id; app.toast('Recording. Menu commands you run are added to the action.'); app.emit(); }}><I.FilePlus size={14} /></button>
      <button className="icon-btn" title="Delete action" disabled={!sel} onClick={() => { app.actions = app.actions.filter((a) => a.id !== sel); setSel(null); app.emit(); }}><I.Trash2 size={14} /></button>
    </div>
  </>);
}
function CompsPanel({ d }: { d: Doc }) {
  return (<>{!d.s.comps.length && <p className="muted">Save layer visibility, position and opacity as a comp, then switch between comps.</p>}
    {d.s.comps.map((c) => <div key={c.id} className="hist-row" onClick={() => run('layerComp', { op: 'apply', id: c.id })}><I.Layers size={12} /> {c.name}<span className="pspacer" /><button className="icon-btn" title="Update" onClick={(e) => { e.stopPropagation(); run('layerComp', { op: 'update', id: c.id }); }}><I.RefreshCw size={11} /></button><button className="icon-btn" title="Delete" onClick={(e) => { e.stopPropagation(); run('layerComp', { op: 'delete', id: c.id }); }}><I.Trash2 size={11} /></button></div>)}
    <div className="pfoot"><button className="icon-btn" title="New layer comp" onClick={() => { const n = prompt('Layer comp name', `Layer Comp ${d.s.comps.length + 1}`); if (n) run('layerComp', { op: 'new', name: n }); }}><I.FilePlus size={14} /></button></div></>);
}

function vpathD(p: { subpaths: { points: { x: number; y: number; ix: number; iy: number; ox: number; oy: number }[]; closed: boolean }[] }) {
  let s = ''; for (const sp of p.subpaths) { const n = sp.points.length; if (!n) continue; s += `M${sp.points[0].x} ${sp.points[0].y} `; const m = sp.closed ? n : n - 1; for (let i = 0; i < m; i++) { const a = sp.points[i], b = sp.points[(i + 1) % n]; s += `C${a.ox} ${a.oy} ${b.ix} ${b.iy} ${b.x} ${b.y} `; } if (sp.closed) s += 'Z '; } return s;
}
// ---------------- Properties ----------------
function PropertiesPanel({ d }: { d: Doc }) {
  const l = d.active;
  const hist = useHist(d);
  const commitLater = (label: string) => { clearTimeout((window as any).__pt); (window as any).__pt = setTimeout(() => { d.commit(label); app.emit(); }, 350); };
  if (!l) return <DocProps d={d} />;
  const upd = (fn: () => void, label: string) => { fn(); l.ver++; clearCaches(l.id); d.touch(); app.emit(); commitLater(label); };
  return (<div className="props">
    {l.kind === 'adjustment' && l.adj && <><h4>{ADJ_LABELS[l.adj.type]}</h4><AdjEditor adj={l.adj} hist={hist} onChange={(p) => upd(() => { l.adj!.p = p; }, ADJ_LABELS[l.adj!.type])} />
      <div className="row"><button className="btn sm" onClick={() => run('clip')}>{l.clip ? 'Release clipping' : 'Clip to layer below'}</button><button className="btn sm" onClick={() => upd(() => { l.adj!.p = (ADJ_DEFAULTS as any)[l.adj!.type](); }, 'Reset')}>Reset</button></div></>}
    {l.kind === 'text' && l.text && <TextProps d={d} l={l} upd={upd} />}
    {l.kind === 'shape' && l.shape && <>
      <h4>Shape</h4>
      <div className="row"><span className="lbl">Fill</span><Select value={l.shape.fill.type} options={[['color', 'Color'], ['gradient', 'Gradient'], ['pattern', 'Pattern'], ['none', 'None']]} onChange={(v) => upd(() => { l.shape!.fill.type = v; if (v === 'gradient' && !l.shape!.fill.gradient) l.shape!.fill.gradient = app.gradient; }, 'Shape Fill')} />{l.shape.fill.type === 'color' && <ColorChip value={l.shape.fill.color} onChange={(v) => upd(() => { l.shape!.fill.color = v; }, 'Shape Fill')} />}
        {l.shape.fill.type === 'gradient' && <button className="grad-chip" style={{ background: gradientCss(l.shape.fill.gradient!) }} onClick={() => app.openDialog('gradient', { value: l.shape!.fill.gradient, onPick: (g: any) => upd(() => { l.shape!.fill.gradient = g; }, 'Shape Fill') })} />}
        {l.shape.fill.type === 'pattern' && <Select value={l.shape.fill.pattern || 'Dots'} options={patternNames().map((p) => [p, p] as [string, string])} onChange={(v) => upd(() => { l.shape!.fill.pattern = v; }, 'Shape Fill')} />}</div>
      {l.shape.fill.type === 'gradient' && <Slider label="Angle" value={l.shape.fill.angle ?? 90} min={-180} max={180} unit="°" onChange={(v) => upd(() => { l.shape!.fill.angle = v; }, 'Shape Fill')} />}
      <div className="row"><Check label="Stroke" value={l.shape.stroke.enabled} onChange={(v) => upd(() => { l.shape!.stroke.enabled = v; }, 'Shape Stroke')} /><ColorChip value={l.shape.stroke.color} onChange={(v) => upd(() => { l.shape!.stroke.color = v; }, 'Shape Stroke')} /><Num value={l.shape.stroke.width} min={0} max={500} onChange={(v) => upd(() => { l.shape!.stroke.width = v; }, 'Shape Stroke')} unit="px" width={48} /></div>
      <div className="row"><Select label="Align" value={l.shape.stroke.align} options={[['inside', 'Inside'], ['center', 'Center'], ['outside', 'Outside']]} onChange={(v) => upd(() => { l.shape!.stroke.align = v; }, 'Shape Stroke')} /><Select label="Caps" value={l.shape.stroke.cap} options={[['butt', 'Butt'], ['round', 'Round'], ['square', 'Square']]} onChange={(v) => upd(() => { l.shape!.stroke.cap = v; }, 'Shape Stroke')} /><Select label="Corners" value={l.shape.stroke.join} options={[['miter', 'Miter'], ['round', 'Round'], ['bevel', 'Bevel']]} onChange={(v) => upd(() => { l.shape!.stroke.join = v; }, 'Shape Stroke')} /></div>
      <Select label="Dashes" value={JSON.stringify(l.shape.stroke.dash)} options={[['[]', 'Solid'], ['[2,2]', 'Dashed'], ['[0,2]', 'Dotted'], ['[4,2,1,2]', 'Dash-dot']]} onChange={(v) => upd(() => { l.shape!.stroke.dash = JSON.parse(v); if (v === '[0,2]') l.shape!.stroke.cap = 'round'; }, 'Shape Stroke')} />
    </>}
    {l.kind === 'fill' && l.fill && <>
      <h4>Fill Layer</h4>
      <Seg value={l.fill.type} onChange={(v) => upd(() => { l.fill!.type = v; }, 'Fill Layer')} options={[['color', 'Color'], ['gradient', 'Gradient'], ['pattern', 'Pattern']]} />
      {l.fill.type === 'color' && <ColorChip size={40} value={l.fill.color} onChange={(v) => upd(() => { l.fill!.color = v; }, 'Fill Layer')} />}
      {l.fill.type === 'gradient' && <><div className="grad-big" style={{ background: gradientCss(l.fill.gradient) }} onClick={() => app.openDialog('gradient', { value: l.fill!.gradient, onPick: (g: any) => upd(() => { l.fill!.gradient = g; }, 'Fill Layer') })} />
        <Seg value={l.fill.shape} onChange={(v) => upd(() => { l.fill!.shape = v; }, 'Fill Layer')} options={[['linear', 'Linear'], ['radial', 'Radial'], ['angle', 'Angle'], ['reflected', 'Reflected'], ['diamond', 'Diamond']]} />
        <Slider label="Angle" value={l.fill.angle} min={-180} max={180} unit="°" onChange={(v) => upd(() => { l.fill!.angle = v; }, 'Fill Layer')} /><Slider label="Scale" value={l.fill.scale} min={10} max={150} unit="%" onChange={(v) => upd(() => { l.fill!.scale = v; }, 'Fill Layer')} /><Check label="Reverse" value={l.fill.reverse} onChange={(v) => upd(() => { l.fill!.reverse = v; }, 'Fill Layer')} /></>}
      {l.fill.type === 'pattern' && <><Select value={l.fill.pattern} options={patternNames().map((p) => [p, p] as [string, string])} onChange={(v) => upd(() => { l.fill!.pattern = v; }, 'Fill Layer')} /><Slider label="Scale" value={Math.round(l.fill.patScale * 100)} min={10} max={1000} unit="%" onChange={(v) => upd(() => { l.fill!.patScale = v / 100; }, 'Fill Layer')} /></>}
    </>}
    {l.kind === 'smart' && l.smart && <><h4>Smart Object</h4><p className="muted">{l.smart.name} · {l.smart.source.width} × {l.smart.source.height} px</p><div className="row"><button className="btn sm" onClick={() => run('editSmart')}>Edit Contents</button><button className="btn sm" onClick={() => run('replaceSmart')}>Replace…</button><button className="btn sm" onClick={() => run('freeTransform')}>Transform</button></div></>}
    {(l.kind === 'raster' || l.kind === 'smart' || l.kind === 'text' || l.kind === 'shape') && (() => { const p = layerContent(d, l); return p ? <><h4>Transform</h4><div className="row"><Num label="X" value={l.kind === 'raster' ? l.x : 0} onChange={(v) => upd(() => { if (l.kind === 'raster') l.x = Math.round(v); }, 'Move')} /><Num label="Y" value={l.kind === 'raster' ? l.y : 0} onChange={(v) => upd(() => { if (l.kind === 'raster') l.y = Math.round(v); }, 'Move')} /><button className="btn sm" onClick={() => run('freeTransform')}>Free Transform</button></div></> : null; })()}
    {l.artboard && <><h4>Artboard</h4>
      <div className="row"><Num label="X" value={l.artboard.x} onChange={(v) => run('setArtboard', { x: v })} /><Num label="Y" value={l.artboard.y} onChange={(v) => run('setArtboard', { y: v })} /></div>
      <div className="row"><Num label="W" value={l.artboard.w} min={1} onChange={(v) => run('setArtboard', { w: v })} /><Num label="H" value={l.artboard.h} min={1} onChange={(v) => run('setArtboard', { h: v })} /></div>
      <Select label="Size" value="" options={[['', 'Preset…'], ...ARTBOARD_PRESETS.map(([n]) => [n, n] as [string, string])]} onChange={(n) => { const p = ARTBOARD_PRESETS.find((x) => x[0] === n); if (p) run('setArtboard', { w: p[1], h: p[2] }); }} />
      <div className="row"><span className="lbl">Background</span><ColorChip value={l.artboard.bg || '#ffffff'} onChange={(v) => run('setArtboard', { bg: v })} /><Check label="Transparent" value={!l.artboard.bg} onChange={(v) => run('setArtboard', { bg: v ? null : '#ffffff' })} /><button className="btn sm" onClick={() => run('exportArtboards')}>Export all</button></div></>}
    {l.vmask && <><h4>Vector Mask</h4>
      <Slider label="Density" value={Math.round(l.vmask.density * 100)} min={0} max={100} unit="%" onChange={(v) => upd(() => { l.vmask!.density = v / 100; }, 'Vector Mask Density')} />
      <Slider label="Feather" value={l.vmask.feather} min={0} max={250} step={0.5} unit="px" onChange={(v) => upd(() => { l.vmask!.feather = v; }, 'Vector Mask Feather')} />
      <div className="row"><button className="btn sm" onClick={() => selectTool('direct-select')}>Edit path</button><button className="btn sm" onClick={() => run('vectorMask', 'toggle')}>{l.vmask.enabled ? 'Disable' : 'Enable'}</button><button className="btn sm" onClick={() => run('vectorMask', 'rasterize')}>Rasterize</button><button className="btn sm" onClick={() => run('vectorMask', 'delete')}>Delete</button></div></>}
    {l.mask && <><h4>Mask</h4>
      <Slider label="Density" value={Math.round(l.mask.density * 100)} min={0} max={100} unit="%" onChange={(v) => upd(() => { l.mask!.density = v / 100; }, 'Mask Density')} />
      <Slider label="Feather" value={l.mask.feather} min={0} max={250} step={0.5} unit="px" onChange={(v) => upd(() => { l.mask!.feather = v; }, 'Mask Feather')} />
      <div className="row"><button className="btn sm" onClick={() => { d.s.selection = (() => { const m = makeCanvas(d.w, d.h), x = ctx2d(m); x.fillStyle = l.mask!.bg ? '#fff' : '#000'; x.fillRect(0, 0, d.w, d.h); x.drawImage(l.mask!.canvas, l.mask!.x, l.mask!.y); return m; })(); app.openDialog('selectMask', { toMask: true }); }}>Select and Mask…</button><button className="btn sm" onClick={() => run('mask', 'invert')}>Invert</button><button className="btn sm" onClick={() => run('mask', 'toggle')}>{l.mask.enabled ? 'Disable' : 'Enable'}</button><button className="btn sm" onClick={() => run('mask', 'apply')}>Apply</button><button className="btn sm" onClick={() => run('mask', 'delete')}>Delete</button></div>
      <p className="muted">{app.editMask ? 'Painting edits the mask: black hides, white reveals.' : 'Click the mask thumbnail in the Layers panel to paint on it.'}</p></>}
    {l.kind === 'raster' && !l.mask && <><h4>Quick actions</h4><div className="row"><button className="btn sm" onClick={() => run('selectSubject')}>Select Subject</button><button className="btn sm" onClick={() => { run('selectSubject').then(() => run('mask', 'revealSel')); }}>Remove Background</button><button className="btn sm" onClick={() => run('autoTone')}>Auto Tone</button></div></>}
  </div>);
}
import { ADJ_DEFAULTS } from '../engine/adjust';
function useHist(d: Doc) {
  const [h, setH] = useState<Uint32Array | undefined>(); const v = d.version;
  useEffect(() => { const t = setTimeout(() => { const c = getComposite(d), s = Math.min(1, 300 / Math.max(d.w, d.h)), m = makeCanvas(d.w * s, d.h * s); ctx2d(m).drawImage(c, 0, 0, m.width, m.height); setH(histogram(getData(m).data).l); }, 200); return () => clearTimeout(t); }, [v, d]);
  return h;
}
function DocProps({ d }: { d: Doc }) {
  return (<div className="props"><h4>Document</h4>
    <div className="row"><span>{d.w} × {d.h} px</span><span className="muted">{d.s.resolution} ppi · {d.s.mode.toUpperCase()} · 8 bit</span></div>
    <div className="row"><button className="btn sm" onClick={() => app.openDialog('imageSize')}>Image Size…</button><button className="btn sm" onClick={() => app.openDialog('canvasSize')}>Canvas Size…</button></div>
    <h4>Rulers and grid</h4><div className="row"><Check label="Rulers" value={app.view.rulers} onChange={() => run('toggle', 'rulers')} /><Check label="Grid" value={app.view.grid} onChange={() => run('toggle', 'grid')} /><Num label="Grid" value={app.view.gridSize} min={2} max={1000} onChange={(v) => { app.view.gridSize = v; app.emit(); }} unit="px" /></div>
    <h4>Quick actions</h4><div className="row"><button className="btn sm" onClick={() => run('trim')}>Trim</button><button className="btn sm" onClick={() => run('rotateCanvas', { deg: 90 })}>Rotate 90°</button><button className="btn sm" onClick={() => { selectTool('crop'); }}>Crop</button><button className="btn sm" onClick={() => run('flatten')}>Flatten</button></div>
  </div>);
}
function TextProps({ d, l, upd }: { d: Doc; l: Layer; upd: (f: () => void, label: string) => void }) {
  const t = l.text!; void d;
  const sel = (window as any).__textSel; const ranged = !!sel && sel.id === l.id && sel.end > sel.start && sel.end <= t.text.length;
  const cur = ranged ? { ...t, ...Object.fromEntries(Object.entries((t.runs || []).find((r) => r.start <= sel.start && r.end > sel.start) || {}).filter(([k]) => k !== 'start' && k !== 'end')) } as typeof t : t;
  const setS = (k: string, v: any) => { if (ranged) V.styleRange(t, sel.start, sel.end, { [k]: v }); else (t as any)[k] = v; };
  return (<><h4>Type</h4>
    {ranged && <div className="banner">Styling characters {sel.start + 1}–{sel.end}: “{t.text.slice(sel.start, sel.end).slice(0, 24)}” <button className="btn sm" onClick={() => { (window as any).__textSel = null; app.emit(); }}>Whole layer</button></div>}
    {!ranged && <p className="muted small">Tip: select letters while editing the text to style only those letters.</p>}
    {t.path && <><Slider label="Path offset" value={t.pathOffset || 0} min={-100} max={100} unit="%" onChange={(v) => upd(() => { t.pathOffset = v; }, 'Path Offset')} /></>}
    {(t.runs?.length || 0) > 0 && <button className="btn sm" onClick={() => upd(() => { t.runs = []; }, 'Clear Character Styles')}>Clear character styles</button>}
    <Select value={cur.font} options={[...FONTS.map((f) => [f, f.split(',')[0]] as [string, string]), ...(FONTS.includes(cur.font) ? [] : [[cur.font, cur.font.split(',')[0]] as [string, string]])]} onChange={(v) => upd(() => setS('font', v), 'Font')} />
    <div className="row"><Select value={cur.weight} options={[[100, 'Thin'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [900, 'Black']]} onChange={(v) => upd(() => setS('weight', v), 'Font Weight')} /><Check label="Italic" value={cur.italic} onChange={(v) => upd(() => setS('italic', v), 'Italic')} /><ColorChip value={cur.color} onChange={(v) => upd(() => setS('color', v), 'Text Color')} /></div>
    <div className="row"><Num label="Size" value={+cur.size.toFixed(1)} min={1} max={4000} onChange={(v) => upd(() => setS('size', v), 'Font Size')} unit="px" /><Num label="Leading" value={t.leading} min={0} max={4000} onChange={(v) => upd(() => { t.leading = v; }, 'Leading')} /></div>
    <div className="row"><Num label="Tracking" value={cur.tracking} min={-1000} max={10000} step={10} onChange={(v) => upd(() => setS('tracking', v), 'Tracking')} /><Num label="Baseline" value={cur.baseline} min={-1000} max={1000} onChange={(v) => upd(() => setS('baseline', v), 'Baseline Shift')} /></div>
    <div className="row"><Num label="Scale H" value={t.scaleX} min={1} max={1000} onChange={(v) => upd(() => { t.scaleX = v; }, 'Scale')} unit="%" /><Num label="Scale V" value={t.scaleY} min={1} max={1000} onChange={(v) => upd(() => { t.scaleY = v; }, 'Scale')} unit="%" /></div>
    <div className="row">
      <Seg value={t.align} onChange={(v) => upd(() => { t.align = v; }, 'Align')} options={[['left', <I.AlignLeft size={13} />], ['center', <I.AlignCenter size={13} />], ['right', <I.AlignRight size={13} />], ['justify', <I.AlignJustify size={13} />]]} />
      <button className={'icon-btn' + (t.faux.bold ? ' on' : '')} title="Faux bold" onClick={() => upd(() => { t.faux.bold = !t.faux.bold; }, 'Faux Bold')}><I.Bold size={13} /></button>
      <button className={'icon-btn' + (t.faux.italic ? ' on' : '')} title="Faux italic" onClick={() => upd(() => { t.faux.italic = !t.faux.italic; }, 'Faux Italic')}><I.Italic size={13} /></button>
      <button className={'icon-btn' + (t.caps === 'all' ? ' on' : '')} title="All caps" onClick={() => upd(() => { t.caps = t.caps === 'all' ? 'none' : 'all'; }, 'All Caps')}><I.CaseUpper size={13} /></button>
      <button className={'icon-btn' + (cur.underline ? ' on' : '')} title="Underline" onClick={() => upd(() => setS('underline', !t.underline), 'Underline')}><I.Underline size={13} /></button>
      <button className={'icon-btn' + (cur.strike ? ' on' : '')} title="Strikethrough" onClick={() => upd(() => setS('strike', !t.strike), 'Strikethrough')}><I.Strikethrough size={13} /></button>
    </div>
    <div className="row"><Num label="Indent" value={t.indent} min={0} max={2000} onChange={(v) => upd(() => { t.indent = v; }, 'Indent')} /><Num label="Box width" value={t.boxWidth} min={0} max={20000} onChange={(v) => upd(() => { t.boxWidth = v; }, 'Paragraph Box')} /></div>
    <div className="row"><Check label="Vertical" value={t.vertical} onChange={(v) => upd(() => { t.vertical = v; }, 'Orientation')} /><Check label="Anti-alias" value={t.antialias} onChange={(v) => upd(() => { t.antialias = v; }, 'Anti-alias')} /><button className="btn sm" onClick={() => app.openDialog('warpText')}>Warp…</button><button className="btn sm" onClick={() => { (window as any).__monsoonView?.editText(l.id); }}>Edit text</button></div>
  </>);
}

// ---------------- Adjustments / Styles / Swatches / Color / Gradients / Patterns / Shapes / Brushes ----------------
function AdjustmentsPanel() {
  const icons: Record<AdjType, React.ReactNode> = { brightness: <I.Sun size={16} />, levels: <I.BarChart3 size={16} />, curves: <I.Spline size={16} />, exposure: <I.Aperture size={16} />, vibrance: <I.Triangle size={16} />, hsl: <I.Palette size={16} />, colorBalance: <I.Scale size={16} />, bw: <I.Contrast size={16} />, photoFilter: <I.Camera size={16} />, channelMixer: <I.Blend size={16} />, lookup: <I.Table size={16} />, invert: <I.FlipHorizontal size={16} />, posterize: <I.Layers3 size={16} />, threshold: <I.SquareSplitHorizontal size={16} />, gradientMap: <I.Rainbow size={16} />, selectiveColor: <I.Pipette size={16} /> };
  return <div className="adj-grid">{ADJ_TYPES.map((t) => <button key={t} className="icon-btn" title={ADJ_LABELS[t]} onClick={() => run('newAdjustment', t)}>{icons[t]}</button>)}</div>;
}
function StylesPanel() {
  const names = ['Soft Shadow', 'Glow', 'Outline', 'Embossed', 'Rain Glass', 'Neon', 'Sticker'];
  return <div className="style-grid">{names.map((n) => <button key={n} className="style-tile" onClick={() => run('quickStyle', n)}>{n}</button>)}<button className="style-tile" onClick={() => run('clearStyle')}>None</button></div>;
}
function SwatchesPanel() {
  return (<div className="swatches">{app.swatches.map((c, i) => <button key={i} className="sw" style={{ background: c }} title={c + ' (Alt-click to delete)'} onClick={(e) => { if (e.altKey) { app.swatches.splice(i, 1); } else if (e.shiftKey) app.bg = c; else app.fg = c; app.emit(); }} />)}
    <button className="sw add" title="Add foreground colour" onClick={() => { app.swatches.push(app.fg); app.emit(); }}>+</button></div>);
}
function ColorPanel() {
  const [mode, setMode] = useState<'rgb' | 'hsb' | 'cmyk' | 'lab'>('hsb');
  const c = hexToRgb(app.fg); const [h, s, v] = rgbToHsv(c.r, c.g, c.b);
  const setRGB = (r: number, g: number, b: number) => { app.fg = rgbToHex({ r, g, b }); app.emit(); };
  return (<div className="colorpanel">
    <div className="row"><div className="fgbg"><button className="swatch fg" style={{ background: app.fg }} onClick={() => app.openDialog('color', { value: app.fg, onPick: (x: string) => { app.fg = x; app.emit(); } })} /><button className="swatch bg" style={{ background: app.bg }} onClick={() => app.openDialog('color', { value: app.bg, onPick: (x: string) => { app.bg = x; app.emit(); } })} /></div>
      <Seg value={mode} onChange={setMode} options={[['hsb', 'HSB'], ['rgb', 'RGB'], ['cmyk', 'CMYK'], ['lab', 'Lab']]} /></div>
    {mode === 'rgb' && <><Slider label="R" value={c.r} min={0} max={255} onChange={(x) => setRGB(x, c.g, c.b)} /><Slider label="G" value={c.g} min={0} max={255} onChange={(x) => setRGB(c.r, x, c.b)} /><Slider label="B" value={c.b} min={0} max={255} onChange={(x) => setRGB(c.r, c.g, x)} /></>}
    {mode === 'hsb' && (() => { const sv = (H: number, S: number, V: number) => { const o = hsvToRgb(H, S, V); setRGB(o.r, o.g, o.b); }; return <><Slider label="H" value={Math.round(h)} min={0} max={359} onChange={(x) => sv(x, s, v)} unit="°" /><Slider label="S" value={Math.round(s * 100)} min={0} max={100} onChange={(x) => sv(h, x / 100, v)} unit="%" /><Slider label="B" value={Math.round(v * 100)} min={0} max={100} onChange={(x) => sv(h, s, x / 100)} unit="%" /></>; })()}
    {mode === 'cmyk' && (() => { const k = rgbToCmyk(c.r, c.g, c.b); const set = (i: number, x: number) => { const n = [...k]; n[i] = x; const o = CM(n); setRGB(o.r, o.g, o.b); }; return ['C', 'M', 'Y', 'K'].map((n, i) => <Slider key={n} label={n} value={Math.round(k[i])} min={0} max={100} onChange={(x) => set(i, x)} unit="%" />); })()}
    {mode === 'lab' && (() => { const L = rgbToLab(c.r, c.g, c.b); const set = (i: number, x: number) => { const n = [...L]; n[i] = x; const o = LB(n[0], n[1], n[2]); setRGB(o.r, o.g, o.b); }; return <><Slider label="L" value={Math.round(L[0])} min={0} max={100} onChange={(x) => set(0, x)} /><Slider label="a" value={Math.round(L[1])} min={-128} max={127} onChange={(x) => set(1, x)} /><Slider label="b" value={Math.round(L[2])} min={-128} max={127} onChange={(x) => set(2, x)} /></>; })()}
    <div className="hue-ramp" onPointerDown={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); const o = hsvToRgb(((e.clientX - r.left) / r.width) * 359, 1 - (e.clientY - r.top) / r.height * 0.5, 1 - Math.max(0, (e.clientY - r.top) / r.height - 0.5)); setRGB(o.r, o.g, o.b); }} />
  </div>);
}
import { cmykToRgb, labToRgb } from '../engine/util';
const CM = (n: number[]) => cmykToRgb(n[0], n[1], n[2], n[3]); const LB = labToRgb;
function GradientsPanel() { return <div className="swatches">{GRADIENT_PRESETS.map((g) => <button key={g.name} className={'gsw' + (app.gradient.name === g.name ? ' on' : '')} title={g.name} style={{ background: gradientCss(g) }} onClick={() => { app.gradient = g; selectTool('gradient'); }} />)}<button className="sw add" title="Edit gradient" onClick={() => app.openDialog('gradient')}>…</button></div>; }
function PatternsPanel() { return <div className="swatches">{patternNames().map((p) => <button key={p} className={'psw' + (app.pattern === p ? ' on' : '')} title={p} style={{ backgroundImage: `url(${getPattern(p).toDataURL()})` }} onClick={() => { app.pattern = p; app.emit(); }} />)}</div>; }
function ShapesPanel() {
  return <div className="swatches">{Object.keys(CUSTOM_SHAPES).map((k) => <button key={k} className={'shsw' + (app.opts.customShape === k ? ' on' : '')} title={k} onClick={() => { app.opts.customShape = k; selectTool('shape-custom'); }}>
    <svg width="28" height="28" viewBox="0 0 100 100"><path d={(() => { const p = svgToPath(CUSTOM_SHAPES[k], { x: 0, y: 0, w: 100, h: 100 }); let s = ''; for (const sp of p.subpaths) { sp.points.forEach((q, i) => { if (!i) s += `M${q.x} ${q.y} `; }); const n = sp.closed ? sp.points.length : sp.points.length - 1; for (let i = 0; i < n; i++) { const a = sp.points[i], b = sp.points[(i + 1) % sp.points.length]; s += `C${a.ox} ${a.oy} ${b.ix} ${b.iy} ${b.x} ${b.y} `; } if (sp.closed) s += 'Z '; } return s; })()} fill="currentColor" /></svg></button>)}</div>;
}
void pathToPath2D;
function BrushesPanel() {
  const b = app.brush; const set = (p: Partial<typeof b>) => { Object.assign(b, p); app.emit(); };
  return (<div className="brushes">
    <div className="brush-grid">{BRUSH_PRESETS.map((p) => { const t = makeTip({ ...b, ...p.s } as any, 26, (p.s.angle as number) || 0, (p.s.roundness as number) || 1); return <button key={p.name} title={p.name} className="brush-tile" onClick={() => set({ ...p.s })}><img src={(() => { const c = makeCanvas(32, 32), x = ctx2d(c); x.fillStyle = '#16171d'; x.fillRect(0, 0, 32, 32); x.drawImage(t, (32 - t.width) / 2, (32 - t.height) / 2); return c.toDataURL(); })()} alt="" /><span>{p.name}</span></button>; })}</div>
    <h4>Brush tip</h4>
    <Slider label="Size" value={b.size} min={1} max={1000} unit="px" onChange={(v) => set({ size: v })} /><Slider label="Hardness" value={Math.round(b.hardness * 100)} min={0} max={100} unit="%" onChange={(v) => set({ hardness: v / 100 })} />
    <Slider label="Angle" value={b.angle} min={-180} max={180} unit="°" onChange={(v) => set({ angle: v })} /><Slider label="Roundness" value={Math.round(b.roundness * 100)} min={5} max={100} unit="%" onChange={(v) => set({ roundness: v / 100 })} />
    <Slider label="Spacing" value={Math.round(b.spacing * 100)} min={1} max={1000} unit="%" onChange={(v) => set({ spacing: v / 100 })} />
    <h4>Shape dynamics</h4>
    <Slider label="Size jitter" value={Math.round(b.sizeJitter * 100)} min={0} max={100} unit="%" onChange={(v) => set({ sizeJitter: v / 100 })} /><Slider label="Angle jitter" value={Math.round(b.angleJitter * 100)} min={0} max={100} unit="%" onChange={(v) => set({ angleJitter: v / 100 })} /><Slider label="Roundness jitter" value={Math.round(b.roundJitter * 100)} min={0} max={100} unit="%" onChange={(v) => set({ roundJitter: v / 100 })} />
    <h4>Scattering</h4>
    <Slider label="Scatter" value={Math.round(b.scatter * 100)} min={0} max={1000} unit="%" onChange={(v) => set({ scatter: v / 100 })} /><Slider label="Count" value={b.count} min={1} max={16} onChange={(v) => set({ count: v })} />
    <h4>Color dynamics</h4>
    <Slider label="Fg/Bg jitter" value={Math.round(b.fgbgJitter * 100)} min={0} max={100} unit="%" onChange={(v) => set({ fgbgJitter: v / 100 })} /><Slider label="Hue jitter" value={Math.round(b.hueJitter * 100)} min={0} max={100} unit="%" onChange={(v) => set({ hueJitter: v / 100 })} /><Slider label="Brightness jitter" value={Math.round(b.brightJitter * 100)} min={0} max={100} unit="%" onChange={(v) => set({ brightJitter: v / 100 })} />
    <h4>Other</h4>
    <div className="row"><Check label="Transfer: pressure opacity" value={b.pressureOpacity} onChange={(v) => set({ pressureOpacity: v })} /><Check label="Wet edges" value={b.wetEdges} onChange={(v) => set({ wetEdges: v })} /><Check label="Noise" value={b.noise} onChange={(v) => set({ noise: v })} /><Check label="Build-up" value={b.airbrush} onChange={(v) => set({ airbrush: v })} /></div>
  </div>);
}

// ---------------- Navigator / Histogram / Info ----------------
function NavigatorPanel({ d }: { d: Doc }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return; const s = Math.min(220 / d.w, 140 / d.h); c.width = d.w * s; c.height = d.h * s;
    const x = c.getContext('2d')!; x.drawImage(getComposite(d), 0, 0, c.width, c.height);
    const v = (window as any).__monsoonView; const el = document.querySelector('.viewport'); if (!v || !el) return;
    const a = v.toDoc({ x: 0, y: 0 }), b = v.toDoc({ x: el.clientWidth, y: el.clientHeight });
    x.strokeStyle = '#ff4060'; x.lineWidth = 2; x.strokeRect(a.x * s, a.y * s, (b.x - a.x) * s, (b.y - a.y) * s);
  });
  const go = (e: React.PointerEvent) => { if (e.buttons !== 1 && e.type !== 'pointerdown') return; const r = ref.current!.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * d.w, py = ((e.clientY - r.top) / r.height) * d.h; d.panX = (d.w / 2 - px) * d.zoom; d.panY = (d.h / 2 - py) * d.zoom; app.emit(); };
  return (<><canvas ref={ref} className="nav" onPointerDown={go} onPointerMove={go} />
    <Slider label="" value={Math.round(Math.log2(d.zoom) * 100) / 100} min={-6} max={6} step={0.01} onChange={(v) => { (window as any).__monsoonView?.setZoom(Math.pow(2, v)); }} /><span className="muted">{Math.round(d.zoom * 100)}%</span></>);
}
function HistogramPanel({ d }: { d: Doc }) {
  const ref = useRef<HTMLCanvasElement>(null); const [ch, setCh] = useState<'rgb' | 'l' | 'r' | 'g' | 'b'>('rgb'); const [stats, setStats] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      const c = ref.current; if (!c) return; const comp = getComposite(d), s = Math.min(1, 400 / Math.max(d.w, d.h)), m = makeCanvas(d.w * s, d.h * s); ctx2d(m).drawImage(comp, 0, 0, m.width, m.height);
      const H = histogram(getData(m).data, d.s.selection ? (() => { const sm = makeCanvas(m.width, m.height); ctx2d(sm).drawImage(d.s.selection!, 0, 0, sm.width, sm.height); return getData(sm).data; })() : undefined);
      const x = c.getContext('2d')!; x.clearRect(0, 0, 256, 100); x.globalCompositeOperation = 'screen';
      const draw = (h: Uint32Array, col: string) => { let mx = 1; for (let i = 0; i < 256; i++) mx = Math.max(mx, h[i]); x.fillStyle = col; for (let i = 0; i < 256; i++) { const hh = (h[i] / mx) * 98; x.fillRect(i, 100 - hh, 1, hh); } };
      if (ch === 'rgb') { draw(H.r, '#ff4b4b'); draw(H.g, '#4bff6a'); draw(H.b, '#4b8bff'); } else draw(H[ch], ch === 'l' ? '#cfd3e0' : ch === 'r' ? '#ff4b4b' : ch === 'g' ? '#4bff6a' : '#4b8bff');
      x.globalCompositeOperation = 'source-over';
      let n = 0, sum = 0; for (let i = 0; i < 256; i++) { n += H.l[i]; sum += i * H.l[i]; } const mean = sum / Math.max(1, n); let vs = 0; for (let i = 0; i < 256; i++) vs += H.l[i] * (i - mean) ** 2; let acc = 0, med = 0; for (; med < 256; med++) { acc += H.l[med]; if (acc >= n / 2) break; }
      setStats(`Mean ${mean.toFixed(1)} · Std Dev ${Math.sqrt(vs / Math.max(1, n)).toFixed(1)} · Median ${med} · Pixels ${n}${s < 1 ? ' (sampled)' : ''}`);
    }, 150); return () => clearTimeout(t);
  }, [d.version, ch, d.s.selection]);
  return (<><Seg value={ch} onChange={setCh} options={[['rgb', 'Colors'], ['l', 'Luminosity'], ['r', 'R'], ['g', 'G'], ['b', 'B']]} /><canvas ref={ref} width={256} height={100} className="hist" /><p className="muted small">{stats}</p></>);
}
function InfoPanel({ d }: { d: Doc }) {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); window.addEventListener('pointermove', f); return () => window.removeEventListener('pointermove', f); }, []);
  const v = (window as any).__monsoonView; const pos = (window as any).__lastPos as { x: number; y: number } | undefined;
  const comp = getComposite(d);
  const px = (x: number, y: number) => { if (x < 0 || y < 0 || x >= d.w || y >= d.h) return null; const p = ctx2d(comp).getImageData(Math.floor(x), Math.floor(y), 1, 1).data; return p; };
  const fmt = (p: Uint8ClampedArray | null) => { if (!p) return '—'; const k = rgbToCmyk(p[0], p[1], p[2]); return `R ${p[0]}  G ${p[1]}  B ${p[2]}  A ${p[3]}\nC ${k[0].toFixed(0)}%  M ${k[1].toFixed(0)}%  Y ${k[2].toFixed(0)}%  K ${k[3].toFixed(0)}%  ${rgbToHex({ r: p[0], g: p[1], b: p[2] })}`; };
  const sel = d.s.selection ? (() => { const b = (window as any).__selBounds; return b; })() : null; void sel; void v;
  return (<div className="info">
    <pre>{pos ? `X ${Math.floor(pos.x)}  Y ${Math.floor(pos.y)}\n${fmt(px(pos.x, pos.y))}` : 'Move over the image'}</pre>
    {d.s.samplers.map((s, i) => <pre key={i}>#{i + 1}  {fmt(px(s.x, s.y))}</pre>)}
    <pre className="muted">Doc: {d.w} × {d.h} px · {(d.w * d.h * 4 / 1048576).toFixed(1)} MB per layer</pre>
  </div>);
}

// ---------------- Dock ----------------
export function Dock({ only }: { only?: string[] } = {}) {
  const d = app.doc; const o: Record<string, boolean> = only ? Object.fromEntries(only.map((k) => [k, true])) : app.panelsOpen;
  const any = (...k: string[]) => k.some((x) => o[x]);
  const noDoc = <p className="muted">Open or create a document.</p>;
  return (
    <aside className={only ? 'dock sheet-dock' : 'dock'}>
      {any('navigator', 'histogram', 'info') && <Panel id="nav" tabs={([['navigator', 'Navigator'], ['histogram', 'Histogram'], ['info', 'Info']] as [string, string][]).filter(([k]) => o[k])}>
        {!d ? noDoc : tabOf('nav', ['navigator', 'histogram', 'info'].find((k) => o[k])!) === 'histogram' && o.histogram ? <HistogramPanel d={d} /> : tabOf('nav', '') === 'info' && o.info ? <InfoPanel d={d} /> : o.navigator ? <NavigatorPanel d={d} /> : o.histogram ? <HistogramPanel d={d} /> : <InfoPanel d={d} />}
      </Panel>}
      {any('color', 'swatches', 'gradients', 'patterns', 'shapes') && (() => { const tabs = ([['color', 'Color'], ['swatches', 'Swatches'], ['gradients', 'Gradients'], ['patterns', 'Patterns'], ['shapes', 'Shapes']] as [string, string][]).filter(([k]) => o[k]); const t = tabs.find(([k]) => k === tabOf('col', ''))?.[0] || tabs[0][0]; return <Panel id="col" tabs={tabs}>{t === 'color' ? <ColorPanel /> : t === 'swatches' ? <SwatchesPanel /> : t === 'gradients' ? <GradientsPanel /> : t === 'patterns' ? <PatternsPanel /> : <ShapesPanel />}</Panel>; })()}
      {any('brushes') && <Panel id="brushes" title="Brush Settings"><BrushesPanel /></Panel>}
      {any('character', 'paragraph') && <Panel id="character" title="Character & Paragraph">{d?.active?.text ? <TextProps d={d} l={d.active} upd={(f, label) => { f(); d.active!.ver++; d.touch(); app.emit(); d.commit(label); }} /> : <p className="muted">Select a type layer to edit its character and paragraph settings.</p>}</Panel>}
      {any('properties', 'adjustments', 'styles') && (() => { const tabs = ([['properties', 'Properties'], ['adjustments', 'Adjustments'], ['styles', 'Styles']] as [string, string][]).filter(([k]) => o[k]); const t = tabs.find(([k]) => k === tabOf('prop', ''))?.[0] || tabs[0][0]; return <Panel id="prop" tabs={tabs}>{t === 'adjustments' ? <AdjustmentsPanel /> : t === 'styles' ? <StylesPanel /> : d ? <PropertiesPanel d={d} /> : noDoc}</Panel>; })()}
      {any('layers', 'channels', 'paths') && (() => { const tabs = ([['layers', 'Layers'], ['channels', 'Channels'], ['paths', 'Paths']] as [string, string][]).filter(([k]) => o[k] || k !== 'layers' && o.layers); const t = tabs.find(([k]) => k === tabOf('lay', ''))?.[0] || tabs[0][0]; return <Panel id="lay" tabs={tabs}>{!d ? noDoc : t === 'channels' ? <ChannelsPanel d={d} /> : t === 'paths' ? <PathsPanel d={d} /> : <LayersPanel d={d} />}</Panel>; })()}
      {any('timeline') && <Panel id="timeline" title="Timeline">{d ? <TimelinePanel d={d} /> : noDoc}</Panel>}
      {any('history', 'actions', 'comps') && (() => { const tabs = ([['history', 'History'], ['actions', 'Actions'], ['comps', 'Layer Comps']] as [string, string][]).filter(([k]) => o[k] || k !== 'history' && o.history); const t = tabs.find(([k]) => k === tabOf('his', ''))?.[0] || tabs[0][0]; return <Panel id="his" tabs={tabs}>{t === 'actions' ? <ActionsPanel /> : !d ? noDoc : t === 'comps' ? <CompsPanel d={d} /> : <HistoryPanel d={d} />}</Panel>; })()}
    </aside>
  );
}
export { flatten, maskAlpha };
