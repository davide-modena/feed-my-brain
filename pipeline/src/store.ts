import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Edition } from '../../shared/types.ts';

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

export function recentCardTitles(days = 7): string[] {
  return listEditionDates()
    .slice(0, days)
    .flatMap((d) => readEdition(d).cards.map((c) => c.title));
}

export function writeEdition(edition: Edition) {
  mkdirSync(EDITIONS_DIR, { recursive: true });
  writeFileSync(editionPath(edition.date), JSON.stringify(edition, null, 2) + '\n');
}
