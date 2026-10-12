import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
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
    <div className="columns">
      <section>
        <div className="title-row">
          <h2>Sessions{data ? ` (${data.total})` : ''}</h2>
          <button onClick={load} disabled={loading}>
            Refresh
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {data && data.sessions.length === 0 && <p className="muted">No sessions yet.</p>}
        {data && data.sessions.length > 0 && (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Entry page</th>
                  <th>Last active</th>
                  <th className="num">Views</th>
                  <th className="num">Clicks</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.sessions.map((s) => (
                  <tr key={s.sessionId} className={s.sessionId === selectedId ? 'selected' : ''}>
                    <td>
                      <a href={`#/sessions/${encodeURIComponent(s.sessionId)}`} title={s.sessionId}>
                        {shortId(s.sessionId)}
                      </a>
                    </td>
                    <td>{shortPath(s.entryPage)}</td>
                    <td className="nowrap">{fmtDateTime(s.lastSeen)}</td>
                    <td className="num">{s.pageViews}</td>
                    <td className="num">{s.clicks}</td>
                    <td className="num">{s.eventCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && totalPages > 1 && (
          <p className="pager">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>{' '}
            Page {page} of {totalPages}{' '}
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </p>
        )}
      </section>

      <section>{selectedId ? <Journey sessionId={selectedId} /> : <p className="muted">Click a session to see its events.</p>}</section>
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

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const { session, events } = data;
  const start = new Date(session.firstSeen).getTime();

  return (
    <>
      <h2>Session {shortId(session.sessionId)}</h2>
      <p className="muted">
        {session.eventCount} events, {session.pageViews} page views, {session.clicks} clicks, lasted{' '}
        {fmtDuration(new Date(session.lastSeen) - start)}
      </p>
      <div className="scroll-x">
        <table className="events">
          <thead>
            <tr>
              <th>Time</th>
              <th>Event</th>
              <th>Page</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e._id}>
                <td className="nowrap">{fmtTime(e.timestamp)}</td>
                <td className="nowrap">{e.type === 'page_view' ? 'Page view' : 'Click'}</td>
                <td>
                  <a href={e.url} target="_blank" rel="noreferrer">
                    {shortPath(e.url)}
                  </a>
                </td>
                <td className="details">
                  {e.type === 'click' ? (
                    <>
                      {e.target && <code>{e.target}</code>} at ({e.x}, {e.y})
                    </>
                  ) : (
                    e.title
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
