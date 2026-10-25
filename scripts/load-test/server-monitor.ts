import os from 'os';
import { performance } from 'perf_hooks';
import { ServerResourceSample, ServerResourceStats } from './types';

export class ServerMonitor {
  private httpUrl: string;
  private samples: ServerResourceSample[] = [];
  private monitorTimer: NodeJS.Timeout | null = null;

  constructor(httpUrl: string) {
    this.httpUrl = httpUrl.replace(/\/+$/, '');
  }

  public static getHostInfo() {
    const cpus = os.cpus();
    return {
      nodeVersion: process.version,
      os: `${os.type()} ${os.release()} (${os.arch()})`,
      cpuModel: cpus.length > 0 ? cpus[0].model : 'Unknown CPU',
      cpuCores: cpus.length,
      totalMemGb: Math.round((os.totalmem() / (1024 * 1024 * 1024)) * 10) / 10,
      timestamp: new Date().toISOString(),
    };
  }

  public async fetchHealth(): Promise<{
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    activeConnections: number;
    uptimeSec: number;
  } | null> {
    try {
      const res = await fetch(`${this.httpUrl}/health`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return null;
      const data = await res.json() as any;
      return {
        rssMb: Math.round((data.memory.rss / (1024 * 1024)) * 10) / 10,
        heapUsedMb: Math.round((data.memory.heapUsed / (1024 * 1024)) * 10) / 10,
        heapTotalMb: Math.round((data.memory.heapTotal / (1024 * 1024)) * 10) / 10,
        activeConnections: data.connections ?? 0,
        uptimeSec: Math.round(data.uptime ?? 0),
      };
    } catch {
      return null;
    }
  }

  public async measureHttpPing(): Promise<number> {
    const start = performance.now();
    try {
      await fetch(`${this.httpUrl}/health`, { signal: AbortSignal.timeout(2000) });
      return performance.now() - start;
    } catch {
      return -1;
    }
  }

  public startSampling(intervalMs = 1000): void {
    if (this.monitorTimer) return;
    this.samples = [];

    this.monitorTimer = setInterval(async () => {
      const health = await this.fetchHealth();
      if (health) {
        this.samples.push({
          timestamp: Date.now(),
          ...health,
        });
      }
    }, intervalMs);
  }

  public stopSampling(): ServerResourceStats {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }

    if (this.samples.length === 0) {
      return {
        startRssMb: 0,
        peakRssMb: 0,
        endRssMb: 0,
        startHeapMb: 0,
        peakHeapMb: 0,
        endHeapMb: 0,
        samples: [],
      };
    }

    const startRss = this.samples[0].rssMb;
    const endRss = this.samples[this.samples.length - 1].rssMb;
    const peakRss = Math.max(...this.samples.map((s) => s.rssMb));

    const startHeap = this.samples[0].heapUsedMb;
    const endHeap = this.samples[this.samples.length - 1].heapUsedMb;
    const peakHeap = Math.max(...this.samples.map((s) => s.heapUsedMb));

    return {
      startRssMb: startRss,
      peakRssMb: peakRss,
      endRssMb: endRss,
      startHeapMb: startHeap,
      peakHeapMb: peakHeap,
      endHeapMb: endHeap,
      samples: this.samples,
    };
  }
}
