// Shared helpers: canvases, rectangles, colours, ids.
export type Canvas = HTMLCanvasElement;
export type Ctx = CanvasRenderingContext2D;
export interface Rect { x: number; y: number; w: number; h: number }
export interface Pt { x: number; y: number }
export interface RGB { r: number; g: number; b: number }
export interface RGBA extends RGB { a: number }

let idc = 0;
export const uid = (p = 'l') => p + Date.now().toString(36) + (idc++).toString(36);

export function makeCanvas(w: number, h: number): Canvas {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}
export function ctx2d(c: Canvas): Ctx {
  return c.getContext('2d', { willReadFrequently: true })!;
}
export function cloneCanvas(src: Canvas): Canvas {
  const c = makeCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}
export function fillCanvas(c: Canvas, color: string) {
  const x = ctx2d(c); x.save(); x.globalCompositeOperation = 'copy'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height); x.restore();
}
export const clamp = (v: number, a = 0, b = 255) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function rectUnion(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b; if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
export function rectIntersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null;
}
export function rectRound(r: Rect): Rect {
  const x = Math.floor(r.x), y = Math.floor(r.y);
  return { x, y, w: Math.ceil(r.x + r.w) - x, h: Math.ceil(r.y + r.h) - y };
}
export function rectFromPts(a: Pt, b: Pt): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function hexToRgb(hex: string): RGB {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
export function rgbToHex({ r, g, b }: RGB): string {
  return '#' + [r, g, b].map((v) => Math.round(clamp(v)).toString(16).padStart(2, '0')).join('');
}
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, mx ? d / mx : 0, mx];
}
export function hsvToRgb(h: number, s: number, v: number): RGB {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, s = 0;
  if (d) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)); else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hue2(p: number, q: number, t: number) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; }
export function hslToRgb(h: number, s: number, l: number): RGB {
  h = (((h % 360) + 360) % 360) / 360;
  if (!s) return { r: l * 255, g: l * 255, b: l * 255 };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return { r: hue2(p, q, h + 1 / 3) * 255, g: hue2(p, q, h) * 255, b: hue2(p, q, h - 1 / 3) * 255 };
}
export function rgbToCmyk(r: number, g: number, b: number): [number, number, number, number] {
  const k = 1 - Math.max(r, g, b) / 255;
  if (k >= 1) return [0, 0, 0, 100];
  return [(1 - r / 255 - k) / (1 - k) * 100, (1 - g / 255 - k) / (1 - k) * 100, (1 - b / 255 - k) / (1 - k) * 100, k * 100];
}
export function cmykToRgb(c: number, m: number, y: number, k: number): RGB {
  c /= 100; m /= 100; y /= 100; k /= 100;
  return { r: 255 * (1 - c) * (1 - k), g: 255 * (1 - m) * (1 - k), b: 255 * (1 - y) * (1 - k) };
}
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const f = (c: number) => { c /= 255; return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92; };
  const R = f(r), G = f(g), B = f(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, y = R * 0.2126 + G * 0.7152 + B * 0.0722, z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const g3 = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = g3(x); y = g3(y); z = g3(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export function labToRgb(L: number, a: number, bb: number): RGB {
  let y = (L + 16) / 116, x = a / 500 + y, z = y - bb / 200;
  const g3 = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  x = g3(x) * 0.95047; y = g3(y); z = g3(z) * 1.08883;
  const R = x * 3.2406 + y * -1.5372 + z * -0.4986, G = x * -0.9689 + y * 1.8758 + z * 0.0415, B = x * 0.0557 + y * -0.204 + z * 1.057;
  const f = (c: number) => 255 * (c > 0.0031308 ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055 : 12.92 * c);
  return { r: clamp(f(R)), g: clamp(f(G)), b: clamp(f(B)) };
}
export const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export function canvasToBlob(c: Canvas, type = 'image/png', q?: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), type, q));
}
export function getData(c: Canvas, r?: Rect): ImageData {
  const x = ctx2d(c);
  return r ? x.getImageData(r.x, r.y, r.w, r.h) : x.getImageData(0, 0, c.width, c.height);
}
export function putData(c: Canvas, d: ImageData, x = 0, y = 0) { ctx2d(c).putImageData(d, x, y); }

// Bounding box of non-transparent pixels (alpha > thr).
export function alphaBounds(c: Canvas, thr = 0): Rect | null {
  const d = getData(c).data, w = c.width, h = c.height;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) if (d[row + x * 4 + 3] > thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
export function imageToCanvas(img: CanvasImageSource & { width: number; height: number }): Canvas {
  const c = makeCanvas(img.width, img.height); ctx2d(c).drawImage(img, 0, 0); return c;
}
