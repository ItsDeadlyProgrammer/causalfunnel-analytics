// Integration tests: run against a real MongoDB, in a throwaway database that
// is dropped afterwards.   MONGODB_TEST_URI=mongodb://127.0.0.1:27017 npm test
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Event } from '../src/models/Event.js';
import { Session } from '../src/models/Session.js';
import { normalizePageUrl } from '../src/validate.js';

const BASE_URI = process.env.MONGODB_TEST_URI || 'mongodb://127.0.0.1:27017';
const app = createApp();

const SID_A = 'sessionAAAAAAAA';
const SID_B = 'sessionBBBBBBBB';
const now = Date.now();
const at = (s) => new Date(now - 60000 + s * 1000).toISOString();

before(async () => {
  await mongoose.connect(`${BASE_URI}/cf_analytics_test_${process.pid}`);
  await mongoose.connection.syncIndexes();
});
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
beforeEach(async () => {
  await Promise.all([Event.deleteMany({}), Session.deleteMany({})]);
});

const pv = (sessionId, url, s) => ({ sessionId, type: 'page_view', url, timestamp: at(s), pageWidth: 1280, viewportWidth: 1280 });
const click = (sessionId, url, s, x, y) => ({ sessionId, type: 'click', url, timestamp: at(s), x, y, pageWidth: 1280, pageHeight: 2000 });

describe('normalizePageUrl', () => {
  test('drops query, hash and trailing slash', () => {
    assert.equal(normalizePageUrl('https://a.com/pricing/?x=1#top'), 'https://a.com/pricing');
    assert.equal(normalizePageUrl('https://a.com/'), 'https://a.com/');
  });
  test('rejects non-web schemes and garbage', () => {
    assert.equal(normalizePageUrl('javascript:alert(1)'), null);
    assert.equal(normalizePageUrl('not a url'), null);
  });
});

describe('POST /api/events', () => {
  test('stores a batch and rolls up session counts', async () => {
    const res = await request(app)
      .post('/api/events')
      .send({ events: [pv(SID_A, 'https://shop.test/', 0), click(SID_A, 'https://shop.test/', 2, 100, 200), click(SID_A, 'https://shop.test/', 3, 110, 210)] });
    assert.equal(res.status, 201);
    assert.equal(res.body.accepted, 3);
    const s = await Session.findById(SID_A).lean();
    assert.equal(s.eventCount, 3);
    assert.equal(s.pageViews, 1);
    assert.equal(s.clicks, 2);
    assert.equal(s.entryPage, 'https://shop.test/');
  });

  test('accepts text/plain bodies from sendBeacon', async () => {
    const res = await request(app)
      .post('/api/events')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ events: [pv(SID_A, 'https://shop.test/', 0)] }));
    assert.equal(res.status, 201);
    assert.equal(await Event.countDocuments(), 1);
  });

  test('accepts a single bare event', async () => {
    const res = await request(app).post('/api/events').send(pv(SID_A, 'https://shop.test/', 0));
    assert.equal(res.status, 201);
  });

  test('keeps valid events and reports invalid ones', async () => {
    const res = await request(app)
      .post('/api/events')
      .send([pv(SID_A, 'https://shop.test/', 0), { sessionId: SID_A, type: 'click', url: 'https://shop.test/' }, { type: 'scroll' }]);
    assert.equal(res.status, 201);
    assert.equal(res.body.accepted, 1);
    assert.deepEqual(res.body.rejected.map((r) => r.index), [1, 2]);
  });

  test('rejects an all-invalid batch, bad JSON and oversized batches', async () => {
    assert.equal((await request(app).post('/api/events').send({ sessionId: 'x', type: 'page_view', url: 'https://a.com' })).status, 400);
    assert.equal((await request(app).post('/api/events').set('Content-Type', 'application/json').send('{oops')).status, 400);
    const big = Array.from({ length: 101 }, (_, i) => pv(SID_A, 'https://a.com/', i % 50));
    assert.equal((await request(app).post('/api/events').send(big)).status, 413);
  });

  test('clamps absurd client timestamps to server time', async () => {
    await request(app).post('/api/events').send({ ...pv(SID_A, 'https://a.com/', 0), timestamp: '1999-01-01T00:00:00Z' });
    const e = await Event.findOne().lean();
    assert.ok(Math.abs(e.timestamp.getTime() - Date.now()) < 10000);
  });

  test('session counts accumulate across requests', async () => {
    await request(app).post('/api/events').send([pv(SID_A, 'https://a.com/', 0)]);
    await request(app).post('/api/events').send([click(SID_A, 'https://a.com/', 5, 1, 1)]);
    const s = await Session.findById(SID_A).lean();
    assert.equal(s.eventCount, 2);
    assert.equal(new Date(s.firstSeen).toISOString(), at(0));
    assert.equal(new Date(s.lastSeen).toISOString(), at(5));
  });
});

describe('read endpoints', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/events')
      .send([
        pv(SID_A, 'https://shop.test/', 0),
        click(SID_A, 'https://shop.test/', 1, 10, 20),
        pv(SID_A, 'https://shop.test/pricing?plan=x', 2),
        click(SID_A, 'https://shop.test/pricing', 3, 30, 40),
        pv(SID_B, 'https://shop.test/pricing', 10),
      ]);
  });

  test('GET /api/sessions lists sessions with counts, newest first', async () => {
    const res = await request(app).get('/api/sessions');
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 2);
    assert.deepEqual(res.body.sessions.map((s) => s.sessionId), [SID_B, SID_A]);
    const a = res.body.sessions[1];
    assert.equal(a.eventCount, 4);
    assert.equal(a.pageViews, 2);
    assert.equal(a.clicks, 2);
  });

  test('GET /api/sessions paginates', async () => {
    const res = await request(app).get('/api/sessions?limit=1&page=2');
    assert.equal(res.body.sessions.length, 1);
    assert.equal(res.body.sessions[0].sessionId, SID_A);
  });

  test('GET /api/sessions/:id/events returns the journey in order', async () => {
    const res = await request(app).get(`/api/sessions/${SID_A}/events`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.events.map((e) => e.type), ['page_view', 'click', 'page_view', 'click']);
    const ts = res.body.events.map((e) => new Date(e.timestamp).getTime());
    assert.deepEqual(ts, [...ts].sort((x, y) => x - y));
    assert.equal((await request(app).get('/api/sessions/nope/events')).status, 404);
  });

  test('GET /api/heatmap returns clicks for a page, ignoring query strings', async () => {
    const res = await request(app).get('/api/heatmap').query({ pageUrl: 'https://shop.test/pricing?utm=1' });
    assert.equal(res.status, 200);
    assert.equal(res.body.pageUrl, 'https://shop.test/pricing');
    assert.equal(res.body.count, 1);
    assert.equal(res.body.clicks[0].x, 30);
    assert.equal(res.body.clicks[0].y, 40);
    assert.equal((await request(app).get('/api/heatmap')).status, 400);
  });

  test('GET /api/pages lists pages with view and click counts', async () => {
    const res = await request(app).get('/api/pages');
    const pricing = res.body.pages.find((p) => p.pageUrl === 'https://shop.test/pricing');
    assert.equal(pricing.views, 2);
    assert.equal(pricing.clicks, 1);
  });
});

describe('static assets', () => {
  test('serves the tracker script and demo site', async () => {
    const t = await request(app).get('/tracker.js');
    assert.equal(t.status, 200);
    assert.match(t.headers['content-type'], /javascript/);
    assert.equal((await request(app).get('/demo/index.html')).status, 200);
  });
});
