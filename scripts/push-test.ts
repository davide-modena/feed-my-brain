/**
 * Invia SUBITO una notifica di prova vera (stesso percorso della pipeline: worker → servizio push)
 * a tutti i dispositivi registrati e stampa l'esito di ciascuno. Serve a capire dove si perde un
 * avviso senza aspettare l'edizione del mattino.
 *
 * Richiede nel .env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_API_URL, PUSH_ADMIN_TOKEN.
 */
import webpush from 'web-push';
import { deliver, loadSubscriptions, platformOf } from '../pipeline/src/notify.ts';

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !process.env.PUSH_API_URL || !process.env.PUSH_ADMIN_TOKEN) {
  console.error('Servono nel .env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_API_URL, PUSH_ADMIN_TOKEN');
  process.exit(1);
}
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'https://github.com/davide-modena/feed-my-brain',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
);

const { subs } = await loadSubscriptions();
console.log(`Dispositivi registrati: ${subs.length}`);
for (const s of subs) console.log(`  - ${platformOf(s.endpoint)} (…${s.endpoint.slice(-12)})`);

const payload = JSON.stringify({
  title: 'Prova dal server',
  body: `Se la vedi, il percorso vero funziona (${new Date().toLocaleTimeString('it-IT')}).`,
  url: process.env.APP_URL || 'https://davide-modena.github.io/feed-my-brain/',
});
const statuses = new Map<string, number>();
const result = await deliver(subs, payload, async (sub, body) => {
  const res = await webpush.sendNotification(sub, body, { TTL: 6 * 3600, urgency: 'high' });
  statuses.set(sub.endpoint, res.statusCode);
});

console.log('\nEsito:');
for (const s of subs) {
  const fail = result.failed.find((f) => f.endpoint === s.endpoint);
  const gone = result.gone.includes(s.endpoint);
  const outcome = fail
    ? `ERRORE ${fail.status ?? ''} ${fail.message}`
    : gone
      ? 'SCADUTO (410/404): il dispositivo va riattivato'
      : `accettato dal servizio push (HTTP ${statuses.get(s.endpoint)})`;
  console.log(`  - ${platformOf(s.endpoint)} (…${s.endpoint.slice(-12)}): ${outcome}`);
}
