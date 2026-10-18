import * as http from 'http';
import WebSocket from 'ws';

// y-websocket ships its utils as CJS — declare the module shape we use
// so TypeScript is happy; full types land in a future version of y-websocket.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { setupWSConnection: yjsSetup } = require('y-websocket/bin/utils') as {
  setupWSConnection: (ws: WebSocket, req: http.IncomingMessage, opts?: unknown) => void;
};

/**
 * Thin wrapper around y-websocket's built-in setupWSConnection.
 * We isolate this so we can swap implementations in tests or add
 * per-connection auth checks in Milestone 5.
 *
 * y-websocket extracts the Yjs document name from the URL path
 * (e.g. a client connecting to ws://server/doc-id gets a shared doc named "doc-id").
 */
export function setupWSConnection(
  ws: WebSocket,
  req: http.IncomingMessage,
): void {
  yjsSetup(ws, req);
}
