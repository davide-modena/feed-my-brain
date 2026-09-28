import { useState } from 'preact/hooks';
import type { Topic } from '../../../shared/types.ts';
import type { Preferences } from '../storage.ts';

interface Props {
  topics: Topic[];
  initial: Preferences & { topics: string[] };
  submitLabel: string;
  onSubmit: (prefs: Preferences) => void;
}

/** Scelta degli argomenti da seguire, più storia e curiosità. */
export function TopicPicker({ topics, initial, submitLabel, onSubmit }: Props) {
  const [selected, setSelected] = useState(new Set(initial.topics));
  const [storia, setStoria] = useState(initial.storia);
  const [curiosita, setCuriosita] = useState(initial.curiosita);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  return (
    <div class="picker">
      <div class="chips">
        {topics.map((t) => (
          <button
            key={t.id}
            class={`chip ${selected.has(t.id) ? 'is-on' : ''}`}
            aria-pressed={selected.has(t.id)}
            onClick={() => toggle(t.id)}
          >
            {t.label}
          </button>
        ))}
        <button class={`chip ${storia ? 'is-on' : ''}`} aria-pressed={storia} onClick={() => setStoria(!storia)}>
          Accadde oggi
        </button>
        <button
          class={`chip ${curiosita ? 'is-on' : ''}`}
          aria-pressed={curiosita}
          onClick={() => setCuriosita(!curiosita)}
        >
          Curiosità storiche
        </button>
      </div>
      <p class="muted small">L'attualità c'è sempre. Puoi cambiare idea quando vuoi dalle impostazioni.</p>
      <button
        class="btn btn-primary"
        onClick={() =>
          onSubmit({ topics: topics.map((t) => t.id).filter((id) => selected.has(id)), storia, curiosita })
        }
      >
        {submitLabel}
      </button>
    </div>
  );
}
