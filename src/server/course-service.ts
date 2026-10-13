import { and, asc, eq, gte, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import { TransactionRollbackError } from "drizzle-orm/errors";
import type { DB, Executor, Tx } from "@/db";
import { appointments, courses, coursePauses, lessons, preLessons, scheduleRules } from "@/db/schema";
import { addDays, isValidISODate, minDate, todayInRome, weekdayOf, type ISODate } from "@/lib/dates";
import {
  conflictSignature,
  findConflicts,
  newConflicts,
  type BusyEvent,
  type Conflict,
} from "@/lib/scheduling/conflicts";
import { recalculateSchedule, type RecalculateResult } from "@/lib/scheduling/recalculateSchedule";
import {
  blockToRule,
  findOverlappingWeekday,
  planAddDays,
  planScheduleChange,
  type ScheduleBlock,
} from "@/lib/scheduling/rules";
import { formatDateIT, WEEKDAY_NAMES } from "@/lib/dates";
import type { CourseStatus, ExistingLesson, LessonStatus } from "@/lib/scheduling/types";

// ---------------------------------------------------------------------------
// Errori ed esiti
// ---------------------------------------------------------------------------

/** Errore di dominio con messaggio mostrabile all'utente. */
export class DomainError extends Error {}

export interface ConflictItem {
  courseId: number;
  courseName: string;
  kind: BusyEvent["kind"];
  date: ISODate;
  startMin: number;
  endMin: number;
}

export interface ConflictView {
  key: string;
  a: ConflictItem;
  b: ConflictItem;
}

export interface MutationSummary {
  courseId: number;
  endDateBefore: ISODate | null;
  endDateAfter: ISODate | null;
  inserted: number;
  removed: number;
  shortfallMinutes: number;
}

export type MutationOutcome =
  | { status: "applied"; summary: MutationSummary | null; newConflicts: ConflictView[] }
  | { status: "needs-confirmation"; summary: MutationSummary | null; newConflicts: ConflictView[] };

export interface MutationOptions {
  /** Se false e l'operazione crea nuovi conflitti, la transazione viene annullata. */
  confirmConflicts?: boolean;
  /** "Oggi" da usare come soglia del ricalcolo: iniettabile per i test. */
  today?: ISODate;
}

// ---------------------------------------------------------------------------
// Lettura eventi e conflitti
// ---------------------------------------------------------------------------

export function loadBusyEvents(
  ex: Executor,
  range?: { from: ISODate; to: ISODate },
): BusyEvent[] {
  const lessonRows = ex
    .select({
      id: lessons.id,
      courseId: lessons.courseId,
      date: lessons.date,
      startMin: lessons.startMin,
      endMin: lessons.endMin,
    })
    .from(lessons)
    .where(
      and(
        ne(lessons.status, "CANCELLED"),
        range ? gte(lessons.date, range.from) : undefined,
        range ? lte(lessons.date, range.to) : undefined,
      ),
    )
    .all();

  const preRows = ex
    .select({
      id: preLessons.id,
      courseId: preLessons.courseId,
      date: preLessons.date,
      startMin: preLessons.startMin,
      endMin: preLessons.endMin,
    })
    .from(preLessons)
    .where(
      and(
        isNotNull(preLessons.date),
        range ? gte(preLessons.date, range.from) : undefined,
        range ? lte(preLessons.date, range.to) : undefined,
      ),
    )
    .all();

  // Gli impegni senza corso occupano il tempo come le lezioni: una lezione che
  // ci finisce sopra è una sovrapposizione a tutti gli effetti.
  const impegni = ex
    .select({ id: appointments.id, date: appointments.date, startMin: appointments.startMin, endMin: appointments.endMin })
    .from(appointments)
    .where(
      and(
        range ? gte(appointments.date, range.from) : undefined,
        range ? lte(appointments.date, range.to) : undefined,
      ),
    )
    .all();

  return [
    ...lessonRows.map((r) => ({ kind: "LESSON" as const, ...r })),
    ...preRows.map((r) => ({
      kind: "PRE_LESSON" as const,
      id: r.id,
      courseId: r.courseId,
      date: r.date as ISODate,
      startMin: r.startMin as number,
      endMin: r.endMin as number,
    })),
    ...impegni.map((r) => ({
      kind: "APPOINTMENT" as const,
      id: r.id,
      courseId: 0,
      date: r.date as ISODate,
      startMin: r.startMin,
      endMin: r.endMin,
    })),
  ];
}

function courseConflicts(ex: Executor, courseId: number): Conflict[] {
  return findConflicts(loadBusyEvents(ex)).filter(
    (c) => c.a.courseId === courseId || c.b.courseId === courseId,
  );
}

export function toConflictViews(ex: Executor, conflicts: readonly Conflict[]): ConflictView[] {
  if (conflicts.length === 0) return [];
  const ids = [...new Set(conflicts.flatMap((c) => [c.a.courseId, c.b.courseId]))];
  const names = new Map(
    ex
      .select({ id: courses.id, name: courses.name })
      .from(courses)
      .where(inArray(courses.id, ids))
      .all()
      .map((r) => [r.id, r.name]),
  );
  const item = (e: BusyEvent): ConflictItem => ({
    courseId: e.courseId,
    courseName: e.kind === "APPOINTMENT" ? "Impegno a calendario" : names.get(e.courseId) ?? `Corso #${e.courseId}`,
    kind: e.kind,
    date: e.date,
    startMin: e.startMin,
    endMin: e.endMin,
  });
  return conflicts.map((c) => ({ key: conflictSignature(c), a: item(c.a), b: item(c.b) }));
}

// ---------------------------------------------------------------------------
// Ricalcolo
// ---------------------------------------------------------------------------

function now() {
  return new Date().toISOString();
}

function getCourseOrThrow(ex: Executor, courseId: number) {
  const course = ex.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!course) throw new DomainError("Corso non trovato.");
  return course;
}

function courseEndDate(ex: Executor, courseId: number): ISODate | null {
  const row = ex
    .select({ end: sql<string | null>`max(${lessons.date})` })
    .from(lessons)
    .where(and(eq(lessons.courseId, courseId), ne(lessons.status, "CANCELLED")))
    .get();
  return row?.end ?? null;
}

export function loadScheduleInput(ex: Executor, courseId: number) {
  const course = getCourseOrThrow(ex, courseId);
  const rules = ex
    .select()
    .from(scheduleRules)
    .where(eq(scheduleRules.courseId, courseId))
    .orderBy(asc(scheduleRules.validFrom), asc(scheduleRules.id))
    .all();
  const pauses = ex
    .select()
    .from(coursePauses)
    .where(eq(coursePauses.courseId, courseId))
    .orderBy(asc(coursePauses.startDate))
    .all();
  const existing: ExistingLesson[] = ex
    .select()
    .from(lessons)
    .where(eq(lessons.courseId, courseId))
    .orderBy(asc(lessons.date), asc(lessons.startMin), asc(lessons.id))
    .all();
  return { course, rules, pauses, existing };
}

/**
 * Applica il ricalcolo del calendario di un corso (da chiamare dentro una transazione).
 *
 * Di regola il motore non genera nulla prima di oggi: una modifica odierna non può
 * creare lezioni in date passate. `allowPast` serve solo alla creazione di un corso
 * già iniziato, dove lo storico va generato per intero.
 */
export function recalculateCourse(
  tx: Tx,
  courseId: number,
  from?: ISODate,
  options: { allowPast?: boolean; today?: ISODate } = {},
): RecalculateResult {
  const { course, rules, pauses, existing } = loadScheduleInput(tx, courseId);
  const result = recalculateSchedule({
    courseStartDate: course.startDate,
    totalMinutes: course.totalMinutes,
    rules,
    pauses,
    existing,
    from,
    notBefore: options.allowPast ? undefined : (options.today ?? todayInRome()),
  });

  const timestamp = now();
  if (result.removeIds.length > 0) {
    tx.delete(lessons).where(inArray(lessons.id, result.removeIds)).run();
  }
  for (const update of result.ruleUpdates) {
    tx.update(lessons)
      .set({ scheduleRuleId: update.scheduleRuleId, updatedAt: timestamp })
      .where(eq(lessons.id, update.id))
      .run();
  }
  if (result.insert.length > 0) {
    tx.insert(lessons)
      .values(result.insert.map((l) => ({ courseId, status: "PLANNED" as const, isManual: false, ...l })))
      .run();
  }
  return result;
}

/**
 * Esegue una modifica in transazione, calcola i conflitti nuovi e, se l'utente non li
 * ha ancora confermati, annulla tutto restituendo l'anteprima.
 */
export function runMutation(
  db: DB,
  courseIdHint: number | null,
  options: MutationOptions,
  mutate: (tx: Tx) => { courseId: number; recalc: RecalculateResult | null },
): MutationOutcome {
  const result: { outcome?: MutationOutcome } = {};
  try {
    db.transaction((tx) => {
      const before = courseIdHint !== null ? courseConflicts(tx, courseIdHint) : [];
      const endDateBefore = courseIdHint !== null ? courseEndDate(tx, courseIdHint) : null;

      const { courseId, recalc } = mutate(tx);

      const after = courseConflicts(tx, courseId);
      const added = newConflicts(before, after);
      const summary: MutationSummary | null = recalc
        ? {
            courseId,
            endDateBefore,
            endDateAfter: courseEndDate(tx, courseId),
            inserted: recalc.insert.length,
            removed: recalc.removeIds.length,
            shortfallMinutes: recalc.shortfallMinutes,
          }
        : null;
      const views = toConflictViews(tx, added);

      if (views.length > 0 && !options.confirmConflicts) {
        result.outcome = { status: "needs-confirmation", summary, newConflicts: views };
        tx.rollback(); // lancia TransactionRollbackError: nessuna scrittura persiste
      }
      result.outcome = { status: "applied", summary, newConflicts: views };
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
  if (!result.outcome) throw new Error("Transazione terminata senza esito.");
  return result.outcome;
}

// ---------------------------------------------------------------------------
// Validazioni comuni
// ---------------------------------------------------------------------------

function assertDate(value: string, label: string): ISODate {
  if (!isValidISODate(value)) throw new DomainError(`${label}: data non valida.`);
  return value;
}

function assertTimeRange(startMin: number, endMin: number) {
  if (
    !Number.isInteger(startMin) ||
    !Number.isInteger(endMin) ||
    startMin < 0 ||
    endMin > 1440 ||
    startMin >= endMin
  ) {
    throw new DomainError("L'ora di fine deve essere successiva all'ora di inizio.");
  }
}

function assertMask(mask: number) {
  if (!Number.isInteger(mask) || mask < 1 || mask > 127) {
    throw new DomainError("Seleziona almeno un giorno della settimana.");
  }
}

/**
 * Le righe orario di una fase: almeno una, e lo stesso giorno non può
 * comparire due volte (altrimenti non si saprebbe a che ora fare lezione).
 */
function assertBlocks(blocks: readonly ScheduleBlock[], phaseFrom: ISODate) {
  if (blocks.length === 0) throw new DomainError("Serve almeno un giorno con orario.");
  for (const block of blocks) {
    assertMask(block.weekdaysMask);
    assertTimeRange(block.startMin, block.endMin);
    if (block.from) {
      assertDate(block.from, "Giorni validi dal");
      if (block.from < phaseFrom) {
        throw new DomainError(
          `Una riga orario parte dal ${formatDateIT(block.from)}, prima dell'inizio (${formatDateIT(phaseFrom)}).`,
        );
      }
    }
  }
  const doppio = findOverlappingWeekday(blocks);
  if (doppio !== null) {
    throw new DomainError(`${WEEKDAY_NAMES[doppio as 1]} compare in due righe orario: scegline una sola.`);
  }
}

// ---------------------------------------------------------------------------
// Corsi
// ---------------------------------------------------------------------------

export interface CourseFields {
  name: string;
  clientCompany: string;
  mode: string;
  studentsCount: number | null;
  studentReference: string;
  /** Numero dell'ordine d'incarico, come scritto nella mail di assegnazione. */
  assignmentNumber: string;
  clientContact: string;
  /** Accesso alla riunione Teams: link, utente e password della mail di conferma. */
  meetingUrl?: string;
  meetingUser?: string;
  meetingPassword?: string;
  /** Compenso pattuito, in centesimi. null = non indicato. */
  feeCents: number | null;
  totalMinutes: number;
  startDate: ISODate;
  notes: string;
}

/**
 * Un periodo del corso: dei giorni con il loro orario, validi da una data a
 * un'altra. Serve per i calendari allegati agli incarichi, che spesso cambiano
 * ritmo a metà ("martedì e giovedì 18–20 fino al 5 novembre, poi giovedì e
 * venerdì 20–22"). La data di fine è quella dell'ultima lezione del periodo,
 * non la vigilia del successivo: fra i due può cadere un giorno della settimana
 * del primo periodo, e chiudere dopo genererebbe una lezione che non esiste.
 */
export interface CoursePhase {
  from: ISODate;
  /** Inclusivo; `null` lascia il periodo aperto (l'ultimo, per i recuperi). */
  to: ISODate | null;
  blocks: ScheduleBlock[];
}

export interface CreateCourseInput extends CourseFields {
  status: CourseStatus;
  /** Righe orario: giorni + orario. Più righe quando i giorni hanno orari diversi. */
  schedule: ScheduleBlock[];
  /** Calendario a più periodi: quando c'è, sostituisce `schedule`. */
  phases?: CoursePhase[];
  /** Interruzioni note alla creazione: le chiusure scritte nel calendario. */
  pauses?: PauseInputData[];
  firstLesson: { date: ISODate; startMin: number; endMin: number } | null;
  preLesson: { date: ISODate | null; startMin: number | null } | null;
}

function validateCourseFields(f: CourseFields) {
  if (!f.name.trim()) throw new DomainError("Il nome del corso è obbligatorio.");
  if (!Number.isInteger(f.totalMinutes) || f.totalMinutes <= 0) {
    throw new DomainError("Il monte ore deve essere maggiore di zero.");
  }
  if (f.studentsCount !== null && (!Number.isInteger(f.studentsCount) || f.studentsCount < 0)) {
    throw new DomainError("Numero allievi non valido.");
  }
  assertDate(f.startDate, "Data inizio");
}

export function createCourse(db: DB, input: CreateCourseInput, options: MutationOptions = {}) {
  validateCourseFields(input);
  const fasi: CoursePhase[] =
    input.phases && input.phases.length > 0
      ? input.phases
      : [{ from: input.startDate, to: null, blocks: input.schedule }];
  for (const fase of fasi) assertBlocks(fase.blocks, fase.from);
  for (const pausa of input.pauses ?? []) validatePause(pausa);

  let firstRuleFrom = input.startDate;
  if (input.firstLesson) {
    assertDate(input.firstLesson.date, "Prima lezione");
    assertTimeRange(input.firstLesson.startMin, input.firstLesson.endMin);
    if (input.firstLesson.date < input.startDate) {
      throw new DomainError("La prima lezione non può precedere la data di inizio corso.");
    }
    firstRuleFrom = addDays(input.firstLesson.date, 1);
  }
  const preLesson = normalizePreLesson(input.preLesson);

  let createdId = 0;
  const outcome = runMutation(db, null, options, (tx) => {
    const timestamp = now();
    const course = tx
      .insert(courses)
      .values({
        name: input.name.trim(),
        clientCompany: input.clientCompany.trim(),
        mode: input.mode.trim(),
        studentsCount: input.studentsCount,
        studentReference: input.studentReference.trim(),
        assignmentNumber: input.assignmentNumber.trim(),
        clientContact: input.clientContact.trim(),
        meetingUrl: (input.meetingUrl ?? "").trim(),
        meetingUser: (input.meetingUser ?? "").trim(),
        meetingPassword: (input.meetingPassword ?? "").trim(),
        feeCents: input.feeCents,
        totalMinutes: input.totalMinutes,
        startDate: input.startDate,
        status: input.status,
        notes: input.notes,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning({ id: courses.id })
      .get();
    createdId = course.id;

    if (input.firstLesson) {
      tx.insert(scheduleRules)
        .values({
          courseId: course.id,
          validFrom: input.firstLesson.date,
          validTo: input.firstLesson.date,
          weekdaysMask: 1 << (weekdayOf(input.firstLesson.date) - 1),
          startMin: input.firstLesson.startMin,
          endMin: input.firstLesson.endMin,
        })
        .run();
    }
    tx.insert(scheduleRules)
      .values(
        fasi.flatMap((fase, indice) =>
          fase.blocks.map((block) => ({
            courseId: course.id,
            ...blockToRule(block, indice === 0 ? firstRuleFrom : fase.from),
            validTo: fase.to,
          })),
        ),
      )
      .run();
    // Le interruzioni vanno scritte prima del ricalcolo: le lezioni nascono
    // già saltando i giorni di chiusura.
    for (const pausa of input.pauses ?? []) {
      tx.insert(coursePauses).values({ courseId: course.id, ...pausa }).run();
    }
    if (preLesson) tx.insert(preLessons).values({ courseId: course.id, ...preLesson }).run();

    // Alla creazione lo storico si può generare: serve per registrare un corso già iniziato.
    return { courseId: course.id, recalc: recalculateCourse(tx, course.id, undefined, { allowPast: true }) };
  });
  return { outcome, courseId: outcome.status === "applied" ? createdId : null };
}

export function updateCourse(
  db: DB,
  courseId: number,
  fields: CourseFields,
  options: MutationOptions = {},
) {
  validateCourseFields(fields);
  return runMutation(db, courseId, options, (tx) => {
    const current = getCourseOrThrow(tx, courseId);
    tx.update(courses)
      .set({
        name: fields.name.trim(),
        clientCompany: fields.clientCompany.trim(),
        mode: fields.mode.trim(),
        studentsCount: fields.studentsCount,
        studentReference: fields.studentReference.trim(),
        assignmentNumber: fields.assignmentNumber.trim(),
        clientContact: fields.clientContact.trim(),
        // Chi non manda il campo non lo sta svuotando: l'accesso Teams resta.
        ...(fields.meetingUrl !== undefined ? { meetingUrl: fields.meetingUrl.trim() } : {}),
        ...(fields.meetingUser !== undefined ? { meetingUser: fields.meetingUser.trim() } : {}),
        ...(fields.meetingPassword !== undefined ? { meetingPassword: fields.meetingPassword.trim() } : {}),
        feeCents: fields.feeCents,
        totalMinutes: fields.totalMinutes,
        startDate: fields.startDate,
        notes: fields.notes,
        updatedAt: now(),
      })
      .where(eq(courses.id, courseId))
      .run();

    const scheduleChanged =
      current.startDate !== fields.startDate || current.totalMinutes !== fields.totalMinutes;
    if (!scheduleChanged) return { courseId, recalc: null };

    if (current.startDate !== fields.startDate) {
      // La prima fase segue la data di inizio, se ne era allineata.
      const first = tx
        .select()
        .from(scheduleRules)
        .where(eq(scheduleRules.courseId, courseId))
        .orderBy(asc(scheduleRules.validFrom))
        .limit(1)
        .get();
      if (
        first &&
        first.validFrom === current.startDate &&
        (first.validTo === null || first.validTo >= fields.startDate)
      ) {
        tx.update(scheduleRules)
          .set({ validFrom: fields.startDate, updatedAt: now() })
          .where(eq(scheduleRules.id, first.id))
          .run();
      }
    }
    const from =
      current.totalMinutes !== fields.totalMinutes
        ? undefined
        : minDate(current.startDate, fields.startDate);
    return { courseId, recalc: recalculateCourse(tx, courseId, from, { today: options.today }) };
  });
}

export function updateCourseNotes(db: DB, courseId: number, notes: string) {
  const result = db
    .update(courses)
    .set({ notes, updatedAt: now() })
    .where(eq(courses.id, courseId))
    .run();
  if (result.changes === 0) throw new DomainError("Corso non trovato.");
}

export function setCourseStatus(db: DB, courseId: number, status: CourseStatus) {
  const result = db
    .update(courses)
    .set({ status, updatedAt: now() })
    .where(eq(courses.id, courseId))
    .run();
  if (result.changes === 0) throw new DomainError("Corso non trovato.");
}

export function deleteCourse(db: DB, courseId: number) {
  const result = db.delete(courses).where(eq(courses.id, courseId)).run();
  if (result.changes === 0) throw new DomainError("Corso non trovato.");
}

// ---------------------------------------------------------------------------
// Calendarizzazione
// ---------------------------------------------------------------------------

export interface ChangeScheduleInput {
  validFrom: ISODate;
  blocks: ScheduleBlock[];
}

/**
 * Nuova fase di calendarizzazione da `validFrom` in poi:
 * - le fasi che iniziano da `validFrom` in poi vengono sostituite;
 * - la fase attiva viene chiusa al giorno precedente;
 * - le lezioni precedenti a `validFrom` restano invariate, il futuro viene rigenerato.
 */
export function changeSchedule(
  db: DB,
  courseId: number,
  input: ChangeScheduleInput,
  options: MutationOptions = {},
) {
  assertDate(input.validFrom, "Valida dal");
  assertBlocks(input.blocks, input.validFrom);

  return runMutation(db, courseId, options, (tx) => {
    const course = getCourseOrThrow(tx, courseId);
    if (input.validFrom < course.startDate) {
      throw new DomainError("La nuova calendarizzazione non può iniziare prima dell'inizio corso.");
    }
    const timestamp = now();
    const current = tx.select().from(scheduleRules).where(eq(scheduleRules.courseId, courseId)).all();
    const plan = planScheduleChange(current, input, []);

    if (plan.removedIds.length > 0) {
      tx.delete(scheduleRules).where(inArray(scheduleRules.id, plan.removedIds)).run();
    }
    for (const rule of plan.rules.filter((r) => plan.closedIds.includes(r.id))) {
      tx.update(scheduleRules)
        .set({ validTo: rule.validTo, updatedAt: timestamp })
        .where(eq(scheduleRules.id, rule.id))
        .run();
    }
    tx.insert(scheduleRules)
      .values(
        input.blocks.map((block) => ({
          courseId,
          ...blockToRule(block, input.validFrom),
          createdAt: timestamp,
          updatedAt: timestamp,
        })),
      )
      .run();

    return { courseId, recalc: recalculateCourse(tx, courseId, input.validFrom, { today: options.today }) };
  });
}

/**
 * Aggiunge giorni di lezione da `validFrom` in poi senza toccare quelli già in
 * vigore: il sabato comunicato dopo l'avvio di un corso del mercoledì.
 */
export function addScheduleDays(
  db: DB,
  courseId: number,
  input: ChangeScheduleInput,
  options: MutationOptions = {},
) {
  assertDate(input.validFrom, "Valido dal");
  assertBlocks(input.blocks, input.validFrom);

  return runMutation(db, courseId, options, (tx) => {
    const course = getCourseOrThrow(tx, courseId);
    if (input.validFrom < course.startDate) {
      throw new DomainError("Il giorno aggiunto non può partire prima dell'inizio corso.");
    }
    const current = tx.select().from(scheduleRules).where(eq(scheduleRules.courseId, courseId)).all();
    const { clash } = planAddDays(current, input, []);
    if (clash !== null) {
      throw new DomainError(
        `${WEEKDAY_NAMES[clash as 1]} è già calendarizzato in quel periodo: per cambiarne l'orario usa "Cambia calendarizzazione".`,
      );
    }
    const timestamp = now();
    tx.insert(scheduleRules)
      .values(
        input.blocks.map((block) => ({
          courseId,
          ...blockToRule(block, input.validFrom),
          createdAt: timestamp,
          updatedAt: timestamp,
        })),
      )
      .run();
    return { courseId, recalc: recalculateCourse(tx, courseId, input.validFrom, { today: options.today }) };
  });
}

/**
 * Elimina l'ultima fase (tutte le righe orario che iniziano nella sua data)
 * riaprendo quelle chiuse il giorno prima. Se l'ultima fase era un giorno
 * aggiunto, le righe precedenti sono ancora aperte e restano come sono.
 */
export function deleteLastScheduleRule(
  db: DB,
  courseId: number,
  ruleId: number,
  options: MutationOptions = {},
) {
  return runMutation(db, courseId, options, (tx) => {
    const rules = tx
      .select()
      .from(scheduleRules)
      .where(eq(scheduleRules.courseId, courseId))
      .orderBy(asc(scheduleRules.validFrom), asc(scheduleRules.id))
      .all();
    const last = rules.at(-1);
    const group = last ? rules.filter((r) => r.validFrom === last.validFrom) : [];
    if (!last || !group.some((r) => r.id === ruleId)) {
      throw new DomainError("Si può eliminare solo l'ultima fase di calendarizzazione.");
    }
    const rest = rules.filter((r) => r.validFrom !== last.validFrom);
    if (rest.length === 0) {
      throw new DomainError("Il corso deve avere almeno una fase di calendarizzazione.");
    }
    tx.delete(scheduleRules)
      .where(inArray(scheduleRules.id, group.map((r) => r.id)))
      .run();
    const dayBefore = addDays(last.validFrom, -1);
    const reopen = rest.filter((r) => r.validTo === dayBefore && r.validFrom !== r.validTo);
    if (reopen.length > 0) {
      tx.update(scheduleRules)
        .set({ validTo: last.validTo, updatedAt: now() })
        .where(inArray(scheduleRules.id, reopen.map((r) => r.id)))
        .run();
    }
    return { courseId, recalc: recalculateCourse(tx, courseId, last.validFrom, { today: options.today }) };
  });
}

// ---------------------------------------------------------------------------
// Lezioni
// ---------------------------------------------------------------------------

function getLessonOrThrow(ex: Executor, lessonId: number) {
  const lesson = ex.select().from(lessons).where(eq(lessons.id, lessonId)).get();
  if (!lesson) throw new DomainError("Lezione non trovata.");
  return lesson;
}

export function setLessonStatus(
  db: DB,
  lessonId: number,
  status: LessonStatus,
  options: MutationOptions = {},
) {
  const lesson = getLessonOrThrow(db, lessonId);
  return runMutation(db, lesson.courseId, options, (tx) => {
    tx.update(lessons).set({ status, updatedAt: now() }).where(eq(lessons.id, lessonId)).run();
    return { courseId: lesson.courseId, recalc: recalculateCourse(tx, lesson.courseId, lesson.date, { today: options.today }) };
  });
}

export interface UpdateLessonInput {
  date: ISODate;
  startMin: number;
  endMin: number;
  status: LessonStatus;
}

/** Modifica puntuale: non altera le regole del corso; la lezione diventa manuale se spostata. */
export function updateLesson(
  db: DB,
  lessonId: number,
  input: UpdateLessonInput,
  options: MutationOptions = {},
) {
  assertDate(input.date, "Data lezione");
  assertTimeRange(input.startMin, input.endMin);
  const lesson = getLessonOrThrow(db, lessonId);

  return runMutation(db, lesson.courseId, options, (tx) => {
    const moved =
      lesson.date !== input.date ||
      lesson.startMin !== input.startMin ||
      lesson.endMin !== input.endMin;
    tx.update(lessons)
      .set({
        date: input.date,
        startMin: input.startMin,
        endMin: input.endMin,
        status: input.status,
        isManual: lesson.isManual || moved,
        updatedAt: now(),
      })
      .where(eq(lessons.id, lessonId))
      .run();
    return {
      courseId: lesson.courseId,
      recalc: recalculateCourse(tx, lesson.courseId, minDate(lesson.date, input.date), { today: options.today }),
    };
  });
}

/** Riporta una lezione modificata manualmente sotto il controllo delle regole. */
export function resetLessonToRule(db: DB, lessonId: number, options: MutationOptions = {}) {
  const lesson = getLessonOrThrow(db, lessonId);
  return runMutation(db, lesson.courseId, options, (tx) => {
    tx.update(lessons)
      .set({ isManual: false, updatedAt: now() })
      .where(eq(lessons.id, lessonId))
      .run();
    const from = minDate(lesson.date, lesson.slotDate ?? lesson.date);
    return { courseId: lesson.courseId, recalc: recalculateCourse(tx, lesson.courseId, from, { today: options.today }) };
  });
}

// ---------------------------------------------------------------------------
// Pause
// ---------------------------------------------------------------------------

export interface PauseInputData {
  startDate: ISODate;
  endDate: ISODate;
}

function validatePause(input: PauseInputData) {
  assertDate(input.startDate, "Inizio pausa");
  assertDate(input.endDate, "Fine pausa");
  if (input.startDate > input.endDate) {
    throw new DomainError("La fine della pausa non può precedere l'inizio.");
  }
}

export function addPause(db: DB, courseId: number, input: PauseInputData, options: MutationOptions = {}) {
  validatePause(input);
  return runMutation(db, courseId, options, (tx) => {
    getCourseOrThrow(tx, courseId);
    tx.insert(coursePauses).values({ courseId, ...input }).run();
    return { courseId, recalc: recalculateCourse(tx, courseId, input.startDate, { today: options.today }) };
  });
}

export function updatePause(db: DB, pauseId: number, input: PauseInputData, options: MutationOptions = {}) {
  validatePause(input);
  const pause = db.select().from(coursePauses).where(eq(coursePauses.id, pauseId)).get();
  if (!pause) throw new DomainError("Pausa non trovata.");
  return runMutation(db, pause.courseId, options, (tx) => {
    tx.update(coursePauses)
      .set({ ...input, updatedAt: now() })
      .where(eq(coursePauses.id, pauseId))
      .run();
    const from = minDate(pause.startDate, input.startDate);
    return { courseId: pause.courseId, recalc: recalculateCourse(tx, pause.courseId, from, { today: options.today }) };
  });
}

export function deletePause(db: DB, pauseId: number, options: MutationOptions = {}) {
  const pause = db.select().from(coursePauses).where(eq(coursePauses.id, pauseId)).get();
  if (!pause) throw new DomainError("Pausa non trovata.");
  return runMutation(db, pause.courseId, options, (tx) => {
    tx.delete(coursePauses).where(eq(coursePauses.id, pauseId)).run();
    return { courseId: pause.courseId, recalc: recalculateCourse(tx, pause.courseId, pause.startDate, { today: options.today }) };
  });
}

// ---------------------------------------------------------------------------
// Prelezione
// ---------------------------------------------------------------------------

export const PRE_LESSON_MINUTES = 60;

function normalizePreLesson(input: { date: ISODate | null; startMin: number | null } | null) {
  if (!input) return null;
  if (input.date === null && input.startMin === null) {
    return { date: null, startMin: null, endMin: null };
  }
  if (input.date === null || input.startMin === null) {
    throw new DomainError("Prelezione: indica sia la data sia l'ora di inizio (oppure nessuna delle due).");
  }
  assertDate(input.date, "Prelezione");
  assertTimeRange(input.startMin, input.startMin + PRE_LESSON_MINUTES);
  return { date: input.date, startMin: input.startMin, endMin: input.startMin + PRE_LESSON_MINUTES };
}

/**
 * Stato della prelezione: svolta, annullata o di nuovo in programma. Non tocca
 * il monte ore — la prelezione ne resta fuori — ma va segnata come le lezioni.
 */
export function setPreLessonStatus(db: DB, courseId: number, status: LessonStatus) {
  const result = db
    .update(preLessons)
    .set({ status, updatedAt: now() })
    .where(eq(preLessons.courseId, courseId))
    .run();
  if (result.changes === 0) throw new DomainError("Questo corso non ha una prelezione.");
}

/** `input = null` rimuove la prelezione ("Prelezione presente" = no). */
export function setPreLesson(
  db: DB,
  courseId: number,
  input: { date: ISODate | null; startMin: number | null } | null,
  options: MutationOptions = {},
) {
  const normalized = normalizePreLesson(input);
  return runMutation(db, courseId, options, (tx) => {
    getCourseOrThrow(tx, courseId);
    if (!normalized) {
      tx.delete(preLessons).where(eq(preLessons.courseId, courseId)).run();
    } else {
      tx.insert(preLessons)
        .values({ courseId, ...normalized })
        .onConflictDoUpdate({
          target: preLessons.courseId,
          // Spostare la prelezione la rimette "in programma": è slittata.
          set: { ...normalized, status: "PLANNED", updatedAt: now() },
        })
        .run();
    }
    return { courseId, recalc: null };
  });
}

/**
 * Riallinea il calendario alle regole considerando rigenerabili tutte le lezioni
 * programmate automatiche (svolte, annullate e manuali restano intatte).
 */
export function recalculateFromStart(db: DB, courseId: number, options: MutationOptions = {}) {
  return runMutation(db, courseId, options, (tx) => ({
    courseId,
    recalc: recalculateCourse(tx, courseId, undefined, { today: options.today }),
  }));
}
