# SyncSpace

> **Production-grade, offline-first real-time collaborative document editor with conflict-free CRDT synchronization, role-based access control, and durable persistence.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16.4-black.svg)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.3-61dafb.svg)](https://react.dev/)
[![Yjs CRDT](https://img.shields.io/badge/Yjs-CRDT%20Engine-orange.svg)](https://yjs.dev/)
[![Prisma](https://img.shields.io/badge/Prisma-5.22-2D3748.svg)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon%20Serverless-4169E1.svg)](https://neon.tech/)
[![Tailwind CSS](https://img.shields.io/badge/TailwindCSS-v4-38bdf8.svg)](https://tailwindcss.com/)
[![Tests](https://img.shields.io/badge/Tests-156%20Passed-brightgreen.svg)]()

---

## 1. Problem Statement & Target Users

Traditional document editors either depend on centralized operational transformation (OT) architectures with complex server-side lock arbitration, or lack offline capabilities entirely. When network partitions or connection drops occur, edits are frequently lost or overwritten through "last-write-wins" HTTP PUT overwrites.

**SyncSpace** solves this with a **decoupled, hybrid cloud architecture**:
- **Zero-Conflict Collaborative Editing:** Powered by Yjs Conflict-Free Replicated Data Types (CRDTs), ensuring mathematical convergence across all connected peers regardless of network latency, update reordering, or concurrent typing.
- **Offline-First Resilience:** Client edits are committed instantly to client-side IndexedDB (`y-indexeddb`). Upon reconnection, incremental binary state vectors synchronize with the collaboration cluster with 0% data loss.
- **Decoupled Scalability:** A stateless Next.js 16 App Router frontend handles authentication, workspace administration, and REST APIs on Vercel, while a dedicated Node.js WebSocket engine (`@syncspace/collab-server`) on Render maintains stateful in-memory CRDT rooms and manages durable database persistence to Neon PostgreSQL.

### Target Users
- **Distributed Engineering Teams:** Technical documentation, sprint RFCs, and collaborative planning requiring sub-20ms keystroke synchronization.
- **Remote Professionals & Travelers:** Seamless document editing across unstable connections, flight Wi-Fi, or offline environments with automatic, conflict-free background reconciliation upon reconnecting.
- **Organizations with Strict Role Separation:** Workspaces requiring hard role guarantees (`OWNER`, `EDITOR`, `VIEWER`), real-time permission revocation, and audit logs.

---

## 2. Production Architecture

SyncSpace employs a decoupled, production-hardened hybrid cloud topology:

```
                      ┌─────────────────────────────────────────┐
                      │              Web Browser                │
                      │  - TipTap Editor + Yjs Local Doc        │
                      │  - Local IndexedDB (Offline Persistence)│
                      │  - Web Crypto / Auth.js Client          │
                      └────────────────────┬────────────────────┘
                                           │
                 ┌─────────────────────────┴─────────────────────────┐
                 │ HTTPS (Next.js App / REST APIs)                   │ WSS (Binary Yjs Updates)
                 ▼                                                   ▼
┌─────────────────────────────────┐                 ┌─────────────────────────────────┐
│        Vercel (Web Service)     │                 │       Render (Collab Server)    │
│  - Next.js 16 (Turbopack)       │                 │  - Long-running Node.js process │
│  - React 19 SSR & Server Actions│                 │  - WebSocket Server (`ws`)      │
│  - NextAuth.js (JWT & Database) │                 │  - In-memory `WSSharedDoc` rooms│
│  - Document & Workspace CRUD    │                 │  - Live Role Enforcement        │
│  - Rate-limited REST Endpoints  │                 │  - Debounced DB Flush Engine    │
└────────────────┬────────────────┘                 └────────────────┬────────────────┘
                 │                                                   │
                 │ Pooled (PgBouncer)                                │ Pooled (PgBouncer)
                 ▼                                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                             Neon Serverless PostgreSQL                              │
│  - Document Store (`yjsState BYTEA` + ProseMirror JSON Backup)                      │
│  - Workspaces, Memberships, Document Collaborators & Invitations                   │
│  - NextAuth Users, Accounts, Sessions & Verification Tokens                         │
│  - Point-in-Time Recovery (PITR) & Storage Redundancy                               │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Features

- **Real-Time Multi-User Collaboration:** Live cursor tracking, multi-user selections with distinct deterministic participant colors, and sub-20ms broadcast latency.
- **Rich-Text Editor:** TipTap / ProseMirror engine supporting headings, code blocks, blockquotes, bullet and numbered lists, bold, italics, underline, strikethrough, inline code, horizontal rules and sanitized links, with live word/character counts.
- **Collaborative Whiteboard:** Every document ships with an infinite, zoomable canvas (pen with stroke smoothing, rectangles, ellipses, lines, arrows, text, eraser). Shapes live in a `Y.Map` inside the same Y.Doc as the text, so they share the document's sync, persistence, offline cache and viewer write-protection. Remote cursors and in-progress strokes are broadcast through Yjs awareness; per-user undo/redo uses a scoped `Y.UndoManager`; boards export to PNG.
- **Offline-First & PWA Support:** Instant local editing via IndexedDB. Documents load instantly from cache even during network disconnects.
- **Role-Based Access Control (RBAC):**
  - `OWNER`: Full administrative control, document deletion, workspace management, and collaborator invitation.
  - `EDITOR`: Full collaborative read/write permissions.
  - `VIEWER`: Read-only access enforced at both the UI and WebSocket network protocol layer (client modification frames are rejected at the server socket).
- **Frictionless Invitations (guest access):** Inviting an email that has no account produces a link that opens the document instantly — the invitee joins as a passwordless guest account via a dedicated `invite-token` credentials provider, and the invitation is accepted in the same step. The link keeps working as that guest's magic link until their access is revoked. Existing full accounts (password or OAuth) can never be entered through a link; they sign in normally. A guest can later set a password on the sign-up page to claim the account.
- **Live Permission Revocation & Role Updates:** Internal secure webhook endpoints allow immediate live eviction (`4403`) or real-time downgrade to `VIEWER` without requiring users to refresh.
- **Durable Persistence Engine:** In-memory CRDT updates are debounced (1500ms delay) and sequentially serialized into PostgreSQL binary storage (`BYTEA`), preventing database write stampedes while ensuring 0% data loss on server restarts.
- **Security Hardening:** Origin filtering, per-IP connection limits (50/IP), WebSocket message rate limiting (100 msg/sec per socket), timing-safe HMAC token verification, and soft-delete trash recovery.

---

## 4. Deep Architectural Specifications

### A. CRDT Synchronization Model (Yjs)
1. **State Vectors & Incremental Updates:**
   - Yjs represents documents as a sequence of uniquely identified items using `(clientID, clock)`.
   - When a client connects, the client and server exchange **State Vectors** (`SyncStep1`).
   - The recipient computes the difference between its local state and the sender's state vector, encoding only the missing operations into a compact binary diff (`SyncStep2`).
   - All operations commute: $A \cdot B = B \cdot A$. No central lock or operational transformation server is required to resolve conflicting edits at identical character positions.
2. **ProseMirror / TipTap Binding:**
   - TipTap's ProseMirror state is bi-directionally mapped to Yjs XML fragments (`ydoc.getXmlFragment('default')`).
   - Edits in ProseMirror are mapped to CRDT transactions; remote CRDT updates are applied to ProseMirror transactions without triggering recursive change events.

### B. WebSocket Lifecycle & Connection Flow
1. **Pre-Upgrade Handshake:**
   - Client sends HTTP GET with `Upgrade: websocket`.
   - Server checks `maxConnections` capacity (1,000 default) and verifies `Origin` against `ALLOWED_ORIGINS`. Disallowed origins receive `403 Forbidden`.
2. **Authentication & Room Access:**
   - Client passes `?token=<JWT>` in the connection URL.
   - The token is verified using HMAC-SHA256 (`AUTH_SECRET`). The server validates expiration (`exp`), user ID, assigned role (`OWNER`, `EDITOR`, `VIEWER`), and room ID matching the URL path.
3. **Early Message Buffering (Cold-Start Protection):**
   - If a document is not yet in memory, the server initiates an asynchronous database load.
   - Any client WebSocket packets received *during* this async load are held in an in-memory buffer and replayed immediately once `y-websocket` initializes, completely eliminating cold-start handshake drops.
4. **Per-Connection Message Rate Limiting:**
   - Incoming frames are intercepted. A sliding 1-second window enforces a ceiling of 100 messages/sec.
   - Abusive sockets exceeding 200 messages/sec are automatically terminated with WebSocket code `4429`.

### C. Storage & Persistence Strategy
- **In-Memory Buffer:** Active rooms are maintained in Node.js process memory (`utils.docs`), enabling microsecond read/write operations during live editing.
- **Idle Room Eviction:** When the last client leaves a room the document is flushed and, after a grace period (`DOC_EVICTION_GRACE_MS`, default 30s), released from memory. Reconnects inside the window reuse the hot copy; later connects rehydrate from PostgreSQL. This keeps resident memory proportional to *active* rooms rather than every document ever opened.
- **Schema-Aware Hydration:** If the binary state is missing or corrupt, the server rebuilds the Y.Doc from the ProseMirror JSON snapshot using the same TipTap schema as the client (headings, lists, marks and links survive), falling back to plain paragraphs only if the snapshot contains unknown nodes.
- **Debounced Flush:** When edits occur, a 1500ms debounce timer is scheduled (`documentManager.scheduleSave`).
- **Sequential Flushes (`activeFlushes` Queue):** If a durable save is already writing to PostgreSQL for a given document, subsequent flushes queue behind the active promise, guaranteeing strict sequential ordering and preventing write-after-write database races.
- **Dual-State Persistence:**
  - `yjsState` (`BYTEA`): Full binary CRDT update state preserving all client clocks and edit histories for flawless hydration.
  - `content` (`TEXT`): Serialized ProseMirror JSON backup, enabling preview generation and schema fallback. The dashboard list endpoint never ships `yjsState` or raw `content`; it returns a server-computed plain-text `preview`.

### D. Offline-First Recovery & Deterministic Merging
- When offline, edits are saved to the browser's IndexedDB via `y-indexeddb`.
- When connectivity resumes:
  1. `WebsocketProvider` automatically reconnects with exponential backoff.
  2. The client transmits its local State Vector.
  3. The server sends missing updates that occurred while the client was disconnected.
  4. The client transmits its offline update buffer to the server.
  5. Both states merge deterministically without user intervention or manual conflict resolution dialogues.

---

## 5. Load Testing & Benchmark Results

SyncSpace includes a repeatable, CLI load testing suite in `scripts/load-test/`. All figures below represent **genuine physical measurements** collected under Node.js 20 on an Intel Core i5-12450HX (12 cores) with 24 GB RAM against a Neon PostgreSQL database.

### Measured Benchmark Matrix (`npm run test:load -- --scenario=matrix`)

| Benchmark Scenario | Clients | Rooms | Edit Interval | Total Samples | p50 Latency | p90 Latency | p95 Latency | p99 Latency | Peak Memory | Data Integrity |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **1. Baseline Moderate** | 10 | 1 | 100 ms | 12,330 | **10.07 ms** | 20.08 ms | 26.37 ms | 55.68 ms | 18.4 MB Heap | **100% (0 loss)** |
| **2. High Concurrency Stress** | 40 | 1 | 100 ms | 188,682 | **16.32 ms** | 25.43 ms | 31.95 ms | 55.40 ms | 27.2 MB Heap | **100% (0 loss)** |
| **3. Multi-Room Scalability** | 30 | 5 | 100 ms | 20,608 | **10.63 ms** | 17.06 ms | 20.35 ms | 38.64 ms | 32.1 MB Heap | **100% (0 loss)** |
| **4. Large State Stress (50KB)** | 15 | 1 | 100 ms | 28,910 | **8.23 ms** | 15.87 ms | 18.04 ms | 21.46 ms | 32.7 MB Heap | **100% (0 loss)** |
| **5. Slow-Client Backpressure** | 15 | 1 | 100 ms | 28,770 | **9.33 ms** | 19.06 ms | **157.12 ms\*** | 171.72 ms | 34.3 MB Heap | **100% (0 loss)** |
| **6. Network Interruption & Resync**| 20 | 1 | 100 ms | 91,143 | **11.77 ms** | 25.72 ms | 32.40 ms | 48.92 ms | 41.1 MB Heap | **100% (0 loss)** |
| **7. Fast Persistence Stress** | 15 | 1 | 50 ms | 51,450 | **10.06 ms** | 19.28 ms | 22.19 ms | 29.11 ms | 46.1 MB Heap | **100% (0 loss)** |

*\*In Scenario 5, p95 tail latency was intentionally driven by adding a 150ms artificial processing lag to one client to demonstrate client backpressure.*

### Key Performance Takeaways
- **Sustained Throughput:** 324.1 operations/second sustained during 40-client single-room concurrency.
- **Resource Efficiency:** Collab server memory remained under 47 MB heap even under 50,000+ rapid updates.
- **Persistence Verification:** 100% of persisted binary states were verified by hydrating independent `Y.Doc` instances directly from the database and validating character-level equality.

---

## 6. Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Web Frontend** | Next.js 16.4.2 (Turbopack), React 19.3 | Server components, client interactivity, routing, SSR |
| **Styling** | Tailwind CSS v4 | Token-based dark design system (`globals.css`), motion primitives, responsive layout |
| **Editor** | TipTap 3, ProseMirror | Extensible rich-text editing engine |
| **CRDT Engine** | Yjs 13.6, `y-websocket`, `y-indexeddb` | Conflict-free real-time sync and local client cache |
| **Collab Server** | Node.js 20, `ws` 8.18 | Stateful WebSocket server, presence, rate limiting |
| **Database** | Neon Serverless PostgreSQL | High-availability PostgreSQL with connection pooling |
| **ORM** | Prisma 5.22 | Type-safe schema migrations and database queries |
| **Authentication** | NextAuth.js (Auth.js v5 beta), bcryptjs | Credentials auth, session tokens, HMAC collab signing |
| **Testing** | Jest 29, Testing Library, ts-jest | Unit, integration, regression, and load testing |
| **Deployment** | Vercel (Web), Render (Collab), Neon (DB) | Scalable hybrid cloud hosting |

---

## 7. Monorepo Structure

```
syncsave/
├── apps/
│   ├── web/                         # Next.js 16 Web Application (Vercel)
│   │   ├── src/
│   │   │   ├── app/                 # App Router (Pages, Layouts, API endpoints)
│   │   │   ├── components/          # React components
│   │   │   │   ├── editor/          # TipTap editor, toolbar, collaboration cursors
│   │   │   │   ├── whiteboard/      # Yjs-backed whiteboard canvas and shape renderer
│   │   │   │   └── ui/              # Modal & ConfirmDialog primitives
│   │   │   └── lib/                 # Auth options, services, Prisma client, schemas,
│   │   │                            #   editor-utils (text extraction), whiteboard-utils (geometry)
│   │   └── package.json
│   └── collab-server/               # WebSocket Collaboration Server (Render)
│       ├── src/
│       │   ├── auth.ts              # Collab token verification & participant colors
│       │   ├── config.ts            # Environment config & origin validator
│       │   ├── documentManager.ts   # Coordinated doc loading & PostgreSQL persistence
│       │   ├── index.ts             # HTTP server, WebSocket upgrade, health endpoints
│       │   ├── logger.ts            # Structured JSON logger
│       │   └── yjsHandler.ts        # Rate limiter, RBAC enforcement, Yjs setup
│       └── package.json
├── packages/
│   └── db/                          # Shared Database Package
│       ├── prisma/
│       │   └── schema.prisma        # Database schema (Documents, Users, Workspaces)
│       └── package.json
├── scripts/
│   ├── load-test/                   # Repeatable Load Testing & Benchmark Harness
│   │   ├── cli.ts                   # CLI entrypoint for custom and matrix benchmarks
│   │   ├── client.ts                # Simulated Yjs WebSocket client
│   │   ├── runner.ts                # Orchestrator, percentile calculator & DB validator
│   │   ├── server-monitor.ts        # Server memory, CPU, and connection sampler
│   │   ├── server-restart-test.ts   # Restart drain & durable recovery test
│   │   └── types.ts                 # TypeScript types and interfaces
│   └── copy-prisma-engines.js       # Vercel deployment query engine packager
├── BACKUP_AND_RECOVERY.md           # Disaster recovery runbooks & backup procedures
├── DEPLOYMENT.md                    # Production deployment guide
├── SCALABILITY_AUDIT_REPORT.md      # Full scalability audit & benchmark report
└── package.json                     # Monorepo root workspace configuration
```

---

## 8. Setup & Local Development

### Prerequisites
- Node.js ≥ 20.0.0
- npm ≥ 10.0.0
- A PostgreSQL database (Local or [Neon Serverless](https://neon.tech))

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/yashgoel-749/SyncSave.git
cd SyncSave
npm install
```

### 2. Environment Configuration
Create a `.env` file in the project root (see [`.env.example`](file:///.env.example) for reference):
```env
DATABASE_URL="postgresql://user:password@host/neondb?sslmode=require&pgbouncer=true"
DIRECT_URL="postgresql://user:password@host/neondb?sslmode=require"
AUTH_SECRET="your-32-byte-random-secret-key-minimum-16-chars"
NEXTAUTH_URL="http://localhost:3000"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
NEXT_PUBLIC_COLLAB_WS_URL="ws://localhost:1234"
```

Also copy environment files to the sub-workspaces:
```bash
cp .env apps/collab-server/.env
cp .env packages/db/.env
```

### 3. Initialize Database
```bash
# Generate Prisma Client
npm run db:generate

# Push schema to database
npm run db:push
```

### 4. Start Development Servers
In separate terminals:
```bash
# Terminal 1: Next.js Frontend (port 3000)
npm run dev

# Terminal 2: Collaboration WebSocket Server (port 1234)
npm run dev:collab
```
Visit `http://localhost:3000` to register an account and start collaborating.

---

## 9. Testing & Quality Verification

SyncSpace includes a 100% automated test suite spanning unit, integration, role restriction, and performance benchmarks:

```bash
# Run all monorepo test suites (20 suites, 198 tests)
npm test

# Run TypeScript typechecks across all workspaces
npm run typecheck

# Run ESLint across all workspaces
npm run lint

# Run production build validation
npm run build:all

# Run repeatable load testing benchmark (baseline scenario)
npm run test:load -- --clients=20 --rooms=1 --duration=10

# Run full 7-scenario load test matrix
npm run test:load -- --scenario=matrix
```

---

## 10. Production Deployment Guide

SyncSpace is deployed in production across **Vercel** and **Render**:

### Web Frontend on Vercel
- **Root Directory:** `./`
- **Build Command:** `npm run build`
- **Output Directory:** `.next`
- **Environment Variables:** `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_COLLAB_WS_URL`.

### Collab Server on Render
- **Service Type:** Web Service (Persistent Docker or Node runtime)
- **Root Directory:** `apps/collab-server`
- **Build Command:** `npm install && npm run build`
- **Start Command:** `node dist/index.js`
- **Health Check Path:** `/health`
- **Environment Variables:** `DATABASE_URL`, `AUTH_SECRET`, `PORT=1234`, `NODE_ENV=production`, `ALLOWED_ORIGINS=https://syncsave.vercel.app`.

For comprehensive disaster recovery, rollback runbooks, and zero-downtime maintenance procedures, consult [DEPLOYMENT.md](file:///DEPLOYMENT.md) and [BACKUP_AND_RECOVERY.md](file:///BACKUP_AND_RECOVERY.md).

---

## 11. Architectural Trade-offs & Known Limitations

1. **Consistent Room Hashing vs. Redis Pub/Sub:**
   - **Trade-off:** We evaluated Redis pub/sub across multiple collaboration instances and determined it is not justified for room-based documents. Consistent Hashing at the reverse proxy (routing all clients of `documentId` to the same server node) achieves infinite room scale-out while preserving sub-20ms broadcast speed and zero Redis cost.
2. **Main-Thread TipTap JSON Serialization:**
   - Converting large documents (500KB+) from Yjs CRDT to ProseMirror JSON during database flushes runs on the Node event loop. Debounced saves (1500ms) and the `activeFlushes` sequential queue protect against write stampedes, but documents over 2MB should offload JSON serialization to a Node worker thread.
3. **Per-IP Connection Throttling:**
   - The default `MAX_CONNECTIONS_PER_IP=50` protects against denial-of-service floods. In enterprise NAT environments or schools where hundreds of users share a single public IP, this environment variable should be raised to `200+`.
4. **Whiteboard Granularity:**
   - Shapes are stored as whole JSON values in a `Y.Map`, so two people moving the *same* shape at the same instant resolve last-writer-wins at the shape level (text and strokes never conflict because each shape has a unique id). Finer-grained per-attribute merging would require nested `Y.Map`s per shape at the cost of larger updates.

---

## 12. License

MIT License. Open-source for personal, educational, and commercial engineering use.