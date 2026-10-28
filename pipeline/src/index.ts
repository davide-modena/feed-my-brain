/**
 * Genera l'edizione del giorno: raccoglie notizie e storia, le fa scegliere e riscrivere
 * all'LLM (Mistral, con fallback su Hugging Face), salva data/editions/YYYY-MM-DD.json e invia le notifiche.
 *
 * Flag:
 *   --dry     solo raccolta delle fonti, senza chiamare l'AI né scrivere file
 *   --force   rigenera anche se l'edizione di oggi esiste già
 *   --no-notify
 */
import { appendFileSync, existsSync } from 'node:fs';
import type { Card, Edition } from '../../shared/types.ts';
import { loadConfig } from './config.ts';
import {
  GOOD_MATERIAL,
  MIN_MATERIAL,
  materialSize,
  pickCuriosity,
  pickHistoryEvent,
  selectNews,
  selectTopic,
  setEditionDate,
  writeNewsCard,
  writeWikiCard,
  type StoryPick,
} from './editor.ts';
import { activeProvider, llmUsage } from './llm.ts';
import { collectNews, fetchArticle, type Article } from './news.ts';
import { notify } from './notify.ts';
import { editionPath, pastCuriosityTags, recentCards, recentSourceLinks, writeEdition } from './store.ts';
import { pickRandom, romeDate, sleep } from './util.ts';
import { featuredArticles, onThisDay, pageExtract, type HistoryEvent } from './wikipedia.ts';

type DraftCard = Omit<Card, 'id'>;

const args = new Set(process.argv.slice(2));
const dry = args.has('--dry');
const date = romeDate();
setEditionDate(date);
const config = loadConfig();

if (!dry && !args.has('--force') && existsSync(editionPath(date))) {
  console.log(`✅ Edizione ${date} già presente (usa --force per rigenerarla)`);
  process.exit(0);
}

console.log(`🗞️  Raccolta fonti per il ${date}…`);
const [allItems, events] = await Promise.all([
  collectNews(config),
  onThisDay(date).catch((err): HistoryEvent[] => {
    console.warn(`⚠️  Wikipedia "accadde oggi" non disponibile: ${(err as Error).message}`);
    return [];
  }),
]);
// Gli articoli già usati come fonte nei giorni scorsi non tornano: niente notizie ripetute.
const usedLinks = recentSourceLinks();
const items = allItems.filter((i) => !usedLinks.has(i.link));
if (allItems.length > items.length) console.log(`   esclusi ${allItems.length - items.length} articoli già usati`);
const groups = Object.groupBy(items, (i) => i.group);
for (const [group, list] of Object.entries(groups)) console.log(`   ${group}: ${list?.length ?? 0} articoli`);
console.log(`   storia: ${events.length} eventi`);

if (dry) {
  for (const i of items.slice(0, 10)) console.log(`   [${i.group}] ${i.source}: ${i.title}`);
  process.exit(0);
}

console.log(`🤖 LLM: ${activeProvider()}`);
const recentList = recentCards();
const recent = recentList.map((c) => c.title);
const CURIOSITY_CANDIDATES = 60;
let curiosityPool: string[] | null = null;
// Voci già raccontate nei giorni scorsi (il tag delle curiosità è il titolo della voce) e oggi.
// Voci già raccontate in TUTTE le edizioni passate (il tag delle curiosità è il titolo della voce),
// dalla più vecchia alla più recente: la finestra di 7 giorni dei titoli recenti non basta, una
// curiosità tornava dopo 8-10 giorni.
const pastCuriosities = [...new Set(pastCuriosityTags())];
const usedArticles = new Set(pastCuriosities);
let poolRecycled = false;
const usedEvents = new Set<string>();
const quizCount = config.edition.quizPerCard;
const written = (list: DraftCard[][]) => list.flat().map((c) => c.title);

// --- Selezione e materiale, sezione per sezione --------------------------------------------
// Una richiesta piccola per sezione, fatta subito prima di scriverla: un unico prompt con tutto
// supererebbe i limiti di token al minuto dei piani gratuiti, e un errore farebbe saltare tutto.

const articles = new Map<string, Article>();

/** Scarica testo e immagine degli articoli dei candidati (solo quelli non ancora scaricati). */
async function loadArticles(stories: StoryPick[]) {
  const links = [...new Set(stories.flatMap((c) => c.items.slice(0, 3).map((i) => i.link)))].filter(
    (link) => !articles.has(link),
  );
  await Promise.all(links.map(async (link) => articles.set(link, await fetchArticle(link))));
}

// Mondo e Italia escono dalla stessa richiesta; se fallisce, la sezione successiva riprova.
let newsSelection: ReturnType<typeof selectNews> | null = null;
function selectNewsOnce() {
  if (!newsSelection) {
    console.log('🧑‍💼 Selezione attualità…');
    newsSelection = selectNews(config, items, recent).catch((err) => {
      newsSelection = null;
      throw err;
    });
  }
  return newsSelection;
}

// --- Sezioni ------------------------------------------------------------------------------

interface Section {
  key: string;
  label: string;
  want: number;
  /** Scrive la prossima card della sezione; null se non c'è niente di buono da raccontare. */
  next: () => Promise<DraftCard | null>;
  cards: DraftCard[];
  notes: string[];
  /** L'ultimo tentativo è fallito per un errore (limiti dell'LLM, risposta malformata…): vale la pena riprovare. */
  failed?: boolean;
}

/**
 * Sezione di notizie: sceglie i candidati alla prima card, poi li scorre in ordine
 * (prima quelli con materiale pieno, poi il migliore disponibile).
 */
function newsSection(
  key: string,
  label: string,
  want: number,
  select: () => Promise<StoryPick[]>,
  topic?: string,
): Section {
  let queue: StoryPick[] | null = null;
  const section: Section = {
    key,
    label,
    want,
    cards: [],
    notes: [],
    async next() {
      if (!queue) {
        const candidates = await select(); // se fallisce, queue resta null e il giro dopo riprova
        await loadArticles(candidates);
        queue = [...candidates];
      }
      if (queue.length === 0) {
        section.notes.push('nessuna storia candidata');
        return null;
      }
      const good = queue.findIndex((s) => materialSize(s, articles) >= GOOD_MATERIAL);
      let index = good;
      if (index === -1) {
        // Nessuna storia con testo pieno: meglio una card breve sulla più documentata che niente.
        const sizes = queue.map((s) => materialSize(s, articles));
        index = sizes.indexOf(Math.max(...sizes));
        if (sizes[index] < MIN_MATERIAL) {
          section.notes.push('solo titoli, nessun testo su cui scrivere');
          queue.length = 0;
          return null;
        }
      }
      const [story] = queue.splice(index, 1);
      console.log(`✍️  [${label}] ${story.title}`);
      const card = await writeNewsCard(story, topic ? 'interessi' : 'attualita', articles, quizCount);
      return topic ? { ...card, topic } : card;
    },
  };
  return section;
}

const day = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
  new Date(`${date}T12:00:00Z`),
);

const sections: Section[] = [
  newsSection('mondo', 'Mondo', config.edition.mondo, async () => (await selectNewsOnce()).mondo),
  newsSection('italia', 'Italia', config.edition.italia, async () => (await selectNewsOnce()).italia),
  ...config.topics.map((t) =>
    newsSection(
      t.id,
      t.label,
      config.edition.perTopic,
      () => {
        console.log(`🧑‍💼 Selezione ${t.label}…`);
        return selectTopic(t, config.edition.perTopic, items, [...recent, ...written(sections.map((s) => s.cards))]);
      },
      t.id,
    ),
  ),
  {
    key: 'storia',
    label: 'Accadde oggi',
    want: config.edition.storia,
    cards: [],
    notes: [],
    async next() {
      const pick = await pickHistoryEvent(events, [...recent, ...written(sections.map((s) => s.cards))], usedEvents);
      if (!pick) return null;
      usedEvents.add(pick.event.text);
      const article = await pageExtract(pick.page);
      if (!article) throw new Error(`voce "${pick.page}" non trovata`);
      console.log(`📜 ${pick.event.year}: ${pick.page}`);
      return writeWikiCard(
        article,
        'storia',
        `${day} ${pick.event.year}`,
        `Racconta questo evento accaduto il ${day} ${pick.event.year}: "${pick.event.text}". Nel titolo non serve la data. Nel context spiega cosa ha cambiato e cosa ha lasciato in eredità.`,
        quizCount,
      );
    },
  },
  {
    key: 'curiosita',
    label: 'Curiosità',
    want: config.edition.curiosita,
    cards: [],
    notes: [],
    async next() {
      curiosityPool ??= await featuredArticles(config.curiosities.areas);
      let fresh = curiosityPool.filter((t) => !usedArticles.has(t));
      // Bacino quasi esaurito: si "dimenticano" le voci raccontate più tempo fa, così si riparte
      // dalle più vecchie e una stessa voce non torna mai a distanza di pochi giorni.
      if (fresh.length < CURIOSITY_CANDIDATES && !poolRecycled) {
        poolRecycled = true;
        for (const t of pastCuriosities.slice(0, Math.ceil(pastCuriosities.length / 2))) usedArticles.delete(t);
        fresh = curiosityPool.filter((t) => !usedArticles.has(t));
        console.log(`♻️  Bacino curiosità quasi esaurito: riammesse ${fresh.length} voci tra le più vecchie`);
      }
      // Estrazione casuale dal bacino: è questo, non il modello, a garantire la varietà.
      let article: Awaited<ReturnType<typeof pageExtract>> = null;
      let page = '';
      // Un redirect può far comparire la voce con un altro titolo: se è già stata usata, si riprova.
      for (let attempt = 0; attempt < 3 && fresh.length > 0; attempt++) {
        const candidates = pickRandom(fresh, CURIOSITY_CANDIDATES);
        page = await pickCuriosity(candidates, [...recent, ...written(sections.map((s) => s.cards))]);
        usedArticles.add(page);
        fresh = fresh.filter((t) => t !== page);
        const extract = await pageExtract(page);
        if (!extract) throw new Error(`voce "${page}" non trovata`);
        if (usedArticles.has(extract.title) && extract.title !== page) continue;
        usedArticles.add(extract.title);
        article = extract;
        break;
      }
      if (!article) return null;
      console.log(`💡 ${article.title}`);
      return writeWikiCard(
        article,
        'curiosita',
        article.title,
        'Scrivi una curiosità storica a partire da questa voce. Punta sul dettaglio più sorprendente e poco noto, spiegandolo bene. Il titolo deve incuriosire senza essere clickbait. Nel context spiega il contesto storico in cui si inserisce.',
        quizCount,
      );
    },
  },
];

// --- Generazione a giri: prima una card per ogni sezione, poi le eventuali in più ----------
// Così, se l'LLM esaurisce i limiti a metà, ogni sezione ha comunque la sua card.

const rounds = Math.max(...sections.map((s) => s.want));

/** Prova a scrivere la prossima card di una sezione; ricorda se è fallita per un errore. */
async function tryNext(section: Section) {
  section.failed = false;
  try {
    const card = await section.next();
    if (card) section.cards.push({ ...card, section: section.key });
  } catch (err) {
    const message = (err as Error).message;
    section.failed = true;
    section.notes.push(message.slice(0, 200));
    console.error(`❌ ${section.label}: ${message}`);
  }
}

for (let round = 0; round < rounds; round++) {
  for (const section of sections) {
    if (round < section.want) await tryNext(section);
  }
}

// --- Secondo tentativo per le sezioni rimaste vuote per un errore --------------------------
// Prima una sezione persa per i limiti dell'LLM restava vuota per tutto il giorno. Dopo una pausa
// (i limiti sono al minuto) si riprova: un candidato nuovo, o una nuova selezione se era fallita.

const RECOVERY_PASSES = 2;
const RECOVERY_WAIT_MS = 75_000;
for (let pass = 1; pass <= RECOVERY_PASSES; pass++) {
  const retry = sections.filter((s) => s.failed && s.cards.length < s.want);
  if (retry.length === 0) break;
  console.log(`🔁 Nuovo tentativo (${pass}/${RECOVERY_PASSES}) tra ${RECOVERY_WAIT_MS / 1000}s: ${retry.map((s) => s.label).join(', ')}`);
  await sleep(RECOVERY_WAIT_MS);
  for (const section of retry) {
    await tryNext(section);
    if (!section.failed && section.cards.length >= section.want) section.notes.push(`riuscita al tentativo ${pass + 1}`);
  }
}

// --- Salvataggio e report -----------------------------------------------------------------

const cards = sections.flatMap((s) => s.cards);

const report = [
  `### Edizione ${date}`,
  '',
  '| Sezione | Card | Note |',
  '|---|---|---|',
  ...sections.map(
    (s) => `| ${s.label} | ${s.cards.map((c) => c.title).join('<br>') || '—'} | ${s.notes.join('; ').replace(/\|/g, '/')} |`,
  ),
  '',
  `Chiamate LLM riuscite: ${Object.entries(llmUsage()).map(([k, v]) => `${k} ${v}`).join(', ') || 'nessuna'}`,
].join('\n');
console.log(`\n${report}\n`);
// Su GitHub Actions il report compare nella pagina del run, visibile anche senza login.
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);

if (cards.length === 0) {
  console.error('❌ Nessuna card generata, edizione non salvata');
  process.exit(1);
}

const edition: Edition = {
  date,
  generatedAt: new Date().toISOString(),
  topics: config.topics.map(({ id, label, description, default: isDefault }) => ({
    id,
    label,
    description,
    default: !!isDefault,
  })),
  cards: cards.map((c, i) => ({ ...c, id: `${date}-${i}` })),
};
writeEdition(edition);
console.log(`✅ Edizione ${date} salvata con ${edition.cards.length} card`);

if (!args.has('--no-notify')) await notify(edition);
