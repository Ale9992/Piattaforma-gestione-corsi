import { addDays, weekdayOf, type ISODate, type Weekday } from "@/lib/dates";
import type { LezioneDatata } from "@/lib/mail/calendar-pdf";
import { recalculateSchedule } from "./recalculateSchedule";
import { weekdaysToMask, type PauseInput, type ScheduleRuleInput } from "./types";

/**
 * Dalle date di un calendario alle regole del gestionale.
 *
 * Il calendario allegato all'incarico elenca le lezioni una per una; il
 * gestionale invece ragiona per regole ("venerdì 9:30–11 dal 23 ottobre"), che
 * è ciò che permette poi di spostare, annullare e recuperare. Qui si ricavano
 * le regole dalle date — e soprattutto si VERIFICA che rigenerandole escano
 * esattamente quelle date: se non tornano non si indovina, si ripiega sulle
 * date fisse.
 */

/** Giorni della settimana con lo stesso orario, dentro una fase. */
export interface BloccoFase {
  weekdays: Weekday[];
  startMin: number;
  endMin: number;
  /** Prima data in cui questi giorni compaiono: può essere dopo l'inizio della fase. */
  from: ISODate;
}

export interface Fase {
  from: ISODate;
  /** Ultimo giorno della fase; `null` sull'ultima, che resta aperta ai recuperi. */
  to: ISODate | null;
  blocks: BloccoFase[];
}

const orario = (l: LezioneDatata) => `${l.startMin}-${l.endMin}`;

/** Primo giorno `giorno` a partire da `da` (incluso). */
function primaOccorrenza(da: ISODate, giorno: Weekday): ISODate {
  const scarto = (giorno - weekdayOf(da) + 7) % 7;
  return scarto === 0 ? da : addDays(da, scarto);
}

const ordina = (lessons: readonly LezioneDatata[]) =>
  [...lessons].sort((a, b) => (a.date === b.date ? a.startMin - b.startMin : a.date.localeCompare(b.date)));

/**
 * Le date si spezzano in fasi: una fase nuova si apre quando un giorno della
 * settimana torna con un orario diverso da quello che aveva.
 *
 * Giorni diversi con orari diversi convivono nella stessa fase — giovedì 11–13
 * e venerdì 9:30–11 sono due righe orario, non due fasi — e ognuno porta la data
 * da cui parte, perché il secondo giorno spesso si aggiunge a corso iniziato.
 */
export function fasiDaDate(lessons: readonly LezioneDatata[]): Fase[] {
  const fasi: Fase[] = [];
  let corrente: { from: ISODate; ultima: ISODate; giorni: Map<Weekday, { orario: string; from: ISODate }> } | null =
    null;

  const chiudi = () => {
    if (!corrente) return;
    const per = new Map<string, BloccoFase>();
    for (const [giorno, dato] of corrente.giorni) {
      // Un giorno che compare alla sua prima occasione utile non "parte dopo":
      // vale dall'inizio della fase, e si può unire agli altri dello stesso
      // orario. Chi compare più tardi di così si è aggiunto a corso iniziato e
      // tiene la sua data.
      const daInizio = dato.from === primaOccorrenza(corrente.from, giorno);
      const from = daInizio ? corrente.from : dato.from;
      const chiave = `${dato.orario}|${from}`;
      const esistente = per.get(chiave);
      if (esistente) esistente.weekdays.push(giorno);
      else {
        const [startMin, endMin] = dato.orario.split("-").map(Number);
        per.set(chiave, { weekdays: [giorno], startMin, endMin, from });
      }
    }
    const blocks = [...per.values()]
      .map((b) => ({ ...b, weekdays: [...b.weekdays].sort((a, c) => a - c) }))
      .sort((a, b) => a.from.localeCompare(b.from) || a.startMin - b.startMin);
    fasi.push({ from: corrente.from, to: corrente.ultima, blocks });
  };

  for (const lezione of ordina(lessons)) {
    const giorno = weekdayOf(lezione.date);
    const suo = orario(lezione);
    const gia = corrente?.giorni.get(giorno);
    if (corrente && gia && gia.orario !== suo) {
      chiudi();
      corrente = null;
    }
    if (!corrente) corrente = { from: lezione.date, ultima: lezione.date, giorni: new Map() };
    if (!corrente.giorni.has(giorno)) corrente.giorni.set(giorno, { orario: suo, from: lezione.date });
    corrente.ultima = lezione.date;
  }
  chiudi();

  // L'ultima fase resta aperta: i recuperi delle lezioni annullate vanno in coda.
  if (fasi.length > 0) fasi[fasi.length - 1] = { ...fasi[fasi.length - 1], to: null };
  return fasi;
}

/**
 * Una fase per lezione: fedele per costruzione, qualunque sia il calendario.
 *
 * È il ripiego per i calendari senza ritmo — una data saltata, un orario
 * diverso una volta sola — dove nessuna regola settimanale riprodurrebbe le
 * date. Il calendario resta quello dell'agenzia, ma non si pretende di
 * raccontarlo come una frequenza.
 */
export function fasiPerLezione(lessons: readonly LezioneDatata[]): Fase[] {
  const ordinate = ordina(lessons);
  return ordinate.map((l, i) => ({
    from: l.date,
    to: i === ordinate.length - 1 ? null : l.date,
    blocks: [{ weekdays: [weekdayOf(l.date)], startMin: l.startMin, endMin: l.endMin, from: l.date }],
  }));
}

/** Regole pronte da scrivere, ricavate dalle fasi. */
export function regoleDaFasi(fasi: readonly Fase[]): ScheduleRuleInput[] {
  const out: ScheduleRuleInput[] = [];
  for (const fase of fasi) {
    for (const blocco of fase.blocks) {
      out.push({
        id: -(out.length + 1),
        validFrom: blocco.from > fase.from ? blocco.from : fase.from,
        validTo: fase.to,
        weekdaysMask: weekdaysToMask(blocco.weekdays),
        startMin: blocco.startMin,
        endMin: blocco.endMin,
      });
    }
  }
  return out;
}

export interface Verifica {
  ok: boolean;
  /** Lezioni del calendario che le regole non generano. */
  mancanti: LezioneDatata[];
  /** Lezioni che le regole generano e che nel calendario non ci sono. */
  inPiu: LezioneDatata[];
}

/**
 * Le regole rigenerano esattamente il calendario allegato? È la prova che
 * permette di creare il corso senza ricopiare venti date a mano.
 */
export function verificaFasi(
  fasi: readonly Fase[],
  lessons: readonly LezioneDatata[],
  totalMinutes: number,
  pauses: readonly PauseInput[] = [],
): Verifica {
  if (fasi.length === 0 || lessons.length === 0) return { ok: false, mancanti: [...lessons], inPiu: [] };
  const generato = recalculateSchedule({
    courseStartDate: fasi[0].from,
    totalMinutes,
    rules: regoleDaFasi(fasi),
    pauses,
    existing: [],
  });

  const chiave = (l: LezioneDatata) => `${l.date}|${l.startMin}|${l.endMin}`;
  const attese = new Map(lessons.map((l) => [chiave(l), l]));
  const ottenute = new Map(
    generato.lessons.map((l) => [chiave(l), { date: l.date, startMin: l.startMin, endMin: l.endMin }]),
  );

  const mancanti = [...attese].filter(([k]) => !ottenute.has(k)).map(([, l]) => l);
  const inPiu = [...ottenute].filter(([k]) => !attese.has(k)).map(([, l]) => l);
  return { ok: mancanti.length === 0 && inPiu.length === 0, mancanti, inPiu };
}

/**
 * Le date che il ritmo genererebbe ma il calendario non ha, raccolte in
 * intervalli contigui: sono le interruzioni del corso.
 *
 * Un calendario che salta il 24 e il 31 dicembre non è senza ritmo — è un corso
 * con una pausa di Natale. Le feste nazionali il motore le conosce già; le
 * chiusure decise dal cliente no, e stanno scritte solo nei buchi del
 * calendario.
 */
export function pauseDaiBuchi(inPiu: readonly LezioneDatata[]): PauseInput[] {
  const date = [...new Set(inPiu.map((l) => l.date))].sort();
  const out: PauseInput[] = [];
  for (const data of date) {
    const ultima = out.at(-1);
    // Due date nella stessa settimana stanno nella stessa interruzione.
    if (ultima && data <= addDays(ultima.endDate, 7)) ultima.endDate = data;
    else out.push({ startDate: data, endDate: data });
  }
  return out;
}

/**
 * Le fasi con cui creare il corso. Si prova il ritmo; se non torna si guarda se
 * i buchi sono interruzioni, e solo come ultima cosa si tengono le date fisse
 * una per una. Qualunque strada, le lezioni generate sono esattamente quelle
 * del calendario — è la verifica a deciderlo, non una somiglianza.
 */
export function fasiDelCalendario(
  lessons: readonly LezioneDatata[],
  totalMinutes: number,
): { fasi: Fase[]; pauses: PauseInput[]; ok: boolean; aRitmo: boolean } {
  const ritmo = fasiDaDate(lessons);
  const primo = verificaFasi(ritmo, lessons, totalMinutes);
  if (primo.ok) return { fasi: ritmo, pauses: [], ok: true, aRitmo: true };

  // I giorni generati che nel calendario non esistono affatto sono candidati a
  // essere interruzioni; quelli che esistono con un altro orario no — di solito
  // sono la coda che si sposta per effetto dei buchi. Decide la riverifica.
  const sospetti = primo.inPiu.filter((x) => !lessons.some((l) => l.date === x.date));
  if (sospetti.length > 0) {
    const pauses = pauseDaiBuchi(sospetti);
    if (verificaFasi(ritmo, lessons, totalMinutes, pauses).ok) {
      return { fasi: ritmo, pauses, ok: true, aRitmo: true };
    }
  }

  const fisse = fasiPerLezione(lessons);
  return { fasi: fisse, pauses: [], ok: verificaFasi(fisse, lessons, totalMinutes).ok, aRitmo: false };
}
