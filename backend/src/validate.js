import { EVENT_TYPES } from './models/Event.js';

const MAX_STRING = 2048;
// Accept timestamps up to 1 day in the past (offline queues) and 5 minutes in
// the future (client clock skew). Anything else is clamped to server time.
const MAX_PAST_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 5 * 60 * 1000;

const str = (v, max = MAX_STRING) =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, max) : undefined;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined);

/** origin + pathname, without query string, hash or trailing slash. */
export function normalizePageUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'file:') return null;
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : u.pathname;
    return u.origin === 'null' ? `${u.protocol}//${path}` : `${u.origin}${path}`;
  } catch {
    return null;
  }
}

function normalizeTimestamp(v, now) {
  const t = typeof v === 'number' || typeof v === 'string' ? new Date(v) : null;
  if (!t || Number.isNaN(t.getTime())) return new Date(now);
  const ms = t.getTime();
  if (ms < now - MAX_PAST_MS || ms > now + MAX_FUTURE_MS) return new Date(now);
  return t;
}

/**
 * Validates one raw event from the tracker.
 * Returns { event } on success or { error } describing the first problem.
 */
export function validateEvent(raw, { now = Date.now(), userAgent } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'event must be an object' };

  const sessionId = str(raw.sessionId, 128);
  if (!sessionId || !/^[A-Za-z0-9_-]{8,128}$/.test(sessionId)) return { error: 'invalid sessionId' };

  if (!EVENT_TYPES.includes(raw.type)) return { error: `type must be one of ${EVENT_TYPES.join(', ')}` };

  const url = str(raw.url ?? raw.pageUrl);
  const pageUrl = url && normalizePageUrl(url);
  if (!pageUrl) return { error: 'invalid url' };

  const event = {
    sessionId,
    type: raw.type,
    url,
    pageUrl,
    timestamp: normalizeTimestamp(raw.timestamp, now),
    viewportWidth: num(raw.viewportWidth),
    viewportHeight: num(raw.viewportHeight),
    pageWidth: num(raw.pageWidth),
    pageHeight: num(raw.pageHeight),
    title: str(raw.title, 512),
    referrer: str(raw.referrer),
    userAgent: str(userAgent, 512),
  };

  if (raw.type === 'click') {
    const x = num(raw.x);
    const y = num(raw.y);
    if (x === undefined || y === undefined) return { error: 'click events need numeric x and y' };
    event.x = x;
    event.y = y;
    event.target = str(raw.target, 256);
  }

  // Drop undefined keys so Mongo documents stay compact.
  for (const k of Object.keys(event)) if (event[k] === undefined) delete event[k];
  return { event };
}
