// Context-sensitive options for the active tool.
import { app } from '../app';
import { Slider, Select, Check, ColorChip, Seg, Num } from './controls';
import { ts, commitTransform, cancelTransform, commitCrop, startCrop, straightenFromRuler, commitPerspectiveCrop, finishPen, transformBy, refreshTransform } from '../tools';
import { BLEND_GROUPS, blendLabel, BlendMode } from '../engine/types';
import { BRUSH_PRESETS } from '../engine/brush';
import { GRADIENT_PRESETS, gradientCss, patternNames } from '../engine/paint';
import { CUSTOM_SHAPES } from '../engine/vector';
import { FONTS } from '../app';
import { run, ARTBOARD_PRESETS } from '../cmds';
import { toolName } from './Toolbar';
import { TOOL_ICONS } from './icons';
import { Check as CheckIcon, X, AlignLeft, AlignCenter, AlignRight, AlignJustify } from 'lucide-react';

const blendOpts = (pass = false): [BlendMode, string][] => [...(pass ? [['pass-through', 'Pass Through']] as [BlendMode, string][] : []), ...BLEND_GROUPS.flat().map((m) => [m, blendLabel(m)] as [BlendMode, string])];
export { blendOpts };

function SelOps() {
  const o = app.opts;
  return <Seg value={o.selOp} onChange={(v) => { o.selOp = v; app.emit(); }} options={[['new', '▢', 'New selection'], ['add', '＋', 'Add to selection (Shift)'], ['subtract', '－', 'Subtract from selection (Alt)'], ['intersect', '∩', 'Intersect with selection (Shift+Alt)']]} />;
}
function BrushOpts({ eraser = false, flow = true, blend = true }: { eraser?: boolean; flow?: boolean; blend?: boolean }) {
  const b = eraser ? app.eraserBrush : app.brush;
  const set = (p: Partial<typeof b>) => { Object.assign(b, p); app.emit(); };
  return (<>
    <Select label="Brush" value={''} options={[['', `${Math.round(b.size)} px`], ...BRUSH_PRESETS.map((p) => [p.name, p.name] as [string, string])]} onChange={(n) => { const p = BRUSH_PRESETS.find((x) => x.name === n); if (p) set({ ...p.s }); }} />
    <Slider label="Size" value={b.size} min={1} max={1000} onChange={(v) => set({ size: v })} unit="px" width={170} />
    <Slider label="Hardness" value={Math.round(b.hardness * 100)} min={0} max={100} onChange={(v) => set({ hardness: v / 100 })} unit="%" width={160} />
    {blend && <Select label="Mode" value={b.blend} options={blendOpts()} onChange={(v) => set({ blend: v })} />}
    <Slider label="Opacity" value={Math.round(b.opacity * 100)} min={1} max={100} onChange={(v) => set({ opacity: v / 100 })} unit="%" width={160} />
    {flow && <Slider label="Flow" value={Math.round(b.flow * 100)} min={1} max={100} onChange={(v) => set({ flow: v / 100 })} unit="%" width={150} />}
    <Slider label="Smoothing" value={Math.round(b.smoothing * 100)} min={0} max={95} onChange={(v) => set({ smoothing: v / 100 })} unit="%" width={160} />
    <Check label="Airbrush" value={b.airbrush} onChange={(v) => set({ airbrush: v })} />
    <Check label="Pressure size" value={b.pressureSize} onChange={(v) => set({ pressureSize: v })} title="Pen pressure controls size" />
  </>);
}
function Commit({ onOk, onCancel }: { onOk: () => void; onCancel: () => void }) {
  return <div className="commit"><button className="icon-btn" title="Cancel (Esc)" onClick={onCancel}><X size={16} /></button><button className="icon-btn ok" title="Commit (Enter)" onClick={onOk}><CheckIcon size={16} /></button></div>;
}

export function OptionsBar() {
  const o = app.opts, t = app.tool, d = app.doc;
  const set = (p: Partial<typeof o>) => { Object.assign(o, p); app.emit(); };
  let body: React.ReactNode = null;
  if (ts.transform && d) {
    const tr = ts.transform;
    body = (<>
      <Seg value={tr.mode} onChange={(m) => { if (m === 'warp' && !tr.warp) { const { patchFromRect } = TRM; tr.warp = patchFromRect(tr.rect); } else if (m !== 'warp') tr.warp = null; tr.mode = m; app.emit(); }} options={[['free', 'Free'], ['skew', 'Skew'], ['distort', 'Distort'], ['perspective', 'Perspective'], ['warp', 'Warp']]} />
      {tr.warp && <Select label="Warp" value="custom" options={TRM.WARP_PRESETS.map((w) => [w, w[0].toUpperCase() + w.slice(1)] as [string, string])} onChange={(s) => { tr.warp = s === 'custom' ? TRM.patchFromRect(tr.rect) : TRM.warpPreset(tr.rect, s, 50); refreshTransform(d); app.emit(); }} />}
      <button className="btn sm" onClick={() => transformBy(d, 'rot90')}>Rotate 90° CW</button>
      <button className="btn sm" onClick={() => transformBy(d, 'rot-90')}>Rotate 90° CCW</button>
      <button className="btn sm" onClick={() => transformBy(d, 'flipH')}>Flip H</button>
      <button className="btn sm" onClick={() => transformBy(d, 'flipV')}>Flip V</button>
      <span className="hint">Drag handles to scale (Shift keeps proportions, Alt from centre), outside to rotate, Ctrl+corner to distort.</span>
      <Commit onOk={() => commitTransform(d)} onCancel={() => cancelTransform(d)} />
    </>);
  } else switch (t) {
    case 'artboard': { const ab = d?.active?.artboard; body = (<>
      <button className="btn sm" onClick={() => run('newArtboard')}>Add Artboard</button>
      <Select label="Size" value="" options={[['', ab ? `${ab.w} × ${ab.h}` : 'Preset'], ...ARTBOARD_PRESETS.map(([n]) => [n, n] as [string, string])]} onChange={(n) => { const p = ARTBOARD_PRESETS.find((x) => x[0] === n); if (!p) return; if (ab) run('setArtboard', { w: p[1], h: p[2] }); else run('newArtboard', { w: p[1], h: p[2], name: n.split(' ')[0] }); }} />
      {ab && <><Num label="W" value={ab.w} min={1} onChange={(v) => run('setArtboard', { w: v })} /><Num label="H" value={ab.h} min={1} onChange={(v) => run('setArtboard', { h: v })} /><button className="btn sm" onClick={() => run('setArtboard', { w: ab.h, h: ab.w })}>Rotate</button>
        <span className="lbl">Background</span><ColorChip value={ab.bg || '#ffffff'} onChange={(v) => run('setArtboard', { bg: v })} /><Check label="Transparent" value={!ab.bg} onChange={(v) => run('setArtboard', { bg: v ? null : '#ffffff' })} /></>}
      <button className="btn sm" onClick={() => run('exportArtboards')}>Export Artboards</button>
      <span className="hint">Drag to draw an artboard. Drag inside one to move it with its layers.</span>
    </>); break; }
    case 'move': body = (<>
      <Check label="Auto-Select" value={o.autoSelect} onChange={(v) => set({ autoSelect: v })} />
      <Select value={o.autoSelectGroups ? 'group' : 'layer'} options={[['layer', 'Layer'], ['group', 'Group']]} onChange={(v) => set({ autoSelectGroups: v === 'group' })} />
      <Check label="Show Transform Controls" value={o.showTransform} onChange={(v) => set({ showTransform: v })} />
      <span className="sep" />
      {(['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as const).map((a) => <button key={a} className="btn sm" title={`Align ${a}`} onClick={() => run('align', a)}>{({ left: '⇤', hcenter: '↔', right: '⇥', top: '⤒', vcenter: '↕', bottom: '⤓' })[a]}</button>)}
      <button className="btn sm" title="Distribute horizontally" onClick={() => run('align', 'dist-h')}>⋯</button>
      <button className="btn sm" title="Distribute vertically" onClick={() => run('align', 'dist-v')}>⋮</button>
      <button className="btn sm" onClick={() => d && run('freeTransform')}>Free Transform</button>
    </>); break;
    case 'marquee-rect': case 'marquee-ellipse': case 'marquee-row': case 'marquee-col': body = (<>
      <SelOps /><Slider label="Feather" value={o.feather} min={0} max={250} onChange={(v) => set({ feather: v })} unit="px" width={150} />
      {t === 'marquee-ellipse' && <Check label="Anti-alias" value={o.antialias} onChange={(v) => set({ antialias: v })} />}
      <Select label="Style" value={o.marqueeStyle} options={[['normal', 'Normal'], ['fixed-ratio', 'Fixed Ratio'], ['fixed-size', 'Fixed Size']]} onChange={(v) => set({ marqueeStyle: v })} />
      {o.marqueeStyle !== 'normal' && <><Num label="W" value={o.fixedW} onChange={(v) => set({ fixedW: v })} /><Num label="H" value={o.fixedH} onChange={(v) => set({ fixedH: v })} /></>}
      <button className="btn sm" onClick={() => app.openDialog('selectMask')}>Select and Mask…</button>
    </>); break;
    case 'lasso': case 'lasso-poly': case 'lasso-magnetic': body = (<><SelOps /><Slider label="Feather" value={o.feather} min={0} max={250} onChange={(v) => set({ feather: v })} unit="px" width={150} /><Check label="Anti-alias" value={o.antialias} onChange={(v) => set({ antialias: v })} /><button className="btn sm" onClick={() => app.openDialog('selectMask')}>Select and Mask…</button></>); break;
    case 'magic-wand': case 'quick-select': case 'object-select': body = (<>
      <SelOps />
      {t === 'quick-select' && <Slider label="Size" value={app.brush.size} min={1} max={500} onChange={(v) => { app.brush.size = v; app.emit(); }} unit="px" width={150} />}
      {t === 'magic-wand' && <><Select label="Sample" value={o.sampleSize} options={[[1, 'Point'], [3, '3 by 3 Average'], [5, '5 by 5 Average'], [11, '11 by 11 Average']]} onChange={(v) => set({ sampleSize: v })} /><Slider label="Tolerance" value={o.tolerance} min={0} max={255} onChange={(v) => set({ tolerance: v })} width={160} /><Check label="Anti-alias" value={o.antialias} onChange={(v) => set({ antialias: v })} /><Check label="Contiguous" value={o.contiguous} onChange={(v) => set({ contiguous: v })} /></>}
      <Check label="Sample All Layers" value={o.sampleAll} onChange={(v) => set({ sampleAll: v })} />
      <button className="btn sm" onClick={() => run('selectSubject')}>Select Subject</button>
      <button className="btn sm" onClick={() => app.openDialog('selectMask')}>Select and Mask…</button>
    </>); break;
    case 'crop': body = (<>
      <Select label="Ratio" value={o.cropRatio} options={[['free', 'Ratio (free)'], ['1:1', '1:1 (Square)'], ['4:5', '4:5 (8:10)'], ['5:7', '5:7'], ['2:3', '2:3 (4:6)'], ['3:2', '3:2'], ['4:3', '4:3'], ['16:9', '16:9'], ['9:16', '9:16']]} onChange={(v) => set({ cropRatio: v })} />
      <Select label="Overlay" value={o.cropOverlay} options={[['thirds', 'Rule of Thirds'], ['grid', 'Grid'], ['golden', 'Golden Ratio'], ['none', 'None']]} onChange={(v) => set({ cropOverlay: v })} />
      <Check label="Delete Cropped Pixels" value={o.cropDelete} onChange={(v) => set({ cropDelete: v })} />
      {ts.crop && <Num label="Angle" value={+ts.crop.angle.toFixed(1)} step={0.1} onChange={(v) => { ts.crop!.angle = v; app.emit(); }} unit="°" />}
      <button className="btn sm" onClick={() => { if (d) startCrop(d); }}>Reset</button>
      {ts.crop && d && <Commit onOk={() => commitCrop(d)} onCancel={() => { ts.crop = null; app.emit(); }} />}
    </>); break;
    case 'crop-perspective': body = (<><span className="hint">Drag the four corners onto the edges of a tilted object, then press Enter.</span>{ts.pcrop && d && <Commit onOk={() => commitPerspectiveCrop(d)} onCancel={() => { ts.pcrop = null; app.emit(); }} />}</>); break;
    case 'eyedropper': body = (<><Select label="Sample Size" value={o.eyedropperSize} options={[[1, 'Point Sample'], [3, '3 by 3 Average'], [5, '5 by 5 Average'], [11, '11 by 11 Average'], [31, '31 by 31 Average']]} onChange={(v) => set({ eyedropperSize: v })} /><Select label="Sample" value={o.eyedropperSample} options={[['all', 'All Layers'], ['current', 'Current Layer']]} onChange={(v) => set({ eyedropperSample: v })} /></>); break;
    case 'color-sampler': body = <><span className="hint">Click to add up to 10 samplers. Alt-click removes one. Values show in the Info panel.</span><button className="btn sm" onClick={() => { if (d) { d.s.samplers = []; d.commit('Clear Samplers'); app.emit(); } }}>Clear</button></>; break;
    case 'ruler': body = <><span className="hint">{ts.info || 'Drag to measure distance and angle.'}</span><button className="btn sm" disabled={!ts.ruler} onClick={straightenFromRuler}>Straighten Layer</button><button className="btn sm" onClick={() => { ts.ruler = null; app.emit(); }}>Clear</button></>; break;
    case 'note': body = <><input className="text" placeholder="Author" value={o.noteAuthor} onChange={(e) => set({ noteAuthor: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /><ColorChip value={o.noteColor} onChange={(v) => set({ noteColor: v })} /><button className="btn sm" onClick={() => { if (d) { d.s.notes = []; d.commit('Clear Notes'); app.emit(); } }}>Clear All</button></>; break;
    case 'count': body = <><span className="hint">Count: {d?.s.counts.length || 0}</span><button className="btn sm" onClick={() => { if (d) { d.s.counts = []; d.commit('Clear Count'); app.emit(); } }}>Clear</button></>; break;
    case 'spot-heal': case 'remove': body = (<><BrushOpts flow={false} blend={false} />{t === 'spot-heal' && <Seg value={o.spotType} onChange={(v) => set({ spotType: v })} options={[['content', 'Content-Aware'], ['texture', 'Create Texture'], ['proximity', 'Proximity Match']]} />}</>); break;
    case 'heal': body = (<><BrushOpts flow={false} blend={false} /><Select label="Mode" value={o.healMode} options={[['normal', 'Normal'], ['replace', 'Replace']]} onChange={(v) => set({ healMode: v })} /><Check label="Aligned" value={o.cloneAligned} onChange={(v) => set({ cloneAligned: v })} /><Select label="Sample" value={o.cloneSample} options={[['current', 'Current Layer'], ['all', 'All Layers']]} onChange={(v) => set({ cloneSample: v })} /><span className="hint">Alt-click to set source</span></>); break;
    case 'patch': case 'content-move': body = (<><SelOps />{t === 'patch' ? <><Seg value={o.patchMode} onChange={(v) => set({ patchMode: v })} options={[['normal', 'Normal'], ['content', 'Content-Aware']]} /><Seg value={o.patchFrom} onChange={(v) => set({ patchFrom: v })} options={[['source', 'Source'], ['destination', 'Destination']]} /></> : <span className="hint">Lasso an object, then drag it. The hole it leaves is filled automatically.</span>}</>); break;
    case 'red-eye': body = <span className="hint">Click on a red pupil, or drag a box around an eye.</span>; break;
    case 'brush': case 'pencil': body = <BrushOpts flow={t === 'brush'} />; break;
    case 'mixer': body = (<><BrushOpts blend={false} /><Slider label="Wet" value={Math.round(o.mixerWet * 100)} min={0} max={100} onChange={(v) => set({ mixerWet: v / 100 })} unit="%" width={140} /><Slider label="Load" value={Math.round(o.mixerLoad * 100)} min={1} max={100} onChange={(v) => set({ mixerLoad: v / 100 })} unit="%" width={140} /><Slider label="Mix" value={Math.round(o.mixerMix * 100)} min={0} max={100} onChange={(v) => set({ mixerMix: v / 100 })} unit="%" width={140} /></>); break;
    case 'color-replace': body = (<><BrushOpts flow={false} blend={false} /><Select label="Mode" value={o.replaceMode} options={[['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity']]} onChange={(v) => set({ replaceMode: v })} /><Slider label="Tolerance" value={o.tolerance} min={1} max={100} onChange={(v) => set({ tolerance: v })} unit="%" width={150} /></>); break;
    case 'clone': case 'pattern-stamp': body = (<><BrushOpts />{t === 'clone' ? <><Check label="Aligned" value={o.cloneAligned} onChange={(v) => set({ cloneAligned: v })} /><Select label="Sample" value={o.cloneSample} options={[['current', 'Current Layer'], ['all', 'All Layers']]} onChange={(v) => set({ cloneSample: v })} /><span className="hint">Alt-click to set source</span></> : <Select label="Pattern" value={app.pattern} options={patternNames().map((p) => [p, p] as [string, string])} onChange={(v) => { app.pattern = v; app.emit(); }} />}</>); break;
    case 'history-brush': case 'art-history': body = (<><BrushOpts /><span className="hint">Paints from the history state marked in the History panel.</span></>); break;
    case 'eraser': body = (<><Select label="Mode" value={o.eraserMode} options={[['brush', 'Brush'], ['pencil', 'Pencil'], ['block', 'Block']]} onChange={(v) => set({ eraserMode: v })} /><BrushOpts eraser blend={false} /><Check label="Erase to History" value={o.eraseToHistory} onChange={(v) => set({ eraseToHistory: v })} /></>); break;
    case 'bg-eraser': body = (<><BrushOpts eraser blend={false} flow={false} /><Slider label="Tolerance" value={o.tolerance} min={1} max={100} onChange={(v) => set({ tolerance: v })} unit="%" width={150} /></>); break;
    case 'magic-eraser': body = (<><Slider label="Tolerance" value={o.tolerance} min={0} max={255} onChange={(v) => set({ tolerance: v })} width={160} /><Check label="Anti-alias" value={o.antialias} onChange={(v) => set({ antialias: v })} /><Check label="Contiguous" value={o.contiguous} onChange={(v) => set({ contiguous: v })} /><Check label="Sample All Layers" value={o.sampleAll} onChange={(v) => set({ sampleAll: v })} /></>); break;
    case 'gradient': body = (<>
      <button className="grad-chip" style={{ background: gradientCss(app.gradient) }} onClick={() => app.openDialog('gradient')} title="Edit gradient" />
      <Select value={app.gradient.name || 'Custom'} options={[...GRADIENT_PRESETS.map((g) => [g.name!, g.name!] as [string, string]), ...(GRADIENT_PRESETS.some((g) => g.name === app.gradient.name) ? [] : [['Custom', 'Custom'] as [string, string]])]} onChange={(n) => { const g = GRADIENT_PRESETS.find((x) => x.name === n); if (g) { app.gradient = g; app.emit(); } }} />
      <Seg value={o.gradShape} onChange={(v) => set({ gradShape: v })} options={[['linear', 'Linear'], ['radial', 'Radial'], ['angle', 'Angle'], ['reflected', 'Reflected'], ['diamond', 'Diamond']]} />
      <Select label="Mode" value={o.gradMode as BlendMode} options={blendOpts()} onChange={(v) => set({ gradMode: v })} />
      <Slider label="Opacity" value={Math.round(o.gradOpacity * 100)} min={1} max={100} onChange={(v) => set({ gradOpacity: v / 100 })} unit="%" width={150} />
      <Check label="Reverse" value={o.gradReverse} onChange={(v) => set({ gradReverse: v })} /><Check label="Dither" value={o.gradDither} onChange={(v) => set({ gradDither: v })} />
    </>); break;
    case 'bucket': body = (<><Select label="Fill" value={o.bucketSource} options={[['fg', 'Foreground'], ['pattern', 'Pattern']]} onChange={(v) => set({ bucketSource: v })} />{o.bucketSource === 'pattern' && <Select value={app.pattern} options={patternNames().map((p) => [p, p] as [string, string])} onChange={(v) => { app.pattern = v; app.emit(); }} />}<Select label="Mode" value={app.brush.blend} options={blendOpts()} onChange={(v) => { app.brush.blend = v; app.emit(); }} /><Slider label="Opacity" value={Math.round(app.brush.opacity * 100)} min={1} max={100} onChange={(v) => { app.brush.opacity = v / 100; app.emit(); }} unit="%" width={150} /><Slider label="Tolerance" value={o.tolerance} min={0} max={255} onChange={(v) => set({ tolerance: v })} width={150} /><Check label="Anti-alias" value={o.antialias} onChange={(v) => set({ antialias: v })} /><Check label="Contiguous" value={o.contiguous} onChange={(v) => set({ contiguous: v })} /><Check label="All Layers" value={o.sampleAll} onChange={(v) => set({ sampleAll: v })} /></>); break;
    case 'blur': case 'sharpen': case 'smudge': body = (<><BrushOpts flow={false} blend={false} /><Slider label="Strength" value={Math.round(o.strength * 100)} min={1} max={100} onChange={(v) => set({ strength: v / 100 })} unit="%" width={150} />{t === 'smudge' && <Check label="Finger Painting" value={o.fingerPaint} onChange={(v) => set({ fingerPaint: v })} />}</>); break;
    case 'dodge': case 'burn': body = (<><BrushOpts flow={false} blend={false} /><Select label="Range" value={o.range} options={[['shadows', 'Shadows'], ['midtones', 'Midtones'], ['highlights', 'Highlights']]} onChange={(v) => set({ range: v })} /><Slider label="Exposure" value={Math.round(o.exposure * 100)} min={1} max={100} onChange={(v) => set({ exposure: v / 100 })} unit="%" width={150} /><Check label="Protect Tones" value={o.protectTones} onChange={(v) => set({ protectTones: v })} /></>); break;
    case 'sponge': body = (<><BrushOpts flow={false} blend={false} /><Select label="Mode" value={o.spongeMode} options={[['desaturate', 'Desaturate'], ['saturate', 'Saturate']]} onChange={(v) => set({ spongeMode: v })} /><Slider label="Flow" value={Math.round(o.strength * 100)} min={1} max={100} onChange={(v) => set({ strength: v / 100 })} unit="%" width={150} /></>); break;
    case 'pen': case 'freeform-pen': case 'curvature-pen': case 'shape-rect': case 'shape-ellipse': case 'shape-triangle': case 'shape-polygon': case 'shape-line': case 'shape-custom': body = (<>
      <Select value={o.shapeMode} options={[['shape', 'Shape'], ['path', 'Path'], ['pixels', 'Pixels']]} onChange={(v) => set({ shapeMode: v })} />
      {o.shapeMode === 'shape' && <>
        <span className="lbl">Fill</span><Select value={o.shapeFillType} options={[['color', 'Color'], ['gradient', 'Gradient'], ['none', 'None']]} onChange={(v) => set({ shapeFillType: v })} />{o.shapeFillType === 'color' && <ColorChip value={o.shapeFill} onChange={(v) => set({ shapeFill: v })} />}
        <Check label="Stroke" value={o.shapeStrokeOn} onChange={(v) => set({ shapeStrokeOn: v })} />{o.shapeStrokeOn && <><ColorChip value={o.shapeStroke} onChange={(v) => set({ shapeStroke: v })} /><Num value={o.shapeStrokeWidth} min={0} max={500} onChange={(v) => set({ shapeStrokeWidth: v })} unit="px" width={44} /><Select value={o.shapeStrokeAlign} options={[['inside', 'Inside'], ['center', 'Center'], ['outside', 'Outside']]} onChange={(v) => set({ shapeStrokeAlign: v })} /><input className="text sm" placeholder="Dashes e.g. 2 2" value={o.shapeDash} onChange={(e) => set({ shapeDash: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></>}
      </>}
      {t === 'shape-rect' && <Num label="Radius" value={o.radius} min={0} max={1000} onChange={(v) => set({ radius: v })} unit="px" />}
      {t === 'shape-polygon' && <><Num label="Sides" value={o.sides} min={3} max={100} onChange={(v) => set({ sides: v })} /><Num label="Star" value={o.star} min={0} max={99} onChange={(v) => set({ star: v })} unit="%" /></>}
      {t === 'shape-line' && <><Num label="Weight" value={o.lineWidth} min={1} max={500} onChange={(v) => set({ lineWidth: v })} unit="px" /><Check label="Start arrow" value={o.arrowStart} onChange={(v) => set({ arrowStart: v })} /><Check label="End arrow" value={o.arrowEnd} onChange={(v) => set({ arrowEnd: v })} /></>}
      {t === 'shape-custom' && <Select label="Shape" value={o.customShape} options={Object.keys(CUSTOM_SHAPES).map((k) => [k, k] as [string, string])} onChange={(v) => set({ customShape: v })} />}
      {t.includes('pen') && ts.pen && d && <><button className="btn sm" onClick={() => finishPen(d, false)}>Finish</button><button className="btn sm" onClick={() => finishPen(d, true)}>Close Path</button></>}
    </>); break;
    case 'type': case 'type-vertical': case 'type-mask': case 'type-mask-vertical': body = (<>
      <Select value={o.font} options={FONTS.map((f) => [f, f.split(',')[0]] as [string, string])} onChange={(v) => { set({ font: v }); applyText({ font: v }); }} />
      <Select value={o.fontWeight} options={[[300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [900, 'Black']]} onChange={(v) => { set({ fontWeight: v }); applyText({ weight: v }); }} />
      <Num label="Size" value={o.fontSize} min={1} max={2000} onChange={(v) => { set({ fontSize: v }); applyText({ size: v }); }} unit="px" />
      <Seg value={o.textAlign} onChange={(v) => { set({ textAlign: v }); applyText({ align: v }); }} options={[['left', <AlignLeft size={14} />, 'Left'], ['center', <AlignCenter size={14} />, 'Center'], ['right', <AlignRight size={14} />, 'Right'], ['justify', <AlignJustify size={14} />, 'Justify']]} />
      <ColorChip value={app.fg} onChange={(v) => { app.fg = v; applyText({ color: v }); app.emit(); }} title="Text colour" />
      <button className="btn sm" onClick={() => app.openDialog('warpText')}>Warp Text</button>
      <button className="btn sm" onClick={() => { app.panelsOpen.character = true; app.emit(); }}>Character Panel</button>
    </>); break;
    case 'path-select': case 'direct-select': case 'add-anchor': case 'delete-anchor': case 'convert-point': body = <span className="hint">Edits the active shape layer's path, or the selected path in the Paths panel.</span>; break;
    case 'hand': body = <><button className="btn sm" onClick={() => run('actual')}>100%</button><button className="btn sm" onClick={() => run('fit')}>Fit Screen</button></>; break;
    case 'rotate-view': body = <><Num label="Angle" value={Math.round(d?.rotation || 0)} onChange={(v) => { if (d) { d.rotation = v; app.emit(); } }} unit="°" /><button className="btn sm" onClick={() => { if (d) { d.rotation = 0; app.emit(); } }}>Reset View</button></>; break;
    case 'zoom': body = <><Seg value={o.zoomOut ? 'out' : 'in'} onChange={(v) => set({ zoomOut: v === 'out' })} options={[['in', 'Zoom In'], ['out', 'Zoom Out']]} /><button className="btn sm" onClick={() => run('actual')}>100%</button><button className="btn sm" onClick={() => run('fit')}>Fit Screen</button><button className="btn sm" onClick={() => run('fillScreen')}>Fill Screen</button></>; break;
  }
  return (
    <div className="optionsbar">
      <span className="opt-tool" title={toolName(t)}>{TOOL_ICONS[t]}</span>
      <div className="opt-body">{body}</div>
    </div>
  );
}
function applyText(p: any) {
  const d = app.doc; const l = d?.active; if (!d || !l?.text) return;
  Object.assign(l.text, p); l.ver++; d.commit('Edit Type'); app.emit();
}
import * as TRM from '../engine/transform';
