import http from 'http';
import { config } from './config/index.js';
import { createApp } from './app.js';
import { createSocketServer } from './sockets/index.js';
import { startMonitorWorker } from './workers/monitorWorker.js';
import { logger } from './utils/logger.js';

async function bootstrap() {
  // Startup order: JSON files → Express → Socket.IO → HTTP listen → worker.
  logger.info('Loading configuration');
  const app = await createApp({ serverless: false });

  const server = http.createServer(app);
  createSocketServer(server);

  // Bind IPv4 in development so the Vite proxy at 127.0.0.1 can connect.
  // Production listens on all interfaces so a host/reverse proxy can reach it.
  const listenHost = config.env === 'production' ? '0.0.0.0' : '127.0.0.1';
  try {
    await listenWithRetry(server, config.port, listenHost);
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      logger.error(
        `Port ${config.port} is already in use. Stop the other process using that port, then save a file to retry.`
      );
      process.exit(1);
    }
    throw error;
  }

  logger.info(`HTTP server listening on ${listenHost}:${config.port}`);
  startMonitorWorker();
}

/**
 * Listen and retry when the previous `node --watch` process has not
 * released the port yet. Without an 'error' handler, EADDRINUSE becomes
 * an unhandled event and the watcher sits on "Failed running".
 */
function listenWithRetry(server, port, host = '127.0.0.1', attempts = 8, delayMs = 500) {
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
      server.listen(port, host);
    };

    tryListen();
  });
}

bootstrap().catch((error) => {
  logger.error(`Startup failed: ${error.message}`);
  process.exit(1);
});
