import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker, { parseSubscription, type Env, type KV } from './src/index.ts';

/** KV in memoria, con il conteggio delle scritture (su Cloudflare gratis sono 1.000 al giorno). */
function fakeKV() {
  const data = new Map<string, string>();
  const kv: KV & { data: Map<string, string>; writes: number } = {
    data,
    writes: 0,
    async get(key) {
      return data.get(key) ?? null;
    },
    async put(key, value) {
      kv.writes++;
      data.set(key, value);
    },
    async delete(key) {
      data.delete(key);
    },
    async list({ prefix = '' } = {}) {
      return { keys: [...data.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
  return kv;
}

const ORIGIN = 'https://davide-modena.github.io';
const sub = (n: number) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`,
  keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
});

function setup() {
  const kv = fakeKV();
  const env: Env = { SUBS: kv, ADMIN_TOKEN: 'segreto-admin', ALLOWED_ORIGINS: `${ORIGIN},http://localhost:4173` };
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    worker.fetch(
      new Request(`https://push.example.workers.dev${path}`, {
        method,
        headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
    );
  const admin = { Authorization: 'Bearer segreto-admin' };
  return { kv, call, admin };
}

test('registra un dispositivo e lo ritrova in elenco, in stato e dopo la pulizia', async () => {
  const { kv, call, admin } = setup();
  const res = await call('POST', '/subscribe', { subscription: sub(1) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(kv.data.size, 1);

  const status = await (await call('POST', '/status', { endpoint: sub(1).endpoint })).json();
  assert.deepEqual(status, { registered: true });
  const unknown = await (await call('POST', '/status', { endpoint: sub(2).endpoint })).json();
  assert.deepEqual(unknown, { registered: false });

  await call('POST', '/subscribe', { subscription: sub(2) });
  const list = await (await call('GET', '/subscriptions', undefined, admin)).json();
  assert.equal(list.subscriptions.length, 2);
  assert.deepEqual(list.subscriptions[0].keys, sub(1).keys);

  const pruned = await (await call('POST', '/prune', { endpoints: [sub(1).endpoint] }, admin)).json();
  assert.equal(pruned.removed, 1);
  assert.equal((await (await call('GET', '/subscriptions', undefined, admin)).json()).subscriptions.length, 1);
});

test('la stessa subscription non viene riscritta a ogni apertura dell\'app', async () => {
  const { kv, call } = setup();
  await call('POST', '/subscribe', { subscription: sub(1) });
  await call('POST', '/subscribe', { subscription: sub(1) });
  await call('POST', '/subscribe', { subscription: sub(1) });
  assert.equal(kv.writes, 1);

  // Dopo 21 ore invece viene rinnovata, e conserva la data di creazione.
  const key = [...kv.data.keys()][0];
  const old = JSON.parse(kv.data.get(key)!);
  old.updatedAt = new Date(Date.now() - 21 * 3600 * 1000).toISOString();
  kv.data.set(key, JSON.stringify(old));
  await call('POST', '/subscribe', { subscription: sub(1) });
  assert.equal(kv.writes, 2);
  assert.equal(JSON.parse(kv.data.get(key)!).createdAt, old.createdAt);
});

test('elenco e pulizia richiedono il token della pipeline', async () => {
  const { call } = setup();
  assert.equal((await call('GET', '/subscriptions')).status, 401);
  assert.equal((await call('GET', '/subscriptions', undefined, { Authorization: 'Bearer sbagliato' })).status, 401);
  assert.equal((await call('POST', '/prune', { endpoints: [] })).status, 401);
});

test('rifiuta subscription non valide o verso host che non sono servizi push', async () => {
  const { kv, call } = setup();
  const bad = [
    { endpoint: 'https://evil.example.com/x', keys: sub(1).keys },
    { endpoint: 'http://fcm.googleapis.com/fcm/send/x', keys: sub(1).keys },
    { endpoint: 'https://fcm.googleapis.com.evil.com/x', keys: sub(1).keys },
    { endpoint: sub(1).endpoint, keys: { p256dh: 'x', auth: 'y' } },
    { endpoint: sub(1).endpoint },
    'testo',
    null,
  ];
  for (const subscription of bad) {
    assert.equal((await call('POST', '/subscribe', { subscription })).status, 400, JSON.stringify(subscription));
  }
  assert.equal(kv.data.size, 0);
  assert.ok(parseSubscription(sub(1)));
  assert.ok(parseSubscription({ ...sub(1), endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/abc' }));
  assert.ok(parseSubscription({ ...sub(1), endpoint: 'https://web.push.apple.com/abc' }));
  assert.ok(parseSubscription({ ...sub(1), endpoint: 'https://wns2-par02p.notify.windows.com/?token=abc' }));
});

test('annulla la registrazione di un dispositivo', async () => {
  const { kv, call } = setup();
  await call('POST', '/subscribe', { subscription: sub(1) });
  await call('POST', '/unsubscribe', { endpoint: sub(1).endpoint });
  assert.equal(kv.data.size, 0);
});

test('CORS: risponde solo alle origini autorizzate e gestisce il preflight', async () => {
  const { call } = setup();
  const preflight = await call('OPTIONS', '/subscribe');
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const stranger = await call('POST', '/status', { endpoint: sub(1).endpoint }, { Origin: 'https://altro.example.com' });
  assert.equal(stranger.headers.get('Access-Control-Allow-Origin'), null);
});

test('rifiuta corpi enormi o non JSON, e percorsi sconosciuti', async () => {
  const { kv, call } = setup();
  const huge = await call('POST', '/subscribe', { subscription: sub(1), junk: 'x'.repeat(20_000) });
  assert.equal(huge.status, 400);
  const notJson = await worker.fetch(
    new Request('https://push.example.workers.dev/subscribe', { method: 'POST', body: 'non json' }),
    { SUBS: kv, ADMIN_TOKEN: 'x' },
  );
  assert.equal(notJson.status, 400);
  assert.equal((await call('GET', '/boh')).status, 404);
});
