import { io } from 'socket.io-client';
import { getToken } from './api.js';

let socket;

export function connectSocket() {
  if (socket?.connected) return socket;
  socket = io({
    auth: { token: getToken() },
    transports: ['websocket', 'polling']
  });
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getSocket() {
  return socket;
}
