import http from 'http';
import path from 'path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config, defaultSettings } from './config/index.js';
import { initializeStorage } from './storage/jsonStorage.js';
import { ensureDefaultAdmin } from './services/authService.js';
import { createSocketServer } from './sockets/index.js';
import { startMonitorWorker } from './workers/monitorWorker.js';
import { securityMiddleware } from './middleware/security.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import apiRoutes from './routes/index.js';
import { logger } from './utils/logger.js';

async function bootstrap() {
  // Startup order: config already loaded → JSON files → Express → Socket.IO → HTTP listen → worker.
  logger.info('Loading configuration');
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

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, timezone: config.timezone });
  });

  app.use('/api', apiRoutes);

  if (config.env === 'production') {
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

  const server = http.createServer(app);
  createSocketServer(server);

  // Bind before starting the worker so a failed listen never leaves a
  // background monitor running against a dead HTTP server.
  try {
    await listenWithRetry(server, config.port);
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      logger.error(
        `Port ${config.port} is already in use. Stop the other process using that port, then save a file to retry.`
      );
      process.exit(1);
    }
    throw error;
  }

  logger.info(`HTTP server listening on port ${config.port}`);
  startMonitorWorker();
}

/**
 * Listen and retry when the previous `node --watch` process has not
 * released the port yet. Without an 'error' handler, EADDRINUSE becomes
 * an unhandled event and the watcher sits on "Failed running".
 */
function listenWithRetry(server, port, attempts = 8, delayMs = 500) {
  return new Promise((resolve, reject) => {
    let attempt = 0;

    const tryListen = () => {
      attempt += 1;

      const onError = (error) => {
        server.off('listening', onListening);

        if (error.code === 'EADDRINUSE' && attempt < attempts) {
          logger.warn(`Port ${port} is in use, retrying in ${delayMs}ms (${attempt}/${attempts})`);
          setTimeout(tryListen, delayMs);
          return;
        }

        reject(error);
      };

      const onListening = () => {
        server.off('error', onError);
        resolve();
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port);
    };

    tryListen();
  });
}

bootstrap().catch((error) => {
  logger.error(`Startup failed: ${error.message}`);
  process.exit(1);
});
