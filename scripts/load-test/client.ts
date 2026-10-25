import WebSocket from 'ws';
import * as Y from 'yjs';
import { performance } from 'perf_hooks';

// Polyfill WebSocket for Node runtime
if (!(global as any).WebSocket) {
  (global as any).WebSocket = WebSocket;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { WebsocketProvider } = require('y-websocket');

export interface ClientStats {
  editsSent: number;
  editsReceived: number;
  probesSent: number;
  probesReceived: number;
  errors: number;
  closeCodes: Record<number, number>;
  reconnectTimeMs?: number;
}

export class SimulatedClient {
  public readonly clientId: string;
  public readonly docId: string;
  public readonly role: 'OWNER' | 'EDITOR' | 'VIEWER';
  public readonly isSlow: boolean;
  public ydoc: Y.Doc;
  public provider: any;
  public stats: ClientStats;
  private editTimer: NodeJS.Timeout | null = null;
  private onLatencySample?: (latencyMs: number) => void;
  private isConnected = false;
  private isSynced = false;
  private seq = 0;
  private wsUrl: string;
  private token: string;

  constructor(opts: {
    clientId: string;
    docId: string;
    wsUrl: string;
    token: string;
    role?: 'OWNER' | 'EDITOR' | 'VIEWER';
    isSlow?: boolean;
    onLatencySample?: (latencyMs: number) => void;
  }) {
    this.clientId = opts.clientId;
    this.docId = opts.docId;
    this.wsUrl = opts.wsUrl;
    this.token = opts.token;
    this.role = opts.role || 'EDITOR';
    this.isSlow = opts.isSlow || false;
    this.onLatencySample = opts.onLatencySample;
    this.ydoc = new Y.Doc();

    this.stats = {
      editsSent: 0,
      editsReceived: 0,
      probesSent: 0,
      probesReceived: 0,
      errors: 0,
      closeCodes: {},
    };
  }

  public connect(): Promise<boolean> {
    return new Promise((resolve) => {
      let resolved = false;

      this.provider = new WebsocketProvider(this.wsUrl, this.docId, this.ydoc, {
        params: { token: this.token },
        WebSocketPolyfill: WebSocket,
        disableBc: true,
        resyncInterval: 0,
      });

      // Track probe map for precise sync latency calculation
      const probeMap = this.ydoc.getMap('load_test_probes');
      probeMap.observe((event) => {
        const now = performance.now();
        event.changes.keys.forEach((change, key) => {
          if (change.action === 'add' || change.action === 'update') {
            const probe = probeMap.get(key) as any;
            if (probe && probe.sender !== this.clientId && typeof probe.sentAt === 'number') {
              this.stats.probesReceived++;
              const transitMs = now - probe.sentAt;
              if (transitMs >= 0 && this.onLatencySample) {
                this.onLatencySample(transitMs);
              }
            }
          }
        });
      });

      // Track text changes for CRDT throughput
      const contentText = this.ydoc.getText('content');
      contentText.observe(() => {
        this.stats.editsReceived++;
      });

      // Intercept raw WebSocket for error tracking and slow-client simulation
      const setupWsListeners = () => {
        const ws = this.provider.ws as WebSocket | null;
        if (!ws) return;

        ws.on('close', (code: number) => {
          this.stats.closeCodes[code] = (this.stats.closeCodes[code] || 0) + 1;
          this.isConnected = false;
        });

        ws.on('error', () => {
          this.stats.errors++;
        });

        if (this.isSlow) {
          // Slow client: delay message processing to simulate heavy client backpressure
          const origOnMessage = ws.onmessage;
          if (origOnMessage) {
            ws.onmessage = (event: any) => {
              setTimeout(() => {
                try {
                  origOnMessage.call(ws, event);
                } catch {
                  // Ignore parse errors from deliberate slowdown
                }
              }, 150); // 150ms processing lag per message
            };
          }
        }
      };

      this.provider.on('status', (event: { status: string }) => {
        if (event.status === 'connected') {
          this.isConnected = true;
          setupWsListeners();
        } else if (event.status === 'disconnected') {
          this.isConnected = false;
        }
      });

      this.provider.on('sync', (isSynced: boolean) => {
        if (isSynced && !resolved) {
          resolved = true;
          this.isSynced = true;
          resolve(true);
        }
      });

      // Timeout fallback in case connection fails (e.g., auth error)
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(this.isSynced);
        }
      }, 5000);
    });
  }

  public startEditing(frequencyMs: number): void {
    if (this.editTimer || this.role === 'VIEWER') return;

    const contentText = this.ydoc.getText('content');
    const probeMap = this.ydoc.getMap('load_test_probes');

    this.editTimer = setInterval(() => {
      if (!this.isConnected || !this.isSynced) return;

      const now = performance.now();
      const probeId = `${this.clientId}_${this.seq++}`;

      this.ydoc.transact(() => {
        // 1. Insert timestamped probe for latency calculation
        probeMap.set(probeId, {
          sender: this.clientId,
          sentAt: now,
          seq: this.seq,
        });

        // 2. Realistic document text typing
        const textSample = ` [${this.clientId}:${this.seq}] `;
        const insertPos = Math.min(contentText.length, Math.floor(Math.random() * (contentText.length + 1)));
        contentText.insert(insertPos, textSample);
      });

      this.stats.editsSent++;
      this.stats.probesSent++;
    }, frequencyMs);
  }

  public stopEditing(): void {
    if (this.editTimer) {
      clearInterval(this.editTimer);
      this.editTimer = null;
    }
  }

  public disconnect(): void {
    this.stopEditing();
    if (this.provider) {
      try {
        this.provider.destroy();
      } catch {
        // Ignore destroy cleanup errors
      }
    }
    try {
      this.ydoc.destroy();
    } catch {
      // Ignore doc cleanup errors
    }
  }

  /**
   * Abruptly kills connection (simulating network drop / crash)
   */
  public dropConnection(): void {
    if (this.provider && this.provider.ws) {
      try {
        this.provider.ws.terminate();
      } catch {
        // Socket may already be dead
      }
    }
  }

  /**
   * Reconnects and returns duration until synced in milliseconds
   */
  public async reconnect(): Promise<number> {
    const startTime = performance.now();
    return new Promise((resolve) => {
      const onSync = (synced: boolean) => {
        if (synced) {
          this.provider.off('sync', onSync);
          const duration = performance.now() - startTime;
          this.stats.reconnectTimeMs = duration;
          resolve(duration);
        }
      };
      this.provider.on('sync', onSync);
      this.provider.connect();

      // Fallback timeout
      setTimeout(() => {
        this.provider.off('sync', onSync);
        resolve(performance.now() - startTime);
      }, 10000);
    });
  }
}
