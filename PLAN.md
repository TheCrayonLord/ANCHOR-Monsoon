# ANCHOR Monsoon: feature inventory

ANCHOR Monsoon is a layered image editor that runs in the browser and installs as an app (PWA). Its goal is to match the feature set of a professional raster editor such as Adobe Photoshop, using only original code, names, icons and artwork.

This file compares Monsoon with Photoshop's public feature set. Each feature is marked:

- **Done**: works.
- **Partial**: works, with the limits noted.
- **Missing**: not built yet.

Everything runs on the device. Monsoon has no server and uploads nothing.

## Documents and files
| Feature | Status | Notes |
|---|---|---|
| New document with presets, units and resolution | Done | 12 presets; pixels, inches or cm; background choice |
| Several open documents in tabs | Done | |
| Open PNG, JPEG, WebP, GIF, BMP, AVIF, SVG | Done | |
| Open TIFF and HEIC | Done | Uses UTIF and heic2any |
| Open and save PSD with layers | Partial | Through ag-psd. Pixel layers, groups, masks, opacity, blend modes and visibility round-trip. Type, shapes and adjustments are saved as pixels. |
| Native format keeping everything | Done | `.monsoon` is a zip of JSON plus PNGs |
| Export PNG, JPEG, WebP, AVIF, GIF, BMP, TIFF, PDF, SVG | Done | AVIF and WebP depend on the browser's encoder; Monsoon reports when one is missing |
| Export As with quality, scale and size estimate; Save for Web | Done | |
| Quick Export, Layers to Files (zip) | Done | |
| Place Embedded (as smart object) | Done | |
| File Info, Revert, Print, Duplicate | Done | |
| Recent files and crash recovery | Done | IndexedDB auto-save at an interval you can set |
| Open files from the OS (installed app) | Done | File handlers in the manifest |
| Generator, cloud documents, libraries | Missing | |

## Layers
| Feature | Status | Notes |
|---|---|---|
| Pixel, type, shape, solid/gradient/pattern fill, adjustment, group and smart object layers | Done | |
| 27 blend modes plus pass-through | Done | Native canvas ops where possible, otherwise per-pixel |
| Opacity and fill opacity | Done | |
| Layer masks: paint, invert, density, feather, disable, apply, view alone | Done | |
| Vector masks | Missing | Use shape layers or pixel masks |
| Clipping masks | Done | |
| Layer styles: drop and inner shadow, outer and inner glow, stroke, colour/gradient/pattern overlay, bevel and emboss, satin | Done | Bevel uses a height-map approximation |
| Copy, paste and clear styles; style presets | Done | 7 original presets |
| Groups, nesting, drag-and-drop reorder | Done | |
| Locks (transparency, pixels, position, all), link, colour tags | Done | |
| Merge down, merge selected, merge visible, stamp visible, flatten | Done | |
| Smart objects: convert, edit contents, replace, non-destructive transform | Done | |
| Smart filters with toggle, edit and delete | Done | Opacity and blend for each filter is stored but not editable in the UI |
| Layer comps | Done | Visibility, position, opacity |
| Align and distribute | Done | |
| Artboards | Missing | Tool slot exists and acts as Move |

## Selections
| Feature | Status | Notes |
|---|---|---|
| Rectangular, elliptical, single row/column marquee; fixed ratio or size | Done | |
| Lasso, polygonal lasso, magnetic lasso | Done | Magnetic snaps to the strongest nearby edge |
| Magic wand, contiguous or global, sample all layers | Done | |
| Quick Selection, Object Selection | Done | Region growing and colour clustering, not AI |
| Select Subject, Select Sky | Partial | Heuristic (border colour clustering and thresholds), not a neural network |
| Color Range (sampled colours, colour families, tones, skin) | Done | |
| Select and Mask: smooth, feather, contrast, shift edge, output to selection, mask or layer | Partial | No refine-edge brush |
| Modify: expand, contract, feather, border, smooth; grow, similar | Done | |
| Quick Mask, save and load selection channels | Done | |
| Transform selection | Done | |

## Painting and retouching tools
| Feature | Status | Notes |
|---|---|---|
| Brush, pencil, mixer brush, colour replacement | Done | |
| Brush engine: size, hardness, angle, roundness, spacing, jitter, scatter, count, colour dynamics, wet edges, noise, build-up, pressure | Done | 12 original presets; define brush from selection |
| Clone stamp, pattern stamp, history brush, art history brush | Done | |
| Eraser, background eraser, magic eraser | Done | |
| Gradient tool (5 shapes) with editor and presets; paint bucket | Done | 12 original gradients |
| Blur, sharpen, smudge, dodge, burn, sponge | Done | |
| Spot healing, Remove tool, healing brush, patch, content-aware move, red eye | Done | Patch-based inpainting; quality is good on texture, weaker on structure |
| Content-aware fill | Done | Multi-scale PatchMatch |
| Generative fill, neural filters | Missing | Need an AI model |

## Type and vectors
| Feature | Status | Notes |
|---|---|---|
| Point and paragraph type, vertical type, type mask | Done | |
| Font, weight, size, leading, tracking, baseline, scale, faux styles, caps, underline, strike, alignment, indent | Done | One style per layer; no per-character styling |
| Warp text (arc, arch, bulge, flag, wave, rise) | Done | |
| Type on a path | Missing | |
| Pen, freeform pen, curvature pen, add/delete/convert anchor, path and direct selection | Done | |
| Rectangle (rounded), ellipse, triangle, polygon and star, line with arrows, 16 original custom shapes | Done | |
| Live shape fill (colour, gradient, pattern) and stroke (align, caps, joins, dashes) | Done | |
| Paths panel: fill, stroke, load as selection, make from selection | Done | |

## Transform and crop
| Feature | Status | Notes |
|---|---|---|
| Free transform, scale, rotate, skew, distort, perspective, flip | Done | |
| Warp with presets and a Bezier mesh | Done | |
| Crop with ratios, overlays, rotation, delete or keep pixels | Done | |
| Perspective crop | Done | |
| Image size with resampling, canvas size with anchor, rotate canvas, trim, reveal all | Done | |
| Content-aware scale, puppet warp, perspective warp | Missing | |

## Adjustments and filters
| Feature | Status | Notes |
|---|---|---|
| Brightness/Contrast, Levels, Curves, Exposure, Vibrance, Hue/Saturation, Color Balance, Black & White, Photo Filter, Channel Mixer, Color Lookup, Invert, Posterize, Threshold, Gradient Map, Selective Color | Done | As adjustment layers or direct edits, with live previews |
| Auto Tone, Auto Contrast, Auto Color, Desaturate, Equalize, Replace Color, Shadows/Highlights, HDR Toning | Done | |
| Develop (Camera Raw style): white balance, tone, presence, detail, effects, auto | Partial | Works on the active pixel layer; no raw decoding (Abyss does that) and no local masks |
| Filters: blur (incl. tilt-shift, iris, lens blur), sharpen (incl. smart sharpen, high pass), noise, distort, stylize, pixelate, render (clouds, fibers, lens flare), other | Done | About 61 filters with live previews |
| Liquify: forward warp, reconstruct, smooth, twirl, pucker, bloat, push, freeze and thaw | Done | No face-aware sliders |
| Lens correction: distortion, chromatic aberration, vignette, perspective, angle, scale | Done | No lens profile database |
| Fade last command | Done | |
| Filter Gallery as one dialog | Partial | Filter dialogs let you switch between filters of the same family |
| Vanishing point, 3D, video timeline, animation frames | Missing | |

## Colour
| Feature | Status | Notes |
|---|---|---|
| Colour picker (HSB, RGB, hex, web-safe, sample from screen where supported) | Done | |
| Color panel (HSB, RGB, CMYK, Lab sliders), swatches | Done | |
| Grayscale, indexed and duotone modes | Done | |
| 16 and 32 bits per channel | Missing | 8-bit only |
| True CMYK and Lab documents, ICC profiles | Missing | CMYK proof view is a simulation |
| Proof views (grayscale, CMYK, colour blindness) | Partial | Simulated |

## Workspace
| Feature | Status | Notes |
|---|---|---|
| Menus with keyboard shortcuts close to the industry standard; searchable shortcut list | Done | |
| Panels: Layers, Channels, Paths, History (snapshots), Properties, Adjustments, Styles, Color, Swatches, Gradients, Patterns, Shapes, Brushes, Character/Paragraph, Navigator, Histogram, Info, Actions, Layer Comps | Done | |
| Workspaces (Essentials, Photography, Painting, Graphic and Web) | Done | |
| Rulers, guides, guide layouts, grid, pixel grid, snapping | Done | |
| Zoom, pan, rotate view, pinch zoom, screen modes | Done | |
| Colour sampler, ruler with straighten, notes, count tool | Done | |
| Actions: record, play, edit, batch | Partial | Records menu commands and dialogs, not brush strokes |
| Preferences (theme, interface scale, history states, auto-save, units) | Done | |
| Phone layout with bottom sheets and touch | Done | Tested at iPhone 14 size |
| Offline use and install | Done | Service worker precache |
| Scripting, plugins, cloud sync | Missing | |
