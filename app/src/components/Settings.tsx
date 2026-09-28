import { useEffect, useState } from 'preact/hooks';
import { fetchIndex } from '../api.ts';
import { longDate } from '../format.ts';
import type { Topic } from '../../../shared/types.ts';
import type { Preferences } from '../storage.ts';
import { TopicPicker } from './TopicPicker.tsx';
import { currentSubscription, pushConfigured, pushSupported, subscribe, testNotification } from '../push.ts';

interface Props {
  topics: Topic[];
  prefs: Preferences & { topics: string[] };
  onSavePrefs: (prefs: Preferences) => void;
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

export function Settings({ topics, prefs, onSavePrefs, onOpenEdition, onClose }: Props) {
  const [subscription, setSubscription] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [dates, setDates] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    currentSubscription().then((s) => s && setSubscription(JSON.stringify(s)));
    fetchIndex()
      .then((i) => setDates(i.dates))
      .catch(() => {});
  }, []);

  const enable = async () => {
    try {
      setStatus('');
      setSubscription(JSON.stringify(await subscribe()));
    } catch (err) {
      setStatus((err as Error).message);
    }
  };

  const copy = async () => {
    if (!subscription) return;
    await navigator.clipboard.writeText(subscription);
    setCopied(true);
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

      {topics.length > 0 && (
        <div class="setting">
          <p class="label">I tuoi argomenti</p>
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
          <p class="muted">
            Le notifiche non sono ancora configurate: genera le chiavi con <code>npm run vapid</code> (vedi README).
          </p>
        ) : subscription ? (
          <>
            <p>
              Notifiche attive su questo dispositivo. Copia il codice qui sotto e incollalo nel secret{' '}
              <code>PUSH_SUBSCRIPTION</code> del repo su GitHub: ogni mattina ti arriverà l'avviso.
            </p>
            <textarea class="code" readOnly rows={4} value={subscription} />
            <div class="row">
              <button class="btn" onClick={copy}>
                {copied ? 'Copiato ✓' : 'Copia codice'}
              </button>
              <button class="btn" onClick={() => testNotification()}>
                Prova notifica
              </button>
            </div>
          </>
        ) : (
          <button class="btn btn-primary" onClick={enable}>
            Attiva notifiche
          </button>
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
