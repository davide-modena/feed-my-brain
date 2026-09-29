import type { CardImage } from '../../shared/types.ts';
import { fetchJson, truncate } from './util.ts';

const API = 'https://it.wikipedia.org/w/api.php';

export interface HistoryEvent {
  year: number;
  text: string;
  pages: { title: string; description?: string }[];
}

interface OnThisDayResponse {
  events?: {
    text: string;
    year: number;
    pages: { titles: { normalized: string }; description?: string }[];
  }[];
}

/** Eventi accaduti in questo giorno, da Wikipedia italiana. */
export async function onThisDay(date: string): Promise<HistoryEvent[]> {
  const [, mm, dd] = date.split('-');
  const data = await fetchJson<OnThisDayResponse>(
    `https://api.wikimedia.org/feed/v1/wikipedia/it/onthisday/events/${mm}/${dd}`,
  );
  return (data.events ?? []).map((e) => ({
    year: e.year,
    text: e.text,
    pages: e.pages.map((p) => ({ title: p.titles.normalized, description: p.description })),
  }));
}

/** Testo in chiaro di una voce di Wikipedia (troncato). `null` se la voce non esiste. */
export async function pageExtract(
  title: string,
  maxChars = 7000,
): Promise<{ title: string; url: string; text: string } | null> {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts|info',
    inprop: 'url',
    explaintext: '1',
    redirects: '1',
    titles: title,
    format: 'json',
    formatversion: '2',
  });
  const data = await fetchJson<{
    query: { pages: { title: string; missing?: boolean; extract?: string; fullurl?: string }[] };
  }>(`${API}?${params}`);
  const page = data.query.pages[0];
  if (!page || page.missing || !page.extract) return null;
  return { title: page.title, url: page.fullurl ?? '', text: truncate(page.extract, maxChars) };
}

interface PageImageResponse {
  query?: { pages: { title: string; thumbnail?: { source: string }; pageimage?: string }[] };
}

/**
 * Immagine principale della voce di Wikipedia su un soggetto (es. "Napoleone Bonaparte").
 * Prova il titolo esatto, poi la ricerca full-text. Le immagini vengono da Wikimedia Commons.
 */
export async function wikiImage(subject: string): Promise<CardImage | null> {
  const common = {
    prop: 'pageimages',
    piprop: 'thumbnail|name',
    pithumbsize: '1000',
    redirects: '1',
    format: 'json',
    formatversion: '2',
    action: 'query',
  };
  const attempts = [
    new URLSearchParams({ ...common, titles: subject }),
    new URLSearchParams({ ...common, generator: 'search', gsrsearch: subject, gsrlimit: '1' }),
  ];
  for (const params of attempts) {
    try {
      const data = await fetchJson<PageImageResponse>(`${API}?${params}`);
      const page = data.query?.pages.find((p) => p.thumbnail);
      if (page?.thumbnail && page.pageimage) {
        return {
          url: page.thumbnail.source.replace(/\?utm_.*$/, ''),
          credit: 'Wikipedia',
          link: `https://it.wikipedia.org/wiki/File:${encodeURIComponent(page.pageimage)}`,
        };
      }
    } catch {
      // prova il tentativo successivo
    }
  }
  return null;
}

/** Tutte le voci (namespace principale) di una categoria, seguendo la paginazione. */
async function categoryPages(category: string): Promise<string[]> {
  const titles: string[] = [];
  let cont: string | undefined;
  do {
    const params = new URLSearchParams({
      action: 'query',
      list: 'categorymembers',
      cmtitle: `Categoria:${category}`,
      cmnamespace: '0',
      cmlimit: 'max',
      format: 'json',
      formatversion: '2',
      ...(cont && { cmcontinue: cont }),
    });
    const data = await fetchJson<{
      query?: { categorymembers: { title: string }[] };
      continue?: { cmcontinue: string };
    }>(`${API}?${params}`);
    titles.push(...(data.query?.categorymembers ?? []).map((m) => m.title));
    cont = data.continue?.cmcontinue;
  } while (cont);
  return titles;
}

/**
 * Le voci migliori di Wikipedia italiana ("in vetrina" e "di qualità") per le aree indicate,
 * es. "storia", "biografie", "arte". Un bacino ampio e vario per le curiosità.
 */
export async function featuredArticles(areas: string[]): Promise<string[]> {
  const categories = areas.flatMap((a) => [`Voci in vetrina - ${a}`, `Voci di qualità - ${a}`]);
  const lists = await Promise.all(categories.map((c) => categoryPages(c).catch(() => [])));
  return [...new Set(lists.flat())];
}
