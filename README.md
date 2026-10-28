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
| `worker/` | Registro dei dispositivi per le notifiche (Cloudflare Worker, gratuito) |
| `data/editions/` | Archivio delle edizioni generate (committato dal workflow) |
| `shared/types.ts` | Formato dei dati condiviso tra pipeline, app e API |

## In locale

```bash
npm install
cp .env.example .env        # inserisci MISTRAL_API_KEY e/o HF_TOKEN
npm run llm:check           # verifica quali chiavi LLM funzionano
npm run pipeline:dry        # prova le fonti senza chiamare l'AI
npm run pipeline            # genera l'edizione di oggi
npm run dev                 # apri la PWA su http://localhost:5173
```

Senza edizioni in `data/editions/` l'app mostra `data/sample-edition.json`.

## Messa online (una tantum)

1. Il repo deve essere **pubblico** (GitHub Pages gratuito).
2. *Settings → Pages → Source*: **GitHub Actions**.
3. *Settings → Secrets and variables → Actions*:
   - almeno una chiave LLM come Secret. Più ne metti, più la pipeline regge i limiti dei piani gratuiti, perché passa da un provider all'altro:
     - `MISTRAL_API_KEY` ([console Mistral](https://console.mistral.ai))
     - `NVIDIA_API_KEY` ([build.nvidia.com](https://build.nvidia.com))
     - `OPENROUTER_API_KEY` ([OpenRouter](https://openrouter.ai/keys), modelli gratuiti `:free`)
     - `GEMINI_API_KEY` ([Google AI Studio](https://aistudio.google.com/apikey))
     - `GROQ_API_KEY` ([console Groq](https://console.groq.com/keys))
     - `HF_TOKEN` ([token Hugging Face](https://huggingface.co/settings/tokens) con il permesso *Make calls to Inference Providers*)
     - `LLM_API_KEY` + Variables `LLM_BASE_URL` e `LLM_MODEL`: qualsiasi endpoint compatibile OpenAI (OpenRouter, OmniRoute esposto in rete…)
   - (facoltative) Variables `MISTRAL_MODEL`, `NVIDIA_MODEL`, `OPENROUTER_MODEL`, `GEMINI_MODEL`, `GROQ_MODEL`, `HF_MODEL` per cambiare modello
4. *Actions → Edizione quotidiana → Run workflow* per la prima edizione. Poi parte da solo ogni mattina.

L'app sarà su `https://<utente>.github.io/feed-my-brain/`.

## Argomenti

Il catalogo degli argomenti (Tech e AI, Hip hop, Scienza, Economia, Cinema, Sport…) sta in `pipeline/config.yaml`, sotto `topics`.

Ogni giorno la pipeline genera una card per sezione: Mondo, Italia, ogni argomento, Accadde oggi e Curiosità (vedi `edition` in `config.yaml`). Nell'app ognuno sceglie, al primo avvio o dalle impostazioni, quali argomenti seguire e se vedere "Accadde oggi" e le curiosità storiche. La scelta resta salvata sul dispositivo. Il numero di card per sezione non è modificabile dall'utente: lo decide `config.yaml`.

Per aggiungere un argomento basta una nuova voce con `id`, `label`, `description` e alcune `queries` (ricerche su Bing News) o `feeds` RSS. Descrizioni e query devono restare **generiche**: un nome proprio (un'azienda, un artista) diventerebbe il protagonista fisso di ogni edizione. Ogni argomento in più costa una card e qualche chiamata all'LLM al giorno.

Le curiosità storiche vengono pescate a caso tra le voci "in vetrina" e "di qualità" di Wikipedia italiana delle aree elencate in `curiosities.areas` (storia, biografie, arte…), così epoche e luoghi variano da soli.

## Notifiche

**Opzione A: Web Push (notifica nativa della PWA)**

Ogni persona preme **Attiva notifiche** nelle impostazioni dell'app e il suo dispositivo si registra da solo, senza codici da copiare. Serve un registro dei dispositivi, un piccolo servizio gratuito su Cloudflare: guida in [worker/README.md](worker/README.md).

1. `npm run vapid` e salva le chiavi: Variable `VAPID_PUBLIC_KEY`, Secret `VAPID_PRIVATE_KEY`.
2. Pubblica il registro (vedi [worker/README.md](worker/README.md)) e salva su GitHub la Variable `PUSH_API_URL` e il Secret `PUSH_ADMIN_TOKEN`.
3. **Run workflow** una volta, così l'app viene ricompilata con l'indirizzo del registro.
4. Sul telefono: installa la PWA (su iPhone: Condividi → Aggiungi a Home), apri ☰ → **Attiva notifiche**.

L'app riconferma la registrazione ad ogni apertura, quindi si ripara da sola se il browser rinnova la subscription o se reinstalli l'app. La pipeline manda le notifiche con priorità alta, rimuove i dispositivi scaduti e, se non arriva a nessuno, fa fallire il job *notify* (GitHub ti avvisa); il dettaglio è nel riepilogo del run.

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
