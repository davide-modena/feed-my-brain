import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App.tsx';
import './styles.css';

registerSW({
  immediate: true,
  // Un'app installata riprende da sospensione senza ricaricarsi (su iPhone resta in memoria per giorni):
  // senza un controllo esplicito non si accorgerebbe mai di una versione nuova e resterebbe sulla vecchia.
  // Quando ne trova una, il plugin la attiva e ricarica la pagina da solo.
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    const check = () => registration.update().catch(() => {}); // offline: si riprova al prossimo giro
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
    setInterval(check, 60 * 60 * 1000);
    check();
  },
});
render(<App />, document.getElementById('app')!);
