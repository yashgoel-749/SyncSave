/** @jest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

type FetchEvent = { request: Request; respondWith: (value: Promise<Response>) => void; waitUntil: (value: Promise<unknown>) => void };

async function read(response: Promise<Response> | undefined) {
  if (!response) throw new Error('The asset request was not handled');
  return (await response).text();
}

function worker() {
  const handlers = new Map<string, (event: FetchEvent) => void>();
  const cache = { put: jest.fn().mockResolvedValue(undefined) };
  const caches = { match: jest.fn(), open: jest.fn().mockResolvedValue(cache) };
  const fetch = jest.fn();
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../../public/sw.js'), 'utf8'), {
    self: { addEventListener: (name: string, handler: (event: FetchEvent) => void) => handlers.set(name, handler) },
    URL, Response, caches, fetch,
  });
  const request = (url: string) => {
    let response: Promise<Response> | undefined;
    const work: Promise<unknown>[] = [];
    const handle = handlers.get('fetch');
    if (!handle) throw new Error('No fetch handler registered');
    handle({ request: new Request(url), respondWith: (value) => { response = value; }, waitUntil: (value) => work.push(value) });
    return { response, work };
  };
  return { request, caches, cache, fetch };
}

it('refreshes localhost development assets instead of returning stale cached code', async () => {
  const app = worker();
  app.caches.match.mockResolvedValue(new Response('old script'));
  app.fetch.mockResolvedValue(new Response('current script'));
  const result = app.request('http://localhost:3000/_next/static/chunks/app.js');
  expect(await read(result.response)).toBe('current script');
  await Promise.all(result.work);
  expect(app.cache.put).toHaveBeenCalled();
  expect(app.caches.match).not.toHaveBeenCalled();
});

it('keeps cached localhost assets available when offline', async () => {
  const app = worker();
  app.fetch.mockRejectedValue(new Error('offline'));
  app.caches.match.mockResolvedValue(new Response('offline script'));
  expect(await read(app.request('http://127.0.0.1:3000/_next/static/chunks/app.js').response)).toBe('offline script');
});

it('retains cache-first production assets and bypasses document APIs', async () => {
  const app = worker();
  app.caches.match.mockResolvedValue(new Response('immutable script'));
  expect(await read(app.request('https://syncspace.example/_next/static/chunks/hash.js').response)).toBe('immutable script');
  expect(app.fetch).not.toHaveBeenCalled();
  expect(app.request('http://localhost:3000/api/documents').response).toBeUndefined();
});
