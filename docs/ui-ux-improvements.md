# UI and export improvements

## Plan

- [x] Ground: map presentation boundaries and existing state ownership.
- [x] Sketch: compare two designs without changing collaboration or APIs.
- [x] Agree: select the smallest design that covers the requested experience.
- [x] Implement: theme, dashboard, editor layout, and document exports.
- [x] Verify: real document conversion, regression suite, and browser layouts.
- [x] Scrap: no changes to authentication or shared-state ownership were needed.

## Constraints

Existing uncommitted launch features are the baseline. Preserve authentication, document CRUD, Yjs records, whiteboard state, IndexedDB, and permission enforcement. Theme and panel visibility are local presentation state, never Yjs data. No sample documents or invented activity counts.

## Grounding

`dashboard/page.tsx` authenticates and supplies accessible workspaces. `DashboardView` owns selection, filters, debounced search, pagination, and existing mutation handlers. Sidebar controls call that same state owner. `DocumentEditor` owns the editor and Y.Doc lifecycle and keeps text and whiteboard mounted across view changes. Its sticky header preserves title, controls, and formatting while scrolling. The outline now renders beside the document instead of inside that header. `globals.css` owns semantic colors and TipTap typography. Theme changes use those tokens and a local preference store, without a new root provider.

## Design rubric

Compare candidates on preserving editor identity and permissions, single ownership of UI state, responsive sticky geometry, real formatted file output, and number of new dependencies. Do not change server storage or APIs to implement local presentation or export.

## Selected interfaces

Choose A's CSS-token/local preference store and native left drawer, with B's parent-owned layout and immutable export snapshot. Both designs preserve the editor session and browser-native PDF printing. Reject a slot-heavy EditorWorkspace, server conversion, preference API, and raster PDF capture. Cross-model judging was not used; two independent designs were compared directly for the constraints above.

- `lib/theme.ts`: one validated local `light | dark` preference store and prepaint bootstrap; no session/Yjs state. `ThemeToggle` is its Sun/Moon control. Default remains dark.
- `DocumentEditor`: owns desktop outline visibility/mobile drawer visibility; these do not enter editor/collaboration dependencies. Measures sticky header height for the left rail.
- `DocumentOutline({ editor })`: derives H1/H2/H3 from the live ProseMirror tree, navigates without changing shared content. Native dialog provides the mobile focus boundary.
- `DocumentTools({ editor, title, outline })`: renders the Outline trigger, Find, Export, and Help. The parent supplies outline visibility and the toggle handler.
- `exportDocument({ editor, title, format })`: captures immutable content before async conversion; formats `pdf | docx | txt | md | html | json`. PDF opens Print / Save as PDF, never claims a file was saved.
- `DashboardView`: adds navigation around its existing state/setters/handlers; no new data owner or queries.

Use `docx@9.6.0` (compatible with the project's Node 20 environment) for genuine OOXML. No PDF/Markdown dependency is needed. Existing lockfile changes are preserved; dependency installation necessarily adds DOCX entries. Generated database files remain untouched.

## Verification results

- `npm run test --workspace=apps/web -- --runInBand --silent`: 35 suites, 337 tests pass. Tests include actual TipTap selection transactions, remote Yjs headings, theme persistence and storage failures, DOCX ZIP contents, and service-worker asset refresh and offline fallback.
- `npm run typecheck`: all workspace type checks pass.
- `npm run lint --workspace=apps/web`: passes.
- `npm run build --workspace=apps/web`: passes. Existing middleware deprecation and generated Prisma filesystem-tracing warnings remain.
- `scripts/verify-launch.cjs`: passes in Chrome. Editor checks cover both themes at widths 1440, 768, 640, 375, and 320, including long-document scrolling. No horizontal overflow occurs, and the header and toolbar remain visible. Theme changes preserve the editor instance and Yjs bytes.
- Dashboard checks cover both themes at widths 1440, 375, and 320, mobile navigation, reload persistence, templates, and literal TXT import. Desktop and mobile screenshots were inspected.
- Browser checks capture real DOCX, TXT, Markdown, HTML, and JSON download bytes and the PDF print frame. Chrome generates a 13-page PDF from that frame's HTML. `pypdf` confirms the first and last document sections, with no application status text.

The latest screenshots and exported files are in `C:\Users\goely\AppData\Local\Temp\opencode\syncsave-launch-rXKUwG`.

## Theme and outline follow-up

- The root theme bootstrap uses `next/script` with `beforeInteractive`. Chrome reports no script-tag warning, hydration failure, or uncaught exception during verification.
- Light backgrounds use neutral white and gray. Dark backgrounds use neutral charcoal. Live demo reloads confirm body colors of `rgb(250, 250, 250)` and `rgb(15, 15, 15)`.
- Document tools sit above the formatting toolbar. Desktop Outline opens and closes, and heading links scroll below the sticky header. The desktop rail has a bordered panel. The mobile drawer remains available.
- Localhost static assets refresh online and retain cached offline fallback. Production asset caching remains cache-first.
- A clean production rebuild removed stale compiled CSS. Browser verification passes against that build, including both themes, all responsive layouts, exports, and six public routes. Desktop and mobile editor screenshots were inspected.
- The local production server runs at `http://localhost:3000` with process-local `AUTH_URL=http://localhost:3000`. The auth session endpoint and collaboration health endpoint both return HTTP 200. Authentication source code and persisted environment files are unchanged.

## Verification boundaries and format limits

The isolated browser editor uses real TipTap and Yjs, with routing adapters and API fixtures. These browser checks do not exercise live authenticated database CRUD or multi-client WebSocket persistence. Auth, document APIs, permissions, and offline regressions pass in the web test suite. Application code contains no new mock documents or routes.

PDF uses native Print / Save as PDF. The browser check verifies the print document and generated PDF content, not an automated native save destination. DOCX, HTML, and PDF preserve the editor's supported text formatting. TXT has no styling. Markdown uses inline HTML for underline. Unsupported nodes or marks produce an error, while JSON keeps raw content. Exports exclude snapshots, comments, and whiteboards.

Theme remains local to the browser and defaults to dark. Authored whiteboard colors are unchanged. The pre-existing launch limitations for backups, shared records, and email notifications still apply.
