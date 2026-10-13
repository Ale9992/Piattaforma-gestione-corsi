import { and, asc, eq, gte, inArray, isNotNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { getDb, type Executor } from "@/db";
import { appointments, courses, lessons, preLessons } from "@/db/schema";
import { addDays, nowInRome, startOfWeek, todayInRome, type ISODate } from "@/lib/dates";
import { APP_TEAMS, linkApp } from "@/lib/mail/meeting";
import { findConflicts, type BusyEvent } from "@/lib/scheduling/conflicts";
import { effectiveCourseStatus } from "@/lib/scheduling/course-status";
import { computeTranches, type Tranche } from "@/lib/scheduling/payments";
import { computeProgress, recalculateSchedule, type CourseProgress } from "@/lib/scheduling/recalculateSchedule";
import type { CourseStatus, LessonStatus, SkippedOccurrence } from "@/lib/scheduling/types";
import { loadBusyEvents, loadScheduleInput, toConflictViews, type ConflictView } from "./course-service";

// ---------------------------------------------------------------------------
// Elenchi corsi
// ---------------------------------------------------------------------------

export interface CourseListItem {
  id: number;
  name: string;
  clientCompany: string;
  mode: string;
  status: CourseStatus;
  startDate: ISODate;
  expectedEndDate: ISODate | null;
  nextLessonDate: ISODate | null;
  progress: CourseProgress;
}

export function listCourses(statuses: CourseStatus[], today: ISODate, ex: Executor = getDb()): CourseListItem[] {
  const rows = ex
    .select()
    .from(courses)
    .where(inArray(courses.status, statuses))
    .orderBy(asc(courses.startDate), asc(courses.name))
    .all();
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const lessonRows = ex
    .select({
      courseId: lessons.courseId,
      date: lessons.date,
      status: lessons.status,
      startMin: lessons.startMin,
      endMin: lessons.endMin,
    })
    .from(lessons)
    .where(inArray(lessons.courseId, ids))
    .all();

  // La prelezione svolta basta a far risultare il corso iniziato.
  const preRowsPerStato = ex
    .select({ courseId: preLessons.courseId, status: preLessons.status })
    .from(preLessons)
    .where(inArray(preLessons.courseId, ids))
    .all();
  const preStato = new Map(preRowsPerStato.map((p) => [p.courseId, p]));

  const byCourse = new Map<number, typeof lessonRows>();
  for (const l of lessonRows) {
    const list = byCourse.get(l.courseId);
    if (list) list.push(l);
    else byCourse.set(l.courseId, [l]);
  }

  return rows.map((c) => {
    const ls = byCourse.get(c.id) ?? [];
    let end: ISODate | null = null;
    let next: ISODate | null = null;
    for (const l of ls) {
      if (l.status === "CANCELLED") continue;
      if (end === null || l.date > end) end = l.date;
      if (l.status === "PLANNED" && l.date >= today && (next === null || l.date < next)) next = l.date;
    }
    return {
      id: c.id,
      name: c.name,
      clientCompany: c.clientCompany,
      mode: c.mode,
      status: effectiveCourseStatus(c.status, ls, today, preStato.get(c.id)),
      startDate: c.startDate,
      expectedEndDate: end,
      nextLessonDate: next,
      progress: computeProgress(c.totalMinutes, ls),
    };
  });
}

export interface UnmarkedLesson {
  id: number;
  /** La prelezione si segna sul corso, non sulla singola lezione. */
  kind: "LESSON" | "PRE_LESSON";
  courseId: number;
  courseName: string;
  clientCompany: string;
  date: ISODate;
  startMin: number;
  endMin: number;
}

/**
 * Lezioni finite e ancora in stato "Programmata": finché non le segni, le ore
 * svolte non sono affidabili. I corsi archiviati restano fuori.
 *
 * "Finite" comprende quelle di oggi che sono già terminate: una lezione si
 * segna la sera stessa, appena chiusa, non il giorno dopo.
 */
export function listUnmarkedLessons(
  today: ISODate = todayInRome(),
  ex: Executor = getDb(),
  oraCorrente: number = nowInRome().minutes,
): UnmarkedLesson[] {
  /** Passata, oppure di oggi ma già conclusa. */
  const finita = (colonna: { date: typeof lessons.date; endMin: typeof lessons.endMin }) =>
    or(lt(colonna.date, today), and(eq(colonna.date, today), lte(colonna.endMin, oraCorrente)));

  const lezioni = ex
    .select({
      id: lessons.id,
      courseId: lessons.courseId,
      courseName: courses.name,
      clientCompany: courses.clientCompany,
      date: lessons.date,
      startMin: lessons.startMin,
      endMin: lessons.endMin,
    })
    .from(lessons)
    .innerJoin(courses, eq(courses.id, lessons.courseId))
    .where(
      and(
        eq(lessons.status, "PLANNED"),
        finita({ date: lessons.date, endMin: lessons.endMin }),
        ne(courses.status, "COMPLETED"),
      ),
    )
    .all();

  // Anche la prelezione va segnata, pur restando fuori dal monte ore.
  const prelezioni = ex
    .select({
      id: preLessons.id,
      courseId: preLessons.courseId,
      courseName: courses.name,
      clientCompany: courses.clientCompany,
      date: preLessons.date,
      startMin: preLessons.startMin,
      endMin: preLessons.endMin,
    })
    .from(preLessons)
    .innerJoin(courses, eq(courses.id, preLessons.courseId))
    .where(
      and(
        eq(preLessons.status, "PLANNED"),
        isNotNull(preLessons.date),
        finita({ date: preLessons.date as unknown as typeof lessons.date, endMin: preLessons.endMin as unknown as typeof lessons.endMin }),
        ne(courses.status, "COMPLETED"),
      ),
    )
    .all();

  return [
    ...lezioni.map((l) => ({ ...l, kind: "LESSON" as const })),
    ...prelezioni.map((p) => ({
      ...p,
      kind: "PRE_LESSON" as const,
      date: p.date as ISODate,
      startMin: p.startMin as number,
      endMin: p.endMin as number,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);
}

export interface ReportRow {
  id: number;
  name: string;
  clientCompany: string;
  status: CourseStatus;
  startDate: ISODate;
  /** Ultima lezione non annullata. */
  endDate: ISODate | null;
  doneMinutes: number;
  totalMinutes: number;
  feeCents: number | null;
  /** Quote di pagamento: unica, oppure acconto e saldo per i corsi annuali. */
  tranches: Tranche[];
}

/**
 * Righe del prospetto: un corso per riga, con il compenso pattuito e le ore.
 * Il compenso è un importo fisso per corso; qui non si calcola nulla su di esso,
 * si somma soltanto.
 */
export function listReportRows(ex: Executor = getDb()): ReportRow[] {
  const righe = ex
    .select({
      id: courses.id,
      name: courses.name,
      clientCompany: courses.clientCompany,
      status: courses.status,
      startDate: courses.startDate,
      totalMinutes: courses.totalMinutes,
      feeCents: courses.feeCents,
    })
    .from(courses)
    .all();

  const tutteLeLezioni = ex
    .select({
      courseId: lessons.courseId,
      date: lessons.date,
      startMin: lessons.startMin,
      endMin: lessons.endMin,
      status: lessons.status,
    })
    .from(lessons)
    .all();

  const perCorso = new Map<number, typeof tutteLeLezioni>();
  for (const l of tutteLeLezioni) {
    const lista = perCorso.get(l.courseId);
    if (lista) lista.push(l);
    else perCorso.set(l.courseId, [l]);
  }

  return righe
    .map((c) => {
      const lezioni = perCorso.get(c.id) ?? [];
      const valide = lezioni.filter((l) => l.status !== "CANCELLED");
      return {
        ...c,
        endDate: valide.reduce<ISODate | null>((max, l) => (max === null || l.date > max ? l.date : max), null),
        doneMinutes: lezioni
          .filter((l) => l.status === "COMPLETED")
          .reduce((somma, l) => somma + l.endMin - l.startMin, 0),
        tranches: computeTranches(c, lezioni),
      };
    })
    .sort((a, b) => (b.endDate ?? b.startDate).localeCompare(a.endDate ?? a.startDate));
}

// ---------------------------------------------------------------------------
// Pagina corso
// ---------------------------------------------------------------------------

export function getCourseDetail(
  courseId: number,
  ex: Executor = getDb(),
  today: ISODate = todayInRome(),
) {
  const course = ex.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!course) return null;

  const { rules, pauses, existing } = loadScheduleInput(ex, courseId);
  const preLesson = ex.select().from(preLessons).where(eq(preLessons.courseId, courseId)).get() ?? null;

  const input = {
    courseStartDate: course.startDate,
    totalMinutes: course.totalMinutes,
    rules,
    pauses,
    existing,
  };

  // Due ricalcoli "a secco", nessuna scrittura:
  // - dall'inizio, per elencare tutte le date escluse da festività e pause;
  // - da oggi, per capire se il FUTURO è allineato alle regole (è ciò che "Ricalcola" sistema).
  const wholeCourse = recalculateSchedule(input);
  const check = recalculateSchedule({ ...input, notBefore: today });
  const aligned =
    check.insert.length === 0 && check.removeIds.length === 0 && check.ruleUpdates.length === 0;

  const conflicts = findConflicts(loadBusyEvents(ex)).filter(
    (c) => c.a.courseId === courseId || c.b.courseId === courseId,
  );
  const conflictLessonIds = new Set<number>();
  let preLessonConflict = false;
  for (const c of conflicts) {
    for (const e of [c.a, c.b]) {
      if (e.courseId !== courseId || e.id === null) continue;
      if (e.kind === "LESSON") conflictLessonIds.add(e.id);
      else preLessonConflict = true;
    }
  }

  return {
    // Lo stato mostrato è dedotto: "In corso" appena la prima lezione è arrivata.
    course: { ...course, status: effectiveCourseStatus(course.status, existing, today, preLesson) },
    rules,
    pauses,
    preLesson,
    lessons: existing,
    progress: computeProgress(course.totalMinutes, existing),
    expectedEndDate: expectedEnd(existing),
    shortfallMinutes: check.shortfallMinutes,
    excessMinutes: check.excessMinutes,
    skipped: wholeCourse.skipped satisfies SkippedOccurrence[],
    aligned,
    conflicts: toConflictViews(ex, conflicts),
    conflictLessonIds: [...conflictLessonIds],
    preLessonConflict,
  };
}

export type CourseDetail = NonNullable<ReturnType<typeof getCourseDetail>>;

function expectedEnd(ls: readonly { date: ISODate; status: LessonStatus }[]): ISODate | null {
  let end: ISODate | null = null;
  for (const l of ls) if (l.status !== "CANCELLED" && (end === null || l.date > end)) end = l.date;
  return end;
}

// ---------------------------------------------------------------------------
// Eventi calendario
// ---------------------------------------------------------------------------

export interface CalendarEventView {
  key: string;
  /** "APPOINTMENT" è un impegno senza corso: l'incontro preliminare. */
  kind: "LESSON" | "PRE_LESSON" | "APPOINTMENT";
  id: number;
  courseId: number;
  courseName: string;
  clientCompany: string;
  date: ISODate;
  startMin: number;
  endMin: number;
  /** `null` per le prelezioni. */
  status: LessonStatus | null;
  isManual: boolean;
  hasConflict: boolean;
  /** Collegamento pronto per entrare a lezione ("" se il corso non è online). */
  teams: string;
}

export function getCalendarEvents(
  from: ISODate,
  to: ISODate,
  options: { includeCancelled?: boolean; statuses?: CourseStatus[] } = {},
  ex: Executor = getDb(),
): CalendarEventView[] {
  const lessonRows = ex
    .select({
      id: lessons.id,
      courseId: lessons.courseId,
      courseName: courses.name,
      clientCompany: courses.clientCompany,
      date: lessons.date,
      startMin: lessons.startMin,
      endMin: lessons.endMin,
      status: lessons.status,
      isManual: lessons.isManual,
      meetingUrl: courses.meetingUrl,
      meetingUser: courses.meetingUser,
    })
    .from(lessons)
    .innerJoin(courses, eq(courses.id, lessons.courseId))
    .where(
      and(
        gte(lessons.date, from),
        lte(lessons.date, to),
        options.includeCancelled ? undefined : ne(lessons.status, "CANCELLED"),
        options.statuses ? inArray(courses.status, options.statuses) : undefined,
      ),
    )
    .all();

  const preRows = ex
    .select({
      id: preLessons.id,
      courseId: preLessons.courseId,
      courseName: courses.name,
      clientCompany: courses.clientCompany,
      date: preLessons.date,
      startMin: preLessons.startMin,
      endMin: preLessons.endMin,
      status: preLessons.status,
      meetingUrl: courses.meetingUrl,
      meetingUser: courses.meetingUser,
    })
    .from(preLessons)
    .innerJoin(courses, eq(courses.id, preLessons.courseId))
    .where(
      and(
        gte(preLessons.date, from),
        lte(preLessons.date, to),
        options.statuses ? inArray(courses.status, options.statuses) : undefined,
      ),
    )
    .all();

  // Impegni senza corso: non hanno stato né monte ore, ma occupano il tempo.
  const impegni = ex
    .select()
    .from(appointments)
    .where(and(gte(appointments.date, from), lte(appointments.date, to)))
    .all();

  const busy: BusyEvent[] = loadBusyEvents(ex, { from, to });
  const conflictKeys = new Set<string>();
  for (const c of findConflicts(busy)) {
    for (const e of [c.a, c.b]) conflictKeys.add(`${e.kind}:${e.id}`);
  }

  /**
   * Come si entra a lezione: l'invito alla riunione se c'è, altrimenti la sola
   * apertura di Teams, che con le credenziali del corso basta. La password non
   * esce da qui: serve solo sapere che un accesso esiste.
   */
  const accessoTeams = (r: { meetingUrl: string; meetingUser: string }) =>
    linkApp(r.meetingUrl) || (r.meetingUser ? APP_TEAMS : "");

  const events: CalendarEventView[] = [
    ...lessonRows.map(({ meetingUrl, meetingUser, ...r }) => ({
      key: `LESSON:${r.id}`,
      kind: "LESSON" as const,
      ...r,
      teams: accessoTeams({ meetingUrl, meetingUser }),
      hasConflict: conflictKeys.has(`LESSON:${r.id}`),
    })),
    ...preRows.map((r) => ({
      key: `PRE_LESSON:${r.id}`,
      kind: "PRE_LESSON" as const,
      id: r.id,
      courseId: r.courseId,
      courseName: r.courseName,
      clientCompany: r.clientCompany,
      date: r.date as ISODate,
      startMin: r.startMin as number,
      endMin: r.endMin as number,
      status: r.status,
      isManual: false,
      hasConflict: conflictKeys.has(`PRE_LESSON:${r.id}`),
      teams: accessoTeams(r),
    })),
    ...impegni.map((a) => ({
      key: `APPOINTMENT:${a.id}`,
      kind: "APPOINTMENT" as const,
      id: a.id,
      // Nessun corso a cui appartenere: 0 vale "nessuno", e l'interfaccia non
      // ci costruisce sopra nessun collegamento.
      courseId: 0,
      courseName: a.title,
      clientCompany: "",
      date: a.date as ISODate,
      startMin: a.startMin,
      endMin: a.endMin,
      status: null,
      isManual: true,
      hasConflict: false,
      teams: "",
    })),
  ];
  return events.sort(
    (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMin - b.startMin || a.courseId - b.courseId),
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export function getDashboardData(today: ISODate, ex: Executor = getDb()) {
  const weekStart = startOfWeek(today);
  const weekEnd = addDays(weekStart, 6);

  const todayEvents = getCalendarEvents(today, today, { includeCancelled: true }, ex);
  const upcoming = getCalendarEvents(addDays(today, 1), addDays(today, 60), {}, ex)
    .filter((e) => e.status !== "COMPLETED")
    .slice(0, 10);
  const weekEvents = getCalendarEvents(weekStart, weekEnd, {}, ex);

  const weekLessons = weekEvents.filter((e) => e.kind === "LESSON");
  const weekMinutes = weekLessons.reduce((s, e) => s + e.endMin - e.startMin, 0);
  const weekDoneMinutes = weekLessons
    .filter((e) => e.status === "COMPLETED")
    .reduce((s, e) => s + e.endMin - e.startMin, 0);
  const weekPreLessons = weekEvents.filter((e) => e.kind === "PRE_LESSON").length;

  const active = listCourses(["NOT_STARTED", "IN_PROGRESS"], today, ex);

  // Lezioni passate ancora "Programmata": vanno segnate a mano (nessun cambio automatico).
  const unmarked = listUnmarkedLessons(today, ex);

  // Storico: quanti corsi conclusi e quante ore sono state fatte in totale.
  const archivio = ex
    .select({
      corsi: sql<number>`count(distinct ${courses.id})`,
      minuti: sql<number>`coalesce(sum(case when ${lessons.status} = 'COMPLETED' then ${lessons.endMin} - ${lessons.startMin} else 0 end), 0)`,
    })
    .from(courses)
    .leftJoin(lessons, eq(lessons.courseId, courses.id))
    .where(eq(courses.status, "COMPLETED"))
    .get() ?? { corsi: 0, minuti: 0 };

  const futureConflicts = findConflicts(
    loadBusyEvents(ex, { from: today, to: addDays(today, 365 * 3) }),
  );

  return {
    today,
    weekStart,
    weekEnd,
    todayEvents,
    upcoming,
    weekMinutes,
    weekDoneMinutes,
    weekLessonCount: weekLessons.length,
    weekPreLessons,
    notStarted: active.filter((c) => c.status === "NOT_STARTED"),
    inProgress: active.filter((c) => c.status === "IN_PROGRESS"),
    unscheduled: active.filter((c) => c.progress.unscheduledMinutes > 0),
    unmarked,
    archive: { courses: archivio.corsi, minutes: archivio.minuti },
    conflicts: toConflictViews(ex, futureConflicts).slice(0, 10) satisfies ConflictView[],
    conflictCount: futureConflicts.length,
  };
}
