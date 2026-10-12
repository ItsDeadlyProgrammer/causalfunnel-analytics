import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { router as apiRouter } from './routes/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const TRACKER_FILE = path.join(ROOT, 'tracker', 'tracker.js');
const DEMO_DIR = path.resolve(here, '../public/demo');
const DASHBOARD_DIR = path.join(ROOT, 'dashboard', 'dist');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  // The tracker runs on third-party sites, so ingest must accept any origin.
  app.use(cors());
  // text/plain is what navigator.sendBeacon sends; parse it as a raw string.
  app.use(express.json({ limit: '256kb' }));
  app.use(express.text({ type: 'text/plain', limit: '256kb' }));

  app.get('/health', (req, res) => {
    const ok = mongoose.connection.readyState === 1;
    res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'db-unavailable' });
  });

  app.get('/tracker.js', (req, res) => {
    res.type('application/javascript');
    res.set('Cache-Control', 'public, max-age=300');
    res.sendFile(TRACKER_FILE);
  });

  app.use('/api', apiRouter);
  app.use('/demo', express.static(DEMO_DIR));

  // In production the API also serves the built dashboard (single deployable).
  if (fs.existsSync(path.join(DASHBOARD_DIR, 'index.html'))) {
    app.use(express.static(DASHBOARD_DIR));
    app.get(/^\/(?!api|demo|tracker\.js|health).*/, (req, res) => res.sendFile(path.join(DASHBOARD_DIR, 'index.html')));
  }

  app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'body is not valid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload too large' });
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}
