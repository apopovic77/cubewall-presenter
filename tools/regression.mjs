// Behaviour regression run for refactors: prints one line of field state per step.
// Usage: npm run build && npx vite preview --port 4179 &  then  npm run regression [-- <url>]
// Compare the output with the previous run; `sel` varies with auto-selection timing.
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://localhost:4179/?debug';
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: chrome, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Failed to load resource') && !m.text().includes('CORS')) errors.push(m.text().slice(0, 160)); });
await page.goto(url);
await page.waitForFunction(() => window.__cubewall && window.__cubewall.cubeField.getAllCells().filter((c) => c.textureLoaded).length > 500, null, { timeout: 120000, polling: 1000 }); await page.waitForTimeout(3000);
const P = (fn, arg) => page.evaluate(fn, arg);
const c = async (label) => { const r = await P(() => { const p = window.__cubewall; const r = p.debugFieldCentroid(); const sel = p.cubeField.getCurrentSelection(); return { y: r.y.toFixed(1), spread: r.spread.toFixed(1), mode: p.getPhysicsMode(), cells: p.cubeField.getAllCells().length, tex: p.cubeField.getAllCells().filter((x) => x.textureLoaded).length, sel: sel ? `${sel.gridX},${sel.gridZ}` : '-', bb: p.currentBillboardCell ? 'on' : '-', conn: (p.connector.htmlConnectorMesh?.isEnabled() || p.connector.htmlConnectorTube?.isEnabled()) ? 'on' : '-' }; }); console.log(label.padEnd(22), JSON.stringify(r)); };
const fps = await P(() => new Promise((r) => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 3000) requestAnimationFrame(f); else r(n / 3); }; requestAnimationFrame(f); }));
console.log('fps overview', fps.toFixed(1));
await c('loaded');
await page.mouse.click(600, 420); await page.waitForTimeout(4000); await c('after click');
await page.keyboard.press('Escape'); await page.keyboard.press('n'); await page.waitForTimeout(3000); await c('next cube (N)');
await P(() => window.__cubewall.cubeField.selectCell(null));
await page.keyboard.press('F7'); await page.waitForTimeout(7000); await c('morph F7 (no physics)');
await page.keyboard.press('4'); await page.waitForTimeout(6000); await c('raster (4)');
await page.keyboard.press('F3'); await page.waitForTimeout(5000); await c('physics classic');
await page.keyboard.press('F7'); await page.waitForTimeout(4000); await c('classic morph +4s');
await page.waitForTimeout(8000); await c('classic morph +12s');
await page.keyboard.press('F3'); await page.waitForTimeout(4000); await c('anchor');
await page.keyboard.press('F3'); await page.waitForTimeout(5000); await c('physics off');
await page.keyboard.press('2'); await page.waitForTimeout(2000); await c('wave toggled (2)');
await page.keyboard.press('2');
await page.keyboard.press('F4'); await page.waitForTimeout(5000); await c('axis F4');
console.log('axis rows', await P(() => JSON.stringify(window.__cubewall.cubeField.getAxisValuesSnapshot().rows.slice(0, 3))));
await page.keyboard.press('4'); await page.waitForTimeout(4000);
await page.keyboard.press('5'); await page.waitForTimeout(25000); await c('masonry tiles (5)');
await page.keyboard.press('1'); await page.waitForTimeout(15000); await c('geometry cube (1)');
console.log('errors', JSON.stringify(errors.slice(0, 6)));
await browser.close();
