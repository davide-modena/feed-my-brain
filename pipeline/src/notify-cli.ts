/** Invia le notifiche per l'ultima edizione (usato dal workflow dopo il deploy). */
import { notify } from './notify.ts';
import { listEditionDates, readEdition } from './store.ts';

const [latest] = listEditionDates();
if (!latest) {
  console.log('Nessuna edizione da notificare');
} else {
  await notify(readEdition(latest));
}
