// Pixel filters. Every filter takes ImageData and returns new or modified ImageData.
import { clamp, hexToRgb, lum } from './util';

type ID = ImageData;
const mk = (w: number, h: number) => new ImageData(w, h);
const copy = (s: ID) => new ImageData(new Uint8ClampedArray(s.data), s.width, s.height);

// ---------- blur primitives ----------
function boxBlurH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, ch: number) {
  const iarr = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) for (let c = 0; c < ch; c++) {
    let ti = y * w, li = ti, ri = ti + r;
    const fv = src[ti * ch + c], lv = src[(ti + w - 1) * ch + c];
    let val = (r + 1) * fv;
    for (let j = 0; j < r; j++) val += src[(ti + Math.min(j, w - 1)) * ch + c];
    for (let j = 0; j <= r; j++) { val += (ri < y * w + w ? src[ri * ch + c] : lv) - fv; dst[ti * ch + c] = val * iarr; ri++; ti++; }
    for (let j = r + 1; j < w - r; j++) { val += src[ri * ch + c] - src[li * ch + c]; dst[ti * ch + c] = val * iarr; ri++; li++; ti++; }
    for (let j = Math.max(w - r, r + 1); j < w; j++) { val += lv - src[li * ch + c]; dst[ti * ch + c] = val * iarr; li++; ti++; }
  }
}
function transpose(src: Float32Array, w: number, h: number, ch: number) {
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) out[(x * h + y) * ch + c] = src[(y * w + x) * ch + c];
  return out;
}
function boxesForGauss(sigma: number, n = 3) {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const wu = wl + 2, m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return Array.from({ length: n }, (_, i) => (i < m ? wl : wu));
}
/** Gaussian blur on a float buffer with `ch` channels. */
export function gaussFloat(buf: Float32Array, w: number, h: number, sigma: number, ch: number): Float32Array<ArrayBuffer> {
  if (sigma < 0.3) return Float32Array.from(buf);
  const boxes = boxesForGauss(sigma);
  let a: Float32Array = buf, b: Float32Array = new Float32Array(buf.length);
  for (const bx of boxes) { const r = Math.min((bx - 1) / 2, w - 1); if (r > 0) { boxBlurH(a, b, w, h, r, ch); [a, b] = [b, a]; } }
  a = transpose(a, w, h, ch); b = new Float32Array(a.length);
  for (const bx of boxes) { const r = Math.min((bx - 1) / 2, h - 1); if (r > 0) { boxBlurH(a, b, h, w, r, ch); [a, b] = [b, a]; } }
  return transpose(a, h, w, ch) as Float32Array<ArrayBuffer>;
}
function toPremul(d: Uint8ClampedArray) {
  const f = new Float32Array(d.length);
  for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; f[i] = d[i] * a; f[i + 1] = d[i + 1] * a; f[i + 2] = d[i + 2] * a; f[i + 3] = d[i + 3]; }
  return f;
}
function fromPremul(f: Float32Array, out: Uint8ClampedArray) {
  for (let i = 0; i < f.length; i += 4) { const a = f[i + 3] / 255; if (a > 0.001) { out[i] = f[i] / a; out[i + 1] = f[i + 1] / a; out[i + 2] = f[i + 2] / a; } else { out[i] = out[i + 1] = out[i + 2] = 0; } out[i + 3] = f[i + 3]; }
}
export function gaussianBlur(s: ID, radius: number): ID {
  const out = mk(s.width, s.height);
  if (radius < 0.3) { out.data.set(s.data); return out; }
  fromPremul(gaussFloat(toPremul(s.data), s.width, s.height, radius, 4), out.data);
  return out;
}
export function boxBlur(s: ID, radius: number): ID {
  const w = s.width, h = s.height, r = Math.max(1, Math.round(radius));
  let a = toPremul(s.data), b = new Float32Array(a.length);
  boxBlurH(a, b, w, h, Math.min(r, w - 1), 4); a = transpose(b, w, h, 4); b = new Float32Array(a.length);
  boxBlurH(a, b, h, w, Math.min(r, h - 1), 4); a = transpose(b, h, w, 4);
  const out = mk(w, h); fromPremul(a, out.data); return out;
}
/** Gaussian blur of a single 8-bit channel (masks, selections). */
export function blurChannel(ch: Uint8ClampedArray | Float32Array, w: number, h: number, sigma: number): Float32Array {
  const f = ch instanceof Float32Array ? ch : Float32Array.from(ch);
  return gaussFloat(f, w, h, sigma, 1);
}

function sampleBilinear(d: Uint8ClampedArray, w: number, h: number, x: number, y: number, out: number[]) {
  x = clamp(x, 0, w - 1); y = clamp(y, 0, h - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = x - x0, fy = y - y0;
  const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
  for (let c = 0; c < 4; c++) out[c] = (d[i00 + c] * (1 - fx) + d[i10 + c] * fx) * (1 - fy) + (d[i01 + c] * (1 - fx) + d[i11 + c] * fx) * fy;
}
export { sampleBilinear };

export function motionBlur(s: ID, angle: number, dist: number): ID {
  const w = s.width, h = s.height, out = mk(w, h), d = s.data, o = out.data;
  const steps = Math.max(1, Math.round(dist)), a = (angle * Math.PI) / 180, dx = Math.cos(a), dy = -Math.sin(a);
  const p = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, al = 0;
    for (let k = -steps; k <= steps; k++) {
      sampleBilinear(d, w, h, x + (dx * k) / 2, y + (dy * k) / 2, p);
      const pa = p[3] / 255; r += p[0] * pa; g += p[1] * pa; b += p[2] * pa; al += p[3];
    }
    const n = steps * 2 + 1, i = (y * w + x) * 4, A = al / n / 255;
    o[i] = A ? r / n / A : 0; o[i + 1] = A ? g / n / A : 0; o[i + 2] = A ? b / n / A : 0; o[i + 3] = al / n;
  }
  return out;
}
export function radialBlur(s: ID, amount: number, cx: number, cy: number, zoom: boolean): ID {
  const w = s.width, h = s.height, out = mk(w, h), d = s.data, o = out.data, p = [0, 0, 0, 0];
  const X = cx * w, Y = cy * h, N = 16;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, al = 0;
    for (let k = 0; k < N; k++) {
      const t = (k / (N - 1) - 0.5) * amount / 100;
      let sx: number, sy: number;
      if (zoom) { sx = X + (x - X) * (1 + t * 0.5); sy = Y + (y - Y) * (1 + t * 0.5); }
      else { const ang = t * 0.5, c = Math.cos(ang), sn = Math.sin(ang); sx = X + (x - X) * c - (y - Y) * sn; sy = Y + (x - X) * sn + (y - Y) * c; }
      sampleBilinear(d, w, h, sx, sy, p); r += p[0]; g += p[1]; b += p[2]; al += p[3];
    }
    const i = (y * w + x) * 4; o[i] = r / N; o[i + 1] = g / N; o[i + 2] = b / N; o[i + 3] = al / N;
  }
  return out;
}
export function surfaceBlur(s: ID, radius: number, threshold: number): ID {
  const w = s.width, h = s.height, out = copy(s), d = s.data, o = out.data, r = Math.max(1, Math.round(radius));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; let sr = 0, sg = 0, sb = 0, sw = 0;
    for (let j = -r; j <= r; j += r > 4 ? 2 : 1) for (let k = -r; k <= r; k += r > 4 ? 2 : 1) {
      const yy = clamp(y + j, 0, h - 1), xx = clamp(x + k, 0, w - 1), q = (yy * w + xx) * 4;
      const diff = (Math.abs(d[q] - d[i]) + Math.abs(d[q + 1] - d[i + 1]) + Math.abs(d[q + 2] - d[i + 2])) / 3;
      const wt = Math.max(0, 1 - diff / (2.5 * Math.max(1, threshold)));
      sr += d[q] * wt; sg += d[q + 1] * wt; sb += d[q + 2] * wt; sw += wt;
    }
    o[i] = sr / sw; o[i + 1] = sg / sw; o[i + 2] = sb / sw;
  }
  return out;
}
export function tiltShift(s: ID, center: number, band: number, transition: number, blur: number, angle = 0): ID {
  const blurred = gaussianBlur(s, blur), w = s.width, h = s.height, out = copy(s), o = out.data, bd = blurred.data;
  const a = (angle * Math.PI) / 180, nx = -Math.sin(a), ny = Math.cos(a);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dist = Math.abs((x - w / 2) * nx + (y - center * h) * ny) / h;
    const t = clamp((dist - band / 2) / Math.max(0.001, transition), 0, 1);
    const i = (y * w + x) * 4; for (let c = 0; c < 4; c++) o[i + c] = o[i + c] * (1 - t) + bd[i + c] * t;
  }
  return out;
}
export function irisBlur(s: ID, cx: number, cy: number, rx: number, ry: number, feather: number, blur: number): ID {
  const blurred = gaussianBlur(s, blur), w = s.width, h = s.height, out = copy(s), o = out.data, bd = blurred.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dd = Math.sqrt(((x / w - cx) / rx) ** 2 + ((y / h - cy) / ry) ** 2);
    const t = clamp((dd - 1 + feather) / Math.max(0.001, feather), 0, 1);
    const i = (y * w + x) * 4; for (let c = 0; c < 4; c++) o[i + c] = o[i + c] * (1 - t) + bd[i + c] * t;
  }
  return out;
}
export function lensBlur(s: ID, radius: number, brightness: number): ID {
  // disc-shaped bokeh approximation with highlight boost
  const w = s.width, h = s.height, d = s.data, out = copy(s), o = out.data, r = Math.max(1, Math.round(radius));
  const offs: [number, number][] = [];
  for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) if (j * j + k * k <= r * r && (r < 6 || (j + k) % 2 === 0)) offs.push([k, j]);
  const boost = 1 + brightness / 25;
  const lin = new Float32Array(256); for (let i = 0; i < 256; i++) lin[i] = Math.pow(i / 255, 2.2 * boost);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sr = 0, sg = 0, sb = 0;
    for (const [k, j] of offs) { const q = (clamp(y + j, 0, h - 1) * w + clamp(x + k, 0, w - 1)) * 4; sr += lin[d[q]]; sg += lin[d[q + 1]]; sb += lin[d[q + 2]]; }
    const n = offs.length, i = (y * w + x) * 4, e = 1 / (2.2 * boost);
    o[i] = Math.pow(sr / n, e) * 255; o[i + 1] = Math.pow(sg / n, e) * 255; o[i + 2] = Math.pow(sb / n, e) * 255;
  }
  return out;
}

// ---------- sharpen ----------
export function unsharpMask(s: ID, amount: number, radius: number, threshold: number): ID {
  const b = gaussianBlur(s, radius), out = copy(s), o = out.data, bd = b.data, k = amount / 100;
  for (let i = 0; i < o.length; i += 4) for (let c = 0; c < 3; c++) {
    const diff = o[i + c] - bd[i + c];
    if (Math.abs(diff) >= threshold) o[i + c] = o[i + c] + diff * k;
  }
  return out;
}
export function convolve(s: ID, k: number[], div = 1, offset = 0, alpha = false): ID {
  const n = Math.round(Math.sqrt(k.length)), half = n >> 1, w = s.width, h = s.height, d = s.data, out = copy(s), o = out.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const q = (clamp(y + j - half, 0, h - 1) * w + clamp(x + i - half, 0, w - 1)) * 4, kv = k[j * n + i];
      r += d[q] * kv; g += d[q + 1] * kv; b += d[q + 2] * kv; a += d[q + 3] * kv;
    }
    const p = (y * w + x) * 4; o[p] = r / div + offset; o[p + 1] = g / div + offset; o[p + 2] = b / div + offset; if (alpha) o[p + 3] = a / div;
  }
  return out;
}
export const sharpen = (s: ID) => convolve(s, [0, -1, 0, -1, 8, -1, 0, -1, 0], 4);
export const sharpenMore = (s: ID) => convolve(s, [-1, -1, -1, -1, 12, -1, -1, -1, -1], 4);
export const sharpenEdges = (s: ID) => unsharpMask(s, 60, 1, 12);
export function smartSharpen(s: ID, amount: number, radius: number, reduceNoise: number): ID {
  const pre = reduceNoise > 0 ? surfaceBlur(s, 2, reduceNoise) : s;
  return unsharpMask(pre, amount, radius * 0.7, 2);
}
export function highPass(s: ID, radius: number): ID {
  const b = gaussianBlur(s, radius), out = copy(s), o = out.data, bd = b.data;
  for (let i = 0; i < o.length; i += 4) for (let c = 0; c < 3; c++) o[i + c] = o[i + c] - bd[i + c] + 128;
  return out;
}

// ---------- noise ----------
export function addNoise(s: ID, amount: number, gaussian: boolean, mono: boolean): ID {
  const out = copy(s), o = out.data, a = amount * 2.55;
  const rnd = () => gaussian ? (Math.random() + Math.random() + Math.random() - 1.5) / 1.5 * 1.7 : Math.random() * 2 - 1;
  for (let i = 0; i < o.length; i += 4) {
    if (mono) { const n = rnd() * a; o[i] += n; o[i + 1] += n; o[i + 2] += n; }
    else { o[i] += rnd() * a; o[i + 1] += rnd() * a; o[i + 2] += rnd() * a; }
  }
  return out;
}
export function median(s: ID, radius: number): ID {
  const w = s.width, h = s.height, d = s.data, out = copy(s), o = out.data, r = Math.max(1, Math.round(radius));
  const hist = new Uint16Array(256 * 3);
  for (let y = 0; y < h; y++) {
    hist.fill(0); let n = 0;
    for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) { const q = (clamp(y + j, 0, h - 1) * w + clamp(k, 0, w - 1)) * 4; hist[d[q]]++; hist[256 + d[q + 1]]++; hist[512 + d[q + 2]]++; n++; }
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, half = n / 2;
      for (let c = 0; c < 3; c++) { let acc = 0, v = 0; while (v < 255 && acc + hist[c * 256 + v] < half) acc += hist[c * 256 + v++]; o[i + c] = v; }
      if (x + 1 < w) for (let j = -r; j <= r; j++) {
        const yy = clamp(y + j, 0, h - 1), qo = (yy * w + clamp(x - r, 0, w - 1)) * 4, qi = (yy * w + clamp(x + r + 1, 0, w - 1)) * 4;
        hist[d[qo]]--; hist[256 + d[qo + 1]]--; hist[512 + d[qo + 2]]--; hist[d[qi]]++; hist[256 + d[qi + 1]]++; hist[512 + d[qi + 2]]++;
      }
    }
  }
  return out;
}
export function dustScratches(s: ID, radius: number, threshold: number): ID {
  const m = median(s, radius), out = copy(s), o = out.data, md = m.data;
  for (let i = 0; i < o.length; i += 4) {
    const diff = Math.abs(o[i] - md[i]) + Math.abs(o[i + 1] - md[i + 1]) + Math.abs(o[i + 2] - md[i + 2]);
    if (diff / 3 > threshold) { o[i] = md[i]; o[i + 1] = md[i + 1]; o[i + 2] = md[i + 2]; }
  }
  return out;
}
export const despeckle = (s: ID) => surfaceBlur(s, 2, 18);
export function reduceNoise(s: ID, strength: number, preserve: number): ID {
  const b = surfaceBlur(s, 1 + strength / 3, 10 + strength * 3), out = copy(s), o = out.data, bd = b.data, k = 1 - preserve / 100 * 0.6;
  for (let i = 0; i < o.length; i += 4) for (let c = 0; c < 3; c++) o[i + c] = o[i + c] + (bd[i + c] - o[i + c]) * k;
  return out;
}

// ---------- stylize ----------
export function emboss(s: ID, angle: number, height: number, amount: number): ID {
  const a = (angle * Math.PI) / 180, dx = Math.cos(a) * height, dy = -Math.sin(a) * height;
  const w = s.width, h = s.height, d = s.data, out = copy(s), o = out.data, p = [0, 0, 0, 0], q = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    sampleBilinear(d, w, h, x - dx, y - dy, p); sampleBilinear(d, w, h, x + dx, y + dy, q);
    const v = 128 + (lum(q[0], q[1], q[2]) - lum(p[0], p[1], p[2])) * amount / 100;
    const i = (y * w + x) * 4; o[i] = o[i + 1] = o[i + 2] = v;
  }
  return out;
}
export function findEdges(s: ID): ID {
  const w = s.width, h = s.height, d = s.data, out = copy(s), o = out.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    const g = (xx: number, yy: number) => d[(clamp(yy, 0, h - 1) * w + clamp(xx, 0, w - 1)) * 4 + c];
    const gx = -g(x - 1, y - 1) - 2 * g(x - 1, y) - g(x - 1, y + 1) + g(x + 1, y - 1) + 2 * g(x + 1, y) + g(x + 1, y + 1);
    const gy = -g(x - 1, y - 1) - 2 * g(x, y - 1) - g(x + 1, y - 1) + g(x - 1, y + 1) + 2 * g(x, y + 1) + g(x + 1, y + 1);
    o[(y * w + x) * 4 + c] = 255 - Math.min(255, Math.sqrt(gx * gx + gy * gy) / 2);
  }
  return out;
}
export function traceContour(s: ID, level: number): ID {
  const w = s.width, h = s.height, d = s.data, out = copy(s), o = out.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, j = (y * w + Math.min(w - 1, x + 1)) * 4, k = (Math.min(h - 1, y + 1) * w + x) * 4;
    for (let c = 0; c < 3; c++) { const a = d[i + c] >= level, b = d[j + c] >= level, e = d[k + c] >= level; o[i + c] = a !== b || a !== e ? 0 : 255; }
  }
  return out;
}
export function solarize(s: ID): ID { const out = copy(s), o = out.data; for (let i = 0; i < o.length; i += 4) for (let c = 0; c < 3; c++) if (o[i + c] > 127) o[i + c] = 255 - o[i + c]; return out; }
export function wind(s: ID, strength: number, fromLeft: boolean): ID {
  const w = s.width, h = s.height, out = copy(s), o = out.data;
  for (let y = 0; y < h; y++) {
    let trail = 0, tr = 0, tg = 0, tb = 0;
    for (let k = 0; k < w; k++) {
      const x = fromLeft ? k : w - 1 - k, i = (y * w + x) * 4, l = lum(o[i], o[i + 1], o[i + 2]);
      if (l > 140 && Math.random() < 0.08) { trail = strength * (0.5 + Math.random()); tr = o[i]; tg = o[i + 1]; tb = o[i + 2]; }
      else if (trail > 0) { const t = trail / strength * 0.6; o[i] = o[i] * (1 - t) + tr * t; o[i + 1] = o[i + 1] * (1 - t) + tg * t; o[i + 2] = o[i + 2] * (1 - t) + tb * t; trail--; }
    }
  }
  return out;
}
export function diffuse(s: ID, amount = 2): ID {
  const w = s.width, h = s.height, d = s.data, out = copy(s), o = out.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const xx = clamp(x + Math.round((Math.random() * 2 - 1) * amount), 0, w - 1), yy = clamp(y + Math.round((Math.random() * 2 - 1) * amount), 0, h - 1);
    const i = (y * w + x) * 4, q = (yy * w + xx) * 4; o[i] = d[q]; o[i + 1] = d[q + 1]; o[i + 2] = d[q + 2]; o[i + 3] = d[q + 3];
  }
  return out;
}
export function oilPaint(s: ID, radius: number, levels: number): ID {
  const w = s.width, h = s.height, d = s.data, out = copy(s), o = out.data, r = Math.max(1, Math.round(radius)), L = Math.max(4, levels);
  const cnt = new Int32Array(L), sr = new Float32Array(L), sg = new Float32Array(L), sb = new Float32Array(L);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    cnt.fill(0); sr.fill(0); sg.fill(0); sb.fill(0);
    for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) {
      const q = (clamp(y + j, 0, h - 1) * w + clamp(x + k, 0, w - 1)) * 4, bin = Math.min(L - 1, Math.floor(lum(d[q], d[q + 1], d[q + 2]) / 256 * L));
      cnt[bin]++; sr[bin] += d[q]; sg[bin] += d[q + 1]; sb[bin] += d[q + 2];
    }
    let best = 0; for (let b = 1; b < L; b++) if (cnt[b] > cnt[best]) best = b;
    const i = (y * w + x) * 4; o[i] = sr[best] / cnt[best]; o[i + 1] = sg[best] / cnt[best]; o[i + 2] = sb[best] / cnt[best];
  }
  return out;
}
export function tiles(s: ID, n: number, offset: number): ID {
  const w = s.width, h = s.height, d = s.data, out = mk(w, h), o = out.data, size = Math.max(4, Math.floor(Math.min(w, h) / n));
  for (let ty = 0; ty < h; ty += size) for (let tx = 0; tx < w; tx += size) {
    const ox = Math.round((Math.random() * 2 - 1) * size * offset / 100), oy = Math.round((Math.random() * 2 - 1) * size * offset / 100);
    for (let y = ty; y < Math.min(h, ty + size); y++) for (let x = tx; x < Math.min(w, tx + size); x++) {
      const X = x + ox, Y = y + oy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const i = (y * w + x) * 4, q = (Y * w + X) * 4; o[q] = d[i]; o[q + 1] = d[i + 1]; o[q + 2] = d[i + 2]; o[q + 3] = d[i + 3];
    }
  }
  for (let i = 0; i < o.length; i += 4) if (!o[i + 3]) { o[i] = o[i + 1] = o[i + 2] = 255; o[i + 3] = 255; }
  return out;
}
export function extrude(s: ID, size: number): ID {
  const w = s.width, h = s.height, d = s.data, out = copy(s), o = out.data;
  for (let ty = 0; ty < h; ty += size) for (let tx = 0; tx < w; tx += size) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = ty; y < Math.min(h, ty + size); y++) for (let x = tx; x < Math.min(w, tx + size); x++) { const i = (y * w + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    r /= n; g /= n; b /= n;
    for (let y = ty; y < Math.min(h, ty + size); y++) for (let x = tx; x < Math.min(w, tx + size); x++) {
      const i = (y * w + x) * 4, u = (x - tx) / size, v = (y - ty) / size;
      const shade = u < 0.15 ? 1.25 : v < 0.15 ? 1.15 : u > 0.85 ? 0.75 : v > 0.85 ? 0.8 : 1;
      o[i] = r * shade; o[i + 1] = g * shade; o[i + 2] = b * shade;
    }
  }
  return out;
}

// ---------- pixelate ----------
export function mosaic(s: ID, size: number): ID {
  const w = s.width, h = s.height, d = s.data, out = mk(w, h), o = out.data, n = Math.max(2, Math.round(size));
  for (let ty = 0; ty < h; ty += n) for (let tx = 0; tx < w; tx += n) {
    let r = 0, g = 0, b = 0, a = 0, c = 0;
    for (let y = ty; y < Math.min(h, ty + n); y++) for (let x = tx; x < Math.min(w, tx + n); x++) { const i = (y * w + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; a += d[i + 3]; c++; }
    for (let y = ty; y < Math.min(h, ty + n); y++) for (let x = tx; x < Math.min(w, tx + n); x++) { const i = (y * w + x) * 4; o[i] = r / c; o[i + 1] = g / c; o[i + 2] = b / c; o[i + 3] = a / c; }
  }
  return out;
}
function voronoi(s: ID, size: number, paint: (o: Uint8ClampedArray, i: number, cell: number[], dist: number) => void, fill?: [number, number, number]) {
  const w = s.width, h = s.height, d = s.data, out = copy(s), o = out.data, n = Math.max(3, Math.round(size));
  const gw = Math.ceil(w / n), gh = Math.ceil(h / n), pts: number[][] = [];
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const px = Math.min(w - 1, Math.floor((gx + Math.random()) * n)), py = Math.min(h - 1, Math.floor((gy + Math.random()) * n)), q = (py * w + px) * 4;
    pts.push([px, py, d[q], d[q + 1], d[q + 2]]);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = Math.floor(x / n), gy = Math.floor(y / n); let best = 1e9, bc = pts[0];
    for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const X = gx + k, Y = gy + j; if (X < 0 || Y < 0 || X >= gw || Y >= gh) continue;
      const p = pts[Y * gw + X], dd = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (dd < best) { best = dd; bc = p; }
    }
    paint(o, (y * w + x) * 4, bc, Math.sqrt(best) / n);
  }
  if (fill) void 0;
  return out;
}
export const crystallize = (s: ID, size: number) => voronoi(s, size, (o, i, c) => { o[i] = c[2]; o[i + 1] = c[3]; o[i + 2] = c[4]; });
export function pointillize(s: ID, size: number, bg: string): ID {
  const b = hexToRgb(bg);
  return voronoi(s, size, (o, i, c, dist) => { if (dist < 0.45) { o[i] = c[2]; o[i + 1] = c[3]; o[i + 2] = c[4]; } else { o[i] = b.r; o[i + 1] = b.g; o[i + 2] = b.b; } });
}
export function colorHalftone(s: ID, radius: number): ID {
  const w = s.width, h = s.height, d = s.data, out = mk(w, h), o = out.data, cell = Math.max(4, Math.round(radius * 2));
  for (let i = 0; i < o.length; i += 4) { o[i] = o[i + 1] = o[i + 2] = 255; o[i + 3] = 255; }
  const angles = [108, 162, 90, 45];
  for (let c = 0; c < 3; c++) {
    const a = (angles[c] * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x * ca + y * sa, v = -x * sa + y * ca;
      const cu = (Math.floor(u / cell) + 0.5) * cell, cv = (Math.floor(v / cell) + 0.5) * cell;
      const sx = clamp(Math.round(cu * ca - cv * sa), 0, w - 1), sy = clamp(Math.round(cu * sa + cv * ca), 0, h - 1);
      const ink = 1 - d[(sy * w + sx) * 4 + c] / 255, rr = Math.sqrt(ink) * cell * 0.7;
      if ((u - cu) ** 2 + (v - cv) ** 2 < rr * rr) o[(y * w + x) * 4 + c] = 0;
    }
  }
  return out;
}
export function fragment(s: ID): ID {
  const w = s.width, h = s.height, d = s.data, out = copy(s), o = out.data, offs = [[-4, -4], [4, -4], [-4, 4], [4, 4]];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; let r = 0, g = 0, b = 0;
    for (const [dx, dy] of offs) { const q = (clamp(y + dy, 0, h - 1) * w + clamp(x + dx, 0, w - 1)) * 4; r += d[q]; g += d[q + 1]; b += d[q + 2]; }
    o[i] = r / 4; o[i + 1] = g / 4; o[i + 2] = b / 4;
  }
  return out;
}
export const mezzotint = (s: ID) => { const out = copy(s), o = out.data; for (let i = 0; i < o.length; i += 4) for (let c = 0; c < 3; c++) o[i + c] = Math.random() * 255 < o[i + c] ? 255 : 0; return out; };

// ---------- distort ----------
function remap(s: ID, fn: (x: number, y: number) => [number, number]): ID {
  const w = s.width, h = s.height, d = s.data, out = mk(w, h), o = out.data, p = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [sx, sy] = fn(x, y), i = (y * w + x) * 4;
    if (sx < -0.5 || sy < -0.5 || sx > w - 0.5 || sy > h - 0.5) { o[i + 3] = 0; continue; }
    sampleBilinear(d, w, h, sx, sy, p); o[i] = p[0]; o[i + 1] = p[1]; o[i + 2] = p[2]; o[i + 3] = p[3];
  }
  return out;
}
export { remap };
export function twirl(s: ID, angle: number): ID {
  const w = s.width, h = s.height, cx = w / 2, cy = h / 2, R = Math.min(cx, cy), a = (angle * Math.PI) / 180;
  return remap(s, (x, y) => { const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy); if (r >= R) return [x, y]; const t = a * (1 - r / R) ** 2, c = Math.cos(t), sn = Math.sin(t); return [cx + dx * c - dy * sn, cy + dx * sn + dy * c]; });
}
export function pinch(s: ID, amount: number): ID {
  const w = s.width, h = s.height, cx = w / 2, cy = h / 2, R = Math.min(cx, cy), k = amount / 100;
  return remap(s, (x, y) => { const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy); if (r >= R || r === 0) return [x, y]; const f = Math.pow(Math.sin((Math.PI / 2) * r / R), k > 0 ? k : 0) || 1; const m = k > 0 ? f : Math.pow(r / R, -k * 0.7); return [cx + dx * m, cy + dy * m]; });
}
export function spherize(s: ID, amount: number): ID {
  const w = s.width, h = s.height, cx = w / 2, cy = h / 2, R = Math.min(cx, cy), k = amount / 100;
  return remap(s, (x, y) => { const dx = (x - cx) / R, dy = (y - cy) / R, r = Math.hypot(dx, dy); if (r >= 1 || r === 0) return [x, y]; const nr = k >= 0 ? Math.asin(r) / (Math.PI / 2) * k + r * (1 - k) : r + (r - Math.sin(r * Math.PI / 2)) * k; const m = nr / r; return [cx + dx * m * R, cy + dy * m * R]; });
}
export function wave(s: ID, amp: number, wavelength: number, horizontal = true, vertical = true): ID {
  return remap(s, (x, y) => [x + (horizontal ? amp * Math.sin((2 * Math.PI * y) / wavelength) : 0), y + (vertical ? amp * Math.sin((2 * Math.PI * x) / wavelength) : 0)]);
}
export function ripple(s: ID, amount: number, size: number): ID { const wl = size === 0 ? 8 : size === 1 ? 18 : 40; return wave(s, amount / 40, wl); }
export function zigzag(s: ID, amount: number, ridges: number): ID {
  const w = s.width, h = s.height, cx = w / 2, cy = h / 2, R = Math.min(cx, cy);
  return remap(s, (x, y) => { const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy); if (r >= R || r === 0) return [x, y]; const off = (amount / 100) * Math.sin((r / R) * ridges * Math.PI) * (1 - r / R) * 20; return [x + (dx / r) * off, y + (dy / r) * off]; });
}
export function polar(s: ID, toPolar: boolean): ID {
  const w = s.width, h = s.height, cx = w / 2, cy = h / 2, R = Math.min(cx, cy);
  return remap(s, (x, y) => {
    if (toPolar) { const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy) / R, t = (Math.atan2(dx, -dy) + Math.PI) / (2 * Math.PI); return [t * w, r * h]; }
    const t = (x / w) * 2 * Math.PI - Math.PI, r = (y / h) * R; return [cx + Math.sin(t) * r, cy - Math.cos(t) * r];
  });
}
export function shear(s: ID, amount: number): ID { const w = s.width, h = s.height; return remap(s, (x, y) => [x - Math.sin((y / h) * Math.PI) * amount * w / 200, y]); }
export function offsetFilter(s: ID, dx: number, dy: number, wrap: boolean): ID {
  const w = s.width, h = s.height; return remap(s, (x, y) => { let sx = x - dx, sy = y - dy; if (wrap) { sx = ((sx % w) + w) % w; sy = ((sy % h) + h) % h; } return [sx, sy]; });
}
export function glass(s: ID, distortion: number, smooth: number): ID {
  const n = makeNoise(s.width, s.height, 4 + smooth * 3);
  return remap(s, (x, y) => { const i = y * s.width + x; return [x + (n[i] - 0.5) * distortion * 2, y + (n[(i + 7919) % n.length] - 0.5) * distortion * 2]; });
}
export function oceanRipple(s: ID, size: number, mag: number): ID { return glass(s, mag, size / 3); }

// ---------- render ----------
function makeNoise(w: number, h: number, scale: number): Float32Array {
  const out = new Float32Array(w * h);
  let amp = 1, tot = 0;
  for (let oct = 0; oct < 6; oct++) {
    const cs = Math.max(1, scale * Math.pow(2, 5 - oct)), gw = Math.ceil(w / cs) + 2, gh = Math.ceil(h / cs) + 2, g = new Float32Array(gw * gh).map(() => Math.random());
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const fx = x / cs, fy = y / cs, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = g[y0 * gw + x0], b = g[y0 * gw + x0 + 1], c = g[(y0 + 1) * gw + x0], d = g[(y0 + 1) * gw + x0 + 1];
      out[y * w + x] += ((a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy) * amp;
    }
    tot += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}
export { makeNoise };
export function clouds(w: number, h: number, fg: string, bg: string): ID {
  const n = makeNoise(w, h, 8), out = mk(w, h), o = out.data, a = hexToRgb(fg), b = hexToRgb(bg);
  for (let i = 0; i < n.length; i++) { const t = clamp((n[i] - 0.5) * 1.8 + 0.5, 0, 1); o[i * 4] = b.r + (a.r - b.r) * t; o[i * 4 + 1] = b.g + (a.g - b.g) * t; o[i * 4 + 2] = b.b + (a.b - b.b) * t; o[i * 4 + 3] = 255; }
  return out;
}
export function differenceClouds(s: ID, fg: string, bg: string): ID {
  const c = clouds(s.width, s.height, fg, bg), out = copy(s), o = out.data;
  for (let i = 0; i < o.length; i += 4) for (let k = 0; k < 3; k++) o[i + k] = Math.abs(o[i + k] - c.data[i + k]);
  return out;
}
export function fibers(w: number, h: number, variance: number, strength: number, fg: string, bg: string): ID {
  const out = mk(w, h), o = out.data, a = hexToRgb(fg), b = hexToRgb(bg);
  const cols = new Float32Array(w).map(() => Math.random());
  for (let x = 0; x < w; x++) cols[x] = (cols[x] + (cols[x - 1] || 0.5) * (strength / 64)) / (1 + strength / 64);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = clamp(cols[x] + Math.sin(y / (8 + variance) + x) * 0.08 + (Math.random() - 0.5) * 0.05, 0, 1), i = (y * w + x) * 4;
    o[i] = b.r + (a.r - b.r) * t; o[i + 1] = b.g + (a.g - b.g) * t; o[i + 2] = b.b + (a.b - b.b) * t; o[i + 3] = 255;
  }
  return out;
}
export function lensFlare(s: ID, cx: number, cy: number, brightness: number): ID {
  const w = s.width, h = s.height, out = copy(s), o = out.data, X = cx * w, Y = cy * h, R = Math.hypot(w, h);
  const k = brightness / 100, ghosts = [[0.4, 0.06, [120, 180, 255]], [0.7, 0.03, [255, 200, 120]], [1.2, 0.09, [160, 255, 200]], [1.5, 0.04, [255, 140, 200]]] as [number, number, number[]][];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, d = Math.hypot(x - X, y - Y) / R;
    let add = Math.exp(-d * 30) * 255 * k + Math.exp(-d * 6) * 60 * k;
    let gr = 0, gg = 0, gb = 0;
    for (const [pos, size, col] of ghosts) {
      const gx = X + (w / 2 - X) * pos * 2, gy = Y + (h / 2 - Y) * pos * 2, gd = Math.hypot(x - gx, y - gy) / R;
      if (gd < size) { const t = (1 - gd / size) * 0.35 * k; gr += col[0] * t; gg += col[1] * t; gb += col[2] * t; }
    }
    const ang = Math.atan2(y - Y, x - X), streak = Math.pow(Math.abs(Math.cos(ang * 6)), 40) * Math.exp(-d * 10) * 120 * k;
    add += streak;
    o[i] += add + gr; o[i + 1] += add * 0.95 + gg; o[i + 2] += add * 0.85 + gb;
  }
  return out;
}

// ---------- other ----------
export function maximum(s: ID, radius: number): ID { return morph(s, radius, true); }
export function minimum(s: ID, radius: number): ID { return morph(s, radius, false); }
function morph(s: ID, radius: number, max: boolean): ID {
  const w = s.width, h = s.height, r = Math.max(1, Math.round(radius));
  const pass = (src: Uint8ClampedArray, horiz: boolean) => {
    const out = new Uint8ClampedArray(src);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        let v = src[i + c];
        for (let k = -r; k <= r; k++) {
          const q = horiz ? (y * w + clamp(x + k, 0, w - 1)) * 4 : (clamp(y + k, 0, h - 1) * w + x) * 4;
          v = max ? Math.max(v, src[q + c]) : Math.min(v, src[q + c]);
        }
        out[i + c] = v;
      }
    }
    return out;
  };
  return new ImageData(pass(pass(s.data, true), false), w, h);
}
export function vignetteFilter(s: ID, amount: number, midpoint: number): ID {
  const w = s.width, h = s.height, out = copy(s), o = out.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot((x / w - 0.5) * 2, (y / h - 0.5) * 2) / Math.SQRT2;
    const t = clamp((d - midpoint / 100) / (1 - midpoint / 100 + 0.001), 0, 1) ** 1.5 * amount / 100;
    const i = (y * w + x) * 4; for (let c = 0; c < 3; c++) o[i + c] = t > 0 ? o[i + c] * (1 - t) : o[i + c] + (255 - o[i + c]) * -t;
  }
  return out;
}
/** Shadows/Highlights: local tone adjustment using a blurred luminance map. */
export function shadowsHighlights(s: ID, shadows: number, highlights: number, radius = 30): ID {
  const w = s.width, h = s.height, out = copy(s), o = out.data;
  const L = new Float32Array(w * h); for (let i = 0; i < L.length; i++) L[i] = lum(o[i * 4], o[i * 4 + 1], o[i * 4 + 2]) / 255;
  const B = gaussFloat(L, w, h, radius, 1);
  for (let i = 0; i < L.length; i++) {
    const b = B[i]; const lift = (shadows / 100) * Math.pow(1 - b, 2) * 0.8, cut = (highlights / 100) * Math.pow(b, 2) * 0.6;
    const k = 1 + lift / Math.max(0.05, L[i] + 0.05) * 0.5 - cut;
    for (let c = 0; c < 3; c++) o[i * 4 + c] = o[i * 4 + c] * k;
  }
  return out;
}
export function hdrToning(s: ID, radius: number, strength: number, gamma: number, detail: number): ID {
  let r = shadowsHighlights(s, strength * 0.6, strength * 0.4, radius);
  r = unsharpMask(r, detail, radius / 3, 0);
  const o = r.data, g = 1 / Math.max(0.1, gamma);
  for (let i = 0; i < o.length; i += 4) for (let c = 0; c < 3; c++) o[i + c] = Math.pow(o[i + c] / 255, g) * 255;
  return r;
}
