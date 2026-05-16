import { io } from 'https://cdn.socket.io/4.8.1/socket.io.esm.min.js';
import state from './state.js';

let socket = null;

export function connectSocket() {
  if (socket?.connected) return socket;

  const url = window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : window.location.origin;

  socket = io(url, {
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    timeout: 10000,
  });

  socket.on('connect', () => {
    state.set('myId', socket.id);
    console.log('[Socket] Connected:', socket.id);
  });

  socket.on('disconnect', (reason) => {
    console.log('[Socket] Disconnected:', reason);
  });

  return socket;
}

export function getSocket() {
  if (!socket) return connectSocket();
  return socket;
}

export function emitWithAck(event, data) {
  return new Promise((resolve) => {
    getSocket().emit(event, data, resolve);
  });
}

export default { connectSocket, getSocket, emitWithAck };
