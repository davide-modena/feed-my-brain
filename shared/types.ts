export type Category = 'attualita' | 'interessi' | 'storia' | 'curiosita';

export interface SourceLink {
  name: string;
  url: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  /** Indice dell'opzione corretta in `options`. */
  answer: number;
  explanation: string;
}

export interface CardImage {
  url: string;
  /** Attribuzione breve, es. "Wikimedia Commons" o il nome della testata. */
  credit: string;
  /** Pagina della fonte dell'immagine. */
  link?: string;
}

export interface Card {
  id: string;
  category: Category;
  /** Etichetta breve mostrata sulla card, es. "Mondo", "Tech", "2 agosto 1980". */
  tag: string;
  title: string;
  summary: string;
  /** "Perché conta": contesto e collegamenti. */
  context: string;
  sources: SourceLink[];
  image?: CardImage;
  /** Per le card "interessi": id dell'argomento del catalogo (vedi Edition.topics). */
  topic?: string;
  quiz: QuizQuestion[];
}

export interface Topic {
  id: string;
  label: string;
  description?: string;
  /** Attivo di default al primo avvio. */
  default?: boolean;
}

export interface Edition {
  date: string; // YYYY-MM-DD (Europe/Rome)
  generatedAt: string; // ISO timestamp
  /** Catalogo degli argomenti tra cui l'utente sceglie. */
  topics?: Topic[];
  cards: Card[];
}

export interface EditionIndex {
  latest: string;
  dates: string[]; // dalla più recente
}

/** Formato compatto per widget (KWGT, Scriptable, Windows widgets...). */
export interface WidgetData {
  date: string;
  /** Data leggibile, es. "lunedì 28 settembre". */
  dateLabel: string;
  headline: string;
  count: number;
  /** Titoli già formattati, uno per riga con emoji di categoria (per widget che non sanno iterare, es. KWGT). */
  text: string;
  /** Immagine della prima card che ne ha una (per widget con immagine). */
  imageUrl?: string;
  cards: { category: Category; emoji: string; tag: string; title: string }[];
}

export const CATEGORY_EMOJI: Record<Category, string> = {
  attualita: '📰',
  interessi: '⭐',
  storia: '📜',
  curiosita: '💡',
};

export const CATEGORY_LABEL: Record<Category, string> = {
  attualita: 'Attualità',
  interessi: 'Interessi',
  storia: 'Storia',
  curiosita: 'Curiosità',
};
