# 🧠 Feed My Brain

Una piccola edizione quotidiana per imparare qualcosa ogni giorno: attualità, gli argomenti che segui, un fatto storico accaduto oggi e una curiosità. Le card si sfogliano con uno swipe, senza scorrere; alla fine un quiz veloce su tutto quello che hai letto.

```
GitHub Actions (ogni mattina)
  └─ feed RSS + Google News + Wikipedia ─→ Mistral / Hugging Face (sceglie, riscrive, fa i quiz)
       └─ data/editions/YYYY-MM-DD.json ─→ GitHub Pages
                                             ├─ PWA (telefono + PC)
                                             ├─ api/today.json, api/widget.json …
                                             └─ notifica push / ntfy
```

## Struttura

| Percorso | Cosa contiene |
|---|---|
| `pipeline/config.yaml` | **Fonti, catalogo degli argomenti, temi storici, composizione dell'edizione** |
| `pipeline/src/` | Raccolta notizie, Wikipedia, prompt per Mistral, notifiche |
| `app/` | PWA (Preact + Vite + service worker) |
| `data/editions/` | Archivio delle edizioni generate (committato dal workflow) |
| `shared/types.ts` | Formato dei dati condiviso tra pipeline, app e API |

## In locale

```bash
npm install
cp .env.example .env        # inserisci MISTRAL_API_KEY e/o HF_TOKEN
npm run pipeline:dry        # prova le fonti senza chiamare l'AI
npm run pipeline            # genera l'edizione di oggi
npm run dev                 # apri la PWA su http://localhost:5173
```

Senza edizioni in `data/editions/` l'app mostra `data/sample-edition.json`.

## Messa online (una tantum)

1. Il repo deve essere **pubblico** (GitHub Pages gratuito).
2. *Settings → Pages → Source*: **GitHub Actions**.
3. *Settings → Secrets and variables → Actions*:
   - Secret `MISTRAL_API_KEY`
   - Secret `HF_TOKEN`: fallback su Hugging Face quando Mistral esaurisce i limiti ([crea un token](https://huggingface.co/settings/tokens) con il permesso *Make calls to Inference Providers*)
   - (facoltative) Variables `MISTRAL_MODEL` (default `mistral-medium-latest`) e `HF_MODEL` (default `meta-llama/Llama-3.3-70B-Instruct`)
4. *Actions → Edizione quotidiana → Run workflow* per la prima edizione. Poi parte da solo ogni mattina.

L'app sarà su `https://<utente>.github.io/feed-my-brain/`.

## Argomenti

Il catalogo degli argomenti (Tech e AI, Hip hop, Scienza, Economia, Cinema, Sport…) sta in `pipeline/config.yaml`, sotto `topics`. Ogni giorno la pipeline scrive una card per argomento. Nell'app ognuno sceglie quali seguire, al primo avvio o dalle impostazioni, e la scelta resta salvata sul dispositivo.

Per aggiungere un argomento basta una nuova voce con `id`, `label`, `description` e alcune `queries` (ricerche su Bing News) o `feeds` RSS. Ogni argomento in più aggiunge una chiamata all'LLM al giorno.

## Notifiche

**Opzione A: Web Push (notifica nativa della PWA)**

1. `npm run vapid` e salva le chiavi: Variable `VAPID_PUBLIC_KEY`, Secret `VAPID_PRIVATE_KEY`.
2. Rilancia il workflow, così la PWA viene ricompilata con la chiave pubblica.
3. Installa la PWA sul telefono (su iPhone: Condividi → Aggiungi a Home), apri ⚙︎ → **Attiva notifiche** → **Copia codice**.
4. Incolla il codice nel Secret `PUSH_SUBSCRIPTION`. Per più dispositivi usa un array JSON: `[{...}, {...}]`.

Quando arriva la notifica, sull'icona dell'app compare anche un pallino, che sparisce quando finisci l'edizione.

**Opzione B: ntfy (più semplice)**

Installa l'app [ntfy](https://ntfy.sh), iscriviti a un topic con un nome difficile da indovinare e salvalo nel Secret `NTFY_TOPIC`.

## API

File JSON statici, utilizzabili da widget, estensioni e script:

| Endpoint | Contenuto |
|---|---|
| `api/today.json` | Ultima edizione completa |
| `api/widget.json` | Versione compatta: data, titoli e categorie |
| `api/index.json` | Date disponibili |
| `api/editions/YYYY-MM-DD.json` | Archivio |

## Widget Android

Guida passo passo per il widget con KWGT: [docs/widget-kwgt.md](docs/widget-kwgt.md).
