/**
 * Client LLM con fallback: prova Mistral e, se ha esaurito i limiti o non risponde,
 * passa a Hugging Face (Inference Providers, API compatibile OpenAI) per il resto dell'esecuzione.
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
}

class QuotaError extends Error {}

function providers(): Provider[] {
  const list: Provider[] = [];
  if (process.env.MISTRAL_API_KEY) {
    list.push({
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
let lastCall = 0;

/** Estrae il primo oggetto JSON dal testo (tollera ```json e frasi di contorno). */
function extractJson<T>(content: string): T {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('nessun JSON nella risposta');
  return JSON.parse(content.slice(start, end + 1)) as T;
}

async function call<T>(p: Provider, system: string, user: string, temperature: number): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const wait = lastCall + p.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();

    let res: Response;
    try {
      res = await fetch(p.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: p.model,
          temperature,
          max_tokens: 2000,
          ...(p.jsonMode && { response_format: { type: 'json_object' } }),
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      if (attempt < 3) continue;
      throw new QuotaError(`${p.name} non raggiungibile: ${(err as Error).message}`);
    }

    // 429: rate limit momentaneo o quota esaurita; 401/402/403: chiave o credito non validi.
    // Un solo tentativo in più sul 429, poi si passa al provider successivo.
    if ([401, 402, 403, 429].includes(res.status)) {
      if (res.status === 429 && attempt < 2) {
        await sleep(3000);
        continue;
      }
      throw new QuotaError(`${p.name} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    if (res.status >= 500) {
      if (attempt < 3) {
        await sleep(2 ** attempt * 1000);
        continue;
      }
      throw new QuotaError(`${p.name} ${res.status}`);
    }
    if (!res.ok) throw new Error(`${p.name} ${res.status}: ${(await res.text()).slice(0, 300)}`);

    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    const content = data.choices[0]?.message.content ?? '';
    try {
      return extractJson<T>(content);
    } catch {
      if (attempt < 3) continue;
      throw new Error(`Risposta non JSON da ${p.name}: ${content.slice(0, 200)}`);
    }
  }
}

export async function chatJson<T>(system: string, user: string, temperature = 0.4): Promise<T> {
  chain ??= providers();
  while (chain.length > 0) {
    const p = chain[0];
    try {
      return await call<T>(p, system, user, temperature);
    } catch (err) {
      if (!(err instanceof QuotaError) || chain.length === 1) throw err;
      chain.shift(); // da qui in poi usa il provider successivo
      console.warn(`↪️  ${err.message}\n   Passo a ${chain[0].name} (${chain[0].model})`);
    }
  }
  throw new Error('Nessun LLM disponibile');
}

export function activeProvider() {
  const p = (chain ??= providers())[0];
  return `${p.name} (${p.model})`;
}
