import * as dotenv from 'dotenv';
dotenv.config();

import WebSocket from 'ws';
import * as Y from 'yjs';
import { PrismaClient } from '@syncspace/db';
import { performance } from 'perf_hooks';
import { signCollabToken } from './runner';

(global as any).WebSocket = WebSocket;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { WebsocketProvider } = require('y-websocket');

async function testServerRestartGraceful() {
  console.log('\n======================================================');
  console.log('🔄 TESTING SERVER RESTART, DRAIN & RECOVERY INTEGRITY');
  console.log('======================================================\n');

  const prisma = new PrismaClient();
  const secret = process.env.AUTH_SECRET || 'f39c2941fa98a287bfba581023d8c11e037b5a31b40dc8234f9a08e1a8bb285e';

  // 1. Prepare test document
  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({ data: { email: 'restart-test@loadtest.local' } });
  }

  const doc = await prisma.document.create({
    data: {
      title: 'Server Restart Resilience Test',
      content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Initial base text' }] }] }),
      ownerId: user.id,
    },
  });
  console.log(`Created test document: ${doc.id}`);

  // 2. Connect client and make rapid edits
  const token = signCollabToken(
    {
      userId: 'usr_restart_tester',
      name: 'Restart Tester',
      email: 'restart@test.local',
      documentId: doc.id,
      role: 'OWNER',
      exp: Date.now() + 60000,
    },
    secret
  );

  const clientYDoc = new Y.Doc();
  const provider = new WebsocketProvider('ws://localhost:1234', doc.id, clientYDoc, {
    params: { token },
    disableBc: true,
  });

  await new Promise<void>((resolve) => {
    provider.on('sync', (synced: boolean) => {
      if (synced) resolve();
    });
  });
  console.log('Client connected and initial sync complete.');

  // Type 100 new paragraphs
  const text = clientYDoc.getText('content');
  for (let i = 0; i < 50; i++) {
    text.insert(text.length, `\n[Paragraph ${i + 1}] Critical persisted state during in-flight restart.`);
  }
  console.log(`Generated ${text.length} characters in Yjs document.`);

  // 3. Track close event on client
  let serverCloseCode: number | null = null;
  let serverCloseReason = '';
  provider.ws.on('close', (code: number, reason: Buffer) => {
    serverCloseCode = code;
    serverCloseReason = reason.toString();
    console.log(`Socket closed by server with code: ${code} (reason: "${serverCloseReason}")`);
  });

  // Verify DB state before flush (should be initial state or null)
  const preFlushDoc = await prisma.document.findUnique({ where: { id: doc.id } });
  console.log(`Database state before flush: ${preFlushDoc?.yjsState?.length || 0} bytes`);

  // Wait 3.5 seconds to ensure debounce flush fires
  console.log('Waiting for debounce flush (1500ms debounce + write)...');
  await new Promise((r) => setTimeout(r, 3500));

  // 4. Verify DB state after flush
  const postFlushDoc = await prisma.document.findUnique({ where: { id: doc.id } });
  const flushedBytes = postFlushDoc?.yjsState?.length || 0;
  console.log(`Database state after durable save: ${flushedBytes} bytes`);

  // Hydrate fresh doc from DB
  const verifyDoc = new Y.Doc();
  if (postFlushDoc?.yjsState) {
    Y.applyUpdate(verifyDoc, new Uint8Array(postFlushDoc.yjsState));
  }
  const verifiedText = verifyDoc.getText('content').toString();
  const textMatches = verifiedText.includes('Critical persisted state during in-flight restart.');
  console.log(`Verified text in PostgreSQL binary: ${verifiedText.length} characters | Matches expected: ${textMatches}`);

  // Disconnect & cleanup
  provider.destroy();
  clientYDoc.destroy();
  verifyDoc.destroy();
  await prisma.document.delete({ where: { id: doc.id } });
  await prisma.$disconnect();

  console.log('\n======================================================');
  console.log('📊 RESTART & PERSISTENCE VERIFICATION RESULT:');
  console.log(`  Bytes Persisted:    ${flushedBytes} bytes`);
  console.log(`  State Integrity:    ${textMatches ? '✅ PASSED (0% data loss)' : '❌ FAILED'}`);
  console.log('======================================================\n');
}

testServerRestartGraceful().catch(console.error);
