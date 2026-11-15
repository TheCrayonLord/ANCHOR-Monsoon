// Builds a sample composition with real tool input and saves desktop and phone screenshots.
const { chromium, devices } = require('playwright');
const URL = process.env.URL || 'http://localhost:4175/';
const OUT = process.env.OUT || 'tests/shots';
async function build(p) {
  await p.evaluate(async () => {
    const run = window.__monsoonRun, app = window.__monsoon;
    await run('new', { name: 'Harbour Storm', w: 1600, h: 1000, bg: 'white' });
    const d = app.doc; const l = d.layers[0]; const x = l.canvas.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 1000); g.addColorStop(0, '#1b2350'); g.addColorStop(0.55, '#5a6fb8'); g.addColorStop(0.56, '#20305e'); g.addColorStop(1, '#0b1026'); x.fillStyle = g; x.fillRect(0, 0, 1600, 1000);
    for (let i = 0; i < 900; i++) { x.strokeStyle = `rgba(190,215,255,${0.08 + Math.random() * 0.2})`; x.lineWidth = 1.2; const sx = Math.random() * 1700, sy = Math.random() * 1000; x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx - 18, sy + 46); x.stroke(); }
    l.ver++; d.commit('Paint sky');
    await run('filter', { id: 'clouds', params: {} }).catch(() => 0); d.undo();
    window.__monsoonView.fitRect({ x: 0, y: 0, w: 1600, h: 1000 }); app.emit();
  });
}
async function toScreen(p, x, y) { return p.evaluate(([x, y]) => { const v = window.__monsoonView.toScreen({ x, y }); const r = document.querySelector('.viewport').getBoundingClientRect(); return { x: v.x + r.left, y: v.y + r.top }; }, [x, y]); }
async function drag(p, pts, steps = 8) { const s = await toScreen(p, ...pts[0]); await p.mouse.move(s.x, s.y); await p.mouse.down(); for (const q of pts.slice(1)) { const t = await toScreen(p, ...q); await p.mouse.move(t.x, t.y, { steps }); } await p.mouse.up(); }
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL); await p.waitForSelector('.welcome');
  await p.screenshot({ path: OUT + '/desktop-welcome.png' });
  await build(p);
  // shape: ellipse moon with glow
  await p.evaluate(() => { const a = window.__monsoon; a.opts.shapeFill = '#f2e8cf'; a.opts.shapeFillType = 'color'; a.setTool('shape-ellipse'); });
  await drag(p, [[1180, 140], [1360, 320]]);
  await p.evaluate(() => window.__monsoonRun('quickStyle', 'Glow'));
  // brush strokes: anchor silhouette with the brush
  await p.evaluate(() => { const a = window.__monsoon; a.setTool('brush'); a.fg = '#0d0f1f'; a.brush.size = 34; a.brush.hardness = 0.9; a.doc && window.__monsoonRun('newLayer'); });
  await drag(p, [[520, 300], [520, 760]]); await drag(p, [[420, 400], [620, 400]]); await drag(p, [[340, 640], [380, 730], [460, 790], [520, 800], [580, 790], [660, 730], [700, 640]], 4);
  // type
  await p.evaluate(() => { const a = window.__monsoon; a.opts.fontSize = 120; a.fg = '#ffffff'; a.opts.fontWeight = 700; a.setTool('type'); });
  const s = await toScreen(p, 760, 560); await p.mouse.click(s.x, s.y); await p.keyboard.type('MONSOON'); await p.keyboard.press('Escape');
  await p.evaluate(() => window.__monsoonRun('quickStyle', 'Soft Shadow'));
  // adjustment layer and gradient map
  await p.evaluate(async () => { await window.__monsoonRun('newAdjustment', 'vibrance'); const a = window.__monsoon; a.doc.active.adj.p.vibrance = 40; a.doc.active.ver++; a.doc.commit('Vibrance'); a.setTool('move'); a.emit(); });
  await p.evaluate(() => { const a = window.__monsoon; a.panelsOpen = { layers: true, properties: true, histogram: true, navigator: true, history: true, adjustments: true }; a.emit(); });
  await p.waitForTimeout(600);
  await p.screenshot({ path: OUT + '/desktop-editor.png' });
  // menus and dialogs
  await p.click('.menu-title:has-text("Filter")'); await p.waitForTimeout(150); await p.screenshot({ path: OUT + '/desktop-filter-menu.png' }); await p.keyboard.press('Escape'); await p.mouse.click(700, 500);
  await p.evaluate(() => { const a = window.__monsoon; const L = a.doc.layers.find((l) => l.kind === 'text'); a.doc.setActive(L.id); a.openDialog('layerStyle'); }); await p.waitForTimeout(300); await p.screenshot({ path: OUT + '/desktop-layer-style.png' }); await p.keyboard.press('Escape');
  await p.evaluate(() => { const a = window.__monsoon; a.doc.setActive(a.doc.layers[0].id); a.openDialog('cameraRaw'); }); await p.waitForTimeout(500); await p.screenshot({ path: OUT + '/desktop-develop.png' }); await p.keyboard.press('Escape');
  await p.evaluate(() => window.__monsoon.openDialog('filter', { id: 'twirl' })); await p.waitForTimeout(600); await p.screenshot({ path: OUT + '/desktop-filter.png' }); await p.keyboard.press('Escape');
  await p.evaluate(() => window.__monsoonRun('freeTransform', 'warp')); await p.waitForTimeout(200); await p.screenshot({ path: OUT + '/desktop-warp.png' }); await p.keyboard.press('Escape');
  // phone
  const ph = await b.newPage({ ...devices['iPhone 14'] });
  ph.on('pageerror', (e) => errs.push('phone: ' + e.message));
  await ph.goto(URL); await ph.waitForSelector('.welcome'); await ph.screenshot({ path: OUT + '/phone-welcome.png' });
  await build(ph); await ph.evaluate(() => window.__monsoonRun('newAdjustment', 'curves')); await ph.waitForTimeout(300);
  await ph.screenshot({ path: OUT + '/phone-editor.png' });
  await ph.click('.phone-tabs button:has-text("Layers")'); await ph.waitForTimeout(300); await ph.screenshot({ path: OUT + '/phone-layers.png' });
  await ph.click('.phone-tabs button:has-text("Adjust")'); await ph.waitForTimeout(300); await ph.screenshot({ path: OUT + '/phone-properties.png' });
  await ph.click('.phone-tabs button:has-text("Adjust")');
  await ph.click('.menu-title:has-text("Image")'); await ph.waitForTimeout(200); await ph.screenshot({ path: OUT + '/phone-menu.png' }); await ph.click('.menu-title:has-text("Image")');
  await ph.evaluate(() => { const a = window.__monsoon; a.doc.setActive(a.doc.layers[0].id); a.openDialog('filter', { id: 'gaussian' }); }); await ph.waitForTimeout(500); await ph.screenshot({ path: OUT + '/phone-dialog.png' });
  // overflow check: nothing wider than the screen
  const over = await ph.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth);
  console.log('phone horizontal overflow:', over);
  console.log(errs.length ? errs.join('\n') : 'no page errors');
  await b.close();
})();
