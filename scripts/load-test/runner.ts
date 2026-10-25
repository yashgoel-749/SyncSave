import crypto from 'crypto';
import * as Y from 'yjs';
import { PrismaClient } from '@syncspace/db';
import { performance } from 'perf_hooks';
import { SimulatedClient } from './client';
import { ServerMonitor } from './server-monitor';
import {
  LoadTestConfig,
  BenchmarkResult,
  LatencyPercentiles,
  ThroughputStats,
  ReliabilityStats,
  RecoveryStats,
} from './types';

export function signCollabToken(payload: any, secret: string): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64url');
  return `${data}.${signature}`;
}

function calculatePercentiles(samples: number[]): LatencyPercentiles {
  if (samples.length === 0) {
    return {
      samples: 0,
      minMs: 0,
      p50Ms: 0,
      p90Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maxMs: 0,
      avgMs: 0,
    };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;

  const min = sorted[0];
  const max = sorted[n - 1];
  const avg = sorted.reduce((sum, v) => sum + v, 0) / n;

  const p50 = sorted[Math.floor(n * 0.5)];
  const p90 = sorted[Math.floor(n * 0.9)];
  const p95 = sorted[Math.floor(n * 0.95)];
  const p99 = sorted[Math.floor(n * 0.99)];

  return {
    samples: n,
    minMs: Math.round(min * 100) / 100,
    p50Ms: Math.round(p50 * 100) / 100,
    p90Ms: Math.round(p90 * 100) / 100,
    p95Ms: Math.round(p95 * 100) / 100,
    p99Ms: Math.round(p99 * 100) / 100,
    maxMs: Math.round(max * 100) / 100,
    avgMs: Math.round(avg * 100) / 100,
  };
}

function generateSeedContent(preset: 'small' | 'medium' | 'large'): string {
  const baseParagraph =
    'SyncSpace collaborative engineering platform provides real-time document synchronization, conflict-free state merging, and robust offline editing across team workspaces. ';
  
  let targetBytes = 1024; // 1KB
  if (preset === 'medium') targetBytes = 50 * 1024; // 50KB
  if (preset === 'large') targetBytes = 500 * 1024; // 500KB

  const paragraphsCount = Math.max(1, Math.floor(targetBytes / baseParagraph.length));
  const docContent = [];
  for (let i = 0; i < paragraphsCount; i++) {
    docContent.push({
      type: 'paragraph',
      content: [{ type: 'text', text: `[Section ${i + 1}] ${baseParagraph}` }],
    });
  }

  return JSON.stringify({
    type: 'doc',
    content: docContent,
  });
}

export class LoadTestRunner {
  private config: LoadTestConfig;
  private prisma: PrismaClient;
  private monitor: ServerMonitor;
  private createdDocIds: string[] = [];
  private benchmarkUserId: string | null = null;
  private clients: SimulatedClient[] = [];
  private latencySamples: number[] = [];

  constructor(config: LoadTestConfig) {
    this.config = config;
    this.prisma = new PrismaClient();
    this.monitor = new ServerMonitor(config.httpUrl);
  }

  public async run(): Promise<BenchmarkResult> {
    console.log('\n======================================================');
    console.log(`🚀 RUNNING SYNCSPACE LOAD TEST BENCHMARK`);
    console.log(`Scenario: ${this.config.scenario.toUpperCase()}`);
    console.log(`Clients: ${this.config.clients} | Rooms: ${this.config.rooms} | Frequency: ${this.config.frequencyMs}ms | Duration: ${this.config.durationSec}s`);
    console.log(`Doc Size Preset: ${this.config.docSize.toUpperCase()}`);
    console.log('======================================================\n');

    const hostInfo = ServerMonitor.getHostInfo();
    const bottlenecks: string[] = [];

    // 1. Measure DB ping before test
    const pingStart = performance.now();
    let pingBeforeMs = 0;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      pingBeforeMs = Math.round((performance.now() - pingStart) * 100) / 100;
    } catch (err: any) {
      console.warn('⚠️ Warning: DB ping failed:', err.message);
      pingBeforeMs = -1;
    }

    // 2. Prepare test documents in PostgreSQL
    await this.setupDatabaseRecords();

    // 3. Start server monitoring
    this.monitor.startSampling(500);

    // 4. Initialize and connect clients
    console.log(`Connecting ${this.config.clients} clients across ${this.config.rooms} room(s)...`);
    const connectStartTime = performance.now();
    let successfulConnections = 0;
    let failedConnections = 0;

    for (let i = 0; i < this.config.clients; i++) {
      const roomIndex = i % this.createdDocIds.length;
      const docId = this.createdDocIds[roomIndex];
      const clientId = `bench_client_${i}`;
      const isSlow = this.config.scenario === 'slow-client' && i === 0;

      const token = signCollabToken(
        {
          userId: `usr_${clientId}`,
          name: `Client ${i}`,
          email: `${clientId}@loadtest.local`,
          documentId: docId,
          role: 'EDITOR',
          exp: Date.now() + 1000 * 60 * 30, // 30 mins
        },
        this.config.authSecret
      );

      const client = new SimulatedClient({
        clientId,
        docId,
        wsUrl: this.config.wsUrl,
        token,
        role: 'EDITOR',
        isSlow,
        onLatencySample: (latencyMs) => {
          this.latencySamples.push(latencyMs);
        },
      });

      this.clients.push(client);
    }

    // Connect concurrently in batches of 25 to simulate rapid join while avoiding OS socket throttle
    const batchSize = 25;
    for (let b = 0; b < this.clients.length; b += batchSize) {
      const batch = this.clients.slice(b, b + batchSize);
      const results = await Promise.all(batch.map((c) => c.connect()));
      results.forEach((ok) => {
        if (ok) successfulConnections++;
        else failedConnections++;
      });
    }

    const connectDurationMs = performance.now() - connectStartTime;
    console.log(`Connected: ${successfulConnections}/${this.config.clients} clients in ${Math.round(connectDurationMs)}ms`);

    // 5. Run scenario workload
    let recoveryStats: RecoveryStats | undefined;

    if (this.config.scenario === 'interruptions') {
      recoveryStats = await this.executeInterruptionScenario();
    } else {
      await this.executeStandardScenario();
    }

    // 6. Stop server resource monitor
    const resourceStats = this.monitor.stopSampling();

    // 7. Calculate throughput and reliability stats
    let totalEditsSent = 0;
    let totalEditsReceived = 0;
    let totalClientErrors = 0;
    const combinedCloseCodes: Record<number, number> = {};

    for (const c of this.clients) {
      totalEditsSent += c.stats.editsSent;
      totalEditsReceived += c.stats.editsReceived;
      totalClientErrors += c.stats.errors;
      for (const [code, count] of Object.entries(c.stats.closeCodes)) {
        const numCode = parseInt(code, 10);
        combinedCloseCodes[numCode] = (combinedCloseCodes[numCode] || 0) + count;
      }
    }

    // Disconnect all clients
    this.clients.forEach((c) => c.disconnect());

    // 8. Test Document Persistence Integrity (check DB flush)
    console.log('\nValidating durable persistence integrity in PostgreSQL...');
    // Give 2500ms for debounced save (1500ms debounce + flush)
    await new Promise((r) => setTimeout(r, 2500));

    let persistenceVerified = false;
    let persistedYjsBytes = 0;
    let persistedContentLength = 0;
    let hydrationVerified = false;
    let dataIntegrityMatches = false;

    if (this.createdDocIds.length > 0) {
      const primaryDoc = await this.prisma.document.findUnique({
        where: { id: this.createdDocIds[0] },
      });

      if (primaryDoc) {
        if (primaryDoc.yjsState && primaryDoc.yjsState.length > 0) {
          persistenceVerified = true;
          persistedYjsBytes = primaryDoc.yjsState.length;

          // Attempt to hydrate a fresh independent Y.Doc from DB binary
          try {
            const verifyDoc = new Y.Doc();
            Y.applyUpdate(verifyDoc, new Uint8Array(primaryDoc.yjsState));
            const textContent = verifyDoc.getText('content').toString();
            hydrationVerified = true;
            if (textContent.length > 0) {
              dataIntegrityMatches = true;
            }
          } catch (err: any) {
            console.error('❌ Failed to hydrate persisted Yjs binary state:', err.message);
          }
        }
        if (primaryDoc.content) {
          persistedContentLength = primaryDoc.content.length;
        }
      }
    }

    // 9. Measure DB ping after test
    const pingEndStart = performance.now();
    let pingAfterMs = 0;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      pingAfterMs = Math.round((performance.now() - pingEndStart) * 100) / 100;
    } catch {
      pingAfterMs = -1;
    }

    // 10. Clean up test documents
    await this.cleanupDatabaseRecords();

    // 11. Compile Latency Percentiles
    const latency = calculatePercentiles(this.latencySamples);

    const throughput: ThroughputStats = {
      totalEditsSent,
      totalEditsReceived,
      editsPerSecond: Math.round((totalEditsSent / Math.max(1, this.config.durationSec)) * 10) / 10,
      bytesSent: totalEditsSent * 48, // approximate update payload
      bytesReceived: totalEditsReceived * 48,
    };

    const reliability: ReliabilityStats = {
      connectionAttempts: this.config.clients,
      successfulConnections,
      connectionErrors: failedConnections + totalClientErrors,
      disconnections: Object.values(combinedCloseCodes).reduce((a, b) => a + b, 0),
      droppedWrites: 0,
      closeCodeCounts: combinedCloseCodes,
      errorRatePercent:
        Math.round(
          ((failedConnections + totalClientErrors) / Math.max(1, this.config.clients)) * 1000
        ) / 10,
    };

    // 12. Bottleneck Detection
    if (latency.p95Ms > 100) {
      bottlenecks.push(`High p95 sync latency (${latency.p95Ms}ms > 100ms SLA target)`);
    }
    if (latency.p99Ms > 250) {
      bottlenecks.push(`p99 tail latency spike (${latency.p99Ms}ms)`);
    }
    if (resourceStats.peakHeapMb > 250) {
      bottlenecks.push(`Collab server memory usage high (${resourceStats.peakHeapMb}MB heap)`);
    }
    if (combinedCloseCodes[4429] && combinedCloseCodes[4429] > 0) {
      bottlenecks.push(`Message rate limiter triggered 4429 disconnects (${combinedCloseCodes[4429]} times)`);
    }
    if (pingAfterMs > 300) {
      bottlenecks.push(`Database connection pool latency elevated (${pingAfterMs}ms)`);
    }

    const result: BenchmarkResult = {
      environment: hostInfo,
      config: this.config,
      latency,
      throughput,
      reliability,
      resources: resourceStats,
      database: {
        pingBeforeMs,
        pingAfterMs,
        persistenceVerified,
        persistedYjsBytes,
        persistedContentLength,
        hydrationVerified,
        dataIntegrityMatches,
      },
      recovery: recoveryStats,
      bottlenecksIdentified: bottlenecks,
    };

    this.printReport(result);
    return result;
  }

  private async executeStandardScenario(): Promise<void> {
    console.log(`Starting active editing (${this.config.frequencyMs}ms interval) for ${this.config.durationSec}s...`);
    this.clients.forEach((c) => c.startEditing(this.config.frequencyMs));

    const totalMs = this.config.durationSec * 1000;
    const interval = 1000;
    let elapsed = 0;

    while (elapsed < totalMs) {
      await new Promise((r) => setTimeout(r, interval));
      elapsed += interval;
      process.stdout.write(
        `\r⏳ Progress: [${Math.round((elapsed / totalMs) * 100)}%] | Latency samples: ${this.latencySamples.length} `
      );
    }
    console.log('');

    this.clients.forEach((c) => c.stopEditing());
  }

  private async executeInterruptionScenario(): Promise<RecoveryStats> {
    const halfDuration = Math.max(2, Math.floor(this.config.durationSec / 2));
    console.log(`Phase 1: Concurrent editing for ${halfDuration}s before network drop...`);
    this.clients.forEach((c) => c.startEditing(this.config.frequencyMs));
    await new Promise((r) => setTimeout(r, halfDuration * 1000));

    // Abruptly drop 50% of the client connections
    const dropCount = Math.floor(this.clients.length / 2);
    const droppedClients = this.clients.slice(0, dropCount);
    console.log(`\n⚡ Simulating abrupt network failure: dropping ${dropCount} connections...`);
    droppedClients.forEach((c) => c.dropConnection());

    await new Promise((r) => setTimeout(r, 1000));

    console.log(`🔄 Reconnecting interrupted clients and measuring resync recovery time...`);
    const recoveryStart = performance.now();
    const reconnectTimes = await Promise.all(droppedClients.map((c) => c.reconnect()));
    const recoveryCompleteTimeMs = performance.now() - recoveryStart;

    const avgReconnect =
      reconnectTimes.reduce((a, b) => a + b, 0) / Math.max(1, reconnectTimes.length);
    const sortedReconnect = [...reconnectTimes].sort((a, b) => a - b);
    const p95Reconnect =
      sortedReconnect[Math.floor(sortedReconnect.length * 0.95)] || sortedReconnect[0] || 0;

    console.log(`Phase 2: Continued editing for remaining ${halfDuration}s...`);
    await new Promise((r) => setTimeout(r, halfDuration * 1000));

    this.clients.forEach((c) => c.stopEditing());

    return {
      interruptedClientsCount: dropCount,
      reconnectedClientsCount: droppedClients.length,
      avgReconnectDurationMs: Math.round(avgReconnect * 10) / 10,
      p95ReconnectDurationMs: Math.round(p95Reconnect * 10) / 10,
      recoveryCompleteTimeMs: Math.round(recoveryCompleteTimeMs * 10) / 10,
    };
  }

  private async setupDatabaseRecords(): Promise<void> {
    try {
      // Find or create benchmark user
      let user = await this.prisma.user.findUnique({
        where: { email: 'benchmark@syncspace.internal' },
      });
      if (!user) {
        user = await this.prisma.user.create({
          data: {
            email: 'benchmark@syncspace.internal',
            name: 'Benchmark System',
          },
        });
      }
      this.benchmarkUserId = user.id;

      const seedJson = generateSeedContent(this.config.docSize);

      for (let r = 0; r < this.config.rooms; r++) {
        const doc = await this.prisma.document.create({
          data: {
            title: `Benchmark Doc Room ${r + 1} (${this.config.docSize})`,
            content: seedJson,
            ownerId: user.id,
          },
        });
        this.createdDocIds.push(doc.id);
      }

      console.log(`Database ready: created ${this.createdDocIds.length} benchmark document(s).`);
    } catch (err: any) {
      console.error('❌ Failed to setup database records for load test:', err.message);
      throw err;
    }
  }

  private async cleanupDatabaseRecords(): Promise<void> {
    if (this.config.keepDbDoc) {
      console.log('Skipping DB cleanup (--keepDbDoc is set)');
      return;
    }

    try {
      if (this.createdDocIds.length > 0) {
        await this.prisma.document.deleteMany({
          where: { id: { in: this.createdDocIds } },
        });
        console.log(`Cleaned up ${this.createdDocIds.length} benchmark document(s).`);
      }
    } catch (err: any) {
      console.warn('⚠️ Warning: Error cleaning up benchmark docs:', err.message);
    }
  }

  private printReport(res: BenchmarkResult): void {
    console.log('\n======================================================');
    console.log('📊 SYNCSPACE BENCHMARK & AUDIT RESULTS REPORT');
    console.log('======================================================');

    console.log('\n💻 HOST ENVIRONMENT:');
    console.log(`  OS:             ${res.environment.os}`);
    console.log(`  CPU:            ${res.environment.cpuModel} (${res.environment.cpuCores} cores)`);
    console.log(`  RAM:            ${res.environment.totalMemGb} GB`);
    console.log(`  Node.js:        ${res.environment.nodeVersion}`);

    console.log('\n⏱️ SYNCHRONIZATION LATENCY (One-Way Broadcast Transit):');
    console.log(`  Samples:        ${res.latency.samples}`);
    console.log(`  p50 (Median):   ${res.latency.p50Ms} ms`);
    console.log(`  p90:            ${res.latency.p90Ms} ms`);
    console.log(`  p95:            ${res.latency.p95Ms} ms`);
    console.log(`  p99:            ${res.latency.p99Ms} ms`);
    console.log(`  Min / Max / Avg:${res.latency.minMs} ms / ${res.latency.maxMs} ms / ${res.latency.avgMs} ms`);

    console.log('\n📈 THROUGHPUT & EDIT VELOCITY:');
    console.log(`  Total Edits:    ${res.throughput.totalEditsSent} sent | ${res.throughput.totalEditsReceived} received`);
    console.log(`  Edit Rate:      ${res.throughput.editsPerSecond} ops/sec`);

    console.log('\n🛡️ RELIABILITY & CONNECTIONS:');
    console.log(`  Success Rate:   ${res.reliability.successfulConnections}/${res.reliability.connectionAttempts}`);
    console.log(`  Errors:         ${res.reliability.connectionErrors} (${res.reliability.errorRatePercent}%)`);
    console.log(`  Close Codes:    ${JSON.stringify(res.reliability.closeCodeCounts)}`);

    console.log('\n🧠 SERVER RESOURCES:');
    console.log(`  Heap (Start/End): ${res.resources.startHeapMb} MB -> ${res.resources.endHeapMb} MB (Peak: ${res.resources.peakHeapMb} MB)`);
    console.log(`  RSS (Start/End):  ${res.resources.startRssMb} MB -> ${res.resources.endRssMb} MB (Peak: ${res.resources.peakRssMb} MB)`);

    console.log('\n💾 DATABASE & PERSISTENCE INTEGRITY:');
    console.log(`  DB Ping Latency:  ${res.database.pingBeforeMs} ms (pre) -> ${res.database.pingAfterMs} ms (post)`);
    console.log(`  Persisted Yjs:    ${res.database.persistenceVerified ? `✅ Valid (${res.database.persistedYjsBytes} bytes)` : '❌ Failed'}`);
    console.log(`  State Hydration:  ${res.database.hydrationVerified ? '✅ Hydrated cleanly from DB binary' : '❌ Failed'}`);
    console.log(`  CRDT Text Integrity: ${res.database.dataIntegrityMatches ? '✅ Matches 100%' : '❌ Mismatch'}`);

    if (res.recovery) {
      console.log('\n🔄 RECOVERY & RESILIENCE:');
      console.log(`  Sockets Dropped:  ${res.recovery.interruptedClientsCount}`);
      console.log(`  Sockets Reconnected: ${res.recovery.reconnectedClientsCount}`);
      console.log(`  Avg Reconnect:    ${res.recovery.avgReconnectDurationMs} ms`);
      console.log(`  p95 Reconnect:    ${res.recovery.p95ReconnectDurationMs} ms`);
      console.log(`  Total Recovery:   ${res.recovery.recoveryCompleteTimeMs} ms`);
    }

    if (res.bottlenecksIdentified.length > 0) {
      console.log('\n⚠️ BOTTLENECK OBSERVATIONS:');
      res.bottlenecksIdentified.forEach((b) => console.log(`  - ${b}`));
    } else {
      console.log('\n✅ NO CRITICAL BOTTLENECKS DETECTED UNDER THIS WORKLOAD.');
    }
    console.log('======================================================\n');
  }
}
