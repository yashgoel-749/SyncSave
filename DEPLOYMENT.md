# SyncSpace Production Deployment & Operations Guide

This guide details the production architecture, environment configuration, database migration strategy, deployment procedures, and rollback runbooks for SyncSpace.

---

## 1. Production Architecture Overview

SyncSpace employs a decoupled, production-hardened hybrid cloud architecture:

```
                     ┌────────────────────────────────┐
                     │          Clients               │
                     │  (Browsers / PWA Offline-First)│
                     └───────────────┬────────────────┘
                                     │
           ┌─────────────────────────┴─────────────────────────┐
           │ HTTPS (App / REST API)                            │ WSS (Yjs CRDT WebSockets)
           ▼                                                   ▼
┌─────────────────────────────────┐                 ┌─────────────────────────────────┐
│        Vercel (Web Frontend)    │                 │      Render (Web Service)       │
│  - Next.js 16 App Router        │                 │  - Long-running Node.js process │
│  - React 19 SSR & Static Cache  │                 │  - Yjs WebSocket Collab Server  │
│  - Auth.js Session Management   │                 │  - In-memory CRDT rooms         │
│  - Rate-limited REST APIs       │                 │  - Debounced DB persistence     │
└────────────────┬────────────────┘                 └────────────────┬────────────────┘
                 │                                                   │
                 │ Pooled (PgBouncer)                                │ Pooled (PgBouncer)
                 ▼                                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                             Neon Serverless PostgreSQL                              │
│  - Primary Document Storage & tipTap JSON backup                                    │
│  - Yjs Binary Update Snapshots (`BYTEA`)                                           │
│  - User Auth, Sessions, Workspaces & Collaboration Permissions                       │
│  - Point-in-Time Recovery (PITR) & Instant Branching                                │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

> [!IMPORTANT]
> **Why WebSockets cannot run on Vercel Serverless Functions:**
> Serverless function runtimes have short execution timeouts (15–60 seconds) and ephemeral state. Real-time collaborative editing with Yjs requires persistent TCP connections, stateful in-memory document rooms, and continuous awareness/presence broadcast. Render (or any persistent container runner like Fly.io or AWS ECS) provides the persistent environment needed for `apps/collab-server`.

---

## 2. Environment Variables & Secret Management

SyncSpace enforces strict environment variable validation. In production, missing secrets or insecure default fallbacks will trigger fail-fast termination at boot.

### A. Web Frontend (`apps/web` on Vercel)

| Variable | Description | Example / Format |
|---|---|---|
| `DATABASE_URL` | Neon pooled connection string (with PgBouncer) | `postgresql://user:pass@ep-xyz-pooler.neon.tech/neondb?sslmode=require&pgbouncer=true` |
| `DIRECT_URL` | Neon direct connection string (no PgBouncer) | `postgresql://user:pass@ep-xyz.neon.tech/neondb?sslmode=require` |
| `AUTH_SECRET` | 32-byte cryptographically secure random key | Generated via `openssl rand -base64 32` |
| `NEXTAUTH_SECRET` | Alias for `AUTH_SECRET` (Auth.js compatibility) | Same as `AUTH_SECRET` |
| `NEXTAUTH_URL` | Canonical public URL of the web frontend | `https://syncspace.yourdomain.com` |
| `NEXT_PUBLIC_APP_URL` | Client-accessible base URL | `https://syncspace.yourdomain.com` |
| `NEXT_PUBLIC_COLLAB_WS_URL` | Secure WebSocket endpoint of Render service | `wss://collab.yourdomain.com` |
| `GITHUB_CLIENT_ID` | Optional: GitHub OAuth App Client ID | From GitHub Developer Settings |
| `GITHUB_CLIENT_SECRET` | Optional: GitHub OAuth App Client Secret | From GitHub Developer Settings |

### B. Collaboration Server (`apps/collab-server` on Render)

| Variable | Description | Example / Format |
|---|---|---|
| `NODE_ENV` | Environment mode (`production`) | `production` |
| `PORT` | Listening TCP port (Render injects 10000 or custom) | `1234` |
| `HOST` | Bind address | `0.0.0.0` |
| `AUTH_SECRET` | Shared secret for signing/verifying collab tokens | Must match `AUTH_SECRET` on web |
| `DATABASE_URL` | Neon pooled connection string | `postgresql://user:pass@ep-xyz-pooler.neon.tech/neondb?sslmode=require&pgbouncer=true` |
| `DIRECT_URL` | Neon direct connection string | `postgresql://user:pass@ep-xyz.neon.tech/neondb?sslmode=require` |
| `ALLOWED_ORIGINS` | Comma-separated allowed frontend origins | `https://syncspace.yourdomain.com` |
| `MAX_CONNECTIONS` | Server-wide concurrent connection cap | `1000` |
| `MAX_CONNECTIONS_PER_IP` | Per-client IP connection cap | `50` |
| `MESSAGE_RATE_LIMIT_PER_SEC` | Max WebSocket frames per client per second | `100` |
| `LOG_LEVEL` | Logging verbosity (`info`, `warn`, `error`) | `info` |

---

## 3. Database Preparation & Safe Migrations

### Connection Strings (Pooled vs Direct)
- **Application Runtime (`DATABASE_URL`)**: Uses Neon's connection pooler endpoint (`-pooler.neon.tech`) with `?sslmode=require&pgbouncer=true`. Prevents socket exhaustion during connection bursts.
- **Prisma Migrations (`DIRECT_URL`)**: Uses Neon's direct endpoint without PgBouncer. PostgreSQL transaction-level locks and DDL migrations require a direct unpooled connection.

### Safe Migration Deployment

1. **Test Migration Locally**:
   ```bash
   npm run db:generate
   ```

2. **Execute Deployment Migration**:
   ```bash
   npm run db:migrate
   ```
   This executes `prisma migrate deploy`, safely executing pending migration SQL files recorded in `packages/db/prisma/migrations` within a transaction without data loss.

---

## 4. Render Deployment (Collaboration Server)

### Option A: Using Render Blueprint (`render.yaml`)
1. In the Render Dashboard, select **New** > **Blueprint**.
2. Connect your repository. Render automatically reads `render.yaml`.
3. Fill in the sensitive variables marked `sync: false` (`AUTH_SECRET`, `DATABASE_URL`, `DIRECT_URL`, `ALLOWED_ORIGINS`).
4. Approve and deploy.

### Option B: Manual Web Service Setup
1. **Service Type**: Web Service (Node.js runtime).
2. **Build Command**:
   ```bash
   npm install --include=dev && npm run db:generate && npm run build:collab
   ```
3. **Start Command**:
   ```bash
   npm run start --workspace=apps/collab-server
   ```
4. **Health Check Path**: `/health`
5. **Environment Variables**: Configure all variables listed in Section 2B.

---

## 5. Vercel Deployment (Next.js Frontend)

1. Import repository in the [Vercel Dashboard](https://vercel.com).
2. Set **Framework Preset**: Next.js.
3. Configure **Build and Output Settings**:
   - **Build Command**: `npm run db:generate && npm run build --workspace=apps/web`
   - **Install Command**: `npm install`
   - **Output Directory**: `apps/web/.next`
4. Add all environment variables listed in Section 2A.
5. Deploy.

---

## 6. Deployment Sequence & Zero-Downtime Rollout

To ensure zero downtime and prevent schema/protocol mismatches, follow this exact sequence:

```
Step 1: Database Migration
  └── Run `npm run db:migrate` against Neon using DIRECT_URL.
      Backward-compatible schema additions ensure existing servers continue operating.

Step 2: Deploy Collaboration Server (Render)
  └── Trigger deploy on Render.
  └── Readiness probe (/ready) checks DB connection before receiving live traffic.
  └── Graceful shutdown drains existing sockets with close code 1001, saving state.

Step 3: Deploy Web Frontend (Vercel)
  └── Trigger production build on Vercel.
  └── Pre-renders static pages, verifies type check, and connects to Collab Server.

Step 4: Post-Deployment Smoke Verification
  └── Run health check: curl -f https://collab.yourdomain.com/health
  └── Run readiness check: curl -f https://collab.yourdomain.com/ready
  └── Run web health check: curl -f https://syncspace.yourdomain.com/api/health
```

---

## 7. Rollback Procedures

If an incident or regression occurs post-deployment:

### A. Frontend Rollback (Instant)
1. Navigate to Vercel Dashboard > Project > **Deployments**.
2. Locate the previous stable deployment and click **Promote to Production** (instant CDN pointer switch, 0 downtime).

### B. Collaboration Server Rollback
1. In Render Dashboard > Web Service > **Deploys**.
2. Select previous stable deployment > **Rollback to this deploy**.

### C. Database Schema Rollback
1. Neon supports instant Point-In-Time recovery and branching.
2. If a migration needs reversal:
   - Identify the migration in `packages/db/prisma/migrations`.
   - Write a compensating forward migration or branch restore via Neon CLI:
     ```bash
     neon branches restore <branch-id> --timestamp <pre-deploy-timestamp>
     ```
