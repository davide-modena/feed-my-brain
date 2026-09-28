/**
 * Client LLM con fallback: Mistral e, se non disponibile, Hugging Face (Inference Providers,
 * API compatibile OpenAI). Un 429 mette il provider in pausa per qualche secondo invece di
 * scartarlo: i piani gratuiti hanno limiti al minuto, non solo mensili.
 */
import { sleep } from './util.ts';

interface Provider {
  name: string;
  endpoint: string;
  apiKey: string;
  model: string;
  /** Non tutti i provider su Hugging Face supportano response_format: lì il JSON si estrae dal testo. */
  jsonMode: boolean;
  minIntervalMs: number;
  lastCall: number;
  /** Timestamp fino a cui il provider è in pausa dopo un rate limit. */
  cooldownUntil: number;
  /** Chiave non valida o credito esaurito: non si riprova più in questa esecuzione. */
  disabled: boolean;
}

/** Limite temporaneo: riprovare dopo `retryMs`. */
class RateLimitError extends Error {
  constructor(message: string, readonly retryMs: number) {
    super(message);
  }
}

/** Il provider non è utilizzabile per il resto dell'esecuzione. */
class UnavailableError extends Error {}

const DEFAULT_COOLDOWN_MS = 20_000;
const MAX_WAIT_MS = 60_000;
const MAX_ATTEMPTS = 8;

function providers(): Provider[] {
  const base = { lastCall: 0, cooldownUntil: 0, disabled: false };
  const list: Provider[] = [];
  if (process.env.MISTRAL_API_KEY) {
    list.push({
      ...base,
      name: 'Mistral',
      endpoint: 'https://api.mistral.ai/v1/chat/completions',
      apiKey: process.env.MISTRAL_API_KEY,
      model: process.env.MISTRAL_MODEL || 'mistral-medium-latest',
      jsonMode: true,
      minIntervalMs: 1500, // il piano gratuito ha rate limit stretti
    });
  }
  if (process.env.HF_TOKEN) {
    list.push({
      ...base,
      name: 'Hugging Face',
      endpoint: 'https://router.huggingface.co/v1/chat/completions',
      apiKey: process.env.HF_TOKEN,
      model: process.env.HF_MODEL || 'meta-llama/Llama-3.3-70B-Instruct',
      jsonMode: false,
      minIntervalMs: 500,
    });
  }
  if (list.length === 0) throw new Error('Nessun LLM configurato: imposta MISTRAL_API_KEY e/o HF_TOKEN (vedi .env.example)');
  return list;
}

let chain: Provider[] | null = null;
const usage: Record<string, number> = {};

/** Estrae il primo oggetto JSON dal testo (tollera ```json e frasi di contorno). */
function extractJson<T>(content: string): T {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('nessun JSON nella risposta');
  return JSON.parse(content.slice(start, end + 1)) as T;
}

function retryAfterMs(res: Response): number {
  const header = res.headers.get('retry-after');
  const seconds = header ? Number(header) : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_COOLDOWN_MS;
}

async function call<T>(p: Provider, system: string, user: string, temperature: number): Promise<T> {
  const wait = p.lastCall + p.minIntervalMs - Date.now();
  if (wait > 0) await sleep(wait);
  p.lastCall = Date.now();

  let res: Response;
  try {
    res = await fetch(p.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: p.model,
        temperature,
        max_tokens: 3000,
        ...(p.jsonMode && { response_format: { type: 'json_object' } }),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    throw new RateLimitError(`${p.name} non raggiungibile: ${(err as Error).message}`, 5000);
  }

  if (res.status === 429) {
    throw new RateLimitError(`${p.name} 429: ${(await res.text()).trim().slice(0, 160)}`, retryAfterMs(res));
  }
  if ([401, 402, 403].includes(res.status)) {
    throw new UnavailableError(`${p.name} ${res.status}: ${(await res.text()).trim().slice(0, 160)}`);
  }
  if (res.status >= 500) throw new RateLimitError(`${p.name} ${res.status}`, 5000);
  if (!res.ok) throw new Error(`${p.name} ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  const content = data.choices[0]?.message.content ?? '';
  usage[p.name] = (usage[p.name] ?? 0) + 1;
  return extractJson<T>(content);
}

export async function chatJson<T>(system: string, user: string, temperature = 0.4): Promise<T> {
  chain ??= providers();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const available = chain.filter((p) => !p.disabled);
    if (available.length === 0) throw lastError ?? new Error('Nessun LLM disponibile');

    // Il primo provider non in pausa, nell'ordine di preferenza.
    const now = Date.now();
    const p = available.find((x) => x.cooldownUntil <= now);
    if (!p) {
      const next = Math.min(...available.map((x) => x.cooldownUntil));
      const wait = Math.min(next - now, MAX_WAIT_MS);
      console.warn(`⏳ Tutti i provider in pausa, attendo ${Math.ceil(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }

    try {
      return await call<T>(p, system, user, temperature);
    } catch (err) {
      lastError = err as Error;
      if (err instanceof RateLimitError) {
        p.cooldownUntil = Date.now() + err.retryMs;
        console.warn(`↪️  ${err.message} (pausa ${Math.ceil(err.retryMs / 1000)}s)`);
      } else if (err instanceof UnavailableError) {
        p.disabled = true;
        console.warn(`↪️  ${err.message}: disattivato per questa esecuzione`);
      } else if (attempt >= 3) {
        throw err; // risposta non valida ripetuta: inutile insistere
      }
    }
  }
  throw lastError ?? new Error('Troppi tentativi falliti');
}

export function activeProvider() {
  const p = (chain ??= providers())[0];
  return `${p.name} (${p.model})`;
}

/** Numero di chiamate riuscite per provider, per il report finale. */
export function llmUsage() {
  return { ...usage };
}
