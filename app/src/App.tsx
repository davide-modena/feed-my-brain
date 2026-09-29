import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Edition } from '../../shared/types.ts';
import { fetchEdition, fetchToday } from './api.ts';
import { CardView } from './components/CardView.tsx';
import { QuizRunner } from './components/QuizRunner.tsx';
import { Results } from './components/Results.tsx';
import { Review } from './components/Review.tsx';
import { Settings } from './components/Settings.tsx';
import { Stage } from './components/Stage.tsx';
import { TopicPicker } from './components/TopicPicker.tsx';
import { longDate } from './format.ts';
import {
  activeTopics,
  applyTheme,
  completeToday,
  currentStreak,
  progressFor,
  quizItems,
  useStore,
  visibleCards,
  type EditionProgress,
  type Preferences,
  type Theme,
} from './storage.ts';

type View = 'onboarding' | 'read' | 'quiz' | 'results' | 'review' | 'settings';

export function App() {
  const [store, update] = useStore();
  const [edition, setEdition] = useState<Edition | null>(null);
  const [latestDate, setLatestDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('read');
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [direction, setDirection] = useState<'next' | 'prev'>('next');

  useLayoutEffect(() => applyTheme(store.theme), [store.theme]);

  // Letti anche dai listener registrati una volta sola: servono sempre i valori aggiornati.
  const storeRef = useRef(store);
  storeRef.current = store;
  /** `generatedAt` dell'ultima edizione scaricata, per accorgersi di quella nuova. */
  const latestGenerated = useRef<string | null>(null);

  const open = (ed: Edition) => {
    const s = storeRef.current;
    setEdition(ed);
    setPage(0);
    if (s.prefs.topics === null && (ed.topics?.length ?? 0) > 0) setView('onboarding');
    else setView(progressFor(s, ed).done ? 'results' : 'read');
  };

  const loadLatest = () =>
    fetchToday().then((ed) => {
      if (ed.generatedAt === latestGenerated.current) return; // niente di nuovo
      latestGenerated.current = ed.generatedAt;
      setLatestDate(ed.date);
      open(ed);
    });

  useEffect(() => {
    loadLatest().catch((err) => setError((err as Error).message));
    // Un'app installata resta aperta in background per giorni: quando torna in primo piano
    // (anche da una notifica) controlla se è uscita un'edizione nuova e, nel caso, la apre.
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadLatest().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const streak = currentStreak(store.streak);
  if (error) return <Shell streak={streak}><p class="panel error">{error}</p></Shell>;
  if (!edition) return <Shell streak={streak}><p class="panel muted">Carico l'edizione…</p></Shell>;

  const cards = visibleCards(edition, store.prefs);
  const questions = quizItems(cards);
  const progress: EditionProgress = progressFor(store, edition);
  const index = Math.min(progress.index, cards.length); // cards.length = schermata "quiz finale"
  const card = cards[index];

  const setProgress = (fn: (p: EditionProgress) => EditionProgress) =>
    update((s) => ({
      ...s,
      progress: { ...s.progress, [edition.date]: fn(progressFor(s, edition)) },
    }));

  const goCard = (i: number, dir: 'next' | 'prev') => {
    if (i < 0 || i > cards.length) return;
    setDirection(dir);
    setPage(0);
    setPages(1);
    setProgress((p) => ({ ...p, index: i }));
  };

  const finish = () => {
    update((s) =>
      completeToday({ ...s, progress: { ...s.progress, [edition.date]: { ...progress, done: true } } }),
    );
    navigator.clearAppBadge?.().catch(() => {});
    setView('results');
  };

  const startQuiz = () => (questions.length ? setView('quiz') : finish());

  const setTheme = (theme: Theme) => update((s) => ({ ...s, theme }));

  const savePrefs = (prefs: Preferences) => {
    update((s) => ({ ...s, prefs }));
    setView(progress.done ? 'results' : 'read');
  };

  const openArchive = async (date: string) => {
    try {
      open(await fetchEdition(date));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const prefsWithTopics = { ...store.prefs, topics: activeTopics(edition, store.prefs) };

  return (
    <Shell
      streak={streak}
      dateLabel={longDate(edition.date)}
      onSettings={
        view === 'onboarding'
          ? undefined
          : () => setView(view === 'settings' ? (progress.done ? 'results' : 'read') : 'settings')
      }
    >
      {view === 'onboarding' && (
        <section class="panel">
          <h2 class="panel-title">Cosa ti interessa?</h2>
          <p class="muted">Ogni mattina riceverai le notizie più importanti su questi argomenti.</p>
          <TopicPicker
            topics={edition.topics ?? []}
            initial={prefsWithTopics}
            submitLabel="Inizia a leggere"
            onSubmit={savePrefs}
          />
        </section>
      )}

      {view === 'read' && (
        <>
          <div class="progress" aria-label={`Notizia ${Math.min(index + 1, cards.length)} di ${cards.length}`}>
            {cards.map((c, i) => (
              <span key={c.id} class={i < index ? 'is-past' : i === index ? 'is-current' : ''} />
            ))}
            <span class={`is-quiz ${index === cards.length ? 'is-current' : ''}`} />
          </div>
          <Stage
            slideKey={card ? card.id : 'quiz-intro'}
            direction={direction}
            onNext={() => (card ? goCard(index + 1, 'next') : startQuiz())}
            onPrev={() => goCard(index - 1, 'prev')}
            onTapRight={() => {
              if (!card) return;
              if (page < pages - 1) setPage(page + 1);
              else goCard(index + 1, 'next');
            }}
            onTapLeft={() => {
              if (page > 0) setPage(page - 1);
              else goCard(index - 1, 'prev');
            }}
          >
            {card ? (
              <CardView card={card} page={page} pages={pages} onPages={setPages} />
            ) : (
              <section class="panel quiz-intro">
                <h2 class="panel-title">Hai letto tutto</h2>
                <p class="muted">
                  {questions.length
                    ? `Ora ${questions.length} domande veloci per fissare quello che hai letto.`
                    : 'Per oggi è tutto.'}
                </p>
                <button class="btn btn-primary" onClick={startQuiz}>
                  {questions.length ? 'Inizia il quiz' : 'Concludi'}
                </button>
              </section>
            )}
          </Stage>
          <nav class="pager">
            <button
              class="btn-icon"
              aria-label="Precedente"
              disabled={index === 0}
              onClick={() => goCard(index - 1, 'prev')}
            >
              ‹
            </button>
            <span class="muted small">{card ? `${index + 1} / ${cards.length}` : 'Quiz'}</span>
            <button
              class="btn-icon"
              aria-label="Successiva"
              onClick={() => (card ? goCard(index + 1, 'next') : startQuiz())}
            >
              ›
            </button>
          </nav>
        </>
      )}

      {view === 'quiz' && (
        <QuizRunner
          items={questions}
          answers={progress.answers}
          onAnswer={(key, choice) => setProgress((p) => ({ ...p, answers: { ...p.answers, [key]: choice } }))}
          onFinish={finish}
        />
      )}

      {view === 'results' && (
        <Results
          items={questions}
          answers={progress.answers}
          streak={streak}
          isLatest={edition.date === latestDate}
          onReview={() => setView('review')}
          onReread={() => {
            goCard(0, 'prev');
            setView('read');
          }}
        />
      )}

      {view === 'review' && <Review store={store} currentDate={edition.date} onClose={() => setView('results')} />}

      {view === 'settings' && (
        <Settings
          topics={edition.topics ?? []}
          prefs={prefsWithTopics}
          onSavePrefs={savePrefs}
          theme={store.theme}
          onTheme={setTheme}
          onOpenEdition={openArchive}
          onClose={() => setView(progress.done ? 'results' : 'read')}
        />
      )}
    </Shell>
  );
}

function Shell({
  children,
  streak,
  dateLabel,
  onSettings,
}: {
  children: ComponentChildren;
  streak: number;
  dateLabel?: string;
  onSettings?: () => void;
}) {
  return (
    <div class="app">
      <header class="topbar">
        <div>
          <h1 class="brand">Feed My Brain</h1>
          {dateLabel && <p class="date">{dateLabel}</p>}
        </div>
        <div class="topbar-actions">
          <span class="streak" title="Giorni di fila">
            {streak} {streak === 1 ? 'giorno' : 'giorni'}
          </span>
          {onSettings && (
            <button class="btn-icon" onClick={onSettings} aria-label="Impostazioni">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.4" />
              </svg>
            </button>
          )}
        </div>
      </header>
      <main class="main">{children}</main>
    </div>
  );
}
