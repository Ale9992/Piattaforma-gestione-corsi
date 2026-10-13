import type { ISODate, Weekday } from "@/lib/dates";

export const LESSON_STATUSES = ["PLANNED", "COMPLETED", "CANCELLED"] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

export const COURSE_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

/** Intervallo orario nello stesso giorno, in minuti [start, end). */
export interface TimeInterval {
  startMin: number;
  endMin: number;
}

/** Fase di calendarizzazione: giorni della settimana + orario, valida in un periodo. */
export interface ScheduleRuleInput extends TimeInterval {
  id: number;
  validFrom: ISODate;
  /** Inclusivo; `null` = senza scadenza. */
  validTo: ISODate | null;
  /** Bitmask: bit 0 = lunedì … bit 6 = domenica. */
  weekdaysMask: number;
}

/** Pausa del corso, estremi inclusi. */
export interface PauseInput {
  startDate: ISODate;
  endDate: ISODate;
}

export interface ExistingLesson extends TimeInterval {
  id: number;
  date: ISODate;
  status: LessonStatus;
  scheduleRuleId: number | null;
  /** Occorrenza della regola occupata dalla lezione (resta invariata se la lezione viene spostata). */
  slotDate: ISODate | null;
  /** Modificata manualmente: il motore non la tocca più. */
  isManual: boolean;
}

export interface GeneratedLesson extends TimeInterval {
  date: ISODate;
  scheduleRuleId: number;
  slotDate: ISODate;
}

export type SkipReason = "HOLIDAY" | "PAUSE";

/** Occorrenza prevista da una regola ma non generata. */
export interface SkippedOccurrence {
  date: ISODate;
  reason: SkipReason;
  /** Nome della festività, se `reason === "HOLIDAY"`. */
  label: string | null;
}

// ---------------------------------------------------------------------------
// Bitmask giorni
// ---------------------------------------------------------------------------

export function weekdayBit(weekday: Weekday): number {
  return 1 << (weekday - 1);
}

export function maskHasWeekday(mask: number, weekday: Weekday): boolean {
  return (mask & weekdayBit(weekday)) !== 0;
}

export function weekdaysToMask(weekdays: readonly Weekday[]): number {
  return weekdays.reduce((mask, w) => mask | weekdayBit(w), 0);
}

export function maskToWeekdays(mask: number): Weekday[] {
  return ([1, 2, 3, 4, 5, 6, 7] as Weekday[]).filter((w) => maskHasWeekday(mask, w));
}

export function lessonMinutes(lesson: TimeInterval): number {
  return lesson.endMin - lesson.startMin;
}

/** Le lezioni annullate valgono 0 ai fini del monte ore. */
export function isValidLesson(lesson: { status: LessonStatus }): boolean {
  return lesson.status !== "CANCELLED";
}
