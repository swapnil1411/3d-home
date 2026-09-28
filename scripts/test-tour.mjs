// Headless smoke test for the 360° tour. Reads tour.json and tests every scene and arrow.
// Usage: (serve the tour first: npx serve 360-tour)
//        node scripts/test-tour.mjs [baseUrl] [screenshotDir]
// Screenshots named arrow-<from>-to-<to>.png show each arrow centred in view, so its
// placement on the door can be checked by eye.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE = new URL(process.argv[2] || 'http://localhost:3000/').href;
const SHOTS = process.argv[3] || 'test-screenshots';
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.error('Chrome not found. Set CHROME_PATH.'); process.exit(2); }
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? '  — ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';

// ---------- tour.json sanity ----------
const tour = await (await fetch(BASE + 'tour.json')).json();
const ids = Object.keys(tour.scenes);
const first = tour.firstScene;
check('firstScene exists', tour.scenes[first], first);
for (const id of ids) {
  const s = tour.scenes[id];
  const hs = s.hotspots || [];
  check(`"${id}" has at least one arrow (no dead end)`, hs.length > 0);
  for (const h of hs) check(`"${id}" arrow → "${h.to}" points to a real scene`, tour.scenes[h.to]);
  for (const key of ['image', 'imageMobile']) {
    if (!s[key]) continue;
    const r = await fetch(BASE + s[key], { method: 'HEAD' });
    const size = +r.headers.get('content-length');
    check(`${s[key]} served`, r.ok, r.ok ? mb(size) + (size > 3 * 1024 * 1024 ? ' ⚠️ over 3 MB' : '') : `HTTP ${r.status}`);
  }
}
const reachable = new Set([first]);
for (const queue = [first]; queue.length;) {
  for (const h of tour.scenes[queue.shift()]?.hotspots || []) {
    if (tour.scenes[h.to] && !reachable.has(h.to)) { reachable.add(h.to); queue.push(h.to); }
  }
}
check('Every scene reachable from firstScene by arrows', reachable.size === ids.length,
  ids.filter((i) => !reachable.has(i)).join(', '));

// ---------- browser ----------
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function openPage(url, emulate) {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[console.${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url()}`); });
  if (emulate) await page.emulate(emulate); else await page.setViewport({ width: 1280, height: 800 });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return { page, errors, t0 };
}

const waitLoaded = async (page, frame = page) => {
  await frame.waitForFunction(() => window.tourViewer && window.tourViewer.isLoaded() && !document.querySelector('.tour-loading.is-visible'), { timeout: 30000 });
  await sleep(1000); // scene fade
};
const viewerState = (page) => page.evaluate(() => ({ scene: tourViewer.getScene(), yaw: tourViewer.getYaw(), hfov: tourViewer.getHfov() }));

// The visible arrow closest to the viewport centre (we always turn to face the one we want).
async function centreArrow(page) {
  return page.evaluate(() => {
    const cx = innerWidth / 2, cy = innerHeight / 2;
    let best = null;
    document.querySelectorAll('.pnlm-render-container .tour-arrow').forEach((el) => {
      if (getComputedStyle(el).visibility !== 'visible') return;
      const r = el.getBoundingClientRect();
      const d = Math.hypot(r.x + r.width / 2 - cx, r.y + r.height / 2 - cy);
      if (!best || d < best.d) best = { d, x: r.x, y: r.y, width: r.width, height: r.height };
    });
    return best;
  });
}

async function goTo(page, scene, pitch, yaw) {
  const cur = await page.evaluate(() => tourViewer.getScene());
  if (cur !== scene) {
    await page.evaluate((s, p, y) => tourViewer.loadScene(s, p, y), scene, pitch, yaw);
    await waitLoaded(page);
  } else {
    await page.evaluate((p, y) => tourViewer.lookAt(p, y, undefined, false), pitch, yaw);
    await sleep(300);
  }
}

// ---------- Desktop ----------
{
  const { page, errors, t0 } = await openPage(BASE);
  await waitLoaded(page);
  const st = await viewerState(page);
  check('First scene loads', st.scene === first, `${Date.now() - t0 - 1000} ms to first panorama`);
  check('Title shown top-left', (await page.$eval('.tour-nav__title', (e) => e.textContent)) === (tour.scenes[first].title || first));
  check('Edit box hidden in normal mode', !(await page.$('.tour-edit')));
  check('Compass hidden', await page.$eval('.pnlm-compass', (e) => getComputedStyle(e).display === 'none'));
  check('Fullscreen button present', await page.$('.pnlm-fullscreen-toggle-button'));
  check('Desktop uses full-size image', (await page.evaluate(() => tourViewer.getConfig().panorama)) === tour.scenes[first].image);
  await page.screenshot({ path: `${SHOTS}/start-${first}.png` });

  // Every arrow in every scene
  for (const from of ids) {
    for (const h of tour.scenes[from].hotspots || []) {
      const target = tour.scenes[h.to];
      if (!target) continue;
      await goTo(page, from, h.pitch, h.yaw);
      const box = await centreArrow(page);
      const name = `"${from}" arrow → "${h.to}"`;
      check(`${name} visible and ≥44px`, box && box.width >= 44 && box.height >= 44);
      if (!box) continue;
      // Centre crop: enough to see the door around the arrow.
      await page.screenshot({ path: `${SHOTS}/arrow-${from}-to-${h.to}.png`, clip: { x: 240, y: 150, width: 800, height: 500 } });
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await sleep(250);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await sleep(100);
      await waitLoaded(page);
      const after = await viewerState(page);
      const expectYaw = h.targetYaw ?? target.startYaw ?? 0;
      check(`${name} click arrives in "${h.to}" facing yaw ${expectYaw}`,
        after.scene === h.to && angleDiff(after.yaw, expectYaw) < 1, `got ${after.scene} @ ${after.yaw.toFixed(1)}`);
    }
  }

  // Menu
  await page.click('.tour-nav__toggle');
  await sleep(200);
  await page.screenshot({ path: `${SHOTS}/menu-open.png` });
  const items = await page.$$('.tour-nav__item');
  check('Menu lists every scene', items.length === ids.length, `${items.length}/${ids.length}`);
  const cur = (await viewerState(page)).scene;
  const pick = ids.find((i) => i !== cur) || cur;
  await items[ids.indexOf(pick)].click();
  await waitLoaded(page);
  check('Menu jumps to another scene', (await viewerState(page)).scene === pick, pick);
  check('Menu closes after choice', await page.$eval('.tour-nav__menu', (e) => e.hidden));

  // Drag
  const y0 = (await viewerState(page)).yaw;
  await page.mouse.move(700, 300);
  await page.mouse.down();
  await page.mouse.move(500, 300, { steps: 10 });
  await page.mouse.up();
  await sleep(800);
  check('Mouse drag rotates view', angleDiff((await viewerState(page)).yaw, y0) > 5);

  // Fullscreen
  await page.click('.pnlm-fullscreen-toggle-button');
  await sleep(500);
  check('Fullscreen button enters fullscreen', await page.evaluate(() => document.fullscreenElement?.id === 'tour'));
  check('Room menu visible in fullscreen', await page.$eval('.tour-nav', (e) => document.fullscreenElement?.contains(e) && e.getBoundingClientRect().width > 0));
  await page.evaluate(() => document.exitFullscreen?.());

  check('No console errors (desktop)', errors.length === 0, errors.join('\n   '));
  await page.close();
}

// ---------- Deep link ----------
{
  const last = ids[ids.length - 1];
  const { page, errors } = await openPage(BASE + '#' + last);
  await waitLoaded(page);
  check(`Deep link #${last} opens that scene`, (await viewerState(page)).scene === last);
  check('No console errors (deep link)', errors.length === 0, errors.join('\n   '));
  await page.close();
}

// ---------- Edit mode ----------
{
  const { page, errors } = await openPage(BASE + '?edit=1');
  await waitLoaded(page);
  check('Edit box shown with ?edit=1', await page.$('.tour-edit'));
  await page.mouse.click(400, 500);
  await sleep(300);
  const shown = await page.$eval('[data-f="click"]', (e) => e.textContent);
  const expected = await page.evaluate(() => {
    const c = tourViewer.mouseEventToCoords({ clientX: 400, clientY: 500 });
    return `pitch ${Math.round(c[0] * 10) / 10}, yaw ${Math.round(c[1] * 10) / 10}`;
  });
  check('Click shows pitch/yaw', shown === expected, shown);
  check('Scene id shown', (await page.$eval('[data-f="scene"]', (e) => e.textContent)) === first);
  check('Copy button enabled + marker placed', (await page.$eval('[data-f="copy"]', (e) => !e.disabled)) && (await page.$('.tour-edit-marker')));
  check('No console errors (edit)', errors.length === 0, errors.join('\n   '));
  await page.close();
}

// ---------- Mobile 375px ----------
{
  const { page, errors, t0 } = await openPage(BASE, {
    viewport: { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await waitLoaded(page);
  const img = await page.evaluate(() => tourViewer.getConfig().panorama);
  const want = tour.scenes[first].imageMobile || tour.scenes[first].image;
  check('Mobile uses mobile image', img === want, `${img}, ${Date.now() - t0 - 1000} ms`);
  check('No horizontal scroll at 375px', await page.evaluate(() => document.documentElement.scrollWidth <= 375));

  const cdp = await page.createCDPSession();
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const y0 = (await viewerState(page)).yaw;
  await touch('touchStart', [[250, 300]]);
  for (let x = 250; x >= 100; x -= 15) await touch('touchMove', [[x, 300]]);
  await touch('touchEnd', []);
  await sleep(800);
  check('Touch drag rotates view', angleDiff((await viewerState(page)).yaw, y0) > 5);

  const h0 = (await viewerState(page)).hfov;
  await touch('touchStart', [[150, 400], [225, 400]]);
  for (let d = 0; d <= 90; d += 10) await touch('touchMove', [[150 - d, 400], [225 + d, 400]]);
  await touch('touchEnd', []);
  await sleep(800);
  check('Pinch zooms in', (await viewerState(page)).hfov < h0 - 5);

  const h = tour.scenes[first].hotspots[0];
  await goTo(page, first, h.pitch, h.yaw);
  await page.screenshot({ path: `${SHOTS}/mobile-${first}.png` });
  const box = await centreArrow(page);
  check('Arrow label always visible on touch', await page.$eval('.pnlm-render-container .tour-arrow .tour-arrow__label', (e) => getComputedStyle(e).opacity === '1'));
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(100);
  await waitLoaded(page);
  check('Tapping arrow changes scene (mobile)', (await viewerState(page)).scene === h.to);
  check('No console errors (mobile)', errors.length === 0, errors.join('\n   '));
  await page.close();
}

// ---------- iframe ----------
{
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewport({ width: 1100, height: 900 });
  // Parent on a different origin than the tour, like a real embed.
  const u = new URL(BASE);
  await page.goto(`${u.protocol}//${u.hostname === '127.0.0.1' ? 'localhost' : '127.0.0.1'}:${u.port}/__parent`);
  await page.setContent(`<!doctype html><body style="margin:20px"><h1>House plan</h1>
    <iframe src="${BASE}" width="100%" height="600" style="border:0" allow="fullscreen" allowfullscreen></iframe></body>`);
  const frame = await page.waitForFrame((f) => f.url().startsWith(BASE));
  await waitLoaded(page, frame);
  check('Loads inside an iframe', (await frame.evaluate(() => tourViewer.getScene())) === first);
  await frame.click('.pnlm-fullscreen-toggle-button');
  await sleep(500);
  check('Fullscreen works inside iframe', await frame.evaluate(() => !!document.fullscreenElement));
  await frame.evaluate(() => document.exitFullscreen());
  check('No errors (iframe)', errors.length === 0, errors.join('\n   '));
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${SHOTS}/`);
process.exit(failed.length ? 1 : 0);
