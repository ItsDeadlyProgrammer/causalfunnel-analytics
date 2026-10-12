import express from 'express';
import { Event } from '../models/Event.js';
import { Session } from '../models/Session.js';
import { normalizePageUrl, validateEvent } from '../validate.js';

export const MAX_BATCH = 100;
const MAX_HEATMAP_POINTS = 20000;

export const router = express.Router();

const asyncRoute = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const clampInt = (v, def, min, max) => {
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? def : Math.min(Math.max(n, min), max);
};

/**
 * POST /api/events
 * Body: a single event, an array of events, or { events: [...] }.
 * The tracker sends text/plain (via sendBeacon) to avoid CORS preflights, so
 * the body may arrive as a string.
 */
router.post(
  '/events',
  asyncRoute(async (req, res) => {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({ error: 'body is not valid JSON' });
      }
    }
    const rawEvents = Array.isArray(body) ? body : Array.isArray(body?.events) ? body.events : [body];
    if (rawEvents.length === 0) return res.status(400).json({ error: 'no events' });
    if (rawEvents.length > MAX_BATCH) return res.status(413).json({ error: `max ${MAX_BATCH} events per request` });

    const userAgent = req.get('user-agent');
    const now = Date.now();
    const accepted = [];
    const rejected = [];
    rawEvents.forEach((raw, index) => {
      const { event, error } = validateEvent(raw, { now, userAgent });
      if (event) accepted.push(event);
      else rejected.push({ index, error });
    });

    if (accepted.length === 0) return res.status(400).json({ error: 'no valid events', rejected });

    accepted.sort((a, b) => a.timestamp - b.timestamp);
    await Event.insertMany(accepted, { ordered: false });

    // Roll the batch up per session, then one upsert per session.
    const bySession = new Map();
    for (const e of accepted) {
      let s = bySession.get(e.sessionId);
      if (!s) {
        s = { first: e, last: e, total: 0, pageViews: 0, clicks: 0 };
        bySession.set(e.sessionId, s);
      }
      s.last = e;
      s.total += 1;
      if (e.type === 'page_view') s.pageViews += 1;
      else s.clicks += 1;
    }
    await Session.bulkWrite(
      [...bySession.entries()].map(([id, s]) => ({
        updateOne: {
          filter: { _id: id },
          update: {
            $setOnInsert: { entryPage: s.first.pageUrl, userAgent: s.first.userAgent },
            $min: { firstSeen: s.first.timestamp },
            $max: { lastSeen: s.last.timestamp },
            $inc: { eventCount: s.total, pageViews: s.pageViews, clicks: s.clicks },
          },
          upsert: true,
        },
      })),
      { ordered: false }
    );

    res.status(201).json({ accepted: accepted.length, rejected });
  })
);

/**
 * GET /api/sessions?page=1&limit=20
 * Sessions with their event counts, most recently active first.
 */
router.get(
  '/sessions',
  asyncRoute(async (req, res) => {
    const limit = clampInt(req.query.limit, 20, 1, 100);
    const page = clampInt(req.query.page, 1, 1, 100000);
    const [sessions, total] = await Promise.all([
      Session.find()
        .sort({ lastSeen: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Session.estimatedDocumentCount(),
    ]);
    res.json({
      page,
      limit,
      total,
      sessions: sessions.map(({ _id, ...rest }) => ({ sessionId: _id, ...rest })),
    });
  })
);

/**
 * GET /api/sessions/:sessionId/events
 * Every event of one session in chronological order (the user journey).
 */
router.get(
  '/sessions/:sessionId/events',
  asyncRoute(async (req, res) => {
    const { sessionId } = req.params;
    const [session, events] = await Promise.all([
      Session.findById(sessionId).lean(),
      Event.find({ sessionId }, { userAgent: 0, receivedAt: 0 }).sort({ timestamp: 1, _id: 1 }).lean(),
    ]);
    if (!session) return res.status(404).json({ error: 'session not found' });
    const { _id, ...rest } = session;
    res.json({ session: { sessionId: _id, ...rest }, events });
  })
);

/**
 * GET /api/pages
 * Distinct page URLs with view and click counts, for the heatmap page picker.
 */
router.get(
  '/pages',
  asyncRoute(async (req, res) => {
    const pages = await Event.aggregate([
      {
        $group: {
          _id: '$pageUrl',
          views: { $sum: { $cond: [{ $eq: ['$type', 'page_view'] }, 1, 0] } },
          clicks: { $sum: { $cond: [{ $eq: ['$type', 'click'] }, 1, 0] } },
          lastSeen: { $max: '$timestamp' },
        },
      },
      { $sort: { clicks: -1, views: -1 } },
      { $limit: 500 },
      { $project: { _id: 0, pageUrl: '$_id', views: 1, clicks: 1, lastSeen: 1 } },
    ]);
    res.json({ pages });
  })
);

/**
 * GET /api/heatmap?pageUrl=<url>
 * Click coordinates for one page. The URL is normalised the same way as on
 * ingest, so "https://site.com/pricing?ref=x" matches "https://site.com/pricing".
 */
router.get(
  '/heatmap',
  asyncRoute(async (req, res) => {
    const { pageUrl } = req.query;
    if (typeof pageUrl !== 'string' || !pageUrl) return res.status(400).json({ error: 'pageUrl query param is required' });
    const normalized = normalizePageUrl(pageUrl);
    if (!normalized) return res.status(400).json({ error: 'invalid pageUrl' });

    const clicks = await Event.find(
      { pageUrl: normalized, type: 'click' },
      { _id: 0, x: 1, y: 1, viewportWidth: 1, pageWidth: 1, pageHeight: 1, target: 1, timestamp: 1, sessionId: 1 }
    )
      .sort({ timestamp: -1 })
      .limit(MAX_HEATMAP_POINTS)
      .lean();
    res.json({ pageUrl: normalized, count: clicks.length, clicks });
  })
);
