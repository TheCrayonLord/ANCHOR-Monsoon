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
  globalThis.__extra && await globalThis.__extra(p, ev, ok, toScreen, drag, px);
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors');
  console.log(fails.length ? fails.length + ' FAILED' : 'ALL PASSED');
  await b.close(); process.exit(fails.length || errs.length ? 1 : 0);
})();
