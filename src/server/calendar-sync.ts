import "server-only";
import { and, eq, gte, isNotNull, lte, ne } from "drizzle-orm";
import { getDb, type Executor } from "@/db";
import { appointments, courses, lessons, preLessons } from "@/db/schema";
import { addDays, formatDateIT, formatTimeRange, todayInRome, type ISODate } from "@/lib/dates";
import {
  CalDavError,
  deleteEvent,
  findCalendarByName,
  listEvents,
  putEvent,
  putEventAt,
  type CalDavAuth,
} from "@/lib/caldav/client";
import { buildCalendarObject, eventUid, type CalendarEventData } from "@/lib/caldav/ics";
import { isEmptyPlan, planCalendarSync, type SyncPlan } from "@/lib/caldav/sync-plan";
import { LESSON_STATUS_LABEL, soloCognome } from "@/lib/format";

/** Quanto avanti nel tempo sincronizzare. */
const HORIZON_DAYS = 400;

export interface SyncConfig {
  auth: CalDavAuth;
  calendarName: string;
}

export function readSyncConfig(): SyncConfig | null {
  const appleId = process.env.ICLOUD_APPLE_ID?.trim();
  const appPassword = process.env.ICLOUD_APP_PASSWORD?.trim().replace(/\s+/g, "");
  if (!appleId || !appPassword) return null;
  return {
    auth: { appleId, appPassword, baseUrl: process.env.ICLOUD_CALDAV_URL?.trim() || undefined },
    calendarName: process.env.ICLOUD_CALENDAR_NAME?.trim() || "Casa",
  };
}

export function isSyncConfigured(): boolean {
  return readSyncConfig() !== null;
}

interface EventQuery {
  from?: ISODate;
  to?: ISODate;
  courseId?: number;
}

/**
 * Eventi del calendario: lezioni non annullate e prelezioni con data.
 * Senza filtri restituisce l'intero storico di tutti i corsi.
 */
export function buildCalendarEvents(query: EventQuery = {}, ex: Executor = getDb()): CalendarEventData[] {
  const range = [
    query.from ? gte(lessons.date, query.from) : undefined,
    query.to ? lte(lessons.date, query.to) : undefined,
    query.courseId ? eq(lessons.courseId, query.courseId) : undefined,
  ];
  const lessonRows = ex
    .select({
      id: lessons.id,
      date: lessons.date,
      startMin: lessons.startMin,
      endMin: lessons.endMin,
      status: lessons.status,
      courseName: courses.name,
      clientCompany: courses.clientCompany,
      studentReference: courses.studentReference,
      mode: courses.mode,
      meetingUrl: courses.meetingUrl,
    })
    .from(lessons)
    .innerJoin(courses, eq(courses.id, lessons.courseId))
    .where(and(ne(lessons.status, "CANCELLED"), ...range))
    .all();

  const preRows = ex
    .select({
      id: preLessons.id,
      date: preLessons.date,
      startMin: preLessons.startMin,
      endMin: preLessons.endMin,
      status: preLessons.status,
      courseName: courses.name,
      clientCompany: courses.clientCompany,
      studentReference: courses.studentReference,
      mode: courses.mode,
      meetingUrl: courses.meetingUrl,
    })
    .from(preLessons)
    .innerJoin(courses, eq(courses.id, preLessons.courseId))
    .where(
      and(
        isNotNull(preLessons.date),
        // Una prelezione annullata non deve restare nel calendario Apple.
        ne(preLessons.status, "CANCELLED"),
        query.from ? gte(preLessons.date, query.from) : undefined,
        query.to ? lte(preLessons.date, query.to) : undefined,
        query.courseId ? eq(preLessons.courseId, query.courseId) : undefined,
      ),
    )
    .all();

  /**
   * Titolo dell'evento: "Lezione <azienda>" oppure, se il corso non ha
   * un'azienda, "Lezione <cognome dell'allievo>". Sul calendario c'è sempre
   * stato il solo cognome, anche quando l'incarico riporta nome e cognome: il
   * nome per esteso resta sulla scheda del corso.
   */
  const riferimento = (r: { clientCompany: string; studentReference: string; courseName: string }) =>
    r.clientCompany.trim() || soloCognome(r.studentReference) || r.courseName.trim();

  /**
   * Luogo dell'evento: il link della riunione quando c'è, altrimenti la modalità.
   * Nel campo "luogo" iPhone e Mac riconoscono il link di Teams e mettono il
   * pulsante per entrare dentro l'evento stesso; va nella forma https, l'unica
   * che riconoscono (sul telefono apre comunque l'applicazione). La forma
   * `msteams://`, che sul Mac evita il browser, la usa la scheda del corso.
   */
  const luogo = (r: { mode: string; meetingUrl: string }) => r.meetingUrl.trim() || r.mode;

  // Gli impegni senza corso (l'incontro preliminare) vanno sul calendario come
  // tutto il resto: è lì che si guarda la mattina.
  const impegni = ex
    .select()
    .from(appointments)
    .where(
      and(
        query.from ? gte(appointments.date, query.from) : undefined,
        query.to ? lte(appointments.date, query.to) : undefined,
      ),
    )
    .all()
    // Gli impegni non appartengono a un corso: quando si sincronizza un corso
    // solo, restano fuori.
    .filter(() => !query.courseId);

  const events: CalendarEventData[] = [
    ...lessonRows.map((r) => ({
      kind: "LESSON" as const,
      id: r.id,
      date: r.date,
      startMin: r.startMin,
      endMin: r.endMin,
      summary: `Lezione ${riferimento(r)}`,
      location: luogo(r),
      description: [r.courseName, `Stato: ${LESSON_STATUS_LABEL[r.status]}`, "Gestione Corsi"].join("\n"),
    })),
    ...preRows.map((r) => ({
      kind: "PRE_LESSON" as const,
      id: r.id,
      date: r.date as ISODate,
      startMin: r.startMin as number,
      endMin: r.endMin as number,
      summary: `Prelezione ${riferimento(r)}`,
      location: luogo(r),
      description: [
        r.courseName,
        "Prelezione (fuori dal monte ore)",
        `Stato: ${LESSON_STATUS_LABEL[r.status]}`,
        "Gestione Corsi",
      ].join("\n"),
    })),
    ...impegni.map((a) => ({
      kind: "APPOINTMENT" as const,
      id: a.id,
      date: a.date as ISODate,
      startMin: a.startMin,
      endMin: a.endMin,
      summary: a.title,
      location: "",
      description: [a.notes, "Gestione Corsi"].filter(Boolean).join("\n"),
    })),
  ];

  return events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMin - b.startMin));
}

/**
 * Eventi che devono esistere sul calendario Apple: dalla data indicata in poi.
 * Lo storico non viene sincronizzato.
 */
export function buildDesiredEvents(from: ISODate, to: ISODate, ex: Executor = getDb()): CalendarEventData[] {
  return buildCalendarEvents({ from, to }, ex);
}

export interface SyncReport {
  configured: boolean;
  calendarName: string;
  applied: boolean;
  from: ISODate;
  to: ISODate;
  created: number;
  updated: number;
  removed: number;
  unchanged: number;
  ignored: number;
  /** Prime righe leggibili di ciò che verrebbe creato o rimosso. */
  samples: string[];
  error?: string;
}

function describe(plan: SyncPlan): string[] {
  const lines = [
    ...plan.create.slice(0, 5).map((e) => `+ ${formatDateIT(e.date)} ${formatTimeRange(e.startMin, e.endMin)} ${e.summary}`),
    ...plan.update.slice(0, 3).map(({ event: e }) => `~ ${formatDateIT(e.date)} ${formatTimeRange(e.startMin, e.endMin)} ${e.summary}`),
    ...plan.remove.slice(0, 3).map((r) => `− evento rimosso (${r.uid.split("@")[0]})`),
  ];
  return lines;
}

/**
 * Sincronizza il calendario Apple. Con `apply = false` calcola soltanto il piano
 * (nessuna scrittura su iCloud).
 */
/** Quando è andata a buon fine l'ultima sincronizzazione, e con che esito. */
export const ULTIMA_SYNC = "apple.lastSyncAt";
export const ULTIMO_ERRORE_SYNC = "apple.lastSyncError";

export async function syncAppleCalendar(options: { apply: boolean; today?: ISODate }): Promise<SyncReport> {
  const report = await eseguiSync(options);
  // Traccia per il pannello di stato: conta l'ultimo contatto riuscito con
  // iCloud, anche in sola anteprima. Un calendario già allineato non produce
  // scritture, ma vuol dire che il collegamento funziona.
  if (report.configured) {
    const { writeSetting } = await import("./mail-service");
    const db = getDb();
    if (!report.error) writeSetting(db, ULTIMA_SYNC, new Date().toISOString());
    writeSetting(db, ULTIMO_ERRORE_SYNC, report.error ?? "");
  }
  return report;
}

async function eseguiSync(options: { apply: boolean; today?: ISODate }): Promise<SyncReport> {
  const config = readSyncConfig();
  const from = options.today ?? todayInRome();
  const to = addDays(from, HORIZON_DAYS);
  const empty: SyncReport = {
    configured: config !== null,
    calendarName: config?.calendarName ?? "",
    applied: false,
    from,
    to,
    created: 0,
    updated: 0,
    removed: 0,
    unchanged: 0,
    ignored: 0,
    samples: [],
  };
  if (!config) {
    return { ...empty, error: "Sincronizzazione non configurata: imposta ICLOUD_APPLE_ID e ICLOUD_APP_PASSWORD." };
  }

  try {
    const calendar = await findCalendarByName(config.auth, config.calendarName);
    const remote = await listEvents(config.auth, calendar.url, { from, to });
    const desired = buildDesiredEvents(from, to);
    const plan = planCalendarSync(desired, remote);

    const report: SyncReport = {
      ...empty,
      created: plan.create.length,
      updated: plan.update.length,
      removed: plan.remove.length,
      unchanged: plan.unchanged,
      ignored: plan.ignored,
      samples: describe(plan),
    };
    if (!options.apply || isEmptyPlan(plan)) return report;

    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    for (const event of plan.create) {
      await putEvent(config.auth, calendar.url, eventUid(event.kind, event.id), buildCalendarObject(event, stamp));
    }
    for (const { event, href } of plan.update) {
      await putEventAt(config.auth, href, buildCalendarObject(event, stamp));
    }
    for (const { href } of plan.remove) {
      await deleteEvent(config.auth, href);
    }
    return { ...report, applied: true };
  } catch (error) {
    if (error instanceof CalDavError) return { ...empty, error: error.message };
    console.error(error);
    return { ...empty, error: "Errore imprevisto durante la sincronizzazione con iCloud." };
  }
}

// ---------------------------------------------------------------------------
// Sincronizzazione automatica dopo le modifiche
// ---------------------------------------------------------------------------

let pending: Promise<unknown> = Promise.resolve();

/**
 * Allinea il calendario Apple dopo una modifica, una sincronizzazione alla volta.
 * Un errore di rete non deve mai far fallire l'operazione sul gestionale.
 */
export function scheduleBackgroundSync(): Promise<void> {
  if (!isSyncConfigured()) return Promise.resolve();
  pending = pending
    .catch(() => {})
    .then(async () => {
      const report = await syncAppleCalendar({ apply: true });
      if (report.error) console.error(`Sincronizzazione Apple Calendar: ${report.error}`);
    });
  return pending as Promise<void>;
}
