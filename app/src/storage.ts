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

export interface Preferences {
  /** Argomenti scelti; null = non ancora scelti (mostra l'onboarding). */
  topics: string[] | null;
  storia: boolean;
  curiosita: boolean;
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
  prefs: { topics: null, storia: true, curiosita: true },
  theme: 'classico',
};

function load(): StoreState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const saved = JSON.parse(raw) as Partial<StoreState>;
    return { ...EMPTY, ...saved, prefs: { ...EMPTY.prefs, ...saved.prefs } };
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

/** Le card da mostrare secondo le preferenze. */
export function visibleCards(edition: Edition, prefs: Preferences): Card[] {
  const topics = activeTopics(edition, prefs);
  return edition.cards.filter((c) => {
    if (c.category === 'storia') return prefs.storia;
    if (c.category === 'curiosita') return prefs.curiosita;
    if (c.topic) return topics.includes(c.topic);
    return true;
  });
}

export interface QuizItem {
  key: string;
  cardTitle: string;
  question: Card['quiz'][number];
}

export function quizItems(cards: Card[]): QuizItem[] {
  return cards.flatMap((c) => c.quiz.map((q, i) => ({ key: `${c.id}:${i}`, cardTitle: c.title, question: q })));
}
