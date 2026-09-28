import { useState } from 'preact/hooks';
import type { QuizItem } from '../storage.ts';

interface Props {
  items: QuizItem[];
  answers: Record<string, number>;
  onAnswer: (key: string, choice: number) => void;
  onFinish: () => void;
  finishLabel?: string;
}

/** Quiz a una domanda per schermata. */
export function QuizRunner({ items, answers, onAnswer, onFinish, finishLabel = 'Vedi il risultato' }: Props) {
  // Riparte dalla prima domanda senza risposta (utile se chiudi l'app a metà).
  const firstOpen = items.findIndex((it) => answers[it.key] === undefined);
  const [index, setIndex] = useState(firstOpen === -1 ? 0 : firstOpen);

  const item = items[index];
  if (!item) return null;
  const chosen = answers[item.key];
  const answered = chosen !== undefined;
  const correct = chosen === item.question.answer;
  const isLast = index === items.length - 1;

  return (
    <section class="quiz-screen">
      <div class="quiz-progress">
        <span>
          Domanda {index + 1} di {items.length}
        </span>
        <div class="bar">
          <div style={{ width: `${((index + (answered ? 1 : 0)) / items.length) * 100}%` }} />
        </div>
      </div>
      <p class="quiz-source">{item.cardTitle}</p>
      <h2 class="quiz-question">{item.question.question}</h2>
      <div class="options">
        {item.question.options.map((opt, i) => {
          let state = '';
          if (answered && i === item.question.answer) state = 'is-correct';
          else if (answered && i === chosen) state = 'is-wrong';
          return (
            <button key={i} class={`option ${state}`} disabled={answered} onClick={() => onAnswer(item.key, i)}>
              {opt}
            </button>
          );
        })}
      </div>
      <div class="quiz-footer">
        {answered && (
          <p class={`feedback ${correct ? 'is-correct' : 'is-wrong'}`}>
            <strong>{correct ? 'Giusto.' : 'Sbagliato.'}</strong> {item.question.explanation}
          </p>
        )}
        {answered && (
          <button class="btn btn-primary" onClick={() => (isLast ? onFinish() : setIndex(index + 1))}>
            {isLast ? finishLabel : 'Avanti'}
          </button>
        )}
      </div>
    </section>
  );
}
