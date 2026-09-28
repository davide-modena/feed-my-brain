import type { Card, CardImage, Category, QuizQuestion, SourceLink } from '../../shared/types.ts';
import type { Config } from './config.ts';
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

export interface Selection {
  attualita: StoryPick[];
  /** Candidati per argomento, dal migliore al peggiore. */
  topics: Record<string, StoryPick[]>;
}

const CANDIDATE_EXTRA = 2; // candidati di riserva, se una storia non ha abbastanza materiale

function listItems(items: NewsItem[]) {
  return items
    .map((i) => `[${i.id}] (${i.source}) ${i.title}${i.snippet ? ` — ${i.snippet.slice(0, 160)}` : ''}`)
    .join('\n');
}

/**
 * Sceglie le storie del giorno in ordine di priorità, raggruppando gli articoli che parlano
 * della stessa notizia. Restituisce più candidati del necessario: chi scrive scarta quelli
 * senza materiale sufficiente.
 */
export async function selectStories(config: Config, items: NewsItem[], recentTitles: string[]): Promise<Selection> {
  const news = items.filter((i) => i.group === 'news');
  const nNews = config.edition.attualita + CANDIDATE_EXTRA;
  const nTopic = config.edition.perTopic + CANDIDATE_EXTRA;

  const topicBlocks = config.topics
    .map((t) => {
      const list = items.filter((i) => i.group === t.id);
      return list.length ? `## Argomento "${t.id}" (${t.description})\n${listItems(list)}` : '';
    })
    .filter(Boolean)
    .join('\n\n');

  const prompt = `Scegli le notizie di oggi, in ordine di importanza:
- per l'ATTUALITÀ (politica, esteri, economia, società, scienza): ${nNews} storie tra gli articoli "news".
- per OGNI ARGOMENTO: ${nTopic} storie tra gli articoli di quell'argomento. Solo notizie vere e specifiche (uscite, annunci, risultati, eventi), non recensioni, liste, guide o articoli generici.

Storie già pubblicate nei giorni scorsi (non ripeterle, a meno di sviluppi importanti):
${recentTitles.map((t) => `- ${t}`).join('\n') || '- nessuna'}

# Articoli "news"
${listItems(news)}

${topicBlocks}

Per ogni storia indica gli id di TUTTI gli articoli che ne parlano (max 5), il più informativo per primo.
Formato:
{"attualita":[{"title":"titolo breve della storia","tag":"Mondo|Italia|Economia|Scienza|Società","itemIds":[1,2]}],
 "topics":{"<id argomento>":[{"title":"...","itemIds":[3]}]}}`;

  const res = await chatJson<{
    attualita?: { title: string; tag: string; itemIds: number[] }[];
    topics?: Record<string, { title: string; itemIds: number[] }[]>;
  }>(EDITOR_SYSTEM, prompt, 0.3);

  const byId = new Map(items.map((i) => [i.id, i]));
  const resolve = (picks: { title: string; tag?: string; itemIds: number[] }[] | undefined, tag: string) =>
    (picks ?? [])
      .map((p) => ({
        title: p.title,
        tag: p.tag || tag,
        items: (p.itemIds ?? []).map((id) => byId.get(id)).filter((i) => !!i),
      }))
      .filter((p) => p.items.length > 0);

  const topics: Record<string, StoryPick[]> = {};
  for (const t of config.topics) topics[t.id] = resolve(res.topics?.[t.id], t.label);
  return { attualita: resolve(res.attualita, 'Attualità'), topics };
}

/** Una storia è raccontabile se c'è il testo di almeno un articolo o estratti sufficienti. */
export function hasEnoughMaterial(story: StoryPick, articles: Map<string, Article>) {
  if (story.items.some((i) => (articles.get(i.link)?.text?.length ?? 0) > 500)) return true;
  const snippets = story.items.reduce((sum, i) => sum + i.snippet.length, 0);
  return snippets >= 350;
}

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
  const material = story.items
    .map((i) => {
      const body = articles.get(i.link)?.text ?? i.snippet;
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
