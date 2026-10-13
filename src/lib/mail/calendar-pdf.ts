import { makeISODate, type ISODate } from "@/lib/dates";

/**
 * Calendario del corso allegato alla lettera d'incarico.
 *
 * Le mail di MAC non scrivono i giorni nel testo ("Frequenza: come da
 * calendario allegato"): le date stanno in un PDF con una tabella
 * "Giorno / Inizio / Fine", più la riga della pre-lezione. Qui si legge quella
 * tabella e basta: nessuna interpretazione, solo le righe che ci sono.
 */
export interface LezioneDatata {
  date: ISODate;
  startMin: number;
  endMin: number;
}

export interface CalendarioCorso {
  preLesson: LezioneDatata | null;
  lessons: LezioneDatata[];
}

/** "06/10/26" e "06/10/2026" sono la stessa data. */
function dataIT(giorno: string, mese: string, anno: string): ISODate | null {
  const y = anno.length === 2 ? 2000 + Number(anno) : Number(anno);
  const g = Number(giorno);
  const m = Number(mese);
  if (!(g >= 1 && g <= 31 && m >= 1 && m <= 12 && y >= 2000 && y <= 2100)) return null;
  return makeISODate(y, m, g);
}

/** Gli orari nei PDF arrivano sia come "18:00" sia come "18,00". */
const minuti = (ore: string, min: string) => Number(ore) * 60 + Number(min);

const RIGA = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2})[:.,](\d{2})\s*[-–]?\s*(\d{1,2})[:.,](\d{2})/g;
const PRELEZIONE =
  /pre-?lezione[^\d]{0,40}(\d{1,2})\/(\d{1,2})\/(\d{2,4})[^\d]{0,20}(\d{1,2})[:.,](\d{2})[^\d]{0,12}(\d{1,2})[:.,](\d{2})/i;

export function leggiCalendarioCorso(testoGrezzo: string): CalendarioCorso {
  const testo = (testoGrezzo ?? "").replace(/\s+/g, " ");

  let preLesson: LezioneDatata | null = null;
  const pre = PRELEZIONE.exec(testo);
  if (pre) {
    const date = dataIT(pre[1], pre[2], pre[3]);
    if (date) preLesson = { date, startMin: minuti(pre[4], pre[5]), endMin: minuti(pre[6], pre[7]) };
  }

  const lessons: LezioneDatata[] = [];
  const viste = new Set<string>();
  for (const riga of testo.matchAll(RIGA)) {
    const date = dataIT(riga[1], riga[2], riga[3]);
    if (!date) continue;
    const startMin = minuti(riga[4], riga[5]);
    const endMin = minuti(riga[6], riga[7]);
    if (endMin <= startMin) continue;
    // La pre-lezione compare anche in cima al foglio: non è una lezione.
    if (preLesson && preLesson.date === date && preLesson.startMin === startMin) continue;
    const chiave = `${date}|${startMin}|${endMin}`;
    if (viste.has(chiave)) continue;
    viste.add(chiave);
    lessons.push({ date, startMin, endMin });
  }
  lessons.sort((a, b) => (a.date === b.date ? a.startMin - b.startMin : a.date.localeCompare(b.date)));
  return { preLesson, lessons };
}

/** Riconosce il PDF del calendario dal nome del file o dal suo contenuto. */
export function eUnCalendario(nomeFile: string, testo: string): boolean {
  return /calendario/i.test(nomeFile) || /calendario\s+lezioni/i.test(testo);
}
