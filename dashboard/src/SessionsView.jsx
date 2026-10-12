import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { navigate } from './useHashRoute.js';
import { fmtDateTime, fmtDuration, fmtTime, shortId, shortPath } from './format.js';

const PAGE_SIZE = 20;

export default function SessionsView({ selectedId }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.sessions(page, PAGE_SIZE));
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="split">
      <section className="panel sessions-panel">
        <div className="panel-head">
          <h2>Sessions {data && <span className="muted">({data.total})</span>}</h2>
          <button className="ghost" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        {error && <p className="error">Could not load sessions: {error}</p>}
        {data && data.sessions.length === 0 && (
          <div className="empty">
            No sessions yet. Open the <a href={api.demoUrl()} target="_blank" rel="noreferrer">demo site</a>, click
            around, then press Refresh.
          </div>
        )}
        {data && data.sessions.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Last active</th>
                  <th className="num">Views</th>
                  <th className="num">Clicks</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.sessions.map((s) => (
                  <tr
                    key={s.sessionId}
                    className={s.sessionId === selectedId ? 'selected' : ''}
                    onClick={() => navigate(`/sessions/${encodeURIComponent(s.sessionId)}`)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(`/sessions/${encodeURIComponent(s.sessionId)}`)}
                  >
                    <td>
                      <code title={s.sessionId}>{shortId(s.sessionId)}</code>
                      <div className="sub">{shortPath(s.entryPage)}</div>
                    </td>
                    <td>{fmtDateTime(s.lastSeen)}</td>
                    <td className="num">{s.pageViews}</td>
                    <td className="num">{s.clicks}</td>
                    <td className="num strong">{s.eventCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && totalPages > 1 && (
          <div className="pager">
            <button className="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              ← Prev
            </button>
            <span className="muted">
              Page {page} of {totalPages}
            </span>
            <button className="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next →
            </button>
          </div>
        )}
      </section>

      <section className="panel journey-panel">
        {selectedId ? <Journey sessionId={selectedId} /> : <div className="empty">Select a session to see its user journey.</div>}
      </section>
    </div>
  );
}

function Journey({ sessionId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api
      .sessionEvents(sessionId)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (error) return <p className="error">Could not load session: {error}</p>;
  if (!data) return <p className="muted">Loading journey…</p>;

  const { session, events } = data;
  const start = new Date(session.firstSeen).getTime();

  return (
    <>
      <div className="panel-head">
        <h2>User journey</h2>
        <code className="muted" title={session.sessionId}>
          {session.sessionId}
        </code>
      </div>
      <div className="stats">
        <Stat label="Events" value={session.eventCount} />
        <Stat label="Page views" value={session.pageViews} />
        <Stat label="Clicks" value={session.clicks} />
        <Stat label="Duration" value={fmtDuration(new Date(session.lastSeen) - start)} />
      </div>
      <ol className="timeline">
        {events.map((e) => (
          <li key={e._id} className={`tl-item ${e.type}`}>
            <span className="tl-dot" aria-hidden="true" />
            <div className="tl-body">
              <div className="tl-head">
                <span className={`badge ${e.type}`}>{e.type === 'page_view' ? 'Page view' : 'Click'}</span>
                <span className="tl-time">
                  {fmtTime(e.timestamp)} <span className="muted">+{fmtDuration(new Date(e.timestamp) - start)}</span>
                </span>
              </div>
              <div className="tl-detail">
                <a href={e.url} target="_blank" rel="noreferrer" title={e.url}>
                  {shortPath(e.url)}
                </a>
                {e.type === 'page_view' && e.title && <span className="muted"> · {e.title}</span>}
                {e.type === 'click' && (
                  <>
                    <span className="muted">
                      {' '}
                      · ({e.x}, {e.y})
                    </span>
                    {e.target && <div className="target">{e.target}</div>}
                  </>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
