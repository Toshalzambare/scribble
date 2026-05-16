import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import path from 'path';
import config from './config.js';
import { setupSocketHandlers } from './socketHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);

// Socket.IO setup
const io = new Server(httpServer, {
  cors: {
    origin: config.isDev() ? '*' : config.clientUrl,
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// In production, serve the built Vite client
if (config.isProd()) {
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), env: config.nodeEnv });
});

// Setup socket handlers
setupSocketHandlers(io);

// Start server
httpServer.listen(config.port, () => {
  console.log(`\n  ╔════════════════════════════════════════╗`);
  console.log(`  ║   🎮  PixelArena Server Running        ║`);
  console.log(`  ║   Port: ${String(config.port).padEnd(30)}║`);
  console.log(`  ║   Mode: ${String(config.nodeEnv).padEnd(30)}║`);
  console.log(`  ╚════════════════════════════════════════╝\n`);
});

export default app;
