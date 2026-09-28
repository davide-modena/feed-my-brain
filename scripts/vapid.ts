/** Genera la coppia di chiavi VAPID per le notifiche Web Push. */
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`Aggiungi su GitHub (Settings → Secrets and variables → Actions):

  Variable  VAPID_PUBLIC_KEY  = ${publicKey}
  Secret    VAPID_PRIVATE_KEY = ${privateKey}

e in locale nel file .env:

VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VITE_VAPID_PUBLIC_KEY=${publicKey}
`);
