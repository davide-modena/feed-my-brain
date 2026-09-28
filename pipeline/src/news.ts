import Parser from 'rss-parser';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import type { Config, FeedConfig } from './config.ts';
import { USER_AGENT, fetchText, truncate } from './util.ts';

export interface NewsItem {
  id: number;
  /** "news" per l'attualità, altrimenti l'id dell'argomento. */
  group: string;
  source: string;
  title: string;
  link: string;
  snippet: string;
  published?: string;
  /** Immagine dichiarata nel feed (enclosure, media:content, media:thumbnail). */
  image?: string;
}

export interface Article {
  text: string | null;
  /** og:image / twitter:image della pagina. */
  image: string | null;
}

/** Immagini che di solito sono loghi o segnaposto, non la foto della notizia. */
const GENERIC_IMAGE = /logo|placeholder|default|favicon|sprite|share-image|og-image/i;

const MAX_AGE_MS = 36 * 60 * 60 * 1000;
const MAX_PER_FEED = 20;

type MediaNode = { $?: { url?: string; medium?: string; type?: string } };
type FeedItem = {
  /** Testata dell'articolo nei feed di Bing News. */
  newsSource?: string;
  mediaContent?: MediaNode[];
  mediaThumbnail?: MediaNode[];
};

const parser = new Parser<Record<string, unknown>, FeedItem>({
  timeout: 15_000,
  headers: { 'User-Agent': USER_AGENT },
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
      ['News:Source', 'newsSource'],
    ],
  },
});

function feedImage(item: Parser.Item & FeedItem): string | undefined {
  const isImage = (n?: MediaNode) =>
    n?.$?.url && (!n.$.medium || n.$.medium === 'image') && (!n.$.type || n.$.type.startsWith('image'));
  const media = item.mediaContent?.find(isImage) ?? item.mediaThumbnail?.find((n) => n.$?.url);
  if (media?.$?.url && !GENERIC_IMAGE.test(media.$.url)) return media.$.url;
  if (item.enclosure?.url && (item.enclosure.type ?? 'image').startsWith('image')) return item.enclosure.url;
  // Alcuni feed mettono solo un <img> dentro il contenuto HTML.
  return item.content?.match(/<img[^>]+src="([^"]+)"/)?.[1];
}

/**
 * Ricerca su Bing News in RSS. A differenza di Google News dà il link reale all'articolo
 * e un estratto del testo, quindi il modello ha materiale vero su cui scrivere.
 */
function bingNewsUrl(query: string, lang: 'it' | 'en' = 'it') {
  const params = new URLSearchParams({
    q: query,
    format: 'rss',
    setlang: lang,
    cc: lang === 'en' ? 'US' : 'IT',
    qft: 'sortbydate="1"',
  });
  return `https://www.bing.com/news/search?${params}`;
}

/** I link di Bing passano da un redirect che contiene l'URL reale nel parametro `url`. */
function unwrapLink(link: string) {
  try {
    const u = new URL(link);
    if (u.hostname.endsWith('bing.com') && u.searchParams.get('url')) return u.searchParams.get('url')!;
  } catch {
    // link non valido: lo lascio com'è
  }
  return link;
}

async function fetchFeed(feed: FeedConfig, group: string): Promise<Omit<NewsItem, 'id'>[]> {
  try {
    const parsed = await parser.parseURL(feed.url);
    const now = Date.now();
    return parsed.items
      .filter((item) => {
        const date = item.isoDate ? Date.parse(item.isoDate) : NaN;
        return Number.isNaN(date) || now - date < MAX_AGE_MS;
      })
      .slice(0, MAX_PER_FEED)
      .map((item) => ({
        group,
        source: item.newsSource?.trim() || feed.name,
        title: (item.title ?? '').trim(),
        link: unwrapLink(item.link ?? ''),
        snippet: truncate(item.contentSnippet ?? '', 240),
        published: item.isoDate,
        image: feedImage(item),
      }))
      .filter((item) => item.title && item.link);
  } catch (err) {
    console.warn(`⚠️  Feed non disponibile: ${feed.name} (${(err as Error).message})`);
    return [];
  }
}

export async function collectNews(config: Config): Promise<NewsItem[]> {
  const jobs = config.news.map((feed) => fetchFeed(feed, 'news'));
  for (const topic of config.topics) {
    for (const feed of topic.feeds ?? []) jobs.push(fetchFeed(feed, topic.id));
    for (const q of topic.queries ?? []) {
      jobs.push(fetchFeed({ name: 'Bing News', url: bingNewsUrl(q.query, q.lang) }, topic.id));
    }
  }

  const seen = new Set<string>();
  const items: NewsItem[] = [];
  for (const batch of await Promise.all(jobs)) {
    for (const item of batch) {
      const key = item.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ ...item, id: items.length });
    }
  }
  return items;
}

/** Scarica testo principale e immagine di copertina di un articolo (best effort: paywall e siti JS falliscono). */
export async function fetchArticle(url: string, maxChars = 3500): Promise<Article> {
  if (url.includes('news.google.com')) return { text: null, image: null }; // link di redirect, non risolvibili senza JS
  try {
    const html = await fetchText(url, 12_000);
    const { document } = parseHTML(html);
    const meta = (sel: string) => document.querySelector(sel)?.getAttribute('content')?.trim() || null;
    const rawImage = meta('meta[property="og:image"]') ?? meta('meta[name="twitter:image"]');
    const image = rawImage && !GENERIC_IMAGE.test(rawImage) ? new URL(rawImage, url).href : null;
    // Readability modifica il documento: va chiamato dopo aver letto i meta.
    const article = new Readability(document as unknown as Document).parse();
    const text = article?.textContent?.trim();
    return { text: text && text.length > 300 ? truncate(text, maxChars) : null, image };
  } catch {
    return { text: null, image: null };
  }
}
