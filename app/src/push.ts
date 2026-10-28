const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
/** Registro dei dispositivi (Cloudflare Worker, vedi worker/). */
const PUSH_API_URL = (import.meta.env.VITE_PUSH_API_URL as string | undefined)?.replace(/\/+$/, '');

const SYNC_KEY = 'feed-my-brain:push-sync';
/** Quanto spesso l'app riconferma la registrazione al server (ne basta una al giorno). */
const SYNC_EVERY_MS = 6 * 3600 * 1000;

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const pushConfigured = () => !!VAPID_PUBLIC_KEY && !!PUSH_API_URL;

function base64ToBytes(base64: string) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${PUSH_API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Il server ha risposto ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** La subscription del dispositivo, creandola se serve (richiede il permesso già dato o lo chiede). */
async function ensureSubscription(askPermission: boolean): Promise<PushSubscription | null> {
  if (!VAPID_PUBLIC_KEY) throw new Error('Notifiche non configurate: manca la chiave pubblica.');
  if (Notification.permission === 'default' && askPermission) await Notification.requestPermission();
  if (Notification.permission !== 'granted') return null;
  const reg = await navigator.serviceWorker.ready;
  return (
    (await reg.pushManager.getSubscription()) ??
    reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(VAPID_PUBLIC_KEY) })
  );
}

/** Attiva le notifiche su questo dispositivo e lo registra sul server: niente da copiare. */
export async function enablePush() {
  if (!pushConfigured()) throw new Error('Le notifiche non sono ancora configurate sul server.');
  const sub = await ensureSubscription(true);
  if (!sub) throw new Error('Permesso per le notifiche negato: abilitalo dalle impostazioni del telefono.');
  try {
    await post('/subscribe', { subscription: sub.toJSON() });
  } catch (err) {
    // Senza registrazione sul server le notifiche non arriverebbero mai: meglio dirlo subito.
    throw new Error(`Registrazione non riuscita (${(err as Error).message}). Riprova tra poco.`);
  }
  localStorage.setItem(SYNC_KEY, String(Date.now()));
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  try {
    if (PUSH_API_URL) await post('/unsubscribe', { endpoint });
  } catch {
    // Se il server non risponde, la pipeline toglierà da sola la subscription annullata (errore 410).
  }
  localStorage.removeItem(SYNC_KEY);
}

/** Il server conosce questo dispositivo? (per mostrare lo stato reale, non solo il permesso) */
export async function isRegistered(): Promise<boolean> {
  if (!pushConfigured()) return false;
  const sub = await currentSubscription();
  if (!sub) return false;
  return (await post('/status', { endpoint: sub.endpoint })).registered === true;
}

/**
 * Ad ogni apertura, se le notifiche erano già attive, ricontrolla e ririgistra il dispositivo.
 * Ripara da sola i casi in cui prima si perdevano gli avvisi: subscription rinnovata dal browser,
 * app reinstallata con il permesso ancora valido, registrazione mai arrivata al server.
 */
export async function syncPush() {
  if (!pushSupported() || !pushConfigured() || Notification.permission !== 'granted') return;
  const last = Number(localStorage.getItem(SYNC_KEY) ?? 0);
  if (Date.now() - last < SYNC_EVERY_MS) return;
  const sub = await ensureSubscription(false);
  if (!sub) return;
  await post('/subscribe', { subscription: sub.toJSON() });
  localStorage.setItem(SYNC_KEY, String(Date.now()));
}

export async function testNotification() {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('Notifica di prova', { body: 'Le notifiche funzionano.', icon: 'icon-192.png' });
}
