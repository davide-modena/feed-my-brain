import { useEffect, useState } from 'preact/hooks';
import { fetchEdition, fetchIndex } from '../api.ts';
import { quizItems, visibleCards, type QuizItem, type StoreState } from '../storage.ts';
import { QuizRunner } from './QuizRunner.tsx';

const REVIEW_SIZE = 3;
const LOOKBACK_DAYS = 10;

function shuffle<T>(items: T[]) {
  return [...items].sort(() => Math.random() - 0.5);
}

/** Ripasso: domande dalle edizioni passate, prima quelle sbagliate. */
export function Review({ store, currentDate, onClose }: { store: StoreState; currentDate: string; onClose: () => void }) {
  const [items, setItems] = useState<QuizItem[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});

  useEffect(() => {
    (async () => {
      const index = await fetchIndex();
      const dates = index.dates.filter((d) => d < currentDate).slice(0, LOOKBACK_DAYS);
      const editions = await Promise.all(dates.map((d) => fetchEdition(d).catch(() => null)));
      const wrong: QuizItem[] = [];
      const rest: QuizItem[] = [];
      for (const ed of editions) {
        if (!ed) continue;
        const given = store.progress[ed.date]?.answers ?? {};
        for (const item of quizItems(visibleCards(ed, store.prefs))) {
          const g = given[item.key];
          (g !== undefined && g !== item.question.answer ? wrong : rest).push(item);
        }
      }
      setItems([...shuffle(wrong), ...shuffle(rest)].slice(0, REVIEW_SIZE));
    })().catch(() => setItems([]));
  }, [currentDate]);

  if (items === null) return <p class="panel muted">Carico le domande…</p>;
  if (items.length === 0)
    return (
      <section class="panel">
        <p>Il ripasso si sblocca dopo qualche giorno di letture: torna domani.</p>
        <button class="btn" onClick={onClose}>
          Indietro
        </button>
      </section>
    );

  return (
    <QuizRunner
      items={items}
      answers={answers}
      onAnswer={(key, c) => setAnswers({ ...answers, [key]: c })}
      onFinish={onClose}
      finishLabel="Fine ripasso"
    />
  );
}
