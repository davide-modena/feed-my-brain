import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Card, Edition } from '../../shared/types.ts';
import { romeDate } from './util.ts';

export const EDITIONS_DIR = fileURLToPath(new URL('../../data/editions/', import.meta.url));

export function editionPath(date: string) {
  return join(EDITIONS_DIR, `${date}.json`);
}

export function listEditionDates(): string[] {
  if (!existsSync(EDITIONS_DIR)) return [];
  return readdirSync(EDITIONS_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, 10))
    .sort()
    .reverse();
}

export function readEdition(date: string): Edition {
  return JSON.parse(readFileSync(editionPath(date), 'utf8')) as Edition;
}

/** Le card dei giorni precedenti a oggi (per evitare ripetizioni). */
export function recentCards(days = 7): Pick<Card, 'title' | 'tag' | 'category'>[] {
  const today = romeDate();
  return listEditionDates()
    .filter((d) => d < today) // se l'edizione di oggi viene rigenerata, non conta come "già vista"
    .slice(0, days)
    .flatMap((d) => readEdition(d).cards.map(({ title, tag, category }) => ({ title, tag, category })));
}

/** Link degli articoli già usati come fonte nei giorni precedenti a oggi. */
export function recentSourceLinks(days = 7): Set<string> {
  const today = romeDate();
  return new Set(
    listEditionDates()
      .filter((d) => d < today)
      .slice(0, days)
      .flatMap((d) => readEdition(d).cards.flatMap((c) => c.sources.map((s) => s.url))),
  );
}

export function writeEdition(edition: Edition) {
  mkdirSync(EDITIONS_DIR, { recursive: true });
  writeFileSync(editionPath(edition.date), JSON.stringify(edition, null, 2) + '\n');
}
