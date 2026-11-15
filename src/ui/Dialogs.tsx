// Modal dialogs: document setup, file, image, select, filter and adjustment dialogs.
import { useEffect, useMemo, useRef, useState } from 'react';
import { app, requireDoc, applyToPixels, paintTarget } from '../app';
import type { AdjType, BlendMode } from '../engine/types';
import { run, Sel } from '../cmds';
import { ADJ_DEFAULTS, ADJ_LABELS, applyAdjustment, histogram, replaceColor } from '../engine/adjust';
import { FILTER_MAP, FILTERS, defaults as filterDefaults, Param } from '../engine/filterdefs';
import { ctx2d, makeCanvas, getData, hexToRgb, Canvas } from '../engine/util';
import { layerContent, flatten, clearCaches } from '../engine/render';
import { Slider, Select, Check, ColorChip, Num, Seg } from './controls';
import { blendOpts } from './OptionsBar';
import { AdjEditor } from './AdjEditor';
import { listRecent, listRecovery, openNative, dropRecovery, StoredDoc, ExportFormat, exportDoc } from '../engine/io';
import { MENUS } from './Menus';
import { TOOL_GROUPS } from './Toolbar';
import { patternNames } from '../engine/paint';
import { LayerStyleDialog, LiquifyDialog, CameraRawDialog, LensDialog, ColorPickerDialog, GradientDialog, WarpTextDialog } from './DialogsFx';
import { getComposite } from './View';
import * as I from 'lucide-react';

export function Modal({ title, children, onOk, onCancel, okLabel = 'OK', wide, extra, className }: { title: string; children: React.ReactNode; onOk?: () => void; onCancel?: () => void; okLabel?: string; wide?: boolean | 'xl'; extra?: React.ReactNode; className?: string }) {
  const cancel = onCancel || (() => app.closeDialog());
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } else if (e.key === 'Enter' && onOk && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLSelectElement)) { e.preventDefault(); e.stopPropagation(); onOk(); } };
    window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true);
  });
  return (
    <div className="modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      <div className={'modal' + (wide === 'xl' ? ' xl' : wide ? ' wide' : '') + (className ? ' ' + className : '')} role="dialog" aria-label={title}>
        <header><span>{title}</span><button className="icon-btn" aria-label="Close" onClick={cancel}><I.X size={16} /></button></header>
        <div className="mbody">{children}</div>
        <footer>{extra}<span className="pspacer" /><button className="btn" onClick={cancel}>Cancel</button>{onOk && <button className="btn primary" onClick={onOk}>{okLabel}</button>}</footer>
      </div>
    </div>
  );
}
import * as DFM from '../engine/deform';
const close = () => app.closeDialog();
const ok = (cmd: string, args?: any, label?: string) => { close(); run(cmd, args, label); };

// ---- preview helpers ----
/** A small copy of the pixels the dialog will change: the active layer (or composite) inside the selection bounds. */
function usePreviewSource(maxSize = 360) {
  return useMemo(() => {
    const d = app.doc; if (!d) return null;
    const l = d.active; let src: Canvas, ox = 0, oy = 0;
    const p = l && (l.kind === 'raster' || l.kind === 'smart' || l.kind === 'text' || l.kind === 'shape') ? layerContent(d, l) : null;
    if (p) { src = p.canvas; ox = p.x; oy = p.y; } else src = getComposite(d);
    let r = { x: 0, y: 0, w: d.w, h: d.h };
    if (d.s.selection) { const b = Sel.maskBounds(d.s.selection); if (b) r = b; }
    const s = Math.min(1, maxSize / Math.max(r.w, r.h)), c = makeCanvas(Math.max(1, r.w * s), Math.max(1, r.h * s));
    const x = ctx2d(c); x.imageSmoothingQuality = 'high'; x.drawImage(src, r.x - ox, r.y - oy, r.w, r.h, 0, 0, c.width, c.height);
    return { canvas: c, scale: s, data: getData(c) };
  }, []);
}
function Preview({ src, fn, deps }: { src: { canvas: Canvas; data: ImageData; scale: number } | null; fn: (img: ImageData, scale: number) => ImageData | void; deps: any[] }) {
  const ref = useRef<HTMLCanvasElement>(null); const [before, setBefore] = useState(false);
  useEffect(() => {
    if (!src || !ref.current) return; const c = ref.current; if (c.width !== src.canvas.width || c.height !== src.canvas.height) { c.width = src.canvas.width; c.height = src.canvas.height; }
    const t = setTimeout(() => {
      const x = c.getContext('2d')!;
      if (before) { x.clearRect(0, 0, c.width, c.height); x.drawImage(src.canvas, 0, 0); return; }
      const img = new ImageData(new Uint8ClampedArray(src.data.data), src.data.width, src.data.height);
      try { const r = fn(img, src.scale) || img; x.putImageData(r, 0, 0); } catch (e) { console.error(e); }
    }, 60);
    return () => clearTimeout(t);
  }, [...deps, before]);
  if (!src) return null;
  return <div className="preview-box"><canvas ref={ref} className="preview" onPointerDown={() => setBefore(true)} onPointerUp={() => setBefore(false)} onPointerLeave={() => setBefore(false)} /><span className="muted small">Hold on the preview to see the original</span></div>;
}
export function ParamControls({ params, value, onChange }: { params: Param[]; value: any; onChange: (v: any) => void }) {
  return <>{params.map((p) => p.type === 'range' ? <Slider key={p.key} label={p.label} value={value[p.key]} min={p.min!} max={p.max!} step={p.step} unit={p.unit} onChange={(v) => onChange({ ...value, [p.key]: v })} />
    : p.type === 'select' ? <Select key={p.key} label={p.label} value={value[p.key]} options={p.options!} onChange={(v) => onChange({ ...value, [p.key]: v })} />
    : p.type === 'check' ? <Check key={p.key} label={p.label} value={!!value[p.key]} onChange={(v) => onChange({ ...value, [p.key]: v })} />
    : <div key={p.key} className="row"><span className="lbl">{p.label}</span><ColorChip value={value[p.key]} onChange={(v) => onChange({ ...value, [p.key]: v })} /></div>)}</>;
}

// ---------------- File ----------------
const PRESETS: [string, number, number, number][] = [
  ['Default 1920 × 1080', 1920, 1080, 72], ['Square 1080', 1080, 1080, 72], ['Portrait 1080 × 1350', 1080, 1350, 72], ['Story 1080 × 1920', 1080, 1920, 72],
  ['Phone 1179 × 2556', 1179, 2556, 72], ['4K UHD 3840 × 2160', 3840, 2160, 72], ['Photo 6 × 4 in', 1800, 1200, 300], ['Photo 7 × 5 in', 2100, 1500, 300],
  ['A4 300 ppi', 2480, 3508, 300], ['US Letter 300 ppi', 2550, 3300, 300], ['Icon 1024', 1024, 1024, 72], ['Web banner 1200 × 628', 1200, 628, 72],
];
function NewDialog() {
  const [name, setName] = useState('Untitled-' + (app.docs.length + 1));
  const [w, setW] = useState(1920), [h, setH] = useState(1080), [res, setRes] = useState(72), [bg, setBg] = useState('white'), [custom, setCustom] = useState('#6c7cff');
  const [unit, setUnit] = useState<'px' | 'in' | 'cm'>('px');
  const toU = (v: number) => unit === 'px' ? v : unit === 'in' ? +(v / res).toFixed(2) : +(v / res * 2.54).toFixed(2);
  const fromU = (v: number) => Math.max(1, Math.round(unit === 'px' ? v : unit === 'in' ? v * res : v / 2.54 * res));
  return (<Modal title="New Document" wide onOk={() => { if (w * h > 64e6) { app.toast('That is larger than 64 megapixels. Try a smaller size.', 'error'); return; } ok('new', { name, w, h, bg: bg === 'custom' ? custom : bg, res }); }} okLabel="Create">
    <div className="two-col">
      <div className="preset-list">{PRESETS.map(([n, pw, ph, pr]) => <button key={n} className={'preset' + (pw === w && ph === h ? ' on' : '')} onClick={() => { setW(pw); setH(ph); setRes(pr); }}><span className="preset-shape" style={{ aspectRatio: `${pw}/${ph}` }} />{n}</button>)}</div>
      <div className="form">
        <label className="field"><span className="field-label">Name</span><input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></label>
        <div className="row"><Num label="Width" value={toU(w)} min={0.01} onChange={(v) => setW(fromU(v))} width={80} /><Num label="Height" value={toU(h)} min={0.01} onChange={(v) => setH(fromU(v))} width={80} /><Select value={unit} options={[['px', 'Pixels'], ['in', 'Inches'], ['cm', 'Centimeters']]} onChange={setUnit} /></div>
        <div className="row"><button className="btn sm" onClick={() => { setW(h); setH(w); }}><I.RectangleVertical size={13} /> Swap orientation</button><Num label="Resolution" value={res} min={1} max={2400} onChange={setRes} unit="ppi" /></div>
        <Select label="Background" value={bg} options={[['white', 'White'], ['black', 'Black'], ['bg', 'Background colour'], ['transparent', 'Transparent'], ['custom', 'Custom…']]} onChange={setBg} />
        {bg === 'custom' && <ColorChip value={custom} onChange={setCustom} size={28} />}
        <p className="muted">{w} × {h} px · {(w * h * 4 / 1048576).toFixed(1)} MB per layer</p>
      </div>
    </div>
  </Modal>);
}
function RecentDialog() {
  const [items, setItems] = useState<{ rec: StoredDoc[]; recent: StoredDoc[] }>({ rec: [], recent: [] });
  useEffect(() => { Promise.all([listRecovery(), listRecent()]).then(([rec, recent]) => setItems({ rec, recent })); }, []);
  const open = async (s: StoredDoc, recovered: boolean) => { const d = await openNative(await s.blob.arrayBuffer(), s.name); if (recovered) { d.dirty = true; dropRecovery(s.id); } app.addDoc(d); close(); };
  const Item = ({ s, rec }: { s: StoredDoc; rec: boolean }) => <button className="recent-item" onClick={() => open(s, rec)}>{s.thumb ? <img src={URL.createObjectURL(s.thumb)} alt="" /> : <I.Image size={32} />}<span>{s.name}</span><span className="muted small">{s.w} × {s.h} · {new Date(s.time).toLocaleString()}</span></button>;
  return (<Modal title="Recent Documents" wide>
    {items.rec.length > 0 && <><h4>Recovered after an unexpected close</h4><div className="recent-grid">{items.rec.map((s) => <Item key={s.id} s={s} rec />)}</div></>}
    <h4>Recent</h4>{items.recent.length ? <div className="recent-grid">{items.recent.map((s) => <Item key={s.id + s.time} s={s} rec={false} />)}</div> : <p className="muted">Documents you save appear here.</p>}
  </Modal>);
}
const FORMATS: [ExportFormat, string][] = [['monsoon', 'Monsoon document (.monsoon)'], ['psd', 'Layered PSD (.psd)'], ['png', 'PNG'], ['jpeg', 'JPEG'], ['webp', 'WebP'], ['avif', 'AVIF'], ['gif', 'GIF'], ['tiff', 'TIFF'], ['bmp', 'BMP'], ['pdf', 'PDF'], ['svg', 'SVG (embedded image)']];
function SaveAsDialog() { const [f, setF] = useState<ExportFormat>('monsoon'); return <Modal title="Save As" onOk={() => ok('saveAs', f)} okLabel="Save"><Select label="Format" value={f} options={FORMATS} onChange={setF} /><p className="muted">{f === 'monsoon' || f === 'psd' ? 'Keeps layers, masks, type and effects.' : 'Flattens the image. Keep a .monsoon or .psd copy to edit later.'}</p></Modal>; }
function ExportDialog({ web }: { web?: boolean }) {
  const d = requireDoc(); const [fmt, setFmt] = useState<ExportFormat>(web ? 'jpeg' : 'png'); const [q, setQ] = useState(85); const [scale, setScale] = useState(100); const [size, setSize] = useState('');
  useEffect(() => { let alive = true; const t = setTimeout(async () => { try { const b = await exportDoc(d, fmt, q / 100, Math.min(scale / 100, 1)); if (alive) setSize(scale > 100 ? '' : (b.size / 1024 > 1024 ? (b.size / 1048576).toFixed(2) + ' MB' : (b.size / 1024).toFixed(0) + ' KB')); } catch { setSize(''); } }, 300); return () => { alive = false; clearTimeout(t); }; }, [fmt, q, scale]);
  return (<Modal title={web ? 'Save for Web' : 'Export As'} onOk={() => ok('export', { fmt, quality: q / 100, scale: scale / 100 })} okLabel="Export">
    <Select label="Format" value={fmt} options={FORMATS.filter(([f]) => f !== 'monsoon' && f !== 'psd')} onChange={setFmt} />
    {(fmt === 'jpeg' || fmt === 'webp' || fmt === 'avif') && <Slider label="Quality" value={q} min={1} max={100} unit="%" onChange={setQ} />}
    <Slider label="Scale" value={scale} min={5} max={400} unit="%" onChange={setScale} />
    <p className="muted">{Math.round(d.w * scale / 100)} × {Math.round(d.h * scale / 100)} px{size && ` · about ${size}`}</p>
  </Modal>);
}
function ExportLayersDialog() { const [fmt, setFmt] = useState<ExportFormat>('png'), [trim, setTrim] = useState(true); return <Modal title="Export Layers to Files" onOk={() => ok('exportLayers', { fmt, trim })} okLabel="Export"><Select label="Format" value={fmt} options={FORMATS.filter(([f]) => ['png', 'jpeg', 'webp', 'tiff'].includes(f))} onChange={setFmt} /><Check label="Trim layers to their content" value={trim} onChange={setTrim} /><p className="muted">Every visible layer is saved as its own file inside a zip.</p></Modal>; }
function BatchDialog() {
  if (!app.actions.length) return <Modal title="Batch"><p>Open the Actions panel to create an action first.</p></Modal>;
  const [a, setA] = useState(app.actions[0].id), [fmt, setFmt] = useState<ExportFormat>('jpeg');
  return <Modal title="Batch" onOk={() => ok('batch', { actionId: a, fmt })} okLabel="Choose files…"><Select label="Play action" value={a} options={app.actions.map((x) => [x.id, x.name] as [string, string])} onChange={setA} /><Select label="Save as" value={fmt} options={FORMATS.filter(([f]) => !['monsoon', 'psd', 'svg'].includes(f))} onChange={setFmt} /><p className="muted">Each file is opened, the action runs, and the results download together as a zip.</p></Modal>;
}
function FileInfoDialog() {
  const d = requireDoc(); const meta = ((d as any).meta ||= { title: '', author: '', description: '', keywords: '', copyright: '' });
  const [m, setM] = useState({ ...meta });
  return <Modal title={`File Info: ${d.name}`} onOk={() => { Object.assign(meta, m); d.dirty = true; close(); }}>
    {(['title', 'author', 'description', 'keywords', 'copyright'] as const).map((k) => <label key={k} className="field"><span className="field-label">{k[0].toUpperCase() + k.slice(1)}</span>{k === 'description' ? <textarea value={m[k]} onChange={(e) => setM({ ...m, [k]: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /> : <input value={m[k]} onChange={(e) => setM({ ...m, [k]: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />}</label>)}
    <p className="muted">{d.w} × {d.h} px · {d.s.resolution} ppi · {d.history.length} history states</p>
  </Modal>;
}
function FadeDialog() {
  const d = requireDoc(); const l = d.active; const prev = d.history[d.hIndex - 1];
  const [op, setOp] = useState(100), [mode, setMode] = useState<BlendMode>('normal');
  const label = d.history[d.hIndex]?.label;
  const apply = () => {
    if (!l || !prev) return close();
    const find = (ls: any[]): any => { for (const x of ls) { if (x.id === l.id) return x; if (x.children) { const r = find(x.children); if (r) return r; } } };
    const old = find(prev.state.layers); if (!old?.canvas || !l.canvas) { app.toast('The last step cannot be faded.', 'error'); return close(); }
    const now = l.canvas, out = makeCanvas(now.width, now.height), x = ctx2d(out);
    x.drawImage(old.canvas, old.x - l.x, old.y - l.y);
    import('../engine/blend').then(({ drawBlended }) => { drawBlended(out, now, 0, 0, mode, op / 100); close(); run('applyCanvas', { canvas: out, label: 'Fade ' + label, layerId: l.id }); });
  };
  return <Modal title={`Fade ${label || ''}`} onOk={apply}><Slider label="Opacity" value={op} min={0} max={100} unit="%" onChange={setOp} /><Select label="Mode" value={mode} options={blendOpts(false)} onChange={setMode} /></Modal>;
}
function FillDialog() {
  const [use, setUse] = useState('fg'), [color, setColor] = useState(app.fg), [pattern, setPattern] = useState(app.pattern), [mode, setMode] = useState<BlendMode>('normal'), [opacity, setOp] = useState(100), [preserve, setPreserve] = useState(false);
  return <Modal title="Fill" onOk={() => ok('fill', { use, color, pattern, mode, opacity: opacity / 100, preserve })}>
    <Select label="Contents" value={use} options={[['fg', 'Foreground Color'], ['bg', 'Background Color'], ['color', 'Color…'], ['content', 'Content-Aware'], ['pattern', 'Pattern'], ['history', 'History'], ['black', 'Black'], ['gray', '50% Gray'], ['white', 'White']]} onChange={setUse} />
    {use === 'color' && <ColorChip value={color} onChange={setColor} size={28} />}
    {use === 'pattern' && <Select label="Pattern" value={pattern} options={patternNames().map((p) => [p, p] as [string, string])} onChange={setPattern} />}
    {use !== 'content' && <><Select label="Mode" value={mode} options={blendOpts(false)} onChange={setMode} /><Slider label="Opacity" value={opacity} min={0} max={100} unit="%" onChange={setOp} /><Check label="Preserve Transparency" value={preserve} onChange={setPreserve} /></>}
  </Modal>;
}
function StrokeDialog() {
  const [width, setW] = useState(4), [color, setC] = useState(app.fg), [location, setL] = useState<'inside' | 'center' | 'outside'>('center'), [mode, setMode] = useState<BlendMode>('normal'), [opacity, setOp] = useState(100);
  return <Modal title="Stroke" onOk={() => ok('stroke', { width, color, location, mode, opacity: opacity / 100 })}>
    <div className="row"><Num label="Width" value={width} min={1} max={250} onChange={setW} unit="px" /><ColorChip value={color} onChange={setC} size={26} /></div>
    <Seg value={location} onChange={setL} options={[['inside', 'Inside'], ['center', 'Center'], ['outside', 'Outside']]} />
    <Select label="Mode" value={mode} options={blendOpts(false)} onChange={setMode} /><Slider label="Opacity" value={opacity} min={0} max={100} unit="%" onChange={setOp} />
  </Modal>;
}
function ShortcutsDialog() {
  const [q, setQ] = useState('');
  const rows: [string, string, string][] = [];
  const walk = (menu: string, items: any[]) => { for (const it of items) { if (it.sub) walk(menu + ' › ' + it.label, it.sub); else if (it.key) rows.push([menu, it.label, it.key]); } };
  MENUS.forEach((m) => walk(m.label, m.items));
  for (const g of TOOL_GROUPS) for (const t of g) if (t.key) rows.push(['Tools', t.name, t.key + (g.length > 1 ? ' (Shift+' + t.key + ' cycles)' : '')]);
  rows.push(['Painting', 'Smaller / larger brush', '[ / ]'], ['Painting', 'Softer / harder brush', 'Shift+[ / Shift+]'], ['Painting', 'Layer or tool opacity', '1 … 0'], ['View', 'Temporary hand tool', 'Space'], ['View', 'Hide panels', 'Tab'], ['Color', 'Swap / default colours', 'X / D'], ['Selection', 'Quick mask', 'Q'], ['View', 'Cycle screen mode', 'F']);
  const f = rows.filter((r) => (r.join(' ')).toLowerCase().includes(q.toLowerCase()));
  return <Modal title="Keyboard Shortcuts" wide><input className="search" placeholder="Search shortcuts" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} autoFocus />
    <div className="shortcut-list">{f.map((r, i) => <div key={i} className="shortcut"><span className="muted">{r[0]}</span><span>{r[1]}</span><kbd>{r[2]}</kbd></div>)}</div><p className="muted small">On a Mac, Ctrl means Command and Alt means Option.</p></Modal>;
}
function PrefsDialog() {
  const [p, setP] = useState({ ...app.prefs });
  return <Modal title="Preferences" onOk={() => { Object.assign(app.prefs, p); for (const d of app.docs) d.maxHistory = p.historyStates; try { localStorage.setItem('monsoon-prefs', JSON.stringify(app.prefs)); } catch { /* */ } close(); app.emit(); }}>
    <Select label="Theme" value={p.theme} options={[['dark', 'Dark'], ['storm', 'Storm'], ['light', 'Light']]} onChange={(v) => setP({ ...p, theme: v })} />
    <Slider label="Interface scale" value={Math.round(p.interfaceScale * 100)} min={80} max={150} unit="%" onChange={(v) => setP({ ...p, interfaceScale: v / 100 })} />
    <Slider label="History states" value={p.historyStates} min={5} max={200} onChange={(v) => setP({ ...p, historyStates: v })} />
    <Slider label="Auto-save recovery every" value={p.autosaveMinutes} min={0} max={30} unit="min" onChange={(v) => setP({ ...p, autosaveMinutes: v })} />
    <Select label="Rulers" value={p.units} options={[['px', 'Pixels'], ['in', 'Inches'], ['cm', 'Centimeters']]} onChange={(v) => setP({ ...p, units: v })} />
    <Select label="Transparency grid" value={p.checker} options={[['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['none', 'None']]} onChange={(v) => setP({ ...p, checker: v })} />
    <Check label="Scrubby sliders" value={app.opts.scrubby} onChange={(v) => { app.opts.scrubby = v; app.emit(); }} />
  </Modal>;
}
function IndexedDialog() { const [c, setC] = useState(64), [dither, setD] = useState(true); return <Modal title="Indexed Color" onOk={() => ok('indexed', { colors: c, dither })}><Slider label="Colors" value={c} min={2} max={256} onChange={setC} /><Check label="Dither" value={dither} onChange={setD} /></Modal>; }

// ---------------- Image ----------------
function AdjustDialog({ type }: { type: AdjType }) {
  const src = usePreviewSource(); const [p, setP] = useState(() => ADJ_DEFAULTS[type]());
  const hist = useMemo(() => src ? histogram(src.data.data).l : undefined, [src]);
  return <Modal title={ADJ_LABELS[type]} wide onOk={() => ok('adj:' + type, p, ADJ_LABELS[type])} extra={<button className="btn" onClick={() => setP(ADJ_DEFAULTS[type]())}>Reset</button>}>
    <div className="two-col"><Preview src={src} fn={(img) => { applyAdjustment(img.data, { type, p }); }} deps={[JSON.stringify(p)]} /><div className="form"><AdjEditor adj={{ type, p }} hist={hist} onChange={setP} /></div></div>
  </Modal>;
}
function FilterDialog({ id, smartId }: { id: string; smartId?: string }) {
  const f = FILTER_MAP[id]; const d = app.doc; const sf = smartId ? d?.active?.smart?.filters.find((x) => x.id === smartId) : null;
  const [p, setP] = useState(() => sf ? { ...sf.params } : { ...filterDefaults(f), ...(app.lastFilter?.id === id ? app.lastFilter.params : {}) });
  const src = usePreviewSource();
  const [fid, setFid] = useState(id);
  const gallery = f.cat !== 'Adjust' && !smartId;
  const apply = () => {
    if (sf && d) { sf.params = p; d.active!.ver++; clearCaches(d.active!.id); d.commit('Edit ' + f.name); close(); app.emit(); return; }
    ok('filter', { id: fid, params: p }, FILTER_MAP[fid].name);
  };
  const cur = FILTER_MAP[fid];
  return <Modal title={cur.name} wide onOk={apply} extra={<button className="btn" onClick={() => setP(filterDefaults(cur))}>Reset</button>}>
    <div className="two-col"><Preview src={src} fn={(img, s) => cur.run(img, p, { fg: app.fg, bg: app.bg, scale: s })} deps={[fid, JSON.stringify(p)]} />
      <div className="form">
        {gallery && <Select label="Filter" value={fid} options={FILTERS.filter((x) => x.cat === f.cat && x.params.length).map((x) => [x.id, x.name] as [string, string])} onChange={(v) => { setFid(v); setP(filterDefaults(FILTER_MAP[v])); }} />}
        <ParamControls params={cur.params} value={p} onChange={setP} />
        {cur.params.length === 0 && <p className="muted">This filter has no settings.</p>}
      </div></div>
  </Modal>;
}
function ReplaceColorDialog() {
  const src = usePreviewSource(); const [a, setA] = useState({ color: app.fg, fuzz: 40, hue: 0, sat: 0, light: 0 });
  return <Modal title="Replace Color" wide onOk={() => ok('replaceColor', a)}>
    <div className="two-col"><Preview src={src} fn={(img) => { replaceColor(img.data, a.color, a.fuzz, a.hue, a.sat, a.light); }} deps={[JSON.stringify(a)]} />
      <div className="form"><div className="row"><span className="lbl">Colour to replace</span><ColorChip value={a.color} onChange={(v) => setA({ ...a, color: v })} size={26} /><button className="btn sm" onClick={() => setA({ ...a, color: app.fg })}>Use foreground</button></div>
        <Slider label="Fuzziness" value={a.fuzz} min={0} max={200} onChange={(v) => setA({ ...a, fuzz: v })} /><Slider label="Hue" value={a.hue} min={-180} max={180} onChange={(v) => setA({ ...a, hue: v })} /><Slider label="Saturation" value={a.sat} min={-100} max={100} onChange={(v) => setA({ ...a, sat: v })} /><Slider label="Lightness" value={a.light} min={-100} max={100} onChange={(v) => setA({ ...a, light: v })} />
        <p className="muted">Tip: pick the colour with the Eyedropper first, then open this dialog.</p></div></div>
  </Modal>;
}
function ImageSizeDialog() {
  const d = requireDoc(); const [w, setW] = useState(d.w), [h, setH] = useState(d.h), [lock, setLock] = useState(true), [res, setRes] = useState(d.s.resolution), [rs, setRs] = useState('bicubic'), [resample, setResample] = useState(true);
  const ar = d.w / d.h;
  return <Modal title="Image Size" onOk={() => { if (w * h > 64e6) { app.toast('Maximum is 64 megapixels.', 'error'); return; } ok('imageSize', { w: resample ? w : d.w, h: resample ? h : d.h, res, resample: rs }); }}>
    <p className="muted">Current: {d.w} × {d.h} px ({(d.w * d.h * 4 / 1048576).toFixed(1)} MB)</p>
    <div className="row"><Num label="Width" value={w} min={1} onChange={(v) => { setW(Math.round(v)); if (lock) setH(Math.max(1, Math.round(v / ar))); }} unit="px" width={80} /><button className={'icon-btn' + (lock ? ' on' : '')} title="Constrain proportions" onClick={() => setLock(!lock)}><I.Link size={14} /></button><Num label="Height" value={h} min={1} onChange={(v) => { setH(Math.round(v)); if (lock) setW(Math.max(1, Math.round(v * ar))); }} unit="px" width={80} /></div>
    <div className="row"><Num label="Width" value={+(w / d.w * 100).toFixed(1)} min={1} onChange={(v) => { setW(Math.round(d.w * v / 100)); if (lock) setH(Math.round(d.h * v / 100)); }} unit="%" /><span className="muted">{(w / res).toFixed(2)} × {(h / res).toFixed(2)} in at</span><Num value={res} min={1} max={2400} onChange={setRes} unit="ppi" /></div>
    <div className="row"><Check label="Resample" value={resample} onChange={setResample} /><Select value={rs} options={[['bicubic', 'Bicubic (smooth)'], ['bilinear', 'Bilinear'], ['nearest', 'Nearest Neighbor (hard edges)'], ['enlarge', 'Preserve Details (enlargement)']]} onChange={setRs} /></div>
  </Modal>;
}
function CASDialog() {
  const d = requireDoc(); const l = d.active; const [w, setW] = useState(75), [h, setH] = useState(100), [ps, setPs] = useState(!!d.s.selection), [skin, setSkin] = useState(false);
  const src = usePreviewSource(); const [busy, setBusy] = useState(false);
  if (!l || l.kind !== 'raster' || !l.canvas) return <Modal title="Content-Aware Scale" onOk={close}><p>Select a pixel layer first. Content-Aware Scale resizes a layer while keeping people and important details from being squashed.</p></Modal>;
  const prot = (cw: number, ch: number, s: number) => { if (!ps || !d.s.selection) return null; const b = Sel.maskBounds(d.s.selection) || { x: 0, y: 0, w: d.w, h: d.h }; const m = makeCanvas(cw, ch); const x = ctx2d(m); x.drawImage(d.s.selection, b.x, b.y, b.w, b.h, 0, 0, cw, ch); void s; const md = getData(m).data, o = new Uint8ClampedArray(cw * ch); for (let i = 0; i < o.length; i++) o[i] = md[i * 4]; return o; };
  return <Modal title="Content-Aware Scale" okLabel={busy ? 'Working…' : 'Scale'} onOk={() => { setBusy(true); setTimeout(() => ok('contentAwareScale', { w: Math.max(1, Math.round(l.canvas!.width * w / 100)), h: Math.max(1, Math.round(l.canvas!.height * h / 100)), protectSel: ps, skin }), 30); }}>
    <div className="two-col"><Preview src={ps && d.s.selection ? null : src} fn={(img) => { const r = DFM.seamCarve(img, img.width * w / 100, img.height * h / 100, prot(img.width, img.height, 1), skin); const o = new ImageData(img.width, img.height); for (let y = 0; y < Math.min(r.height, img.height); y++) for (let x = 0; x < Math.min(r.width, img.width); x++) { const a = (y * r.width + x) * 4, b = (y * img.width + x) * 4; o.data[b] = r.data[a]; o.data[b + 1] = r.data[a + 1]; o.data[b + 2] = r.data[a + 2]; o.data[b + 3] = r.data[a + 3]; } return o; }} deps={[w, h, ps, skin]} />
    <div className="form">
      <p className="muted">Resizes "{l.name}" by removing or adding low-detail seams, so faces and objects keep their shape.</p>
      <Slider label="Width" value={w} min={20} max={200} unit="%" onChange={setW} />
      <Slider label="Height" value={h} min={20} max={200} unit="%" onChange={setH} />
      <p className="muted small">{Math.round(l.canvas.width * w / 100)} × {Math.round(l.canvas.height * h / 100)} px</p>
      <Check label="Protect the current selection" value={ps} onChange={setPs} />
      <Check label="Protect skin tones" value={skin} onChange={setSkin} />
    </div></div>
  </Modal>;
}
function CanvasSizeDialog() {
  const d = requireDoc(); const [rel, setRel] = useState(false), [w, setW] = useState(d.w), [h, setH] = useState(d.h), [anchor, setAnchor] = useState<[number, number]>([0.5, 0.5]), [color, setColor] = useState(app.bg);
  const W = rel ? d.w + w : w, H = rel ? d.h + h : h;
  return <Modal title="Canvas Size" onOk={() => ok('canvasSize', { w: Math.max(1, W), h: Math.max(1, H), anchor, color })}>
    <p className="muted">Current: {d.w} × {d.h} px</p>
    <div className="row"><Num label="Width" value={w} onChange={(v) => setW(Math.round(v))} unit="px" width={80} /><Num label="Height" value={h} onChange={(v) => setH(Math.round(v))} unit="px" width={80} /><Check label="Relative" value={rel} onChange={(v) => { setRel(v); setW(v ? 0 : d.w); setH(v ? 0 : d.h); }} /></div>
    <div className="row"><span className="lbl">Anchor</span><div className="anchor-grid">{[0, 0.5, 1].map((y) => [0, 0.5, 1].map((x) => <button key={x + '-' + y} className={anchor[0] === x && anchor[1] === y ? 'on' : ''} onClick={() => setAnchor([x, y])} />))}</div></div>
    <div className="row"><span className="lbl">Extension colour</span><ColorChip value={color} onChange={setColor} size={24} /><button className="btn sm" onClick={() => setColor('transparent')}>Transparent</button></div>
  </Modal>;
}
function RotateDialog() { const [deg, setDeg] = useState(15); return <Modal title="Rotate Canvas" onOk={() => ok('rotateCanvas', { deg })}><Slider label="Angle" value={deg} min={-180} max={180} step={0.1} unit="°" onChange={setDeg} /><p className="muted">Positive values rotate clockwise. The canvas grows to fit.</p></Modal>; }
function TrimDialog() { const [b, setB] = useState<'transparent' | 'topleft' | 'bottomright'>('transparent'); return <Modal title="Trim" onOk={() => ok('trim', { based: b })}><Seg value={b} onChange={setB} options={[['transparent', 'Transparent pixels'], ['topleft', 'Top-left colour'], ['bottomright', 'Bottom-right colour']]} /></Modal>; }

// ---------------- Select ----------------
function MaskPreview({ mask, deps }: { mask: () => Canvas | null; deps: any[] }) {
  const ref = useRef<HTMLCanvasElement>(null); const [view, setView] = useState<'overlay' | 'bw' | 'onblack'>('overlay');
  useEffect(() => {
    const t = setTimeout(() => {
      const d = app.doc, c = ref.current; if (!d || !c) return; const s = Math.min(1, 360 / Math.max(d.w, d.h)); if (c.width !== Math.floor(d.w * s) || c.height !== Math.floor(d.h * s)) { c.width = d.w * s; c.height = d.h * s; }
      const x = c.getContext('2d')!; const m = mask(); x.clearRect(0, 0, c.width, c.height);
      if (view === 'bw') { if (m) x.drawImage(m, 0, 0, c.width, c.height); return; }
      if (view === 'onblack') { x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height); }
      const comp = getComposite(d);
      if (view === 'onblack' && m) { const t2 = makeCanvas(c.width, c.height), y = ctx2d(t2); y.drawImage(comp, 0, 0, c.width, c.height); y.globalCompositeOperation = 'destination-in'; y.drawImage(Sel.maskToAlpha(m), 0, 0, c.width, c.height); x.drawImage(t2, 0, 0); return; }
      x.drawImage(comp, 0, 0, c.width, c.height);
      if (m) { const t2 = makeCanvas(c.width, c.height), y = ctx2d(t2); y.fillStyle = 'rgba(255,40,60,0.55)'; y.fillRect(0, 0, c.width, c.height); y.globalCompositeOperation = 'destination-out'; y.drawImage(Sel.maskToAlpha(m), 0, 0, c.width, c.height); x.drawImage(t2, 0, 0); }
    }, 80);
    return () => clearTimeout(t);
  }, [...deps, view]);
  return <div className="preview-box"><canvas ref={ref} className="preview" /><Seg value={view} onChange={setView} options={[['overlay', 'Overlay'], ['onblack', 'On black'], ['bw', 'Black & white']]} /></div>;
}
function ColorRangeDialog() {
  const d = requireDoc(); const img = useMemo(() => { const s = Math.min(1, 360 / Math.max(d.w, d.h)), c = makeCanvas(d.w * s, d.h * s); ctx2d(c).drawImage(flatten(d), 0, 0, c.width, c.height); return getData(c); }, []);
  const [mode, setMode] = useState('sampled'), [fuzz, setFuzz] = useState(40), [invert, setInvert] = useState(false), [colors, setColors] = useState<string[]>([app.fg]);
  const rgb = colors.map((c) => { const o = hexToRgb(c); return [o.r, o.g, o.b] as [number, number, number]; });
  return <Modal title="Color Range" wide onOk={() => ok('colorRange', { mode, colors: rgb, fuzz, invert })}>
    <div className="two-col"><MaskPreview mask={() => Sel.writeChannel(Sel.colorRange(img, mode, rgb, fuzz, invert), img.width, img.height)} deps={[mode, fuzz, invert, colors.join()]} />
      <div className="form">
        <Select label="Select" value={mode} options={[['sampled', 'Sampled Colors'], ['reds', 'Reds'], ['yellows', 'Yellows'], ['greens', 'Greens'], ['cyans', 'Cyans'], ['blues', 'Blues'], ['magentas', 'Magentas'], ['highlights', 'Highlights'], ['midtones', 'Midtones'], ['shadows', 'Shadows'], ['skin', 'Skin Tones']]} onChange={setMode} />
        {mode === 'sampled' && <div className="row">{colors.map((c, i) => <ColorChip key={i} value={c} onChange={(v) => setColors(colors.map((x, j) => j === i ? v : x))} />)}<button className="btn sm" onClick={() => setColors([...colors, app.fg])}>+ Add foreground</button>{colors.length > 1 && <button className="btn sm" onClick={() => setColors(colors.slice(0, -1))}>−</button>}</div>}
        <Slider label="Fuzziness" value={fuzz} min={0} max={200} onChange={setFuzz} /><Check label="Invert" value={invert} onChange={setInvert} />
      </div></div>
  </Modal>;
}
function SelectMaskDialog({ toMask }: { toMask?: boolean }) {
  const d = requireDoc(); const base = d.s.selection;
  const small = useMemo(() => { if (!base) return null; const s = Math.min(1, 360 / Math.max(d.w, d.h)), c = makeCanvas(d.w * s, d.h * s), x = ctx2d(c); x.drawImage(base, 0, 0, c.width, c.height); return { c, s }; }, []);
  const [a, setA] = useState({ smooth: 0, feather: 0, contrast: 0, shift: 0, output: (toMask ? 'mask' : 'selection') as 'selection' | 'mask' | 'layer' });
  if (!base || !small) return <Modal title="Select and Mask"><p>Make a selection first. Select Subject or the Quick Selection tool are good starting points.</p></Modal>;
  const mk = () => { let m: Canvas = small.c; const s = small.s; if (a.smooth) m = Sel.smoothMask(m, a.smooth * s); if (a.shift > 0) m = Sel.expandMask(m, a.shift / 10 * s); else if (a.shift < 0) m = Sel.contractMask(m, -a.shift / 10 * s); if (a.feather) m = Sel.featherMask(m, a.feather * s); if (a.contrast) { const ch = Sel.readChannel(m), k = 1 + a.contrast / 25; for (let i = 0; i < ch.length; i++) ch[i] = (ch[i] - 128) * k + 128; m = Sel.writeChannel(ch, m.width, m.height); } return m; };
  return <Modal title="Select and Mask" wide onOk={() => { if (toMask && d.active?.mask) delete d.active.mask; ok('selectAndMask', a); }}>
    <div className="two-col"><MaskPreview mask={mk} deps={[JSON.stringify(a)]} />
      <div className="form"><h4>Global refinements</h4>
        <Slider label="Smooth" value={a.smooth} min={0} max={100} onChange={(v) => setA({ ...a, smooth: v })} /><Slider label="Feather" value={a.feather} min={0} max={250} step={0.5} unit="px" onChange={(v) => setA({ ...a, feather: v })} />
        <Slider label="Contrast" value={a.contrast} min={0} max={100} unit="%" onChange={(v) => setA({ ...a, contrast: v })} /><Slider label="Shift Edge" value={a.shift} min={-100} max={100} unit="%" onChange={(v) => setA({ ...a, shift: v })} />
        <h4>Output</h4><Select value={a.output} options={[['selection', 'Selection'], ['mask', 'Layer Mask'], ['layer', 'New Layer']]} onChange={(v) => setA({ ...a, output: v })} />
      </div></div>
  </Modal>;
}
function ModifyDialog({ op }: { op: 'expand' | 'contract' | 'feather' | 'border' | 'smooth' }) {
  const [px, setPx] = useState(op === 'feather' ? 8 : 4); const t = { expand: 'Expand Selection', contract: 'Contract Selection', feather: 'Feather Selection', border: 'Border Selection', smooth: 'Smooth Selection' }[op];
  return <Modal title={t} onOk={() => ok('modify', { op, px }, t)}><Num label={op === 'feather' ? 'Feather radius' : op === 'border' ? 'Width' : op === 'smooth' ? 'Sample radius' : op === 'expand' ? 'Expand by' : 'Contract by'} value={px} min={0.1} max={500} step={op === 'feather' ? 0.1 : 1} onChange={setPx} unit="px" /></Modal>;
}
function LoadSelectionDialog() {
  const d = requireDoc(); if (!d.s.channels.length) return <Modal title="Load Selection"><p>No saved selections yet. Use Select › Save Selection first.</p></Modal>;
  const [id, setId] = useState(d.s.channels[d.s.channels.length - 1].id), [op, setOp] = useState<Sel.SelOp>('new'), [inv, setInv] = useState(false);
  return <Modal title="Load Selection" onOk={() => ok('loadSelection', { id, op, invert: inv })}><Select label="Channel" value={id} options={d.s.channels.map((c) => [c.id, c.name] as [string, string])} onChange={setId} /><Check label="Invert" value={inv} onChange={setInv} /><Seg value={op} onChange={setOp} options={[['new', 'New'], ['add', 'Add'], ['subtract', 'Subtract'], ['intersect', 'Intersect']]} /></Modal>;
}
function NewGuideDialog() { const [axis, setAxis] = useState<'h' | 'v'>('v'), [pos, setPos] = useState(100); return <Modal title="New Guide" onOk={() => ok('newGuide', { axis, pos })}><Seg value={axis} onChange={setAxis} options={[['h', 'Horizontal'], ['v', 'Vertical']]} /><Num label="Position" value={pos} onChange={setPos} unit="px" /></Modal>; }
function GuideLayoutDialog() { const [a, setA] = useState({ cols: 3, rows: 3, margin: 0, gutter: 0 }); return <Modal title="New Guide Layout" onOk={() => ok('guideLayout', a)}><Num label="Columns" value={a.cols} min={1} max={50} onChange={(v) => setA({ ...a, cols: v })} /><Num label="Rows" value={a.rows} min={1} max={50} onChange={(v) => setA({ ...a, rows: v })} /><Num label="Margin" value={a.margin} min={0} onChange={(v) => setA({ ...a, margin: v })} unit="px" /><Num label="Gutter" value={a.gutter} min={0} onChange={(v) => setA({ ...a, gutter: v })} unit="px" /></Modal>; }

function AboutDialog({ tab }: { tab?: string }) {
  const [t, setT] = useState(tab || 'about');
  return <Modal title="ANCHOR Monsoon" wide>
    <Seg value={t} onChange={setT} options={[['about', 'About'], ['features', 'What it can do']]} />
    {t === 'about' ? <div className="about"><img src="./icon.svg" width={72} height={72} alt="" /><div><h3>ANCHOR Monsoon</h3><p>A layered image editor that runs in your browser and installs as an app. Everything runs on your device: nothing you open is uploaded.</p><p className="muted">Part of the ANCHOR suite with Tsunami and Abyss.</p></div></div>
      : <div className="features">{[
        ['Layers', 'Pixel, type, shape, fill, adjustment, group and smart object layers. 27 blend modes, masks, clipping masks, layer styles, comps and linking.'],
        ['Selections', 'Marquee, lasso, polygonal and magnetic lasso, magic wand, quick selection, object selection, Select Subject and Sky, Color Range, Select and Mask, Quick Mask, saved channels.'],
        ['Painting', 'Brush, pencil, mixer brush, colour replacement, clone and pattern stamps, history brushes, erasers, gradients and fills, with a full brush engine and pressure.'],
        ['Retouching', 'Spot healing, remove tool, healing brush, patch, content-aware move and fill, red eye, blur, sharpen, smudge, dodge, burn and sponge.'],
        ['Adjustments', '16 adjustment types as layers or direct edits, Camera Raw style develop, Shadows/Highlights, HDR toning, auto tone and colour.'],
        ['Filters', 'About 65 filters in blur, sharpen, noise, distort, stylize, pixelate and render families, Liquify and lens correction, as smart filters on smart objects.'],
        ['Transform', 'Free transform, skew, distort, perspective, warp with presets, content-aware scale free crop and perspective crop.'],
        ['Type and vectors', 'Point and paragraph type, warped text, pen, freeform and curvature pens, shapes with live fill and stroke, custom shapes, paths panel.'],
        ['Files', 'Opens and saves PSD, opens TIFF, HEIC, PNG, JPEG, WebP, AVIF, GIF, BMP and SVG. Exports PDF and every image format. Native .monsoon keeps everything.'],
        ['Automation', 'Recordable actions, batch processing, auto-recovery after a crash.'],
      ].map(([h, p]) => <div key={h}><h4>{h}</h4><p>{p}</p></div>)}</div>}
  </Modal>;
}

export function Dialogs() {
  const dlg = app.dialog; if (!dlg) return null; const p = dlg.props || {};
  switch (dlg.kind) {
    case 'new': return <NewDialog />;
    case 'recent': return <RecentDialog />;
    case 'saveAs': return <SaveAsDialog />;
    case 'export': return <ExportDialog web={p.web} />;
    case 'exportLayers': return <ExportLayersDialog />;
    case 'batch': return <BatchDialog />;
    case 'fileInfo': return <FileInfoDialog />;
    case 'fade': return <FadeDialog />;
    case 'fill': return <FillDialog />;
    case 'stroke': return <StrokeDialog />;
    case 'shortcuts': return <ShortcutsDialog />;
    case 'prefs': return <PrefsDialog />;
    case 'indexed': return <IndexedDialog />;
    case 'adjust': return <AdjustDialog type={p.type} />;
    case 'filter': return <FilterDialog id={p.id} smartId={p.smartId} />;
    case 'replaceColor': return <ReplaceColorDialog />;
    case 'imageSize': return <ImageSizeDialog />;
    case 'cas': return <CASDialog />;
    case 'canvasSize': return <CanvasSizeDialog />;
    case 'rotate': return <RotateDialog />;
    case 'trim': return <TrimDialog />;
    case 'layerStyle': return <LayerStyleDialog />;
    case 'warpText': return <WarpTextDialog />;
    case 'colorRange': return <ColorRangeDialog />;
    case 'selectMask': return <SelectMaskDialog toMask={p.toMask} />;
    case 'modify': return <ModifyDialog op={p.op} />;
    case 'loadSelection': return <LoadSelectionDialog />;
    case 'cameraRaw': return <CameraRawDialog />;
    case 'lens': return <LensDialog />;
    case 'liquify': return <LiquifyDialog />;
    case 'newGuide': return <NewGuideDialog />;
    case 'guideLayout': return <GuideLayoutDialog />;
    case 'about': return <AboutDialog tab={p.tab} />;
    case 'color': return <ColorPickerDialog value={p.value} onPick={p.onPick} />;
    case 'gradient': return <GradientDialog value={p.value} onPick={p.onPick} />;
    default: return <Modal title="Not available"><p>This dialog ({dlg.kind}) is not part of this version.</p></Modal>;
  }
}
export { usePreviewSource, Preview, applyToPixels, paintTarget };
