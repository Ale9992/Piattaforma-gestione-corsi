import { eachDay, weekdayOf, type ISODate, type Weekday } from "@/lib/dates";
import { getHolidayName } from "./holidays";
import type { BusyEvent } from "./conflicts";
import type { TimeInterval } from "./types";

/** Orario lavorativo: lun–ven 09–22, sabato 09–13, domenica non disponibile. */
export const WORKING_HOURS: Record<Weekday, TimeInterval | null> = {
  1: { startMin: 9 * 60, endMin: 22 * 60 },
  2: { startMin: 9 * 60, endMin: 22 * 60 },
  3: { startMin: 9 * 60, endMin: 22 * 60 },
  4: { startMin: 9 * 60, endMin: 22 * 60 },
  5: { startMin: 9 * 60, endMin: 22 * 60 },
  6: { startMin: 9 * 60, endMin: 13 * 60 },
  7: null,
};

export const SLOT_DURATION_PRESETS = [60, 90, 120, 150, 180] as const;

/** Gli slot proposti iniziano a ore tonde o alla mezz'ora, non al minuto. */
export const SLOT_STEP = 30;

/**
 * Sottrae gli impegni dalla finestra lavorativa e restituisce gli intervalli
 * realmente liberi, al minuto. Gli impegni possono sovrapporsi, uscire dalla
 * finestra o essere in qualsiasi ordine.
 */
export function subtractIntervals(
  window: TimeInterval,
  busy: readonly TimeInterval[],
): TimeInterval[] {
  const sorted = busy
    .map((b) => ({
      startMin: Math.max(b.startMin, window.startMin),
      endMin: Math.min(b.endMin, window.endMin),
    }))
    .filter((b) => b.startMin < b.endMin)
    .sort((x, y) => x.startMin - y.startMin || x.endMin - y.endMin);

  const free: TimeInterval[] = [];
  let cursor = window.startMin;
  for (const b of sorted) {
    if (b.startMin > cursor) free.push({ startMin: cursor, endMin: b.startMin });
    cursor = Math.max(cursor, b.endMin);
  }
  if (cursor < window.endMin) free.push({ startMin: cursor, endMin: window.endMin });
  return free;
}

/**
 * Trasforma gli intervalli liberi in slot consecutivi di `durationMin`.
 *
 * Il primo slot non parte dal minuto esatto in cui l'intervallo diventa libero
 * — sarebbe "10:36–12:36", inutile da proporre a un cliente — ma dalla prima
 * ora tonda o mezz'ora utile. La parte residua insufficiente viene ignorata.
 */
export function slotsFromIntervals(
  free: readonly TimeInterval[],
  durationMin: number,
  stepMin: number = SLOT_STEP,
): TimeInterval[] {
  if (!Number.isInteger(durationMin) || durationMin <= 0) return [];
  const passo = Number.isInteger(stepMin) && stepMin > 0 ? stepMin : 1;
  const slots: TimeInterval[] = [];
  for (const interval of free) {
    const inizio = Math.ceil(interval.startMin / passo) * passo;
    for (let s = inizio; s + durationMin <= interval.endMin; s += durationMin) {
      slots.push({ startMin: s, endMin: s + durationMin });
    }
  }
  return slots;
}

export interface DayAvailability {
  date: ISODate;
  weekday: Weekday;
  /** Finestra lavorativa effettiva (null = giorno non lavorativo). */
  window: TimeInterval | null;
  /** Nome della festività nazionale, se il giorno è festivo. */
  holiday: string | null;
  busy: BusyEvent[];
  free: TimeInterval[];
  slots: TimeInterval[];
}

export interface AvailabilityInput {
  from: ISODate;
  to: ISODate;
  durationMin: number;
  events: readonly BusyEvent[];
  /** Esclude il tempo già trascorso (es. oggi prima dell'ora corrente). */
  notBefore?: { date: ISODate; minutes: number };
  workingHours?: Record<Weekday, TimeInterval | null>;
}

/**
 * Disponibilità derivata esclusivamente da lezioni e prelezioni presenti.
 * Le festività nazionali sono considerate non disponibili.
 */
export function computeAvailability(input: AvailabilityInput): DayAvailability[] {
  const hours = input.workingHours ?? WORKING_HOURS;
  const byDate = new Map<ISODate, BusyEvent[]>();
  for (const e of input.events) {
    const list = byDate.get(e.date);
    if (list) list.push(e);
    else byDate.set(e.date, [e]);
  }

  return eachDay(input.from, input.to).map((date) => {
    const weekday = weekdayOf(date);
    const holiday = getHolidayName(date);
    const busy = (byDate.get(date) ?? []).sort((a, b) => a.startMin - b.startMin);
    let window = holiday ? null : hours[weekday];

    if (window && input.notBefore) {
      if (date < input.notBefore.date) window = null;
      else if (date === input.notBefore.date) {
        const start = Math.max(window.startMin, input.notBefore.minutes);
        window = start < window.endMin ? { startMin: start, endMin: window.endMin } : null;
      }
    }

    const free = window ? subtractIntervals(window, busy) : [];
    return {
      date,
      weekday,
      window,
      holiday,
      busy,
      free,
      slots: slotsFromIntervals(free, input.durationMin),
    };
  });
}
