// Healing (texture from source, tone from destination), content-aware fill (multi-scale PatchMatch), red eye.
import { gaussFloat } from './filters';
import { clamp } from './util';

/** Heal: keep the high frequencies of `src` and take the low frequencies from `dst`, inside `mask` (0..1). */
export function healBlend(dst: ImageData, src: ImageData, mask: Float32Array, radius = 0): ImageData {
  const w = dst.width, h = dst.height, out = new ImageData(new Uint8ClampedArray(dst.data), w, h), o = out.data;
  const r = radius || Math.max(3, Math.sqrt(mask.reduce((a, v) => a + (v > 0.5 ? 1 : 0), 0)) / 3);
  // membrane interpolation approximated by smoothing the difference, normalised by smoothed weight outside the hole
  const diff = new Float32Array(w * h * 3), wt = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const outside = mask[i] < 0.5 ? 1 : 0; wt[i] = outside;
    for (let c = 0; c < 3; c++) diff[i * 3 + c] = outside * (dst.data[i * 4 + c] - src.data[i * 4 + c]);
  }
  const bd = gaussFloat(diff, w, h, r, 3), bw = gaussFloat(wt, w, h, r, 1);
  for (let i = 0; i < w * h; i++) {
    const m = mask[i]; if (m <= 0) continue;
    const k = bw[i] > 1e-4 ? 1 / bw[i] : 0;
    for (let c = 0; c < 3; c++) { const v = src.data[i * 4 + c] + bd[i * 3 + c] * k; o[i * 4 + c] = o[i * 4 + c] * (1 - m) + v * m; }
    o[i * 4 + 3] = o[i * 4 + 3] * (1 - m) + src.data[i * 4 + 3] * m;
  }
  return out;
}

function downsample(img: Float32Array, w: number, h: number, ch: number) {
  const W = Math.max(1, w >> 1), H = Math.max(1, h >> 1), out = new Float32Array(W * H * ch);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < ch; c++) {
    let s = 0, n = 0;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { const xx = Math.min(w - 1, x * 2 + i), yy = Math.min(h - 1, y * 2 + j); s += img[(yy * w + xx) * ch + c]; n++; }
    out[(y * W + x) * ch + c] = s / n;
  }
  return { img: out, w: W, h: H };
}

/**
 * Content-aware fill. `mask` is 1 where pixels must be synthesised. Optional `allowed` limits where source patches can come from.
 */
export function inpaint(src: ImageData, mask: Uint8Array, allowed?: Uint8Array, iterations = 4): ImageData {
  const W0 = src.width, H0 = src.height;
  // pyramid
  const levels: { img: Float32Array; hole: Uint8Array; allow: Uint8Array; w: number; h: number }[] = [];
  let img = new Float32Array(W0 * H0 * 3); for (let i = 0; i < W0 * H0; i++) for (let c = 0; c < 3; c++) img[i * 3 + c] = src.data[i * 4 + c];
  let hole = Float32Array.from(mask), allow = Float32Array.from(allowed || new Uint8Array(W0 * H0).fill(1));
  let w = W0, h = H0;
  let holeCount = 0; for (const v of mask) holeCount += v;
  while (true) {
    const hb = new Uint8Array(w * h), ab = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) { hb[i] = hole[i] > 0.01 ? 1 : 0; ab[i] = allow[i] > 0.99 ? 1 : 0; }
    levels.unshift({ img, hole: hb, allow: ab, w, h });
    if (Math.min(w, h) < 48 || holeCount < 64) break;
    const a = downsample(img, w, h, 3), b = downsample(hole, w, h, 1), c = downsample(allow, w, h, 1);
    img = a.img; hole = b.img; allow = c.img; w = a.w; h = a.h; holeCount /= 4;
  }
  const P = 3; // patch radius (7x7)
  let nnf: Int32Array | null = null, prevW = 0, prevH = 0;
  for (let L = 0; L < levels.length; L++) {
    const lv = levels[L]; const { w, h } = lv; const I = lv.img;
    // valid source centres: patch fully outside hole and within allowed
    const valid = new Uint8Array(w * h); const vlist: number[] = [];
    for (let y = P; y < h - P; y++) for (let x = P; x < w - P; x++) {
      let ok = 1;
      for (let j = -P; j <= P && ok; j++) for (let i = -P; i <= P; i++) { const q = (y + j) * w + x + i; if (lv.hole[q] || !lv.allow[q]) { ok = 0; break; } }
      if (ok) { valid[y * w + x] = 1; vlist.push(y * w + x); }
    }
    if (!vlist.length) continue;
    const holes: number[] = []; for (let i = 0; i < w * h; i++) if (lv.hole[i]) holes.push(i);
    // dilated target set: hole pixels plus anything whose patch overlaps the hole
    const target = new Uint8Array(w * h);
    for (const p of holes) { const x = p % w, y = (p - x) / w; for (let j = -P; j <= P; j++) for (let i = -P; i <= P; i++) { const xx = x + i, yy = y + j; if (xx >= 0 && yy >= 0 && xx < w && yy < h) target[yy * w + xx] = 1; } }
    const tlist: number[] = []; for (let i = 0; i < w * h; i++) if (target[i]) tlist.push(i);
    if (L === 0) {
      // initial guess: diffuse from the boundary
      for (let it = 0; it < 60; it++) for (const p of holes) {
        const x = p % w, y = (p - x) / w; let s0 = 0, s1 = 0, s2 = 0, n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const q = yy * w + xx; if (it === 0 && lv.hole[q]) continue; s0 += I[q * 3]; s1 += I[q * 3 + 1]; s2 += I[q * 3 + 2]; n++; }
        if (n) { I[p * 3] = s0 / n; I[p * 3 + 1] = s1 / n; I[p * 3 + 2] = s2 / n; }
      }
    }
    const field = new Int32Array(w * h).fill(-1);
    const rndValid = () => vlist[(Math.random() * vlist.length) | 0];
    if (nnf && L > 0) {
      for (const p of tlist) {
        const x = p % w, y = (p - x) / w, px = Math.min(prevW - 1, x >> 1), py = Math.min(prevH - 1, y >> 1), old = nnf[py * prevW + px];
        if (old >= 0) { const ox = (old % prevW) * 2 + (x & 1), oy = Math.floor(old / prevW) * 2 + (y & 1); const c = oy * w + ox; field[p] = c < w * h && valid[c] ? c : rndValid(); }
        else field[p] = rndValid();
      }
    } else for (const p of tlist) field[p] = rndValid();
    const dist = (p: number, q: number, best: number) => {
      const px = p % w, py = (p - px) / w, qx = q % w, qy = (q - qx) / w; let d = 0;
      for (let j = -P; j <= P; j++) {
        const y1 = py + j, y2 = qy + j; if (y1 < 0 || y1 >= h) continue;
        for (let i = -P; i <= P; i++) {
          const x1 = px + i; if (x1 < 0 || x1 >= w) continue;
          const a = (y1 * w + x1) * 3, b = (y2 * w + qx + i) * 3;
          const e0 = I[a] - I[b], e1 = I[a + 1] - I[b + 1], e2 = I[a + 2] - I[b + 2];
          d += e0 * e0 + e1 * e1 + e2 * e2;
        }
        if (d > best) return d;
      }
      return d;
    };
    const cost = new Float32Array(w * h);
    for (const p of tlist) cost[p] = dist(p, field[p], Infinity);
    const iters = L === levels.length - 1 ? iterations : iterations + 1;
    for (let em = 0; em < (L === 0 ? 3 : 2); em++) {
      for (let it = 0; it < iters; it++) {
        const fwd = it % 2 === 0, list = fwd ? tlist : [...tlist].reverse(), s = fwd ? 1 : -1;
        for (const p of list) {
          const x = p % w;
          // propagation
          for (const nb of [p - s, p - s * w]) {
            if (nb < 0 || nb >= w * h || field[nb] < 0) continue;
            if (Math.abs((nb % w) - x) > 1) continue;
            const cand = field[nb] + (p - nb);
            if (cand >= 0 && cand < w * h && valid[cand] && cand !== field[p]) { const d = dist(p, cand, cost[p]); if (d < cost[p]) { cost[p] = d; field[p] = cand; } }
          }
          // random search
          let rad = Math.max(w, h);
          const cx = field[p] % w, cy = (field[p] - cx) / w;
          while (rad >= 1) {
            const nx = clamp(Math.round(cx + (Math.random() * 2 - 1) * rad), P, w - P - 1), ny = clamp(Math.round(cy + (Math.random() * 2 - 1) * rad), P, h - P - 1), cand = ny * w + nx;
            if (valid[cand]) { const d = dist(p, cand, cost[p]); if (d < cost[p]) { cost[p] = d; field[p] = cand; } }
            rad >>= 1;
          }
        }
      }
      // voting
      const acc = new Float32Array(w * h * 3), wsum = new Float32Array(w * h);
      for (const p of tlist) {
        const px = p % w, py = (p - px) / w, q = field[p], qx = q % w, qy = (q - qx) / w;
        const wgt = Math.exp(-cost[p] / (2 * 49 * 400));
        for (let j = -P; j <= P; j++) for (let i = -P; i <= P; i++) {
          const x1 = px + i, y1 = py + j; if (x1 < 0 || y1 < 0 || x1 >= w || y1 >= h) continue;
          const t = y1 * w + x1; if (!lv.hole[t]) continue;
          const sIdx = ((qy + j) * w + qx + i) * 3;
          acc[t * 3] += I[sIdx] * wgt; acc[t * 3 + 1] += I[sIdx + 1] * wgt; acc[t * 3 + 2] += I[sIdx + 2] * wgt; wsum[t] += wgt;
        }
      }
      for (const t of holes) if (wsum[t] > 0) { I[t * 3] = acc[t * 3] / wsum[t]; I[t * 3 + 1] = acc[t * 3 + 1] / wsum[t]; I[t * 3 + 2] = acc[t * 3 + 2] / wsum[t]; }
      for (const p of tlist) cost[p] = dist(p, field[p], Infinity);
    }
    // upsample result into next level's hole as initial guess
    if (L + 1 < levels.length) {
      const nx = levels[L + 1];
      for (let i = 0; i < nx.w * nx.h; i++) if (nx.hole[i]) {
        const x = i % nx.w, y = (i - x) / nx.w, q = Math.min(h - 1, y >> 1) * w + Math.min(w - 1, x >> 1);
        nx.img[i * 3] = I[q * 3]; nx.img[i * 3 + 1] = I[q * 3 + 1]; nx.img[i * 3 + 2] = I[q * 3 + 2];
      }
    }
    nnf = field; prevW = w; prevH = h;
  }
  const top = levels[levels.length - 1], out = new ImageData(new Uint8ClampedArray(src.data), W0, H0);
  for (let i = 0; i < W0 * H0; i++) if (mask[i]) { out.data[i * 4] = top.img[i * 3]; out.data[i * 4 + 1] = top.img[i * 3 + 1]; out.data[i * 4 + 2] = top.img[i * 3 + 2]; out.data[i * 4 + 3] = 255; }
  return out;
}

/** Red eye: desaturate strongly red pixels within the region and darken them. */
export function redEye(img: ImageData, pupil = 50, darken = 50) {
  const d = img.data, w = img.width, h = img.height, cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
    const dd = Math.hypot(x - cx, y - cy) / R; if (dd > 1) continue;
    const redness = r - Math.max(g, b);
    if (redness > 30 * (1 - pupil / 200) && r > 60) {
      const k = clamp(redness / 80, 0, 1) * (1 - dd * dd), avg = (g + b) / 2 * (1 - darken / 150);
      d[i] = r + (avg - r) * k; d[i + 1] = g + (avg - g) * k * 0.5; d[i + 2] = b + (avg - b) * k * 0.5;
    }
  }
}
