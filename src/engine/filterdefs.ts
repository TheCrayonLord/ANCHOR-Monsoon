// Filter catalogue used by the Filter menu, the filter dialog and smart filters.
import * as F from './filters';

export interface Param { key: string; label: string; type: 'range' | 'select' | 'check' | 'color'; min?: number; max?: number; step?: number; def: any; options?: [any, string][] ; unit?: string }
export interface FilterDef {
  id: string; name: string; cat: string; params: Param[];
  run: (src: ImageData, p: any, ctx: { fg: string; bg: string; scale: number }) => ImageData;
  generates?: boolean; // ignores input pixels
}
const R = (key: string, label: string, min: number, max: number, def: number, step = 1, unit = ''): Param => ({ key, label, type: 'range', min, max, def, step, unit });
const S = (key: string, label: string, options: [any, string][], def: any): Param => ({ key, label, type: 'select', options, def });
const C = (key: string, label: string, def: boolean): Param => ({ key, label, type: 'check', def });

export const FILTERS: FilterDef[] = [
  // Blur
  { id: 'gaussian', name: 'Gaussian Blur', cat: 'Blur', params: [R('radius', 'Radius', 0.1, 250, 4, 0.1, 'px')], run: (s, p, c) => F.gaussianBlur(s, p.radius * c.scale) },
  { id: 'box', name: 'Box Blur', cat: 'Blur', params: [R('radius', 'Radius', 1, 200, 6, 1, 'px')], run: (s, p, c) => F.boxBlur(s, p.radius * c.scale) },
  { id: 'motion', name: 'Motion Blur', cat: 'Blur', params: [R('angle', 'Angle', -90, 90, 0, 1, '°'), R('distance', 'Distance', 1, 400, 20, 1, 'px')], run: (s, p, c) => F.motionBlur(s, p.angle, p.distance * c.scale) },
  { id: 'radial', name: 'Radial Blur', cat: 'Blur', params: [R('amount', 'Amount', 1, 100, 10), S('method', 'Method', [['spin', 'Spin'], ['zoom', 'Zoom']], 'spin'), R('cx', 'Center X', 0, 1, 0.5, 0.01), R('cy', 'Center Y', 0, 1, 0.5, 0.01)], run: (s, p) => F.radialBlur(s, p.amount, p.cx, p.cy, p.method === 'zoom') },
  { id: 'surface', name: 'Surface Blur', cat: 'Blur', params: [R('radius', 'Radius', 1, 30, 5, 1, 'px'), R('threshold', 'Threshold', 2, 255, 15)], run: (s, p, c) => F.surfaceBlur(s, p.radius * c.scale, p.threshold) },
  { id: 'smartblur', name: 'Smart Blur', cat: 'Blur', params: [R('radius', 'Radius', 1, 20, 3, 1, 'px'), R('threshold', 'Threshold', 1, 100, 25)], run: (s, p, c) => F.surfaceBlur(s, p.radius * c.scale, p.threshold) },
  { id: 'lensblur', name: 'Lens Blur', cat: 'Blur', params: [R('radius', 'Radius', 1, 40, 8, 1, 'px'), R('bright', 'Specular brightness', 0, 50, 10)], run: (s, p, c) => F.lensBlur(s, p.radius * c.scale, p.bright) },
  { id: 'blur', name: 'Blur', cat: 'Blur', params: [], run: (s) => F.gaussianBlur(s, 1) },
  { id: 'blurmore', name: 'Blur More', cat: 'Blur', params: [], run: (s) => F.gaussianBlur(s, 2.5) },
  { id: 'average', name: 'Average', cat: 'Blur', params: [], run: (s) => { const d = s.data; let r = 0, g = 0, b = 0, n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3]) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } const o = new ImageData(new Uint8ClampedArray(d), s.width, s.height); for (let i = 0; i < d.length; i += 4) { o.data[i] = r / n; o.data[i + 1] = g / n; o.data[i + 2] = b / n; } return o; } },
  // Blur Gallery
  { id: 'tiltshift', name: 'Tilt-Shift', cat: 'Blur Gallery', params: [R('center', 'Focus line', 0, 1, 0.5, 0.01), R('band', 'Sharp band', 0, 1, 0.2, 0.01), R('transition', 'Transition', 0.01, 1, 0.2, 0.01), R('blur', 'Blur', 1, 60, 12), R('angle', 'Angle', -90, 90, 0)], run: (s, p, c) => F.tiltShift(s, p.center, p.band, p.transition, p.blur * c.scale, p.angle) },
  { id: 'iris', name: 'Iris Blur', cat: 'Blur Gallery', params: [R('cx', 'Center X', 0, 1, 0.5, 0.01), R('cy', 'Center Y', 0, 1, 0.5, 0.01), R('rx', 'Width', 0.05, 1, 0.3, 0.01), R('ry', 'Height', 0.05, 1, 0.3, 0.01), R('feather', 'Feather', 0.01, 1, 0.4, 0.01), R('blur', 'Blur', 1, 60, 15)], run: (s, p, c) => F.irisBlur(s, p.cx, p.cy, p.rx, p.ry, p.feather, p.blur * c.scale) },
  { id: 'fieldblur', name: 'Field Blur', cat: 'Blur Gallery', params: [R('blur', 'Blur', 1, 60, 10)], run: (s, p, c) => F.gaussianBlur(s, p.blur * c.scale) },
  { id: 'spinblur', name: 'Spin Blur', cat: 'Blur Gallery', params: [R('amount', 'Blur angle', 1, 100, 20), R('cx', 'Center X', 0, 1, 0.5, 0.01), R('cy', 'Center Y', 0, 1, 0.5, 0.01)], run: (s, p) => F.radialBlur(s, p.amount, p.cx, p.cy, false) },
  // Sharpen
  { id: 'unsharp', name: 'Unsharp Mask', cat: 'Sharpen', params: [R('amount', 'Amount', 1, 500, 100, 1, '%'), R('radius', 'Radius', 0.1, 100, 1.5, 0.1, 'px'), R('threshold', 'Threshold', 0, 255, 0)], run: (s, p, c) => F.unsharpMask(s, p.amount, p.radius * c.scale, p.threshold) },
  { id: 'smartsharpen', name: 'Smart Sharpen', cat: 'Sharpen', params: [R('amount', 'Amount', 1, 500, 150, 1, '%'), R('radius', 'Radius', 0.1, 64, 1, 0.1, 'px'), R('noise', 'Reduce noise', 0, 100, 10, 1, '%')], run: (s, p, c) => F.smartSharpen(s, p.amount, p.radius * c.scale, p.noise) },
  { id: 'sharpen', name: 'Sharpen', cat: 'Sharpen', params: [], run: (s) => F.sharpen(s) },
  { id: 'sharpenmore', name: 'Sharpen More', cat: 'Sharpen', params: [], run: (s) => F.sharpenMore(s) },
  { id: 'sharpenedges', name: 'Sharpen Edges', cat: 'Sharpen', params: [], run: (s) => F.sharpenEdges(s) },
  // Noise
  { id: 'addnoise', name: 'Add Noise', cat: 'Noise', params: [R('amount', 'Amount', 0.1, 100, 12, 0.1, '%'), S('dist', 'Distribution', [['uniform', 'Uniform'], ['gaussian', 'Gaussian']], 'gaussian'), C('mono', 'Monochromatic', false)], run: (s, p) => F.addNoise(s, p.amount, p.dist === 'gaussian', p.mono) },
  { id: 'reducenoise', name: 'Reduce Noise', cat: 'Noise', params: [R('strength', 'Strength', 0, 10, 6), R('preserve', 'Preserve details', 0, 100, 60, 1, '%')], run: (s, p) => F.reduceNoise(s, p.strength, p.preserve) },
  { id: 'median', name: 'Median', cat: 'Noise', params: [R('radius', 'Radius', 1, 50, 2, 1, 'px')], run: (s, p, c) => F.median(s, p.radius * c.scale) },
  { id: 'dust', name: 'Dust & Scratches', cat: 'Noise', params: [R('radius', 'Radius', 1, 50, 2, 1, 'px'), R('threshold', 'Threshold', 0, 255, 12)], run: (s, p, c) => F.dustScratches(s, p.radius * c.scale, p.threshold) },
  { id: 'despeckle', name: 'Despeckle', cat: 'Noise', params: [], run: (s) => F.despeckle(s) },
  // Stylize
  { id: 'emboss', name: 'Emboss', cat: 'Stylize', params: [R('angle', 'Angle', -180, 180, 135, 1, '°'), R('height', 'Height', 1, 10, 3, 1, 'px'), R('amount', 'Amount', 1, 500, 100, 1, '%')], run: (s, p) => F.emboss(s, p.angle, p.height, p.amount) },
  { id: 'findedges', name: 'Find Edges', cat: 'Stylize', params: [], run: (s) => F.findEdges(s) },
  { id: 'trace', name: 'Trace Contour', cat: 'Stylize', params: [R('level', 'Level', 0, 255, 128)], run: (s, p) => F.traceContour(s, p.level) },
  { id: 'solarize', name: 'Solarize', cat: 'Stylize', params: [], run: (s) => F.solarize(s) },
  { id: 'wind', name: 'Wind', cat: 'Stylize', params: [R('strength', 'Strength', 5, 200, 40), S('dir', 'Direction', [['left', 'From the left'], ['right', 'From the right']], 'right')], run: (s, p) => F.wind(s, p.strength, p.dir === 'left') },
  { id: 'diffuse', name: 'Diffuse', cat: 'Stylize', params: [R('amount', 'Amount', 1, 10, 2)], run: (s, p) => F.diffuse(s, p.amount) },
  { id: 'oil', name: 'Oil Paint', cat: 'Stylize', params: [R('radius', 'Stylization', 1, 10, 4), R('levels', 'Levels', 4, 40, 16)], run: (s, p) => F.oilPaint(s, p.radius, p.levels) },
  { id: 'tiles', name: 'Tiles', cat: 'Stylize', params: [R('n', 'Number of tiles', 2, 40, 10), R('offset', 'Max offset', 1, 99, 10, 1, '%')], run: (s, p) => F.tiles(s, p.n, p.offset) },
  { id: 'extrude', name: 'Extrude', cat: 'Stylize', params: [R('size', 'Size', 4, 100, 24, 1, 'px')], run: (s, p) => F.extrude(s, p.size) },
  // Pixelate
  { id: 'mosaic', name: 'Mosaic', cat: 'Pixelate', params: [R('size', 'Cell size', 2, 200, 12, 1, 'px')], run: (s, p, c) => F.mosaic(s, p.size * c.scale) },
  { id: 'crystallize', name: 'Crystallize', cat: 'Pixelate', params: [R('size', 'Cell size', 3, 300, 14, 1, 'px')], run: (s, p, c) => F.crystallize(s, p.size * c.scale) },
  { id: 'pointillize', name: 'Pointillize', cat: 'Pixelate', params: [R('size', 'Cell size', 3, 300, 8, 1, 'px')], run: (s, p, c) => F.pointillize(s, p.size * c.scale, c.bg) },
  { id: 'halftone', name: 'Color Halftone', cat: 'Pixelate', params: [R('radius', 'Max radius', 4, 127, 6, 1, 'px')], run: (s, p, c) => F.colorHalftone(s, p.radius * c.scale) },
  { id: 'fragment', name: 'Fragment', cat: 'Pixelate', params: [], run: (s) => F.fragment(s) },
  { id: 'mezzotint', name: 'Mezzotint', cat: 'Pixelate', params: [], run: (s) => F.mezzotint(s) },
  // Distort
  { id: 'twirl', name: 'Twirl', cat: 'Distort', params: [R('angle', 'Angle', -999, 999, 120, 1, '°')], run: (s, p) => F.twirl(s, p.angle) },
  { id: 'pinch', name: 'Pinch', cat: 'Distort', params: [R('amount', 'Amount', -100, 100, 50, 1, '%')], run: (s, p) => F.pinch(s, p.amount) },
  { id: 'spherize', name: 'Spherize', cat: 'Distort', params: [R('amount', 'Amount', -100, 100, 60, 1, '%')], run: (s, p) => F.spherize(s, p.amount) },
  { id: 'wave', name: 'Wave', cat: 'Distort', params: [R('amp', 'Amplitude', 1, 200, 10, 1, 'px'), R('wl', 'Wavelength', 2, 999, 80, 1, 'px')], run: (s, p, c) => F.wave(s, p.amp * c.scale, p.wl * c.scale) },
  { id: 'ripple', name: 'Ripple', cat: 'Distort', params: [R('amount', 'Amount', -999, 999, 100, 1, '%'), S('size', 'Size', [[0, 'Small'], [1, 'Medium'], [2, 'Large']], 1)], run: (s, p, c) => F.ripple(s, p.amount * c.scale, +p.size) },
  { id: 'zigzag', name: 'ZigZag', cat: 'Distort', params: [R('amount', 'Amount', -100, 100, 30), R('ridges', 'Ridges', 1, 20, 5)], run: (s, p) => F.zigzag(s, p.amount, p.ridges) },
  { id: 'polar', name: 'Polar Coordinates', cat: 'Distort', params: [S('mode', 'Mode', [['rect', 'Rectangular to Polar'], ['polar', 'Polar to Rectangular']], 'rect')], run: (s, p) => F.polar(s, p.mode !== 'rect') },
  { id: 'shear', name: 'Shear', cat: 'Distort', params: [R('amount', 'Amount', -100, 100, 30)], run: (s, p) => F.shear(s, p.amount) },
  { id: 'glass', name: 'Glass', cat: 'Distort', params: [R('distortion', 'Distortion', 0, 20, 5), R('smooth', 'Smoothness', 1, 15, 3)], run: (s, p, c) => F.glass(s, p.distortion * c.scale, p.smooth) },
  { id: 'ocean', name: 'Ocean Ripple', cat: 'Distort', params: [R('size', 'Ripple size', 1, 15, 9), R('mag', 'Magnitude', 0, 20, 9)], run: (s, p, c) => F.oceanRipple(s, p.size, p.mag * c.scale) },
  // Render
  { id: 'clouds', name: 'Clouds', cat: 'Render', params: [], generates: true, run: (s, _p, c) => F.clouds(s.width, s.height, c.fg, c.bg) },
  { id: 'diffclouds', name: 'Difference Clouds', cat: 'Render', params: [], run: (s, _p, c) => F.differenceClouds(s, c.fg, c.bg) },
  { id: 'fibers', name: 'Fibers', cat: 'Render', params: [R('variance', 'Variance', 1, 64, 16), R('strength', 'Strength', 1, 64, 4)], generates: true, run: (s, p, c) => F.fibers(s.width, s.height, p.variance, p.strength, c.fg, c.bg) },
  { id: 'flare', name: 'Lens Flare', cat: 'Render', params: [R('cx', 'Center X', 0, 1, 0.3, 0.01), R('cy', 'Center Y', 0, 1, 0.3, 0.01), R('brightness', 'Brightness', 10, 300, 100, 1, '%')], run: (s, p) => F.lensFlare(s, p.cx, p.cy, p.brightness) },
  { id: 'vignette', name: 'Vignette', cat: 'Render', params: [R('amount', 'Amount', -100, 100, 50), R('midpoint', 'Midpoint', 0, 95, 40)], run: (s, p) => F.vignetteFilter(s, p.amount, p.midpoint) },
  // Other
  { id: 'highpass', name: 'High Pass', cat: 'Other', params: [R('radius', 'Radius', 0.1, 250, 10, 0.1, 'px')], run: (s, p, c) => F.highPass(s, p.radius * c.scale) },
  { id: 'maximum', name: 'Maximum', cat: 'Other', params: [R('radius', 'Radius', 1, 50, 2, 1, 'px')], run: (s, p, c) => F.maximum(s, p.radius * c.scale) },
  { id: 'minimum', name: 'Minimum', cat: 'Other', params: [R('radius', 'Radius', 1, 50, 2, 1, 'px')], run: (s, p, c) => F.minimum(s, p.radius * c.scale) },
  { id: 'offset', name: 'Offset', cat: 'Other', params: [R('dx', 'Horizontal', -2000, 2000, 50, 1, 'px'), R('dy', 'Vertical', -2000, 2000, 50, 1, 'px'), C('wrap', 'Wrap around', true)], run: (s, p, c) => F.offsetFilter(s, p.dx * c.scale, p.dy * c.scale, p.wrap) },
  { id: 'custom', name: 'Custom', cat: 'Other', params: [S('kernel', 'Kernel', [['edge', 'Edge enhance'], ['outline', 'Outline'], ['sobel', 'Sobel'], ['blur', 'Soft blur'], ['ridge', 'Ridge']], 'edge'), R('scale', 'Scale', 1, 16, 1), R('offset', 'Offset', -128, 128, 0)], run: (s, p) => F.convolve(s, ({ edge: [0, 0, 0, -1, 2, 0, 0, 0, 0], outline: [-1, -1, -1, -1, 8, -1, -1, -1, -1], sobel: [-1, 0, 1, -2, 0, 2, -1, 0, 1], blur: [1, 2, 1, 2, 4, 2, 1, 2, 1], ridge: [0, -1, 0, -1, 4, -1, 0, -1, 0] } as any)[p.kernel], p.kernel === 'blur' ? 16 * p.scale : p.scale, p.offset + (p.kernel === 'edge' ? 0 : p.kernel === 'blur' ? 0 : 0)) },
  // Adjust-like filters that live in the Filter menu
  { id: 'shadowshl', name: 'Shadows/Highlights', cat: 'Adjust', params: [R('shadows', 'Shadows', 0, 100, 35, 1, '%'), R('highlights', 'Highlights', 0, 100, 0, 1, '%'), R('radius', 'Radius', 2, 200, 30, 1, 'px')], run: (s, p, c) => F.shadowsHighlights(s, p.shadows, p.highlights, p.radius * c.scale) },
  { id: 'hdr', name: 'HDR Toning', cat: 'Adjust', params: [R('radius', 'Radius', 2, 200, 40, 1, 'px'), R('strength', 'Strength', 0, 100, 50), R('gamma', 'Gamma', 0.2, 3, 1, 0.01), R('detail', 'Detail', 0, 300, 60, 1, '%')], run: (s, p, c) => F.hdrToning(s, p.radius * c.scale, p.strength, p.gamma, p.detail) },
];
export const FILTER_MAP = Object.fromEntries(FILTERS.map((f) => [f.id, f]));
export const defaults = (f: FilterDef) => Object.fromEntries(f.params.map((p) => [p.key, p.def]));
export const FILTER_CATS = [...new Set(FILTERS.filter((f) => f.cat !== 'Adjust').map((f) => f.cat))];
