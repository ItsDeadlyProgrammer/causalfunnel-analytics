import { useEffect, useState } from 'react';

// Tiny hash router: "#/sessions/abc" -> { view: 'sessions', param: 'abc', query }
function parse() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  const [view = 'sessions', ...rest] = path.split('/').filter(Boolean);
  return { view, param: rest.length ? decodeURIComponent(rest.join('/')) : null, query: new URLSearchParams(qs) };
}

export function useHashRoute() {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export const navigate = (hash) => {
  window.location.hash = hash;
};
