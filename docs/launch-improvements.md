# Launch improvements

## Work plan

- [x] Ground: inspect editor persistence, authorization, dashboard creation, and public pages.
- [x] Sketch: compare independent designs for shared editor features.
- [x] Agree: lightweight collaborative text snapshots, within existing access controls.
- [x] Implement: contact/legal/help, templates/import/export/onboarding, editor navigation, history/comments.
- [x] Verify: behavior tests, browser checks, type checks, lint, and production build.
- [x] Scrap: retain lightweight shared text records, defer full-room authoritative recovery.

## Existing architecture

The document editor binds TipTap to the `default` fragment of a Yjs document. The same document holds the whiteboard. Updates synchronize through the authenticated collaboration server, cache in IndexedDB, and persist as the full `Document.yjsState` in PostgreSQL. Viewers cannot submit Yjs changes. A REST content overwrite cannot replace a live collaborative document.

The dashboard creates documents through the existing validated API with optional serialized TipTap content. Templates and imported files should use that creation path, not a new persistence mechanism.

## Design comparison

Compared document-local Yjs records with server-owned database revisions and generation-fenced full-room restores. Select document-local records for this beta pass: manual text snapshots and document-level discussion reuse existing persistence and edit permissions without a coordinated migration. Restore is a normal collaborative text edit, preceded by a safety snapshot; it does not replace the room or whiteboard. No automatic snapshots of potentially private past content.

The stronger server-owned design is deferred, not approximated: it requires migrations, room ownership gates, generation-aware tokens/cache and stale-writer fencing. This pass does not provide immutable author attribution, full-room backups, notifications, or viewer commenting.

All authorized document viewers can access the shared records, including future public-link recipients. The UI must warn before capture/posting; records are not private. Retained live payload is limited, but Yjs tombstones mean serialized lifetime bytes are not strictly bounded. Restores can merge with concurrent/offline edits and must never promise exact global rollback.

## Launch constraints

- Contact: `goelyash749@gmail.com`.
- Do not modify existing uncommitted lockfile or generated database changes.
- Do not commit, push, or migrate a live database without a separate request.
- Public copy must not promise database durability from WebSocket synchronization alone.
- Legal pages describe current behavior and identify release-review requirements. They do not assert compliance, retention periods, guarantees, or subprocessors not established by the project.
- No unsupported DOCX/PDF import claims. Identify the actual supported file formats in the UI.

## Rerun verification

Run `npm run test --workspace=apps/web -- --runInBand`, `npm run typecheck`, `npm run lint --workspace=apps/web`, and `npm run build --workspace=apps/web`. The workspace build avoids database client generation and preserves existing generated-file edits.

After the web build, start the web app on port 3000 and run `node scripts/verify-launch.cjs`. The browser check uses installed Chrome, production CSS, real TipTap and Yjs, and isolated editor/dashboard API responses. It checks long-document scrolling at five sizes, mobile controls, navigation, export scope, history access, template/import creation payloads, and live public pages with the real local demo. Set `CHROME_PATH` or `PUBLIC_BASE_URL` for a different browser executable or app URL. Screenshots are saved in the path printed by the script.

These checks do not prove deployed database persistence, operational backups, or multi-server recovery. Existing collaboration test teardown needs separate attention before claiming an all-workspace test run exits cleanly.

## Verified result

The web suite passes 280 tests across 26 suites. Workspace type checks, web lint, and the production web build pass. The browser script passes with actual snapshot capture, preview, restore, safety capture, comment posting and resolution, template creation, literal TXT import, and demo reset. Long-document checks cover 1440, 768, 640, 375, and 320 pixel widths. All six public routes return HTTP 200 and show the contact address. The mobile homepage headline and calls to action are checked for clipping after animations finish.

Restores isolate undo capture before and after the text edit. Tests cover a second real collaborative editor, offline concurrent restores, whiteboard/comment preservation, malformed shared records, viewer and revoked-write denial, limits, and selected mention references. Import validation also runs at the document-creation API boundary.

Build warnings remain for the existing middleware convention and Prisma-generated dynamic filesystem tracing. No database migrations, generated-client regeneration, commits, or pushes were performed for this pass. The pre-existing lockfile and generated-file changes remain untouched.
