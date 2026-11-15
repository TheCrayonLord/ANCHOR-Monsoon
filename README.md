# ANCHOR Monsoon

ANCHOR Monsoon is a layered image editor that runs in your browser and installs as an app on desktop, Android and iPhone. Everything happens on your device: nothing you open is uploaded.

It sits alongside ANCHOR Tsunami (PDF) and ANCHOR Abyss (photo library and raw).

**Live app:** https://thecrayonlord.github.io/ANCHOR-Monsoon/

## What it does

- **Layers:** pixel, type, shape, fill, adjustment, group and smart object layers; 27 blend modes; masks; clipping; layer styles; comps.
- **Selections:** every marquee and lasso, magic wand, quick and object selection, Select Subject and Sky, Color Range, Select and Mask, Quick Mask.
- **Tools:** a full brush engine, clone and history brushes, healing, Remove, patch, content-aware fill and move, gradients, dodge and burn, pen and shape tools, and type.
- **Adjustments and filters:** 16 adjustment types, about 61 filters, Liquify, lens correction and a Develop dialog, all with live preview.
- **Files:** layered PSD in and out, TIFF and HEIC import, export to PDF and every common image format, plus the native `.monsoon` format.
- **Automation and safety:** recordable actions, batch processing and crash recovery.

See [PLAN.md](PLAN.md) for the full feature list compared with Photoshop, including what is partial or missing.

## Install it as an app

- **Desktop Chrome or Edge:** click the install icon in the address bar.
- **iPhone:** open the link in Safari, tap Share, then Add to Home Screen.
- **Android:** open the browser menu and tap Install app.

After the first visit it works offline.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check and build to dist/
npm run preview    # serve dist/ on port 4175
```

To test, run `npm run preview` first, then run one of these:

```bash
node tests/e2e.cjs        # every tool, command, filter, dialog and file format
node tests/showcase.cjs   # desktop and phone screenshots into tests/shots/
```

Every push to `main` builds and deploys to GitHub Pages (`.github/workflows/pages.yml`).

## Stack

Vite, React 18 and TypeScript, with a Canvas 2D engine written for this app. Libraries: ag-psd (PSD), utif (TIFF), heic2any (HEIC), gifenc (GIF), pdf-lib (PDF), jszip and lucide-react icons.

All names, icons, presets and artwork are original to ANCHOR Monsoon.
