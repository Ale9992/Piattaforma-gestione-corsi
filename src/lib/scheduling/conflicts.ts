import type { ISODate } from "@/lib/dates";

/** "APPOINTMENT" è un impegno senza corso, come l'incontro preliminare. */
export type EventKind = "LESSON" | "PRE_LESSON" | "APPOINTMENT";

/** Evento che occupa tempo: lezione non annullata o prelezione con data. */
export interface BusyEvent {
  kind: EventKind;
  /** Id della lezione o della prelezione (`null` se non ancora salvata). */
  id: number | null;
  /** 0 per gli impegni, che non appartengono a nessun corso. */
  courseId: number;
  date: ISODate;
  startMin: number;
  endMin: number;
}

export interface Conflict {
  a: BusyEvent;
  b: BusyEvent;
}

/** Identità di un evento indipendente dagli id del database. */
export function eventSignature(e: BusyEvent): string {
  return `${e.courseId}|${e.kind}|${e.date}|${e.startMin}|${e.endMin}`;
}

export function conflictSignature(c: Conflict): string {
  const [x, y] = [eventSignature(c.a), eventSignature(c.b)].sort();
  return `${x}#${y}`;
}

export function intervalsOverlap(
  a: { startMin: number; endMin: number },
  b: { startMin: number; endMin: number },
): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

/**
 * Sovrapposizioni tra eventi di corsi DIFFERENTI.
 * Gli intervalli sono semiaperti: 14:00–16:00 e 16:00–18:00 non sono in conflitto.
 */
export function findConflicts(events: readonly BusyEvent[]): Conflict[] {
  const byDate = new Map<ISODate, BusyEvent[]>();
  for (const e of events) {
    const list = byDate.get(e.date);
    if (list) list.push(e);
    else byDate.set(e.date, [e]);
  }

  const conflicts: Conflict[] = [];
  for (const date of [...byDate.keys()].sort()) {
    const list = byDate
      .get(date)!
      .slice()
      .sort((x, y) => x.startMin - y.startMin || x.endMin - y.endMin || x.courseId - y.courseId);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length && list[j].startMin < list[i].endMin; j++) {
        if (list[i].courseId !== list[j].courseId && intervalsOverlap(list[i], list[j])) {
          conflicts.push({ a: list[i], b: list[j] });
        }
      }
    }
  }
  return conflicts;
}

/** Conflitti presenti in `after` che non esistevano in `before`. */
export function newConflicts(before: readonly Conflict[], after: readonly Conflict[]): Conflict[] {
  const known = new Set(before.map(conflictSignature));
  return after.filter((c) => !known.has(conflictSignature(c)));
}
