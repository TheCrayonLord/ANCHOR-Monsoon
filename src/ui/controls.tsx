// Small form controls shared by panels, options bar and dialogs.
import { useEffect, useRef, useState } from 'react';
import { app } from '../app';

export function Slider({ label, value, min, max, step = 1, onChange, unit = '', onCommit, width }: { label?: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; unit?: string; onCommit?: () => void; width?: number }) {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => setTxt(String(+value.toFixed(step < 1 ? 2 : 0))), [value, step]);
  return (
    <label className="slider" style={width ? { width } : undefined}>
      {label && <span className="slider-label">{label}</span>}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} onPointerUp={onCommit} onKeyUp={onCommit} />
      <input className="num" value={txt} onChange={(e) => { setTxt(e.target.value); const n = parseFloat(e.target.value); if (!isNaN(n)) onChange(Math.max(min, Math.min(max, n))); }} onBlur={onCommit} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      {unit && <span className="unit">{unit}</span>}
    </label>
  );
}
export function Num({ label, value, onChange, min = -1e9, max = 1e9, step = 1, unit, width = 56 }: { label?: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; unit?: string; width?: number }) {
  // scrubby label: drag sideways on the label to change the value
  const drag = useRef<{ x: number; v: number } | null>(null);
  return (
    <label className="numfield">
      {label && <span className="scrub" onPointerDown={(e) => { drag.current = { x: e.clientX, v: value }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (drag.current && app.opts.scrubby) onChange(Math.max(min, Math.min(max, Math.round((drag.current.v + ((e.clientX - drag.current.x) * step)) / step) * step))); }}
        onPointerUp={() => { drag.current = null; }}>{label}</span>}
      <input type="number" value={Number.isFinite(value) ? +value.toFixed(3) : 0} min={min} max={max} step={step} style={{ width }} onChange={(e) => { const n = parseFloat(e.target.value); if (!isNaN(n)) onChange(n); }} onKeyDown={(e) => e.stopPropagation()} />
      {unit && <span className="unit">{unit}</span>}
    </label>
  );
}
export function Select<T extends string | number>({ label, value, options, onChange, title }: { label?: string; value: T; options: [T, string][]; onChange: (v: T) => void; title?: string }) {
  return (
    <label className="selectfield" title={title}>
      {label && <span>{label}</span>}
      <select value={String(value)} onChange={(e) => { const o = options.find((x) => String(x[0]) === e.target.value); if (o) onChange(o[0]); }} onKeyDown={(e) => e.stopPropagation()}>
        {options.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}
      </select>
    </label>
  );
}
export function Check({ label, value, onChange, title }: { label: string; value: boolean; onChange: (v: boolean) => void; title?: string }) {
  return <label className="check" title={title}><input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /> <span>{label}</span></label>;
}
export function ColorChip({ value, onChange, title, size = 22 }: { value: string; onChange: (v: string) => void; title?: string; size?: number }) {
  return (
    <button className="chip" title={title || value} style={{ background: value, width: size, height: size }}
      onClick={() => app.openDialog('color', { value, onPick: onChange })} />
  );
}
export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, React.ReactNode, string?][]; onChange: (v: T) => void }) {
  return <div className="seg">{options.map(([v, l, t]) => <button key={v} title={t} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}</div>;
}
export function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="field"><span className="field-label">{label}</span>{children}</div>; }
