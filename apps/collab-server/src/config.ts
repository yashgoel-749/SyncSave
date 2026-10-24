import * as dotenv from 'dotenv';
dotenv.config();

export interface ServerConfig {
  port: number;
  host: string;
  nodeEnv: 'development' | 'production' | 'test';
  authSecret: string;
  allowedOrigins: string[];
  maxConnections: number;
  maxConnectionsPerIp: number;
  messageRateLimitPerSec: number;
  maxPayloadBytes: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export function normalizeOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return origin.trim().replace(/\/+$/, '').toLowerCase();
  }
}

export function loadConfig(): ServerConfig {
  const nodeEnv = (process.env.NODE_ENV || 'development') as 'development' | 'production' | 'test';
  const port = parseInt(process.env.PORT || '1234', 10);
  const host = process.env.HOST || '0.0.0.0';

  const defaultSecret = 'syncspace-collab-secret-2026';
  const authSecret =
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    (nodeEnv === 'production' ? '' : defaultSecret);

  if (nodeEnv === 'production') {
    if (!authSecret || authSecret === defaultSecret) {
      throw new Error(
        'FATAL: In production, AUTH_SECRET (or NEXTAUTH_SECRET) must be set to a secure, random string (minimum 16 characters).'
      );
    }
    if (authSecret.length < 16) {
      throw new Error('FATAL: AUTH_SECRET must be at least 16 characters long in production.');
    }
  }

  const rawOrigins = process.env.ALLOWED_ORIGINS || 'http://localhost:3000';
  const allowedOrigins = rawOrigins
    .split(',')
    .map((o) => normalizeOrigin(o))
    .filter(Boolean);

  const maxConnections = parseInt(process.env.MAX_CONNECTIONS || '1000', 10);
  const maxConnectionsPerIp = parseInt(process.env.MAX_CONNECTIONS_PER_IP || '50', 10);
  const messageRateLimitPerSec = parseInt(process.env.MESSAGE_RATE_LIMIT_PER_SEC || '100', 10);
  const maxPayloadBytes = parseInt(process.env.MAX_PAYLOAD_BYTES || `${10 * 1024 * 1024}`, 10);
  const logLevel = (process.env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error';

  return {
    port,
    host,
    nodeEnv,
    authSecret: authSecret || defaultSecret,
    allowedOrigins,
    maxConnections,
    maxConnectionsPerIp,
    messageRateLimitPerSec,
    maxPayloadBytes,
    logLevel,
  };
}

export const config = loadConfig();

export function isOriginAllowed(origin: string | undefined): boolean {
  if (config.nodeEnv !== 'production') {
    // In development or test, allow requests without origin or from localhost
    if (!origin) return true;
    const normalized = normalizeOrigin(origin);
    if (
      normalized.includes('localhost') ||
      normalized.includes('127.0.0.1') ||
      config.allowedOrigins.includes(normalized)
    ) {
      return true;
    }
  }

  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  return config.allowedOrigins.includes(normalized);
}
