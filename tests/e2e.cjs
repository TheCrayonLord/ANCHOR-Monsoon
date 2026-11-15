// End-to-end test: every tool, menu command, filter, adjustment, dialog and file format, in Chromium.
const { chromium } = require('playwright');
const URL = process.env.URL || 'http://localhost:4175/';
const fails = []; const note = (s) => console.log(s);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  let errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message + ' ' + (e.stack || '').split('\n').slice(1, 3).join(' '))); p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  p.on('dialog', (d) => d.accept());
  const check = (what) => { if (errs.length) { fails.push(what + ': ' + errs.join(' | ')); errs = []; } };
  await p.goto(URL); await p.waitForSelector('.welcome');
  // a test image: gradient with shapes
  await p.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 800; c.height = 600; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 800, 600); g.addColorStop(0, '#2b6cb0'); g.addColorStop(1, '#f6ad55'); x.fillStyle = g; x.fillRect(0, 0, 800, 600);
    x.fillStyle = '#e53e3e'; x.beginPath(); x.arc(400, 300, 120, 0, 7); x.fill(); x.fillStyle = '#fff'; x.fillRect(80, 80, 120, 80);
    window.__testCanvas = c;
  });
  const fresh = async () => { await p.evaluate(async () => { const app = window.__monsoon; for (const d of [...app.docs]) app.closeDoc(d.id); const run = window.__monsoonRun; await run('new', { name: 'Test', w: 800, h: 600, bg: 'white' }); const d = app.doc; const l = d.layers[0]; l.canvas.getContext('2d').drawImage(window.__testCanvas, 0, 0); l.ver++; d.commit('Setup'); app.emit(); window.__monsoonView.fitRect({ x: 0, y: 0, w: 800, h: 600 }); }); await p.waitForTimeout(100); };
  await fresh(); check('setup');
  const vp = await p.$('.viewport'); const box = await vp.boundingBox();
  const toScreen = (x, y) => p.evaluate(([x, y]) => { const v = window.__monsoonView.toScreen({ x, y }); const r = document.querySelector('.viewport').getBoundingClientRect(); return { x: v.x + r.left, y: v.y + r.top }; }, [x, y]);
  const drag = async (pts) => { const s = await toScreen(...pts[0]); await p.mouse.move(s.x, s.y); await p.mouse.down(); for (const q of pts.slice(1)) { const t = await toScreen(...q); await p.mouse.move(t.x, t.y, { steps: 6 }); } await p.mouse.up(); };
  const click = async (x, y) => { const s = await toScreen(x, y); await p.mouse.click(s.x, s.y); };

  // ---- tools ----
  const tools = await p.evaluate(() => Object.keys(window.__tools));
  for (const t of tools) {
    await fresh();
    await p.evaluate((t) => { const app = window.__monsoon; app.setTool(t); app.cloneSource = { x: 100, y: 100, docId: app.doc.id }; }, t);
    try {
      if (t.startsWith('lasso-poly') || t === 'pen' || t === 'curvature-pen') { await click(100, 100); await click(300, 120); await click(250, 300); await click(100, 100); }
      else if (t === 'type' || t === 'type-vertical' || t === 'type-mask' || t === 'type-mask-vertical') { await click(200, 200); await p.keyboard.type('Hello'); await p.keyboard.press('Escape'); }
      else await drag([[150, 150], [300, 250], [420, 330]]);
      await p.keyboard.press('Enter');
    } catch (e) { fails.push('tool ' + t + ': ' + e.message); }
    await p.waitForTimeout(80);
    const info = await p.evaluate(() => { const d = window.__monsoon.doc; return d ? d.history.length + ' ' + d.layers.length + ' sel=' + !!d.s.selection : 'nodoc'; });
    note(`tool ${t}: ${info}`); check('tool ' + t);
  }

  // ---- commands ----
  await fresh();
  const cmds = [
    ['selectAll'], ['copy'], ['paste'], ['deselect'], ['selectAll'], ['modify', { op: 'contract', px: 20 }], ['modify', { op: 'feather', px: 5 }], ['modify', { op: 'border', px: 6 }], ['inverse'], ['reselect'], ['deselect'],
    ['selectSubject'], ['grow'], ['grow', true], ['saveSelection'], ['deselect'], ['selectSky'], ['deselect'],
    ['colorRange', { mode: 'reds', colors: [[255, 0, 0]], fuzz: 40, invert: false }], ['selectAndMask', { smooth: 5, feather: 2, contrast: 10, shift: 10, output: 'selection' }], ['selectionToPath'], ['contentAwareFill'], ['deselect'],
    ['newLayer'], ['fill', { use: 'fg', mode: 'normal', opacity: 0.5 }], ['fill', { use: 'pattern', pattern: 'Dots' }], ['selectAll'], ['stroke', { width: 6, color: '#ff0000', location: 'inside' }], ['deselect'],
    ['duplicateLayer'], ['mask', 'reveal'], ['mask', 'invert'], ['mask', 'apply'], ['mask', 'hide'], ['mask', 'delete'], ['clip'], ['clip'], ['setStyles', { styles: { dropShadow: { enabled: true, color: '#000', opacity: .5, angle: 120, distance: 8, size: 10, spread: 0, blend: 'multiply' } } }],
    ['quickStyle', 'Neon'], ['quickStyle', 'Rain Glass'], ['copyStyle'], ['pasteStyle'], ['clearStyle'], ['groupLayers'], ['ungroup'], ['newGroup'], ['arrange', 'front'], ['arrange', 'back'], ['arrange', 'forward'],
    ['newAdjustment', 'curves'], ['newAdjustment', 'hsl'], ['newAdjustment', 'gradientMap'], ['newFill', { type: 'gradient' }], ['newFill', { type: 'pattern' }], ['newFill', { type: 'color' }],
    ['mergeDown'], ['selectAllLayers'], ['align', 'left'], ['align', 'hcenter'], ['mergeVisible'], ['stampVisible'], ['toSmart'], ['filter', { id: 'gaussian', params: { radius: 4 } }], ['toggleSmartFilter'], ['rasterize'],
    ['layerViaCopy'], ['layerComp', { op: 'new', name: 'A' }], ['lockAll'], ['lockAll'], ['linkLayers'],
    ['autoTone'], ['autoContrast'], ['autoColor'], ['desaturate'], ['equalize'], ['replaceColor', { color: '#e53e3e', fuzz: 40, hue: 90, sat: 0, light: 0 }],
    ['imageSize', { w: 700, h: 525, resample: 'bicubic' }], ['canvasSize', { w: 760, h: 560, anchor: [0.5, 0.5], color: '#ffffff' }], ['rotateCanvas', { deg: 90 }], ['rotateCanvas', { deg: -90 }], ['rotateCanvas', { flipH: true }], ['rotateCanvas', { deg: 12 }],
    ['trim', { based: 'transparent' }], ['revealAll'], ['crop'], ['mode', 'grayscale'], ['mode', 'rgb'], ['indexed', { colors: 32, dither: true }],
    ['freeTransform'], ['transformQuick', 'flipH'], ['transformQuick', 'rot90'], ['definePattern'], ['defineBrush'], ['newGuide', { axis: 'v', pos: 100 }], ['guideLayout', { cols: 3, rows: 2, margin: 20, gutter: 10 }], ['clearGuides'],
    ['flatten'], ['quickMask'], ['quickMask'], ['zoomIn'], ['zoomOut'], ['fit'], ['actual'], ['fillScreen'], ['undo'], ['redo'], ['purge'], ['duplicateDoc'],
  ];
  for (const [c, a] of cmds) {
    const r = await p.evaluate(async ([c, a]) => { try { const sid = c === 'toggleSmartFilter' ? window.__monsoon.doc.active?.smart?.filters[0]?.id : a; await window.__monsoonRun(c, sid); if (window.__monsoon.dialog) { const k = window.__monsoon.dialog.kind; window.__monsoon.closeDialog(); return 'opened dialog ' + k; } return 'ok ' + window.__monsoon.doc?.layers.length; } catch (e) { return 'ERR ' + e.message; } }, [c, a]);
    await p.waitForTimeout(30);
    const t = await p.evaluate(() => window.__monsoon.toasts.filter((t) => t.kind === 'error').map((t) => t.text).join(';'));
    if (t) { fails.push(`cmd ${c}: toast ${t}`); await p.evaluate(() => { window.__monsoon.toasts = []; }); }
    note(`cmd ${c} ${a ? JSON.stringify(a).slice(0, 40) : ''}: ${r}`); check('cmd ' + c);
  }
  await p.screenshot({ path: 'tests/shots/03-after-cmds.png' });

  // ---- filters and adjustments ----
  await fresh();
  const filters = await p.evaluate(() => Object.keys(window.__filterMap || {}));
  const res = await p.evaluate(async () => {
    const out = []; const { FILTERS, defaults } = window.__monsoonFilters; const app = window.__monsoon;
    for (const f of FILTERS) { const t0 = performance.now(); try { await window.__monsoonRun('filter', { id: f.id, params: defaults(f) }); app.doc.undo(); } catch (e) { out.push('ERR ' + f.id + ' ' + e.message); } const dt = performance.now() - t0; if (dt > 4000) out.push('SLOW ' + f.id + ' ' + Math.round(dt) + 'ms'); const errs = app.toasts.filter((t) => t.kind === 'error'); if (errs.length) { out.push('TOAST ' + f.id + ' ' + errs[0].text); app.toasts = []; } }
    for (const t of window.__monsoonAdj) { try { await window.__monsoonRun('adj:' + t, window.__monsoonAdjDefaults[t]()); app.doc.undo(); } catch (e) { out.push('ERR adj ' + t + ' ' + e.message); } }
    return out.concat(['filters ' + FILTERS.length]);
  });
  note(res.join('\n')); res.filter((r) => /^(ERR|TOAST)/.test(r)).forEach((r) => fails.push(r)); check('filters');

  // ---- dialogs (open, then OK) ----
  const kinds = ['new', 'recent', 'saveAs', 'export', 'exportLayers', 'batch', 'fileInfo', 'fade', 'fill', 'stroke', 'shortcuts', 'prefs', 'indexed', ['adjust', { type: 'curves' }], ['adjust', { type: 'levels' }], ['adjust', { type: 'hsl' }], ['adjust', { type: 'selectiveColor' }], ['filter', { id: 'gaussian' }], ['filter', { id: 'twirl' }], 'replaceColor', 'imageSize', 'canvasSize', 'rotate', 'trim', 'layerStyle', 'warpText', 'colorRange', 'selectMask', ['modify', { op: 'expand' }], 'loadSelection', 'cameraRaw', 'lens', 'liquify', 'newGuide', 'guideLayout', 'about', ['about', { tab: 'features' }], ['color', { value: '#336699' }], 'gradient'];
  for (const k of kinds) {
    await fresh(); await p.evaluate(() => window.__monsoonRun('selectAll'));
    const [kind, props] = Array.isArray(k) ? k : [k, undefined];
    await p.evaluate(([k, pr]) => window.__monsoon.openDialog(k, pr), [kind, props]);
    await p.waitForTimeout(250);
    const has = await p.$('.modal'); if (!has) { fails.push('dialog ' + kind + ' did not open'); continue; }
    if (kind === 'liquify') { const c = await p.$('.lq-wrap canvas'); const bb = await c.boundingBox(); await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.mouse.down(); await p.mouse.move(bb.x + bb.width / 2 + 60, bb.y + bb.height / 2 + 20, { steps: 8 }); await p.mouse.up(); }
    if (['adjust', 'filter', 'cameraRaw', 'lens', 'layerStyle'].includes(kind)) { const s = await p.$$('.modal input[type=range]'); if (s[0]) await s[0].fill('20').catch(() => {}); }
    await p.screenshot({ path: `tests/shots/dlg-${kind}${props?.type || props?.id || props?.tab || ''}.png` });
    const okBtn = await p.$('.modal footer .btn.primary');
    if (okBtn && !['new', 'saveAs', 'export', 'exportLayers', 'batch'].includes(kind)) await okBtn.click(); else await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
    const t = await p.evaluate(() => { const e = window.__monsoon.toasts.filter((t) => t.kind === 'error').map((t) => t.text).join(';'); window.__monsoon.toasts = []; return e + (window.__monsoon.dialog ? ' still-open:' + window.__monsoon.dialog.kind : ''); });
    if (t.trim()) fails.push('dialog ' + kind + ': ' + t);
    note('dialog ' + kind + ' ok'); check('dialog ' + kind);
  }

  // ---- file formats ----
  await fresh();
  const fr = await p.evaluate(async () => {
    const out = []; const io = window.__monsoonIO; const d = window.__monsoon.doc;
    await window.__monsoonRun('newLayer'); await window.__monsoonRun('setStyles', { styles: { stroke: { enabled: true, color: '#00ff00', size: 4, position: 'outside', opacity: 1, blend: 'normal' } } });
    for (const f of ['png', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'pdf', 'svg']) { try { const b = await io.exportDoc(d, f, 0.9); out.push(f + ' ' + b.size); } catch (e) { out.push('ERR ' + f + ' ' + e.message); } }
    try { const psd = io.savePsd(d); out.push('psd ' + psd.size); const d2 = io.openPsd(await psd.arrayBuffer(), 'rt'); out.push('psd reopen layers ' + d2.layers.length + ' ' + d2.w + 'x' + d2.h); } catch (e) { out.push('ERR psd ' + e.message); }
    try { const n = await io.saveNative(d); const d3 = await io.openNative(await n.arrayBuffer(), 'rt'); out.push('native reopen layers ' + d3.layers.length); } catch (e) { out.push('ERR native ' + e.message); }
    for (const f of ['png', 'tiff', 'bmp', 'gif']) { try { const b = await io.exportDoc(d, f); const c = await io.fileToCanvas(new File([b], 'x.' + (f === 'tiff' ? 'tif' : f))); out.push('reopen ' + f + ' ' + c.width + 'x' + c.height); } catch (e) { out.push('ERR reopen ' + f + ' ' + e.message); } }
    return out;
  });
  note(fr.join('\n')); fr.filter((r) => r.startsWith('ERR')).forEach((r) => fails.push(r)); check('formats');

  console.log('\n==== ' + (fails.length ? fails.length + ' FAILURES' : 'ALL PASSED') + ' ====');
  fails.forEach((f) => console.log(' - ' + f));
  await b.close(); process.exit(fails.length ? 1 : 0);
})();
