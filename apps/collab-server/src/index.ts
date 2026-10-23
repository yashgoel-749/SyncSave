import * as dotenv from 'dotenv';
dotenv.config();

import * as http from 'http';
import { WebSocketServer } from 'ws';
import { setupWSConnection } from './yjsHandler';
import { logger } from './logger';
import { documentManager } from './documentManager';

const PORT = parseInt(process.env.PORT ?? '1234', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

// Allowed origins — tighten in production via env
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim());

const server = http.createServer((_req, res) => {
  // Basic health-check endpoint
  if (_req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 10 * 1024 * 1024, // 10 MB max message size
});

server.on('upgrade', (request, socket, head) => {
  const origin = request.headers.origin ?? '';

  const isAllowed =
    process.env.NODE_ENV !== 'production' ||
    ALLOWED_ORIGINS.includes(origin);

  if (!isAllowed) {
    logger.warn(`Rejected WebSocket from disallowed origin: ${origin}`);
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws, req) => {
  logger.info(`New connection from ${req.socket.remoteAddress}`);
  setupWSConnection(ws, req);
});

server.listen(PORT, HOST, () => {
  logger.info(`SyncSpace collab server listening on ${HOST}:${PORT}`);
});

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}, flushing pending updates and shutting down gracefully…`);
  try {
    await documentManager.flushAll();
  } catch (err) {
    logger.error('Error flushing documents during shutdown:', err);
  }

  wss.close(() => {
    server.close(() => {
      logger.info('Server closed. Bye!');
      process.exit(0);
    });
  });

  // Force exit after 10 s if graceful shutdown hangs
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
