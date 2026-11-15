// Gradients and patterns.
import type { Gradient, GradientShape } from './types';
import { gradientLut } from './adjust';
import { Canvas, ctx2d, makeCanvas, Pt } from './util';
import { makeNoise } from './filters';

export const GRADIENT_PRESETS: Gradient[] = [
  { name: 'Foreground to Background', stops: [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }], opacity: [{ pos: 0, a: 1 }, { pos: 1, a: 1 }] },
  { name: 'Foreground to Transparent', stops: [{ pos: 0, color: '#000000' }, { pos: 1, color: '#000000' }], opacity: [{ pos: 0, a: 1 }, { pos: 1, a: 0 }] },
  { name: 'Black, White', stops: [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }], opacity: [{ pos: 0, a: 1 }, { pos: 1, a: 1 }] },
  { name: 'Storm', stops: [{ pos: 0, color: '#0b1026' }, { pos: 0.55, color: '#3b4fa8' }, { pos: 1, color: '#9fd3ff' }], opacity: [{ pos: 0, a: 1 }, { pos: 1, a: 1 }] },
  { name: 'Monsoon Dusk', stops: [{ pos: 0, color: '#2d1b4e' }, { pos: 0.5, color: '#c2457a' }, { pos: 1, color: '#ffb36b' }], opacity: [{ pos: 0, a: 1 }, { pos: 1, a: 1 }] },
  { name: 'Spectrum', stops: [{ pos: 0, color: '#ff0000' }, { pos: 0.17, color: '#ffff00' }, { pos: 0.33, color: '#00ff00' }, { pos: 0.5, color: '#00ffff' }, { pos: 0.67, color: '#0000ff' }, { pos: 0.83, color: '#ff00ff' }, { pos: 1, color: '#ff0000' }], opacity: [{ pos: 0, a: 1 }, { pos: 1, a: 1 }] },
  { name: 'Copper', stops: [{ pos: 0, color: '#3a1d0e' }, { pos: 0.4, color: '#b8693a' }, { pos: 0.6, color: '#f2b98a' }, { pos: 1, color: '#5a2c12' }], opacity: [{ pos: 0, a: 1 }, { pos: 1, a: 1 }] },
  { name: 'Chrome', stops: [{ pos: 0, color: '#2a2a2a' }, { pos: 0.45, color: '#f2f2f2' }, { pos: 0.5, color: '#4a4a4a' }, { pos: 0.8, color: '#d0d0d0' }, { pos: 1, color: '#ffffff' }], opacity: [{ pos: 0, a: 1 }, { pos: 1, a: 1 }] },
  { name: 'Lagoon', stops: [{ pos: 0, color: '#003f5c' }, { pos: 0.5, color: '#2ec4b6' }, { pos: 1, color: '#e0fbfc' }], opacity: [{ pos: 0, a: 1 }, { pos: 1, a: 1 }] },
  { name: 'Ember', stops: [{ pos: 0, color: '#1a0000' }, { pos: 0.4, color: '#d62828' }, { pos: 0.75, color: '#f77f00' }, { pos: 1, color: '#fcbf49' }], opacity: [{ pos: 0, a: 1 }, { pos: 1, a: 1 }] },
  { name: 'Violet Mist', stops: [{ pos: 0, color: '#5f0f40' }, { pos: 1, color: '#c8b6ff' }], opacity: [{ pos: 0, a: 1 }, { pos: 1, a: 1 }] },
  { name: 'Transparent Stripes', stops: [{ pos: 0, color: '#000000' }, { pos: 1, color: '#000000' }], opacity: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].flatMap((p, i) => [{ pos: p, a: i % 2 ? 0 : 1 }]) },
];

export function withFgBg(g: Gradient, fg: string, bg: string): Gradient {
  if (g.name === 'Foreground to Background') return { ...g, stops: [{ pos: 0, color: fg }, { pos: 1, color: bg }] };
  if (g.name === 'Foreground to Transparent') return { ...g, stops: [{ pos: 0, color: fg }, { pos: 1, color: fg }] };
  return g;
}

/** Fill `c` (or the area w x h) with a gradient from p0 to p1. */
export function renderGradient(w: number, h: number, g: Gradient, shape: GradientShape, p0: Pt, p1: Pt, reverse = false, dither = true): ImageData {
  const lut = gradientLut(g, reverse), out = new ImageData(w, h), o = out.data;
  const dx = p1.x - p0.x, dy = p1.y - p0.y, len2 = dx * dx + dy * dy || 1, len = Math.sqrt(len2), ang0 = Math.atan2(dy, dx);
  const ca = Math.cos(-ang0), sa = Math.sin(-ang0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const rx = x + 0.5 - p0.x, ry = y + 0.5 - p0.y;
    let t: number;
    switch (shape) {
      case 'linear': t = (rx * dx + ry * dy) / len2; break;
      case 'radial': t = Math.sqrt(rx * rx + ry * ry) / len; break;
      case 'angle': { let a = Math.atan2(ry, rx) - ang0; a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); t = a / (2 * Math.PI); break; }
      case 'reflected': t = Math.abs((rx * dx + ry * dy) / len2); break;
      case 'diamond': { const u = rx * ca - ry * sa, v = rx * sa + ry * ca; t = (Math.abs(u) + Math.abs(v)) / len; break; }
    }
    if (dither) t += (Math.random() - 0.5) / 255;
    const k = Math.round(Math.min(1, Math.max(0, t)) * 255) * 4, i = (y * w + x) * 4;
    o[i] = lut[k]; o[i + 1] = lut[k + 1]; o[i + 2] = lut[k + 2]; o[i + 3] = lut[k + 3];
  }
  return out;
}
export function gradientCss(g: Gradient, angle = 90) {
  return `linear-gradient(${angle}deg, ${[...g.stops].sort((a, b) => a.pos - b.pos).map((s) => `${s.color} ${Math.round(s.pos * 100)}%`).join(', ')})`;
}

// ---- patterns ----
const patternCache = new Map<string, Canvas>();
const userPatterns = new Map<string, Canvas>();
function makePattern(name: string): Canvas {
  const c = makeCanvas(64, 64), x = ctx2d(c);
  switch (name) {
    case 'Checker': x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#c8c8c8'; x.fillRect(0, 0, 32, 32); x.fillRect(32, 32, 32, 32); break;
    case 'Dots': x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#333'; for (const [a, b] of [[16, 16], [48, 48]]) { x.beginPath(); x.arc(a, b, 7, 0, 7); x.fill(); } break;
    case 'Stripes': x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 64); x.strokeStyle = '#3b4fa8'; x.lineWidth = 10; for (let i = -64; i < 128; i += 32) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 64, 64); x.stroke(); } break;
    case 'Grid': x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 64); x.strokeStyle = '#8899bb'; x.lineWidth = 2; x.strokeRect(0, 0, 64, 64); x.beginPath(); x.moveTo(32, 0); x.lineTo(32, 64); x.moveTo(0, 32); x.lineTo(64, 32); x.stroke(); break;
    case 'Rain': x.fillStyle = '#16203a'; x.fillRect(0, 0, 64, 64); x.strokeStyle = '#7fb4ff'; x.lineWidth = 2; for (const [a, b] of [[8, 4], [30, 20], [50, 8], [18, 40], [44, 46]]) { x.beginPath(); x.moveTo(a, b); x.lineTo(a - 4, b + 12); x.stroke(); } break;
    case 'Noise': { const d = x.createImageData(64, 64); const n = makeNoise(64, 64, 0.5); for (let i = 0; i < n.length; i++) { const v = n[i] * 255; d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = v; d.data[i * 4 + 3] = 255; } x.putImageData(d, 0, 0); break; }
    case 'Bricks': x.fillStyle = '#ddd'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#a0452e'; for (let r = 0; r < 4; r++) for (let k = -1; k < 3; k++) x.fillRect(k * 32 + (r % 2) * 16 + 1, r * 16 + 1, 30, 14); break;
    case 'Weave': x.fillStyle = '#e8dcc4'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#b89f6d'; for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if ((i + j) % 2) x.fillRect(i * 8, j * 8, 8, 8); break;
    case 'Paper': { const d = x.createImageData(64, 64); for (let i = 0; i < 64 * 64; i++) { const v = 235 + Math.random() * 20; d.data[i * 4] = v; d.data[i * 4 + 1] = v - 4; d.data[i * 4 + 2] = v - 12; d.data[i * 4 + 3] = 255; } x.putImageData(d, 0, 0); break; }
    case 'Hexagons': x.fillStyle = '#20263a'; x.fillRect(0, 0, 64, 64); x.strokeStyle = '#6c7cff'; x.lineWidth = 2; for (const [cx, cy] of [[16, 16], [48, 16], [32, 44], [0, 44], [64, 44]]) { x.beginPath(); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; x.lineTo(cx + 14 * Math.cos(a), cy + 14 * Math.sin(a)); } x.closePath(); x.stroke(); } break;
    default: x.fillStyle = '#888'; x.fillRect(0, 0, 64, 64);
  }
  return c;
}
export const PATTERN_NAMES = ['Checker', 'Dots', 'Stripes', 'Grid', 'Rain', 'Noise', 'Bricks', 'Weave', 'Paper', 'Hexagons'];
export function getPattern(name: string): Canvas {
  if (userPatterns.has(name)) return userPatterns.get(name)!;
  if (!patternCache.has(name)) patternCache.set(name, makePattern(name));
  return patternCache.get(name)!;
}
export function definePattern(name: string, c: Canvas) { userPatterns.set(name, c); }
export function patternNames() { return [...PATTERN_NAMES, ...userPatterns.keys()]; }
export function fillPattern(x: CanvasRenderingContext2D, name: string, w: number, h: number, scale = 1, ox = 0, oy = 0) {
  const p = x.createPattern(getPattern(name), 'repeat')!;
  if (scale !== 1 || ox || oy) p.setTransform(new DOMMatrix().translate(ox, oy).scale(scale));
  x.fillStyle = p; x.fillRect(0, 0, w, h);
}
