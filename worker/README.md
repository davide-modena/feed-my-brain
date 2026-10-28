# Registro delle notifiche (Cloudflare Worker)

Un piccolo servizio gratuito che ricorda i dispositivi a cui mandare la notifica del mattino.

```
App (telefono)  ── "Attiva notifiche" ──►  Worker + KV  ◄── elenco ──  GitHub Actions
                                                                         │ invia le notifiche
                                                                         ▼ e rimuove i dispositivi scaduti
                                                                     telefoni
```

Ogni persona apre l'app, preme **Attiva notifiche** e basta: il dispositivo si registra da solo,
senza codici da copiare e senza toccare i secret di GitHub. Il worker non invia nulla e non ha chiavi
VAPID: invia solo la pipeline.

Costo: zero (piano gratuito di Cloudflare: 100.000 richieste e 1.000 scritture al giorno).

## Messa online (una tantum, circa 10 minuti)

Serve un account gratuito su [cloudflare.com](https://dash.cloudflare.com/sign-up).

```bash
cd worker

# 1. Accedi a Cloudflare (si apre il browser)
npx wrangler login

# 2. Crea l'archivio dei dispositivi e copia l'id che stampa dentro wrangler.toml (campo "id")
npx wrangler kv namespace create SUBS

# 3. Genera un token segreto e salvalo nel worker (incollalo quando lo chiede)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npx wrangler secret put ADMIN_TOKEN

# 4. Pubblica
npx wrangler deploy
```

L'ultimo comando stampa l'indirizzo del worker, tipo `https://feed-my-brain-push.<tuo-nome>.workers.dev`.

## Collegarlo a GitHub

Su GitHub, *Settings → Secrets and variables → Actions*:

| Dove | Nome | Valore |
|---|---|---|
| **Variables** | `PUSH_API_URL` | l'indirizzo del worker, senza `/` finale |
| **Secrets** | `PUSH_ADMIN_TOKEN` | lo stesso token del passo 3 |

Poi **Run workflow** una volta, così l'app viene ricompilata con l'indirizzo del worker. Da lì ogni
persona attiva le notifiche dalle impostazioni dell'app.

Il vecchio secret `PUSH_SUBSCRIPTION` si può cancellare: se c'è ancora viene letto, ma non serve più.

## API

| Richiesta | Chi può | Cosa fa |
|---|---|---|
| `POST /subscribe` `{ subscription }` | chiunque | registra o rinnova un dispositivo |
| `POST /unsubscribe` `{ endpoint }` | chiunque | rimuove un dispositivo |
| `POST /status` `{ endpoint }` | chiunque | `{ registered: true/false }` |
| `GET /subscriptions` | solo con token | elenco dei dispositivi |
| `POST /prune` `{ endpoints }` | solo con token | rimuove i dispositivi scaduti |

Accetta solo indirizzi di veri servizi push (Google, Mozilla, Apple, Microsoft) e solo richieste
dall'app. Un dispositivo che non riapre l'app per 180 giorni viene dimenticato.

## Prove

```bash
npm test
```
