import { useHashRoute, navigate } from './useHashRoute.js';
import SessionsView from './SessionsView.jsx';
import HeatmapView from './HeatmapView.jsx';
import { api } from './api.js';

export default function App() {
  const route = useHashRoute();
  const view = route.view === 'heatmap' ? 'heatmap' : 'sessions';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          User Analytics
        </div>
        <nav className="tabs" aria-label="Views">
          <button className={view === 'sessions' ? 'tab active' : 'tab'} onClick={() => navigate('/sessions')}>
            Sessions
          </button>
          <button className={view === 'heatmap' ? 'tab active' : 'tab'} onClick={() => navigate('/heatmap')}>
            Heatmap
          </button>
        </nav>
        <a className="demo-link" href={api.demoUrl()} target="_blank" rel="noreferrer">
          Open demo site ↗
        </a>
      </header>
      <main className="content">
        {view === 'sessions' ? (
          <SessionsView selectedId={route.param} />
        ) : (
          <HeatmapView pageUrl={route.query.get('page')} />
        )}
      </main>
    </div>
  );
}
