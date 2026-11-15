// Tests for the features added to close gaps: artboards, vector masks, type on path, warps, animation, AI selection.
const { chromium } = require('playwright');
const URL = process.env.URL || 'http://localhost:4175/';
const only = process.argv[2];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(URL); await p.waitForSelector('.welcome');
  const ev = (f, a) => p.evaluate(f, a);
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'ok  ' : 'FAIL ') + m); };
  const toScreen = (x, y) => ev(([x, y]) => { const v = window.__monsoonView.toScreen({ x, y }); const r = document.querySelector('.viewport').getBoundingClientRect(); return { x: v.x + r.left, y: v.y + r.top }; }, [x, y]);
  const drag = async (pts) => { const s = await toScreen(...pts[0]); await p.mouse.move(s.x, s.y); await p.mouse.down(); for (const q of pts.slice(1)) { const t = await toScreen(...q); await p.mouse.move(t.x, t.y, { steps: 6 }); } await p.mouse.up(); };
  const px = (x, y) => ev(([x, y]) => { const d = window.__monsoon.doc; const c = window.__monsoonIO ? null : null; const f = document.createElement('canvas'); f.width = d.w; f.height = d.h; const { flatten } = window.__monsoonRender; const fl = flatten(d); return Array.from(fl.getContext('2d').getImageData(x, y, 1, 1).data); }, [x, y]);

  if (!only || only === 'artboard') {
    await ev(async () => { await window.__monsoonRun('new', { name: 'AB', w: 800, h: 600, bg: 'transparent' }); });
    await ev(() => window.__monsoon.setTool('artboard'));
    await drag([[50, 50], [350, 450]]);
    let st = await ev(() => { const d = window.__monsoon.doc; return d.layers.filter((l) => l.artboard).map((l) => l.artboard); });
    ok(st.length === 1 && st[0].w > 250, 'artboard drawn with tool ' + JSON.stringify(st));
    await ev(async () => { const a = window.__monsoon; await window.__monsoonRun('newLayer'); const d = a.doc; const l = d.active; const x = d.editable(l).getContext('2d'); x.fillStyle = '#f00'; x.fillRect(0 - l.x, 0 - l.y, 800, 600); l.ver++; d.commit('red'); a.emit(); });
    const inside = await ev(() => { const d = window.__monsoon.doc; return !!d.layers.find((l) => l.artboard).children.find((c) => c.id === d.s.activeId); });
    ok(inside, 'new layer goes inside the active artboard');
    ok((await px(100, 100))[0] === 255 && (await px(600, 300))[3] === 0, 'artboard clips its content');
    await ev(() => window.__monsoonRun('newArtboard', { w: 400, h: 300, name: 'Second' }));
    st = await ev(() => { const d = window.__monsoon.doc; return { n: d.layers.filter((l) => l.artboard).length, w: d.w }; });
    ok(st.n === 2, 'second artboard added ' + JSON.stringify(st));
    await ev(() => window.__monsoon.setTool('artboard'));
    await ev(() => { const d = window.__monsoon.doc; d.setActive(d.layers.find((l) => l.artboard).id); window.__monsoon.emit(); });
    await drag([[100, 100], [140, 130]]);
    st = await ev(() => window.__monsoon.doc.layers.find((l) => l.artboard).artboard);
    ok(Math.abs(st.x - 90) <= 3, 'artboard moved by dragging ' + JSON.stringify(st));
    const z = await ev(async () => { const io = window.__monsoonIO; const n = await io.saveNative(window.__monsoon.doc); const d2 = await io.openNative(await n.arrayBuffer(), 'x'); return d2.layers.filter((l) => l.artboard).length; });
    ok(z === 2, 'artboards survive save and reopen');
    await p.screenshot({ path: 'tests/shots/gap-artboards.png' });
  }
  if (!only || only === 'vmask') {
    await ev(async () => { await window.__monsoonRun('new', { name: 'VM', w: 400, h: 300, bg: 'white' }); await window.__monsoonRun('newLayer'); const a = window.__monsoon, d = a.doc, l = d.active; const x = d.editable(l).getContext('2d'); x.fillStyle = '#00f'; x.fillRect(0, 0, 400, 300); l.ver++; d.commit('blue'); });
    await ev(() => window.__monsoon.setTool('pen')); await ev(() => { window.__monsoon.opts.shapeMode = 'path'; });
    for (const [x, y] of [[100, 100], [300, 100], [300, 200], [100, 200], [100, 100]]) { const s = await toScreen(x, y); await p.mouse.click(s.x, s.y); }
    await ev(() => window.__monsoonRun('vectorMask', 'fromPath'));
    const has = await ev(() => !!window.__monsoon.doc.active.vmask);
    ok(has, 'vector mask from path');
    const a1 = await px(200, 150), a2 = await px(20, 20);
    ok(a1[2] === 255 && a2[0] === 255 && a2[2] === 255 && a2[1] === 255, 'vector mask hides outside ' + a1 + ' / ' + a2);
    await ev(() => window.__monsoon.setTool('direct-select'));
    await drag([[300, 200], [380, 280]]);
    const moved = await ev(() => window.__monsoon.doc.active.vmask.path.subpaths[0].points.some((q) => q.x > 370));
    ok(moved, 'vector mask point edited with direct select');
    await ev(() => window.__monsoonRun('vectorMask', 'rasterize'));
    ok(await ev(() => !!window.__monsoon.doc.active.mask && !window.__monsoon.doc.active.vmask), 'vector mask rasterized to a layer mask');
    await p.screenshot({ path: 'tests/shots/gap-vmask.png' });
  }
  if (!only || only === 'type') {
    await ev(async () => { await window.__monsoonRun('new', { name: 'TY', w: 800, h: 500, bg: 'white' }); window.__monsoon.fg = '#000000'; });
    await ev(() => { window.__monsoon.setTool('pen'); window.__monsoon.opts.shapeMode = 'path'; });
    const pts = [[100, 400], [400, 120], [700, 400]];
    for (const [x, y] of pts) { const s = await toScreen(x, y); await p.mouse.click(s.x, s.y); }
    await p.keyboard.press('Enter');
    await ev(() => { window.__monsoon.setTool('type'); window.__monsoon.opts.fontSize = 40; });
    const s = await toScreen(250, 260); await p.mouse.click(s.x, s.y);
    await p.keyboard.type('Rain falls on the harbour'); await p.keyboard.press('Escape');
    const tp = await ev(() => { const l = window.__monsoon.doc.layers.find((l) => l.kind === 'text'); return l ? { path: !!l.text.path, text: l.text.text, off: l.text.pathOffset } : null; });
    ok(tp && tp.path && tp.text.length > 10, 'type on a path created by clicking the path ' + JSON.stringify(tp));
    await ev(async () => { const a = window.__monsoon, d = a.doc; await window.__monsoonRun('selectAll'); await window.__monsoonRun('deselect'); });
    // styled range on a normal text layer
    await ev(async () => { const a = window.__monsoon, d = a.doc; const V = window.__monsoonVector; const t = V.defaultText(80, 120, { text: 'Big and small', size: 40 }); const l = { ...window.__monsoonNewLayer('text', 'T', { text: t }) }; d.addLayer(l); V.styleRange(l.text, 0, 3, { size: 90, color: '#ff0000' }); l.ver++; d.commit('t'); a.emit(); });
    const red = await ev(() => { const { flatten } = window.__monsoonRender; const f = flatten(window.__monsoon.doc).getContext('2d').getImageData(80, 40, 160, 85).data; let n = 0; for (let i = 0; i < f.length; i += 4) if (f[i] > 200 && f[i + 1] < 60) n++; return n; });
    ok(red > 300, 'character range drawn with its own size and colour (' + red + ' red pixels)');
    const sh = await ev(() => JSON.stringify(window.__monsoonVector.shiftRuns([{ start: 4, end: 7, size: 9 }], 'abc defg', 'abcXX defg')));
    ok(sh.includes('"start":6') && sh.includes('"end":9'), 'styles move with the text when it is edited ' + sh);
    await p.screenshot({ path: 'tests/shots/gap-type.png' });
  }
  globalThis.__extra && await globalThis.__extra(p, ev, ok, toScreen, drag, px);
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors');
  console.log(fails.length ? fails.length + ' FAILED' : 'ALL PASSED');
  await b.close(); process.exit(fails.length || errs.length ? 1 : 0);
})();
