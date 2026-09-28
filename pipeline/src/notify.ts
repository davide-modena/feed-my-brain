import webpush from 'web-push';
import type { Edition } from '../../shared/types.ts';

const APP_URL = () => process.env.APP_URL || 'https://davide-modena.github.io/feed-my-brain/';

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

/** Web Push verso la PWA (serve una subscription copiata dalle impostazioni dell'app). */
async function sendWebPush(edition: Edition) {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_SUBSCRIPTION } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !PUSH_SUBSCRIPTION) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'https://github.com/davide-modena/feed-my-brain',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  );
  // Si possono registrare più dispositivi: un oggetto o un array di subscription.
  const parsed = JSON.parse(PUSH_SUBSCRIPTION);
  const subscriptions: webpush.PushSubscription[] = Array.isArray(parsed) ? parsed : [parsed];
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(message(edition)));
      console.log('🔔 Web Push inviata');
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      console.warn(
        status === 404 || status === 410
          ? '⚠️  Subscription push scaduta: riattiva le notifiche nell\'app e aggiorna il secret PUSH_SUBSCRIPTION'
          : `⚠️  Web Push fallita: ${(err as Error).message}`,
      );
    }
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
