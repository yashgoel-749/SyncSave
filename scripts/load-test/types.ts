export type ScenarioType =
  | 'baseline'
  | 'slow-client'
  | 'interruptions'
  | 'persistence'
  | 'server-restart'
  | 'matrix';

export type DocSizePreset = 'small' | 'medium' | 'large';

export interface LoadTestConfig {
  clients: number;
  rooms: number;
  docSize: DocSizePreset;
  frequencyMs: number;
  durationSec: number;
  wsUrl: string;
  httpUrl: string;
  scenario: ScenarioType;
  authSecret: string;
  keepDbDoc?: boolean;
  verbose?: boolean;
}

export interface LatencyPercentiles {
  samples: number;
  minMs: number;
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  avgMs: number;
}

export interface ThroughputStats {
  totalEditsSent: number;
  totalEditsReceived: number;
  editsPerSecond: number;
  bytesSent: number;
  bytesReceived: number;
}

export interface ReliabilityStats {
  connectionAttempts: number;
  successfulConnections: number;
  connectionErrors: number;
  disconnections: number;
  droppedWrites: number;
  closeCodeCounts: Record<number, number>;
  errorRatePercent: number;
}

export interface ServerResourceSample {
  timestamp: number;
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  activeConnections: number;
  uptimeSec: number;
}

export interface ServerResourceStats {
  startRssMb: number;
  peakRssMb: number;
  endRssMb: number;
  startHeapMb: number;
  peakHeapMb: number;
  endHeapMb: number;
  samples: ServerResourceSample[];
}

export interface DatabaseStats {
  pingBeforeMs: number;
  pingAfterMs: number;
  persistenceVerified: boolean;
  persistedYjsBytes: number;
  persistedContentLength: number;
  hydrationVerified: boolean;
  dataIntegrityMatches: boolean;
}

export interface RecoveryStats {
  interruptedClientsCount?: number;
  reconnectedClientsCount?: number;
  avgReconnectDurationMs?: number;
  p95ReconnectDurationMs?: number;
  recoveryCompleteTimeMs?: number;
}

export interface BenchmarkResult {
  environment: {
    nodeVersion: string;
    os: string;
    cpuModel: string;
    cpuCores: number;
    totalMemGb: number;
    timestamp: string;
  };
  config: LoadTestConfig;
  latency: LatencyPercentiles;
  throughput: ThroughputStats;
  reliability: ReliabilityStats;
  resources: ServerResourceStats;
  database: DatabaseStats;
  recovery?: RecoveryStats;
  bottlenecksIdentified: string[];
}
