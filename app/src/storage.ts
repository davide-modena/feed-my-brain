import { useState } from 'preact/hooks';
import type { Card, Edition } from '../../shared/types.ts';

export interface EditionProgress {
  /**
   * `generatedAt` dell'edizione a cui si riferiscono i progressi: se l'edizione del giorno
   * viene rigenerata, gli id delle card restano uguali ma i contenuti no, quindi si riparte.
   */
  generatedAt?: string;
  /** Card corrente nel mazzo. */
  index: number;
  /** "<cardId>:<n. domanda>" → opzione scelta. */
  answers: Record<string, number>;
  done?: boolean;
}

/** Quante card vedere per sezione ("perTopic" vale per ciascun argomento seguito). */
export interface SectionCounts {
  mondo: number;
  italia: number;
  perTopic: number;
  storia: number;
  curiosita: number;
}

/** Massimi per sezione: quante card ne genera ogni giorno la pipeline (pipeline/config.yaml). */
export const COUNT_LIMITS: SectionCounts = { mondo: 2, italia: 2, perTopic: 2, storia: 2, curiosita: 3 };
export const MAX_CARDS = 10;
const DEFAULT_COUNTS: SectionCounts = { mondo: 1, italia: 1, perTopic: 1, storia: 1, curiosita: 1 };

export interface Preferences {
  /** Argomenti scelti; null = non ancora scelti (mostra l'onboarding). */
  topics: string[] | null;
  counts: SectionCounts;
}

export type Theme = 'classico' | 'nothing';

export const THEMES: { id: Theme; label: string; color: string }[] = [
  { id: 'classico', label: 'Classico', color: '#f6f1e6' },
  { id: 'nothing', label: 'Nothing', color: '#0d0d0d' },
];

export interface StoreState {
  progress: Record<string, EditionProgress>;
  streak: { count: number; last: string | null };
  prefs: Preferences;
  theme: Theme;
}

const KEY = 'feed-my-brain:v2';
const EMPTY: StoreState = {
  progress: {},
  streak: { count: 0, last: null },
  prefs: { topics: null, counts: DEFAULT_COUNTS },
  theme: 'classico',
};

/** Converte le preferenze salvate dalle versioni precedenti (storia/curiosità come sì/no). */
function migratePrefs(saved: Partial<Preferences> & { storia?: boolean; curiosita?: boolean } = {}): Preferences {
  const counts = { ...DEFAULT_COUNTS, ...saved.counts };
  if (!saved.counts) {
    if (saved.storia === false) counts.storia = 0;
    if (saved.curiosita === false) counts.curiosita = 0;
  }
  return { topics: saved.topics ?? null, counts };
}

function load(): StoreState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const saved = JSON.parse(raw) as Partial<StoreState>;
    return { ...EMPTY, ...saved, prefs: migratePrefs(saved.prefs) };
  } catch {
    return EMPTY;
  }
}

function save(state: StoreState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage non disponibile (navigazione privata): lo stato resta in memoria.
  }
}

export function useStore() {
  const [state, setState] = useState<StoreState>(load);
  const update = (fn: (s: StoreState) => StoreState) =>
    setState((prev) => {
      const next = fn(prev);
      save(next);
      return next;
    });
  return [state, update] as const;
}

/** Applica il tema alla pagina (attributo su <html> e colore della barra di sistema). */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  const color = THEMES.find((t) => t.id === theme)?.color;
  if (color) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
}

export function localDate(d = new Date()) {
  return d.toLocaleDateString('sv-SE'); // YYYY-MM-DD
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** Serie di giorni consecutivi: vale 0 se ieri non hai letto. */
export function currentStreak(streak: StoreState['streak']) {
  if (!streak.last) return 0;
  return daysBetween(streak.last, localDate()) <= 1 ? streak.count : 0;
}

export function completeToday(state: StoreState): StoreState {
  const today = localDate();
  const { last, count } = state.streak;
  if (last === today) return state;
  const next = last && daysBetween(last, today) === 1 ? count + 1 : 1;
  return { ...state, streak: { count: next, last: today } };
}

export function emptyProgress(edition?: Edition): EditionProgress {
  return { generatedAt: edition?.generatedAt, index: 0, answers: {} };
}

/** Progressi validi per questa versione dell'edizione (vuoti se è stata rigenerata). */
export function progressFor(state: StoreState, edition: Edition): EditionProgress {
  const saved = state.progress[edition.date];
  return saved && saved.generatedAt === edition.generatedAt ? saved : emptyProgress(edition);
}

/** Argomenti attivi: quelli scelti, altrimenti i default dell'edizione. */
export function activeTopics(edition: Edition, prefs: Preferences): string[] {
  return prefs.topics ?? (edition.topics ?? []).filter((t) => t.default).map((t) => t.id);
}

/** Totale di card al giorno con questi dosaggi e questo numero di argomenti seguiti. */
export function totalCards(counts: SectionCounts, topicCount: number) {
  return counts.mondo + counts.italia + counts.perTopic * topicCount + counts.storia + counts.curiosita;
}

/** Sezione di una card; le edizioni precedenti al campo `section` la ricavano da categoria e tag. */
function sectionOf(c: Card): string {
  if (c.section) return c.section;
  if (c.category === 'attualita') return c.tag === 'Italia' ? 'italia' : 'mondo';
  if (c.category === 'interessi') return c.topic ?? 'altro';
  return c.category;
}

/** Le card da mostrare: per ogni sezione le prime N, secondo i dosaggi scelti. */
export function visibleCards(edition: Edition, prefs: Preferences): Card[] {
  const { counts } = prefs;
  const take = (section: string, n: number) => edition.cards.filter((c) => sectionOf(c) === section).slice(0, n);
  const known = new Set(['mondo', 'italia', 'storia', 'curiosita', ...(edition.topics ?? []).map((t) => t.id)]);
  return [
    ...edition.cards.filter((c) => !known.has(sectionOf(c))), // es. la card di benvenuto dell'esempio
    ...take('mondo', counts.mondo),
    ...take('italia', counts.italia),
    ...activeTopics(edition, prefs).flatMap((t) => take(t, counts.perTopic)),
    ...take('storia', counts.storia),
    ...take('curiosita', counts.curiosita),
  ].slice(0, MAX_CARDS);
}

export interface QuizItem {
  key: string;
  cardTitle: string;
  question: Card['quiz'][number];
}

export function quizItems(cards: Card[]): QuizItem[] {
  return cards.flatMap((c) => c.quiz.map((q, i) => ({ key: `${c.id}:${i}`, cardTitle: c.title, question: q })));
}
