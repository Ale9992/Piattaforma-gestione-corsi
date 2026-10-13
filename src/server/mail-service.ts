import "server-only";
import { and, asc, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { getDb, type DB, type Executor } from "@/db";
import { appSettings, courses, lessons, mailMessages, scheduleRules } from "@/db/schema";
import { formatTime, maxDate, parseTime, todayInRome, type ISODate } from "@/lib/dates";
import { classifyMail, type MailKind, type ParsedMail } from "@/lib/deepseek/classify";
import type { ParsedCourseDraft } from "@/lib/deepseek/parser";
import { readMailConfig } from "@/lib/mail/config";
import { fetchMessage, fetchMessages, mailboxState } from "@/lib/mail/imap";
import { isFromWatched, type MailMessage } from "@/lib/mail/message";
import { leggiContratto, numeroDaNomeFile } from "@/lib/mail/contract";
import { eUnCalendario, leggiCalendarioCorso, type LezioneDatata } from "@/lib/mail/calendar-pdf";
import { matchCourse, type CourseRef } from "@/lib/mail/match";
import { haAccesso, leggiAccessoTeams, type TeamsAccess } from "@/lib/mail/meeting";
import { estraiTestoPdf } from "@/lib/mail/pdf";
import { leggiAllegato, salvaAllegato } from "@/lib/mail/storage";
import { fasiDelCalendario, type Fase } from "@/lib/scheduling/phases";
import { findConflicts } from "@/lib/scheduling/conflicts";
import { planAddDays, type ScheduleBlock } from "@/lib/scheduling/rules";
import { weekdaysToMask } from "@/lib/scheduling/types";
import { createAppointment } from "./appointment-service";
import * as service from "./course-service";

/**
 * Posta in arrivo: legge le mail dei mittenti seguiti, ne ricava una PROPOSTA e
 * la mette in attesa. Nessuna modifica al calendario avviene senza conferma.
 */

/** Il segnalibro vale per cartella: gli UID ripartono da 1 in ognuna. */
const ultimoUidKey = (folder: string) => `mail.lastUid:${folder}`;
const validitaKey = (folder: string) => `mail.uidValidity:${folder}`;
/** Quando è andato a buon fine l'ultimo controllo, e con che esito. */
export const ULTIMO_CONTROLLO = "mail.lastCheckAt";
export const ULTIMO_ERRORE = "mail.lastCheckError";

export interface CancelProposal {
  kind: "ANNULLAMENTO";
  courseId: number;
  lessonIds: number[];
  dates: ISODate[];
  /** Date indicate nella mail che non corrispondono a nessuna lezione. */
  unknownDates: ISODate[];
  /** Lezioni già annullate in precedenza: non c'è più niente da fare. */
  alreadyCancelled: ISODate[];
}

export interface ScheduleProposal {
  kind: "CAMBIO_CALENDARIO";
  courseId: number;
  validFrom: ISODate;
  blocks: ScheduleBlock[];
  /** "add" aggiunge giorni lasciando gli altri, "change" sostituisce la fase. */
  mode: "add" | "change";
}

export interface NewCourseProposal {
  kind: "NUOVO_CORSO";
  draft: ParsedCourseDraft;
  /** Corso già presente con gli stessi riferimenti: probabile doppione. */
  duplicateOf?: { id: number; name: string } | null;
  /** Dati letti dalla lettera d'incarico allegata (compenso compreso). */
  contract?: {
    feeCents: number | null;
    assignmentNumber: string;
    hours: number | null;
    file: string;
    filename: string;
  } | null;
  /**
   * Calendario allegato. Le mail di MAC non scrivono i giorni nel testo
   * ("Frequenza: come da calendario allegato"): stanno in un secondo PDF.
   */
  calendar?: CalendarioAllegato | null;
}

export interface CalendarioAllegato {
  file: string;
  filename: string;
  lessons: LezioneDatata[];
  preLesson: LezioneDatata | null;
  /** Periodi ricavati dalle date: è così che il gestionale tiene un calendario. */
  phases: Fase[];
  /** Le regole rigenerano esattamente le date allegate? Se no, non si crea niente. */
  matches: boolean;
  /** Il calendario ha un ritmo settimanale, oppure sono date fisse una per una. */
  aRitmo: boolean;
  /** Chiusure lette dai buchi del calendario (le feste nazionali il motore le sa già). */
  pauses: { startDate: ISODate; endDate: ISODate }[];
  totalMinutes: number;
}

/**
 * Gli avvisi del parser che il calendario allegato ha già risolto: dire
 * "giorni non trovati" quando i giorni sono lì sotto, elencati, è solo rumore.
 */
const RISOLTI_DAL_CALENDARIO = /giorni della settimana non trovati|orario delle lezioni non trovato/i;

export function noteDellaMail(
  summary: string,
  warnings: readonly string[],
  proposal: MailProposal,
  extra = "",
): string {
  const conCalendario = proposal.kind === "NUOVO_CORSO" && Boolean(proposal.calendar);
  const utili = conCalendario ? warnings.filter((a) => !RISOLTI_DAL_CALENDARIO.test(a)) : warnings;
  return [summary, ...utili, extra].filter(Boolean).join(" · ");
}

/** Dal testo del PDF del calendario alla proposta, verifica compresa. */
export function calendarioDaTesto(testo: string, file: string, filename: string): CalendarioAllegato | null {
  const letto = leggiCalendarioCorso(testo);
  if (letto.lessons.length === 0) return null;
  const totalMinutes = letto.lessons.reduce((somma, l) => somma + (l.endMin - l.startMin), 0);
  const { fasi, pauses, ok, aRitmo } = fasiDelCalendario(letto.lessons, totalMinutes);
  return {
    file,
    filename,
    lessons: letto.lessons,
    preLesson: letto.preLesson,
    phases: fasi,
    matches: ok,
    aRitmo,
    pauses,
    totalMinutes,
  };
}

/** Conferma corso: si confronta l'elenco ricevuto con il calendario generato. */
export interface CheckProposal {
  kind: "CONFERMA_CALENDARIO";
  courseId: number;
  confirmed: number;
  /** Date confermate dalla mail che il gestionale non ha. */
  missing: ISODate[];
  /** Lezioni del gestionale che la mail non elenca. */
  extra: ISODate[];
  /** Stesse date ma orario diverso. */
  differentTimes: { date: ISODate; mail: string; app: string }[];
}

/** Chiusura corso: il corso risulta finito e si può archiviare. */
export interface CloseProposal {
  kind: "CHIUSURA_CORSO";
  courseId: number;
  alreadyArchived: boolean;
  /** Lezioni passate ancora da segnare: meglio sistemarle prima di archiviare. */
  unmarkedPast: ISODate[];
  /** Ore del monte ore non ancora svolte. */
  remainingMinutes: number;
}

/**
 * Incontro preliminare: l'agenzia lo fissa prima che il corso esista, quindi
 * non c'è niente a cui agganciarlo. Diventa un impegno a calendario e basta.
 */
export interface MeetingProposal {
  kind: "INCONTRO_PRELIMINARE";
  title: string;
  date: ISODate;
  startMin: number;
  endMin: number;
  /** Corso già in gestionale con quel nome, se c'è: solo per dirlo. */
  courseId?: number;
}

export interface NoProposal {
  kind: "ALTRO";
  /** Perché non c'è una proposta, quando si può dire. */
  reason?: "corso-non-trovato";
}

export type MailProposal =
  | MeetingProposal
  | CancelProposal
  | ScheduleProposal
  | NewCourseProposal
  | CheckProposal
  | CloseProposal
  | NoProposal;

export function readSetting(ex: Executor, key: string): string | null {
  return ex.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value ?? null;
}

export function writeSetting(ex: Executor, key: string, value: string): void {
  ex.insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } })
    .run();
}

export function loadCourseRefs(ex: Executor): CourseRef[] {
  return ex
    .select({
      id: courses.id,
      name: courses.name,
      clientCompany: courses.clientCompany,
      studentReference: courses.studentReference,
      assignmentNumber: courses.assignmentNumber,
      status: courses.status,
    })
    .from(courses)
    .all();
}

/** Righe orario ricavate da ciò che la mail dichiara. */
export function blocksFromDraft(draft: ParsedCourseDraft): ScheduleBlock[] {
  const out: ScheduleBlock[] = [];
  for (const riga of draft.schedule) {
    if (riga.days.length === 0 || !riga.startTime || !riga.endTime) continue;
    out.push({
      weekdaysMask: weekdaysToMask(riga.days),
      startMin: parseTime(riga.startTime),
      endMin: parseTime(riga.endTime),
      from: riga.startDate ?? null,
    });
  }
  return out;
}

/**
 * Trasforma ciò che la mail dice in una proposta concreta sul corso abbinato.
 * Tutte le scelte qui sono deterministiche e verificabili.
 */
/**
 * "Incontro preliminare AI GENERATIVA PER IL BUSINESS": la dicitura che va sul
 * calendario. Il nome è quello scritto nella mail, senza il "Corso" davanti —
 * che nella riga dell'agenda sarebbe solo una parola in più.
 */
/** Il corso a cui la proposta si riferisce, se ne ha uno. */
export function corsoDellaProposta(proposta: MailProposal): number | null {
  return "courseId" in proposta && typeof proposta.courseId === "number" ? proposta.courseId : null;
}

export function titoloIncontro(nomeCorso: string): string {
  const nome = nomeCorso.trim().replace(/^corso\s+(di\s+)?/i, "").trim();
  return nome ? `Incontro preliminare ${nome}` : "Incontro preliminare";
}

export function buildProposal(ex: Executor, parsed: ParsedMail, today: ISODate): MailProposal {
  if (parsed.kind === "NUOVO_CORSO" && parsed.course) {
    // Gli incarichi arrivano anche per corsi già inseriti a mano: meglio dirlo
    // prima di creare un doppione.
    const gia = matchCourse(loadCourseRefs(ex), parsed.hint).course;
    return {
      kind: "NUOVO_CORSO",
      draft: parsed.course,
      duplicateOf: gia ? { id: gia.id, name: gia.name } : null,
    };
  }

  // L'incontro preliminare può arrivare prima che il corso esista: non si cerca
  // il corso, si guarda solo quando è fissato.
  if (parsed.kind === "INCONTRO_PRELIMINARE" && parsed.meeting) {
    const startMin = parseTime(parsed.meeting.startTime ?? "09:00");
    const endMin = parsed.meeting.endTime ? parseTime(parsed.meeting.endTime) : startMin + 60;
    const corso = matchCourse(loadCourseRefs(ex), parsed.hint).course;
    return {
      kind: "INCONTRO_PRELIMINARE",
      title: titoloIncontro(parsed.hint.courseName),
      date: parsed.meeting.date,
      startMin,
      endMin: endMin > startMin ? endMin : startMin + 60,
      ...(corso ? { courseId: corso.id } : {}),
    };
  }

  const esito = matchCourse(loadCourseRefs(ex), parsed.hint);
  if (!esito.course) return { kind: "ALTRO", reason: "corso-non-trovato" };
  const courseId = esito.course.id;

  if (parsed.kind === "CHIUSURA_CORSO") {
    const corso = ex.select().from(courses).where(eq(courses.id, courseId)).get();
    if (!corso) return { kind: "ALTRO", reason: "corso-non-trovato" };
    const righe = ex.select().from(lessons).where(eq(lessons.courseId, courseId)).all();
    const svolte = righe
      .filter((l) => l.status === "COMPLETED")
      .reduce((somma, l) => somma + l.endMin - l.startMin, 0);
    return {
      kind: "CHIUSURA_CORSO",
      courseId,
      alreadyArchived: corso.status === "COMPLETED",
      unmarkedPast: righe.filter((l) => l.status === "PLANNED" && l.date <= today).map((l) => l.date),
      remainingMinutes: Math.max(0, corso.totalMinutes - svolte),
    };
  }

  if (parsed.kind === "ANNULLAMENTO") {
    const date = parsed.cancelled.map((c) => c.date);
    const righe =
      date.length === 0
        ? []
        : ex
            .select()
            .from(lessons)
            .where(and(eq(lessons.courseId, courseId), inArray(lessons.date, date)))
            .all();
    const annullabili = righe.filter((l) => l.status === "PLANNED");
    return {
      kind: "ANNULLAMENTO",
      courseId,
      lessonIds: annullabili.map((l) => l.id),
      dates: annullabili.map((l) => l.date),
      unknownDates: date.filter((d) => !righe.some((l) => l.date === d)),
      alreadyCancelled: righe.filter((l) => l.status === "CANCELLED").map((l) => l.date),
    };
  }

  if (parsed.kind === "CONFERMA_CALENDARIO") {
    const righe = ex
      .select()
      .from(lessons)
      .where(and(eq(lessons.courseId, courseId), ne(lessons.status, "CANCELLED")))
      .orderBy(asc(lessons.date))
      .all();
    const perData = new Map(righe.map((l) => [l.date, l]));
    const confermate = new Set(parsed.sessions.map((s) => s.date));
    const differentTimes: { date: ISODate; mail: string; app: string }[] = [];
    for (const sessione of parsed.sessions) {
      const lezione = perData.get(sessione.date);
      if (!lezione || !sessione.startTime) continue;
      const suo = formatTime(lezione.startMin);
      if (suo !== sessione.startTime) {
        differentTimes.push({ date: sessione.date, mail: sessione.startTime, app: suo });
      }
    }
    return {
      kind: "CONFERMA_CALENDARIO",
      courseId,
      confirmed: parsed.sessions.length,
      missing: parsed.sessions.map((s) => s.date).filter((d) => !perData.has(d)),
      extra: righe.map((l) => l.date).filter((d) => !confermate.has(d)),
      differentTimes,
    };
  }

  if (parsed.kind === "CAMBIO_CALENDARIO" && parsed.course) {
    const blocks = blocksFromDraft(parsed.course);
    if (blocks.length === 0) return { kind: "ALTRO" };
    const corso = ex.select().from(courses).where(eq(courses.id, courseId)).get();
    if (!corso) return { kind: "ALTRO" };
    const validFrom = maxDate(parsed.changeFrom ?? today, corso.startDate);
    const regole = ex.select().from(scheduleRules).where(eq(scheduleRules.courseId, courseId)).all();
    // Se i giorni indicati non toccano quelli già attivi, la mail sta AGGIUNGENDO
    // un giorno; altrimenti sta cambiando la calendarizzazione in vigore.
    const { clash } = planAddDays(regole, { validFrom, blocks }, []);
    return { kind: "CAMBIO_CALENDARIO", courseId, validFrom, blocks, mode: clash === null ? "add" : "change" };
  }

  return { kind: "ALTRO" };
}

export interface IngestReport {
  read: number;
  stored: number;
  skipped: number;
  errors: string[];
  /** Primo avvio: il punto di partenza è stato fissato, senza leggere l'arretrato. */
  initialized?: boolean;
}

/** Legge la posta nuova e archivia le proposte. Non tocca il calendario. */
export async function ingestMail(db: DB = getDb(), options: { today?: ISODate } = {}): Promise<IngestReport> {
  const esito = await leggiLaPosta(db, options);
  // Traccia per il pannello di stato: se il controllo si ferma, deve vedersi.
  writeSetting(db, ULTIMO_CONTROLLO, new Date().toISOString());
  writeSetting(db, ULTIMO_ERRORE, esito.errors[0] ?? "");
  return esito;
}

async function leggiLaPosta(db: DB, options: { today?: ISODate }): Promise<IngestReport> {
  const config = readMailConfig();
  const report: IngestReport = { read: 0, stored: 0, skipped: 0, errors: [] };
  if (!config) {
    report.errors.push("Lettura della posta non configurata: mancano MAIL_USER e MAIL_APP_PASSWORD.");
    return report;
  }
  const today = options.today ?? todayInRome();
  const chiaveUid = ultimoUidKey(config.folder);
  const salvato = readSetting(db, chiaveUid);

  let stato;
  try {
    stato = await mailboxState(config);
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
    return report;
  }

  // Primo avvio, cartella cambiata o rinumerata: si parte dalle mail future,
  // non dall'arretrato della casella.
  const validitaSalvata = readSetting(db, validitaKey(config.folder));
  if (salvato === null || validitaSalvata !== stato.uidValidity) {
    writeSetting(db, chiaveUid, String(stato.lastUid));
    writeSetting(db, validitaKey(config.folder), stato.uidValidity);
    return { ...report, initialized: true };
  }

  const sinceUid = Number(salvato) || 0;
  if (stato.lastUid <= sinceUid) return report; // niente di nuovo: nessuno scaricamento

  let messaggi: MailMessage[] = [];
  try {
    messaggi = await fetchMessages(config, { sinceUid });
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
    return report;
  }
  report.read = messaggi.length;

  for (const messaggio of messaggi) {
    writeSetting(db, chiaveUid, String(messaggio.uid));
    if (!isFromWatched(messaggio, config.senders)) {
      report.skipped++;
      continue;
    }
    const esistente = db
      .select({ id: mailMessages.id })
      .from(mailMessages)
      .where(eq(mailMessages.messageId, messaggio.messageId))
      .get();
    if (esistente) {
      report.skipped++;
      continue;
    }

    let kind: MailKind | null = null;
    let proposal: MailProposal = { kind: "ALTRO" };
    let note = "";
    let avvisi: readonly string[] = [];
    let riassunto = "";
    let status: "NUOVA" | "ERRORE" = "NUOVA";
    try {
      const parsed = await classifyMail({ subject: messaggio.subject, body: messaggio.body });
      kind = parsed.kind;
      proposal = buildProposal(db, parsed, today);
      note = [parsed.summary, ...parsed.warnings].filter(Boolean).join(" · ");
      avvisi = parsed.warnings;
      riassunto = parsed.summary;
    } catch (error) {
      status = "ERRORE";
      note = error instanceof Error ? error.message : String(error);
      report.errors.push(`${messaggio.subject}: ${note}`);
    }

    // Link e credenziali della riunione: stanno nel corpo della mail di conferma
    // e valgono per tutte le lezioni di quel corso.
    const corsoAbbinato = corsoDellaProposta(proposal);
    if (corsoAbbinato !== null) {
      const esito = salvaAccessoTeams(db, corsoAbbinato, leggiAccessoTeams(messaggio.body));
      if (esito) note = [note, esito].filter(Boolean).join(" · ");
    }

    const inserita = db.insert(mailMessages)
      .values({
        uid: messaggio.uid,
        messageId: messaggio.messageId,
        sender: messaggio.sender,
        envelopeSender: messaggio.envelopeSender,
        subject: messaggio.subject,
        receivedAt: messaggio.receivedAt,
        body: messaggio.body.slice(0, 20_000),
        kind,
        status,
        proposal: JSON.stringify(proposal),
        courseId: corsoDellaProposta(proposal),
        note,
      })
      .returning({ id: mailMessages.id })
      .get();

    // Allegati: si salvano nel volume dei dati e, se è la lettera d'incarico,
    // se ne legge il compenso — nella mail non c'è.
    const salvati: { nome: string; file: string }[] = [];
    let contratto: NewCourseProposal["contract"] = null;
    let calendario: CalendarioAllegato | null = null;
    for (const allegato of messaggio.attachments) {
      try {
        const file = salvaAllegato(inserita.id, allegato.filename, allegato.content);
        salvati.push({ nome: allegato.filename, file });
        if (!/pdf/i.test(allegato.contentType) && !/\.pdf$/i.test(allegato.filename)) continue;
        const testo = await estraiTestoPdf(allegato.content);
        // Gli incarichi arrivano con due PDF: la lettera e il calendario.
        if (!calendario && eUnCalendario(allegato.filename, testo)) {
          calendario = calendarioDaTesto(testo, file, allegato.filename);
          if (calendario) continue;
        }
        if (!contratto) {
          const letto = leggiContratto(testo);
          if (letto.feeCents !== null || letto.assignmentNumber) {
            contratto = {
              feeCents: letto.feeCents,
              assignmentNumber: letto.assignmentNumber || numeroDaNomeFile(allegato.filename),
              hours: letto.hours,
              file,
              filename: allegato.filename,
            };
          }
        }
      } catch (error) {
        report.errors.push(`Allegato «${allegato.filename}»: ${error instanceof Error ? error.message : error}`);
      }
    }

    if (salvati.length > 0 || contratto || calendario) {
      if (proposal.kind === "NUOVO_CORSO") {
        if (contratto) proposal = { ...proposal, contract: contratto };
        if (calendario) proposal = { ...proposal, calendar: calendario };
      }
      db.update(mailMessages)
        .set({
          attachments: JSON.stringify(salvati),
          proposal: JSON.stringify(proposal),
          note: status === "ERRORE" ? note : noteDellaMail(riassunto, avvisi, proposal),
        })
        .where(eq(mailMessages.id, inserita.id))
        .run();
    }
    report.stored++;
  }
  return report;
}

// ---------------------------------------------------------------------------
// Lettura e conferma
// ---------------------------------------------------------------------------

export interface MailRow {
  id: number;
  sender: string;
  subject: string;
  receivedAt: string;
  body: string;
  kind: MailKind | null;
  status: "NUOVA" | "CONFERMATA" | "IGNORATA" | "ERRORE";
  note: string;
  courseId: number | null;
  courseName: string | null;
  proposal: MailProposal;
}

function toRow(row: typeof mailMessages.$inferSelect, courseName: string | null): MailRow {
  let proposal: MailProposal = { kind: "ALTRO" };
  try {
    if (row.proposal) proposal = JSON.parse(row.proposal) as MailProposal;
  } catch {
    proposal = { kind: "ALTRO" };
  }
  return {
    id: row.id,
    sender: row.sender,
    subject: row.subject,
    receivedAt: row.receivedAt,
    body: row.body,
    kind: row.kind,
    status: row.status,
    note: row.note,
    courseId: row.courseId,
    courseName,
    proposal,
  };
}

export function listMail(ex: Executor = getDb(), options: { includeHandled?: boolean } = {}): MailRow[] {
  const righe = ex
    .select()
    .from(mailMessages)
    .orderBy(desc(mailMessages.receivedAt))
    .limit(options.includeHandled ? 200 : 100)
    .all();
  const nomi = new Map(loadCourseRefs(ex).map((c) => [c.id, c.name]));
  return righe
    .filter((r) => options.includeHandled || r.status === "NUOVA" || r.status === "ERRORE")
    .map((r) => toRow(r, r.courseId !== null ? (nomi.get(r.courseId) ?? null) : null));
}

export function getMail(ex: Executor, id: number): MailRow {
  const row = ex.select().from(mailMessages).where(eq(mailMessages.id, id)).get();
  if (!row) throw new service.DomainError("Mail non trovata.");
  const nome = row.courseId !== null
    ? (ex.select({ name: courses.name }).from(courses).where(eq(courses.id, row.courseId)).get()?.name ?? null)
    : null;
  return toRow(row, nome);
}

export function countPendingMail(ex: Executor = getDb()): number {
  return ex
    .select({ id: mailMessages.id })
    .from(mailMessages)
    .where(inArray(mailMessages.status, ["NUOVA", "ERRORE"]))
    .all().length;
}

export function setMailStatus(
  db: DB,
  id: number,
  status: "NUOVA" | "CONFERMATA" | "IGNORATA",
  courseId?: number,
): void {
  const result = db
    .update(mailMessages)
    .set({ status, ...(courseId !== undefined ? { courseId } : {}) })
    .where(eq(mailMessages.id, id))
    .run();
  if (result.changes === 0) throw new service.DomainError("Mail non trovata.");
}

/**
 * Applica la proposta di una mail. Usa le stesse operazioni dell'interfaccia,
 * quindi valgono gli stessi controlli: storico intatto, conflitti segnalati.
 */
export function confirmMail(db: DB, id: number, options: service.MutationOptions = {}) {
  const mail = getMail(db, id);
  const proposal = mail.proposal;

  if (proposal.kind === "ANNULLAMENTO") {
    if (proposal.lessonIds.length === 0) {
      throw new service.DomainError("Nessuna lezione da annullare: la data non esiste più.");
    }
    let outcome: service.MutationOutcome | null = null;
    for (const lessonId of proposal.lessonIds) {
      outcome = service.setLessonStatus(db, lessonId, "CANCELLED", options);
      if (outcome.status !== "applied") return outcome;
    }
    setMailStatus(db, id, "CONFERMATA", proposal.courseId);
    return outcome!;
  }

  if (proposal.kind === "INCONTRO_PRELIMINARE") {
    const id = createAppointment(db, {
      title: proposal.title,
      date: proposal.date,
      startMin: proposal.startMin,
      endMin: proposal.endMin,
    });
    setMailStatus(db, id, "CONFERMATA", proposal.courseId);
    // Un incontro sopra una lezione è un doppio impegno: va detto subito.
    const sovrapposti = service.toConflictViews(
      db,
      findConflicts(service.loadBusyEvents(db)).filter(
        (c) => (c.a.kind === "APPOINTMENT" && c.a.id === id) || (c.b.kind === "APPOINTMENT" && c.b.id === id),
      ),
    );
    return { status: "applied", summary: null, newConflicts: sovrapposti } satisfies service.MutationOutcome;
  }

  if (proposal.kind === "CHIUSURA_CORSO") {
    if (proposal.alreadyArchived) throw new service.DomainError("Il corso è già archiviato.");
    service.setCourseStatus(db, proposal.courseId, "COMPLETED");
    setMailStatus(db, id, "CONFERMATA", proposal.courseId);
    return { status: "applied", summary: null, newConflicts: [] } satisfies service.MutationOutcome;
  }

  if (proposal.kind === "CAMBIO_CALENDARIO") {
    const input = { validFrom: proposal.validFrom, blocks: proposal.blocks };
    const outcome =
      proposal.mode === "add"
        ? service.addScheduleDays(db, proposal.courseId, input, options)
        : service.changeSchedule(db, proposal.courseId, input, options);
    if (outcome.status === "applied") setMailStatus(db, id, "CONFERMATA", proposal.courseId);
    return outcome;
  }

  throw new service.DomainError(
    proposal.kind === "NUOVO_CORSO"
      ? "Per un corso nuovo apri il modulo di creazione: i dati sono già compilati."
      : "Questa mail non contiene una proposta da applicare.",
  );
}

/**
 * Crea il corso usando il calendario allegato all'incarico.
 *
 * Le date le detta il PDF, non un'ipotesi: si procede solo se le regole
 * ricavate rigenerano esattamente quelle date. Se il calendario non ha un
 * ritmo esprimibile con delle regole resta il modulo, da compilare a mano.
 */
export function createCourseFromMail(db: DB, mailId: number, options: service.MutationOptions = {}) {
  const mail = getMail(db, mailId);
  const proposal = mail.proposal;
  if (proposal.kind !== "NUOVO_CORSO") throw new service.DomainError("Questa mail non propone un corso nuovo.");

  const calendario = proposal.calendar;
  if (!calendario) throw new service.DomainError("A questa mail non è allegato nessun calendario.");
  if (!calendario.matches) {
    throw new service.DomainError(
      "Le date del calendario allegato non seguono un ritmo regolare: crea il corso dal modulo e sistema le lezioni a mano.",
    );
  }

  const draft = proposal.draft;
  const fasi = calendario.phases.map((fase) => ({
    from: fase.from,
    to: fase.to,
    blocks: fase.blocks.map((b) => ({
      weekdaysMask: weekdaysToMask(b.weekdays),
      startMin: b.startMin,
      endMin: b.endMin,
      from: b.from,
    })),
  }));

  const esito = service.createCourse(
    db,
    {
      name: draft.name.trim() || mail.subject,
      clientCompany: draft.clientCompany,
      mode: draft.mode,
      studentsCount: draft.studentsCount,
      studentReference: draft.studentReference,
      assignmentNumber: proposal.contract?.assignmentNumber || draft.assignmentNumber,
      clientContact: "",
      feeCents: proposal.contract?.feeCents ?? null,
      // Il monte ore è quello che le lezioni del calendario sommano davvero.
      totalMinutes: calendario.totalMinutes,
      startDate: fasi[0].from,
      notes: "",
      status: "NOT_STARTED",
      schedule: fasi[0].blocks,
      phases: fasi,
      pauses: calendario.pauses,
      firstLesson: null,
      preLesson: calendario.preLesson
        ? { date: calendario.preLesson.date, startMin: calendario.preLesson.startMin }
        : null,
    },
    options,
  );

  if (esito.outcome.status === "applied" && esito.courseId) {
    setMailStatus(db, mailId, "CONFERMATA", esito.courseId);
    attachContract(db, mailId, esito.courseId);
  }
  return esito;
}

/**
 * Rilegge una mail già archiviata e ricostruisce la proposta: serve quando il
 * riconoscimento migliora, o quando i dati del corso nel frattempo sono cambiati.
 */
export async function reparseMail(db: DB, id: number, options: { today?: ISODate } = {}): Promise<MailRow> {
  const mail = getMail(db, id);
  const today = options.today ?? todayInRome();
  // Il testo salvato è quello che l'applicazione sapeva ricavare il giorno in
  // cui la mail è arrivata. Si torna al messaggio nella casella, così una
  // lettura migliorata vale anche sull'arretrato; se la casella non risponde si
  // continua con quello che c'è.
  const body = (await rileggiDallaCasella(db, id)) ?? mail.body;
  if (body !== mail.body) {
    db.update(mailMessages).set({ body }).where(eq(mailMessages.id, id)).run();
  }
  const parsed = await classifyMail({ subject: mail.subject, body });
  let proposal = buildProposal(db, parsed, today);

  // Gli allegati restano su disco: si rileggono da lì, senza farsi rimandare la mail.
  const { contratto, calendario } = await leggiAllegatiSalvati(db, id);
  if (proposal.kind === "NUOVO_CORSO") {
    if (contratto) proposal = { ...proposal, contract: contratto };
    if (calendario) proposal = { ...proposal, calendar: calendario };
  }
  // Corso già creato da questa mail: gli si completa ciò che mancava.
  if (contratto && mail.courseId) {
    const corso = db.select().from(courses).where(eq(courses.id, mail.courseId)).get();
    const patch: { feeCents?: number; contractFile?: string; updatedAt: string } = {
      updatedAt: new Date().toISOString(),
    };
    if (corso && corso.feeCents == null && contratto.feeCents !== null) patch.feeCents = contratto.feeCents;
    if (corso && !corso.contractFile) patch.contractFile = contratto.file;
    if (patch.feeCents !== undefined || patch.contractFile !== undefined) {
      db.update(courses).set(patch).where(eq(courses.id, mail.courseId)).run();
    }
  }
  const corsoAbbinato = corsoDellaProposta(proposal);
  const accesso = corsoAbbinato !== null ? salvaAccessoTeams(db, corsoAbbinato, leggiAccessoTeams(body)) : "";

  db.update(mailMessages)
    .set({
      kind: parsed.kind,
      proposal: JSON.stringify(proposal),
      courseId: corsoDellaProposta(proposal),
      note: noteDellaMail(parsed.summary, parsed.warnings, proposal, accesso),
      status: mail.status === "ERRORE" ? "NUOVA" : mail.status,
    })
    .where(eq(mailMessages.id, id))
    .run();
  return getMail(db, id);
}

/** Testo aggiornato del messaggio, ripreso dalla casella. `null` se non si può. */
async function rileggiDallaCasella(ex: Executor, id: number): Promise<string | null> {
  const config = readMailConfig();
  if (!config) return null;
  const riga = ex.select().from(mailMessages).where(eq(mailMessages.id, id)).get();
  if (!riga) return null;
  const messaggio = await fetchMessage(config, { uid: riga.uid, messageId: riga.messageId });
  return messaggio ? messaggio.body.slice(0, 20_000) : null;
}

/** Rilegge i PDF già salvati su disco per questa mail: lettera d'incarico e calendario. */
async function leggiAllegatiSalvati(
  ex: Executor,
  mailId: number,
): Promise<{ contratto: NewCourseProposal["contract"] | null; calendario: CalendarioAllegato | null }> {
  const vuoto = { contratto: null, calendario: null };
  const riga = ex.select().from(mailMessages).where(eq(mailMessages.id, mailId)).get();
  let allegati: { nome: string; file: string }[] = [];
  try {
    allegati = JSON.parse(riga?.attachments ?? "[]");
  } catch {
    return vuoto;
  }

  let contratto: NewCourseProposal["contract"] | null = null;
  let calendario: CalendarioAllegato | null = null;
  for (const allegato of allegati) {
    if (!/\.pdf$/i.test(allegato.nome)) continue;
    const contenuto = leggiAllegato(allegato.file);
    if (!contenuto) continue;
    const testo = await estraiTestoPdf(contenuto);
    if (!calendario && eUnCalendario(allegato.nome, testo)) {
      calendario = calendarioDaTesto(testo, allegato.file, allegato.nome);
      if (calendario) continue;
    }
    if (contratto) continue;
    const letto = leggiContratto(testo);
    if (letto.feeCents !== null || letto.assignmentNumber) {
      contratto = {
        feeCents: letto.feeCents,
        assignmentNumber: letto.assignmentNumber || numeroDaNomeFile(allegato.nome),
        hours: letto.hours,
        file: allegato.file,
        filename: allegato.nome,
      };
    }
  }
  return { contratto, calendario };
}

/**
 * Aggancia al corso l'accesso Teams trovato nella mail.
 *
 * Non è una modifica al calendario — è il link con cui si entra a lezione — e
 * quindi non passa dalla conferma. Ciò che è già salvato non viene mai
 * sovrascritto: se la mail porta un accesso diverso lo si dice e si decide a
 * mano, perché un link cambiato a metà corso può essere sia un aggiornamento
 * sia una riunione di un'altra classe.
 */
export function salvaAccessoTeams(ex: Executor, courseId: number, accesso: TeamsAccess): string {
  if (!haAccesso(accesso)) return "";
  const corso = ex.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!corso) return "";

  const patch: Partial<typeof courses.$inferInsert> = {};
  if (accesso.url && !corso.meetingUrl) patch.meetingUrl = accesso.url;
  if (accesso.user && !corso.meetingUser) patch.meetingUser = accesso.user;
  if (accesso.password && !corso.meetingPassword) patch.meetingPassword = accesso.password;
  const scritti = Object.keys(patch).length;
  if (scritti > 0) {
    ex.update(courses)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(courses.id, courseId))
      .run();
  }

  const diverso =
    (accesso.url !== "" && corso.meetingUrl !== "" && accesso.url !== corso.meetingUrl) ||
    (accesso.password !== "" && corso.meetingPassword !== "" && accesso.password !== corso.meetingPassword);
  if (diverso) return "La mail porta un accesso Teams diverso da quello salvato sul corso.";
  return scritti > 0 ? "Accesso Teams salvato sul corso." : "";
}

/** Collega al corso la lettera d'incarico arrivata con la mail. */
export function attachContract(db: DB, mailId: number, courseId: number): void {
  const mail = getMail(db, mailId);
  const file = mail.proposal.kind === "NUOVO_CORSO" ? mail.proposal.contract?.file : null;
  if (!file) return;
  db.update(courses).set({ contractFile: file, updatedAt: new Date().toISOString() }).where(eq(courses.id, courseId)).run();
}

/** Lezioni future del corso abbinato: servono a mostrare l'effetto della proposta. */
export function upcomingLessons(ex: Executor, courseId: number, from: ISODate) {
  return ex
    .select()
    .from(lessons)
    .where(and(eq(lessons.courseId, courseId), gte(lessons.date, from)))
    .orderBy(asc(lessons.date))
    .limit(5)
    .all();
}

export function lessonsOnDates(ex: Executor, courseId: number, from: ISODate, to: ISODate) {
  return ex
    .select()
    .from(lessons)
    .where(and(eq(lessons.courseId, courseId), gte(lessons.date, from), lte(lessons.date, to)))
    .orderBy(asc(lessons.date))
    .all();
}
