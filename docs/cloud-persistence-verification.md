# Cloud persistence verification

## Plan

- [x] Ground the existing Yjs, IndexedDB, PostgreSQL, and permission boundaries.
- [x] Compare socket checkpoints with authorized database readback.
- [x] Select the smaller read-only proof boundary.
- [x] Implement document-state verification and persistence recovery.
- [x] Verify stale replies, deletions, failures, permissions, and live database saves.

## Design

The old browser status equated Yjs synchronization with a saved timestamp, while the cloud row always reported unverified. Synchronization confirms an in-memory server room, not a PostgreSQL commit.

`GET /api/documents/:id/persistence` returns the authorized database row's binary Yjs snapshot with `Cache-Control: private, no-store`. It returns 204 when no binary snapshot exists. The route reuses VIEW authorization and never writes or applies client updates.

`observeCloudPersistence({ doc, provider, documentId, onStatus })` owns verification requests, debounce, retry, request cancellation, and disposal. Every Y.Doc update invalidates the last verification synchronously. Replies are accepted only for the current document generation and connection. Disconnect pauses requests, and reconnect starts a fresh check. Title save state remains separate.

`persistedStateCovers(persisted, captured)` applies persisted bytes to a disposable default-GC Y.Doc, records its full encoding, then applies the captured browser snapshot. Equal before-and-after encodings prove that the persisted snapshot already includes the captured changes. This includes deletes and accepts collaborator supersets without mutating the live document. A state vector alone cannot prove deletion persistence.

The UI displays Saving, Saved to cloud, Offline, or Verification failed. Saved means the current Y.Doc state was confirmed in a database read, not that a socket connected or that a title PATCH succeeded.

## Synthesis decision

Two independent design readers compared custom authenticated socket checkpoints and HTTP readback. Readback is the base because it checks actual database bytes and adds no write protocol, receipt registry, or permission exception. The socket candidate contributed generation-bound replies and tests for updates during a write. Its inline full-update checkpoint would recover dropped sync frames, but adds a second submission path and is unnecessary for read-only verification.

Both candidates identified persistence queue ordering and automatic failure retry as prerequisites. Keep these fixes in DocumentManager. Persist a binary baseline after JSON fallback, and preserve the empty-document JSON snapshot. Cross-model judging was not used; both design readers inherited the session model under the harness model restrictions.

Title saves use `expectedTitle` in the database update predicate. Content saves can advance `updatedAt` without causing a rename conflict. A competing rename returns 409, and title PATCH success never verifies Yjs content.

## Contracts

- Verification requests cannot modify documents, including for viewers.
- Cached responses, old connection replies, and replies captured before a newer edit cannot mark current content saved.
- A missing or corrupt binary snapshot is not proof of a save.
- Database writes remain serialized per document. Failed writes retry without another edit.
- Verification does not claim end-to-end encryption or verify title persistence.

## Verification evidence

`scripts/verify-cloud-persistence.cjs` creates an isolated test user and document, drives the production editor in Chrome, and compares HTTP readback with actual Neon bytes. The script removes only the records it creates. It requires the local web and collaboration servers, Chrome, and the configured database and authentication secret.

The live checks passed for the initial binary snapshot, typed content, deletion, a title save while content was offline, reconnect, and reload. No browser exceptions occurred. The screenshot and results are in `C:\Users\goely\AppData\Local\Temp\opencode\syncsave-cloud-TfS2eJ`.

Regression tests cover stale responses, deletion-only changes, collaborator supersets, whiteboard changes, synchronization, missing or corrupt snapshots, access denial, disposal, database retries, write ordering, JSON hydration, empty JSON snapshots, and idle eviction. The title tests cover an atomic rename check and a competing rename conflict.

The production build, workspace type checks, and web lint pass. All 37 web suites and 354 tests pass in a foreground run with a successful exit. All 29 collaboration-server tests pass with `--forceExit`. The complete server suite retains open asynchronous resources after its assertions, so a normal run times out. The focused persistence-recovery suite exits normally.

The existing launch browser verifier also passes, including themes, outline, mobile layout, exports, and a 13-page PDF. Its artifacts are in `C:\Users\goely\AppData\Local\Temp\opencode\syncsave-launch-oVwDoA`.

The checks are reproducible with these commands:

```powershell
node scripts/verify-cloud-persistence.cjs
npm run test --workspace=apps/web -- --runInBand
npm run test --workspace=apps/collab-server -- --runInBand --forceExit
npm run typecheck
npm run lint --workspace=apps/web
npm run build --workspace=apps/web
```
