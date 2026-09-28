import type { QuizItem } from '../storage.ts';

interface Props {
  items: QuizItem[];
  answers: Record<string, number>;
  streak: number;
  isLatest: boolean;
  onReview: () => void;
  onReread: () => void;
}

export function Results({ items, answers, streak, isLatest, onReview, onReread }: Props) {
  const correct = items.filter((it) => answers[it.key] === it.question.answer).length;

  return (
    <section class="panel results">
      <p class="muted">{isLatest ? 'Per oggi hai finito.' : 'Edizione completata.'}</p>
      <div class="stats">
        <div class="stat">
          <span class="stat-value">
            {correct}/{items.length}
          </span>
          <span class="muted">risposte giuste</span>
        </div>
        <div class="stat">
          <span class="stat-value">{streak}</span>
          <span class="muted">{streak === 1 ? 'giorno di fila' : 'giorni di fila'}</span>
        </div>
      </div>
      <div class="stack">
        <button class="btn btn-primary" onClick={onReview}>
          Ripassa i giorni scorsi
        </button>
        <button class="btn" onClick={onReread}>
          Rileggi le notizie
        </button>
      </div>
      {isLatest && <p class="muted small">La prossima edizione arriva domattina.</p>}
    </section>
  );
}
