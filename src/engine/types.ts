import type { Canvas, Pt, Rect, RGB } from './util';

export type BlendMode =
  | 'normal' | 'dissolve'
  | 'darken' | 'multiply' | 'color-burn' | 'linear-burn' | 'darker-color'
  | 'lighten' | 'screen' | 'color-dodge' | 'linear-dodge' | 'lighter-color'
  | 'overlay' | 'soft-light' | 'hard-light' | 'vivid-light' | 'linear-light' | 'pin-light' | 'hard-mix'
  | 'difference' | 'exclusion' | 'subtract' | 'divide'
  | 'hue' | 'saturation' | 'color' | 'luminosity'
  | 'pass-through';

export const BLEND_GROUPS: BlendMode[][] = [
  ['normal', 'dissolve'],
  ['darken', 'multiply', 'color-burn', 'linear-burn', 'darker-color'],
  ['lighten', 'screen', 'color-dodge', 'linear-dodge', 'lighter-color'],
  ['overlay', 'soft-light', 'hard-light', 'vivid-light', 'linear-light', 'pin-light', 'hard-mix'],
  ['difference', 'exclusion', 'subtract', 'divide'],
  ['hue', 'saturation', 'color', 'luminosity'],
];
export const blendLabel = (m: BlendMode) => m === 'linear-dodge' ? 'Linear Dodge (Add)' : m.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join(' ');

export type LayerKind = 'raster' | 'text' | 'shape' | 'adjustment' | 'fill' | 'group' | 'smart';

export interface Mask {
  canvas: Canvas; // opaque grayscale; white reveals
  x: number; y: number;
  bg: number; // value outside the canvas (0 or 255)
  enabled: boolean; linked: boolean;
  density: number; feather: number;
}

export interface GradientStop { pos: number; color: string }
export interface OpacityStop { pos: number; a: number }
export interface Gradient { name?: string; stops: GradientStop[]; opacity: OpacityStop[] }
export type GradientShape = 'linear' | 'radial' | 'angle' | 'reflected' | 'diamond';

export interface StyleShadow { enabled: boolean; color: string; opacity: number; angle: number; distance: number; size: number; spread: number; blend: BlendMode }
export interface StyleGlow { enabled: boolean; color: string; opacity: number; size: number; spread: number; blend: BlendMode }
export interface StyleStroke { enabled: boolean; color: string; size: number; position: 'outside' | 'inside' | 'center'; opacity: number; blend: BlendMode }
export interface StyleOverlay { enabled: boolean; color: string; opacity: number; blend: BlendMode }
export interface StyleGradOverlay { enabled: boolean; gradient: Gradient; shape: GradientShape; angle: number; scale: number; reverse: boolean; opacity: number; blend: BlendMode }
export interface StylePatternOverlay { enabled: boolean; pattern: string; scale: number; opacity: number; blend: BlendMode }
export interface StyleBevel { enabled: boolean; style: 'inner' | 'outer' | 'emboss' | 'pillow'; depth: number; size: number; soften: number; angle: number; altitude: number; up: boolean; highlight: string; hOpacity: number; shadow: string; sOpacity: number }
export interface StyleSatin { enabled: boolean; color: string; opacity: number; angle: number; distance: number; size: number; invert: boolean; blend: BlendMode }
export interface LayerStyles {
  dropShadow?: StyleShadow; innerShadow?: StyleShadow;
  outerGlow?: StyleGlow; innerGlow?: StyleGlow;
  stroke?: StyleStroke; colorOverlay?: StyleOverlay; gradientOverlay?: StyleGradOverlay; patternOverlay?: StylePatternOverlay;
  bevel?: StyleBevel; satin?: StyleSatin;
}

export interface TextData {
  text: string; x: number; y: number;
  font: string; size: number; weight: number; italic: boolean; color: string;
  align: 'left' | 'center' | 'right' | 'justify'; leading: number; tracking: number;
  underline: boolean; strike: boolean; caps: 'none' | 'all' | 'small';
  vertical: boolean; boxWidth: number; // 0 = point text
  matrix: [number, number, number, number, number, number];
  warp: { style: 'none' | 'arc' | 'arch' | 'bulge' | 'flag' | 'wave' | 'rise'; bend: number };
  antialias: boolean;
  faux: { bold: boolean; italic: boolean };
  baseline: number; scaleX: number; scaleY: number; indent: number; spaceBefore: number; spaceAfter: number;
}

export interface PathPoint { x: number; y: number; ix: number; iy: number; ox: number; oy: number; smooth: boolean }
export interface SubPath { points: PathPoint[]; closed: boolean; op?: 'add' | 'subtract' | 'intersect' | 'xor' }
export interface VectorPath { subpaths: SubPath[] }

export interface ShapeData {
  path: VectorPath;
  fill: { type: 'none' | 'color' | 'gradient' | 'pattern'; color: string; gradient?: Gradient; gradShape?: GradientShape; angle?: number; pattern?: string };
  stroke: { enabled: boolean; color: string; width: number; align: 'inside' | 'center' | 'outside'; dash: number[]; cap: CanvasLineCap; join: CanvasLineJoin };
  meta?: { kind: string; rect?: Rect; radius?: number; sides?: number; star?: number };
}

export interface FillData { type: 'color' | 'gradient' | 'pattern'; color: string; gradient: Gradient; shape: GradientShape; angle: number; scale: number; reverse: boolean; pattern: string; patScale: number }

export type AdjType = 'brightness' | 'levels' | 'curves' | 'exposure' | 'vibrance' | 'hsl' | 'colorBalance' | 'bw' | 'photoFilter'
  | 'channelMixer' | 'lookup' | 'invert' | 'posterize' | 'threshold' | 'gradientMap' | 'selectiveColor';
export interface Adjustment { type: AdjType; p: any }

export interface SmartFilter { id: string; name: string; filter: string; params: any; enabled: boolean; opacity: number; blend: BlendMode }
export interface SmartData {
  source: Canvas; name: string;
  quad: [Pt, Pt, Pt, Pt]; // where the source corners land in the document
  filters: SmartFilter[];
}

export interface Layer {
  id: string; name: string; kind: LayerKind;
  visible: boolean; opacity: number; fillOpacity: number; blend: BlendMode;
  locks: { pixels: boolean; position: boolean; transparency: boolean; all: boolean };
  clip: boolean;
  x: number; y: number; // canvas offset for raster/smart cache
  canvas?: Canvas;
  mask?: Mask;
  styles?: LayerStyles; stylesOn?: boolean;
  text?: TextData; shape?: ShapeData; fill?: FillData; adj?: Adjustment; smart?: SmartData;
  children?: Layer[]; collapsed?: boolean;
  artboard?: { x: number; y: number; w: number; h: number; bg: string | null };
  vmask?: { path: VectorPath; enabled: boolean; feather: number; density: number };
  color?: string; // layer colour tag
  linkId?: string;
  ver: number;
}

export interface Guide { axis: 'h' | 'v'; pos: number }
export interface Note { id: string; x: number; y: number; text: string; author: string; color: string }
export interface Sampler { x: number; y: number }
export interface NamedPath { id: string; name: string; path: VectorPath; work?: boolean }
export interface AlphaChannel { id: string; name: string; canvas: Canvas }

export type ColorMode = 'rgb' | 'grayscale' | 'bitmap' | 'indexed' | 'cmyk' | 'lab' | 'duotone';

export interface DocState {
  width: number; height: number;
  layers: Layer[]; // index 0 = bottom
  activeId: string | null; selectedIds: string[];
  selection: Canvas | null; // opaque grayscale doc-sized
  paths: NamedPath[]; channels: AlphaChannel[];
  guides: Guide[]; notes: Note[]; samplers: Sampler[]; counts: Pt[];
  mode: ColorMode; resolution: number;
  comps: LayerComp[];
}
export interface LayerComp { id: string; name: string; layers: Record<string, { visible: boolean; x: number; y: number; opacity: number; stylesOn?: boolean }> }

export interface HistoryState { id: number; label: string; state: DocState; thumb?: string }

export type { Rect, Pt, RGB };
