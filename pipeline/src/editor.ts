import type { Card, CardImage, Category, QuizQuestion, SourceLink } from '../../shared/types.ts';
import type { Config, TopicConfig } from './config.ts';
import { chatJson } from './llm.ts';
import type { Article, NewsItem } from './news.ts';
import { wikiImage, type HistoryEvent } from './wikipedia.ts';

const EDITOR_SYSTEM = `Sei il caporedattore di "Feed My Brain", una rassegna quotidiana per un lettore italiano giovane e curioso che vuole capire il mondo e farsi una cultura. Scegli con giudizio giornalistico: rilevanza, impatto, capacità di insegnare qualcosa. Evita cronaca nera locale, gossip, sport minore, clickbait. Rispondi sempre e solo in JSON valido.`;

const WRITER_SYSTEM = `Sei un giornalista che scrive per "Feed My Brain". Scrivi in italiano chiaro, preciso e asciutto, senza enfasi né retorica. Spiega le cose come a un amico intelligente che non conosce l'argomento: niente sigle o nomi non spiegati.
Regole:
- Racconta LA NOTIZIA: cosa è successo, chi, quando, dove, perché. Il testo deve riguardare il fatto specifico del titolo, non il soggetto in generale.
- Usa solo i fatti presenti nel materiale. Non inventare cifre, date o citazioni.
- Se il materiale è scarso, scrivi di meno. Non riempire con biografie, descrizioni generiche del soggetto o informazioni di contorno.
- "summary": 50-80 parole.
- "context": 25-45 parole: perché conta, collegamenti con il quadro generale, cosa tenere d'occhio. Qui puoi usare conoscenze generali consolidate.
- "imageSubject": titolo della voce di Wikipedia italiana del soggetto da illustrare con un'immagine (la persona, il luogo, l'opera o l'evento principale, es. "Napoleone Bonaparte"), oppure "" se non c'è un soggetto chiaro.
- "quiz": domande a scelta multipla con 4 opzioni brevi e una sola corretta. Devono verificare di aver capito il punto principale della notizia, non dettagli marginali. La risposta deve essere ricavabile da summary e context. Le opzioni sbagliate devono essere plausibili. "answer" è l'indice (0-3) dell'opzione corretta. "explanation" è una frase breve che spiega la risposta.
Rispondi sempre e solo in JSON valido.`;

interface DraftCard {
  title: string;
  imageSubject?: string;
  summary: string;
  context: string;
  quiz: QuizQuestion[];
}

export interface StoryPick {
  tag: string;
  title: string;
  items: NewsItem[];
}

const CANDIDATE_EXTRA = 2; // candidati di riserva, se una storia non ha abbastanza materiale

// Limiti per tenere leggeri i prompt di selezione: i piani gratuiti contano i token al minuto
// (es. Groq: 8.000 al minuto), quindi ogni richiesta deve restare ben sotto.
const MAX_NEWS_ITEMS = 60;
const MAX_TOPIC_ITEMS = 25;
const SNIPPET_CHARS = 110;
const MAX_RECENT = 30;
const MAX_ARTICLES_PER_CARD = 3;
const ARTICLE_CHARS = 2500;

type RawPick = { title: string; itemIds: number[] };

function listItems(items: NewsItem[]) {
  return items
    .map((i) => `[${i.id}] (${i.source}) ${i.title}${i.snippet ? ` — ${i.snippet.slice(0, SNIPPET_CHARS)}` : ''}`)
    .join('\n');
}

/** Prende al massimo `max` articoli alternando le fonti, così nessuna testata domina la lista. */
function sample(items: NewsItem[], max: number): NewsItem[] {
  const bySource = new Map<string, NewsItem[]>();
  for (const i of items) bySource.set(i.source, [...(bySource.get(i.source) ?? []), i]);
  const queues = [...bySource.values()];
  const out: NewsItem[] = [];
  while (out.length < max && queues.some((q) => q.length)) {
    for (const q of queues) if (q.length && out.length < max) out.push(q.shift()!);
  }
  return out;
}

function recentBlock(recentTitles: string[]) {
  return recentTitles.slice(0, MAX_RECENT).map((t) => `- ${t}`).join('\n') || '- nessuna';
}

const SELECTION_RULES = `Varia i soggetti: non scegliere la stessa persona, artista o azienda già protagonista nei giorni scorsi, a meno di una notizia davvero importante.
Per ogni storia indica gli id di TUTTI gli articoli che ne parlano (max 5), il più informativo per primo.`;

function resolve(items: NewsItem[], picks: RawPick[] | undefined, tag: string): StoryPick[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  return (picks ?? [])
    .map((p) => ({
      title: p.title,
      tag,
      items: (p.itemIds ?? []).map((id) => byId.get(id)).filter((i) => !!i),
    }))
    .filter((p) => p.items.length > 0);
}

/**
 * Sceglie le storie di attualità (Mondo e Italia) in ordine di importanza, raggruppando gli
 * articoli sulla stessa notizia. Restituisce più candidati del necessario: chi scrive scarta
 * quelli senza materiale sufficiente.
 */
export async function selectNews(
  config: Config,
  items: NewsItem[],
  recentTitles: string[],
): Promise<{ mondo: StoryPick[]; italia: StoryPick[] }> {
  const news = sample(
    items.filter((i) => i.group === 'news'),
    MAX_NEWS_ITEMS,
  );
  if (news.length === 0) return { mondo: [], italia: [] };

  const prompt = `Scegli le notizie di attualità di oggi, in ordine di importanza:
- MONDO: ${config.edition.mondo + CANDIDATE_EXTRA} storie internazionali (esteri, geopolitica, economia globale).
- ITALIA: ${config.edition.italia + CANDIDATE_EXTRA} storie italiane (politica, economia, società).
Una storia va in una sola delle due liste.

${SELECTION_RULES}

Storie già pubblicate nei giorni scorsi (non ripeterle, a meno di sviluppi importanti):
${recentBlock(recentTitles)}

Articoli:
${listItems(news)}

Formato: {"mondo":[{"title":"titolo breve della storia","itemIds":[1,2]}],"italia":[{"title":"...","itemIds":[4]}]}`;

  const res = await chatJson<{ mondo?: RawPick[]; italia?: RawPick[] }>(EDITOR_SYSTEM, prompt, 0.3);
  return { mondo: resolve(news, res.mondo, 'Mondo'), italia: resolve(news, res.italia, 'Italia') };
}

/** Sceglie le storie di un argomento del catalogo, in ordine di interesse. */
export async function selectTopic(
  topic: TopicConfig,
  want: number,
  items: NewsItem[],
  recentTitles: string[],
): Promise<StoryPick[]> {
  const list = sample(
    items.filter((i) => i.group === topic.id),
    MAX_TOPIC_ITEMS,
  );
  if (list.length === 0) return [];

  const prompt = `Argomento: ${topic.label} (${topic.description}).
Scegli ${want + CANDIDATE_EXTRA} storie tra questi articoli, in ordine di interesse. Solo notizie vere e specifiche (uscite, annunci, risultati, eventi), non recensioni, liste, guide o articoli generici. L'argomento è un'area, non un singolo personaggio.

${SELECTION_RULES}

Storie già pubblicate nei giorni scorsi (non ripeterle, a meno di sviluppi importanti):
${recentBlock(recentTitles)}

Articoli:
${listItems(list)}

Formato: {"stories":[{"title":"titolo breve della storia","itemIds":[1,2]}]}`;

  const res = await chatJson<Record<string, unknown>>(EDITOR_SYSTEM, prompt, 0.3);
  // Alcuni modelli rinominano la chiave ("storie", "items"…): vale il primo elenco presente.
  const picks = (Array.isArray(res.stories) ? res.stories : Object.values(res).find(Array.isArray)) as
    | RawPick[]
    | undefined;
  return resolve(list, picks, topic.label);
}

/** Quanti caratteri di materiale vero (testo degli articoli o estratti) ha una storia. */
export function materialSize(story: StoryPick, articles: Map<string, Article>) {
  return story.items.reduce((sum, i) => sum + Math.max(articles.get(i.link)?.text?.length ?? 0, i.snippet.length), 0);
}

/** Materiale sufficiente per una buona card; sotto MIN_MATERIAL non si scrive affatto. */
export const GOOD_MATERIAL = 500;
export const MIN_MATERIAL = 150;

/** Sceglie l'evento storico del giorno e la voce di Wikipedia da cui raccontarlo. */
export async function pickHistoryEvent(
  events: HistoryEvent[],
  recentTitles: string[],
): Promise<{ event: HistoryEvent; page: string } | null> {
  if (events.length === 0) return null;
  const prompt = `Ecco eventi accaduti in questo giorno nella storia. Scegline UNO da raccontare: preferisci eventi di grande importanza storica o culturale, che insegnano qualcosa (rilevanza italiana/europea benvenuta), e varia le epoche. Evita argomenti già trattati di recente:
${recentTitles.map((t) => `- ${t}`).join('\n') || '- nessuno'}

Eventi:
${events.map((e, i) => `[${i}] ${e.year}: ${e.text} | voci: ${e.pages.map((p) => p.title).join('; ')}`).join('\n')}

Indica anche la voce di Wikipedia (tra quelle elencate per l'evento) più adatta a raccontarlo, cioè quella sull'evento stesso e non su un luogo o una persona di contorno.
Formato: {"event": <indice>, "page": "<titolo voce>"}`;
  const res = await chatJson<{ event: number; page: string }>(EDITOR_SYSTEM, prompt, 0.7);
  const event = events[res.event];
  if (!event) return null;
  const page = event.pages.find((p) => p.title === res.page)?.title ?? event.pages[0]?.title;
  return page ? { event, page } : null;
}

/** Tra le voci collegate a un argomento, sceglie quella per una curiosità sorprendente. */
export async function pickCuriosity(topic: string, links: string[], recentTitles: string[]): Promise<string> {
  const prompt = `Argomento: ${topic}.
Tra queste voci di Wikipedia collegate, scegline UNA che possa dare una curiosità sorprendente e poco nota (un episodio, una persona, un oggetto, un'usanza). Evita concetti generici, paesi o città. Evita argomenti già trattati:
${recentTitles.map((t) => `- ${t}`).join('\n') || '- nessuno'}

Voci:
${links.join('\n')}

Formato: {"page": "<titolo esatto>"}`;
  const res = await chatJson<{ page: string }>(EDITOR_SYSTEM, prompt, 0.9);
  return links.includes(res.page) ? res.page : topic;
}

async function writeCard(material: string, instructions: string, quizCount: number): Promise<DraftCard> {
  const prompt = `${instructions}

Genera esattamente ${quizCount} ${quizCount === 1 ? 'domanda' : 'domande'} di quiz.
Formato: {"title":"titolo breve e chiaro","summary":"...","context":"...","imageSubject":"...","quiz":[{"question":"...","options":["...","...","...","..."],"answer":0,"explanation":"..."}]}

MATERIALE:
${material}`;
  return chatJson<DraftCard>(WRITER_SYSTEM, prompt, 0.4);
}

export async function writeNewsCard(
  story: StoryPick,
  category: Category,
  articles: Map<string, Article>,
  quizCount: number,
): Promise<Omit<Card, 'id'>> {
  // Al massimo 3 articoli da ~2.500 caratteri: la richiesta resta sotto i limiti di token al minuto.
  const material = story.items
    .slice(0, MAX_ARTICLES_PER_CARD)
    .map((i) => {
      const body = (articles.get(i.link)?.text ?? i.snippet).slice(0, ARTICLE_CHARS);
      return `### ${i.title} (${i.source})\n${body || '(solo titolo)'}`;
    })
    .join('\n\n');
  const draft = await writeCard(
    material,
    `Scrivi la card per la notizia "${story.title}", unendo le informazioni di tutte le fonti.`,
    quizCount,
  );
  const sources: SourceLink[] = story.items.slice(0, 3).map((i) => ({ name: i.source, url: i.link }));
  // Prima l'immagine dell'articolo (copertina o feed), poi Wikipedia sul soggetto.
  const lead = story.items.find((i) => articles.get(i.link)?.image || i.image);
  const leadUrl = lead && (articles.get(lead.link)?.image ?? lead.image);
  const image: CardImage | undefined = leadUrl
    ? { url: leadUrl, credit: lead.source, link: lead.link }
    : await subjectImage(draft.imageSubject);
  return finalize(draft, category, story.tag, sources, image);
}

async function subjectImage(subject?: string) {
  return subject?.trim() ? ((await wikiImage(subject.trim())) ?? undefined) : undefined;
}

export async function writeWikiCard(
  article: { title: string; url: string; text: string },
  category: Category,
  tag: string,
  instructions: string,
  quizCount: number,
): Promise<Omit<Card, 'id'>> {
  const draft = await writeCard(`### ${article.title}\n${article.text}`, instructions, quizCount);
  // Il soggetto indicato dal modello (es. Napoleone) e, in mancanza, l'immagine della voce stessa.
  const image = (await subjectImage(draft.imageSubject)) ?? (await subjectImage(article.title));
  return finalize(draft, category, tag, [{ name: 'Wikipedia', url: article.url }], image);
}

function shuffleQuestion(q: QuizQuestion): QuizQuestion {
  const order = q.options.map((_, i) => i).sort(() => Math.random() - 0.5);
  return { ...q, options: order.map((i) => q.options[i]), answer: order.indexOf(q.answer) };
}

function finalize(
  draft: DraftCard,
  category: Category,
  tag: string,
  sources: SourceLink[],
  image?: CardImage,
): Omit<Card, 'id'> {
  if (!draft.title || !draft.summary) throw new Error('Card incompleta generata dal modello');
  const quiz = (draft.quiz ?? [])
    .filter(
      (q) =>
        q.question &&
        Array.isArray(q.options) &&
        q.options.length >= 2 &&
        Number.isInteger(q.answer) &&
        q.answer >= 0 &&
        q.answer < q.options.length,
    )
    // I modelli tendono a mettere la risposta giusta sempre nella stessa posizione.
    .map(shuffleQuestion);
  return {
    category,
    tag,
    title: draft.title,
    summary: draft.summary,
    context: draft.context ?? '',
    sources,
    ...(image && { image }),
    quiz,
  };
}
