/**
 * Genera l'edizione del giorno: raccoglie notizie e storia, le fa scegliere e riscrivere
 * all'LLM (Mistral, con fallback su Hugging Face), salva data/editions/YYYY-MM-DD.json e invia le notifiche.
 *
 * Flag:
 *   --dry     solo raccolta delle fonti, senza chiamare l'AI né scrivere file
 *   --force   rigenera anche se l'edizione di oggi esiste già
 *   --no-notify
 */
import { existsSync } from 'node:fs';
import type { Card, Edition } from '../../shared/types.ts';
import { loadConfig } from './config.ts';
import {
  hasEnoughMaterial,
  pickCuriosity,
  pickHistoryEvent,
  selectStories,
  writeNewsCard,
  writeWikiCard,
} from './editor.ts';
import { activeProvider } from './llm.ts';
import { collectNews, fetchArticle, type Article } from './news.ts';
import { notify } from './notify.ts';
import { editionPath, recentCardTitles, writeEdition } from './store.ts';
import { pickRandom, romeDate } from './util.ts';
import { onThisDay, pageExtract, pageLinks } from './wikipedia.ts';

const args = new Set(process.argv.slice(2));
const dry = args.has('--dry');
const date = romeDate();
const config = loadConfig();

if (!dry && !args.has('--force') && existsSync(editionPath(date))) {
  console.log(`✅ Edizione ${date} già presente (usa --force per rigenerarla)`);
  process.exit(0);
}

console.log(`🗞️  Raccolta fonti per il ${date}…`);
const [items, events] = await Promise.all([collectNews(config), onThisDay(date).catch(() => [])]);
const groups = Object.groupBy(items, (i) => i.group);
for (const [group, list] of Object.entries(groups)) console.log(`   ${group}: ${list?.length ?? 0} articoli`);
console.log(`   storia: ${events.length} eventi`);

if (dry) {
  for (const i of items.slice(0, 10)) console.log(`   [${i.group}] ${i.source}: ${i.title}`);
  process.exit(0);
}

console.log(`🤖 LLM: ${activeProvider()}`);
const recent = recentCardTitles();
const quizCount = config.edition.quizPerCard;
const cards: Omit<Card, 'id'>[] = [];

// Un errore su una singola card non deve far saltare l'intera edizione.
async function attempt(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    console.error(`❌ ${label}: ${(err as Error).message}`);
  }
}

await attempt('Attualità e argomenti', async () => {
  console.log('🧑‍💼 Selezione delle storie…');
  const selection = await selectStories(config, items, recent);
  const sections = [
    { category: 'attualita' as const, topic: undefined, want: config.edition.attualita, candidates: selection.attualita },
    ...config.topics.map((t) => ({
      category: 'interessi' as const,
      topic: t.id,
      want: config.edition.perTopic,
      candidates: selection.topics[t.id] ?? [],
    })),
  ];

  const links = [
    ...new Set(sections.flatMap((s) => s.candidates.flatMap((c) => c.items.slice(0, 3).map((i) => i.link)))),
  ];
  const articles = new Map<string, Article>();
  await Promise.all(links.map(async (link) => articles.set(link, await fetchArticle(link))));

  for (const section of sections) {
    let written = 0;
    for (const story of section.candidates) {
      if (written >= section.want) break;
      if (!hasEnoughMaterial(story, articles)) {
        console.log(`⏭️  Salto "${story.title}": solo titoli, niente testo su cui scrivere`);
        continue;
      }
      await attempt(story.title, async () => {
        console.log(`✍️  [${section.topic ?? 'attualità'}] ${story.title}`);
        const card = await writeNewsCard(story, section.category, articles, quizCount);
        cards.push(section.topic ? { ...card, topic: section.topic } : card);
        written++;
      });
    }
  }
});

for (let n = 0; n < config.edition.storia; n++) {
  await attempt('Storia', async () => {
    const pick = await pickHistoryEvent(events, [...recent, ...cards.map((c) => c.title)]);
    if (!pick) return;
    const article = await pageExtract(pick.page);
    if (!article) throw new Error(`voce "${pick.page}" non trovata`);
    const day = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
      new Date(`${date}T12:00:00Z`),
    );
    console.log(`📜 ${pick.event.year}: ${pick.page}`);
    cards.push(
      await writeWikiCard(
        article,
        'storia',
        `${day} ${pick.event.year}`,
        `Racconta questo evento accaduto il ${day} ${pick.event.year}: "${pick.event.text}". Nel titolo non serve la data. Nel context spiega cosa ha cambiato e cosa ha lasciato in eredità.`,
        quizCount,
      ),
    );
  });
}

for (let n = 0; n < config.edition.curiosita; n++) {
  await attempt('Curiosità', async () => {
    const [topic] = pickRandom(config.history.topics, 1);
    const links = pickRandom(await pageLinks(topic), 120);
    const page = await pickCuriosity(topic, links, [...recent, ...cards.map((c) => c.title)]);
    const article = await pageExtract(page);
    if (!article) throw new Error(`voce "${page}" non trovata`);
    console.log(`💡 ${topic} → ${article.title}`);
    cards.push(
      await writeWikiCard(
        article,
        'curiosita',
        topic,
        `Scrivi una curiosità storica a partire da questa voce (collegata a "${topic}"). Punta sul dettaglio più sorprendente e poco noto, spiegandolo bene. Il titolo deve incuriosire senza essere clickbait. Nel context collega la curiosità a "${topic}".`,
        quizCount,
      ),
    );
  });
}

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
