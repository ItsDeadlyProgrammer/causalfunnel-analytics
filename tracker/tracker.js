/*!
 * CausalFunnel analytics tracker
 * Records page views and clicks and sends them to the analytics API.
 *
 * Usage:
 *   <script src="https://YOUR-API/tracker.js" async></script>
 *
 * Optional attributes on the script tag:
 *   data-endpoint="https://YOUR-API"   API origin (defaults to the script's origin)
 *   data-debug="true"                  log events to the console
 */
(function () {
  'use strict';

  if (window.__cfAnalytics) return; // guard against double inclusion
  // The dashboard's heatmap preview loads tracked pages in an iframe with this
  // name; viewing a heatmap must not record page views.
  if (window.name === 'cf-heatmap-preview') return;

  var SESSION_KEY = 'cf_session_id';
  var LAST_ACTIVITY_KEY = 'cf_last_activity';
  var SESSION_TIMEOUT_MS = 30 * 60 * 1000; // new session after 30 min idle
  var FLUSH_INTERVAL_MS = 2000;
  var MAX_BATCH = 20;

  var script =
    document.currentScript ||
    (function () {
      var s = document.querySelectorAll('script[src*="tracker"]');
      return s[s.length - 1];
    })();

  var endpointBase = (script && script.getAttribute('data-endpoint')) || (script && new URL(script.src, location.href).origin) || '';
  var ENDPOINT = endpointBase.replace(/\/+$/, '') + '/api/events';
  var DEBUG = script && script.getAttribute('data-debug') === 'true';

  // ---------- storage (localStorage with cookie fallback) ----------

  function readCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function writeCookie(name, value) {
    document.cookie = name + '=' + encodeURIComponent(value) + '; path=/; max-age=' + SESSION_TIMEOUT_MS / 1000 + '; SameSite=Lax';
  }

  var store = {
    get: function (k) {
      try {
        var v = window.localStorage.getItem(k);
        if (v !== null) return v;
      } catch (e) {}
      return readCookie(k);
    },
    set: function (k, v) {
      try {
        window.localStorage.setItem(k, v);
      } catch (e) {}
      writeCookie(k, v); // cookie too, so private-mode / blocked storage still works
    },
  };

  // ---------- session ----------

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
    var s = '';
    for (var i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s;
  }

  function getSessionId() {
    var now = Date.now();
    var id = store.get(SESSION_KEY);
    var last = Number(store.get(LAST_ACTIVITY_KEY)) || 0;
    if (!id || now - last > SESSION_TIMEOUT_MS) {
      id = newId();
      store.set(SESSION_KEY, id);
    }
    store.set(LAST_ACTIVITY_KEY, String(now));
    return id;
  }

  // ---------- queue + transport ----------

  var queue = [];
  var timer = null;

  function send(events, useBeacon) {
    var body = JSON.stringify({ events: events });
    // text/plain keeps this a "simple" CORS request: no preflight round trip.
    if (useBeacon && navigator.sendBeacon) {
      var ok = navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain' }));
      if (ok) return;
    }
    if (window.fetch) {
      fetch(ENDPOINT, { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain' }, keepalive: true, mode: 'cors' }).catch(
        function (err) {
          if (DEBUG) console.warn('[cf-analytics] send failed', err);
        }
      );
    }
  }

  function flush(useBeacon) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    while (queue.length) send(queue.splice(0, MAX_BATCH), useBeacon);
  }

  function enqueue(event) {
    if (DEBUG) console.log('[cf-analytics]', event.type, event);
    queue.push(event);
    if (queue.length >= MAX_BATCH) flush(false);
    else if (!timer) timer = setTimeout(function () { flush(false); }, FLUSH_INTERVAL_MS);
  }

  // ---------- event construction ----------

  function pageSize() {
    var d = document.documentElement;
    var b = document.body || d;
    return {
      pageWidth: Math.max(d.scrollWidth, b.scrollWidth, d.clientWidth),
      pageHeight: Math.max(d.scrollHeight, b.scrollHeight, d.clientHeight),
    };
  }

  function baseEvent(type) {
    var size = pageSize();
    return {
      sessionId: getSessionId(),
      type: type,
      url: location.href,
      timestamp: new Date().toISOString(),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      pageWidth: size.pageWidth,
      pageHeight: size.pageHeight,
      title: document.title,
    };
  }

  function describe(el) {
    if (!el || el.nodeType !== 1) return undefined;
    var s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    var text = (el.innerText || el.value || el.alt || '').trim().replace(/\s+/g, ' ');
    if (text) s += ' "' + text.slice(0, 40) + '"';
    return s;
  }

  var lastPageViewUrl = null;

  function trackPageView() {
    if (location.href === lastPageViewUrl) return; // ignore duplicate SPA notifications
    lastPageViewUrl = location.href;
    var e = baseEvent('page_view');
    e.referrer = document.referrer || undefined;
    enqueue(e);
  }

  function trackClick(ev) {
    var e = baseEvent('click');
    // pageX/pageY are relative to the whole document, so scroll position is included.
    e.x = Math.round(ev.pageX);
    e.y = Math.round(ev.pageY);
    e.target = describe(ev.target && ev.target.closest ? ev.target.closest('a,button,input,select,textarea,[role=button],[id]') || ev.target : ev.target);
    enqueue(e);
  }

  // ---------- wiring ----------

  document.addEventListener('click', trackClick, true);

  // Single-page apps: treat history navigation as a page view.
  ['pushState', 'replaceState'].forEach(function (fn) {
    var orig = history[fn];
    if (!orig) return;
    history[fn] = function () {
      var r = orig.apply(this, arguments);
      setTimeout(trackPageView, 0);
      return r;
    };
  });
  window.addEventListener('popstate', trackPageView);

  // Send whatever is queued when the page is hidden or closed.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush(true);
  });
  window.addEventListener('pagehide', function () { flush(true); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', trackPageView);
  else trackPageView();

  window.__cfAnalytics = { flush: function () { flush(false); }, sessionId: getSessionId, endpoint: ENDPOINT };
})();
