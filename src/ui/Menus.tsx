// Menu bar and keyboard shortcuts.
import { useEffect, useState } from 'react';
import { app } from '../app';
import { run, commands, ADJ_TYPES } from '../cmds';
import { ADJ_LABELS } from '../engine/adjust';
import { FILTERS, FILTER_CATS } from '../engine/filterdefs';
import { startTransform, ts, commitTransform, cancelTransform, handlerFor, transformBy } from '../tools';
import { toolKey } from './Toolbar';

export interface MenuItem { label?: string; cmd?: string; args?: any; key?: string; sub?: MenuItem[]; sep?: boolean; check?: () => boolean; enabled?: () => boolean; act?: () => void }
const S: MenuItem = { sep: true };
const hasDoc = () => !!app.doc;
const hasSel = () => !!app.doc?.s.selection;

// commands that need the view or tools
const view = () => (window as any).__monsoonView;
commands.zoomIn = () => { const d = app.doc; if (d) view()?.setZoom(d.zoom * 1.25); return false; };
commands.zoomOut = () => { const d = app.doc; if (d) view()?.setZoom(d.zoom / 1.25); return false; };
commands.fit = () => { const d = app.doc; if (d) view()?.fitRect({ x: 0, y: 0, w: d.w, h: d.h }); return false; };
commands.fillScreen = () => { const d = app.doc; if (!d) return false; const el = document.querySelector('.viewport')!; const z = Math.max(el.clientWidth / d.w, el.clientHeight / d.h); d.zoom = z; d.panX = 0; d.panY = 0; d.rotation = 0; app.emit(); return false; };
commands.actual = () => { const d = app.doc; if (d) { d.zoom = 1; d.panX = 0; d.panY = 0; app.emit(); } return false; };
commands.zoom200 = () => { const d = app.doc; if (d) { d.zoom = 2; app.emit(); } return false; };
commands.freeTransform = (mode?: any) => { const d = app.doc; if (!d) return false; startTransform(d, mode || 'free'); return false; };
commands.transformSelection = () => { const d = app.doc; if (!d) return false; startTransform(d, 'free', 'selection'); return false; };
commands.transformQuick = (op: any) => { const d = app.doc; if (!d) return false; startTransform(d); setTimeout(() => { transformBy(d, op); commitTransform(d); }, 0); };
commands.dialog = (k: string) => { app.openDialog(k); return false; };
commands.screenMode = () => { const m = ['standard', 'full-menu', 'full'] as const; app.view.screenMode = m[(m.indexOf(app.view.screenMode) + 1) % 3]; app.emit(); return false; };
commands.panel = (k: string) => { app.panelsOpen[k] = !app.panelsOpen[k]; app.emit(); return false; };
commands.workspace = (k: string) => {
  const sets: Record<string, string[]> = { essentials: ['layers', 'properties', 'color', 'history'], photography: ['layers', 'properties', 'histogram', 'navigator', 'history', 'adjustments'], painting: ['brushes', 'color', 'swatches', 'layers', 'navigator'], graphic: ['layers', 'character', 'paragraph', 'properties', 'swatches', 'info'], motion: ['layers', 'actions', 'comps'] };
  app.panelsOpen = Object.fromEntries((sets[k] || sets.essentials).map((p) => [p, true])); app.emit(); return false;
};
commands.proof = (m: any) => { app.view.proof = app.view.proof === m ? 'none' : m; app.emit(); return false; };

const adjItems = (cmdPrefix: string): MenuItem[] => ADJ_TYPES.map((t) => ({ label: ADJ_LABELS[t] + (cmdPrefix === 'adj:' && t !== 'invert' && t !== 'desaturate' as any ? '…' : ''), cmd: cmdPrefix === 'adj:' ? 'adj:' + t : 'newAdjustment', args: cmdPrefix === 'adj:' ? undefined : t, key: { levels: 'Ctrl+L', curves: 'Ctrl+M', hsl: 'Ctrl+U', colorBalance: 'Ctrl+B', invert: 'Ctrl+I' }[t as string] && cmdPrefix === 'adj:' ? { levels: 'Ctrl+L', curves: 'Ctrl+M', hsl: 'Ctrl+U', colorBalance: 'Ctrl+B', invert: 'Ctrl+I' }[t as string] : undefined }));

export const MENUS: { label: string; items: MenuItem[] }[] = [
  { label: 'File', items: [
    { label: 'New…', act: () => app.openDialog('new'), key: 'Ctrl+N' }, { label: 'Open…', cmd: 'open', key: 'Ctrl+O' }, { label: 'Open Recent…', act: () => app.openDialog('recent') },
    S, { label: 'Close', cmd: 'close', key: 'Ctrl+W', enabled: hasDoc }, { label: 'Close All', cmd: 'closeAll', key: 'Ctrl+Alt+W', enabled: hasDoc },
    S, { label: 'Save', cmd: 'save', key: 'Ctrl+S', enabled: hasDoc }, { label: 'Save As…', act: () => app.openDialog('saveAs'), key: 'Ctrl+Shift+S', enabled: hasDoc }, { label: 'Revert', cmd: 'revert', key: 'F12', enabled: hasDoc },
    S, { label: 'Export', sub: [
      { label: 'Quick Export as PNG', cmd: 'quickExport', enabled: hasDoc }, { label: 'Export As…', act: () => app.openDialog('export'), key: 'Ctrl+Alt+Shift+W', enabled: hasDoc },
      { label: 'Layers to Files…', act: () => app.openDialog('exportLayers'), enabled: hasDoc }, { label: 'Artboards to Files', cmd: 'exportArtboards', enabled: hasDoc }, { label: 'Save for Web (Legacy)…', act: () => app.openDialog('export', { web: true }), key: 'Ctrl+Alt+Shift+S', enabled: hasDoc },
    ] },
    { label: 'Place Embedded…', cmd: 'place', enabled: hasDoc },
    { label: 'Automate', sub: [{ label: 'Batch…', act: () => app.openDialog('batch') }] },
    S, { label: 'File Info…', act: () => app.openDialog('fileInfo'), key: 'Ctrl+Alt+Shift+I', enabled: hasDoc }, { label: 'Print…', cmd: 'print', key: 'Ctrl+P', enabled: hasDoc },
  ] },
  { label: 'Edit', items: [
    { label: 'Undo', cmd: 'undo', key: 'Ctrl+Z', enabled: () => !!app.doc && app.doc.hIndex > 0 }, { label: 'Redo', cmd: 'redo', key: 'Ctrl+Shift+Z', enabled: () => !!app.doc && app.doc.hIndex < app.doc.history.length - 1 },
    { label: 'Fade…', act: () => app.openDialog('fade'), key: 'Ctrl+Shift+F', enabled: () => !!app.doc && app.doc.hIndex > 0 },
    S, { label: 'Cut', cmd: 'cut', key: 'Ctrl+X', enabled: hasDoc }, { label: 'Copy', cmd: 'copy', key: 'Ctrl+C', enabled: hasDoc }, { label: 'Copy Merged', cmd: 'copyMerged', key: 'Ctrl+Shift+C', enabled: hasDoc },
    { label: 'Paste', cmd: 'paste', key: 'Ctrl+V' }, { label: 'Paste Special', sub: [{ label: 'Paste in Place', cmd: 'paste', args: 'inplace', key: 'Ctrl+Shift+V' }, { label: 'Paste Into', cmd: 'paste', args: 'into', key: 'Ctrl+Alt+Shift+V', enabled: hasSel }] },
    { label: 'Clear', cmd: 'clear', key: 'Delete', enabled: hasDoc },
    S, { label: 'Fill…', act: () => app.openDialog('fill'), key: 'Shift+F5', enabled: hasDoc }, { label: 'Stroke…', act: () => app.openDialog('stroke'), enabled: hasSel }, { label: 'Content-Aware Fill', cmd: 'contentAwareFill', enabled: hasSel },
    S, { label: 'Free Transform', cmd: 'freeTransform', key: 'Ctrl+T', enabled: hasDoc },
    { label: 'Transform', sub: [
      { label: 'Scale', cmd: 'freeTransform' }, { label: 'Skew', cmd: 'freeTransform', args: 'skew' }, { label: 'Distort', cmd: 'freeTransform', args: 'distort' }, { label: 'Perspective', cmd: 'freeTransform', args: 'perspective' }, { label: 'Warp', cmd: 'freeTransform', args: 'warp' },
      S, { label: 'Rotate 180°', cmd: 'transformQuick', args: 'rot180' }, { label: 'Rotate 90° Clockwise', cmd: 'transformQuick', args: 'rot90' }, { label: 'Rotate 90° Counter Clockwise', cmd: 'transformQuick', args: 'rot-90' },
      S, { label: 'Flip Horizontal', cmd: 'transformQuick', args: 'flipH' }, { label: 'Flip Vertical', cmd: 'transformQuick', args: 'flipV' },
    ] },
    { label: 'Puppet Warp / Perspective Warp', act: () => app.toast('Puppet Warp and Perspective Warp are not available yet. Use Edit > Transform > Warp.') },
    S, { label: 'Define Brush Preset…', cmd: 'defineBrush', enabled: hasDoc }, { label: 'Define Pattern…', cmd: 'definePattern', enabled: hasDoc },
    { label: 'Purge History', cmd: 'purge', enabled: hasDoc },
    S, { label: 'Keyboard Shortcuts…', act: () => app.openDialog('shortcuts'), key: 'Ctrl+Alt+Shift+K' }, { label: 'Preferences…', act: () => app.openDialog('prefs'), key: 'Ctrl+K' },
  ] },
  { label: 'Image', items: [
    { label: 'Mode', sub: [
      { label: 'Bitmap', cmd: 'mode', args: 'bitmap', check: () => app.doc?.s.mode === 'bitmap' }, { label: 'Grayscale', cmd: 'mode', args: 'grayscale', check: () => app.doc?.s.mode === 'grayscale' },
      { label: 'Duotone…', cmd: 'mode', args: 'duotone' }, { label: 'Indexed Color…', act: () => app.openDialog('indexed'), check: () => app.doc?.s.mode === 'indexed' },
      { label: 'RGB Color', cmd: 'mode', args: 'rgb', check: () => app.doc?.s.mode === 'rgb' },
    ] },
    { label: 'Adjustments', sub: [...adjItems('adj:'), S, { label: 'Shadows/Highlights…', cmd: 'filter', args: { id: 'shadowshl' } }, { label: 'HDR Toning…', cmd: 'filter', args: { id: 'hdr' } }, S, { label: 'Desaturate', cmd: 'desaturate', key: 'Ctrl+Shift+U' }, { label: 'Replace Color…', act: () => app.openDialog('replaceColor') }, { label: 'Equalize', cmd: 'equalize' }] },
    S, { label: 'Auto Tone', cmd: 'autoTone', key: 'Ctrl+Shift+L' }, { label: 'Auto Contrast', cmd: 'autoContrast', key: 'Ctrl+Alt+Shift+L' }, { label: 'Auto Color', cmd: 'autoColor', key: 'Ctrl+Shift+B' },
    S, { label: 'Image Size…', act: () => app.openDialog('imageSize'), key: 'Ctrl+Alt+I', enabled: hasDoc }, { label: 'Canvas Size…', act: () => app.openDialog('canvasSize'), key: 'Ctrl+Alt+C', enabled: hasDoc },
    { label: 'Image Rotation', sub: [
      { label: '180°', cmd: 'rotateCanvas', args: { deg: 180 } }, { label: '90° Clockwise', cmd: 'rotateCanvas', args: { deg: 90 } }, { label: '90° Counter Clockwise', cmd: 'rotateCanvas', args: { deg: -90 } },
      { label: 'Arbitrary…', act: () => app.openDialog('rotate') }, S, { label: 'Flip Canvas Horizontal', cmd: 'rotateCanvas', args: { flipH: true } }, { label: 'Flip Canvas Vertical', cmd: 'rotateCanvas', args: { flipV: true } },
    ] },
    { label: 'Crop', cmd: 'crop', enabled: hasSel }, { label: 'Trim…', act: () => app.openDialog('trim'), enabled: hasDoc }, { label: 'Reveal All', cmd: 'revealAll', enabled: hasDoc },
    S, { label: 'Duplicate…', cmd: 'duplicateDoc', enabled: hasDoc },
  ] },
  { label: 'Layer', items: [
    { label: 'New', sub: [{ label: 'Layer…', cmd: 'newLayer', key: 'Ctrl+Shift+N' }, { label: 'Group', cmd: 'newGroup' }, { label: 'Artboard', cmd: 'newArtboard' }, { label: 'Artboard from Layers', cmd: 'artboardFromLayers' }, S, { label: 'Layer via Copy', cmd: 'layerViaCopy', key: 'Ctrl+J' }, { label: 'Layer via Cut', cmd: 'layerViaCopy', args: true, key: 'Ctrl+Shift+J' }] },
    { label: 'Duplicate Layer', cmd: 'duplicateLayer', enabled: hasDoc }, { label: 'Delete Layer', cmd: 'deleteLayer', enabled: hasDoc },
    S, { label: 'Layer Style', sub: [{ label: 'Blending Options…', act: () => app.openDialog('layerStyle') }, S, { label: 'Copy Layer Style', cmd: 'copyStyle' }, { label: 'Paste Layer Style', cmd: 'pasteStyle' }, { label: 'Clear Layer Style', cmd: 'clearStyle' }] },
    { label: 'New Fill Layer', sub: [{ label: 'Solid Color…', cmd: 'newFill', args: { type: 'color' } }, { label: 'Gradient…', cmd: 'newFill', args: { type: 'gradient' } }, { label: 'Pattern…', cmd: 'newFill', args: { type: 'pattern' } }] },
    { label: 'New Adjustment Layer', sub: adjItems('new') },
    S, { label: 'Vector Mask', sub: [{ label: 'Reveal All', cmd: 'vectorMask', args: 'reveal' }, { label: 'From Current Path', cmd: 'vectorMask', args: 'fromPath' }, { label: 'Disable / Enable', cmd: 'vectorMask', args: 'toggle' }, { label: 'Rasterize to Layer Mask', cmd: 'vectorMask', args: 'rasterize' }, { label: 'Delete', cmd: 'vectorMask', args: 'delete' }] },
    { label: 'Layer Mask', sub: [{ label: 'Reveal All', cmd: 'mask', args: 'reveal' }, { label: 'Hide All', cmd: 'mask', args: 'hide' }, { label: 'Reveal Selection', cmd: 'mask', args: 'revealSel', enabled: hasSel }, { label: 'Hide Selection', cmd: 'mask', args: 'hideSel', enabled: hasSel }, S, { label: 'Delete', cmd: 'mask', args: 'delete' }, { label: 'Apply', cmd: 'mask', args: 'apply' }, { label: 'Disable / Enable', cmd: 'mask', args: 'toggle' }, { label: 'Invert', cmd: 'mask', args: 'invert' }, { label: 'Unlink / Link', cmd: 'mask', args: 'link' }] },
    { label: 'Create Clipping Mask', cmd: 'clip', key: 'Ctrl+Alt+G', enabled: hasDoc },
    S, { label: 'Smart Objects', sub: [{ label: 'Convert to Smart Object', cmd: 'toSmart' }, { label: 'Edit Contents', cmd: 'editSmart' }, { label: 'Update Parent from Contents', cmd: 'updateSmartParent' }, { label: 'Replace Contents…', cmd: 'replaceSmart' }, { label: 'Rasterize', cmd: 'rasterize' }] },
    { label: 'Rasterize', sub: [{ label: 'Layer', cmd: 'rasterize' }, { label: 'Layer Style', cmd: 'rasterize', args: 'style' }] },
    S, { label: 'Group Layers', cmd: 'groupLayers', key: 'Ctrl+G', enabled: hasDoc }, { label: 'Ungroup Layers', cmd: 'ungroup', key: 'Ctrl+Shift+G', enabled: hasDoc },
    { label: 'Arrange', sub: [{ label: 'Bring to Front', cmd: 'arrange', args: 'front', key: 'Ctrl+Shift+]' }, { label: 'Bring Forward', cmd: 'arrange', args: 'forward', key: 'Ctrl+]' }, { label: 'Send Backward', cmd: 'arrange', args: 'backward', key: 'Ctrl+[' }, { label: 'Send to Back', cmd: 'arrange', args: 'back', key: 'Ctrl+Shift+[' }] },
    { label: 'Align', sub: [{ label: 'Left Edges', cmd: 'align', args: 'left' }, { label: 'Horizontal Centers', cmd: 'align', args: 'hcenter' }, { label: 'Right Edges', cmd: 'align', args: 'right' }, S, { label: 'Top Edges', cmd: 'align', args: 'top' }, { label: 'Vertical Centers', cmd: 'align', args: 'vcenter' }, { label: 'Bottom Edges', cmd: 'align', args: 'bottom' }] },
    { label: 'Distribute', sub: [{ label: 'Horizontal Centers', cmd: 'align', args: 'dist-h' }, { label: 'Vertical Centers', cmd: 'align', args: 'dist-v' }] },
    { label: 'Lock Layers', cmd: 'lockAll', key: 'Ctrl+/' }, { label: 'Link Layers', cmd: 'linkLayers' },
    S, { label: 'Merge Down / Merge Layers', cmd: 'mergeSelected', key: 'Ctrl+E', enabled: hasDoc }, { label: 'Merge Visible', cmd: 'mergeVisible', key: 'Ctrl+Shift+E', enabled: hasDoc }, { label: 'Stamp Visible', cmd: 'stampVisible', key: 'Ctrl+Alt+Shift+E', enabled: hasDoc }, { label: 'Flatten Image', cmd: 'flatten', enabled: hasDoc },
  ] },
  { label: 'Type', items: [
    { label: 'Character Panel', cmd: 'panel', args: 'character' }, { label: 'Paragraph Panel', cmd: 'panel', args: 'paragraph' },
    S, { label: 'Warp Text…', act: () => app.openDialog('warpText') }, { label: 'Rasterize Type Layer', cmd: 'rasterize' },
    { label: 'Orientation', sub: [{ label: 'Horizontal', act: () => setText({ vertical: false }) }, { label: 'Vertical', act: () => setText({ vertical: true }) }] },
    { label: 'Anti-Alias', sub: [{ label: 'None', act: () => setText({ antialias: false }) }, { label: 'Smooth', act: () => setText({ antialias: true }) }] },
  ] },
  { label: 'Select', items: [
    { label: 'All', cmd: 'selectAll', key: 'Ctrl+A', enabled: hasDoc }, { label: 'Deselect', cmd: 'deselect', key: 'Ctrl+D', enabled: hasSel }, { label: 'Reselect', cmd: 'reselect', key: 'Ctrl+Shift+D', enabled: hasDoc }, { label: 'Inverse', cmd: 'inverse', key: 'Ctrl+Shift+I', enabled: hasDoc },
    S, { label: 'All Layers', cmd: 'selectAllLayers', key: 'Ctrl+Alt+A', enabled: hasDoc }, { label: 'Load Layer Transparency', cmd: 'selectLayerPixels', enabled: hasDoc },
    S, { label: 'Color Range…', act: () => app.openDialog('colorRange'), enabled: hasDoc }, { label: 'Subject', cmd: 'selectSubject', enabled: hasDoc }, { label: 'Sky', cmd: 'selectSky', enabled: hasDoc },
    { label: 'Select and Mask…', act: () => app.openDialog('selectMask'), key: 'Ctrl+Alt+R', enabled: hasSel },
    { label: 'Modify', sub: (['border', 'smooth', 'expand', 'contract', 'feather'] as const).map((op) => ({ label: op[0].toUpperCase() + op.slice(1) + '…', act: () => app.openDialog('modify', { op }), key: op === 'feather' ? 'Shift+F6' : undefined, enabled: hasSel })) },
    { label: 'Grow', cmd: 'grow', enabled: hasSel }, { label: 'Similar', cmd: 'grow', args: true, enabled: hasSel },
    S, { label: 'Transform Selection', cmd: 'transformSelection', enabled: hasSel }, { label: 'Edit in Quick Mask Mode', cmd: 'quickMask', check: () => !!app.doc?.quickMask, enabled: hasDoc },
    S, { label: 'Load Selection…', act: () => app.openDialog('loadSelection'), enabled: () => !!app.doc?.s.channels.length }, { label: 'Save Selection…', act: () => { const n = prompt('Channel name', 'Alpha ' + ((app.doc?.s.channels.length || 0) + 1)); if (n) run('saveSelection', n); }, enabled: hasSel },
  ] },
  { label: 'Filter', items: [
    { label: 'Last Filter', cmd: 'lastFilter', key: 'Ctrl+Alt+F', enabled: () => !!app.lastFilter },
    S, { label: 'Convert for Smart Filters', cmd: 'toSmart', enabled: hasDoc },
    S, { label: 'Filter Gallery…', act: () => app.openDialog('filter', { id: 'oil', gallery: true }) }, { label: 'Camera Raw Filter…', act: () => app.openDialog('cameraRaw'), key: 'Ctrl+Shift+A' }, { label: 'Lens Correction…', act: () => app.openDialog('lens'), key: 'Ctrl+Shift+R' }, { label: 'Liquify…', act: () => app.openDialog('liquify'), key: 'Ctrl+Shift+X' },
    S, ...FILTER_CATS.map((c) => ({ label: c, sub: FILTERS.filter((f) => f.cat === c).map((f) => ({ label: f.name + (f.params.length ? '…' : ''), cmd: 'filter', args: { id: f.id }, enabled: hasDoc })) })),
  ] },
  { label: 'View', items: [
    { label: 'Proof Colors', sub: [{ label: 'Grayscale', cmd: 'proof', args: 'grayscale', check: () => app.view.proof === 'grayscale' }, { label: 'Working CMYK (simulated)', cmd: 'proof', args: 'cmyk', check: () => app.view.proof === 'cmyk' }, { label: 'Color Blindness (Deuteranopia)', cmd: 'proof', args: 'deuteranopia', check: () => app.view.proof === 'deuteranopia' }] },
    S, { label: 'Zoom In', cmd: 'zoomIn', key: 'Ctrl+=' }, { label: 'Zoom Out', cmd: 'zoomOut', key: 'Ctrl+-' }, { label: 'Fit on Screen', cmd: 'fit', key: 'Ctrl+0' }, { label: 'Fill Screen', cmd: 'fillScreen' }, { label: '100%', cmd: 'actual', key: 'Ctrl+1' }, { label: '200%', cmd: 'zoom200' },
    S, { label: 'Screen Mode', cmd: 'screenMode', key: 'F' },
    { label: 'Extras', cmd: 'toggle', args: 'extras', check: () => app.view.extras, key: 'Ctrl+H' },
    { label: 'Show', sub: [{ label: 'Selection Edges', cmd: 'toggle', args: 'showSelection', check: () => app.view.showSelection }, { label: 'Grid', cmd: 'toggle', args: 'grid', check: () => app.view.grid, key: "Ctrl+'" }, { label: 'Guides', cmd: 'toggle', args: 'guides', check: () => app.view.guides, key: 'Ctrl+;' }, { label: 'Pixel Grid', cmd: 'toggle', args: 'pixelGrid', check: () => app.view.pixelGrid }] },
    { label: 'Rulers', cmd: 'toggle', args: 'rulers', check: () => app.view.rulers, key: 'Ctrl+R' },
    { label: 'Snap', cmd: 'toggle', args: 'snap', check: () => app.view.snap, key: 'Ctrl+Shift+;' },
    S, { label: 'Lock Guides', cmd: 'toggle', args: 'lockGuides', check: () => app.view.lockGuides }, { label: 'Clear Guides', cmd: 'clearGuides', enabled: hasDoc }, { label: 'New Guide…', act: () => app.openDialog('newGuide'), enabled: hasDoc }, { label: 'New Guide Layout…', act: () => app.openDialog('guideLayout'), enabled: hasDoc },
  ] },
  { label: 'Window', items: [
    { label: 'Workspace', sub: [{ label: 'Essentials', cmd: 'workspace', args: 'essentials' }, { label: 'Photography', cmd: 'workspace', args: 'photography' }, { label: 'Painting', cmd: 'workspace', args: 'painting' }, { label: 'Graphic and Web', cmd: 'workspace', args: 'graphic' }, { label: 'Automation', cmd: 'workspace', args: 'motion' }] },
    S, ...([['actions', 'Actions'], ['adjustments', 'Adjustments'], ['brushes', 'Brushes'], ['channels', 'Channels'], ['character', 'Character'], ['color', 'Color'], ['comps', 'Layer Comps'], ['gradients', 'Gradients'], ['histogram', 'Histogram'], ['history', 'History'], ['info', 'Info'], ['layers', 'Layers'], ['navigator', 'Navigator'], ['paragraph', 'Paragraph'], ['paths', 'Paths'], ['patterns', 'Patterns'], ['properties', 'Properties'], ['shapes', 'Shapes'], ['styles', 'Styles'], ['swatches', 'Swatches']] as [string, string][]).map(([k, l]) => ({ label: l, cmd: 'panel', args: k, check: () => !!app.panelsOpen[k], key: ({ layers: 'F7', brushes: 'F5', color: 'F6', info: 'F8', actions: 'Alt+F9' } as Record<string, string>)[k] })),
  ] },
  { label: 'Help', items: [{ label: 'Keyboard Shortcuts', act: () => app.openDialog('shortcuts') }, { label: 'What Monsoon can do', act: () => app.openDialog('about', { tab: 'features' }) }, { label: 'About ANCHOR Monsoon', act: () => app.openDialog('about') }] },
];
function setText(p: any) { const d = app.doc, l = d?.active; if (!d || !l?.text) return; Object.assign(l.text, p); l.ver++; d.commit('Edit Type'); app.emit(); }

export function exec(it: MenuItem) { if (it.act) it.act(); else if (it.cmd) run(it.cmd, it.args, it.label); }

function MenuList({ items, onDone }: { items: MenuItem[]; onDone: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="menu-list">
      {items.map((it, i) => it.sep ? <div key={i} className="menu-sep" /> : (
        <div key={i} className={'menu-item' + (it.enabled && !it.enabled() ? ' disabled' : '') + (it.sub ? ' has-sub' : '')}
          onPointerEnter={() => setOpen(it.sub ? i : null)}
          onClick={(e) => { e.stopPropagation(); if (it.sub) { setOpen(open === i ? null : i); return; } if (it.enabled && !it.enabled()) return; onDone(); exec(it); }}>
          <span className="mi-check">{it.check?.() ? '✓' : ''}</span>
          <span className="mi-label">{it.label}</span>
          {it.key && <kbd>{it.key.replace(/Ctrl/g, isMac ? '⌘' : 'Ctrl').replace(/Alt/g, isMac ? '⌥' : 'Alt').replace(/Shift\+/g, isMac ? '⇧' : 'Shift+')}</kbd>}
          {it.sub && <span className="mi-arrow">▸</span>}
          {it.sub && open === i && <div className="submenu"><MenuList items={it.sub} onDone={onDone} /></div>}
        </div>
      ))}
    </div>
  );
}
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

export function MenuBar() {
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { if (open === null) return; const f = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest('.menubar')) setOpen(null); }; window.addEventListener('pointerdown', f); return () => window.removeEventListener('pointerdown', f); }, [open]);
  return (
    <nav className="menubar">
      <div className="brand" title="ANCHOR Monsoon"><img src="./icon.svg" alt="" width={20} height={20} /><span>Monsoon</span></div>
      {MENUS.map((m, i) => (
        <div key={m.label} className={'menu' + (open === i ? ' open' : '')} onPointerEnter={() => open !== null && setOpen(i)}>
          <button className="menu-title" onClick={() => setOpen(open === i ? null : i)}>{m.label}</button>
          {open === i && <div className="menu-drop"><MenuList items={m.items} onDone={() => setOpen(null)} /></div>}
        </div>
      ))}
    </nav>
  );
}

// ---- keyboard ----
function keyString(e: KeyboardEvent) {
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [(e.ctrlKey || e.metaKey) && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', k === '+' ? '=' : k === '_' ? '-' : k === '{' ? '[' : k === '}' ? ']' : k === ':' ? ';' : k === '"' ? "'" : k].filter(Boolean).join('+');
}
const keymap = new Map<string, MenuItem>();
function index(items: MenuItem[]) { for (const it of items) { if (it.key) keymap.set(it.key, it); if (it.sub) index(it.sub); } }
MENUS.forEach((m) => index(m.items));
keymap.set('Ctrl+Z', { cmd: 'undo' }); keymap.set('Ctrl+Alt+Z', { cmd: 'undo' }); keymap.set('Ctrl+Y', { cmd: 'redo' }); keymap.set('Backspace', { cmd: 'clear', enabled: hasDoc });
keymap.set('Ctrl+Shift+=', { cmd: 'zoomIn' }); keymap.set('Ctrl+Shift+Alt+N', { cmd: 'newLayer' });

export function handleKey(e: KeyboardEvent) {
  const tgt = e.target as HTMLElement;
  if (tgt.closest('input, textarea, select, [contenteditable]')) return;
  if (app.dialog) { if (e.key === 'Escape') app.closeDialog(); return; }
  const d = app.doc;
  // tool-specific keys first (Enter/Escape for crop, transform, pen…)
  if (d) { const h = handlerFor(app.tool); if (h.key?.(d, e, (window as any).__monsoonView)) { e.preventDefault(); app.emit(); return; } }
  if (ts.transform && d) { if (e.key === 'Enter') { commitTransform(d); e.preventDefault(); return; } if (e.key === 'Escape') { cancelTransform(d); e.preventDefault(); return; } }
  const ks = keyString(e);
  const it = keymap.get(ks);
  if (it) { e.preventDefault(); if (!it.enabled || it.enabled()) exec(it); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (k === 'x' || k === 'X') { app.swapColors(); return; }
  if (k === 'd' || k === 'D') { app.resetColors(); return; }
  if (k === 'q' || k === 'Q') { run('quickMask'); return; }
  if (k === 'f' || k === 'F') { run('screenMode'); return; }
  if (k === 'Tab') { e.preventDefault(); app.view.screenMode = app.view.screenMode === 'full' ? 'standard' : 'full'; app.emit(); return; }
  if (k === '[' || k === ']') { const b = app.tool === 'eraser' ? app.eraserBrush : app.brush; const step = b.size < 10 ? 1 : b.size < 50 ? 5 : b.size < 200 ? 10 : 50; if (e.shiftKey) b.hardness = Math.max(0, Math.min(1, b.hardness + (k === ']' ? 0.25 : -0.25))); else b.size = Math.max(1, Math.min(1000, b.size + (k === ']' ? step : -step))); app.emit(); return; }
  if (k === '{' || k === '}') { app.brush.hardness = Math.max(0, Math.min(1, app.brush.hardness + (k === '}' ? 0.25 : -0.25))); app.emit(); return; }
  if (/^[0-9]$/.test(k) && d) { const v = k === '0' ? 1 : +k / 10; const b = app.tool === 'eraser' ? app.eraserBrush : app.brush; if (['brush', 'pencil', 'eraser', 'clone', 'history-brush', 'mixer'].includes(app.tool)) b.opacity = v; else { const l = d.active; if (l) { l.opacity = v; l.ver++; d.commit('Opacity'); } } app.emit(); return; }
  if (k.length === 1 && toolKey(k, e.shiftKey)) { e.preventDefault(); return; }
}
