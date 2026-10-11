/**
 * Controlli sul testo generato dal modello. Un errore qui non ferma l'edizione: la card viene
 * riscritta passando al modello l'elenco dei problemi trovati (vedi writeCard in editor.ts).
 */

// Latino e greco (nomi, formule) sono ammessi; "Common" copre cifre, punteggiatura, simboli, emoji.
// Tutto il resto (devanagari, cirillico, cinese, arabo…) in un testo italiano è un errore del modello.
const FOREIGN_SCRIPT = /[^\p{Script=Latin}\p{Script=Greek}\p{Script=Common}\p{Script=Inherited}]/u;

// Parole funzionali inequivocabilmente inglesi / italiane, per riconoscere un testo nella lingua sbagliata.
const ENGLISH = new Set(
  'the and of with which that was were has have had their from this these are been they will its for by but not who after would could also than when into'.split(
    ' ',
  ),
);
const ITALIAN = new Set(
  'il lo la le gli di del della dei delle che per con una un è sono nel nella nei anche come non più ma dal dalla al alla sul sulla ha hanno essere questo questa'.split(
    ' ',
  ),
);

const MONTHS = [
  'gennaio',
  'febbraio',
  'marzo',
  'aprile',
  'maggio',
  'giugno',
  'luglio',
  'agosto',
  'settembre',
  'ottobre',
  'novembre',
  'dicembre',
];
// Senza accenti: il testo viene normalizzato prima del confronto.
const WEEKDAYS = ['domenica', 'lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi', 'sabato'];
const WEEKDAYS_LABEL = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

/** "martedì 6 ottobre 2026", per dire al modello che giorno è oggi. */
export function longDateIt(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return `${WEEKDAYS_LABEL[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const strip = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

// "sabato 6 ottobre" senza l'anno subito dopo (con l'anno è quasi sempre una data storica).
const WEEKDAY_DATE = new RegExp(
  `\\b(${WEEKDAYS.join('|')})\\s+(\\d{1,2})\\s+(${MONTHS.join('|')})\\b(?!\\s+\\d{3,4})`,
  'g',
);

/** Caratteri di alfabeti non ammessi, per il messaggio al modello. */
function foreignScripts(text: string): string[] {
  return [...new Set([...text].filter((ch) => FOREIGN_SCRIPT.test(ch)))].slice(0, 8);
}

/** True se il testo è scritto soprattutto in inglese. */
export function looksEnglish(text: string): boolean {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  let en = 0;
  let it = 0;
  for (const w of words) {
    if (ENGLISH.has(w)) en++;
    else if (ITALIAN.has(w)) it++;
  }
  return en >= 5 && en * 2 > it;
}

/** Giorni della settimana che non corrispondono alla data (es. "sabato 6 ottobre" nel 2026 è martedì). */
function wrongWeekdays(text: string, today: string): string[] {
  const now = Date.parse(`${today}T12:00:00Z`);
  const year = new Date(now).getUTCFullYear();
  const problems: string[] = [];
  for (const m of strip(text).matchAll(WEEKDAY_DATE)) {
    const [whole, weekday, dayStr, month] = m;
    const day = Number(dayStr);
    const monthIndex = MONTHS.indexOf(month);
    // L'occorrenza della data più vicina a oggi (a cavallo d'anno può essere l'anno prima o dopo).
    const candidate = [year - 1, year, year + 1]
      .map((y) => Date.UTC(y, monthIndex, day, 12))
      .sort((a, b) => Math.abs(a - now) - Math.abs(b - now))[0];
    const realIndex = new Date(candidate).getUTCDay();
    if (WEEKDAYS[realIndex] !== weekday) {
      problems.push(
        `"${whole}" è sbagliato: quel giorno è ${WEEKDAYS_LABEL[realIndex]}. Non indicare il giorno della settimana se non è nel materiale: usa "oggi", "ieri" o la sola data`,
      );
    }
  }
  return problems;
}

/**
 * Restituisce i problemi trovati nei testi di una card (vuoto = ok).
 * `news`: notizie recenti, dove le date relative a oggi vanno controllate.
 */
export function checkCardText(texts: string[], opts: { date: string; news: boolean }): string[] {
  const text = texts.filter((t) => typeof t === 'string').join('\n');
  const problems: string[] = [];

  const foreign = foreignScripts(text);
  if (foreign.length > 0) {
    problems.push(
      `contiene caratteri di un altro alfabeto (${foreign.join(' ')}): usa solo l'alfabeto latino e traslittera i nomi stranieri`,
    );
  }
  if (looksEnglish(text)) {
    problems.push("è scritto in inglese: deve essere interamente in italiano, titolo, domande e opzioni compresi");
  }
  if (opts.news) problems.push(...wrongWeekdays(text, opts.date));
  return problems;
}
