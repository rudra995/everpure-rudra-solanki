// Express application (no listening here, so tests can mount it directly).
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { db } from './data/index.js';
import { authenticate } from './rbac/middleware.js';
import authRoutes from './routes/auth.js';
import healthRoutes from './routes/health.js';
import costRoutes from './routes/cost.js';
import reportRoutes from './routes/reports.js';
import orphanedRoutes from './routes/orphaned.js';
import alertRoutes from './routes/alerts.js';
import { dataQuality, auditRoutes, simulatorRoutes } from './routes/admin.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.clientOrigin }));
  app.use(express.json({ limit: '100kb' }));

  // Public: liveness probe for load balancers / uptime checks.
  app.get('/healthz', (_req, res) => res.json({ status: 'ok', data_source: db.name, uptime_sec: Math.round(process.uptime()) }));

  app.use('/api/auth', authRoutes);

  // Everything below requires a valid JWT; each router then checks permissions.
  app.use('/api', authenticate);
  app.use('/api/health', healthRoutes);
  app.use('/api/cost', costRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/orphaned', orphanedRoutes);
  app.use('/api/alerts', alertRoutes);
  app.use('/api/data-quality', dataQuality);
  app.use('/api/audit', auditRoutes);
  app.use('/api/simulator', simulatorRoutes);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found', message: 'No such endpoint' }));

  // Central error handler. Express 5 forwards rejected promises from async routes here.
  // eslint-disable-next-line no-unused-vars
  // Errors thrown with a status (e.g. by the ownership service) get the same codes as the routes.
  const CODE = { 400: 'bad_request', 401: 'unauthenticated', 403: 'forbidden', 404: 'not_found', 409: 'conflict' };
  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[error]', err);
    res.status(status).json({
      error: status >= 500 ? 'internal_error' : (CODE[status] ?? 'bad_request'),
      message: status >= 500 ? 'Unexpected server error' : err.message,
    });
  });

  return app;
}
