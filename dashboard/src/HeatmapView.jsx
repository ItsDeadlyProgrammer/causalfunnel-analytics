import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { navigate } from './useHashRoute.js';

const GRID_CELL = 40; // px, in reference-page coordinates

/**
 * Clicks come from different screen sizes. We map every click onto one
 * reference layout: x is scaled by (referenceWidth / pageWidth at click time),
 * y is kept as-is (document pixels from the top). This is exact for fixed-width
 * layouts and a close approximation for responsive ones.
 */
function toReference(clicks) {
  const widths = clicks.map((c) => c.pageWidth || c.viewportWidth).filter(Boolean);
  const refWidth = widths.length ? mode(widths) : 1280;
  const points = clicks.map((c) => {
    const w = c.pageWidth || c.viewportWidth || refWidth;
    return { x: (c.x / w) * refWidth, y: c.y, target: c.target };
  });
  const maxPageHeight = Math.max(800, ...clicks.map((c) => c.pageHeight || 0), ...points.map((p) => p.y + 20));
  return { refWidth, refHeight: maxPageHeight, points };
}

function mode(values) {
  const counts = new Map();
  let best = values[0];
  for (const v of values) {
    const n = (counts.get(v) || 0) + 1;
    counts.set(v, n);
    if (n > counts.get(best)) best = v;
  }
  return best;
}

export default function HeatmapView({ pageUrl }) {
  const [pages, setPages] = useState(null);
  const [heatmap, setHeatmap] = useState(null);
  const [error, setError] = useState(null);
  const [display, setDisplay] = useState('dots');
  const [showPage, setShowPage] = useState(true);

  useEffect(() => {
    api
      .pages()
      .then((d) => {
        setPages(d.pages);
        // Default to the page with the most clicks.
        if (!pageUrl && d.pages.length) navigate(`/heatmap?page=${encodeURIComponent(d.pages[0].pageUrl)}`);
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pageUrl) return;
    let cancelled = false;
    setHeatmap(null);
    api
      .heatmap(pageUrl)
      .then((d) => !cancelled && setHeatmap(d))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [pageUrl]);

  return (
    <section className="panel">
      <div className="panel-head heatmap-head">
        <h2>Click heatmap</h2>
        <div className="controls">
          <label>
            Page{' '}
            <select
              value={pageUrl || ''}
              onChange={(e) => navigate(`/heatmap?page=${encodeURIComponent(e.target.value)}`)}
              disabled={!pages || pages.length === 0}
            >
              {!pageUrl && <option value="">Select a page…</option>}
              {pages?.map((p) => (
                <option key={p.pageUrl} value={p.pageUrl}>
                  {p.pageUrl} ({p.clicks} clicks)
                </option>
              ))}
            </select>
          </label>
          <div className="segmented" role="group" aria-label="Display">
            <button className={display === 'dots' ? 'active' : ''} onClick={() => setDisplay('dots')}>
              Dots
            </button>
            <button className={display === 'grid' ? 'active' : ''} onClick={() => setDisplay('grid')}>
              Grid
            </button>
          </div>
          <label className="check">
            <input type="checkbox" checked={showPage} onChange={(e) => setShowPage(e.target.checked)} /> Show page
          </label>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {pages && pages.length === 0 && (
        <div className="empty">
          No pages tracked yet. Open the <a href={api.demoUrl()} target="_blank" rel="noreferrer">demo site</a> and click
          around.
        </div>
      )}
      {pageUrl && !heatmap && !error && <p className="muted">Loading clicks…</p>}
      {heatmap && (
        <>
          <p className="muted summary">
            <strong>{heatmap.count}</strong> clicks on <code>{heatmap.pageUrl}</code>
          </p>
          <HeatmapCanvas clicks={heatmap.clicks} pageUrl={heatmap.pageUrl} display={display} showPage={showPage} />
        </>
      )}
    </section>
  );
}

function HeatmapCanvas({ clicks, pageUrl, display, showPage }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { refWidth, refHeight, points } = useMemo(() => toReference(clicks), [clicks]);
  const scale = width ? Math.min(1, width / refWidth) : 0;

  const cells = useMemo(() => {
    if (display !== 'grid') return [];
    const map = new Map();
    for (const p of points) {
      const key = `${Math.floor(p.x / GRID_CELL)}:${Math.floor(p.y / GRID_CELL)}`;
      map.set(key, (map.get(key) || 0) + 1);
    }
    const max = Math.max(1, ...map.values());
    return [...map.entries()].map(([key, n]) => {
      const [cx, cy] = key.split(':').map(Number);
      return { cx, cy, n, intensity: n / max };
    });
  }, [points, display]);

  const canFrame = /^https?:/.test(pageUrl);

  return (
    <div className="heatmap-wrap" ref={wrapRef}>
      {scale > 0 && (
        <div className="heatmap-stage" style={{ width: refWidth * scale, height: refHeight * scale }}>
          <div className="heatmap-layer" style={{ width: refWidth, height: refHeight, transform: `scale(${scale})` }}>
            {showPage && canFrame && (
              // The tracker skips frames named cf-heatmap-preview, so viewing a heatmap never
              // records fake page views. Sandboxed so the page cannot navigate the dashboard.
              <iframe className="heatmap-frame" src={pageUrl} name="cf-heatmap-preview" title="Page preview" tabIndex={-1} sandbox="allow-scripts" />
            )}
            {display === 'dots' &&
              points.map((p, i) => (
                <span
                  key={i}
                  className="dot"
                  style={{ left: p.x, top: p.y, width: 18 / scale, height: 18 / scale }}
                  title={p.target || `${Math.round(p.x)}, ${p.y}`}
                />
              ))}
            {display === 'grid' &&
              cells.map((c) => (
                <span
                  key={`${c.cx}:${c.cy}`}
                  className="cell"
                  style={{
                    left: c.cx * GRID_CELL,
                    top: c.cy * GRID_CELL,
                    width: GRID_CELL,
                    height: GRID_CELL,
                    background: `rgba(234, 67, 53, ${0.15 + 0.7 * c.intensity})`,
                  }}
                  title={`${c.n} click${c.n === 1 ? '' : 's'}`}
                >
                  {c.n}
                </span>
              ))}
          </div>
        </div>
      )}
      <p className="muted footnote">
        Reference width {refWidth}px. Clicks from other screen sizes are scaled horizontally to fit.
      </p>
    </div>
  );
}
