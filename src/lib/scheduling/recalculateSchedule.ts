import { maxDate, type ISODate } from "@/lib/dates";
import { generateSchedule } from "./generateSchedule";
import {
  isValidLesson,
  lessonMinutes,
  type ExistingLesson,
  type GeneratedLesson,
  type LessonStatus,
  type PauseInput,
  type ScheduleRuleInput,
  type SkippedOccurrence,
} from "./types";

export interface RecalculateInput {
  courseStartDate: ISODate;
  totalMinutes: number;
  rules: readonly ScheduleRuleInput[];
  pauses: readonly PauseInput[];
  existing: readonly ExistingLesson[];
  /**
   * Le lezioni con data precedente a `from` sono storico e non vengono toccate.
   * Default: data di inizio corso.
   */
  from?: ISODate;
  /**
   * Soglia sotto la quale il motore non genera nulla: di norma "oggi".
   * Impedisce che una modifica di oggi (pausa, monte ore, calendarizzazione)
   * infili lezioni in date già passate, per esempio dentro una vecchia
   * interruzione estiva. Omessa solo alla creazione di un corso, dove
   * generare lo storico è proprio ciò che serve.
   */
  notBefore?: ISODate;
}

export interface ScheduledLesson {
  /** `null` per le lezioni nuove non ancora salvate. */
  id: number | null;
  date: ISODate;
  startMin: number;
  endMin: number;
  status: LessonStatus;
  scheduleRuleId: number | null;
  slotDate: ISODate | null;
  isManual: boolean;
}

export interface RecalculateResult {
  /** Lezioni esistenti rigenerabili rimaste identiche. */
  keptIds: number[];
  /** Lezioni esistenti identiche ma associate ora a un'altra regola. */
  ruleUpdates: { id: number; scheduleRuleId: number }[];
  /** Lezioni esistenti da eliminare. */
  removeIds: number[];
  /** Nuove lezioni da inserire. */
  insert: GeneratedLesson[];
  /** Calendario risultante completo, ordinato. */
  lessons: ScheduledLesson[];
  /** Minuti validi (programmati + svolti) nel calendario risultante. */
  validMinutes: number;
  /** Minuti del monte ore che le regole non riescono a coprire. */
  shortfallMinutes: number;
  /** Minuti validi oltre il monte ore (solo se le lezioni bloccate lo superano già). */
  excessMinutes: number;
  expectedEndDate: ISODate | null;
  skipped: SkippedOccurrence[];
}

/**
 * Una lezione è "bloccata" (il motore non la modifica né la elimina) se:
 * - è stata svolta o annullata;
 * - è stata modificata manualmente;
 * - la sua data è precedente a `from` (storico).
 */
export function isLockedLesson(lesson: ExistingLesson, from: ISODate): boolean {
  return lesson.status !== "PLANNED" || lesson.isManual || lesson.date < from;
}

export function compareLessons(
  a: { date: ISODate; startMin: number; endMin: number },
  b: { date: ISODate; startMin: number; endMin: number },
): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.startMin !== b.startMin) return a.startMin - b.startMin;
  return a.endMin - b.endMin;
}

function matchKey(l: { date: ISODate; startMin: number; endMin: number; slotDate: ISODate | null }) {
  return `${l.date}|${l.startMin}|${l.endMin}|${l.slotDate ?? ""}`;
}

/**
 * Ricalcola il calendario di un corso. Funzione pura e deterministica.
 *
 * 0. La soglia `notBefore` (di norma oggi) sposta in avanti `from`: il passato non si riscrive.
 * 1. Separa le lezioni bloccate da quelle rigenerabili (programmate, automatiche, da `from` in poi).
 * 2. Residuo = monte ore − minuti validi delle lezioni bloccate (le annullate valgono 0).
 * 3. Genera il residuo da `max(from, inizio corso)` saltando le occorrenze già occupate.
 * 4. Confronta con le rigenerabili esistenti: le identiche restano (id stabili),
 *    le altre vengono eliminate o inserite.
 */
export function recalculateSchedule(input: RecalculateInput): RecalculateResult {
  const requested = input.from ?? input.courseStartDate;
  // Il ricalcolo non scende mai sotto la soglia: tutto ciò che sta prima è storia.
  const from = input.notBefore ? maxDate(requested, input.notBefore) : requested;

  const locked: ExistingLesson[] = [];
  const regenerable: ExistingLesson[] = [];
  for (const lesson of input.existing) {
    (isLockedLesson(lesson, from) ? locked : regenerable).push(lesson);
  }

  const lockedValidMinutes = locked
    .filter(isValidLesson)
    .reduce((sum, l) => sum + lessonMinutes(l), 0);
  const remaining = input.totalMinutes - lockedValidMinutes;

  const consumedSlots = new Set<ISODate>();
  for (const l of locked) if (l.slotDate) consumedSlots.add(l.slotDate);

  const generation = generateSchedule({
    from: maxDate(from, input.courseStartDate),
    remainingMinutes: Math.max(0, remaining),
    rules: input.rules,
    pauses: input.pauses,
    consumedSlots,
  });

  // Diff tra lezioni generate e rigenerabili esistenti.
  const available = new Map<string, ExistingLesson[]>();
  for (const l of [...regenerable].sort((a, b) => a.id - b.id)) {
    const key = matchKey(l);
    const bucket = available.get(key);
    if (bucket) bucket.push(l);
    else available.set(key, [l]);
  }

  const keptIds: number[] = [];
  const ruleUpdates: { id: number; scheduleRuleId: number }[] = [];
  const insert: GeneratedLesson[] = [];
  const resulting: ScheduledLesson[] = locked.map((l) => ({ ...l }));

  for (const g of generation.lessons) {
    const match = available.get(matchKey(g))?.shift();
    if (match) {
      if (match.scheduleRuleId === g.scheduleRuleId) keptIds.push(match.id);
      else ruleUpdates.push({ id: match.id, scheduleRuleId: g.scheduleRuleId });
      resulting.push({ ...match, scheduleRuleId: g.scheduleRuleId });
    } else {
      insert.push(g);
      resulting.push({ id: null, status: "PLANNED", isManual: false, ...g });
    }
  }
  const removeIds = [...available.values()].flat().map((l) => l.id).sort((a, b) => a - b);

  resulting.sort((a, b) => compareLessons(a, b) || (a.id ?? Infinity) - (b.id ?? Infinity));
  const validLessons = resulting.filter(isValidLesson);
  const validMinutes = validLessons.reduce((sum, l) => sum + lessonMinutes(l), 0);

  return {
    keptIds,
    ruleUpdates,
    removeIds,
    insert,
    lessons: resulting,
    validMinutes,
    shortfallMinutes: generation.shortfallMinutes,
    excessMinutes: Math.max(0, -remaining),
    expectedEndDate: validLessons.length > 0 ? validLessons[validLessons.length - 1].date : null,
    skipped: generation.skipped,
  };
}

export interface CourseProgress {
  totalMinutes: number;
  completedMinutes: number;
  plannedMinutes: number;
  cancelledMinutes: number;
  /** Monte ore − ore svolte. */
  toDoMinutes: number;
  /** Monte ore non ancora coperto da lezioni programmate o svolte. */
  unscheduledMinutes: number;
}

export function computeProgress(
  totalMinutes: number,
  lessons: readonly { status: LessonStatus; startMin: number; endMin: number }[],
): CourseProgress {
  let completed = 0;
  let planned = 0;
  let cancelled = 0;
  for (const l of lessons) {
    const minutes = lessonMinutes(l);
    if (l.status === "COMPLETED") completed += minutes;
    else if (l.status === "PLANNED") planned += minutes;
    else cancelled += minutes;
  }
  return {
    totalMinutes,
    completedMinutes: completed,
    plannedMinutes: planned,
    cancelledMinutes: cancelled,
    toDoMinutes: Math.max(0, totalMinutes - completed),
    unscheduledMinutes: Math.max(0, totalMinutes - completed - planned),
  };
}

export function expectedEndDate(
  lessons: readonly { date: ISODate; status: LessonStatus }[],
): ISODate | null {
  let end: ISODate | null = null;
  for (const l of lessons) {
    if (isValidLesson(l) && (end === null || l.date > end)) end = l.date;
  }
  return end;
}
