import * as dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { LoadTestRunner } from './runner';
import { LoadTestConfig, ScenarioType, DocSizePreset, BenchmarkResult } from './types';

function parseArgs(): LoadTestConfig & { outputJson?: string } {
  const args = process.argv.slice(2);
  const options: any = {
    clients: 10,
    rooms: 1,
    docSize: 'small',
    frequencyMs: 100,
    durationSec: 15,
    wsUrl: process.env.NEXT_PUBLIC_COLLAB_WS_URL || 'ws://localhost:1234',
    httpUrl: 'http://localhost:1234',
    scenario: 'baseline',
    authSecret: process.env.AUTH_SECRET || 'f39c2941fa98a287bfba581023d8c11e037b5a31b40dc8234f9a08e1a8bb285e',
    outputJson: undefined,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--clients' || arg === '-c') {
      options.clients = parseInt(args[++i], 10);
    } else if (arg.startsWith('--clients=')) {
      options.clients = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--rooms' || arg === '-r') {
      options.rooms = parseInt(args[++i], 10);
    } else if (arg.startsWith('--rooms=')) {
      options.rooms = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--docSize' || arg === '-s') {
      options.docSize = args[++i] as DocSizePreset;
    } else if (arg.startsWith('--docSize=')) {
      options.docSize = arg.split('=')[1] as DocSizePreset;
    } else if (arg === '--frequency' || arg === '-f') {
      options.frequencyMs = parseInt(args[++i], 10);
    } else if (arg.startsWith('--frequency=')) {
      options.frequencyMs = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--duration' || arg === '-d') {
      options.durationSec = parseInt(args[++i], 10);
    } else if (arg.startsWith('--duration=')) {
      options.durationSec = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--scenario') {
      options.scenario = args[++i] as ScenarioType;
    } else if (arg.startsWith('--scenario=')) {
      options.scenario = arg.split('=')[1] as ScenarioType;
    } else if (arg === '--wsUrl') {
      options.wsUrl = args[++i];
    } else if (arg.startsWith('--wsUrl=')) {
      options.wsUrl = arg.split('=')[1];
    } else if (arg === '--httpUrl') {
      options.httpUrl = args[++i];
    } else if (arg.startsWith('--httpUrl=')) {
      options.httpUrl = arg.split('=')[1];
    } else if (arg === '--output' || arg === '-o') {
      options.outputJson = args[++i];
    } else if (arg.startsWith('--output=')) {
      options.outputJson = arg.split('=')[1];
    } else if (arg === '--keep') {
      options.keepDbDoc = true;
    }
  }

  return options;
}

async function runBenchmarkMatrix(baseConfig: LoadTestConfig, outputDir: string): Promise<BenchmarkResult[]> {
  console.log('\n======================================================');
  console.log('🧪 EXECUTING FULL SYNCSPACE BENCHMARK & AUDIT MATRIX');
  console.log('======================================================\n');

  const matrixRuns: Array<{ name: string; cfg: Partial<LoadTestConfig> }> = [
    {
      name: '1. Baseline Moderate Load (10 clients, 1 doc, 100ms, 15s)',
      cfg: { clients: 10, rooms: 1, docSize: 'small', frequencyMs: 100, durationSec: 15, scenario: 'baseline' },
    },
    {
      name: '2. High Concurrency Stress (40 clients, 1 doc, 100ms, 15s)',
      cfg: { clients: 40, rooms: 1, docSize: 'small', frequencyMs: 100, durationSec: 15, scenario: 'baseline' },
    },
    {
      name: '3. Multi-Room Scalability (30 clients across 5 rooms, 100ms, 15s)',
      cfg: { clients: 30, rooms: 5, docSize: 'small', frequencyMs: 100, durationSec: 15, scenario: 'baseline' },
    },
    {
      name: '4. Large Document State Stress (50KB state, 15 clients, 100ms, 15s)',
      cfg: { clients: 15, rooms: 1, docSize: 'medium', frequencyMs: 100, durationSec: 15, scenario: 'baseline' },
    },
    {
      name: '5. Slow Client Resilience & Buffer Backpressure (15 clients + 1 throttled, 15s)',
      cfg: { clients: 15, rooms: 1, docSize: 'small', frequencyMs: 100, durationSec: 15, scenario: 'slow-client' },
    },
    {
      name: '6. Network Interruption & Resync Recovery (20 clients, 50% drop & reconnect, 16s)',
      cfg: { clients: 20, rooms: 1, docSize: 'small', frequencyMs: 100, durationSec: 16, scenario: 'interruptions' },
    },
    {
      name: '7. Durable Persistence & 0-Loss Verification (15 clients, rapid 50ms edits, 15s)',
      cfg: { clients: 15, rooms: 1, docSize: 'small', frequencyMs: 50, durationSec: 15, scenario: 'persistence' },
    },
  ];

  const results: BenchmarkResult[] = [];

  for (const item of matrixRuns) {
    console.log(`\n▶️ Starting Matrix Test: ${item.name}`);
    const mergedConfig: LoadTestConfig = {
      ...baseConfig,
      ...item.cfg,
    };
    const runner = new LoadTestRunner(mergedConfig);
    const result = await runner.run();
    results.push(result);

    // Short cool-down between matrix runs to let event loop & GC settle
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Save consolidated matrix report
  const summaryFile = path.join(outputDir, `matrix_results_${Date.now()}.json`);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(summaryFile, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\n💾 Saved all matrix test results to: ${summaryFile}`);

  return results;
}

async function main() {
  const options = parseArgs();

  // Quick verify collab server is reachable
  try {
    const healthCheck = await fetch(`${options.httpUrl}/health`, { signal: AbortSignal.timeout(3000) });
    if (!healthCheck.ok) {
      console.error(`❌ Collab server at ${options.httpUrl}/health returned HTTP ${healthCheck.status}`);
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`❌ Cannot connect to Collab server at ${options.httpUrl}: ${err.message}`);
    console.error('💡 Make sure the collab-server is running (e.g. `npm run dev:collab`) before running load tests.');
    process.exit(1);
  }

  const resultsDir = path.resolve(process.cwd(), 'scripts/load-test/results');

  if (options.scenario === 'matrix') {
    const results = await runBenchmarkMatrix(options, resultsDir);
    process.exit(0);
  } else {
    const runner = new LoadTestRunner(options);
    const result = await runner.run();

    if (options.outputJson) {
      const outPath = path.resolve(process.cwd(), options.outputJson);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
      console.log(`💾 Result saved to ${outPath}`);
    }
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('FATAL: Load test failed with unhandled error:', err);
  process.exit(1);
});
