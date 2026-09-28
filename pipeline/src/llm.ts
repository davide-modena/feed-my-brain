/**
 * Client LLM con fallback tra più provider compatibili con l'API di OpenAI (vedi SPECS).
 * Un 429 mette il provider in pausa per qualche secondo invece di scartarlo: i piani
 * gratuiti hanno limiti al minuto, non solo mensili.
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

interface ProviderSpec {
  name: string;
  /** Variabile d'ambiente con la chiave; il provider è attivo solo se è impostata. */
  keyEnv: string;
  modelEnv: string;
  defaultModel: string;
  endpoint: string;
  jsonMode: boolean;
  minIntervalMs: number;
}

/**
 * Provider in ordine di preferenza. Tutti espongono l'API "chat completions" di OpenAI,
 * quindi aggiungerne uno è solo una riga qui.
 */
const SPECS: ProviderSpec[] = [
  {
    // Qualsiasi endpoint compatibile OpenAI: OmniRoute, OpenRouter, un server locale…
    name: process.env.LLM_NAME || 'Custom',
    keyEnv: 'LLM_API_KEY',
    modelEnv: 'LLM_MODEL',
    defaultModel: '',
    endpoint: `${(process.env.LLM_BASE_URL || '').replace(/\/+$/, '')}/chat/completions`,
    jsonMode: false,
    minIntervalMs: 500,
  },
  {
    name: 'Mistral',
    keyEnv: 'MISTRAL_API_KEY',
    modelEnv: 'MISTRAL_MODEL',
    defaultModel: 'mistral-medium-latest',
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    jsonMode: true,
    minIntervalMs: 1500, // il piano gratuito ha rate limit stretti
  },
  {
    name: 'NVIDIA',
    keyEnv: 'NVIDIA_API_KEY',
    modelEnv: 'NVIDIA_MODEL',
    defaultModel: 'mistralai/mistral-large',
    endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
    jsonMode: false,
    minIntervalMs: 1500,
  },
  {
    name: 'OpenRouter',
    keyEnv: 'OPENROUTER_API_KEY',
    modelEnv: 'OPENROUTER_MODEL',
    // I modelli ":free" sono gratuiti ma con limiti giornalieri; cambiano spesso nel tempo.
    defaultModel: 'google/gemma-4-31b-it:free',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    jsonMode: false,
    minIntervalMs: 3000,
  },
  {
    name: 'Gemini',
    keyEnv: 'GEMINI_API_KEY',
    modelEnv: 'GEMINI_MODEL',
    defaultModel: 'gemini-flash-latest',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    jsonMode: true,
    minIntervalMs: 4000,
  },
  {
    name: 'Groq',
    keyEnv: 'GROQ_API_KEY',
    modelEnv: 'GROQ_MODEL',
    defaultModel: 'llama-3.3-70b-versatile',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    jsonMode: true,
    minIntervalMs: 2000,
  },
  {
    name: 'Hugging Face',
    keyEnv: 'HF_TOKEN',
    modelEnv: 'HF_MODEL',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    endpoint: 'https://router.huggingface.co/v1/chat/completions',
    jsonMode: false,
    minIntervalMs: 500,
  },
];

function providers(): Provider[] {
  const list: Provider[] = [];
  for (const spec of SPECS) {
    const apiKey = process.env[spec.keyEnv];
    if (!apiKey) continue;
    const model = process.env[spec.modelEnv] || spec.defaultModel;
    if (spec.keyEnv === 'LLM_API_KEY' && (!process.env.LLM_BASE_URL || !model)) {
      console.warn('⚠️  LLM_API_KEY impostata ma mancano LLM_BASE_URL o LLM_MODEL: provider personalizzato ignorato');
      continue;
    }
    list.push({
      name: spec.name,
      endpoint: spec.endpoint,
      apiKey,
      model,
      jsonMode: spec.jsonMode,
      minIntervalMs: spec.minIntervalMs,
      lastCall: 0,
      cooldownUntil: 0,
      disabled: false,
    });
  }
  if (list.length === 0) {
    throw new Error(`Nessun LLM configurato: imposta almeno una tra ${SPECS.map((s) => s.keyEnv).join(', ')}`);
  }
  return list;
}

let chain: Provider[] | null = null;
const usage: Record<string, number> = {};

/** Estrae il primo oggetto JSON dal testo (tollera ```json e frasi di contorno). */
function extractJson<T>(raw: string): T {
  // I modelli "reasoning" possono premettere il ragionamento, che può contenere graffe.
  const content = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
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
    throw new UnavailableError(`${p.name} non raggiungibile: ${(err as Error).message}`);
  }

  if (res.status === 429) {
    throw new RateLimitError(`${p.name} 429: ${(await res.text()).trim().slice(0, 160)}`, retryAfterMs(res));
  }
  if (res.status >= 500) throw new RateLimitError(`${p.name} ${res.status}`, 5000);
  // Altri 4xx: chiave non valida, credito finito, modello inesistente… si passa al provider successivo.
  if (!res.ok) throw new UnavailableError(`${p.name} ${res.status}: ${(await res.text()).trim().slice(0, 160)}`);

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

/** Prova ogni provider configurato con una richiesta minima (usato da `npm run llm:check`). */
export async function checkProviders() {
  const results: { name: string; model: string; ok: boolean; detail: string }[] = [];
  for (const p of providers()) {
    const started = Date.now();
    try {
      const res = await call<{ ok?: unknown }>(p, 'Rispondi solo con JSON valido.', 'Rispondi esattamente: {"ok": true}', 0);
      results.push({ name: p.name, model: p.model, ok: res.ok === true, detail: `${Date.now() - started} ms` });
    } catch (err) {
      results.push({ name: p.name, model: p.model, ok: false, detail: (err as Error).message.replace(/\s+/g, ' ').slice(0, 140) });
    }
  }
  return results;
}
