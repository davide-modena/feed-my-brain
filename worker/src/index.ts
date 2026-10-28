/**
 * Registro delle subscription Web Push di Feed My Brain (Cloudflare Worker + KV).
 *
 * L'app registra qui il dispositivo; la pipeline (GitHub Actions) legge l'elenco, invia le
 * notifiche e rimuove quelle scadute. Invia solo la pipeline: qui non ci sono chiavi VAPID.
 *
 *   POST /subscribe     { subscription }   registra o aggiorna un dispositivo   (pubblico)
 *   POST /unsubscribe   { endpoint }       rimuove un dispositivo               (pubblico)
 *   POST /status        { endpoint }       { registered: boolean }              (pubblico)
 *   GET  /subscriptions                    elenco completo                      (ADMIN_TOKEN)
 *   POST /prune         { endpoints }      rimuove le subscription scadute      (ADMIN_TOKEN)
 */

/** Il minimo di KV che serve: così il worker si controlla e si prova senza i tipi di Cloudflare. */
export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; cursor?: string }): Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

export interface Env {
  SUBS: KV;
  /** Token della pipeline per leggere ed eliminare le subscription. */
  ADMIN_TOKEN: string;
  /** Origini autorizzate a chiamare il worker dal browser, separate da virgola. */
  ALLOWED_ORIGINS?: string;
}

interface StoredSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: string;
  updatedAt: string;
}

/** Solo servizi push veri: evita che qualcuno registri URL arbitrari verso cui la pipeline invierebbe. */
const PUSH_HOSTS = [
  /(^|\.)fcm\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /(^|\.)push\.apple\.com$/,
];

const PREFIX = 'sub:';
/** Una subscription non risentita da 180 giorni (l'app la rinnova ad ogni apertura) si considera abbandonata. */
const TTL_SECONDS = 180 * 24 * 3600;
/** Le riaperture dell'app non riscrivono la stessa subscription più di una volta ogni ~20 ore (KV ha 1.000 scritture al giorno). */
const REFRESH_AFTER_MS = 20 * 3600 * 1000;
const MAX_BODY_BYTES = 8 * 1024;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const keyFor = async (endpoint: string) => PREFIX + (await sha256Hex(endpoint));

/** Confronto a tempo costante (si confrontano gli hash, che hanno sempre la stessa lunghezza). */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(data: unknown, status: number, extra: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  });
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Controlla la forma di una PushSubscription e la restituisce pulita, oppure null. */
export function parseSubscription(input: unknown): { endpoint: string; keys: { p256dh: string; auth: string } } | null {
  const sub = input as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!sub || typeof sub.endpoint !== 'string' || sub.endpoint.length > 1024) return null;
  const { p256dh, auth } = sub.keys ?? {};
  if (typeof p256dh !== 'string' || typeof auth !== 'string') return null;
  if (p256dh.length < 20 || p256dh.length > 200 || auth.length < 8 || auth.length > 100) return null;
  let url: URL;
  try {
    url = new URL(sub.endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !PUSH_HOSTS.some((re) => re.test(url.hostname))) return null;
  return { endpoint: sub.endpoint, keys: { p256dh, auth } };
}

async function isAdmin(request: Request, env: Env): Promise<boolean> {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return !!env.ADMIN_TOKEN && token.length > 0 && (await sameSecret(token, env.ADMIN_TOKEN));
}

async function handle(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (request.method === 'GET' && pathname === '/') return json({ ok: true, service: 'feed-my-brain-push' }, 200, cors);

  if (request.method === 'POST' && pathname === '/subscribe') {
    const body = await readJson(request);
    const sub = parseSubscription(body?.subscription);
    if (!sub) return json({ error: 'subscription non valida' }, 400, cors);
    const key = await keyFor(sub.endpoint);
    const now = new Date();
    const existingRaw = await env.SUBS.get(key);
    let createdAt = now.toISOString();
    if (existingRaw) {
      const existing = JSON.parse(existingRaw) as StoredSubscription;
      createdAt = existing.createdAt;
      // Già registrata e aggiornata da poco: niente scrittura.
      if (now.getTime() - Date.parse(existing.updatedAt) < REFRESH_AFTER_MS) {
        return json({ ok: true, refreshed: false }, 200, cors);
      }
    }
    const record: StoredSubscription = { ...sub, createdAt, updatedAt: now.toISOString() };
    await env.SUBS.put(key, JSON.stringify(record), { expirationTtl: TTL_SECONDS });
    return json({ ok: true, refreshed: true }, 200, cors);
  }

  if (request.method === 'POST' && pathname === '/unsubscribe') {
    const body = await readJson(request);
    if (typeof body?.endpoint !== 'string') return json({ error: 'endpoint mancante' }, 400, cors);
    await env.SUBS.delete(await keyFor(body.endpoint));
    return json({ ok: true }, 200, cors);
  }

  if (request.method === 'POST' && pathname === '/status') {
    const body = await readJson(request);
    if (typeof body?.endpoint !== 'string') return json({ error: 'endpoint mancante' }, 400, cors);
    const found = await env.SUBS.get(await keyFor(body.endpoint));
    return json({ registered: found !== null }, 200, cors);
  }

  if (pathname === '/subscriptions' || pathname === '/prune') {
    if (!(await isAdmin(request, env))) return json({ error: 'non autorizzato' }, 401, cors);

    if (request.method === 'GET' && pathname === '/subscriptions') {
      const names: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await env.SUBS.list({ prefix: PREFIX, cursor });
        names.push(...page.keys.map((k) => k.name));
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      const values = await Promise.all(names.map((n) => env.SUBS.get(n)));
      const subscriptions = values
        .filter((v): v is string => v !== null)
        .map((v) => JSON.parse(v) as StoredSubscription)
        .map(({ endpoint, keys }) => ({ endpoint, keys }));
      return json({ subscriptions }, 200, cors);
    }

    if (request.method === 'POST' && pathname === '/prune') {
      const body = await readJson(request);
      const endpoints = Array.isArray(body?.endpoints) ? body.endpoints.filter((e) => typeof e === 'string') : [];
      await Promise.all(endpoints.map(async (e) => env.SUBS.delete(await keyFor(e))));
      return json({ removed: endpoints.length }, 200, cors);
    }
  }

  return json({ error: 'non trovato' }, 404, cors);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      return await handle(request, env, cors);
    } catch {
      return json({ error: 'errore interno' }, 500, cors);
    }
  },
};
