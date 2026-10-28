import { useEffect, useState } from 'preact/hooks';
import { fetchIndex } from '../api.ts';
import { longDate } from '../format.ts';
import type { Topic } from '../../../shared/types.ts';
import { THEMES, type Preferences, type Theme } from '../storage.ts';
import { TopicPicker } from './TopicPicker.tsx';
import { disablePush, enablePush, isRegistered, pushConfigured, pushSupported, testNotification } from '../push.ts';

interface Props {
  topics: Topic[];
  prefs: Preferences & { topics: string[] };
  onSavePrefs: (prefs: Preferences) => void;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  onOpenEdition: (date: string) => void;
  onClose: () => void;
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

let deferredInstall: InstallPromptEvent | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e as InstallPromptEvent;
});

export function Settings({ topics, prefs, onSavePrefs, theme, onTheme, onOpenEdition, onClose }: Props) {
  // null = sto controllando; true = questo dispositivo è registrato sul server.
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [dates, setDates] = useState<string[]>([]);

  const refreshStatus = () =>
    isRegistered()
      .then(setRegistered)
      .catch(() => setRegistered(false));

  useEffect(() => {
    if (pushSupported() && pushConfigured()) refreshStatus();
    else setRegistered(false);
    fetchIndex()
      .then((i) => setDates(i.dates))
      .catch(() => {});
  }, []);

  const toggle = async (enable: boolean) => {
    setBusy(true);
    setStatus('');
    try {
      if (enable) await enablePush();
      else await disablePush();
      await refreshStatus();
    } catch (err) {
      setStatus((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const standalone = window.matchMedia('(display-mode: standalone)').matches;
  const isIOS = /iPhone|iPad/.test(navigator.userAgent);

  return (
    <section class="panel">
      <div class="panel-head">
        <h2 class="panel-title">Impostazioni</h2>
        <button class="btn" onClick={onClose}>
          Chiudi
        </button>
      </div>

      <div class="setting">
        <p class="label">Tema</p>
        <div class="chips">
          {THEMES.map((t) => (
            <button
              key={t.id}
              class={`chip ${theme === t.id ? 'is-on' : ''}`}
              aria-pressed={theme === t.id}
              onClick={() => onTheme(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {topics.length > 0 && (
        <div class="setting">
          <p class="label">Cosa leggere</p>
          <TopicPicker topics={topics} initial={prefs} submitLabel="Salva" onSubmit={onSavePrefs} />
        </div>
      )}

      <div class="setting">
        <p class="label">Notifica mattutina</p>
        {!pushSupported() ? (
          <p class="muted">
            Questo browser non supporta le notifiche push.
            {isIOS && !standalone && ' Su iPhone prima aggiungi l\'app alla schermata Home (Condividi → Aggiungi a Home).'}
          </p>
        ) : !pushConfigured() ? (
          <p class="muted">Le notifiche non sono ancora configurate sul server.</p>
        ) : registered === null ? (
          <p class="muted">Controllo lo stato…</p>
        ) : registered ? (
          <>
            <p>Attive su questo dispositivo: ogni mattina ti avviso quando l'edizione è pronta.</p>
            <div class="row">
              <button class="btn" disabled={busy} onClick={() => testNotification()}>
                Prova notifica
              </button>
              <button class="btn" disabled={busy} onClick={() => toggle(false)}>
                Disattiva
              </button>
            </div>
          </>
        ) : (
          <>
            <p class="muted">Ricevi un avviso la mattina, quando l'edizione è pronta.</p>
            <button class="btn btn-primary" disabled={busy} onClick={() => toggle(true)}>
              {busy ? 'Attivo…' : 'Attiva notifiche'}
            </button>
          </>
        )}
        {status && <p class="error">{status}</p>}
      </div>

      {!standalone && (
        <div class="setting">
          <p class="label">Installa l'app</p>
          {deferredInstall ? (
            <button class="btn" onClick={() => deferredInstall?.prompt()}>
              Aggiungi alla schermata Home
            </button>
          ) : (
            <p class="muted">
              Dal menu del browser scegli "Installa app" oppure "Aggiungi a schermata Home".
            </p>
          )}
        </div>
      )}

      <div class="setting">
        <p class="label">Archivio</p>
        <ul class="archive">
          {dates.map((d) => (
            <li key={d}>
              <button class="link" onClick={() => onOpenEdition(d)}>
                {longDate(d)}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
