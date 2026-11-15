// Editors for adjustment parameters (used by adjustment layers and Image > Adjustments).
import { useEffect, useRef, useState } from 'react';
import type { Adjustment } from '../engine/types';
import { Slider, Select, Check, ColorChip, Seg } from './controls';
import { curveLut, LOOKS } from '../engine/adjust';
import { GRADIENT_PRESETS, gradientCss } from '../engine/paint';
import { app } from '../app';

export function AdjEditor({ adj, onChange, hist }: { adj: Adjustment; onChange: (p: any) => void; hist?: Uint32Array }) {
  const p = adj.p; const set = (q: any) => onChange({ ...p, ...q });
  switch (adj.type) {
    case 'brightness': return (<><Slider label="Brightness" value={p.brightness} min={-150} max={150} onChange={(v) => set({ brightness: v })} /><Slider label="Contrast" value={p.contrast} min={-50} max={100} onChange={(v) => set({ contrast: v })} /><Check label="Use Legacy" value={p.legacy} onChange={(v) => set({ legacy: v })} /></>);
    case 'levels': return <LevelsEditor p={p} onChange={onChange} hist={hist} />;
    case 'curves': return <CurvesEditor p={p} onChange={onChange} hist={hist} />;
    case 'exposure': return (<><Slider label="Exposure" value={p.exposure} min={-5} max={5} step={0.01} onChange={(v) => set({ exposure: v })} /><Slider label="Offset" value={p.offset} min={-0.5} max={0.5} step={0.001} onChange={(v) => set({ offset: v })} /><Slider label="Gamma" value={p.gamma} min={0.1} max={9.99} step={0.01} onChange={(v) => set({ gamma: v })} /></>);
    case 'vibrance': return (<><Slider label="Vibrance" value={p.vibrance} min={-100} max={100} onChange={(v) => set({ vibrance: v })} /><Slider label="Saturation" value={p.saturation} min={-100} max={100} onChange={(v) => set({ saturation: v })} /></>);
    case 'hsl': return <HslEditor p={p} set={set} />;
    case 'colorBalance': return <ColorBalanceEditor p={p} set={set} />;
    case 'bw': return (<>{(['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'] as const).map((k) => <Slider key={k} label={k[0].toUpperCase() + k.slice(1)} value={p[k]} min={-200} max={300} onChange={(v) => set({ [k]: v })} unit="%" />)}<Check label="Tint" value={p.tint} onChange={(v) => set({ tint: v })} />{p.tint && <ColorChip value={p.tintColor} onChange={(v) => set({ tintColor: v })} />}<button className="btn sm" onClick={() => set({ reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 })}>Default</button></>);
    case 'photoFilter': return (<><Select label="Filter" value={p.color} options={[['#ec8a00', 'Warming (85)'], ['#fa9600', 'Warming (LBA)'], ['#006dff', 'Cooling (80)'], ['#00b5ff', 'Cooling (LBB)'], ['#ea1a1a', 'Red'], ['#00ec8d', 'Green'], ['#b232ff', 'Violet'], ['#ff9500', 'Sepia'], ['#00c1b1', 'Underwater'], [p.color, 'Custom']]} onChange={(v) => set({ color: v })} /><ColorChip value={p.color} onChange={(v) => set({ color: v })} /><Slider label="Density" value={p.density} min={1} max={100} onChange={(v) => set({ density: v })} unit="%" /><Check label="Preserve Luminosity" value={p.preserve} onChange={(v) => set({ preserve: v })} /></>);
    case 'channelMixer': return <MixerEditor p={p} set={set} />;
    case 'lookup': return <Select label="Look" value={p.look} options={Object.keys(LOOKS).map((k) => [k, k] as [string, string])} onChange={(v) => set({ look: v })} />;
    case 'invert': return <p className="muted">Invert has no settings.</p>;
    case 'posterize': return <Slider label="Levels" value={p.levels} min={2} max={255} onChange={(v) => set({ levels: v })} />;
    case 'threshold': return (<>{hist && <HistMini hist={hist} marks={[p.level]} />}<Slider label="Threshold Level" value={p.level} min={1} max={255} onChange={(v) => set({ level: v })} /></>);
    case 'gradientMap': return (<><div className="grad-big" style={{ background: gradientCss(p.gradient) }} onClick={() => app.openDialog('gradient', { value: p.gradient, onPick: (g: any) => set({ gradient: g }) })} title="Click to edit" /><Select label="Preset" value="" options={[['', 'Choose…'], ...GRADIENT_PRESETS.map((g) => [g.name!, g.name!] as [string, string])]} onChange={(n) => { const g = GRADIENT_PRESETS.find((x) => x.name === n); if (g) set({ gradient: g.name === 'Foreground to Background' ? { ...g, stops: [{ pos: 0, color: app.fg }, { pos: 1, color: app.bg }] } : g }); }} /><Check label="Reverse" value={p.reverse} onChange={(v) => set({ reverse: v })} /></>);
    case 'selectiveColor': return <SelectiveEditor p={p} onChange={onChange} />;
  }
  return null;
}
function HistMini({ hist, marks = [] }: { hist: Uint32Array; marks?: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { const c = ref.current; if (!c) return; const x = c.getContext('2d')!; x.clearRect(0, 0, 256, 60); let mx = 1; for (let i = 0; i < 256; i++) mx = Math.max(mx, hist[i]); x.fillStyle = '#8a90a8'; for (let i = 0; i < 256; i++) { const h = Math.sqrt(hist[i] / mx) * 58; x.fillRect(i, 60 - h, 1, h); } x.fillStyle = '#6c7cff'; for (const m of marks) x.fillRect(m, 0, 1, 60); }, [hist, marks.join()]);
  return <canvas ref={ref} width={256} height={60} className="hist-mini" />;
}
function LevelsEditor({ p, onChange, hist }: { p: any; onChange: (p: any) => void; hist?: Uint32Array }) {
  const [ch, setCh] = useState<'rgb' | 'r' | 'g' | 'b'>('rgb');
  const v = p.ch[ch] as number[]; const setV = (i: number, n: number) => { const nv = [...v]; nv[i] = n; onChange({ ch: { ...p.ch, [ch]: nv } }); };
  return (<>
    <Seg value={ch} onChange={setCh} options={[['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']]} />
    {hist && <HistMini hist={hist} marks={[v[0], v[0] + (v[2] - v[0]) * Math.pow(0.5, v[1]), v[2]]} />}
    <Slider label="Black" value={v[0]} min={0} max={253} onChange={(n) => setV(0, Math.min(n, v[2] - 2))} />
    <Slider label="Gamma" value={v[1]} min={0.1} max={9.99} step={0.01} onChange={(n) => setV(1, n)} />
    <Slider label="White" value={v[2]} min={2} max={255} onChange={(n) => setV(2, Math.max(n, v[0] + 2))} />
    <Slider label="Output black" value={v[3]} min={0} max={255} onChange={(n) => setV(3, n)} />
    <Slider label="Output white" value={v[4]} min={0} max={255} onChange={(n) => setV(4, n)} />
    <button className="btn sm" onClick={() => { if (!hist) return; let tot = 0; for (const x of hist) tot += x; let a = 0, lo = 0; while (lo < 255 && a + hist[lo] < tot * 0.001) a += hist[lo++]; a = 0; let hi = 255; while (hi > 0 && a + hist[hi] < tot * 0.001) a += hist[hi--]; onChange({ ch: { ...p.ch, rgb: [lo, 1, Math.max(lo + 2, hi), 0, 255] } }); }}>Auto</button>
  </>);
}
function CurvesEditor({ p, onChange, hist }: { p: any; onChange: (p: any) => void; hist?: Uint32Array }) {
  const [ch, setCh] = useState<'rgb' | 'r' | 'g' | 'b'>('rgb');
  const ref = useRef<HTMLCanvasElement>(null); const drag = useRef<number>(-1);
  const pts: [number, number][] = p[ch];
  useEffect(() => {
    const c = ref.current; if (!c) return; const x = c.getContext('2d')!, S = c.width / 256;
    x.fillStyle = '#16171d'; x.fillRect(0, 0, c.width, c.height);
    if (hist) { let mx = 1; for (let i = 0; i < 256; i++) mx = Math.max(mx, hist[i]); x.fillStyle = '#2c2f3c'; for (let i = 0; i < 256; i++) { const h = Math.sqrt(hist[i] / mx) * c.height; x.fillRect(i * S, c.height - h, S, h); } }
    x.strokeStyle = '#33364a'; x.lineWidth = 1; for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo((i * c.width) / 4, 0); x.lineTo((i * c.width) / 4, c.height); x.moveTo(0, (i * c.height) / 4); x.lineTo(c.width, (i * c.height) / 4); x.stroke(); }
    x.beginPath(); x.moveTo(0, c.height); x.lineTo(c.width, 0); x.strokeStyle = '#444'; x.stroke();
    const lut = curveLut(pts); x.beginPath(); for (let i = 0; i < 256; i++) { const X = i * S, Y = c.height - lut[i] * S; i ? x.lineTo(X, Y) : x.moveTo(X, Y); }
    x.strokeStyle = { rgb: '#e8e8f0', r: '#ff6b6b', g: '#5be07a', b: '#6ba8ff' }[ch]; x.lineWidth = 2; x.stroke();
    for (const [px, py] of pts) { x.fillStyle = '#fff'; x.fillRect(px * S - 4, c.height - py * S - 4, 8, 8); }
  });
  const toV = (e: { clientX: number; clientY: number }) => { const r = ref.current!.getBoundingClientRect(); return [Math.max(0, Math.min(255, ((e.clientX - r.left) / r.width) * 255)), Math.max(0, Math.min(255, (1 - (e.clientY - r.top) / r.height) * 255))] as [number, number]; };
  const update = (np: [number, number][]) => onChange({ ...p, [ch]: np });
  return (<>
    <Seg value={ch} onChange={setCh} options={[['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']]} />
    <canvas ref={ref} width={256} height={256} className="curves" onPointerDown={(e) => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId); const [vx, vy] = toV(e);
      let i = pts.findIndex(([x, y]) => Math.hypot(x - vx, y - vy) < 10);
      if (i < 0) { const np = [...pts, [vx, vy] as [number, number]].sort((a, b) => a[0] - b[0]); i = np.findIndex((q) => q[0] === vx && q[1] === vy); update(np); }
      drag.current = i;
    }} onPointerMove={(e) => { if (drag.current < 0) return; const [vx, vy] = toV(e); const np = pts.map((q, k) => (k === drag.current ? [Math.round(vx), Math.round(vy)] : q)) as [number, number][]; update(np); }}
      onPointerUp={(e) => { const i = drag.current; drag.current = -1; const [vx, vy] = toV(e); if (i > 0 && i < pts.length - 1 && (vy < -0 || vx < 0 || vx > 255 || vy > 255)) update(pts.filter((_, k) => k !== i)); }}
      onDoubleClick={(e) => { const [vx, vy] = toV(e); const i = pts.findIndex(([x, y]) => Math.hypot(x - vx, y - vy) < 10); if (i > 0 && i < pts.length - 1) update(pts.filter((_, k) => k !== i)); }} />
    <div className="row"><Select label="Preset" value="" options={[['', 'Custom'], ['contrast', 'Medium Contrast'], ['strong', 'Strong Contrast'], ['lighter', 'Lighter'], ['darker', 'Darker'], ['negative', 'Negative'], ['linear', 'Linear']]} onChange={(k) => { const P: Record<string, [number, number][]> = { contrast: [[0, 0], [64, 54], [192, 202], [255, 255]], strong: [[0, 0], [64, 44], [192, 212], [255, 255]], lighter: [[0, 0], [128, 158], [255, 255]], darker: [[0, 0], [128, 98], [255, 255]], negative: [[0, 255], [255, 0]], linear: [[0, 0], [255, 255]] }; if (P[k]) update(P[k]); }} /><span className="muted">Double-click a point to remove it.</span></div>
  </>);
}
function HslEditor({ p, set }: { p: any; set: (q: any) => void }) {
  const [r, setR] = useState(-1); const names = ['Reds', 'Yellows', 'Greens', 'Cyans', 'Blues', 'Magentas'];
  const v = r < 0 ? p.master : p.ranges[r];
  const setV = (i: number, n: number) => { const nv = [...v]; nv[i] = n; if (r < 0) set({ master: nv }); else { const rr = p.ranges.map((x: number[]) => [...x]); rr[r] = nv; set({ ranges: rr }); } };
  return (<>
    <Check label="Colorize" value={p.colorize} onChange={(c) => set({ colorize: c })} />
    {p.colorize ? (<><Slider label="Hue" value={p.cHue} min={0} max={360} onChange={(n) => set({ cHue: n })} /><Slider label="Saturation" value={p.cSat} min={0} max={100} onChange={(n) => set({ cSat: n })} /><Slider label="Lightness" value={p.cLight} min={-100} max={100} onChange={(n) => set({ cLight: n })} /></>) : (<>
      <Select value={r} options={[[-1, 'Master'], ...names.map((n, i) => [i, n] as [number, string])]} onChange={setR} />
      <Slider label="Hue" value={v[0]} min={-180} max={180} onChange={(n) => setV(0, n)} /><Slider label="Saturation" value={v[1]} min={-100} max={100} onChange={(n) => setV(1, n)} /><Slider label="Lightness" value={v[2]} min={-100} max={100} onChange={(n) => setV(2, n)} />
      <div className="hue-bar" />
    </>)}
  </>);
}
function ColorBalanceEditor({ p, set }: { p: any; set: (q: any) => void }) {
  const [tone, setTone] = useState<'shadows' | 'midtones' | 'highlights'>('midtones'); const v = p[tone];
  const setV = (i: number, n: number) => { const nv = [...v]; nv[i] = n; set({ [tone]: nv }); };
  return (<><Seg value={tone} onChange={setTone} options={[['shadows', 'Shadows'], ['midtones', 'Midtones'], ['highlights', 'Highlights']]} />
    <Slider label="Cyan · Red" value={v[0]} min={-100} max={100} onChange={(n) => setV(0, n)} /><Slider label="Magenta · Green" value={v[1]} min={-100} max={100} onChange={(n) => setV(1, n)} /><Slider label="Yellow · Blue" value={v[2]} min={-100} max={100} onChange={(n) => setV(2, n)} />
    <Check label="Preserve Luminosity" value={p.preserve} onChange={(c) => set({ preserve: c })} /></>);
}
function MixerEditor({ p, set }: { p: any; set: (q: any) => void }) {
  const [out, setOut] = useState<'r' | 'g' | 'b'>('r'); const ch = p.mono ? 'r' : out; const v = p[ch];
  const setV = (i: number, n: number) => { const nv = [...v]; nv[i] = n; set({ [ch]: nv }); };
  return (<><Check label="Monochrome" value={p.mono} onChange={(c) => set({ mono: c, ...(c ? { r: [40, 40, 20, 0] } : {}) })} />{!p.mono && <Seg value={out} onChange={setOut} options={[['r', 'Red'], ['g', 'Green'], ['b', 'Blue']]} />}
    <Slider label="Red" value={v[0]} min={-200} max={200} onChange={(n) => setV(0, n)} unit="%" /><Slider label="Green" value={v[1]} min={-200} max={200} onChange={(n) => setV(1, n)} unit="%" /><Slider label="Blue" value={v[2]} min={-200} max={200} onChange={(n) => setV(2, n)} unit="%" /><Slider label="Constant" value={v[3]} min={-200} max={200} onChange={(n) => setV(3, n)} unit="%" />
    <span className="muted">Total: {v[0] + v[1] + v[2]}%</span></>);
}
function SelectiveEditor({ p, onChange }: { p: any; onChange: (p: any) => void }) {
  const [c, setC] = useState('reds'); const v = p.colors[c];
  const setV = (i: number, n: number) => { const nv = [...v]; nv[i] = n; onChange({ ...p, colors: { ...p.colors, [c]: nv } }); };
  return (<><Select label="Colors" value={c} options={Object.keys(p.colors).map((k) => [k, k[0].toUpperCase() + k.slice(1)] as [string, string])} onChange={setC} />
    {['Cyan', 'Magenta', 'Yellow', 'Black'].map((n, i) => <Slider key={n} label={n} value={v[i]} min={-100} max={100} onChange={(x) => setV(i, x)} unit="%" />)}
    <Seg value={p.absolute ? 'abs' : 'rel'} onChange={(m) => onChange({ ...p, absolute: m === 'abs' })} options={[['rel', 'Relative'], ['abs', 'Absolute']]} /></>);
}
