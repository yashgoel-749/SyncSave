# SyncSpace Backup, Disaster Recovery & Data Integrity Guide

This document defines the operational procedures for backing up data, recovering from state corruption, point-in-time recovery (PITR) with Neon PostgreSQL, and restoring collaborative document revisions.

---

## 1. Data Persistence Architecture

SyncSpace employs dual-tier document persistence to guarantee conflict-free real-time synchronization and durability:

1. **In-Memory CRDT (`Y.Doc`)**:
   - Active rooms maintain an in-memory `WSSharedDoc` instance tracking operations.
   - Awareness states (cursors, presence, user metadata) remain in-memory and are ephemeral.

2. **Durable Database Persistence (`PostgreSQL`)**:
   - **`yjsState` (`BYTEA`)**: Serialized Yjs binary state vector containing the full CRDT history and tombstones for conflict-free reconciliation.
   - **`content` (`TEXT`)**: Serialized TipTap JSON snapshot generated synchronously on save. Serves as human-readable backup and fallback recovery representation.
   - **Debounced Flush**: Updates in memory are debounced (1.5 seconds) and written sequentially to PostgreSQL via mutex locking.

---

## 2. Neon Point-in-Time Recovery (PITR)

Neon PostgreSQL natively provides automatic WAL archiving and continuous point-in-time recovery for up to 30 days (depending on plan).

### Creating Pre-Deployment Restore Points
Before executing database migrations in production, create a named branch snapshot:

```bash
# Using Neon CLI
neon branches create --name pre-deploy-snapshot-$(date +%Y%m%d%H%M)
```

### Restoring to a Specific Timestamp
If an errant query, accidental deletion, or migration failure occurs:

1. Open the [Neon Console](https://console.neon.tech).
2. Go to **Branches** > **Create Branch**.
3. Choose **Point in time** and select the timestamp immediately prior to the incident (e.g. 5 minutes ago).
4. Point your application (`DATABASE_URL` / `DIRECT_URL`) to the newly created branch to restore operations immediately.

---

## 3. Automated PostgreSQL Backups (`pg_dump`)

In addition to Neon PITR, configure an automated daily scheduled dump to secure offsite object storage (AWS S3, Google Cloud Storage, or Cloudflare R2).

### Running a Manual Backup Dump
```bash
pg_dump "$DIRECT_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="syncspace-backup-$(date +%Y%m%d_%H%M%S).dump"
```

### Restoring from a Custom Dump
```bash
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --dbname="$DIRECT_URL" \
  "syncspace-backup.dump"
```

---

## 4. Disaster Recovery Scenarios & Runbooks

### Scenario A: Collaboration Server Crash or Power Loss
- **Impact**: In-flight memory state lost since last debounced flush (maximum 1.5 seconds of edits).
- **Recovery Behavior**:
  1. Process manager / Render automatically restarts container.
  2. First client to reconnect triggers `documentManager.getOrLoadDocument(docId)`.
  3. Server re-hydrates `WSSharedDoc` from PostgreSQL `yjsState`.
  4. Reconnecting clients upload their local offline updates (`y-indexeddb`), and CRDT convergence automatically merges any delta without conflict.

### Scenario B: Corrupt Binary State in Database
- **Impact**: Yjs binary parsing error (`applyUpdate` throws).
- **Recovery Behavior**:
  1. `DocumentManager` catches the exception cleanly.
  2. Fallback loader reads `docRecord.content` (TipTap JSON).
  3. Reconstructs XML paragraphs into a fresh `Y.Doc`.
  4. Schedules a durable save, healing the corrupt database record automatically.

### Scenario C: Accidental Document Deletion
- **Protection**: SyncSpace uses soft-deletes (`deletedAt` timestamp).
- **Recovery**:
  To restore a soft-deleted document:
  ```sql
  UPDATE documents
  SET "deletedAt" = NULL
  WHERE id = 'target_document_id';
  ```
  The document immediately reappears in the user's dashboard.

---

## 5. Health Monitoring & Alerting

Monitor the following endpoints with external monitors (e.g. BetterStack, Datadog, Uptime Kuma):

| Service | Target URL | Expected Response | Alert Condition |
|---|---|---|---|
| Collab Liveness | `https://collab.yourdomain.com/health` | `200 OK` (JSON) | Non-200 for 2 consecutive probes |
| Collab Readiness | `https://collab.yourdomain.com/ready` | `200 OK` (JSON) | Non-200 (database connectivity lost) |
| Web Frontend | `https://syncspace.yourdomain.com/api/health` | `200 OK` (JSON) | Non-200 for 2 consecutive probes |
| Web Readiness | `https://syncspace.yourdomain.com/api/ready` | `200 OK` (JSON) | Non-200 (database connectivity lost) |
