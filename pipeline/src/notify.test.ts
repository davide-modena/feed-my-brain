import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { deliver, loadSubscriptions, type PushSub } from './notify.ts';

const sub = (n: number): PushSub => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`,
  keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('deliver: conta gli invii, separa le subscription scadute dagli errori', async () => {
  const subs = [sub(1), sub(2), sub(3), sub(4)];
  const result = await deliver(subs, 'x', async (s) => {
    if (s.endpoint.endsWith('2')) throw Object.assign(new Error('Gone'), { statusCode: 410 });
    if (s.endpoint.endsWith('3')) throw Object.assign(new Error('Non trovata'), { statusCode: 404 });
    if (s.endpoint.endsWith('4')) throw Object.assign(new Error('Server error'), { statusCode: 503 });
  });
  assert.equal(result.sent, 1);
  assert.deepEqual(result.gone, [sub(2).endpoint, sub(3).endpoint]);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].status, 503);
});

test('deliver: rispetta la concorrenza massima', async () => {
  let running = 0;
  let peak = 0;
  await deliver(Array.from({ length: 12 }, (_, i) => sub(i)), 'x', async () => {
    peak = Math.max(peak, ++running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
  }, 4);
  assert.equal(peak, 4);
});

test('loadSubscriptions: unisce worker e vecchio secret senza doppioni', async () => {
  let asked: { url: string; auth: string | null } | null = null;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    asked = { url, auth: new Headers(init.headers).get('Authorization') };
    return new Response(JSON.stringify({ subscriptions: [sub(1), sub(2), { endpoint: 'rotta' }] }), { status: 200 });
  }) as typeof fetch;
  const { subs, remote } = await loadSubscriptions({
    PUSH_API_URL: 'https://push.example.workers.dev/',
    PUSH_ADMIN_TOKEN: 'tok',
    PUSH_SUBSCRIPTION: JSON.stringify([sub(2), sub(3)]),
  });
  assert.equal(remote, true);
  assert.deepEqual(subs.map((s) => s.endpoint).sort(), [sub(1), sub(2), sub(3)].map((s) => s.endpoint));
  assert.deepEqual(asked, { url: 'https://push.example.workers.dev/subscriptions', auth: 'Bearer tok' });
});

test('loadSubscriptions: se il worker non risponde usa comunque il vecchio secret', async () => {
  globalThis.fetch = (async () => new Response('boom', { status: 500 })) as typeof fetch;
  const { subs, remote } = await loadSubscriptions({
    PUSH_API_URL: 'https://push.example.workers.dev',
    PUSH_ADMIN_TOKEN: 'tok',
    PUSH_SUBSCRIPTION: JSON.stringify(sub(9)),
  });
  assert.equal(remote, false);
  assert.equal(subs.length, 1);
});

test('loadSubscriptions: senza configurazione non restituisce nulla', async () => {
  const { subs, remote } = await loadSubscriptions({ PUSH_SUBSCRIPTION: 'non è json' });
  assert.deepEqual(subs, []);
  assert.equal(remote, false);
});
