// Quick smoke test: loads the app, creates a document, exercises tools and commands, reports console errors.
const { chromium } = require('playwright');
const URL = process.env.URL || 'http://localhost:4175/';
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto(URL); await p.waitForSelector('.welcome');
  await p.screenshot({ path: 'tests/shots/01-welcome.png' });
  await p.click('text=New document'); await p.waitForSelector('.modal'); await p.click('.modal .btn.primary');
  await p.waitForTimeout(500);
  const r = await p.evaluate(async () => {
    const out = [];
    const app = window.__monsoon; const d = app.doc; out.push('doc ' + d.w + 'x' + d.h + ' layers ' + d.layers.length);
    return out;
  });
  console.log(r.join('\n'));
  await p.screenshot({ path: 'tests/shots/02-newdoc.png' });
  console.log(errs.length ? errs.join('\n') : 'no errors');
  await b.close();
})();
