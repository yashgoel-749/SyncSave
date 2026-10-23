import * as dotenv from 'dotenv';
dotenv.config();

import * as http from 'http';
import { WebSocketServer } from 'ws';
import { setupWSConnection, revokeUserConnections, updateUserRole } from './yjsHandler';
import { logger } from './logger';
import { documentManager } from './documentManager';
import { getCollabSecret } from './auth';

const PORT = parseInt(process.env.PORT ?? '1234', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

// Allowed origins — tighten in production via env
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim());

const server = http.createServer((req, res) => {
  // Basic health-check endpoint
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }

  // Internal permission revocation endpoint
  const url = new URL(req.url || '', 'http://localhost');
  const revokeMatch = url.pathname.match(/^\/internal\/rooms\/([^/]+)\/revoke$/);
  const updateRoleMatch = url.pathname.match(/^\/internal\/rooms\/([^/]+)\/update-role$/);

  if (req.method === 'POST' && (revokeMatch || updateRoleMatch)) {
    const authHeader = req.headers.authorization;
    const expectedSecret = getCollabSecret();
    if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const docId = decodeURIComponent((revokeMatch || updateRoleMatch)![1]);
        const userId = payload.userId;

        if (!docId || !userId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing docId or userId' }));
          return;
        }

        if (revokeMatch) {
          const evicted = revokeUserConnections(docId, userId);
          logger.info(`Internal revocation: evicted ${evicted} sockets for user ${userId} in ${docId}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, evicted }));
          return;
        }

        if (updateRoleMatch) {
          const role = payload.role;
          if (role !== 'EDITOR' && role !== 'VIEWER') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid role' }));
            return;
          }
          const updated = updateUserRole(docId, userId, role);
          logger.info(`Internal role update: updated ${updated} sockets for user ${userId} to ${role} in ${docId}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, updated }));
          return;
        }
      } catch (err) {
        logger.error('Error handling internal endpoint:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
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
