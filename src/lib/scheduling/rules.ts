import { addDays, type ISODate } from "@/lib/dates";
import { maskToWeekdays, type ScheduleRuleInput } from "./types";

/** Una riga orario: un gruppo di giorni con il loro orario. */
export interface ScheduleBlock {
  weekdaysMask: number;
  startMin: number;
  endMin: number;
  /**
   * Da quando valgono questi giorni, se partono dopo l'inizio della fase:
   * un corso può iniziare di mercoledì e aggiungere il sabato solo dal 3 ottobre.
   */
  from?: ISODate | null;
}

/** Regola generata da una riga orario in una fase che inizia a `phaseFrom`. */
export function blockToRule(block: ScheduleBlock, phaseFrom: ISODate) {
  return {
    validFrom: block.from && block.from > phaseFrom ? block.from : phaseFrom,
    validTo: null,
    weekdaysMask: block.weekdaysMask,
    startMin: block.startMin,
    endMin: block.endMin,
  };
}

/**
 * Cambio di calendarizzazione: dalla data indicata valgono queste righe orario.
 * Più righe convivono nello stesso periodo quando i giorni hanno orari diversi
 * (martedì 11–12, mercoledì 9–11).
 */
export interface ScheduleChange {
  validFrom: ISODate;
  blocks: readonly ScheduleBlock[];
}

export interface ScheduleChangePlan {
  /** Regole risultanti (le nuove hanno gli id passati in `newRuleIds`). */
  rules: ScheduleRuleInput[];
  /** Fasi che iniziano da `validFrom` in poi: vengono sostituite. */
  removedIds: number[];
  /** Fasi attive a `validFrom`: vengono chiuse al giorno precedente. */
  closedIds: number[];
}

/** Lo stesso giorno non può comparire in due righe orario della stessa fase. */
export function findOverlappingWeekday(blocks: readonly ScheduleBlock[]): number | null {
  const seen = new Set<number>();
  for (const block of blocks) {
    for (const weekday of maskToWeekdays(block.weekdaysMask)) {
      if (seen.has(weekday)) return weekday;
      seen.add(weekday);
    }
  }
  return null;
}

/**
 * Pianifica "Cambia calendarizzazione dal giorno X". Funzione pura condivisa
 * dal servizio (scrittura) e dall'anteprima nella UI.
 */
export function planScheduleChange(
  rules: readonly ScheduleRuleInput[],
  change: ScheduleChange,
  newRuleIds: readonly number[],
): ScheduleChangePlan {
  const dayBefore = addDays(change.validFrom, -1);
  const removedIds: number[] = [];
  const closedIds: number[] = [];
  const next: ScheduleRuleInput[] = [];

  for (const rule of rules) {
    if (rule.validFrom >= change.validFrom) {
      removedIds.push(rule.id);
    } else if (rule.validTo === null || rule.validTo >= change.validFrom) {
      closedIds.push(rule.id);
      next.push({ ...rule, validTo: dayBefore });
    } else {
      next.push(rule);
    }
  }

  change.blocks.forEach((block, index) => {
    next.push({ id: newRuleIds[index] ?? -(index + 1), ...blockToRule(block, change.validFrom) });
  });

  return { rules: next, removedIds, closedIds };
}

/**
 * Pianifica "Aggiungi un giorno dal giorno X": le righe già in vigore restano
 * come sono e i nuovi giorni si sommano. Un giorno già calendarizzato in quel
 * periodo non si può aggiungere (va usato il cambio di calendarizzazione):
 * in quel caso `clash` indica il giorno in conflitto.
 */
export function planAddDays(
  rules: readonly ScheduleRuleInput[],
  change: ScheduleChange,
  newRuleIds: readonly number[],
): { rules: ScheduleRuleInput[]; clash: number | null } {
  const next: ScheduleRuleInput[] = [...rules];
  for (const [index, block] of change.blocks.entries()) {
    const rule = { id: newRuleIds[index] ?? -(index + 1), ...blockToRule(block, change.validFrom) };
    for (const existing of rules) {
      if (existing.validTo !== null && existing.validTo < rule.validFrom) continue;
      const shared = existing.weekdaysMask & rule.weekdaysMask;
      if (shared !== 0) return { rules: next, clash: maskToWeekdays(shared)[0] };
    }
    next.push(rule);
  }
  return { rules: next, clash: null };
}
