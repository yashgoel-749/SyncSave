import * as http from 'http';
import crypto from 'crypto';
import { WebSocketServer } from 'ws';
import {
  setupWSConnection,
  revokeUserConnections,
  updateUserRole,
  getActiveConnectionCount,
  getActiveRoomCount,
  closeAllConnections,
} from './yjsHandler';
import { logger } from './logger';
import { documentManager, prisma } from './documentManager';
import { getCollabSecret } from './auth';
import { config, isOriginAllowed } from './config';

let isShuttingDown = false;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);

  // Basic liveness probe
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        uptime: process.uptime(),
        connections: getActiveConnectionCount(),
        rooms: getActiveRoomCount(),
        residentDocuments: documentManager.getResidentDocumentCount(),
        memory: process.memoryUsage(),
        version: '0.1.0',
      })
    );
    return;
  }

  // Kubernetes / Render readiness probe
  if (url.pathname === '/ready') {
    if (isShuttingDown) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'shutting_down' }));
      return;
    }

    const isDbHealthy = await documentManager.checkDatabaseHealth();
    if (!isDbHealthy) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'not_ready', database: 'disconnected' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ready', database: 'connected' }));
    return;
  }

  // Internal permission revocation and role update endpoints
  const revokeMatch = url.pathname.match(/^\/internal\/rooms\/([^/]+)\/revoke$/);
  const updateRoleMatch = url.pathname.match(/^\/internal\/rooms\/([^/]+)\/update-role$/);

  if (req.method === 'POST' && (revokeMatch || updateRoleMatch)) {
    const authHeader = req.headers.authorization;
    const expectedSecret = getCollabSecret();
    const expectedHeader = `Bearer ${expectedSecret}`;

    // Timing-safe secret verification to prevent timing attacks
    const isAuthorized =
      typeof authHeader === 'string' &&
      authHeader.length === expectedHeader.length &&
      crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expectedHeader));

    if (!isAuthorized) {
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

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: config.maxPayloadBytes,
});

server.on('upgrade', (request, socket, head) => {
  if (isShuttingDown) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\nServer is shutting down');
    socket.destroy();
    return;
  }

  // Pre-upgrade server capacity check
  if (getActiveConnectionCount() >= config.maxConnections) {
    logger.warn('Rejected WebSocket upgrade: max concurrent connections limit reached');
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\nServer capacity reached');
    socket.destroy();
    return;
  }

  const origin = request.headers.origin;
  if (!isOriginAllowed(origin)) {
    logger.warn(`Rejected WebSocket from disallowed origin: ${origin || 'none'}`);
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\nDisallowed origin');
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

export { server, wss };

if (process.env.NODE_ENV !== 'test') {
  server.listen(config.port, config.host, () => {
    logger.info(`SyncSpace collab server listening on ${config.host}:${config.port} (env: ${config.nodeEnv})`);
  });
}

// Graceful shutdown handling
export const shutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}, initiating graceful shutdown…`);

  // Stop accepting new HTTP requests
  server.close(() => {
    logger.info('HTTP server closed to new requests.');
  });

  // Notify and close active WebSockets with status code 1001 (Server going away)
  const closedCount = closeAllConnections(1001, 'Server shutting down');
  logger.info(`Closed ${closedCount} active WebSocket connections.`);

  // Flush all dirty Yjs documents to PostgreSQL
  try {
    await documentManager.flushAll();
    logger.info('All documents successfully flushed to PostgreSQL.');
  } catch (err) {
    logger.error('Error flushing documents during graceful shutdown:', err);
  }

  // Disconnect database client
  try {
    await prisma.$disconnect();
    logger.info('Database client disconnected.');
  } catch (err) {
    logger.warn('Error disconnecting database client:', err);
  }

  wss.close(() => {
    logger.info('WebSocket server closed. Graceful shutdown complete.');
    if (process.env.NODE_ENV !== 'test') {
      process.exit(0);
    }
  });

  // Safety fallback: force exit after 10 seconds if hanging
  setTimeout(() => {
    logger.error('Graceful shutdown timed out after 10s. Forcefully exiting.');
    if (process.env.NODE_ENV !== 'test') {
      process.exit(1);
    }
  }, 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
