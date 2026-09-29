/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { clientsClaim } from 'workbox-core';

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (PrecacheEntry | string)[] };

self.skipWaiting();
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Font self-hosted: non precaricati (sono tanti subset), messi in cache al primo uso.
registerRoute(({ request }) => request.destination === 'font', new CacheFirst({ cacheName: 'fonts' }));

// Le edizioni passate non cambiano mai; today/index/widget sì, quindi prima la rete.
registerRoute(({ url }) => url.pathname.includes('/api/editions/'), new CacheFirst({ cacheName: 'editions' }));
registerRoute(
  ({ url }) => url.pathname.includes('/api/'),
  new NetworkFirst({ cacheName: 'api', networkTimeoutSeconds: 4 }),
);

self.addEventListener('push', (event) => {
  const data = (event.data?.json() ?? {}) as { title?: string; body?: string; url?: string };
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title ?? 'Feed My Brain', {
        body: data.body,
        icon: 'icon-192.png',
        badge: 'icon-192.png',
        tag: 'daily-edition',
        data: { url: data.url ?? self.registration.scope },
      }),
      // Pallino sull'icona dell'app finché non leggi l'edizione.
      self.navigator.setAppBadge?.(1).catch(() => {}),
    ]),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url.startsWith(self.registration.scope));
      if (!open) return self.clients.openWindow(url);
      // Finestra già aperta (magari da ieri): la ricarica, così mostra l'edizione nuova.
      return open.focus().then((w) => w.navigate(url).catch(() => w));
    }),
  );
});
