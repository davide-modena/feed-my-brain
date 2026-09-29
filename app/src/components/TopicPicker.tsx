import { useState } from 'preact/hooks';
import type { Topic } from '../../../shared/types.ts';
import {
  COUNT_LIMITS,
  MAX_CARDS,
  totalCards,
  type Preferences,
  type SectionCounts,
} from '../storage.ts';

interface Props {
  topics: Topic[];
  initial: Preferences & { topics: string[] };
  submitLabel: string;
  onSubmit: (prefs: Preferences) => void;
}

const COUNT_ROWS: { key: keyof SectionCounts; label: string }[] = [
  { key: 'mondo', label: 'Mondo' },
  { key: 'italia', label: 'Italia' },
  { key: 'perTopic', label: 'Per ogni argomento' },
  { key: 'storia', label: 'Accadde oggi' },
  { key: 'curiosita', label: 'Curiosità storiche' },
];

/** Scelta degli argomenti e di quante card vedere per sezione (al massimo 10 in tutto). */
export function TopicPicker({ topics, initial, submitLabel, onSubmit }: Props) {
  const [selected, setSelected] = useState(new Set(initial.topics));
  const [counts, setCounts] = useState<SectionCounts>(initial.counts);
  const total = totalCards(counts, selected.size);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const change = (key: keyof SectionCounts, delta: number) =>
    setCounts({ ...counts, [key]: Math.min(COUNT_LIMITS[key], Math.max(0, counts[key] + delta)) });

  // Quante card aggiunge un "+": per "Per ogni argomento" una per ciascun argomento seguito.
  const cost = (key: keyof SectionCounts) => (key === 'perTopic' ? selected.size : 1);

  return (
    <div class="picker">
      <p class="label">Argomenti</p>
      <div class="chips">
        {topics.map((t) => {
          const on = selected.has(t.id);
          const blocked = !on && total + counts.perTopic > MAX_CARDS;
          return (
            <button
              key={t.id}
              class={`chip ${on ? 'is-on' : ''}`}
              aria-pressed={on}
              disabled={blocked}
              onClick={() => toggle(t.id)}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <p class="label">Quante card al giorno</p>
      <div class="counts">
        {COUNT_ROWS.map(({ key, label }) => (
          <div class="count-row" key={key}>
            <span>{label}</span>
            <div class="stepper">
              <button aria-label={`Meno ${label}`} disabled={counts[key] === 0} onClick={() => change(key, -1)}>
                −
              </button>
              <span>{counts[key]}</span>
              <button
                aria-label={`Più ${label}`}
                disabled={counts[key] >= COUNT_LIMITS[key] || total + cost(key) > MAX_CARDS}
                onClick={() => change(key, 1)}
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>
      <p class="muted small">
        {total} card al giorno, massimo {MAX_CARDS}. Metti 0 per nascondere una sezione.
      </p>

      <button
        class="btn btn-primary"
        onClick={() => onSubmit({ topics: topics.map((t) => t.id).filter((id) => selected.has(id)), counts })}
      >
        {submitLabel}
      </button>
    </div>
  );
}
