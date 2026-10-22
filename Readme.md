# SyncSpace

> **Offline-first collaborative document editor** — real-time, conflict-free, and fast.

Built with Next.js 16, React 19, TypeScript, Tailwind CSS v4, TipTap, Yjs, Node.js, WebSockets, PostgreSQL (Neon), and Prisma.

---

## Monorepo Layout

```
syncsave/
├── apps/
│   ├── web/              # Next.js 16 frontend (Vercel)
│   └── collab-server/    # Node.js WebSocket collaboration server (Render)
├── packages/
│   └── db/               # @syncspace/db — Prisma schema + generated client
├── package.json          # npm workspaces root
└── .gitignore
```

## Milestone Status

| # | Milestone | Status |
|---|-----------|--------|
| 1 | Project Scaffold & Design System | ✅ Done |
| 2 | Auth (NextAuth.js + Neon) | ✅ Done |
| 3 | Document CRUD + Dashboard | ✅ Done |
| 4 | Rich-Text Editor (TipTap) | ⏳ Next |
| 5 | Real-Time Collaboration (Yjs + WebSockets) | ⏳ Pending |
| 6 | Offline-First & PWA | ⏳ Pending |
| 7 | Sharing, Permissions & Notifications | ⏳ Pending |
| 8 | Production Hardening & CI/CD | ⏳ Pending |

## Getting Started

### Prerequisites
- Node.js ≥ 20
- npm ≥ 10
- A [Neon](https://neon.tech) PostgreSQL database (Milestone 2+)

### 1. Clone & install

```bash
git clone <repo>
cd syncsave
npm install   # installs all workspace packages
```

### 2. Environment variables

Copy and fill in the env files:

```bash
cp apps/web/.env.example              apps/web/.env.local
cp apps/collab-server/.env.example    apps/collab-server/.env
cp packages/db/.env.example           packages/db/.env
```

### 3. Run locally

```bash
# Next.js dev server (port 3000)
npm run dev

# Collaboration WebSocket server (port 1234)
npm run dev:collab
```

### 4. Run tests

```bash
# All workspaces
npm test --workspaces --if-present

# Individual
npm test --workspace=apps/web
npm test --workspace=apps/collab-server
```

### 5. Type-check

```bash
npm run typecheck --workspaces --if-present
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v4, Inter + JetBrains Mono |
| Editor | TipTap (Milestone 4) |
| CRDT | Yjs (Milestone 5) |
| Collaboration | y-websocket + Node.js ws |
| Database | PostgreSQL via Neon |
| ORM | Prisma 5 |
| Auth | NextAuth.js (Milestone 2) |
| Testing | Jest + ts-jest + Testing Library |
| Deploy | Vercel (web) + Render (collab-server) |