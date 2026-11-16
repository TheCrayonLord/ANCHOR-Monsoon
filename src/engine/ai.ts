// On-device subject segmentation. The model (about 46 MB) downloads once from this site, is kept in the browser's
// cache, and then runs offline with WebAssembly. No image ever leaves the device.
import { Canvas, ctx2d, makeCanvas } from './util';

const MODEL = 'models/subject-v1.onnx';
const CACHE = 'anchor-monsoon-ai';
const SIZE = 1024;
let session: Promise<any> | null = null;

export type Progress = (stage: string, frac: number) => void;

async function fetchModel(onProgress?: Progress): Promise<ArrayBuffer> {
  const url = new URL(MODEL, document.baseURI).href;
  let cache: Cache | null = null;
  try { cache = await caches.open(CACHE); const hit = await cache.match(url); if (hit) { onProgress?.('Loading AI model', 1); return hit.arrayBuffer(); } } catch { cache = null; }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error('Could not download the AI model. Connect to the internet once so it can be saved for offline use.');
  const total = +(res.headers.get('content-length') || 0) || 46e6;
  const reader = res.body.getReader(); const parts: Uint8Array[] = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; onProgress?.('Downloading AI model (one time)', Math.min(0.99, got / total)); }
  const buf = new Uint8Array(got); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
  try { await cache?.put(url, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } })); } catch { /* storage full: still works this session */ }
  return buf.buffer;
}
export async function isModelCached(): Promise<boolean> {
  try { const c = await caches.open(CACHE); return !!(await c.match(new URL(MODEL, document.baseURI).href)); } catch { return false; }
}
function getSession(onProgress?: Progress) {
  if (!session) {
    session = (async () => {
      const ort = await import('onnxruntime-web/wasm');
      ort.env.wasm.wasmPaths = new URL('./ort/', document.baseURI).href;
      ort.env.wasm.numThreads = (self as any).crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      ort.env.wasm.proxy = true; // run in a worker so the page stays responsive
      const buf = await fetchModel(onProgress);
      onProgress?.('Starting AI', 1);
      const s = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      return { ort, s };
    })();
    session.catch(() => { session = null; });
  }
  return session;
}
/** Returns an opaque grayscale mask (white = subject) the same size as src. */
export async function subjectMask(src: Canvas, onProgress?: Progress): Promise<Canvas> {
  const { ort, s } = await getSession(onProgress);
  onProgress?.('Finding the subject', 1);
  const t = makeCanvas(SIZE, SIZE), tx = ctx2d(t); tx.fillStyle = '#fff'; tx.fillRect(0, 0, SIZE, SIZE); tx.imageSmoothingQuality = 'high'; tx.drawImage(src, 0, 0, SIZE, SIZE);
  const px = tx.getImageData(0, 0, SIZE, SIZE).data, n = SIZE * SIZE, input = new Float32Array(3 * n);
  let max = 1; for (let i = 0; i < px.length; i += 4) { if (px[i] > max) max = px[i]; if (px[i + 1] > max) max = px[i + 1]; if (px[i + 2] > max) max = px[i + 2]; }
  for (let i = 0; i < n; i++) { input[i] = px[i * 4] / max - 0.5; input[n + i] = px[i * 4 + 1] / max - 0.5; input[2 * n + i] = px[i * 4 + 2] / max - 0.5; }
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });
  const o = out[s.outputNames[0]].data as Float32Array;
  let lo = Infinity, hi = -Infinity; for (let i = 0; i < n; i++) { if (o[i] < lo) lo = o[i]; if (o[i] > hi) hi = o[i]; }
  const k = hi - lo > 1e-6 ? 255 / (hi - lo) : 0, img = new ImageData(SIZE, SIZE);
  // tidy the matte: faint values become clear background, near-solid values become solid subject
  for (let i = 0; i < n; i++) { const v = Math.max(0, Math.min(255, ((o[i] - lo) * k - 26) * (255 / 203))); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  const m = makeCanvas(SIZE, SIZE); ctx2d(m).putImageData(img, 0, 0);
  const r = makeCanvas(src.width, src.height), rx = ctx2d(r); rx.imageSmoothingQuality = 'high'; rx.drawImage(m, 0, 0, src.width, src.height);
  return r;
}
