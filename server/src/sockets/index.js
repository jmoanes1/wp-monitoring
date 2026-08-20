import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { setIo } from './emitter.js';
import { logger } from '../utils/logger.js';

function readToken(socket) {
  return (
    socket.handshake.auth?.token ||
    socket.handshake.query?.token ||
    socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '')
  );
}

export function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: config.clientUrl,
      credentials: true
    }
  });

  io.use((socket, next) => {
    try {
      const token = readToken(socket);
      if (!token) {
        return next(new Error('Authentication required'));
      }
      const payload = jwt.verify(token, config.jwtSecret);
      socket.user = { id: payload.sub, username: payload.username, role: payload.role };
      return next();
    } catch {
      return next(new Error('Invalid authentication token'));
    }
  });

  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.user.username}`);
    socket.join('operators');

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.user.username}`);
    });
  });

  setIo(io);
  return io;
}
