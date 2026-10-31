import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { deliver, loadSubscriptions, platformOf, type PushSub } from './notify.ts';

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

test('platformOf: riconosce la piattaforma dal servizio push', () => {
  assert.equal(platformOf('https://fcm.googleapis.com/fcm/send/abc'), 'Android/Chrome');
  assert.equal(platformOf('https://web.push.apple.com/QAbc'), 'iPhone/Safari');
  assert.equal(platformOf('https://updates.push.services.mozilla.com/wpush/v2/x'), 'Firefox');
  assert.equal(platformOf('https://wns2-par02p.notify.windows.com/?token=x'), 'Windows/Edge');
  assert.equal(platformOf('non è un url'), 'sconosciuta');
});

test("deliver: raggruppa per piattaforma e riporta il corpo dell'errore", async () => {
  const iphone: PushSub = { ...sub(2), endpoint: 'https://web.push.apple.com/QToken' };
  const old: PushSub = { ...sub(3), endpoint: 'https://web.push.apple.com/QVecchio' };
  const result = await deliver([sub(1), iphone, old], 'x', async (s) => {
    if (s.endpoint.endsWith('QToken')) {
      throw Object.assign(new Error('Received unexpected response code'), { statusCode: 403, body: '{"reason":"BadJwtToken"}' });
    }
    if (s.endpoint.endsWith('QVecchio')) throw Object.assign(new Error('Gone'), { statusCode: 410 });
  });
  assert.deepEqual(result.byPlatform, {
    'Android/Chrome': { total: 1, sent: 1, gone: 0, failed: 0 },
    'iPhone/Safari': { total: 2, sent: 0, gone: 1, failed: 1 },
  });
  assert.match(result.failed[0].message, /BadJwtToken/);
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
