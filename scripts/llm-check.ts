/** Verifica quali chiavi LLM funzionano, con una richiesta minima per provider. */
import { checkProviders } from '../pipeline/src/llm.ts';

for (const r of await checkProviders()) {
  console.log(`${r.ok ? '✅' : '❌'} ${r.name} (${r.model}): ${r.detail}`);
}
