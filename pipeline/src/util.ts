export const USER_AGENT = 'FeedMyBrain/0.1 (https://github.com/davide-modena/feed-my-brain)';

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Data odierna (YYYY-MM-DD) nel fuso orario italiano. */
export function romeDate(d = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(d);
}

export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : clean.slice(0, max).trimEnd() + '…';
}

export async function fetchText(url: string, timeoutMs = 15_000): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} per ${url}`);
  return res.text();
}

export async function fetchJson<T>(url: string, timeoutMs = 15_000): Promise<T> {
  return JSON.parse(await fetchText(url, timeoutMs)) as T;
}

export function pickRandom<T>(items: T[], n: number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}
