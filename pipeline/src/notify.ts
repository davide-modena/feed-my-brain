import { appendFileSync } from 'node:fs';
import webpush from 'web-push';
import type { Edition } from '../../shared/types.ts';

const APP_URL = () => process.env.APP_URL || 'https://davide-modena.github.io/feed-my-brain/';

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function message(edition: Edition) {
  return {
    title: 'La tua edizione di oggi è pronta',
    body: edition.cards
      .slice(0, 3)
      .map((c) => `• ${c.title}`)
      .join('\n'),
    url: APP_URL(),
  };
}

const isSub = (v: unknown): v is PushSub => {
  const s = v as PushSub | null;
  return !!s && typeof s.endpoint === 'string' && typeof s.keys?.p256dh === 'string' && typeof s.keys?.auth === 'string';
};

/**
 * I dispositivi da avvisare: quelli registrati dall'app sul worker (PUSH_API_URL) più, per
 * compatibilità, quelli del vecchio secret PUSH_SUBSCRIPTION. Senza doppioni.
 */
export async function loadSubscriptions(env: NodeJS.ProcessEnv = process.env): Promise<{ subs: PushSub[]; remote: boolean }> {
  const byEndpoint = new Map<string, PushSub>();
  let remote = false;

  const api = env.PUSH_API_URL?.replace(/\/+$/, '');
  if (api && env.PUSH_ADMIN_TOKEN) {
    try {
      const res = await fetch(`${api}/subscriptions`, {
        headers: { Authorization: `Bearer ${env.PUSH_ADMIN_TOKEN}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { subscriptions?: unknown[] };
      for (const s of data.subscriptions ?? []) if (isSub(s)) byEndpoint.set(s.endpoint, s);
      remote = true;
    } catch (err) {
      console.warn(`⚠️  Elenco dispositivi non raggiungibile (${(err as Error).message}): controlla PUSH_API_URL e PUSH_ADMIN_TOKEN`);
    }
  }

  if (env.PUSH_SUBSCRIPTION) {
    try {
      const parsed = JSON.parse(env.PUSH_SUBSCRIPTION);
      for (const s of Array.isArray(parsed) ? parsed : [parsed]) if (isSub(s)) byEndpoint.set(s.endpoint, s);
    } catch {
      console.warn('⚠️  PUSH_SUBSCRIPTION non è un JSON valido: ignorato');
    }
  }
  return { subs: [...byEndpoint.values()], remote };
}

/** Il servizio push dice da che piattaforma arriva un dispositivo: utile per leggere i log. */
export function platformOf(endpoint: string): string {
  let host = '';
  try {
    host = new URL(endpoint).hostname;
  } catch {
    return 'sconosciuta';
  }
  if (host.endsWith('fcm.googleapis.com')) return 'Android/Chrome';
  if (host.endsWith('push.apple.com')) return 'iPhone/Safari';
  if (host.endsWith('push.services.mozilla.com')) return 'Firefox';
  if (host.endsWith('notify.windows.com')) return 'Windows/Edge';
  return host;
}

export interface DeliveryResult {
  sent: number;
  /** Subscription scadute o annullate (404/410): vanno rimosse dall'elenco. */
  gone: string[];
  failed: { endpoint: string; status?: number; message: string }[];
  /** Esito per piattaforma: quanti dispositivi, quanti avvisati, quanti scaduti, quanti in errore. */
  byPlatform: Record<string, { total: number; sent: number; gone: number; failed: number }>;
}

/** Invia a tutti i dispositivi, a gruppi, raccogliendo l'esito di ciascuno. */
export async function deliver(
  subs: PushSub[],
  payload: string,
  send: (sub: PushSub, payload: string) => Promise<unknown>,
  concurrency = 5,
): Promise<DeliveryResult> {
  const result: DeliveryResult = { sent: 0, gone: [], failed: [], byPlatform: {} };
  for (let i = 0; i < subs.length; i += concurrency) {
    await Promise.all(
      subs.slice(i, i + concurrency).map(async (sub) => {
        const platform = (result.byPlatform[platformOf(sub.endpoint)] ??= { total: 0, sent: 0, gone: 0, failed: 0 });
        platform.total++;
        try {
          await send(sub, payload);
          result.sent++;
          platform.sent++;
        } catch (err) {
          const { statusCode: status, body } = err as { statusCode?: number; body?: string };
          if (status === 404 || status === 410) {
            result.gone.push(sub.endpoint);
            platform.gone++;
          } else {
            // Il corpo della risposta spiega il perché (es. Apple: {"reason":"BadJwtToken"}).
            const detail = [(err as Error).message, body].filter(Boolean).join(' · ');
            result.failed.push({ endpoint: sub.endpoint, status, message: detail.replace(/\s+/g, ' ').slice(0, 200) });
            platform.failed++;
          }
        }
      }),
    );
  }
  return result;
}

const summary = (text: string) => {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
};

/** Web Push verso i dispositivi registrati. Se non arriva a nessuno il job fallisce: GitHub avvisa. */
async function sendWebPush(edition: Edition) {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.log('Web Push non configurato (mancano le chiavi VAPID)');
    return;
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'https://github.com/davide-modena/feed-my-brain',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  );

  const { subs, remote } = await loadSubscriptions();
  if (subs.length === 0) {
    console.warn('⚠️  Nessun dispositivo registrato: attiva le notifiche dalle impostazioni dell\'app');
    summary('### Notifiche\nNessun dispositivo registrato.');
    return;
  }

  const result = await deliver(subs, JSON.stringify(message(edition)), (sub, payload) =>
    // Urgenza alta: senza, Android in Doze può ritardare l'avviso di ore. Scade dopo 6 ore.
    webpush.sendNotification(sub, payload, { TTL: 6 * 3600, urgency: 'high', topic: 'daily-edition' }),
  );

  if (result.gone.length > 0 && remote) {
    try {
      await fetch(`${process.env.PUSH_API_URL!.replace(/\/+$/, '')}/prune`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.PUSH_ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoints: result.gone }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      console.warn(`⚠️  Pulizia dei dispositivi scaduti fallita: ${(err as Error).message}`);
    }
  }

  const line = `${result.sent}/${subs.length} avvisi inviati, ${result.gone.length} dispositivi scaduti rimossi, ${result.failed.length} errori`;
  console.log(`🔔 Web Push: ${line}`);
  const table = [
    '| Piattaforma | Registrati | Avvisati | Scaduti | Errori |',
    '|---|---|---|---|---|',
    ...Object.entries(result.byPlatform).map(([name, p]) => `| ${name} | ${p.total} | ${p.sent} | ${p.gone} | ${p.failed} |`),
  ].join('\n');
  console.log(table);
  for (const f of result.failed) console.warn(`   ⚠️  ${platformOf(f.endpoint)}: ${f.status ?? ''} ${f.message}`);
  summary(`### Notifiche\nWeb Push: ${line}.\n\n${table}`);

  if (result.sent === 0) {
    console.error('❌ Nessun avviso consegnato: riattiva le notifiche dall\'app (impostazioni → Notifiche)');
    process.exitCode = 1;
  }
  // Un errore 4xx (tranne 429) non passa da solo: il job diventa rosso e GitHub avvisa.
  // Gli errori 5xx e 429 sono passeggeri e non fanno fallire il job.
  const permanent = result.failed.filter((f) => f.status && f.status >= 400 && f.status < 500 && f.status !== 429);
  if (permanent.length > 0) {
    console.error(`❌ ${permanent.length} dispositivi rifiutati dal servizio push: vedi i dettagli sopra`);
    process.exitCode = 1;
  }
}

/** Notifica via ntfy.sh: basta installare l'app ntfy e iscriversi al topic. */
async function sendNtfy(edition: Edition) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  const msg = message(edition);
  const res = await fetch(process.env.NTFY_SERVER || 'https://ntfy.sh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, title: msg.title, message: msg.body, click: msg.url, tags: ['classical_building'] }),
  });
  console.log(res.ok ? '🔔 Notifica ntfy inviata' : `⚠️  ntfy ha risposto ${res.status}`);
}

export async function notify(edition: Edition) {
  await Promise.all([sendWebPush(edition), sendNtfy(edition)]);
}
