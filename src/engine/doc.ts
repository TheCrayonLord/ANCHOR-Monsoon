// Document model with copy-on-write history: snapshots share canvases until a layer is edited.
import { Canvas, cloneCanvas, ctx2d, makeCanvas, uid, Rect } from './util';
import type { DocState, HistoryState, Layer, LayerKind, Mask } from './types';

const frozen = new WeakSet<Canvas>();
let histId = 1;

export function newLayer(kind: LayerKind, name: string, extra: Partial<Layer> = {}): Layer {
  return {
    id: uid('L'), name, kind, visible: true, opacity: 1, fillOpacity: 1, blend: kind === 'group' ? 'pass-through' : 'normal',
    locks: { pixels: false, position: false, transparency: false, all: false }, clip: false, x: 0, y: 0, ver: 1,
    ...(kind === 'group' ? { children: [] } : {}), ...extra,
  };
}

function cloneLayer(l: Layer): Layer {
  const c: Layer = { ...l, locks: { ...l.locks } };
  if (l.mask) c.mask = { ...l.mask };
  if (l.styles) c.styles = JSON.parse(JSON.stringify(l.styles));
  if (l.text) c.text = JSON.parse(JSON.stringify(l.text));
  if (l.shape) c.shape = JSON.parse(JSON.stringify(l.shape));
  if (l.fill) c.fill = JSON.parse(JSON.stringify(l.fill));
  if (l.adj) c.adj = JSON.parse(JSON.stringify(l.adj));
  if (l.smart) c.smart = { ...l.smart, quad: l.smart.quad.map((p) => ({ ...p })) as any, filters: l.smart.filters.map((f) => ({ ...f, params: JSON.parse(JSON.stringify(f.params)) })) };
  if (l.children) c.children = l.children.map(cloneLayer);
  return c;
}
function freezeLayer(l: Layer) {
  if (l.canvas) frozen.add(l.canvas);
  if (l.mask) frozen.add(l.mask.canvas);
  if (l.smart) frozen.add(l.smart.source);
  l.children?.forEach(freezeLayer);
}
export function cloneState(s: DocState): DocState {
  return {
    ...s, layers: s.layers.map(cloneLayer), selectedIds: [...s.selectedIds],
    paths: s.paths.map((p) => ({ ...p, path: JSON.parse(JSON.stringify(p.path)) })), channels: s.channels.map((c) => ({ ...c })),
    guides: s.guides.map((g) => ({ ...g })), notes: s.notes.map((n) => ({ ...n })), samplers: s.samplers.map((p) => ({ ...p })), counts: s.counts.map((p) => ({ ...p })),
    comps: JSON.parse(JSON.stringify(s.comps)),
  };
}
function freezeState(s: DocState) {
  s.layers.forEach(freezeLayer);
  if (s.selection) frozen.add(s.selection);
  s.channels.forEach((c) => frozen.add(c.canvas));
}
export const isFrozen = (c: Canvas) => frozen.has(c);
export function own(c: Canvas): Canvas { return frozen.has(c) ? cloneCanvas(c) : c; }

export function walk(layers: Layer[], fn: (l: Layer, parent: Layer[] , i: number) => void | boolean) {
  for (let i = 0; i < layers.length; i++) {
    if (fn(layers[i], layers, i) === false) return false;
    const ch = layers[i].children;
    if (ch && walk(ch, fn) === false) return false;
  }
  return true;
}
export function flatLayers(layers: Layer[]): Layer[] { const out: Layer[] = []; walk(layers, (l) => { out.push(l); }); return out; }

export class Doc {
  id = uid('D');
  name: string;
  s: DocState;
  history: HistoryState[] = [];
  hIndex = 0;
  snapshots: HistoryState[] = [];
  dirty = false;
  fileHandle: any = null;
  // view state
  zoom = 1; panX = 0; panY = 0; rotation = 0;
  // for re-select
  lastSelection: Canvas | null = null;
  version = 0; // bumps on every change, used by the view
  dirtyRect: Rect | null = null;
  quickMask = false;
  maxHistory = 50;

  constructor(name: string, w: number, h: number, init?: (d: Doc) => void) {
    this.name = name;
    this.s = {
      width: w, height: h, layers: [], activeId: null, selectedIds: [], selection: null, paths: [], channels: [],
      guides: [], notes: [], samplers: [], counts: [], mode: 'rgb', resolution: 72, comps: [],
    };
    if (init) init(this);
    this.history = [{ id: histId++, label: 'Open', state: this.snapshot() }];
    this.hIndex = 0;
  }
  get w() { return this.s.width; }
  get h() { return this.s.height; }
  get layers() { return this.s.layers; }

  snapshot(): DocState { freezeState(this.s); return cloneState(this.s); }

  /** Record the current state as a history step. */
  commit(label: string) {
    this.history = this.history.slice(0, this.hIndex + 1);
    this.history.push({ id: histId++, label, state: this.snapshot() });
    if (this.history.length > this.maxHistory) this.history.splice(0, this.history.length - this.maxHistory);
    this.hIndex = this.history.length - 1;
    this.dirty = true;
    this.touch();
  }
  goto(i: number) {
    if (i < 0 || i >= this.history.length) return;
    this.hIndex = i;
    this.s = cloneState(this.history[i].state);
    this.touch();
  }
  undo() { this.goto(this.hIndex - 1); }
  redo() { this.goto(this.hIndex + 1); }
  takeSnapshot(name?: string) {
    this.snapshots.push({ id: histId++, label: name || `Snapshot ${this.snapshots.length + 1}`, state: this.snapshot() });
    this.touch();
  }
  restoreSnapshot(h: HistoryState) { this.s = cloneState(h.state); this.commit(h.label); }

  full = true;
  touch(r?: Rect | null) {
    this.version++;
    if (!r) { this.full = true; this.dirtyRect = null; }
    else if (!this.full) this.dirtyRect = this.dirtyRect ? { x: Math.min(this.dirtyRect.x, r.x), y: Math.min(this.dirtyRect.y, r.y), w: Math.max(this.dirtyRect.x + this.dirtyRect.w, r.x + r.w) - Math.min(this.dirtyRect.x, r.x), h: Math.max(this.dirtyRect.y + this.dirtyRect.h, r.y + r.h) - Math.min(this.dirtyRect.y, r.y) } : r;
  }

  // ---- layer lookup ----
  find(id: string | null): Layer | null {
    if (!id) return null;
    let f: Layer | null = null;
    walk(this.s.layers, (l) => { if (l.id === id) { f = l; return false; } });
    return f;
  }
  parentOf(id: string): { list: Layer[]; index: number; parent: Layer | null } | null {
    const search = (list: Layer[], parent: Layer | null): any => {
      for (let i = 0; i < list.length; i++) {
        if (list[i].id === id) return { list, index: i, parent };
        if (list[i].children) { const r = search(list[i].children!, list[i]); if (r) return r; }
      }
      return null;
    };
    return search(this.s.layers, null);
  }
  get active(): Layer | null { return this.find(this.s.activeId); }
  setActive(id: string | null, additive = false) {
    this.s.activeId = id;
    if (!id) this.s.selectedIds = [];
    else if (additive) { if (!this.s.selectedIds.includes(id)) this.s.selectedIds.push(id); else this.s.selectedIds = this.s.selectedIds.filter((x) => x !== id); }
    else this.s.selectedIds = [id];
    this.touch();
  }
  selectedLayers(): Layer[] {
    const ids = this.s.selectedIds.length ? this.s.selectedIds : this.s.activeId ? [this.s.activeId] : [];
    return ids.map((i) => this.find(i)).filter(Boolean) as Layer[];
  }

  /** Insert above the active layer (or at top). */
  addLayer(l: Layer, above?: string | null) {
    const ref = above === undefined ? this.s.activeId : above;
    const p = ref ? this.parentOf(ref) : null;
    if (p) {
      p.list.splice(p.index + 1, 0, l);
    } else this.s.layers.push(l);
    this.setActive(l.id);
    return l;
  }
  removeLayer(id: string) {
    const p = this.parentOf(id); if (!p) return;
    p.list.splice(p.index, 1);
    const next = p.list[Math.max(0, p.index - 1)] || p.parent || flatLayers(this.s.layers).slice(-1)[0] || null;
    this.setActive(next ? next.id : null);
  }

  /** Make a layer's raster canvas writable and covering the document. */
  editable(l: Layer): Canvas {
    if (!l.canvas) { l.canvas = makeCanvas(this.w, this.h); l.x = 0; l.y = 0; }
    l.canvas = own(l.canvas);
    // grow so the whole document is covered
    const x0 = Math.min(l.x, 0), y0 = Math.min(l.y, 0);
    const x1 = Math.max(l.x + l.canvas.width, this.w), y1 = Math.max(l.y + l.canvas.height, this.h);
    if (x0 !== l.x || y0 !== l.y || x1 - x0 !== l.canvas.width || y1 - y0 !== l.canvas.height) {
      const c = makeCanvas(x1 - x0, y1 - y0);
      ctx2d(c).drawImage(l.canvas, l.x - x0, l.y - y0);
      l.canvas = c; l.x = x0; l.y = y0;
    }
    l.ver++;
    return l.canvas;
  }
  editableMask(l: Layer): Mask {
    if (!l.mask) throw new Error('no mask');
    l.mask.canvas = own(l.mask.canvas);
    const m = l.mask;
    const x0 = Math.min(m.x, 0), y0 = Math.min(m.y, 0);
    const x1 = Math.max(m.x + m.canvas.width, this.w), y1 = Math.max(m.y + m.canvas.height, this.h);
    if (x0 !== m.x || y0 !== m.y || x1 - x0 !== m.canvas.width || y1 - y0 !== m.canvas.height) {
      const c = makeCanvas(x1 - x0, y1 - y0); const x = ctx2d(c);
      x.fillStyle = m.bg ? '#fff' : '#000'; x.fillRect(0, 0, c.width, c.height);
      x.drawImage(m.canvas, m.x - x0, m.y - y0);
      m.canvas = c; m.x = x0; m.y = y0;
    }
    l.ver++;
    return m;
  }
  editableSelection(): Canvas {
    if (!this.s.selection) { const c = makeCanvas(this.w, this.h); const x = ctx2d(c); x.fillStyle = '#000'; x.fillRect(0, 0, this.w, this.h); this.s.selection = c; }
    this.s.selection = own(this.s.selection);
    return this.s.selection;
  }
  uniqueName(base: string) {
    const names = new Set(flatLayers(this.s.layers).map((l) => l.name));
    let n = 1; while (names.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  }
}
