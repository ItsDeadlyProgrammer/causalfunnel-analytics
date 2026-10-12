// End-to-end check in a real (headless) browser:
// visits the demo site, clicks around in two separate sessions, then verifies
// the API data and screenshots the dashboard views.
//
//   BASE=http://localhost:4000 BROWSER="C:/Program Files/Google/Chrome/Application/chrome.exe" node run.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE || 'http://localhost:4000';
const BROWSER = process.env.BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = new URL('./screenshots/', import.meta.url);
fs.mkdirSync(OUT, { recursive: true });
const shot = (name) => fileURLToPath(new URL(name, OUT));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (path) => fetch(BASE + path).then((r) => r.json());
const failures = [];
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures.push(msg);
};

const browser = await puppeteer.launch({ executablePath: BROWSER, headless: true, defaultViewport: { width: 1280, height: 800 } });

async function clickAndWaitNav(page, selector) {
  await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click(selector)]);
}

async function visitorJourney(ctx, steps) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/demo/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__cfAnalytics);
  const sessionId = await page.evaluate(() => window.__cfAnalytics.sessionId());
  await steps(page);
  // Let the last batch go out (pagehide/visibility flush also covers this).
  await page.evaluate(() => window.__cfAnalytics.flush());
  await sleep(500);
  await page.close();
  return sessionId;
}

const before = await json('/api/sessions?limit=100');

// Visitor 1: home -> clicks -> pricing -> growth plan -> signup form.
const ctx1 = await browser.createBrowserContext();
const s1 = await visitorJourney(ctx1, async (page) => {
  await page.click('#cta-demo');
  await page.click('#learn-funnels');
  await page.click('#learn-checkout');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(200);
  await clickAndWaitNav(page, '#cta-bottom'); // -> pricing
  await page.click('#plan-scale', { delay: 10 }).catch(() => {});
  await page.goBack({ waitUntil: 'load' }).catch(() => {});
  await page.goto(`${BASE}/demo/pricing.html`, { waitUntil: 'load' });
  await clickAndWaitNav(page, '#plan-growth'); // -> signup?plan=growth
  await page.type('#email', 'demo@example.com');
  await page.click('#signup-submit');
});

// Visitor 2 (separate browser context = separate localStorage/cookies).
const ctx2 = await browser.createBrowserContext();
const s2 = await visitorJourney(ctx2, async (page) => {
  await page.click('#cta-demo');
  await page.click('#cta-demo');
  await page.click('#learn-integrations');
});

check(s1 && s2 && s1 !== s2, `two visitors got different session ids (${s1}, ${s2})`);

// Session id persists across page loads in the same browser.
const page1b = await ctx1.newPage();
await page1b.goto(`${BASE}/demo/pricing.html`, { waitUntil: 'load' });
await page1b.waitForFunction(() => window.__cfAnalytics);
check((await page1b.evaluate(() => window.__cfAnalytics.sessionId())) === s1, 'session id persists across page loads (localStorage/cookie)');
await page1b.evaluate(() => window.__cfAnalytics.flush());
await sleep(500);
await page1b.close();

// ---- API checks ----
const after = await json('/api/sessions?limit=100');
check(after.total === before.total + 2, `sessions list grew by 2 (${before.total} -> ${after.total})`);
const row1 = after.sessions.find((s) => s.sessionId === s1);
check(row1 && row1.pageViews >= 4 && row1.clicks >= 6, `visitor 1 counts: ${row1?.pageViews} views, ${row1?.clicks} clicks, ${row1?.eventCount} total`);

const journey = await json(`/api/sessions/${s1}/events`);
const types = journey.events.map((e) => e.type);
const ts = journey.events.map((e) => new Date(e.timestamp).getTime());
check(ts.every((t, i) => i === 0 || t >= ts[i - 1]), 'journey events are in chronological order');
check(types[0] === 'page_view', 'journey starts with a page view');
check(journey.events.some((e) => e.type === 'click' && e.target?.includes('#cta-demo')), 'clicks record the target element');
check(journey.events.every((e) => e.sessionId === s1 && e.url && e.timestamp), 'every event has sessionId, url, timestamp');
check(journey.events.filter((e) => e.type === 'click').every((e) => Number.isFinite(e.x) && Number.isFinite(e.y)), 'every click has x/y');
const bottom = journey.events.find((e) => e.target?.includes('#cta-bottom'));
check(bottom && bottom.y > 800, `scrolled click uses document coordinates (y=${bottom?.y} > viewport height 800)`);

const heat = await json(`/api/heatmap?pageUrl=${encodeURIComponent(`${BASE}/demo/index.html`)}`);
check(heat.count >= 7, `heatmap returns clicks for index.html (${heat.count})`);

// ---- Dashboard screenshots ----
const dash = await browser.newPage();
const errors = [];
dash.on('pageerror', (e) => errors.push(e.message));
dash.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await dash.goto(`${BASE}/#/sessions`, { waitUntil: 'networkidle0' });
await dash.waitForSelector('.table tbody tr');
await dash.screenshot({ path: shot('sessions.png') });
const rowCount = await dash.$$eval('.table tbody tr', (r) => r.length);
check(rowCount >= 2, `dashboard lists sessions (${rowCount} rows)`);

await dash.click('.table tbody tr');
await dash.waitForSelector('.timeline .tl-item');
const tl = await dash.$$eval('.timeline .tl-item', (r) => r.length);
check(tl > 0, `clicking a session shows its journey (${tl} timeline items)`);
await dash.screenshot({ path: shot('journey.png'), fullPage: true });

await dash.setViewport({ width: 1280, height: 1650 });
await dash.goto(`${BASE}/#/heatmap?page=${encodeURIComponent(`${BASE}/demo/index.html`)}`, { waitUntil: 'networkidle0' });
await dash.waitForSelector('.dot');
const dots = await dash.$$eval('.dot', (d) => d.length);
check(dots === heat.count, `heatmap renders one dot per click (${dots})`);
await sleep(800); // let the preview iframe paint
await dash.screenshot({ path: shot('heatmap-dots.png') });

await dash.click('.segmented button:nth-child(2)');
await dash.waitForSelector('.cell');
await dash.screenshot({ path: shot('heatmap-grid.png') });

// Viewing the heatmap must not create sessions (the preview iframe is sandboxed).
await sleep(2500);
const final = await json('/api/sessions?limit=1');
check(final.total === after.total, 'viewing the heatmap preview does not record extra sessions');

// Mobile layout renders without horizontal overflow.
await dash.setViewport({ width: 390, height: 844 });
await dash.goto(`${BASE}/#/sessions/${s1}`, { waitUntil: 'networkidle0' });
await dash.waitForSelector('.timeline .tl-item');
const overflow = await dash.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(overflow <= 0, `mobile layout has no horizontal scroll (overflow ${overflow}px)`);
await dash.screenshot({ path: shot('mobile.png') });

check(errors.length === 0, `no console errors in dashboard${errors.length ? ': ' + errors.join(' | ') : ''}`);

await browser.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll e2e checks passed');
process.exit(failures.length ? 1 : 0);
