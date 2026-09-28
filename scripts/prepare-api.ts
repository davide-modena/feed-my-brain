/**
 * Prepara l'API statica servita insieme alla PWA:
 *   api/today.json            ultima edizione
 *   api/index.json            elenco delle date disponibili
 *   api/widget.json           formato compatto per widget
 *   api/editions/<data>.json  archivio
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CATEGORY_EMOJI, type Edition, type EditionIndex, type WidgetData } from '../shared/types.ts';
import { editionPath, listEditionDates } from '../pipeline/src/store.ts';

const OUT = fileURLToPath(new URL('../app/public/api/', import.meta.url));
const SAMPLE = fileURLToPath(new URL('../data/sample-edition.json', import.meta.url));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}editions`, { recursive: true });

let dates = listEditionDates();
let latest: Edition;
if (dates.length === 0) {
  console.log('ℹ️  Nessuna edizione in data/editions: uso l\'edizione di esempio');
  latest = JSON.parse(readFileSync(SAMPLE, 'utf8'));
  dates = [latest.date];
  writeFileSync(`${OUT}editions/${latest.date}.json`, JSON.stringify(latest));
} else {
  for (const d of dates) copyFileSync(editionPath(d), `${OUT}editions/${d}.json`);
  latest = JSON.parse(readFileSync(editionPath(dates[0]), 'utf8'));
}

const index: EditionIndex = { latest: latest.date, dates };
const cards = latest.cards.map(({ category, tag, title }) => ({ category, emoji: CATEGORY_EMOJI[category], tag, title }));
const widget: WidgetData = {
  date: latest.date,
  dateLabel: new Date(`${latest.date}T12:00:00Z`).toLocaleDateString('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }),
  headline: latest.cards[0]?.title ?? '',
  count: latest.cards.length,
  text: cards.map((c) => `${c.emoji} ${c.title}`).join('\n'),
  imageUrl: latest.cards.find((c) => c.image)?.image?.url,
  cards,
};

writeFileSync(`${OUT}today.json`, JSON.stringify(latest));
writeFileSync(`${OUT}index.json`, JSON.stringify(index));
writeFileSync(`${OUT}widget.json`, JSON.stringify(widget));
console.log(`📦 API statica pronta: ${dates.length} edizioni, ultima ${latest.date}`);
