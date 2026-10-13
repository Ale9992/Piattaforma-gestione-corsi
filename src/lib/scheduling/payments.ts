import { addDays, endOfMonth, type ISODate } from "@/lib/dates";
import type { CourseStatus, LessonStatus } from "./types";

/**
 * Quando matura il compenso di un corso.
 *
 * I corsi annuali si pagano in due volte: metà al raggiungimento delle 80 ore
 * svolte, il resto alla fine. Gli altri si pagano in un'unica soluzione a corso
 * concluso. "Ore svolte" significa lezioni segnate come svolte: le lezioni solo
 * programmate servono a stimare QUANDO si arriverà alla soglia, non a maturare
 * il diritto.
 */
export const CORSO_ANNUALE_MIN = 100 * 60;
export const ACCONTO_MIN = 80 * 60;

export type TrancheKind = "ACCONTO" | "SALDO" | "UNICA";

export interface Tranche {
  kind: TrancheKind;
  cents: number;
  /** Data in cui è maturata, oppure quella prevista se deve ancora maturare. */
  date: ISODate | null;
  /** Quando i soldi arrivano davvero: la fattura si incassa dopo. */
  paymentDate: ISODate | null;
  matured: boolean;
}

/**
 * Dalla fattura all'incasso.
 *
 * La fattura si emette a corso chiuso, ma il bonifico arriva dopo: le lettere
 * d'incarico dicono "entro 30 gg D.F.F.M.", cioè trenta giorni dalla FINE DEL
 * MESE della fattura. Un corso che finisce il 5 ottobre si incassa il 30
 * novembre, non il 4: è il mese dell'incasso quello che conta nei report.
 */
export function dataIncasso(dataFattura: ISODate | null): ISODate | null {
  return dataFattura ? addDays(endOfMonth(dataFattura), 30) : null;
}

export interface CourseForPayments {
  totalMinutes: number;
  feeCents: number | null;
  status: CourseStatus;
}

export interface LessonForPayments {
  date: ISODate;
  startMin: number;
  endMin: number;
  status: LessonStatus;
}

export function isAnnuale(totalMinutes: number): boolean {
  return totalMinutes >= CORSO_ANNUALE_MIN;
}

/** Prima data in cui il totale cumulato raggiunge `soglia`. */
function dataAllaSoglia(lezioni: readonly LessonForPayments[], soglia: number): ISODate | null {
  let somma = 0;
  for (const l of lezioni) {
    somma += l.endMin - l.startMin;
    if (somma >= soglia) return l.date;
  }
  return null;
}

export function computeTranches(course: CourseForPayments, lessons: readonly LessonForPayments[]): Tranche[] {
  const ordinate = [...lessons].sort((a, b) => a.date.localeCompare(b.date));
  const svolte = ordinate.filter((l) => l.status === "COMPLETED");
  const previste = ordinate.filter((l) => l.status !== "CANCELLED");
  const minutiSvolti = svolte.reduce((s, l) => s + l.endMin - l.startMin, 0);
  const fine = svolte.at(-1)?.date ?? null;
  const finePrevista = previste.at(-1)?.date ?? null;
  const fee = course.feeCents ?? 0;
  const concluso = course.status === "COMPLETED" || minutiSvolti >= course.totalMinutes;

  if (!isAnnuale(course.totalMinutes)) {
    const data = concluso ? (fine ?? finePrevista) : finePrevista;
    return [{ kind: "UNICA", cents: fee, date: data, paymentDate: dataIncasso(data), matured: concluso }];
  }

  // Corso annuale: metà alle 80 ore svolte, il resto a fine corso.
  const acconto = Math.round(fee / 2);
  const raggiunto = minutiSvolti >= ACCONTO_MIN;
  const dataAcconto = raggiunto ? dataAllaSoglia(svolte, ACCONTO_MIN) : dataAllaSoglia(previste, ACCONTO_MIN);
  const dataSaldo = concluso ? (fine ?? finePrevista) : finePrevista;
  return [
    {
      kind: "ACCONTO",
      cents: acconto,
      date: dataAcconto,
      paymentDate: dataIncasso(dataAcconto),
      matured: raggiunto,
    },
    {
      kind: "SALDO",
      cents: fee - acconto,
      date: dataSaldo,
      paymentDate: dataIncasso(dataSaldo),
      matured: concluso,
    },
  ];
}
