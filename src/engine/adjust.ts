// Colour adjustments. Each works in place on RGBA pixels and is used both destructively (Image > Adjustments)
// and non-destructively (adjustment layers).
import type { AdjType, Adjustment, Gradient } from './types';
import { clamp, hexToRgb, hslToRgb, rgbToHsl, lum } from './util';

export type Pts = [number, number][];

/** Monotone cubic interpolation through curve points (0..255) into a 256 LUT. */
export function curveLut(pts: Pts): Uint8ClampedArray {
  const p = [...pts].sort((a, b) => a[0] - b[0]);
  const lut = new Uint8ClampedArray(256);
  if (p.length < 2) { for (let i = 0; i < 256; i++) lut[i] = i; return lut; }
  const n = p.length, xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  const d: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  for (let x = 0; x < 256; x++) {
    if (x <= xs[0]) { lut[x] = ys[0]; continue; }
    if (x >= xs[n - 1]) { lut[x] = ys[n - 1]; continue; }
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    lut[x] = (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  }
  return lut;
}
export function levelsLut(inB: number, inW: number, gamma: number, outB: number, outW: number) {
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    let v = clamp((i - inB) / Math.max(1, inW - inB), 0, 1);
    v = Math.pow(v, 1 / Math.max(0.01, gamma));
    lut[i] = outB + v * (outW - outB);
  }
  return lut;
}
function applyLuts(d: Uint8ClampedArray, r: Uint8ClampedArray, g: Uint8ClampedArray, b: Uint8ClampedArray, master?: Uint8ClampedArray) {
  for (let i = 0; i < d.length; i += 4) {
    if (master) { d[i] = r[master[d[i]]]; d[i + 1] = g[master[d[i + 1]]]; d[i + 2] = b[master[d[i + 2]]]; }
    else { d[i] = r[d[i]]; d[i + 1] = g[d[i + 1]]; d[i + 2] = b[d[i + 2]]; }
  }
}
export function gradientLut(g: Gradient, reverse = false): Uint8ClampedArray {
  const out = new Uint8ClampedArray(256 * 4);
  const cs = [...g.stops].sort((a, b) => a.pos - b.pos).map((s) => ({ pos: s.pos, ...hexToRgb(s.color) }));
  const os = [...(g.opacity?.length ? g.opacity : [{ pos: 0, a: 1 }, { pos: 1, a: 1 }])].sort((a, b) => a.pos - b.pos);
  for (let i = 0; i < 256; i++) {
    const t = reverse ? 1 - i / 255 : i / 255;
    let r = cs[0].r, gg = cs[0].g, b = cs[0].b;
    if (t >= cs[cs.length - 1].pos) ({ r, g: gg, b } = cs[cs.length - 1]);
    else for (let k = 0; k < cs.length - 1; k++) if (t >= cs[k].pos && t <= cs[k + 1].pos) {
      const u = (t - cs[k].pos) / Math.max(1e-6, cs[k + 1].pos - cs[k].pos);
      r = cs[k].r + (cs[k + 1].r - cs[k].r) * u; gg = cs[k].g + (cs[k + 1].g - cs[k].g) * u; b = cs[k].b + (cs[k + 1].b - cs[k].b) * u; break;
    }
    let a = os[0].a;
    if (t >= os[os.length - 1].pos) a = os[os.length - 1].a;
    else for (let k = 0; k < os.length - 1; k++) if (t >= os[k].pos && t <= os[k + 1].pos) { const u = (t - os[k].pos) / Math.max(1e-6, os[k + 1].pos - os[k].pos); a = os[k].a + (os[k + 1].a - os[k].a) * u; break; }
    out[i * 4] = r; out[i * 4 + 1] = gg; out[i * 4 + 2] = b; out[i * 4 + 3] = a * 255;
  }
  return out;
}

// hue ranges for Hue/Saturation and Selective Color: reds, yellows, greens, cyans, blues, magentas
const HUES = [0, 60, 120, 180, 240, 300];
function rangeWeight(h: number, center: number, width = 30, fall = 30) {
  let d = Math.abs(((h - center + 540) % 360) - 180);
  if (d <= width - 15) return 1;
  d -= width - 15;
  return d >= fall ? 0 : 1 - d / fall;
}

export const ADJ_DEFAULTS: Record<AdjType, () => any> = {
  brightness: () => ({ brightness: 0, contrast: 0, legacy: false }),
  levels: () => ({ ch: { rgb: [0, 1, 255, 0, 255], r: [0, 1, 255, 0, 255], g: [0, 1, 255, 0, 255], b: [0, 1, 255, 0, 255] } }),
  curves: () => ({ rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] }),
  exposure: () => ({ exposure: 0, offset: 0, gamma: 1 }),
  vibrance: () => ({ vibrance: 0, saturation: 0 }),
  hsl: () => ({ colorize: false, master: [0, 0, 0], ranges: HUES.map(() => [0, 0, 0]), cHue: 0, cSat: 25, cLight: 0 }),
  colorBalance: () => ({ shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0], preserve: true }),
  bw: () => ({ reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80, tint: false, tintColor: '#e1d3b3' }),
  photoFilter: () => ({ color: '#ec8a00', density: 25, preserve: true }),
  channelMixer: () => ({ mono: false, r: [100, 0, 0, 0], g: [0, 100, 0, 0], b: [0, 0, 100, 0] }),
  lookup: () => ({ look: 'Warm Film' }),
  invert: () => ({}),
  posterize: () => ({ levels: 4 }),
  threshold: () => ({ level: 128 }),
  gradientMap: () => ({ gradient: { stops: [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }], opacity: [{ pos: 0, a: 1 }, { pos: 1, a: 1 }] }, reverse: false }),
  selectiveColor: () => ({ absolute: false, colors: Object.fromEntries(['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas', 'whites', 'neutrals', 'blacks'].map((k) => [k, [0, 0, 0, 0]])) }),
};
export const ADJ_LABELS: Record<AdjType, string> = {
  brightness: 'Brightness/Contrast', levels: 'Levels', curves: 'Curves', exposure: 'Exposure', vibrance: 'Vibrance', hsl: 'Hue/Saturation',
  colorBalance: 'Color Balance', bw: 'Black & White', photoFilter: 'Photo Filter', channelMixer: 'Channel Mixer', lookup: 'Color Lookup',
  invert: 'Invert', posterize: 'Posterize', threshold: 'Threshold', gradientMap: 'Gradient Map', selectiveColor: 'Selective Color',
};

export const LOOKS: Record<string, (r: number, g: number, b: number) => [number, number, number]> = {
  'Warm Film': (r, g, b) => [r * 1.06 + 8, g * 1.0 + 4, b * 0.88],
  'Cool Steel': (r, g, b) => [r * 0.9, g * 0.98, b * 1.08 + 10],
  'Faded Print': (r, g, b) => [r * 0.82 + 34, g * 0.82 + 30, b * 0.8 + 36],
  'Teal & Amber': (r, g, b) => { const l = lum(r, g, b) / 255; return [r + (l - 0.5) * 50, g + (l - 0.5) * 10, b - (l - 0.5) * 60]; },
  'Bleach Bypass': (r, g, b) => { const l = lum(r, g, b); const c = (v: number) => (v - 128) * 1.3 + 128; return [c(r * 0.5 + l * 0.5), c(g * 0.5 + l * 0.5), c(b * 0.5 + l * 0.5)]; },
  'Night Rain': (r, g, b) => [r * 0.7, g * 0.8 + 6, b * 1.0 + 24],
  'Golden Hour': (r, g, b) => [r * 1.1 + 12, g * 1.02 + 6, b * 0.8],
  'Crossprocess': (r, g, b) => [r * 1.1 - 10, g * 1.05 + 5, b * 0.7 + 50],
  'Monsoon Mono': (r, g, b) => { const l = lum(r, g, b); return [l * 0.95, l * 1.0, l * 1.06]; },
};

export function applyAdjustment(d: Uint8ClampedArray, a: Adjustment) {
  const p = a.p;
  switch (a.type) {
    case 'brightness': {
      const bri = p.brightness, con = p.contrast;
      const lut = new Uint8ClampedArray(256);
      const cf = con >= 0 ? 1 + con / 50 : 1 + con / 100;
      for (let i = 0; i < 256; i++) {
        let v = i;
        if (p.legacy) v = v + bri; else v = bri >= 0 ? v + (255 - v) * (bri / 150) * (1 - v / 400) : v + v * (bri / 150);
        v = (v - 127.5) * cf + 127.5;
        lut[i] = v;
      }
      applyLuts(d, lut, lut, lut); break;
    }
    case 'levels': {
      const c = p.ch, L = (q: number[]) => levelsLut(q[0], q[2], q[1], q[3], q[4]);
      applyLuts(d, L(c.r), L(c.g), L(c.b), L(c.rgb)); break;
    }
    case 'curves': applyLuts(d, curveLut(p.r), curveLut(p.g), curveLut(p.b), curveLut(p.rgb)); break;
    case 'exposure': {
      const lut = new Uint8ClampedArray(256), k = Math.pow(2, p.exposure);
      for (let i = 0; i < 256; i++) { let v = Math.pow(i / 255, 2.2) * k + p.offset; v = Math.pow(Math.max(0, v), 1 / 2.2); v = Math.pow(v, 1 / Math.max(0.01, p.gamma)); lut[i] = v * 255; }
      applyLuts(d, lut, lut, lut); break;
    }
    case 'vibrance': {
      const vib = p.vibrance / 100, sat = p.saturation / 100;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), l = lum(r, g, b);
        const s = (mx - Math.min(r, g, b)) / 255;
        const amt = 1 + sat + vib * (1 - s) * (vib > 0 ? 1 - Math.min(1, Math.max(0, (r - g) / 255) * Math.max(0, (g - b) / 255) * 4) : 1);
        d[i] = l + (r - l) * amt; d[i + 1] = l + (g - l) * amt; d[i + 2] = l + (b - l) * amt;
      }
      break;
    }
    case 'hsl': {
      for (let i = 0; i < d.length; i += 4) {
        let [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
        if (p.colorize) {
          h = p.cHue; s = p.cSat / 100;
          l = p.cLight > 0 ? l + (1 - l) * p.cLight / 100 : l * (1 + p.cLight / 100);
        } else {
          let dh = p.master[0], ds = p.master[1], dl = p.master[2];
          for (let k = 0; k < 6; k++) { const w = rangeWeight(h, HUES[k]); if (w) { dh += p.ranges[k][0] * w; ds += p.ranges[k][1] * w; dl += p.ranges[k][2] * w; } }
          h += dh;
          s = ds > 0 ? s + (1 - s) * ds / 100 : s * (1 + ds / 100);
          l = dl > 0 ? l + (1 - l) * dl / 100 : l * (1 + dl / 100);
        }
        const c = hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1));
        d[i] = c.r; d[i + 1] = c.g; d[i + 2] = c.b;
      }
      break;
    }
    case 'colorBalance': {
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2], l = lum(r, g, b) / 255;
        const ws = clamp(1 - l * 3, 0, 1) * 0.7 + 0.3 * (1 - l), wh = clamp(l * 3 - 2, 0, 1) * 0.7 + 0.3 * l, wm = 1 - Math.abs(l - 0.5) * 2;
        let nr = r, ng = g, nb = b;
        for (const [w, v] of [[ws, p.shadows], [wm, p.midtones], [wh, p.highlights]] as [number, number[]][]) {
          nr += v[0] * w * 1.2; ng += v[1] * w * 1.2; nb += v[2] * w * 1.2;
          // the three sliders are cyan-red, magenta-green, yellow-blue; others shift opposite
          nr -= (v[1] + v[2]) * w * 0.3; ng -= (v[0] + v[2]) * w * 0.3; nb -= (v[0] + v[1]) * w * 0.3;
        }
        if (p.preserve) { const k = lum(r, g, b) - lum(nr, ng, nb); nr += k; ng += k; nb += k; }
        d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
      }
      break;
    }
    case 'bw': {
      const w = [p.reds, p.yellows, p.greens, p.cyans, p.blues, p.magentas];
      const tint = p.tint ? rgbToHsl(...Object.values(hexToRgb(p.tintColor)) as [number, number, number]) : null;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const [h, s] = rgbToHsl(r, g, b);
        const base = lum(r, g, b);
        let k = 0, tw = 0;
        for (let j = 0; j < 6; j++) { const rw = rangeWeight(h, HUES[j], 30, 60); k += rw * w[j]; tw += rw; }
        k = tw ? k / tw : 50;
        let v = base + (k - 50) / 50 * s * 128 * (Math.max(r, g, b) / 255);
        v = clamp(v);
        if (tint) { const c = hslToRgb(tint[0], tint[1], v / 255); d[i] = c.r; d[i + 1] = c.g; d[i + 2] = c.b; }
        else { d[i] = d[i + 1] = d[i + 2] = v; }
      }
      break;
    }
    case 'photoFilter': {
      const c = hexToRgb(p.color), k = p.density / 100;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        let nr = r * (1 - k) + (r * c.r / 255) * k * 2 * 0.5 + c.r * k * 0.5 * (r / 255);
        let ng = g * (1 - k) + (g * c.g / 255) * k * 0.5 + c.g * k * 0.5 * (g / 255);
        let nb = b * (1 - k) + (b * c.b / 255) * k * 0.5 + c.b * k * 0.5 * (b / 255);
        if (p.preserve) { const dl = lum(r, g, b) - lum(nr, ng, nb); nr += dl; ng += dl; nb += dl; }
        d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
      }
      break;
    }
    case 'channelMixer': {
      const m = p.mono ? [p.r, p.r, p.r] : [p.r, p.g, p.b];
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        for (let c = 0; c < 3; c++) d[i + c] = (r * m[c][0] + g * m[c][1] + b * m[c][2]) / 100 + m[c][3] * 2.55;
      }
      break;
    }
    case 'lookup': {
      const f = LOOKS[p.look] || LOOKS['Warm Film'];
      for (let i = 0; i < d.length; i += 4) { const [r, g, b] = f(d[i], d[i + 1], d[i + 2]); d[i] = r; d[i + 1] = g; d[i + 2] = b; }
      break;
    }
    case 'invert': for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; } break;
    case 'posterize': {
      const n = Math.max(2, p.levels), lut = new Uint8ClampedArray(256);
      for (let i = 0; i < 256; i++) lut[i] = Math.round(Math.floor((i / 256) * n) * (255 / (n - 1)));
      applyLuts(d, lut, lut, lut); break;
    }
    case 'threshold': for (let i = 0; i < d.length; i += 4) { const v = lum(d[i], d[i + 1], d[i + 2]) >= p.level ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; } break;
    case 'gradientMap': {
      const g = gradientLut(p.gradient, p.reverse);
      for (let i = 0; i < d.length; i += 4) { const k = Math.round(lum(d[i], d[i + 1], d[i + 2])) * 4; d[i] = g[k]; d[i + 1] = g[k + 1]; d[i + 2] = g[k + 2]; }
      break;
    }
    case 'selectiveColor': {
      const names = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'];
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
        const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
        let dc = 0, dm = 0, dy = 0, dk = 0;
        const add = (v: number[], w: number) => { dc += v[0] * w; dm += v[1] * w; dy += v[2] * w; dk += v[3] * w; };
        for (let j = 0; j < 6; j++) { const w = rangeWeight(h, HUES[j]) * s; if (w > 0) add(p.colors[names[j]], w); }
        add(p.colors.whites, clamp((l - 0.5) * 2, 0, 1) * (1 - s));
        add(p.colors.blacks, clamp((0.5 - l) * 2, 0, 1) * (1 - s));
        add(p.colors.neutrals, (1 - Math.abs(l - 0.5) * 2) * (1 - s * 0.5));
        const k = (v: number, amt: number) => p.absolute ? v - amt / 100 : v - (amt / 100) * (amt > 0 ? v : 1 - v);
        let nr = k(r, dc), ng = k(g, dm), nb = k(b, dy);
        const kk = dk / 100; nr -= kk * (kk > 0 ? nr : nr - 1) * 1; ng -= kk * (kk > 0 ? ng : ng - 1); nb -= kk * (kk > 0 ? nb : nb - 1);
        d[i] = nr * 255; d[i + 1] = ng * 255; d[i + 2] = nb * 255;
      }
      break;
    }
  }
}

// ---- Auto corrections and other destructive-only adjustments ----
export function histogram(d: Uint8ClampedArray, mask?: Uint8ClampedArray) {
  const h = { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), l: new Uint32Array(256) };
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8 || (mask && mask[i] < 128)) continue;
    h.r[d[i]]++; h.g[d[i + 1]]++; h.b[d[i + 2]]++; h.l[Math.round(lum(d[i], d[i + 1], d[i + 2]))]++;
  }
  return h;
}
function clipPoints(h: Uint32Array, clipPct = 0.1) {
  let total = 0; for (let i = 0; i < 256; i++) total += h[i];
  const lim = total * clipPct / 100;
  let lo = 0, acc = 0; while (lo < 255 && acc + h[lo] <= lim) acc += h[lo++];
  let hi = 255; acc = 0; while (hi > 0 && acc + h[hi] <= lim) acc += h[hi--];
  return [lo, Math.max(lo + 1, hi)];
}
export function autoTone(d: Uint8ClampedArray) { const h = histogram(d); const L = (x: Uint32Array) => { const [a, b] = clipPoints(x); return levelsLut(a, b, 1, 0, 255); }; applyLuts(d, L(h.r), L(h.g), L(h.b)); }
export function autoContrast(d: Uint8ClampedArray) { const h = histogram(d); const [a, b] = clipPoints(h.l); const l = levelsLut(a, b, 1, 0, 255); applyLuts(d, l, l, l); }
export function autoColor(d: Uint8ClampedArray) {
  autoContrast(d);
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { const l = lum(d[i], d[i + 1], d[i + 2]); if (l > 40 && l < 215 && d[i + 3] > 8) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } }
  if (!n) return;
  const avg = (r + g + b) / 3 / n, kr = avg / (r / n), kg = avg / (g / n), kb = avg / (b / n);
  for (let i = 0; i < d.length; i += 4) { d[i] *= kr; d[i + 1] *= kg; d[i + 2] *= kb; }
}
export function desaturate(d: Uint8ClampedArray) { for (let i = 0; i < d.length; i += 4) { const v = lum(d[i], d[i + 1], d[i + 2]); d[i] = d[i + 1] = d[i + 2] = v; } }
export function equalize(d: Uint8ClampedArray) {
  const h = histogram(d).l; let total = 0; for (const v of h) total += v;
  const lut = new Float32Array(256); let acc = 0;
  for (let i = 0; i < 256; i++) { acc += h[i]; lut[i] = (acc / Math.max(1, total)) * 255; }
  for (let i = 0; i < d.length; i += 4) { const l = Math.max(1, lum(d[i], d[i + 1], d[i + 2])); const k = lut[Math.round(l)] / l; d[i] *= k; d[i + 1] *= k; d[i + 2] *= k; }
}
export function replaceColor(d: Uint8ClampedArray, target: string, fuzz: number, dh: number, ds: number, dl: number) {
  const t = hexToRgb(target);
  for (let i = 0; i < d.length; i += 4) {
    const dist = Math.sqrt((d[i] - t.r) ** 2 + (d[i + 1] - t.g) ** 2 + (d[i + 2] - t.b) ** 2);
    const w = clamp(1 - dist / Math.max(1, fuzz * 2), 0, 1);
    if (!w) continue;
    let [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    h += dh * w; s = clamp(s + (ds / 100) * w, 0, 1); l = clamp(l + (dl / 100) * w, 0, 1);
    const c = hslToRgb(h, s, l); d[i] = c.r; d[i + 1] = c.g; d[i + 2] = c.b;
  }
}
