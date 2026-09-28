# Widget Android con KWGT

Il widget legge `api/widget.json` e mostra la data e i titoli dell'edizione del giorno. Quando lo tocchi, si apre la PWA.

```
┌──────────────────────────────────┐
│ FEED MY BRAIN · Nuova edizione    │
│                                  │
│ 📰 Trump e la Groenlandia: …      │
│ 📰 Caro benzina, cosa cambia      │
│ ⭐ Anthropic presenta …           │
│ ⭐ Il nuovo album di …            │
│ 📜 La strage alla stazione di …   │
│ 💡 Napoleone non era basso        │
└──────────────────────────────────┘
```

> Serve l'app **KWGT Kustom Widget Maker** dal Play Store. La versione gratuita basta per creare il widget.
> I nomi dei menu qui sotto sono quelli inglesi: se hai KWGT in italiano i nomi possono essere leggermente diversi.

## 1. Aggiungi il widget alla home

1. Tieni premuto sulla home → **Widget** → **KWGT** → scegli la taglia **4×2**.
2. Tocca il widget vuoto: si apre l'editor di KWGT.
3. Scegli **Create** (widget vuoto).

## 2. Variabile globale con l'URL

Tab **Globals** → **+** → **Text**:

- **Nome**: `api`
- **Valore**: `https://davide-modena.github.io/feed-my-brain/api/widget.json`

Così l'URL si scrive una volta sola e le formule restano corte.

## 3. Sfondo

Tab **Background**: trasparente.

Poi tab **Items** → **+** → **Shape**:

- Shape: **Rect**, Width/Height a riempimento (es. 400 × 200), **Corners** 8
- Color: `#FFFDF8` (marmo), bordo facoltativo `#E3DAC8`

## 4. Contenuto

Tab **Items** → **+** → **Stack Layout**, **Stack**: *Vertical*, padding 16. Dentro lo stack aggiungi questi tre **Text**. Per ognuno tocca il campo **Text** e incolla la formula così com'è.

**Intestazione** (size 11, colore `#777062`, font consigliato *Cinzel*):

```
FEED MY BRAIN · $if(wg(gv(api), json, ".date") = df("yyyy-MM-dd"), "Nuova edizione", wg(gv(api), json, ".dateLabel"))$
```

Se l'edizione è di oggi mostra "Nuova edizione", altrimenti la data dell'ultima disponibile.

**Titoli** (size 16, colore `#1F1C17`, font consigliato *Cormorant Garamond*, **Lines**: 6, **Spacing** ~1.3):

```
$wg(gv(api), json, ".text")$
```

**Piè di pagina** (facoltativo, size 11, colore `#A3472B`):

```
$wg(gv(api), json, ".count")$ card · tocca per leggere
```

**Immagine** (facoltativa): **+** → **Image** → campo **Bitmap** → formula `$wg(gv(api), json, ".imageUrl")$`. Mostra l'immagine della prima card.

## 5. Tocco → apre l'app

Seleziona lo **Stack Layout** (oppure la Shape di sfondo) → tab **Touch** → **+** → Action **Open Link** → incolla l'URL della PWA:

```
https://davide-modena.github.io/feed-my-brain/
```

Se la PWA è installata, Android apre direttamente l'app invece del browser.

## Font (facoltativo)

Per lo stesso stile della PWA scarica da Google Fonts **Cinzel** e **Cormorant Garamond** e mettili nella cartella `Kustom/fonts` del telefono. Poi selezionali nel campo **Font** di ogni testo.

## 6. Salva

Tocca l'icona **💾** in alto a destra.

## Campi disponibili in `widget.json`

| Formula | Esempio |
|---|---|
| `wg(gv(api), json, ".date")` | `2026-09-28` |
| `wg(gv(api), json, ".dateLabel")` | `lunedì 28 settembre` |
| `wg(gv(api), json, ".headline")` | titolo della prima card |
| `wg(gv(api), json, ".count")` | `6` |
| `wg(gv(api), json, ".text")` | tutti i titoli, uno per riga con emoji |
| `wg(gv(api), json, ".imageUrl")` | immagine della prima card |
| `wg(gv(api), json, ".cards[0].title")` | titolo di una singola card (0, 1, 2…) |
| `wg(gv(api), json, ".cards[0].emoji")` | 📰 ⭐ 📜 💡 |
| `wg(gv(api), json, ".cards[0].tag")` | `Mondo`, `Tech`, `2 agosto 1980`… |

## Problemi comuni

- **Il widget non si aggiorna al mattino.** KWGT tiene in cache i dati scaricati. In **Settings** di KWGT controlla l'intervallo di aggiornamento ed escludi KWGT dall'ottimizzazione batteria di Android.
- **Vedo `wg` o testo vuoto.** Verifica che l'URL nella variabile `api` si apra nel browser del telefono e mostri il JSON.
