"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { isValidISODate } from "@/lib/dates";
import { ParserError, parseCourseEmail, type ParsedCourseDraft } from "@/lib/deepseek/parser";
import { COURSE_STATUSES, LESSON_STATUSES } from "@/lib/scheduling/types";
import { scheduleBackgroundSync, syncAppleCalendar, type SyncReport } from "./calendar-sync";
import { deleteAppointment, updateAppointment } from "./appointment-service";
import * as service from "./course-service";
import {
  attachContract,
  confirmMail,
  ingestMail,
  createCourseFromMail,
  reparseMail,
  setMailStatus,
  type IngestReport,
} from "./mail-service";

// Applicazione single-user in LAN: nessuna autenticazione (vedi README).
// Ogni input viene comunque validato qui, lato server.

export type ActionError = { ok: false; error: string };
export type MutationActionResult =
  | { ok: true; outcome: service.MutationOutcome; courseId: number | null }
  | ActionError;
export type SimpleActionResult = { ok: true } | ActionError;
export type ParseActionResult = { ok: true; draft: ParsedCourseDraft } | ActionError;

const isoDate = z.string().refine(isValidISODate, "Data non valida.");
const minute = z.number().int().min(0).max(1440);
const id = z.number().int().positive();
const confirm = z.boolean();

const courseFields = z.object({
  name: z.string().trim().min(1, "Il nome del corso è obbligatorio.").max(200),
  clientCompany: z.string().max(200),
  mode: z.string().max(100),
  studentsCount: z.number().int().min(0).nullable(),
  studentReference: z.string().max(200),
  assignmentNumber: z.string().max(100),
  clientContact: z.string().max(200),
  meetingUrl: z.string().max(2000).default(""),
  meetingUser: z.string().max(200).default(""),
  meetingPassword: z.string().max(200).default(""),
  feeCents: z.number().int().min(0).max(100_000_00).nullable(),
  totalMinutes: z.number().int().positive("Il monte ore deve essere maggiore di zero.").max(100_000),
  startDate: isoDate,
  notes: z.string().max(20_000),
});

/** Una riga orario: giorni + orario. Una fase ne può avere più d'una. */
const scheduleBlock = z.object({
  weekdaysMask: z.number().int().min(1, "Seleziona almeno un giorno.").max(127),
  startMin: minute,
  endMin: minute,
  from: isoDate.nullable().optional(),
});
const scheduleBlocks = z.array(scheduleBlock).min(1, "Serve almeno un giorno con orario.").max(7);

const createCourseSchema = courseFields.extend({
  status: z.enum(COURSE_STATUSES),
  schedule: scheduleBlocks,
  firstLesson: z.object({ date: isoDate, startMin: minute, endMin: minute }).nullable(),
  preLesson: z.object({ date: isoDate.nullable(), startMin: minute.nullable() }).nullable(),
});

const scheduleSchema = z.object({ validFrom: isoDate, blocks: scheduleBlocks });

const lessonSchema = z.object({
  date: isoDate,
  startMin: minute,
  endMin: minute,
  status: z.enum(LESSON_STATUSES),
});

const pauseSchema = z.object({ startDate: isoDate, endDate: isoDate });
const preLessonSchema = z.object({ date: isoDate.nullable(), startMin: minute.nullable() }).nullable();

function failure(error: unknown): ActionError {
  if (error instanceof service.DomainError || error instanceof ParserError) {
    return { ok: false, error: error.message };
  }
  if (error instanceof z.ZodError) {
    return { ok: false, error: error.issues[0]?.message ?? "Dati non validi." };
  }
  console.error(error);
  return { ok: false, error: "Errore imprevisto: nessuna modifica è stata salvata." };
}

function refresh() {
  revalidatePath("/", "layout");
  // Allinea il calendario Apple dopo aver risposto: se iCloud non risponde,
  // la modifica sul gestionale resta comunque salvata.
  after(async () => {
    await scheduleBackgroundSync();
  });
}

function mutation(
  run: () => service.MutationOutcome | { outcome: service.MutationOutcome; courseId: number | null },
): MutationActionResult {
  try {
    const result = run();
    const { outcome, courseId } = "outcome" in result ? result : { outcome: result, courseId: null };
    if (outcome.status === "applied") refresh();
    return { ok: true, outcome, courseId };
  } catch (error) {
    return failure(error);
  }
}

function simple(run: () => void): SimpleActionResult {
  try {
    run();
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

// ---------------------------------------------------------------------------

export async function parseEmailAction(text: string): Promise<ParseActionResult> {
  try {
    const draft = await parseCourseEmail(z.string().parse(text));
    return { ok: true, draft };
  } catch (error) {
    return failure(error);
  }
}

export async function createCourseAction(
  input: unknown,
  confirmConflicts: boolean,
  mailId?: number,
) {
  return mutation(() => {
    const result = service.createCourse(getDb(), createCourseSchema.parse(input), {
      confirmConflicts: confirm.parse(confirmConflicts),
    });
    // Corso nato da una mail: la mail risulta gestita, con il corso collegato,
    // e la lettera d'incarico allegata resta consultabile dal corso.
    if (result.outcome.status === "applied" && result.courseId && mailId !== undefined) {
      const db = getDb();
      setMailStatus(db, id.parse(mailId), "CONFERMATA", result.courseId);
      attachContract(db, id.parse(mailId), result.courseId);
    }
    return result;
  });
}

// --- Posta in arrivo -------------------------------------------------------

/** Controlla la casella e archivia le proposte. Non tocca il calendario. */
export async function checkMailAction(): Promise<{ ok: true; report: IngestReport } | ActionError> {
  try {
    const report = await ingestMail(getDb());
    revalidatePath("/", "layout");
    return { ok: true, report };
  } catch (error) {
    return failure(error);
  }
}

export async function confirmMailAction(mailId: number, confirmConflicts: boolean) {
  return mutation(() => confirmMail(getDb(), id.parse(mailId), { confirmConflicts: confirm.parse(confirmConflicts) }));
}

const appointmentSchema = z.object({
  title: z.string().trim().min(1, "L'impegno ha bisogno di un titolo.").max(200),
  date: isoDate,
  startMin: minute,
  endMin: minute,
});

/** Corregge un impegno a calendario (data, ora, titolo). */
export async function updateAppointmentAction(
  appointmentId: number,
  input: unknown,
  confirmConflicts: boolean,
): Promise<MutationActionResult> {
  return mutation(() => {
    updateAppointment(getDb(), id.parse(appointmentId), appointmentSchema.parse(input));
    // Un impegno non ha un corso a cui riferire le sovrapposizioni: si applica e
    // si vedono sul calendario, dove l'impegno vive.
    void confirm.parse(confirmConflicts);
    return { status: "applied", summary: null, newConflicts: [] } satisfies service.MutationOutcome;
  });
}

export async function deleteAppointmentAction(appointmentId: number): Promise<SimpleActionResult> {
  return simple(() => deleteAppointment(getDb(), id.parse(appointmentId)));
}

/** Crea il corso dalle date del calendario allegato alla mail. */
export async function createCourseFromMailAction(mailId: number, confirmConflicts: boolean) {
  return mutation(() => createCourseFromMail(getDb(), id.parse(mailId), {
    confirmConflicts: confirm.parse(confirmConflicts),
  }));
}

export async function ignoreMailAction(mailId: number): Promise<SimpleActionResult> {
  return simple(() => setMailStatus(getDb(), id.parse(mailId), "IGNORATA"));
}

/** Rilegge una mail già archiviata e ricalcola la proposta. */
export async function reparseMailAction(mailId: number): Promise<SimpleActionResult> {
  try {
    await reparseMail(getDb(), id.parse(mailId));
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function restoreMailAction(mailId: number): Promise<SimpleActionResult> {
  return simple(() => setMailStatus(getDb(), id.parse(mailId), "NUOVA"));
}

export async function updateCourseAction(courseId: number, input: unknown, confirmConflicts: boolean) {
  return mutation(() =>
    service.updateCourse(getDb(), id.parse(courseId), courseFields.parse(input), {
      confirmConflicts: confirm.parse(confirmConflicts),
    }),
  );
}

export async function updateNotesAction(courseId: number, notes: string): Promise<SimpleActionResult> {
  return simple(() =>
    service.updateCourseNotes(getDb(), id.parse(courseId), z.string().max(20_000).parse(notes)),
  );
}

export async function setCourseStatusAction(courseId: number, status: string): Promise<SimpleActionResult> {
  return simple(() =>
    service.setCourseStatus(getDb(), id.parse(courseId), z.enum(COURSE_STATUSES).parse(status)),
  );
}

export async function deleteCourseAction(courseId: number): Promise<SimpleActionResult> {
  return simple(() => service.deleteCourse(getDb(), id.parse(courseId)));
}

export async function changeScheduleAction(courseId: number, input: unknown, confirmConflicts: boolean) {
  return mutation(() =>
    service.changeSchedule(getDb(), id.parse(courseId), scheduleSchema.parse(input), {
      confirmConflicts: confirm.parse(confirmConflicts),
    }),
  );
}

export async function addScheduleDaysAction(courseId: number, input: unknown, confirmConflicts: boolean) {
  return mutation(() =>
    service.addScheduleDays(getDb(), id.parse(courseId), scheduleSchema.parse(input), {
      confirmConflicts: confirm.parse(confirmConflicts),
    }),
  );
}

export async function deleteScheduleRuleAction(courseId: number, ruleId: number, confirmConflicts: boolean) {
  return mutation(() =>
    service.deleteLastScheduleRule(getDb(), id.parse(courseId), id.parse(ruleId), {
      confirmConflicts: confirm.parse(confirmConflicts),
    }),
  );
}

export async function setLessonStatusAction(lessonId: number, status: string, confirmConflicts: boolean) {
  return mutation(() =>
    service.setLessonStatus(getDb(), id.parse(lessonId), z.enum(LESSON_STATUSES).parse(status), {
      confirmConflicts: confirm.parse(confirmConflicts),
    }),
  );
}

export async function updateLessonAction(lessonId: number, input: unknown, confirmConflicts: boolean) {
  return mutation(() =>
    service.updateLesson(getDb(), id.parse(lessonId), lessonSchema.parse(input), {
      confirmConflicts: confirm.parse(confirmConflicts),
    }),
  );
}

export async function resetLessonAction(lessonId: number, confirmConflicts: boolean) {
  return mutation(() =>
    service.resetLessonToRule(getDb(), id.parse(lessonId), {
      confirmConflicts: confirm.parse(confirmConflicts),
    }),
  );
}

export async function addPauseAction(courseId: number, input: unknown, confirmConflicts: boolean) {
  return mutation(() =>
    service.addPause(getDb(), id.parse(courseId), pauseSchema.parse(input), {
      confirmConflicts: confirm.parse(confirmConflicts),
    }),
  );
}

export async function updatePauseAction(pauseId: number, input: unknown, confirmConflicts: boolean) {
  return mutation(() =>
    service.updatePause(getDb(), id.parse(pauseId), pauseSchema.parse(input), {
      confirmConflicts: confirm.parse(confirmConflicts),
    }),
  );
}

export async function deletePauseAction(pauseId: number, confirmConflicts: boolean) {
  return mutation(() =>
    service.deletePause(getDb(), id.parse(pauseId), { confirmConflicts: confirm.parse(confirmConflicts) }),
  );
}

export async function setPreLessonAction(courseId: number, input: unknown, confirmConflicts: boolean) {
  return mutation(() =>
    service.setPreLesson(getDb(), id.parse(courseId), preLessonSchema.parse(input), {
      confirmConflicts: confirm.parse(confirmConflicts),
    }),
  );
}

export async function setPreLessonStatusAction(courseId: number, status: string): Promise<SimpleActionResult> {
  return simple(() =>
    service.setPreLessonStatus(getDb(), id.parse(courseId), z.enum(LESSON_STATUSES).parse(status)),
  );
}

/** Anteprima (`apply = false`) o applicazione della sincronizzazione con Apple Calendar. */
export async function syncAppleCalendarAction(
  apply: boolean,
): Promise<{ ok: true; report: SyncReport } | ActionError> {
  try {
    return { ok: true, report: await syncAppleCalendar({ apply: z.boolean().parse(apply) }) };
  } catch (error) {
    return failure(error);
  }
}

export async function recalculateCourseAction(courseId: number, confirmConflicts: boolean) {
  return mutation(() =>
    service.recalculateFromStart(getDb(), id.parse(courseId), {
      confirmConflicts: confirm.parse(confirmConflicts),
    }),
  );
}
