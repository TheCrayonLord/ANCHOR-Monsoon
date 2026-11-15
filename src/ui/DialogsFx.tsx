// Larger dialogs: layer styles, Liquify, Camera Raw style develop, lens correction, colour picker, gradient editor, warp text.
import { useEffect, useMemo, useRef, useState } from 'react';
import { app, requireDoc, applyToPixels, paintTarget } from '../app';
import type { LayerStyles, Gradient, BlendMode } from '../engine/types';
import { run } from '../cmds';
import { defaultStyles, STYLE_NAMES } from '../engine/styles';
import { clearCaches } from '../engine/render';
import { ctx2d, makeCanvas, getData, hexToRgb, rgbToHex, rgbToHsv, hsvToRgb, clamp, lum, Canvas } from '../engine/util';
import { gaussianBlur, unsharpMask, addNoise, vignetteFilter } from '../engine/filters';
import { GRADIENT_PRESETS, gradientCss, patternNames } from '../engine/paint';
import { Slider, Select, Check, ColorChip, Num, Seg } from './controls';
import { blendOpts } from './OptionsBar';
import { Modal } from './Dialogs';
import * as I from 'lucide-react';

const close = () => app.closeDialog();

// ---------------- Layer Style ----------------
const ORDER: (keyof LayerStyles)[] = ['bevel', 'stroke', 'innerShadow', 'innerGlow', 'satin', 'colorOverlay', 'gradientOverlay', 'patternOverlay', 'outerGlow', 'dropShadow'];
export function LayerStyleDialog() {
  const d = requireDoc(); const l = d.active;
  const orig = useRef({ styles: l?.styles ? JSON.parse(JSON.stringify(l.styles)) : undefined, opacity: l?.opacity ?? 1, fill: l?.fillOpacity ?? 1, blend: l?.blend ?? 'normal' });
  const [st, setSt] = useState<Required<LayerStyles>>(() => { const def = defaultStyles(); return { ...def, ...(l?.styles ? JSON.parse(JSON.stringify(l.styles)) : {}) }; });
  const [sec, setSec] = useState<keyof LayerStyles | 'blend'>(() => (ORDER.find((k) => (l?.styles as any)?.[k]?.enabled) || 'dropShadow'));
  const [, bump] = useState(0);
  useEffect(() => { if (!l) return; l.styles = st; l.stylesOn = true; l.ver++; clearCaches(l.id); d.touch(); app.emit(); }, [st]);
  if (!l) return <Modal title="Layer Style"><p>Select a layer first.</p></Modal>;
  if (l.kind === 'adjustment') return <Modal title="Layer Style"><p>Adjustment layers cannot have layer styles.</p></Modal>;
  const cancel = () => { l.styles = orig.current.styles; l.opacity = orig.current.opacity; l.fillOpacity = orig.current.fill; l.blend = orig.current.blend; l.ver++; clearCaches(l.id); d.touch(); close(); };
  const okay = () => { const clean: LayerStyles = {}; for (const k of ORDER) if ((st as any)[k].enabled) (clean as any)[k] = (st as any)[k]; close(); run('setStyles', { styles: clean, label: 'Layer Style' }); };
  const set = <K extends keyof LayerStyles>(k: K, p: Partial<NonNullable<LayerStyles[K]>>) => setSt({ ...st, [k]: { ...(st as any)[k], ...p, enabled: (p as any).enabled ?? true } });
  const blendL = (k: keyof LayerStyles) => <Select label="Blend Mode" value={(st as any)[k].blend} options={blendOpts(false)} onChange={(v) => set(k, { blend: v } as any)} />;
  const opac = (k: keyof LayerStyles, key = 'opacity') => <Slider label="Opacity" value={Math.round((st as any)[k][key] * 100)} min={0} max={100} unit="%" onChange={(v) => set(k, { [key]: v / 100 } as any)} />;
  const colr = (k: keyof LayerStyles, key = 'color', label = 'Color') => <div className="row"><span className="lbl">{label}</span><ColorChip value={(st as any)[k][key]} onChange={(v) => set(k, { [key]: v } as any)} size={24} /></div>;
  const rng = (k: keyof LayerStyles, key: string, label: string, min: number, max: number, unit = 'px', step = 1) => <Slider label={label} value={(st as any)[k][key]} min={min} max={max} step={step} unit={unit} onChange={(v) => set(k, { [key]: v } as any)} />;
  const body = () => {
    switch (sec) {
      case 'blend': return <><h4>Blending Options</h4><Select label="Blend Mode" value={l.blend} options={blendOpts(l.kind === 'group')} onChange={(v) => { l.blend = v; l.ver++; d.touch(); bump((n) => n + 1); app.emit(); }} />
        <Slider label="Opacity" value={Math.round(l.opacity * 100)} min={0} max={100} unit="%" onChange={(v) => { l.opacity = v / 100; d.touch(); bump((n) => n + 1); app.emit(); }} />
        <Slider label="Fill Opacity" value={Math.round(l.fillOpacity * 100)} min={0} max={100} unit="%" onChange={(v) => { l.fillOpacity = v / 100; l.ver++; clearCaches(l.id); d.touch(); bump((n) => n + 1); app.emit(); }} />
        <p className="muted">Fill opacity fades the layer's pixels but keeps its effects at full strength.</p></>;
      case 'dropShadow': case 'innerShadow': return <><h4>{STYLE_NAMES[sec]}</h4>{blendL(sec)}{colr(sec)}{opac(sec)}{rng(sec, 'angle', 'Angle', -180, 180, '°')}{rng(sec, 'distance', 'Distance', 0, 300)}{rng(sec, 'spread', sec === 'innerShadow' ? 'Choke' : 'Spread', 0, 100, '%')}{rng(sec, 'size', 'Size', 0, 250)}</>;
      case 'outerGlow': case 'innerGlow': return <><h4>{STYLE_NAMES[sec]}</h4>{blendL(sec)}{colr(sec)}{opac(sec)}{rng(sec, 'spread', sec === 'innerGlow' ? 'Choke' : 'Spread', 0, 100, '%')}{rng(sec, 'size', 'Size', 0, 250)}</>;
      case 'stroke': return <><h4>Stroke</h4>{rng('stroke', 'size', 'Size', 1, 250)}<Select label="Position" value={st.stroke.position} options={[['outside', 'Outside'], ['inside', 'Inside'], ['center', 'Center']]} onChange={(v) => set('stroke', { position: v })} />{blendL('stroke')}{opac('stroke')}{colr('stroke')}</>;
      case 'colorOverlay': return <><h4>Color Overlay</h4>{blendL('colorOverlay')}{colr('colorOverlay')}{opac('colorOverlay')}</>;
      case 'gradientOverlay': return <><h4>Gradient Overlay</h4>{blendL('gradientOverlay')}{opac('gradientOverlay')}
        <div className="grad-big" style={{ background: gradientCss(st.gradientOverlay.gradient) }} onClick={() => app.openDialog('gradient', { value: st.gradientOverlay.gradient, onPick: (g: Gradient) => { app.openDialog('layerStyle'); setTimeout(() => set('gradientOverlay', { gradient: g }), 0); } })} />
        <div className="grad-row">{GRADIENT_PRESETS.slice(0, 12).map((g) => <button key={g.name} className="gsw" style={{ background: gradientCss(g) }} title={g.name} onClick={() => set('gradientOverlay', { gradient: g })} />)}</div>
        <Check label="Reverse" value={st.gradientOverlay.reverse} onChange={(v) => set('gradientOverlay', { reverse: v })} />
        <Select label="Style" value={st.gradientOverlay.shape} options={[['linear', 'Linear'], ['radial', 'Radial'], ['angle', 'Angle'], ['reflected', 'Reflected'], ['diamond', 'Diamond']]} onChange={(v) => set('gradientOverlay', { shape: v })} />{rng('gradientOverlay', 'angle', 'Angle', -180, 180, '°')}{rng('gradientOverlay', 'scale', 'Scale', 10, 150, '%')}</>;
      case 'patternOverlay': return <><h4>Pattern Overlay</h4>{blendL('patternOverlay')}{opac('patternOverlay')}<Select label="Pattern" value={st.patternOverlay.pattern} options={patternNames().map((p) => [p, p] as [string, string])} onChange={(v) => set('patternOverlay', { pattern: v })} /><Slider label="Scale" value={Math.round(st.patternOverlay.scale * 100)} min={10} max={1000} unit="%" onChange={(v) => set('patternOverlay', { scale: v / 100 })} /></>;
      case 'bevel': return <><h4>Bevel & Emboss</h4><Select label="Style" value={st.bevel.style} options={[['inner', 'Inner Bevel'], ['outer', 'Outer Bevel'], ['emboss', 'Emboss'], ['pillow', 'Pillow Emboss']]} onChange={(v) => set('bevel', { style: v })} />
        {rng('bevel', 'depth', 'Depth', 1, 1000, '%')}<Seg value={st.bevel.up ? 'up' : 'down'} onChange={(v) => set('bevel', { up: v === 'up' })} options={[['up', 'Up'], ['down', 'Down']]} />{rng('bevel', 'size', 'Size', 0, 250)}{rng('bevel', 'soften', 'Soften', 0, 16)}
        {rng('bevel', 'angle', 'Angle', -180, 180, '°')}{rng('bevel', 'altitude', 'Altitude', 0, 90, '°')}{colr('bevel', 'highlight', 'Highlight')}{opac('bevel', 'hOpacity')}{colr('bevel', 'shadow', 'Shadow')}{opac('bevel', 'sOpacity')}</>;
      case 'satin': return <><h4>Satin</h4>{blendL('satin')}{colr('satin')}{opac('satin')}{rng('satin', 'angle', 'Angle', -180, 180, '°')}{rng('satin', 'distance', 'Distance', 1, 250)}{rng('satin', 'size', 'Size', 0, 250)}<Check label="Invert" value={st.satin.invert} onChange={(v) => set('satin', { invert: v })} /></>;
    }
  };
  return <Modal title="Layer Style" wide onOk={okay} onCancel={cancel}>
    <div className="style-dlg">
      <nav className="style-nav">
        <button className={'snav' + (sec === 'blend' ? ' on' : '')} onClick={() => setSec('blend')}>Blending Options</button>
        {ORDER.map((k) => <div key={k} className={'snav' + (sec === k ? ' on' : '')} onClick={() => setSec(k)}><input type="checkbox" checked={(st as any)[k].enabled} onChange={(e) => { e.stopPropagation(); set(k, { enabled: e.target.checked } as any); setSec(k); }} onClick={(e) => e.stopPropagation()} /><span>{STYLE_NAMES[k]}</span></div>)}
        <button className="btn sm" onClick={() => setSt(defaultStyles())}>Clear all</button>
      </nav>
      <div className="form">{body()}</div>
    </div>
  </Modal>;
}

// ---------------- Warp Text ----------------
export function WarpTextDialog() {
  const d = requireDoc(); const l = d.active;
  const orig = useRef(l?.text ? { ...l.text.warp } : null);
  const [w, setW] = useState(l?.text?.warp || { style: 'arc' as const, bend: 50 });
  useEffect(() => { if (l?.text) { l.text.warp = w; l.ver++; clearCaches(l.id); d.touch(); app.emit(); } }, [w]);
  if (!l?.text) return <Modal title="Warp Text"><p>Select a type layer first.</p></Modal>;
  return <Modal title="Warp Text" onOk={() => { close(); d.commit('Warp Text'); app.emit(); }} onCancel={() => { l.text!.warp = orig.current!; l.ver++; clearCaches(l.id); d.touch(); close(); }}>
    <Select label="Style" value={w.style} options={[['none', 'None'], ['arc', 'Arc'], ['arch', 'Arch'], ['bulge', 'Bulge'], ['flag', 'Flag'], ['wave', 'Wave'], ['rise', 'Rise']]} onChange={(v) => setW({ ...w, style: v })} />
    <Slider label="Bend" value={w.bend} min={-100} max={100} unit="%" onChange={(v) => setW({ ...w, bend: v })} />
  </Modal>;
}

// ---------------- Develop (Camera Raw style) ----------------
interface Dev { temp: number; tint: number; exposure: number; contrast: number; highlights: number; shadows: number; whites: number; blacks: number; texture: number; clarity: number; dehaze: number; vibrance: number; saturation: number; sharpen: number; noise: number; vignette: number; grain: number }
const DEV0: Dev = { temp: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, texture: 0, clarity: 0, dehaze: 0, vibrance: 0, saturation: 0, sharpen: 0, noise: 0, vignette: 0, grain: 0 };
export function develop(img: ImageData, p: Dev, scale = 1): ImageData {
  let src = img;
  // local contrast first (needs a blurred base)
  if (p.clarity || p.texture || p.dehaze) {
    const blur = gaussianBlur(src, Math.max(1, (p.clarity ? 30 : 6) * scale)); const a = src.data, b = blur.data;
    const k = p.clarity / 100 * 0.8 + p.texture / 100 * 0.4;
    for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c++) a[i + c] = a[i + c] + (a[i + c] - b[i + c]) * k;
    if (p.dehaze) { let mn = 255; for (let i = 0; i < a.length; i += 16) mn = Math.min(mn, a[i], a[i + 1], a[i + 2]); const t = p.dehaze / 100; for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c++) { const v = a[i + c]; a[i + c] = t > 0 ? (v - mn * t) / (1 - mn * t / 255) : v + (128 - v) * -t * 0.4; } }
  }
  const d = src.data, ex = Math.pow(2, p.exposure), con = 1 + p.contrast / 100;
  const tr = 1 + p.temp / 250, tb = 1 - p.temp / 250, tg = 1 - p.tint / 300;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] / 255 * tr * ex, g = d[i + 1] / 255 * tg * ex, b = d[i + 2] / 255 * tb * ex;
    let L = 0.299 * r + 0.587 * g + 0.114 * b;
    const sh = p.shadows / 100 * Math.pow(1 - clamp(L, 0, 1), 3) * 0.6, hi = p.highlights / 100 * Math.pow(clamp(L, 0, 1), 3) * 0.6;
    const wh = p.whites / 100 * Math.pow(clamp(L, 0, 1), 6) * 0.4, bl = p.blacks / 100 * Math.pow(1 - clamp(L, 0, 1), 6) * 0.4;
    const add = sh + hi + wh + bl; r += add; g += add; b += add;
    r = (r - 0.5) * con + 0.5; g = (g - 0.5) * con + 0.5; b = (b - 0.5) * con + 0.5;
    L = 0.299 * r + 0.587 * g + 0.114 * b;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx - mn;
    const vk = 1 + p.saturation / 100 + p.vibrance / 100 * (1 - clamp(sat, 0, 1)) * 1.2;
    r = L + (r - L) * vk; g = L + (g - L) * vk; b = L + (b - L) * vk;
    d[i] = r * 255; d[i + 1] = g * 255; d[i + 2] = b * 255;
  }
  if (p.noise) src = gaussianBlur(src, p.noise / 100 * 1.5 * scale);
  if (p.sharpen) src = unsharpMask(src, p.sharpen * 1.5, Math.max(0.5, scale), 2);
  if (p.vignette) src = vignetteFilter(src, -p.vignette, 30);
  if (p.grain) src = addNoise(src, p.grain / 4, true, true);
  return src;
}
const DEV_GROUPS: [string, [keyof Dev, string, number, number, number?][]][] = [
  ['White Balance', [['temp', 'Temperature', -100, 100], ['tint', 'Tint', -100, 100]]],
  ['Light', [['exposure', 'Exposure', -4, 4, 0.05], ['contrast', 'Contrast', -100, 100], ['highlights', 'Highlights', -100, 100], ['shadows', 'Shadows', -100, 100], ['whites', 'Whites', -100, 100], ['blacks', 'Blacks', -100, 100]]],
  ['Presence', [['texture', 'Texture', -100, 100], ['clarity', 'Clarity', -100, 100], ['dehaze', 'Dehaze', -100, 100], ['vibrance', 'Vibrance', -100, 100], ['saturation', 'Saturation', -100, 100]]],
  ['Detail', [['sharpen', 'Sharpening', 0, 150], ['noise', 'Noise Reduction', 0, 100]]],
  ['Effects', [['vignette', 'Vignette', -100, 100], ['grain', 'Grain', 0, 100]]],
];
function useSrc(max = 520) {
  return useMemo(() => {
    const d = app.doc; if (!d) return null; const l = d.active; const c0 = l?.canvas && l.kind === 'raster' ? l.canvas : null; if (!c0) return null;
    const s = Math.min(1, max / Math.max(c0.width, c0.height)), c = makeCanvas(c0.width * s, c0.height * s); const x = ctx2d(c); x.imageSmoothingQuality = 'high'; x.drawImage(c0, 0, 0, c.width, c.height); return { c, s, data: getData(c) };
  }, []);
}
function LivePreview({ src, fn, deps }: { src: { c: Canvas; s: number; data: ImageData } | null; fn: (img: ImageData, s: number) => ImageData; deps: any[] }) {
  const ref = useRef<HTMLCanvasElement>(null); const [before, setBefore] = useState(false);
  useEffect(() => { const c = ref.current; if (!c || !src) return; if (c.width !== src.c.width || c.height !== src.c.height) { c.width = src.c.width; c.height = src.c.height; } const t = setTimeout(() => { const x = c.getContext('2d')!; if (before) { x.clearRect(0, 0, c.width, c.height); x.drawImage(src.c, 0, 0); return; } x.putImageData(fn(new ImageData(new Uint8ClampedArray(src.data.data), src.data.width, src.data.height), src.s), 0, 0); }, 50); return () => clearTimeout(t); }, [...deps, before]);
  if (!src) return <p className="muted">Select a pixel layer first.</p>;
  return <div className="preview-box big"><canvas ref={ref} className="preview" onPointerDown={() => setBefore(true)} onPointerUp={() => setBefore(false)} onPointerLeave={() => setBefore(false)} /><span className="muted small">Hold on the image to compare with the original</span></div>;
}
export function CameraRawDialog() {
  const src = useSrc(); const [p, setP] = useState<Dev>({ ...DEV0 });
  const auto = () => { if (!src) return; const dd = src.data.data; let sum = 0, n = 0, lo = 255, hi = 0; for (let i = 0; i < dd.length; i += 16) { const v = lum(dd[i], dd[i + 1], dd[i + 2]); sum += v; n++; lo = Math.min(lo, v); hi = Math.max(hi, v); } const mean = sum / n; setP({ ...p, exposure: +clamp(Math.log2(118 / Math.max(8, mean)), -2, 2).toFixed(2), whites: Math.round(clamp((235 - hi) / 2, -50, 50)), blacks: Math.round(clamp(-(lo - 10) / 2, -50, 50)), contrast: 10, vibrance: 15 }); };
  return <Modal title="Develop" wide="xl" onOk={() => { close(); applyToPixels('Develop', (img) => develop(img, p, 1), { margin: 64 }); }} extra={<><button className="btn" onClick={auto}>Auto</button><button className="btn" onClick={() => setP({ ...DEV0 })}>Reset</button></>}>
    <div className="two-col raw"><LivePreview src={src} fn={(img, s) => develop(img, p, s)} deps={[JSON.stringify(p)]} />
      <div className="form scroll">{DEV_GROUPS.map(([g, items]) => <div key={g}><h4>{g}</h4>{items.map(([k, label, min, max, step]) => <Slider key={k} label={label} value={p[k]} min={min} max={max} step={step || 1} onChange={(v) => setP({ ...p, [k]: v })} />)}</div>)}</div></div>
  </Modal>;
}

// ---------------- Lens Correction ----------------
interface Lens { distortion: number; ca: number; vignette: number; vmid: number; vertical: number; horizontal: number; angle: number; scale: number }
export function lensCorrect(s: ImageData, p: Lens): ImageData {
  const w = s.width, h = s.height, out = new ImageData(w, h), sd = s.data, o = out.data, cx = w / 2, cy = h / 2, R = Math.hypot(cx, cy);
  const k = -p.distortion / 100 * 0.35, ang = p.angle * Math.PI / 180, ca = Math.cos(ang), sa = Math.sin(ang), sc = 100 / p.scale;
  const pv = p.vertical / 100 * 0.6, ph = p.horizontal / 100 * 0.6;
  const samp = (x: number, y: number, c: number) => { if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return -1; const x0 = x | 0, y0 = y | 0, x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = x - x0, fy = y - y0; const a = sd[(y0 * w + x0) * 4 + c], b = sd[(y0 * w + x1) * 4 + c], cc = sd[(y1 * w + x0) * 4 + c], dd = sd[(y1 * w + x1) * 4 + c]; return (a + (b - a) * fx) * (1 - fy) + (cc + (dd - cc) * fx) * fy; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let dx = (x - cx) * sc, dy = (y - cy) * sc;
    const rx = dx * ca + dy * sa, ry = -dx * sa + dy * ca; dx = rx; dy = ry;
    // keystone: vertical perspective scales x with y, horizontal scales y with x
    const vy = 1 + pv * (dy / cy), hx = 1 + ph * (dx / cx); dx *= vy; dy *= hx;
    const r = Math.hypot(dx, dy) / R, f = 1 + k * r * r;
    const i = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) { const cf = f * (1 + (c - 1) * p.ca / 2000); const v = samp(cx + dx * cf, cy + dy * cf, c); o[i + c] = v < 0 ? 0 : v; }
    const a = samp(cx + dx * f, cy + dy * f, 3); o[i + 3] = a < 0 ? 0 : a;
    if (p.vignette) { const m = clamp((r - p.vmid / 100) / (1 - p.vmid / 100), 0, 1); const g = 1 + p.vignette / 100 * m * m; o[i] *= g; o[i + 1] *= g; o[i + 2] *= g; }
  }
  return out;
}
export function LensDialog() {
  const src = useSrc(); const [p, setP] = useState<Lens>({ distortion: 0, ca: 0, vignette: 0, vmid: 50, vertical: 0, horizontal: 0, angle: 0, scale: 100 });
  const rows: [keyof Lens, string, number, number, number?][] = [['distortion', 'Remove Distortion', -100, 100], ['ca', 'Chromatic Aberration', -100, 100], ['vignette', 'Vignette Amount', -100, 100], ['vmid', 'Vignette Midpoint', 0, 100], ['vertical', 'Vertical Perspective', -100, 100], ['horizontal', 'Horizontal Perspective', -100, 100], ['angle', 'Angle', -45, 45, 0.1], ['scale', 'Scale', 50, 150]];
  return <Modal title="Lens Correction" wide="xl" onOk={() => { close(); applyToPixels('Lens Correction', (img) => lensCorrect(img, p)); }} extra={<button className="btn" onClick={() => setP({ distortion: 0, ca: 0, vignette: 0, vmid: 50, vertical: 0, horizontal: 0, angle: 0, scale: 100 })}>Reset</button>}>
    <div className="two-col raw"><LivePreview src={src} fn={(img) => lensCorrect(img, p)} deps={[JSON.stringify(p)]} />
      <div className="form">{rows.map(([k, l, a, b, st]) => <Slider key={k} label={l} value={p[k]} min={a} max={b} step={st || 1} onChange={(v) => setP({ ...p, [k]: v })} />)}<p className="muted">Shows a grid while you straighten. Positive distortion fixes barrel distortion, negative fixes pincushion.</p></div></div>
  </Modal>;
}

// ---------------- Liquify ----------------
type LqTool = 'warp' | 'reconstruct' | 'smooth' | 'twirl' | 'twirlccw' | 'pucker' | 'bloat' | 'push' | 'freeze' | 'thaw';
export function LiquifyDialog() {
  const d = requireDoc(); const l = d.active; const ok0 = !!(l && l.kind === 'raster' && l.canvas);
  const srcC = ok0 ? l!.canvas! : makeCanvas(1, 1);
  // work at preview resolution; the displacement field is resolution independent (stored in source pixels)
  const ps = Math.min(1, 900 / Math.max(srcC.width, srcC.height));
  const W = Math.max(1, Math.round(srcC.width * ps)), H = Math.max(1, Math.round(srcC.height * ps));
  const src = useMemo(() => { const c = makeCanvas(W, H), x = ctx2d(c); x.imageSmoothingQuality = 'high'; x.drawImage(srcC, 0, 0, W, H); return getData(c); }, []);
  const field = useRef(new Float32Array(W * H * 2)); const frozen = useRef(new Float32Array(W * H));
  const ref = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<LqTool>('warp'); const [size, setSize] = useState(Math.round(Math.max(W, H) / 10)); const [pressure, setPressure] = useState(50); const [showMask, setShowMask] = useState(true);
  const last = useRef<{ x: number; y: number } | null>(null); const raf = useRef(0);
  const out = useMemo(() => new ImageData(W, H), []);
  const render = () => {
    const f = field.current, s = src.data, o = out.data, fr = frozen.current;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, sx = clamp(x + f[i * 2], 0, W - 1), sy = clamp(y + f[i * 2 + 1], 0, H - 1);
      const x0 = sx | 0, y0 = sy | 0, x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), fx = sx - x0, fy = sy - y0;
      for (let c = 0; c < 4; c++) { const a = s[(y0 * W + x0) * 4 + c], b = s[(y0 * W + x1) * 4 + c], cc = s[(y1 * W + x0) * 4 + c], dd = s[(y1 * W + x1) * 4 + c]; o[i * 4 + c] = (a + (b - a) * fx) * (1 - fy) + (cc + (dd - cc) * fx) * fy; }
      if (showMask && fr[i] > 0) { const k = fr[i] * 0.5; o[i * 4] = o[i * 4] * (1 - k) + 255 * k; o[i * 4 + 1] *= 1 - k; o[i * 4 + 2] *= 1 - k; }
    }
    ref.current?.getContext('2d')!.putImageData(out, 0, 0);
  };
  useEffect(() => { const c = ref.current; if (c) { c.width = W; c.height = H; render(); } }, [showMask]);
  const apply = (px: number, py: number, dx: number, dy: number) => {
    const f = field.current, fr = frozen.current, r = size / 2, st = pressure / 100, r2 = r * r;
    const x0 = Math.max(0, Math.floor(px - r)), x1 = Math.min(W - 1, Math.ceil(px + r)), y0 = Math.max(0, Math.floor(py - r)), y1 = Math.min(H - 1, Math.ceil(py + r));
    const old = tool === 'smooth' ? new Float32Array(f) : null;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const ddx = x - px, ddy = y - py, dist2 = ddx * ddx + ddy * ddy; if (dist2 > r2) continue;
      const i = y * W + x; const fall = Math.pow(1 - dist2 / r2, 2) * st;
      if (tool === 'freeze') { fr[i] = Math.min(1, fr[i] + fall); continue; } if (tool === 'thaw') { fr[i] = Math.max(0, fr[i] - fall); continue; }
      const k = fall * (1 - fr[i]); if (k <= 0) continue;
      switch (tool) {
        case 'warp': f[i * 2] -= dx * k; f[i * 2 + 1] -= dy * k; break;
        case 'push': f[i * 2] -= -dy * k; f[i * 2 + 1] -= dx * k; break;
        case 'reconstruct': f[i * 2] *= 1 - k * 0.3; f[i * 2 + 1] *= 1 - k * 0.3; break;
        case 'smooth': { let sx = 0, sy = 0, n = 0; for (let yy = -2; yy <= 2; yy++) for (let xx = -2; xx <= 2; xx++) { const X = x + xx, Y = y + yy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const j = Y * W + X; sx += old![j * 2]; sy += old![j * 2 + 1]; n++; } f[i * 2] += (sx / n - f[i * 2]) * k; f[i * 2 + 1] += (sy / n - f[i * 2 + 1]) * k; break; }
        case 'twirl': case 'twirlccw': { const a = (tool === 'twirl' ? 1 : -1) * 0.08 * k; f[i * 2] += -ddy * a; f[i * 2 + 1] += ddx * a; break; }
        case 'pucker': f[i * 2] += ddx * 0.06 * k; f[i * 2 + 1] += ddy * 0.06 * k; break;
        case 'bloat': f[i * 2] -= ddx * 0.06 * k; f[i * 2 + 1] -= ddy * 0.06 * k; break;
      }
    }
    cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(render);
  };
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }; };
  const timer = useRef<any>(null);
  const down = (e: React.PointerEvent) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); const p = pos(e); last.current = p; apply(p.x, p.y, 0, 0); if (['twirl', 'twirlccw', 'pucker', 'bloat', 'reconstruct', 'smooth', 'freeze', 'thaw'].includes(tool)) { clearInterval(timer.current); timer.current = setInterval(() => last.current && apply(last.current.x, last.current.y, 0, 0), 40); } };
  const move = (e: React.PointerEvent) => { const c = ref.current!; const p = pos(e); const cur = document.getElementById('lq-cursor'); if (cur) { const r = c.getBoundingClientRect(); const s = size * r.width / W; cur.style.cssText = `left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px;width:${s}px;height:${s}px`; } if (!last.current) return; apply(p.x, p.y, p.x - last.current.x, p.y - last.current.y); last.current = p; };
  const up = () => { last.current = null; clearInterval(timer.current); };
  if (!ok0) return <Modal title="Liquify"><p>Select a pixel layer first. Rasterize type or shape layers before using Liquify.</p></Modal>;
  const commit = () => {
    // upsample the field to the full layer resolution and resample the original pixels
    const sw = srcC.width, sh = srcC.height, sd = getData(srcC).data, res = new ImageData(sw, sh), o = res.data, f = field.current, inv = 1 / ps;
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const fx = clamp(x * ps, 0, W - 1), fy = clamp(y * ps, 0, H - 1), X0 = fx | 0, Y0 = fy | 0, X1 = Math.min(W - 1, X0 + 1), Y1 = Math.min(H - 1, Y0 + 1), ax = fx - X0, ay = fy - Y0;
      const g = (c: number) => { const a = f[(Y0 * W + X0) * 2 + c], b = f[(Y0 * W + X1) * 2 + c], cc = f[(Y1 * W + X0) * 2 + c], dd = f[(Y1 * W + X1) * 2 + c]; return ((a + (b - a) * ax) * (1 - ay) + (cc + (dd - cc) * ax) * ay) * inv; };
      const sx = clamp(x + g(0), 0, sw - 1), sy = clamp(y + g(1), 0, sh - 1), x0 = sx | 0, y0 = sy | 0, x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1), bx = sx - x0, by = sy - y0, i = (y * sw + x) * 4;
      for (let c = 0; c < 4; c++) { const a = sd[(y0 * sw + x0) * 4 + c], b = sd[(y0 * sw + x1) * 4 + c], cc = sd[(y1 * sw + x0) * 4 + c], dd = sd[(y1 * sw + x1) * 4 + c]; o[i + c] = (a + (b - a) * bx) * (1 - by) + (cc + (dd - cc) * bx) * by; }
    }
    const c = makeCanvas(sw, sh); ctx2d(c).putImageData(res, 0, 0); close(); run('applyCanvas', { canvas: c, label: 'Liquify', layerId: l!.id });
  };
  const tools: [LqTool, React.ReactNode, string][] = [['warp', <I.Hand size={16} />, 'Forward Warp (W)'], ['reconstruct', <I.Undo2 size={16} />, 'Reconstruct (R)'], ['smooth', <I.Waves size={16} />, 'Smooth (E)'], ['twirl', <I.RotateCw size={16} />, 'Twirl Clockwise (C)'], ['twirlccw', <I.RotateCcw size={16} />, 'Twirl Counterclockwise'], ['pucker', <I.Minimize2 size={16} />, 'Pucker (S)'], ['bloat', <I.Maximize2 size={16} />, 'Bloat (B)'], ['push', <I.MoveLeft size={16} />, 'Push Left (O)'], ['freeze', <I.Snowflake size={16} />, 'Freeze Mask (F)'], ['thaw', <I.Sun size={16} />, 'Thaw Mask (D)']];
  return <Modal title="Liquify" wide="xl" className="liquify" onOk={commit} extra={<><button className="btn" onClick={() => { field.current.fill(0); render(); }}>Restore All</button><button className="btn" onClick={() => { frozen.current.fill(0); render(); }}>Thaw All</button></>}>
    <div className="lq">
      <div className="lq-tools">{tools.map(([t, ic, n]) => <button key={t} className={'icon-btn' + (tool === t ? ' on' : '')} title={n} aria-label={n} onClick={() => setTool(t)}>{ic}</button>)}</div>
      <div className="lq-canvas"><div className="lq-wrap"><canvas ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} style={{ touchAction: 'none' }} /><div id="lq-cursor" className="lq-cursor" /></div></div>
      <div className="form lq-opts"><Slider label="Size" value={size} min={4} max={Math.max(W, H)} onChange={setSize} unit="px" /><Slider label="Pressure" value={pressure} min={1} max={100} onChange={setPressure} unit="%" /><Check label="Show frozen areas" value={showMask} onChange={setShowMask} /><p className="muted">Drag on the image. Twirl, pucker, bloat and reconstruct keep working while you hold still.</p></div>
    </div>
  </Modal>;
}

// ---------------- Colour picker ----------------
export function ColorPickerDialog({ value, onPick }: { value: string; onPick?: (v: string) => void }) {
  const init = hexToRgb(value && value !== 'transparent' ? value : '#000000'); const [h0, s0, v0] = rgbToHsv(init.r, init.g, init.b);
  const [hsv, setHsv] = useState<[number, number, number]>([h0, s0, v0]); const [hex, setHex] = useState(rgbToHex(init));
  const rgb = hsvToRgb(hsv[0], hsv[1], hsv[2]); const cur = rgbToHex(rgb);
  useEffect(() => setHex(cur), [cur]);
  const sv = useRef<HTMLDivElement>(null), hue = useRef<HTMLDivElement>(null);
  const dragSV = (e: React.PointerEvent) => { if (e.type === 'pointerdown') (e.target as HTMLElement).setPointerCapture(e.pointerId); else if (!e.buttons) return; const r = sv.current!.getBoundingClientRect(); setHsv([hsv[0], clamp((e.clientX - r.left) / r.width, 0, 1), clamp(1 - (e.clientY - r.top) / r.height, 0, 1)]); };
  const dragH = (e: React.PointerEvent) => { if (e.type === 'pointerdown') (e.target as HTMLElement).setPointerCapture(e.pointerId); else if (!e.buttons) return; const r = hue.current!.getBoundingClientRect(); setHsv([clamp(1 - (e.clientY - r.top) / r.height, 0, 1) * 359.9, hsv[1], hsv[2]]); };
  const setRGB = (r: number, g: number, b: number) => { const n = rgbToHsv(r, g, b); setHsv([n[1] === 0 ? hsv[0] : n[0], n[1], n[2]]); };
  const pick = () => { close(); onPick ? onPick(cur) : (app.fg = cur, app.emit()); };
  const eyedrop = async () => { const ED = (window as any).EyeDropper; if (!ED) { app.toast('Close this and use the Eyedropper tool (I) to sample from the image.'); return; } try { const r = await new ED().open(); const c = hexToRgb(r.sRGBHex); setRGB(c.r, c.g, c.b); } catch { /* cancelled */ } };
  const webSafe = [rgb.r, rgb.g, rgb.b].every((v) => v % 51 === 0);
  return <Modal title="Color Picker" onOk={pick}>
    <div className="picker">
      <div ref={sv} className="sv" style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv[0]} 100% 50%))` }} onPointerDown={dragSV} onPointerMove={dragSV}><span className="sv-dot" style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%` }} /></div>
      <div ref={hue} className="hue" onPointerDown={dragH} onPointerMove={dragH}><span className="hue-dot" style={{ top: `${(1 - hsv[0] / 360) * 100}%` }} /></div>
      <div className="form">
        <div className="newold"><span style={{ background: cur }} title="New" /><span style={{ background: value }} title="Current" onClick={() => setRGB(init.r, init.g, init.b)} /></div>
        <Num label="H" value={Math.round(hsv[0])} min={0} max={359} onChange={(v) => setHsv([v, hsv[1], hsv[2]])} unit="°" /><Num label="S" value={Math.round(hsv[1] * 100)} min={0} max={100} onChange={(v) => setHsv([hsv[0], v / 100, hsv[2]])} unit="%" /><Num label="B" value={Math.round(hsv[2] * 100)} min={0} max={100} onChange={(v) => setHsv([hsv[0], hsv[1], v / 100])} unit="%" />
        <Num label="R" value={rgb.r} min={0} max={255} onChange={(v) => setRGB(v, rgb.g, rgb.b)} /><Num label="G" value={rgb.g} min={0} max={255} onChange={(v) => setRGB(rgb.r, v, rgb.b)} /><Num label="B" value={rgb.b} min={0} max={255} onChange={(v) => setRGB(rgb.r, rgb.g, v)} />
        <label className="numfield"><span>#</span><input value={hex.replace('#', '')} onChange={(e) => { setHex('#' + e.target.value); if (/^[0-9a-f]{6}$/i.test(e.target.value)) { const c = hexToRgb('#' + e.target.value); setRGB(c.r, c.g, c.b); } }} onKeyDown={(e) => e.stopPropagation()} style={{ width: 70 }} /></label>
        <div className="row"><button className="btn sm" onClick={eyedrop}><I.Pipette size={13} /> Sample</button>{!webSafe && <button className="btn sm" title="Snap to web-safe colour" onClick={() => setRGB(Math.round(rgb.r / 51) * 51, Math.round(rgb.g / 51) * 51, Math.round(rgb.b / 51) * 51)}>Web safe</button>}<button className="btn sm" onClick={() => { app.swatches.push(cur); app.emit(); }}>Add to swatches</button></div>
      </div>
    </div>
    <div className="swatches small">{app.swatches.map((c, i) => <button key={i} className="sw" style={{ background: c }} onClick={() => { const o = hexToRgb(c); setRGB(o.r, o.g, o.b); }} />)}</div>
  </Modal>;
}

// ---------------- Gradient editor ----------------
export function GradientDialog({ value, onPick }: { value?: Gradient; onPick?: (g: Gradient) => void }) {
  const [g, setG] = useState<Gradient>(() => JSON.parse(JSON.stringify(value || app.gradient)));
  const [sel, setSel] = useState(0); const bar = useRef<HTMLDivElement>(null);
  const stops = g.stops; const s = stops[sel] || stops[0];
  const upd = (i: number, p: Partial<{ pos: number; color: string }>) => setG({ ...g, stops: stops.map((x, j) => j === i ? { ...x, ...p } : x) });
  const drag = (i: number) => (e: React.PointerEvent) => { e.stopPropagation(); setSel(i); const el = e.target as HTMLElement; el.setPointerCapture(e.pointerId); const mv = (ev: PointerEvent) => { const r = bar.current!.getBoundingClientRect(); const pos = clamp((ev.clientX - r.left) / r.width, 0, 1); if (ev.clientY - r.bottom > 40 && stops.length > 2) return; setG((G) => ({ ...G, stops: G.stops.map((x, j) => j === i ? { ...x, pos } : x) })); }; const upf = (ev: PointerEvent) => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', upf); const r = bar.current!.getBoundingClientRect(); if (ev.clientY - r.bottom > 40) setG((G) => G.stops.length > 2 ? ({ ...G, stops: G.stops.filter((_, j) => j !== i) }) : G); }; el.addEventListener('pointermove', mv); el.addEventListener('pointerup', upf); };
  const add = (e: React.PointerEvent) => { const r = bar.current!.getBoundingClientRect(); const pos = clamp((e.clientX - r.left) / r.width, 0, 1); setG({ ...g, stops: [...stops, { pos, color: app.fg }] }); setSel(stops.length); };
  return <Modal title="Gradient Editor" onOk={() => { close(); const out = { ...g, stops: [...g.stops].sort((a, b) => a.pos - b.pos) }; if (onPick) onPick(out); else { app.gradient = out; app.emit(); } }}>
    <div className="grad-row">{GRADIENT_PRESETS.map((p) => <button key={p.name} className="gsw" title={p.name} style={{ background: gradientCss(p) }} onClick={() => { setG(JSON.parse(JSON.stringify(p))); setSel(0); }} />)}</div>
    <label className="field"><span className="field-label">Name</span><input value={g.name || ''} onChange={(e) => setG({ ...g, name: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></label>
    <div className="grad-edit"><div ref={bar} className="grad-big" style={{ background: gradientCss({ ...g, stops: [...stops].sort((a, b) => a.pos - b.pos) }) }} onPointerDown={add} title="Click to add a colour stop" />
      <div className="grad-stops">{stops.map((x, i) => <span key={i} className={'gstop' + (i === sel ? ' on' : '')} style={{ left: `${x.pos * 100}%`, background: x.color }} onPointerDown={drag(i)} />)}</div></div>
    <p className="muted small">Click the bar to add a stop. Drag a stop down off the bar to remove it.</p>
    {s && <div className="row"><span className="lbl">Stop colour</span><ColorChip value={s.color} onChange={(v) => upd(sel, { color: v })} size={24} /><button className="btn sm" onClick={() => upd(sel, { color: app.fg })}>Foreground</button><Num label="Location" value={Math.round(s.pos * 100)} min={0} max={100} onChange={(v) => upd(sel, { pos: v / 100 })} unit="%" />{stops.length > 2 && <button className="icon-btn" title="Delete stop" onClick={() => { setG({ ...g, stops: stops.filter((_, j) => j !== sel) }); setSel(0); }}><I.Trash2 size={13} /></button>}</div>}
    <div className="row"><span className="lbl">Opacity</span><Slider label="Start" value={Math.round((g.opacity[0]?.a ?? 1) * 100)} min={0} max={100} unit="%" onChange={(v) => setG({ ...g, opacity: [{ pos: 0, a: v / 100 }, g.opacity[g.opacity.length - 1] || { pos: 1, a: 1 }] })} /><Slider label="End" value={Math.round((g.opacity[g.opacity.length - 1]?.a ?? 1) * 100)} min={0} max={100} unit="%" onChange={(v) => setG({ ...g, opacity: [g.opacity[0] || { pos: 0, a: 1 }, { pos: 1, a: v / 100 }] })} /></div>
  </Modal>;
}
export { paintTarget };
export type { BlendMode };
