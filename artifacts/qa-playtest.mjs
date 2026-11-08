// QA playtest for the production build (npx vite preview --port 5188).
// Drives the game through real keyboard and mouse input in Chromium on the GPU,
// records errors, frame times, renderer stats and gameplay outcomes, and writes
// artifacts/qa/report.json plus screenshots. Run: node artifacts/qa-playtest.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const URL = process.env.QA_URL ?? 'http://127.0.0.1:5188/';
const OUT = 'artifacts/qa';
await mkdir(OUT, { recursive: true });
const report = { url: URL, started: new Date().toISOString(), runs: [] };

// Installed Chrome (Windows blocks Playwright's downloaded Chromium on this machine).
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });

async function session(name, viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: opts.dpr ?? 1, hasTouch: !!opts.touch, isMobile: !!opts.touch });
  const page = await ctx.newPage();
  const run = { name, viewport, errors: [], warnings: [], failedRequests: [], steps: [] };
  report.runs.push(run);
  page.on('console', m => { if (m.type() === 'error') run.errors.push(m.text().slice(0, 400)); else if (m.type() === 'warning') run.warnings.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => run.errors.push('pageerror: ' + String(e).slice(0, 400)));
  page.on('requestfailed', r => run.failedRequests.push(r.url() + ' ' + (r.failure()?.errorText ?? '')));
  page.on('response', r => { if (r.status() >= 400) run.failedRequests.push(r.status() + ' ' + r.url()); });
  const t0 = Date.now();
  await page.goto(URL + (opts.query ?? ''), { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__sim && !document.getElementById('loading'), null, { timeout: 120000 });
  run.loadMs = Date.now() - t0;
  run.gpu = await page.evaluate(() => {
    const gl = window.__sim.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  return { ctx, page, run };
}

/** Frames rendered and renderer stats over `ms` of real time. */
async function sample(page, ms) {
  return page.evaluate(async ms => {
    const s = window.__sim;
    let frames = 0, worst = 0, last = performance.now();
    const times = [];
    await new Promise(res => {
      const t0 = performance.now();
      const f = () => { const now = performance.now(); const dt = now - last; last = now; times.push(dt); worst = Math.max(worst, dt); frames++; if (now - t0 < ms) requestAnimationFrame(f); else res(); };
      requestAnimationFrame(f);
    });
    times.sort((a, b) => a - b);
    const info = s.renderer.info;
    return {
      fps: +(frames / (ms / 1000)).toFixed(1), p50: +times[Math.floor(times.length / 2)].toFixed(1), p95: +times[Math.floor(times.length * 0.95)].toFixed(1), worstMs: +worst.toFixed(1),
      calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures,
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    };
  }, ms);
}
const cart = page => page.evaluate(() => { const c = window.__sim.cart; const p = c.position(new window.__sim.camera.position.constructor()); return { x: +p.x.toFixed(1), y: +p.y.toFixed(2), z: +p.z.toFixed(1), speedMph: +(c.speed * 2.23694).toFixed(1) }; });
const hold = async (page, keys, ms) => { for (const k of keys) await page.keyboard.down(k); await page.waitForTimeout(ms); for (const k of keys) await page.keyboard.up(k); };
const text = (page, id) => page.evaluate(id => document.getElementById(id)?.textContent ?? null, id);
const visible = (page, id) => page.evaluate(id => { const e = document.getElementById(id); return !!e && !e.hidden && e.offsetParent !== null; }, id);

// ---------------------------------------------------------------- desktop
{
  const { ctx, page, run } = await session('desktop-1600x900', { width: 1600, height: 900 });
  const step = (name, data) => { run.steps.push({ name, ...data }); console.log(name, JSON.stringify(data)); };
  await page.screenshot({ path: `${OUT}/01-menu.png` });
  step('menu', { menuVisible: await visible(page, 'menu'), idle: await sample(page, 2000) });

  // Free roam: real keyboard driving.
  await page.click('[data-action="free"]');
  await page.waitForTimeout(500);
  const p0 = await cart(page);
  await hold(page, ['KeyW'], 5000);
  const p1 = await cart(page);
  const drive = await sample(page, 3000);
  await page.screenshot({ path: `${OUT}/02-free-roam-driving.png` });
  step('free-roam accelerate 5 s', { start: p0, end: p1, moved: +Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1), perf: drive });
  // Top speed, braking, steering.
  await page.keyboard.down('KeyW'); await page.keyboard.down('KeyA'); await page.waitForTimeout(2500);
  const turning = await cart(page);
  await page.keyboard.up('KeyA'); await page.keyboard.up('KeyW');
  await hold(page, ['KeyS'], 1500);
  const braked = await cart(page);
  step('steer + brake', { turning, afterBrake: braked });
  // Controls: lights, siren, horn, headlights, camera, location, map, perf, help.
  for (const k of ['KeyL', 'KeyH', 'KeyK', 'KeyI']) { await page.keyboard.press(k); await page.waitForTimeout(150); }
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(400);
  const chips = await page.evaluate(() => [...document.querySelectorAll('#chips [data-chip], .chip')].map(c => c.textContent.trim() + (c.classList.contains('on') ? ':on' : ':off')));
  await page.screenshot({ path: `${OUT}/03-lights-siren-horn.png` });
  step('controls L H K I B', { chips, audioState: await page.evaluate(() => (window.AudioContext ? 'available' : 'none')) });
  await page.keyboard.press('KeyH'); await page.keyboard.press('KeyL');
  for (const cam of ['driver', 'free', 'chase']) { await page.keyboard.press('KeyC'); await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/04-camera-${cam}.png` }); }
  await page.keyboard.press('F1'); await page.waitForTimeout(300);
  step('help F1', { helpVisible: await visible(page, 'help') });
  await page.screenshot({ path: `${OUT}/05-help.png` });
  await page.keyboard.press('F1');
  await page.keyboard.press('KeyP'); await page.waitForTimeout(800);
  step('perf overlay', { perf: await text(page, 'perf') });
  await page.keyboard.press('KeyP');

  // Stuck / recovery: reset and recover keys.
  await page.keyboard.press('Backspace'); await page.waitForTimeout(500);
  step('reset to start', { cart: await cart(page) });

  // Route Challenge: random run, real driving toward the target with a simple steering bot.
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.check('#show-beam');
  await page.click('[data-action="random"]');
  await page.waitForTimeout(500);
  const target = await text(page, 'obj-target');
  step('route challenge random start', { target, label: await text(page, 'obj-label'), countdown: await visible(page, 'countdown') });
  await page.waitForTimeout(3300);
  // Bot: steer toward the next point of the optimal route (read from the game), throttle on.
  const bot = await page.evaluate(async () => {
    const s = window.__sim;
    const keys = new Set();
    const send = (code, down) => { if (down === keys.has(code)) return; window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code })); down ? keys.add(code) : keys.delete(code); };
    const t0 = performance.now(); let lastMove = performance.now(), last = null, softlocks = 0, maxSpeed = 0;
    // The destination beam (enabled as an assist) marks the target: a tall orange cylinder.
    let beacon = null;
    s.scene.traverse(o => { if (o.isGroup && o.children[0]?.material?.color?.getHexString?.() === 'ff6a1a') beacon = o; });
    const route = beacon ? [[beacon.position.x, -beacon.position.z]] : null;
    let finished = false;
    while (performance.now() - t0 < 60000) {
      const p = s.cart.position(new s.camera.position.constructor());
      const pos = [p.x, -p.z];
      if (last && Math.hypot(pos[0] - last[0], pos[1] - last[1]) > 0.5) lastMove = performance.now();
      if (performance.now() - lastMove > 4000) { softlocks++; lastMove = performance.now(); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyR' })); }
      last = pos;
      maxSpeed = Math.max(maxSpeed, Math.abs(s.cart.speed));
      const res = document.getElementById('result');
      if (res && !res.hidden) { finished = true; break; }
      // Steer: target = a point 8 m ahead along the route polyline.
      const pts = route ?? [];
      let best = 0, bd = Infinity;
      pts.forEach((q, i) => { const d = Math.hypot(q[0] - pos[0], q[1] - pos[1]); if (d < bd) { bd = d; best = i; } });
      let aim = pts[Math.min(pts.length - 1, best + 3)] ?? pos;
      // A naive bot: head straight for the beacon, back up and turn when stuck.
      const f = s.cart.forward(new s.camera.position.constructor());
      const fwd = [f.x, -f.z], to = [aim[0] - pos[0], aim[1] - pos[1]];
      const cross = fwd[0] * to[1] - fwd[1] * to[0], dot = fwd[0] * to[0] + fwd[1] * to[1];
      const ang = Math.atan2(cross, dot);
      send('KeyA', ang > 0.08); send('KeyD', ang < -0.08);
      send('KeyW', Math.abs(s.cart.speed) < (Math.abs(ang) > 0.5 ? 3 : 6.5));
      await new Promise(r => setTimeout(r, 50));
    }
    for (const k of [...keys]) send(k, false);
    return { finished, seconds: +((performance.now() - t0) / 1000).toFixed(1), softlocks, maxSpeedMph: +(maxSpeed * 2.23694).toFixed(1) };
  }).catch(e => ({ error: String(e) }));
  step('route challenge bot drive (straight at the beacon)', bot);
  await page.screenshot({ path: `${OUT}/06-route-challenge-active.png` });
  step('objective panel', { label: await text(page, 'obj-label'), time: await text(page, 'obj-time'), dist: await text(page, 'obj-dist'), driven: await text(page, 'obj-driven'), event: await text(page, 'event') });

  // Collision: aim at the nearest building wall and drive into it at speed.
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.click('[data-action="random"]'); await page.waitForTimeout(3600);
  const crash = await page.evaluate(async () => {
    const s = window.__sim; const V = s.camera.position.constructor;
    // Point the cart at the nearest building centroid.
    const p = s.cart.position(new V()); const pos = [p.x, -p.z];
    let best = null, bd = Infinity;
    for (const b of s.data.buildings) { if (b.style === 'canopy' || b.minH) continue; const c = b.outer.reduce((a, q) => [a[0] + q[0] / b.outer.length, a[1] + q[1] / b.outer.length], [0, 0]); const d = Math.hypot(c[0] - pos[0], c[1] - pos[1]); if (d > 15 && d < bd) { bd = d; best = c; } }
    const dir = [best[0] - pos[0], best[1] - pos[1]], l = Math.hypot(...dir);
    s.cart.reset(new V(pos[0], s.terrain.heightAt(pos[0], pos[1]) + 0.05, -pos[1]), Math.atan2(dir[0] / l, -dir[1] / l));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    let events = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 9000) { const e = document.getElementById('event'); if (e && !e.hidden && !events.includes(e.textContent)) events.push(e.textContent); await new Promise(r => setTimeout(r, 50)); }
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    const q = s.cart.position(new V());
    return { buildingDistance: +bd.toFixed(0), events, end: [+q.x.toFixed(1), +(-q.z).toFixed(1)], upright: true };
  });
  step('drive into nearest building', crash);
  await page.screenshot({ path: `${OUT}/07-after-collision.png` });

  // Multi-stop gauntlet UI.
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.uncheck('#show-beam');
  await page.click('[data-action="multi"]');
  await page.fill('#multi-count', '4');
  await page.click('[data-action="multi-random"]'); await page.waitForTimeout(600);
  step('multi-stop start', { label: await text(page, 'obj-label'), target: await text(page, 'obj-target') });
  await page.screenshot({ path: `${OUT}/08-multistop.png` });
  // Choose mode list: lots present, Northside absent.
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.click('[data-action="choose"]');
  const dests = await page.evaluate(() => [...document.querySelectorAll('#dest-list button')].map(b => b.textContent));
  step('destination list', { count: dests.length, lots: dests.filter(d => d.startsWith('P ·')).length, northside: dests.filter(d => /Northside/.test(d)).length, waterview: dests.filter(d => /Waterview Science/.test(d)).length });
  await page.screenshot({ path: `${OUT}/09-destination-picker.png` });

  // Night.
  await page.selectOption('#time-select', 'night'); await page.waitForTimeout(1500);
  await page.click('[data-action="free"]'); await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/10-night.png` });
  step('night', { perf: await sample(page, 2000) });

  // Long run stability: 60 s of continuous driving in circles; heap and frame time.
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.selectOption('#time-select', 'golden'); await page.waitForTimeout(800);
  await page.click('[data-action="free"]'); await page.waitForTimeout(400);
  const before = await sample(page, 1500);
  await page.keyboard.down('KeyW'); await page.keyboard.down('KeyD');
  await page.waitForTimeout(60000);
  await page.keyboard.up('KeyW'); await page.keyboard.up('KeyD');
  const after = await sample(page, 1500);
  step('60 s stability', { before, after, cart: await cart(page) });

  // Resize.
  await page.setViewportSize({ width: 1024, height: 640 }); await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/11-resize-1024.png` });
  step('resize', { canvas: await page.evaluate(() => { const c = document.querySelector('canvas'); return [c.width, c.height, c.clientWidth, c.clientHeight]; }) });
  await ctx.close();
}

// ---------------------------------------------------------------- mobile
{
  const { ctx, page, run } = await session('mobile-390x844', { width: 390, height: 844 }, { touch: true, dpr: 3 });
  const step = (name, data) => { run.steps.push({ name, ...data }); console.log(name, JSON.stringify(data)); };
  await page.screenshot({ path: `${OUT}/20-mobile-menu.png` });
  const fit = await page.evaluate(() => { const p = document.querySelector('#menu .menu-panel'); const r = p.getBoundingClientRect(); return { panel: [Math.round(r.width), Math.round(r.height)], overflowX: document.documentElement.scrollWidth > innerWidth, scrollable: p.scrollHeight > p.clientHeight }; });
  await page.tap('[data-action="free"]'); await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/21-mobile-play.png` });
  const p0 = await cart(page);
  // Touch drag on the canvas: does anything drive the cart?
  await page.touchscreen.tap(195, 600); await page.waitForTimeout(1500);
  const p1 = await cart(page);
  step('mobile', { fit, touchMovedCart: Math.hypot(p1.x - p0.x, p1.z - p0.z) > 0.5, touchControls: await page.evaluate(() => !!document.querySelector('[data-touch], .touch-controls, #touch')), perf: await sample(page, 2000) });
  await ctx.close();
}

await browser.close();
report.finished = new Date().toISOString();
await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log('wrote', `${OUT}/report.json`);
