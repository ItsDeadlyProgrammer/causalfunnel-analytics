import { useHashRoute } from './useHashRoute.js';
import SessionsView from './SessionsView.jsx';
import HeatmapView from './HeatmapView.jsx';
import { api } from './api.js';

export default function App() {
  const route = useHashRoute();
  const view = route.view === 'heatmap' ? 'heatmap' : 'sessions';

  return (
    <>
      <header className="header">
        <strong>Analytics</strong>
        <nav>
          <a href="#/sessions" className={view === 'sessions' ? 'current' : ''}>
            Sessions
          </a>
          <a href="#/heatmap" className={view === 'heatmap' ? 'current' : ''}>
            Heatmap
          </a>
        </nav>
        <a className="right" href={api.demoUrl()} target="_blank" rel="noreferrer">
          Demo site
        </a>
      </header>
      <main>
        {view === 'sessions' ? <SessionsView selectedId={route.param} /> : <HeatmapView pageUrl={route.query.get('page')} />}
      </main>
    </>
  );
}
