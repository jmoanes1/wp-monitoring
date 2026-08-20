import path from 'path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config, defaultSettings } from './config/index.js';
import { initializeStorage } from './storage/jsonStorage.js';
import { ensureDefaultAdmin } from './services/authService.js';
import { securityMiddleware } from './middleware/security.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import apiRoutes from './routes/index.js';

/**
 * Shared Express app used by the local Node server and the Vercel
 * serverless function. Does not listen and does not start Socket.IO
 * or the monitoring worker.
 */
export async function createApp({ serverless = false } = {}) {
  await initializeStorage({
    collections: {
      [config.files.websites]: [],
      [config.files.forms]: [],
      [config.files.notifications]: [],
      [config.files.incidents]: [],
      [config.files.monitoring]: [],
      [config.files.updates]: [],
      [config.files.users]: [],
      [config.files.credentials]: [],
      [config.files.formTests]: []
    },
    documents: {
      [config.files.settings]: defaultSettings
    }
  });
  await ensureDefaultAdmin();

  const app = express();
  app.set('trust proxy', 1);
  app.use(...securityMiddleware());
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Vercel may rewrite /api/auth/login to the function at /api and drop
  // the rest of the path. Put /api back so Express route matching works.
  if (serverless) {
    app.use((req, _res, next) => {
      const forwarded = String(req.headers['x-forwarded-uri'] || req.headers['x-invoke-path'] || '');
      const current = (req.originalUrl || req.url || '').split('?')[0];
      if (forwarded.startsWith('/api/') && current !== forwarded.split('?')[0]) {
        req.url = forwarded;
      } else if (!current.startsWith('/api')) {
        const [pathname, query] = (req.url || '/').split('?');
        req.url = `/api${pathname === '/' ? '' : pathname}${query ? `?${query}` : ''}`;
      }
      next();
    });
  }

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timezone: config.timezone });
  });

  app.use('/api', apiRoutes);

  if (!serverless && config.env === 'production') {
    app.use(express.static(config.paths.clientDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
        return next();
      }
      return res.sendFile(path.join(config.paths.clientDist, 'index.html'));
    });
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
