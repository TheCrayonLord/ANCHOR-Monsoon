// Blend modes. Native canvas modes are used where they exist; the rest are done per pixel.
import type { BlendMode } from './types';
import { Canvas, ctx2d, Rect, rectIntersect } from './util';

const NATIVE: Partial<Record<BlendMode, GlobalCompositeOperation>> = {
  normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten',
  'color-dodge': 'color-dodge', 'color-burn': 'color-burn', 'hard-light': 'hard-light', 'soft-light': 'soft-light',
  difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity',
  'linear-dodge': 'lighter', 'pass-through': 'source-over',
};
export const nativeOp = (m: BlendMode) => NATIVE[m];

type F = (b: number, s: number) => number; // values 0..1
const sep: Partial<Record<BlendMode, F>> = {
  'linear-burn': (b, s) => Math.max(0, b + s - 1),
  'linear-dodge': (b, s) => Math.min(1, b + s),
  'vivid-light': (b, s) => (s <= 0.5 ? (s === 0 ? 0 : Math.max(0, 1 - (1 - b) / (2 * s))) : s === 1 ? 1 : Math.min(1, b / (2 * (1 - s)))),
  'linear-light': (b, s) => Math.min(1, Math.max(0, b + 2 * s - 1)),
  'pin-light': (b, s) => (s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1)),
  'hard-mix': (b, s) => (b + s >= 1 ? 1 : 0),
  subtract: (b, s) => Math.max(0, b - s),
  divide: (b, s) => (s === 0 ? (b === 0 ? 0 : 1) : Math.min(1, b / s)),
  multiply: (b, s) => b * s, screen: (b, s) => b + s - b * s,
  darken: Math.min, lighten: Math.max,
  overlay: (b, s) => (b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
  'hard-light': (b, s) => (s <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
  'soft-light': (b, s) => (s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * ((b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)) - b)),
  'color-dodge': (b, s) => (b === 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s))),
  'color-burn': (b, s) => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s)),
  difference: (b, s) => Math.abs(b - s), exclusion: (b, s) => b + s - 2 * b * s,
  normal: (_b, s) => s,
};
const L = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;

/** Blend one RGBA pixel buffer (src) onto another (dst) in place. mask is optional per-pixel 0..255. */
export function blendBuffers(dst: Uint8ClampedArray, src: Uint8ClampedArray, mode: BlendMode, opacity: number, mask?: Uint8ClampedArray | null, maskStride = 4) {
  const f = sep[mode];
  const n = dst.length;
  for (let i = 0; i < n; i += 4) {
    let sa = (src[i + 3] / 255) * opacity;
    if (mask) sa *= mask[(i / 4) * maskStride + (maskStride === 4 ? 0 : 0)] / 255;
    if (sa <= 0) continue;
    if (mode === 'dissolve') { if (Math.random() >= sa) continue; sa = 1; }
    const ba = dst[i + 3] / 255;
    const br = dst[i] / 255, bg = dst[i + 1] / 255, bb = dst[i + 2] / 255;
    const sr = src[i] / 255, sg = src[i + 1] / 255, sb = src[i + 2] / 255;
    let r: number, g: number, b: number;
    if (f) { r = f(br, sr); g = f(bg, sg); b = f(bb, sb); }
    else if (mode === 'darker-color') { if (L(sr, sg, sb) < L(br, bg, bb)) { r = sr; g = sg; b = sb; } else { r = br; g = bg; b = bb; } }
    else if (mode === 'lighter-color') { if (L(sr, sg, sb) > L(br, bg, bb)) { r = sr; g = sg; b = sb; } else { r = br; g = bg; b = bb; } }
    else if (mode === 'dissolve') { r = sr; g = sg; b = sb; }
    else { [r, g, b] = nonsep(mode, br, bg, bb, sr, sg, sb); }
    // composite: mix blended colour by backdrop alpha, then source-over
    const mr = (1 - ba) * sr + ba * r, mg = (1 - ba) * sg + ba * g, mb = (1 - ba) * sb + ba * b;
    const oa = sa + ba * (1 - sa);
    dst[i] = ((mr * sa + br * ba * (1 - sa)) / oa) * 255;
    dst[i + 1] = ((mg * sa + bg * ba * (1 - sa)) / oa) * 255;
    dst[i + 2] = ((mb * sa + bb * ba * (1 - sa)) / oa) * 255;
    dst[i + 3] = oa * 255;
  }
}
function clipColor(r: number, g: number, b: number): [number, number, number] {
  const l = L(r, g, b), n = Math.min(r, g, b), x = Math.max(r, g, b);
  if (n < 0) { r = l + ((r - l) * l) / (l - n); g = l + ((g - l) * l) / (l - n); b = l + ((b - l) * l) / (l - n); }
  if (x > 1) { r = l + ((r - l) * (1 - l)) / (x - l); g = l + ((g - l) * (1 - l)) / (x - l); b = l + ((b - l) * (1 - l)) / (x - l); }
  return [r, g, b];
}
function setLum(r: number, g: number, b: number, l: number) { const d = l - L(r, g, b); return clipColor(r + d, g + d, b + d); }
function sat(r: number, g: number, b: number) { return Math.max(r, g, b) - Math.min(r, g, b); }
function setSat(c: number[], s: number): [number, number, number] {
  const idx = [0, 1, 2].sort((a, b) => c[a] - c[b]);
  const out = [0, 0, 0]; const mn = c[idx[0]], md = c[idx[1]], mx = c[idx[2]];
  if (mx > mn) { out[idx[1]] = ((md - mn) * s) / (mx - mn); out[idx[2]] = s; }
  return out as [number, number, number];
}
function nonsep(mode: BlendMode, br: number, bg: number, bb: number, sr: number, sg: number, sb: number): [number, number, number] {
  switch (mode) {
    case 'hue': { const [r, g, b] = setSat([sr, sg, sb], sat(br, bg, bb)); return setLum(r, g, b, L(br, bg, bb)); }
    case 'saturation': { const [r, g, b] = setSat([br, bg, bb], sat(sr, sg, sb)); return setLum(r, g, b, L(br, bg, bb)); }
    case 'color': return setLum(sr, sg, sb, L(br, bg, bb));
    case 'luminosity': return setLum(br, bg, bb, L(sr, sg, sb));
  }
  return [sr, sg, sb];
}

/**
 * Composite `src` (positioned at sx,sy in target space) onto `dst` with a blend mode and opacity, limited to `clip`.
 */
export function drawBlended(dst: Canvas, src: Canvas, sx: number, sy: number, mode: BlendMode, opacity: number, clip?: Rect | null) {
  const area = rectIntersect({ x: sx, y: sy, w: src.width, h: src.height }, clip || { x: 0, y: 0, w: dst.width, h: dst.height });
  if (!area || opacity <= 0) return;
  const dx = ctx2d(dst);
  const op = nativeOp(mode);
  if (op && mode !== 'linear-dodge') {
    dx.save(); dx.globalAlpha = opacity; dx.globalCompositeOperation = op;
    dx.beginPath(); dx.rect(area.x, area.y, area.w, area.h); dx.clip();
    dx.drawImage(src, sx, sy);
    dx.restore();
    return;
  }
  const d = dx.getImageData(area.x, area.y, area.w, area.h);
  const s = ctx2d(src).getImageData(area.x - sx, area.y - sy, area.w, area.h);
  blendBuffers(d.data, s.data, mode, opacity);
  dx.putImageData(d, area.x, area.y);
}
