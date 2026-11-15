// Left tool strip with grouped flyouts, colour swatches and quick mask.
import { useState } from 'react';
import { app, ToolId } from '../app';
import { TOOL_ICONS } from './icons';
import { run } from '../cmds';
import { ArrowLeftRight, RotateCcw } from 'lucide-react';
import { ts, startCrop } from '../tools';

export interface ToolDef { id: ToolId; name: string; key: string }
export const TOOL_GROUPS: ToolDef[][] = [
  [{ id: 'move', name: 'Move Tool', key: 'V' }, { id: 'artboard', name: 'Artboard Tool', key: 'V' }],
  [{ id: 'marquee-rect', name: 'Rectangular Marquee', key: 'M' }, { id: 'marquee-ellipse', name: 'Elliptical Marquee', key: 'M' }, { id: 'marquee-row', name: 'Single Row Marquee', key: '' }, { id: 'marquee-col', name: 'Single Column Marquee', key: '' }],
  [{ id: 'lasso', name: 'Lasso Tool', key: 'L' }, { id: 'lasso-poly', name: 'Polygonal Lasso', key: 'L' }, { id: 'lasso-magnetic', name: 'Magnetic Lasso', key: 'L' }],
  [{ id: 'object-select', name: 'Object Selection Tool', key: 'W' }, { id: 'quick-select', name: 'Quick Selection Tool', key: 'W' }, { id: 'magic-wand', name: 'Magic Wand Tool', key: 'W' }],
  [{ id: 'crop', name: 'Crop Tool', key: 'C' }, { id: 'crop-perspective', name: 'Perspective Crop Tool', key: 'C' }],
  [{ id: 'eyedropper', name: 'Eyedropper Tool', key: 'I' }, { id: 'color-sampler', name: 'Color Sampler Tool', key: 'I' }, { id: 'ruler', name: 'Ruler Tool', key: 'I' }, { id: 'note', name: 'Note Tool', key: 'I' }, { id: 'count', name: 'Count Tool', key: 'I' }],
  [{ id: 'spot-heal', name: 'Spot Healing Brush', key: 'J' }, { id: 'remove', name: 'Remove Tool', key: 'J' }, { id: 'heal', name: 'Healing Brush', key: 'J' }, { id: 'patch', name: 'Patch Tool', key: 'J' }, { id: 'content-move', name: 'Content-Aware Move', key: 'J' }, { id: 'red-eye', name: 'Red Eye Tool', key: 'J' }],
  [{ id: 'brush', name: 'Brush Tool', key: 'B' }, { id: 'pencil', name: 'Pencil Tool', key: 'B' }, { id: 'color-replace', name: 'Color Replacement', key: 'B' }, { id: 'mixer', name: 'Mixer Brush', key: 'B' }],
  [{ id: 'clone', name: 'Clone Stamp', key: 'S' }, { id: 'pattern-stamp', name: 'Pattern Stamp', key: 'S' }],
  [{ id: 'history-brush', name: 'History Brush', key: 'Y' }, { id: 'art-history', name: 'Art History Brush', key: 'Y' }],
  [{ id: 'eraser', name: 'Eraser Tool', key: 'E' }, { id: 'bg-eraser', name: 'Background Eraser', key: 'E' }, { id: 'magic-eraser', name: 'Magic Eraser', key: 'E' }],
  [{ id: 'gradient', name: 'Gradient Tool', key: 'G' }, { id: 'bucket', name: 'Paint Bucket', key: 'G' }],
  [{ id: 'blur', name: 'Blur Tool', key: '' }, { id: 'sharpen', name: 'Sharpen Tool', key: '' }, { id: 'smudge', name: 'Smudge Tool', key: '' }],
  [{ id: 'dodge', name: 'Dodge Tool', key: 'O' }, { id: 'burn', name: 'Burn Tool', key: 'O' }, { id: 'sponge', name: 'Sponge Tool', key: 'O' }],
  [{ id: 'pen', name: 'Pen Tool', key: 'P' }, { id: 'freeform-pen', name: 'Freeform Pen', key: 'P' }, { id: 'curvature-pen', name: 'Curvature Pen', key: 'P' }, { id: 'add-anchor', name: 'Add Anchor Point', key: '' }, { id: 'delete-anchor', name: 'Delete Anchor Point', key: '' }, { id: 'convert-point', name: 'Convert Point', key: '' }],
  [{ id: 'type', name: 'Horizontal Type', key: 'T' }, { id: 'type-vertical', name: 'Vertical Type', key: 'T' }, { id: 'type-mask', name: 'Horizontal Type Mask', key: 'T' }, { id: 'type-mask-vertical', name: 'Vertical Type Mask', key: 'T' }],
  [{ id: 'path-select', name: 'Path Selection', key: 'A' }, { id: 'direct-select', name: 'Direct Selection', key: 'A' }],
  [{ id: 'shape-rect', name: 'Rectangle Tool', key: 'U' }, { id: 'shape-ellipse', name: 'Ellipse Tool', key: 'U' }, { id: 'shape-triangle', name: 'Triangle Tool', key: 'U' }, { id: 'shape-polygon', name: 'Polygon Tool', key: 'U' }, { id: 'shape-line', name: 'Line Tool', key: 'U' }, { id: 'shape-custom', name: 'Custom Shape', key: 'U' }],
  [{ id: 'hand', name: 'Hand Tool', key: 'H' }, { id: 'rotate-view', name: 'Rotate View', key: 'R' }],
  [{ id: 'zoom', name: 'Zoom Tool', key: 'Z' }],
];
export const ALL_TOOLS = TOOL_GROUPS.flat();
export const toolName = (id: ToolId) => ALL_TOOLS.find((t) => t.id === id)?.name || id;

export function selectTool(id: ToolId) {
  const g = TOOL_GROUPS.findIndex((grp) => grp.some((t) => t.id === id));
  if (g >= 0) app.lastInGroup[g] = id;
  if (id === 'crop' && app.doc && !ts.crop) startCrop(app.doc);
  if (id !== 'crop') ts.crop = null;
  if (id !== 'crop-perspective') ts.pcrop = null;
  if (id === 'artboard') { app.toast('Artboards are not supported yet; the Move tool is selected instead.'); id = 'move'; }
  app.setTool(id);
}
/** Keyboard: pressing a tool letter selects the group; Shift+letter cycles within it. */
export function toolKey(key: string, shift: boolean) {
  const groups = TOOL_GROUPS.map((g, i) => [g, i] as const).filter(([g]) => g.some((t) => t.key === key.toUpperCase()));
  if (!groups.length) return false;
  const [g, gi] = groups.find(([gg]) => gg.some((t) => t.id === app.tool)) || groups[0];
  const withKey = g.filter((t) => t.key === key.toUpperCase());
  if (shift && g.some((t) => t.id === app.tool)) { const i = withKey.findIndex((t) => t.id === app.tool); selectTool(withKey[(i + 1) % withKey.length].id); }
  else selectTool((app.lastInGroup[gi] as ToolId) && withKey.some((t) => t.id === app.lastInGroup[gi]) ? app.lastInGroup[gi] as ToolId : withKey[0].id);
  return true;
}

export function Toolbar() {
  const [fly, setFly] = useState<number | null>(null);
  const d = app.doc;
  return (
    <div className="toolbar" onPointerLeave={() => setFly(null)}>
      {TOOL_GROUPS.map((g, i) => {
        const cur = g.find((t) => t.id === app.tool) || g.find((t) => t.id === app.lastInGroup[i]) || g[0];
        const on = g.some((t) => t.id === app.tool);
        return (
          <div key={i} className="tool-group">
            <button className={'tool' + (on ? ' on' : '')} title={`${cur.name}${cur.key ? ` (${cur.key})` : ''}`} data-tool={cur.id}
              onClick={() => selectTool(cur.id)} onContextMenu={(e) => { e.preventDefault(); if (g.length > 1) setFly(i); }}
              onPointerDown={(e) => { if (g.length < 2) return; const t = setTimeout(() => setFly(i), 350); const up = () => { clearTimeout(t); window.removeEventListener('pointerup', up); }; window.addEventListener('pointerup', up); void e; }}>
              {TOOL_ICONS[cur.id]}
              {g.length > 1 && <span className="tri" onClick={(e) => { e.stopPropagation(); setFly(fly === i ? null : i); }} />}
            </button>
            {fly === i && (
              <div className="flyout">
                {g.map((t) => <button key={t.id} className={t.id === app.tool ? 'on' : ''} onClick={() => { selectTool(t.id); setFly(null); }}>{TOOL_ICONS[t.id]}<span>{t.name}</span><kbd>{t.key}</kbd></button>)}
              </div>
            )}
          </div>
        );
      })}
      <div className="tool-sep" />
      <div className="colors" title="Foreground and background colours">
        <button className="swatch fg" style={{ background: app.fg }} onClick={() => app.openDialog('color', { value: app.fg, onPick: (c: string) => { app.fg = c; app.emit(); } })} aria-label="Foreground colour" />
        <button className="swatch bg" style={{ background: app.bg }} onClick={() => app.openDialog('color', { value: app.bg, onPick: (c: string) => { app.bg = c; app.emit(); } })} aria-label="Background colour" />
        <button className="mini swap" title="Swap colours (X)" onClick={() => app.swapColors()}><ArrowLeftRight size={11} /></button>
        <button className="mini reset" title="Default colours (D)" onClick={() => app.resetColors()}><RotateCcw size={11} /></button>
      </div>
      <button className={'tool qm' + (d?.quickMask ? ' on' : '')} title="Quick Mask mode (Q)" onClick={() => run('quickMask')}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="12" cy="12" r="4" fill={d?.quickMask ? 'currentColor' : 'none'} /></svg>
      </button>
      <button className="tool" title="Change screen mode (F)" onClick={() => { const m = ['standard', 'full-menu', 'full'] as const; app.view.screenMode = m[(m.indexOf(app.view.screenMode) + 1) % 3]; app.emit(); }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="16" rx="2" /><rect x="7" y="8" width="10" height="8" /></svg>
      </button>
    </div>
  );
}
