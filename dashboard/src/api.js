// Same-origin in production (the API serves the dashboard); proxied by Vite in dev.
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export const api = {
  sessions: (page = 1, limit = 20) => get(`/api/sessions?page=${page}&limit=${limit}`),
  sessionEvents: (id) => get(`/api/sessions/${encodeURIComponent(id)}/events`),
  pages: () => get('/api/pages'),
  heatmap: (pageUrl) => get(`/api/heatmap?pageUrl=${encodeURIComponent(pageUrl)}`),
  demoUrl: () => `${BASE || window.location.origin}/demo/index.html`,
};
