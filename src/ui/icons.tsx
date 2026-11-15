// Tool icons (lucide line icons plus a few drawn here).
import * as L from 'lucide-react';
import type { ToolId } from '../app';

const Svg = ({ children }: { children: React.ReactNode }) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
export const TOOL_ICONS: Partial<Record<ToolId, React.ReactNode>> = {
  move: <L.Move size={18} />, artboard: <L.Frame size={18} />,
  'marquee-rect': <Svg><rect x="4" y="5" width="16" height="14" strokeDasharray="3 2" /></Svg>, 'marquee-ellipse': <Svg><ellipse cx="12" cy="12" rx="8" ry="6.5" strokeDasharray="3 2" /></Svg>,
  'marquee-row': <Svg><line x1="3" y1="12" x2="21" y2="12" strokeDasharray="3 2" /></Svg>, 'marquee-col': <Svg><line x1="12" y1="3" x2="12" y2="21" strokeDasharray="3 2" /></Svg>,
  lasso: <L.Lasso size={18} />, 'lasso-poly': <Svg><path d="M5 18 L4 8 L12 4 L20 9 L15 14 L9 13 Z" strokeDasharray="3 2" /></Svg>, 'lasso-magnetic': <L.Magnet size={18} />,
  'object-select': <L.ScanSearch size={18} />, 'quick-select': <L.Brush size={18} />, 'magic-wand': <L.WandSparkles size={18} />,
  crop: <L.Crop size={18} />, 'crop-perspective': <Svg><path d="M7 3v14h14M3 7h4M17 21v-4M7 7l10 3v7" /></Svg>, slice: <L.Slice size={18} />, frame: <L.SquareDashed size={18} />,
  eyedropper: <L.Pipette size={18} />, 'color-sampler': <L.Crosshair size={18} />, ruler: <L.Ruler size={18} />, note: <L.StickyNote size={18} />, count: <L.Hash size={18} />,
  'spot-heal': <L.Bandage size={18} />, remove: <L.Eraser size={18} />, heal: <L.HeartPulse size={18} />, patch: <L.SquareDashedMousePointer size={18} />, 'content-move': <L.MoveDiagonal size={18} />, 'red-eye': <L.Eye size={18} />,
  brush: <L.Paintbrush size={18} />, pencil: <L.Pencil size={18} />, 'color-replace': <L.Replace size={18} />, mixer: <L.PaintbrushVertical size={18} />,
  clone: <L.Stamp size={18} />, 'pattern-stamp': <L.Grid3x3 size={18} />, 'history-brush': <L.History size={18} />, 'art-history': <L.Sparkles size={18} />,
  eraser: <L.Eraser size={18} />, 'bg-eraser': <Svg><path d="M7 21h10M5 15l7-11 7 11-4 4H9z" /></Svg>, 'magic-eraser': <L.Wand size={18} />,
  gradient: <Svg><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 5v14M11 5v14" opacity=".6" /><path d="M15 5v14" opacity=".3" /></Svg>, bucket: <L.PaintBucket size={18} />,
  blur: <L.Droplet size={18} />, sharpen: <L.Triangle size={18} />, smudge: <L.Hand size={18} />,
  dodge: <Svg><circle cx="9" cy="9" r="5" /><path d="M12.5 12.5L20 20" /></Svg>, burn: <Svg><path d="M6 20c0-5 4-6 4-11 3 2 4 5 4 7a3 3 0 0 0 4-2c1 2 1 3 1 6" /></Svg>, sponge: <L.Cloud size={18} />,
  pen: <L.PenTool size={18} />, 'freeform-pen': <L.Signature size={18} />, 'curvature-pen': <L.Spline size={18} />, 'add-anchor': <L.Plus size={18} />, 'delete-anchor': <L.Minus size={18} />, 'convert-point': <L.ChevronUp size={18} />,
  type: <L.Type size={18} />, 'type-vertical': <Svg><path d="M6 4h12M12 4v6M8 14h8M12 14v6" /></Svg>, 'type-mask': <Svg><path d="M5 5h14M12 5v14" strokeDasharray="3 2" /></Svg>, 'type-mask-vertical': <Svg><path d="M6 4h12M12 4v16" strokeDasharray="3 2" /></Svg>,
  'path-select': <L.MousePointer2 size={18} />, 'direct-select': <L.MousePointer size={18} />,
  'shape-rect': <L.Square size={18} />, 'shape-ellipse': <L.Circle size={18} />, 'shape-triangle': <L.Triangle size={18} />, 'shape-polygon': <L.Hexagon size={18} />, 'shape-line': <L.Slash size={18} />, 'shape-custom': <L.Shapes size={18} />,
  hand: <L.Hand size={18} />, 'rotate-view': <L.RotateCw size={18} />, zoom: <L.ZoomIn size={18} />,
};
