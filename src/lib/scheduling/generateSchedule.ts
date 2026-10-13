import { addDays, weekdayOf, type ISODate } from "@/lib/dates";
import { getHolidayName } from "./holidays";
import {
  maskHasWeekday,
  type GeneratedLesson,
  type PauseInput,
  type ScheduleRuleInput,
  type SkippedOccurrence,
} from "./types";

/** Limite di sicurezza: nessun corso reale supera questo orizzonte. */
export const MAX_HORIZON_DAYS = 366 * 5;

export interface GenerateScheduleInput {
  /** Primo giorno (incluso) in cui è possibile generare lezioni. */
  from: ISODate;
  /** Minuti ancora da calendarizzare. */
  remainingMinutes: number;
  rules: readonly ScheduleRuleInput[];
  pauses: readonly PauseInput[];
  /** Occorrenze già occupate da lezioni che il motore non può toccare. */
  consumedSlots?: ReadonlySet<ISODate>;
}

export interface GenerateScheduleResult {
  lessons: GeneratedLesson[];
  /** Minuti che le regole non riescono a coprire (0 se il monte ore è raggiunto). */
  shortfallMinutes: number;
  skipped: SkippedOccurrence[];
}

/**
 * Regola che governa `date`: deve essere valida in quella data E includere quel
 * giorno della settimana. Più regole possono convivere nello stesso periodo con
 * giorni diversi — è così che un corso ha martedì 11–12 e mercoledì 9–11.
 * A parità di giorno vince quella iniziata più di recente.
 */
export function findRuleForDate(
  rules: readonly ScheduleRuleInput[],
  date: ISODate,
): ScheduleRuleInput | null {
  const weekday = weekdayOf(date);
  let best: ScheduleRuleInput | null = null;
  for (const rule of rules) {
    if (rule.validFrom > date) continue;
    if (rule.validTo !== null && rule.validTo < date) continue;
    if (!maskHasWeekday(rule.weekdaysMask, weekday)) continue;
    if (
      best === null ||
      rule.validFrom > best.validFrom ||
      (rule.validFrom === best.validFrom && rule.id > best.id)
    ) {
      best = rule;
    }
  }
  return best;
}

export function isInPause(pauses: readonly PauseInput[], date: ISODate): boolean {
  return pauses.some((p) => p.startDate <= date && date <= p.endDate);
}

/**
 * Genera le lezioni a partire da `from` finché non sono stati calendarizzati
 * `remainingMinutes`. Funzione pura e deterministica.
 *
 * Un giorno produce una lezione se e solo se:
 * - esiste una regola valida in quella data che include il giorno della settimana;
 * - non è una festività nazionale;
 * - non cade in una pausa;
 * - l'occorrenza non è già occupata da una lezione bloccata (`consumedSlots`).
 *
 * L'ultima lezione viene accorciata se il residuo è inferiore alla durata della regola.
 */
export function generateSchedule(input: GenerateScheduleInput): GenerateScheduleResult {
  const { rules, pauses, consumedSlots } = input;
  const lessons: GeneratedLesson[] = [];
  const skipped: SkippedOccurrence[] = [];
  let remaining = input.remainingMinutes;

  const lastRuleEnd = rules.some((r) => r.validTo === null)
    ? null
    : rules.reduce<ISODate | null>(
        (acc, r) => (acc === null || (r.validTo as ISODate) > acc ? r.validTo : acc),
        null,
      );

  let date = input.from;
  for (let i = 0; remaining > 0 && i < MAX_HORIZON_DAYS; i++, date = addDays(date, 1)) {
    if (lastRuleEnd === null && rules.length === 0) break;
    if (lastRuleEnd !== null && date > lastRuleEnd) break;

    const rule = findRuleForDate(rules, date);
    if (!rule) continue;

    const holiday = getHolidayName(date);
    if (holiday) {
      skipped.push({ date, reason: "HOLIDAY", label: holiday });
      continue;
    }
    if (isInPause(pauses, date)) {
      skipped.push({ date, reason: "PAUSE", label: null });
      continue;
    }
    if (consumedSlots?.has(date)) continue;

    const duration = Math.min(rule.endMin - rule.startMin, remaining);
    if (duration <= 0) continue;
    lessons.push({
      date,
      startMin: rule.startMin,
      endMin: rule.startMin + duration,
      scheduleRuleId: rule.id,
      slotDate: date,
    });
    remaining -= duration;
  }

  return { lessons, shortfallMinutes: Math.max(0, remaining), skipped };
}
