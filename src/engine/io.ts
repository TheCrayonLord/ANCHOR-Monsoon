// Opening and saving: native .monsoon, PSD, common image formats, PDF, GIF, BMP, TIFF; recovery storage.
import JSZip from 'jszip';
import { readPsd, writePsd, type Layer as PsdLayer, type Psd } from 'ag-psd';
import { Doc, newLayer, walk } from './doc';
import type { BlendMode, Layer, DocState } from './types';
import { Canvas, canvasToBlob, ctx2d, imageToCanvas, makeCanvas } from './util';
import { flatten, renderLayerAlone } from './render';

export const OPEN_ACCEPT = '.monsoon,.psd,.psb,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff,.heic,.heif,.avif,.svg,.ico';

async function blobToCanvas(blob: Blob): Promise<Canvas> {
  try { const bmp = await createImageBitmap(blob); const c = imageToCanvas(bmp); bmp.close(); return c; }
  catch {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const c = makeCanvas(img.naturalWidth || 1024, img.naturalHeight || 1024); ctx2d(c).drawImage(img, 0, 0, c.width, c.height); return c;
    } finally { URL.revokeObjectURL(url); }
  }
}
export async function fileToCanvas(file: File | Blob, name = (file as File).name || ''): Promise<Canvas> {
  const ext = name.split('.').pop()!.toLowerCase();
  if (ext === 'tif' || ext === 'tiff') {
    const UTIF = (await import('utif')).default || (await import('utif'));
    const buf = await file.arrayBuffer(); const ifds = UTIF.decode(buf); UTIF.decodeImage(buf, ifds[0]);
    const rgba = UTIF.toRGBA8(ifds[0]); const c = makeCanvas(ifds[0].width, ifds[0].height);
    ctx2d(c).putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer), ifds[0].width, ifds[0].height), 0, 0); return c;
  }
  if (ext === 'heic' || ext === 'heif') {
    try { return await blobToCanvas(file); } catch { /* not natively supported */ }
    const heic2any = (await import('heic2any')).default; const out = await heic2any({ blob: file, toType: 'image/png' });
    return blobToCanvas(Array.isArray(out) ? out[0] : out);
  }
  if (ext === 'psd' || ext === 'psb') { const d = await openPsd(await file.arrayBuffer(), name); return flatten(d); }
  return blobToCanvas(file);
}

export async function openFile(file: File): Promise<Doc> {
  const name = file.name.replace(/\.[^.]+$/, '');
  const ext = file.name.split('.').pop()!.toLowerCase();
  if (ext === 'monsoon') return openNative(await file.arrayBuffer(), name);
  if (ext === 'psd' || ext === 'psb') return openPsd(await file.arrayBuffer(), name);
  const c = await fileToCanvas(file, file.name);
  return docFromCanvas(name, c, 'Background');
}
export function docFromCanvas(name: string, c: Canvas, layerName = 'Background'): Doc {
  return new Doc(name, c.width, c.height, (d) => {
    const l = newLayer('raster', layerName, { canvas: c });
    if (layerName === 'Background') l.locks = { pixels: false, position: true, transparency: true, all: false };
    d.s.layers.push(l); d.s.activeId = l.id; d.s.selectedIds = [l.id];
  });
}

// ---------- PSD ----------
const toBlend = (m?: string): BlendMode => { const b = (m || 'normal').replace(/ /g, '-') as BlendMode; return b === ('pass-through' as BlendMode) ? 'pass-through' : b; };
const fromBlend = (m: BlendMode): any => m.replace(/-/g, ' ');
export function openPsd(buf: ArrayBuffer, name: string): Doc {
  const psd = readPsd(buf, { skipThumbnail: true });
  const conv = (pl: PsdLayer): Layer => {
    if (pl.children) {
      const g = newLayer('group', pl.name || 'Group');
      g.children = pl.children.map(conv); g.visible = !pl.hidden; g.opacity = pl.opacity ?? 1; g.blend = toBlend(pl.blendMode); g.collapsed = !pl.opened;
      return g;
    }
    const l = newLayer('raster', pl.name || 'Layer');
    l.visible = !pl.hidden; l.opacity = pl.opacity ?? 1; l.blend = toBlend(pl.blendMode); l.clip = !!pl.clipping;
    l.fillOpacity = (pl as any).fillOpacity ?? 1;
    if (pl.canvas) { l.canvas = pl.canvas as Canvas; l.x = pl.left || 0; l.y = pl.top || 0; }
    if (pl.mask?.canvas) {
      l.mask = { canvas: pl.mask.canvas as Canvas, x: pl.mask.left || 0, y: pl.mask.top || 0, bg: pl.mask.defaultColor ?? 0, enabled: !pl.mask.disabled, linked: true, density: 1, feather: 0 };
      // ag-psd stores the mask in the alpha/grey channels; normalise to opaque grey
      const m = l.mask.canvas, d = ctx2d(m).getImageData(0, 0, m.width, m.height); for (let i = 0; i < d.data.length; i += 4) { const v = d.data[i]; d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } ctx2d(m).putImageData(d, 0, 0);
    }
    if (pl.text?.text) l.name = pl.name || pl.text.text.slice(0, 30);
    return l;
  };
  return new Doc(name, psd.width, psd.height, (d) => {
    if (psd.children?.length) d.s.layers = psd.children.map(conv);
    else if (psd.canvas) d.s.layers = [newLayer('raster', 'Background', { canvas: psd.canvas as Canvas })];
    const last = d.s.layers[d.s.layers.length - 1]; if (last) { d.s.activeId = last.id; d.s.selectedIds = [last.id]; }
  });
}
export function savePsd(d: Doc): Blob {
  const conv = (l: Layer): PsdLayer => {
    if (l.kind === 'group') return { name: l.name, hidden: !l.visible, opacity: l.opacity, blendMode: fromBlend(l.blend), opened: !l.collapsed, children: l.children!.map(conv) };
    let canvas: Canvas, left = 0, top = 0;
    if (l.kind === 'raster' && l.canvas) { canvas = l.canvas; left = l.x; top = l.y; }
    else canvas = renderLayerAlone(d, { ...l, mask: undefined }, false);
    const out: PsdLayer = { name: l.name, hidden: !l.visible, opacity: l.opacity, blendMode: fromBlend(l.blend), clipping: l.clip, canvas: canvas as any, left, top };
    if (l.kind === 'adjustment') { out.canvas = makeCanvas(1, 1) as any; }
    if (l.mask) out.mask = { canvas: l.mask.canvas as any, left: l.mask.x, top: l.mask.y, defaultColor: l.mask.bg, disabled: !l.mask.enabled };
    return out;
  };
  const psd: Psd = { width: d.w, height: d.h, children: d.layers.map(conv), canvas: flatten(d) as any };
  return new Blob([writePsd(psd, { generateThumbnail: true })], { type: 'image/vnd.adobe.photoshop' });
}

// ---------- native ----------
export async function saveNative(d: Doc): Promise<Blob> {
  const zip = new JSZip(); const files: Record<string, Canvas> = {};
  const ser = (l: Layer): any => {
    const o: any = { ...l };
    if (l.canvas) { files[`px/${l.id}.png`] = l.canvas; o.canvas = `px/${l.id}.png`; }
    if (l.mask) { files[`mask/${l.id}.png`] = l.mask.canvas; o.mask = { ...l.mask, canvas: `mask/${l.id}.png` }; }
    if (l.smart) { files[`smart/${l.id}.png`] = l.smart.source; o.smart = { ...l.smart, source: `smart/${l.id}.png` }; }
    if (l.children) o.children = l.children.map(ser);
    return o;
  };
  const state: any = { ...d.s, layers: d.s.layers.map(ser), selection: null, channels: d.s.channels.map((c) => { files[`ch/${c.id}.png`] = c.canvas; return { ...c, canvas: `ch/${c.id}.png` }; }) };
  if (d.s.selection) { files['sel.png'] = d.s.selection; state.selection = 'sel.png'; }
  zip.file('document.json', JSON.stringify({ format: 'anchor-monsoon', version: 1, name: d.name, state }));
  for (const [p, c] of Object.entries(files)) zip.file(p, await canvasToBlob(c));
  zip.file('preview.png', await canvasToBlob(flatten(d)));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } });
}
export async function openNative(buf: ArrayBuffer, fallbackName: string): Promise<Doc> {
  const zip = await JSZip.loadAsync(buf);
  const meta = JSON.parse(await zip.file('document.json')!.async('string'));
  const load = async (p: string) => blobToCanvas(await zip.file(p)!.async('blob'));
  const st = meta.state as DocState & any;
  const de = async (o: any): Promise<Layer> => {
    const l: Layer = { ...o };
    if (typeof o.canvas === 'string') l.canvas = await load(o.canvas);
    if (o.mask) l.mask = { ...o.mask, canvas: await load(o.mask.canvas) };
    if (o.smart) l.smart = { ...o.smart, source: await load(o.smart.source) };
    if (o.children) l.children = await Promise.all(o.children.map(de));
    return l;
  };
  const layers = await Promise.all(st.layers.map(de));
  const channels = await Promise.all((st.channels || []).map(async (c: any) => ({ ...c, canvas: await load(c.canvas) })));
  const selection = st.selection ? await load(st.selection) : null;
  return new Doc(meta.name || fallbackName, st.width, st.height, (d) => { d.s = { ...st, layers, channels, selection }; });
}

// ---------- export ----------
export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'gif' | 'bmp' | 'tiff' | 'pdf' | 'psd' | 'monsoon' | 'avif' | 'svg';
export async function exportCanvas(c: Canvas, fmt: ExportFormat, quality = 0.92, opts: { dpi?: number } = {}): Promise<Blob> {
  switch (fmt) {
    case 'png': return canvasToBlob(c, 'image/png');
    case 'jpeg': { const b = makeCanvas(c.width, c.height), x = ctx2d(b); x.fillStyle = '#fff'; x.fillRect(0, 0, b.width, b.height); x.drawImage(c, 0, 0); return canvasToBlob(b, 'image/jpeg', quality); }
    case 'webp': case 'avif': {
      const mime = 'image/' + fmt; const b = await canvasToBlob(c, mime, quality).catch(() => null);
      if (!b || b.type !== mime) throw new Error(`This browser cannot save ${fmt.toUpperCase()} files. Choose PNG or JPEG instead.`);
      return b;
    }
    case 'gif': {
      const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
      const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
      const pal = quantize(d, 256, { format: 'rgba4444', oneBitAlpha: true }); const idx = applyPalette(d, pal, 'rgba4444');
      const g = GIFEncoder(); g.writeFrame(idx, c.width, c.height, { palette: pal, transparent: true, transparentIndex: pal.findIndex((p: number[]) => p[3] === 0) }); g.finish();
      return new Blob([g.bytes()], { type: 'image/gif' });
    }
    case 'bmp': {
      const w = c.width, h = c.height, d = ctx2d(c).getImageData(0, 0, w, h).data, row = w * 4, size = 54 + 68 + row * h;
      const b = new DataView(new ArrayBuffer(size)); b.setUint16(0, 0x424d, false); b.setUint32(2, size, true); b.setUint32(10, 54 + 68, true);
      b.setUint32(14, 108, true); b.setInt32(18, w, true); b.setInt32(22, -h, true); b.setUint16(26, 1, true); b.setUint16(28, 32, true); b.setUint32(30, 3, true); b.setUint32(34, row * h, true);
      b.setUint32(54, 0x00ff0000, true); b.setUint32(58, 0x0000ff00, true); b.setUint32(62, 0x000000ff, true); b.setUint32(66, 0xff000000, true); b.setUint32(70, 0x57696e20, true);
      let o = 54 + 68; for (let i = 0; i < d.length; i += 4) { b.setUint8(o++, d[i + 2]); b.setUint8(o++, d[i + 1]); b.setUint8(o++, d[i]); b.setUint8(o++, d[i + 3]); }
      return new Blob([b.buffer], { type: 'image/bmp' });
    }
    case 'tiff': {
      const UTIF = (await import('utif')).default || (await import('utif'));
      const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
      return new Blob([UTIF.encodeImage(d.buffer, c.width, c.height)], { type: 'image/tiff' });
    }
    case 'pdf': {
      const { PDFDocument } = await import('pdf-lib');
      const pdf = await PDFDocument.create(); const dpi = opts.dpi || 72;
      const png = await pdf.embedPng(await (await canvasToBlob(c)).arrayBuffer());
      const page = pdf.addPage([(c.width * 72) / dpi, (c.height * 72) / dpi]); page.drawImage(png, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
      pdf.setProducer('ANCHOR Monsoon'); pdf.setCreator('ANCHOR Monsoon');
      return new Blob([(await pdf.save()) as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
    }
    case 'svg': {
      const url = await new Promise<string>((res) => { const r = new FileReader(); canvasToBlob(c).then((b) => { r.onload = () => res(String(r.result)); r.readAsDataURL(b); }); });
      return new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="${c.width}" height="${c.height}"><image href="${url}" width="${c.width}" height="${c.height}"/></svg>`], { type: 'image/svg+xml' });
    }
  }
  throw new Error('Unsupported format ' + fmt);
}
export async function exportDoc(d: Doc, fmt: ExportFormat, quality?: number, scale = 1): Promise<Blob> {
  if (fmt === 'psd') return savePsd(d);
  if (fmt === 'monsoon') return saveNative(d);
  let c = flatten(d);
  if (scale !== 1) { const s = makeCanvas(c.width * scale, c.height * scale), x = ctx2d(s); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, s.width, s.height); c = s; }
  return exportCanvas(c, fmt, quality, { dpi: d.s.resolution });
}
export const EXT: Record<ExportFormat, string> = { png: 'png', jpeg: 'jpg', webp: 'webp', gif: 'gif', bmp: 'bmp', tiff: 'tif', pdf: 'pdf', psd: 'psd', monsoon: 'monsoon', avif: 'avif', svg: 'svg' };

/** Export each top-level layer as its own file in a zip. */
export async function exportLayers(d: Doc, fmt: ExportFormat, trim: boolean): Promise<Blob> {
  const zip = new JSZip(); let n = 0;
  const all: Layer[] = []; walk(d.layers, (l) => { if (l.kind !== 'group' && l.kind !== 'adjustment') all.push(l); });
  for (const l of all) {
    let c = renderLayerAlone(d, l);
    if (trim) { const { alphaBounds } = await import('./util'); const b = alphaBounds(c); if (b) { const t = makeCanvas(b.w, b.h); ctx2d(t).drawImage(c, -b.x, -b.y); c = t; } }
    zip.file(`${String(++n).padStart(3, '0')}-${l.name.replace(/[^\w\- ]+/g, '_')}.${EXT[fmt]}`, await exportCanvas(c, fmt));
  }
  return zip.generateAsync({ type: 'blob' });
}

// ---------- recovery and recent files (IndexedDB) ----------
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open('anchor-monsoon', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('recovery'); r.result.createObjectStore('recent'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise((res, rej) => { const t = db.transaction(store, mode); const r = fn(t.objectStore(store)); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
export interface StoredDoc { id: string; name: string; time: number; blob: Blob; thumb?: Blob; w: number; h: number }
export async function storeRecovery(d: Doc) { try { const blob = await saveNative(d); await tx('recovery', 'readwrite', (s) => s.put({ id: d.id, name: d.name, time: Date.now(), blob, w: d.w, h: d.h } as StoredDoc, d.id)); } catch { /* storage full or unavailable */ } }
export async function dropRecovery(id: string) { try { await tx('recovery', 'readwrite', (s) => s.delete(id)); } catch { /* ignore */ } }
export async function listRecovery(): Promise<StoredDoc[]> { try { return await tx('recovery', 'readonly', (s) => s.getAll() as IDBRequest<StoredDoc[]>); } catch { return []; } }
export async function addRecent(d: Doc) {
  try {
    const blob = await saveNative(d); const thumb = await (async () => { const f = flatten(d), sc = 160 / Math.max(f.width, f.height), t = makeCanvas(f.width * sc, f.height * sc); ctx2d(t).drawImage(f, 0, 0, t.width, t.height); return canvasToBlob(t); })();
    await tx('recent', 'readwrite', (s) => s.put({ id: d.name, name: d.name, time: Date.now(), blob, thumb, w: d.w, h: d.h } as StoredDoc, d.name));
    const all = await listRecent(); for (const old of all.slice(10)) await tx('recent', 'readwrite', (s) => s.delete(old.id));
  } catch { /* ignore */ }
}
export async function listRecent(): Promise<StoredDoc[]> { try { const r = await tx('recent', 'readonly', (s) => s.getAll() as IDBRequest<StoredDoc[]>); return r.sort((a, b) => b.time - a.time); } catch { return []; } }
