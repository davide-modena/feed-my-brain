const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const pushConfigured = () => !!VAPID_PUBLIC_KEY;

function base64ToBytes(base64: string) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** Chiede il permesso e crea la subscription da salvare nel secret PUSH_SUBSCRIPTION. */
export async function subscribe(): Promise<PushSubscription> {
  if (!VAPID_PUBLIC_KEY) throw new Error('Manca VITE_VAPID_PUBLIC_KEY: genera le chiavi con `npm run vapid`.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Permesso per le notifiche negato.');
  const reg = await navigator.serviceWorker.ready;
  return (
    (await reg.pushManager.getSubscription()) ??
    reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(VAPID_PUBLIC_KEY) })
  );
}

export async function testNotification() {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('🧠 Notifica di prova', { body: 'Le notifiche funzionano!', icon: 'icon-192.png' });
}
