import "server-only";
import { agencyAliases } from "@/lib/agency";
import { isValidISODate, todayInRome, type ISODate } from "@/lib/dates";
import {
  askDeepSeek,
  CORSO_PROMPT,
  normalizeAssignmentNumber,
  normalizeDate,
  normalizeExtraction,
  normalizeTime,
  ParserError,
  type ParsedCourseDraft,
} from "./parser";

/**
 * Riconoscimento delle mail in arrivo. DeepSeek legge il testo e dice di che
 * tipo di mail si tratta e quali dati contiene: le DECISIONI restano al
 * gestionale, che costruisce una proposta e aspetta la conferma dell'utente.
 */
export const MAIL_KINDS = [
  "NUOVO_CORSO",
  "ANNULLAMENTO",
  "CAMBIO_CALENDARIO",
  "CONFERMA_CALENDARIO",
  "CHIUSURA_CORSO",
  "INCONTRO_PRELIMINARE",
  "ALTRO",
] as const;
export type MailKind = (typeof MAIL_KINDS)[number];

/** Riferimenti utili a capire di quale corso parla la mail. */
export interface MailCourseHint {
  courseName: string;
  clientCompany: string;
  studentReference: string;
  /** Numero d'incarico citato nella mail: aggancia il corso senza ambiguità. */
  assignmentNumber: string;
}

export interface CancelledLesson {
  date: ISODate;
  startTime: string | null;
}

/** Una riga della tabella date nelle mail di conferma corso. */
export interface ConfirmedSession {
  date: ISODate;
  startTime: string | null;
  endTime: string | null;
}

export interface ParsedMail {
  kind: MailKind;
  hint: MailCourseHint;
  /** Solo per ANNULLAMENTO: le lezioni che non si faranno. */
  cancelled: CancelledLesson[];
  /** Solo per CAMBIO_CALENDARIO: da quando vale la nuova frequenza. */
  changeFrom: ISODate | null;
  /** Solo per CONFERMA_CALENDARIO: l'elenco completo delle lezioni confermate. */
  sessions: ConfirmedSession[];
  /** Solo per INCONTRO_PRELIMINARE: quando è fissato l'incontro. */
  meeting: ConfirmedSession | null;
  /** Solo per NUOVO_CORSO: i dati del corso, come nel modulo di creazione. */
  course: ParsedCourseDraft | null;
  /** Frase riassuntiva presa dalla mail, mostrata nell'elenco. */
  summary: string;
  warnings: string[];
}

const CLASSIFY_PROMPT_BASE = `Sei un classificatore di mail italiane che riguardano corsi di formazione erogati da un formatore.
Restituisci SOLO un oggetto JSON con questa forma:
{
  "kind": "NUOVO_CORSO" | "ANNULLAMENTO" | "CAMBIO_CALENDARIO" | "CONFERMA_CALENDARIO" | "CHIUSURA_CORSO" | "INCONTRO_PRELIMINARE" | "ALTRO",
  "courseName": "EXCEL AVANZATO",
  "clientCompany": "Comune di Esempio",
  "studentReference": "CONTI GIULIA",
  "assignmentNumber": "260532",
  "cancelled": [{"date": "2026-09-12", "startTime": "09:00"}],
  "sessions": [{"date": "2026-09-29", "startTime": "11:00", "endTime": "12:00"}],
  "changeFrom": "2026-10-03",
  "meeting": {"date": "2026-10-02", "startTime": "09:00", "endTime": null},
  "summary": "una frase presa dalla mail che spiega cosa chiede"
}
Regole:
- "NUOVO_CORSO": la mail assegna o conferma un nuovo incarico, con monte ore, giorni e data di inizio (spesso è un contratto o una scheda corso).
- "ANNULLAMENTO": una o più lezioni già fissate non si faranno (rinvio, assenza, sospensione). Metti le date in "cancelled".
- "CONFERMA_CALENDARIO": la mail conferma un corso già assegnato ed ELENCA le date delle lezioni (spesso in tabella: numero, data, inizio, fine). Riporta TUTTE le righe in "sessions", in ordine.
- "CAMBIO_CALENDARIO": cambiano giorni oppure orari delle lezioni future, o se ne aggiunge uno nuovo. Metti in "changeFrom" la data da cui vale il cambio.
- "CHIUSURA_CORSO": la mail comunica che il corso è finito (fatturazione, scheda di valutazione dell'allievo, chiusura pratica). Metti in "courseName" e "studentReference" i riferimenti citati.
- "INCONTRO_PRELIMINARE": la mail fissa un incontro (preliminare, di presentazione, conoscitivo) PRIMA che il corso cominci, con una data e un'ora. Metti data e ora in "meeting" e il nome del corso in "courseName". Il corso può non esistere ancora: non è un annullamento né un cambio di calendario.
- "ALTRO": qualsiasi cosa non riguardi la programmazione di un corso (amministrazione, fatture, pubblicità, richieste generiche). In caso di dubbio usa "ALTRO".
- "assignmentNumber" è il numero dell'ordine d'incarico citato nella mail (spesso nell'oggetto, "Incarico n. 260532"): solo le cifre, altrimenti stringa vuota.
- Riporta i riferimenti del corso come sono scritti nella mail; se un dato manca usa null o stringa vuota. Non inventare.
- ATTENZIONE: chi scrive è l'agenzia di formazione, non il cliente: non metterla in "clientCompany" e non usarla come riferimento del corso.
- Negli oggetti tipo "Annullamento lezione 13/10 Rossi - Agenzia Formazione" il riferimento utile è "Rossi" (cliente o allievo), la data è "13/10" e il nome dell'agenzia va ignorato.
- Converti solo i formati: date DD/MM/YYYY -> YYYY-MM-DD, orari "14,00" o "14.00" -> "14:00".
- Se una data non indica l'anno, scegli l'anno che rende la data più vicina a oggi.
- Non calcolare recuperi, date di fine o nuove lezioni: pensa a tutto il gestionale.`;

/**
 * Il prompt con il nome dell'agenzia, quando è configurato: senza saperlo il
 * modello la confonde col cliente, perché nelle mail compare in ogni oggetto.
 */
export function classifyPrompt(agenzia: readonly string[] = agencyAliases()): string {
  if (agenzia.length === 0) return CLASSIFY_PROMPT_BASE;
  return `${CLASSIFY_PROMPT_BASE}\n- L'agenzia che scrive si chiama: ${agenzia.join(", ")}. Queste parole non sono mai il cliente né il riferimento del corso.`;
}

export function normalizeSessions(value: unknown): ConfirmedSession[] {
  const list = Array.isArray(value) ? value : [];
  const out: ConfirmedSession[] = [];
  for (const item of list) {
    const record = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const date = normalizeDate(record.date);
    if (!date || out.some((x) => x.date === date && x.startTime === normalizeTime(record.startTime))) continue;
    out.push({ date, startTime: normalizeTime(record.startTime), endTime: normalizeTime(record.endTime) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? "").localeCompare(b.startTime ?? ""));
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeKind(value: unknown): MailKind {
  const raw = str(value).toUpperCase().replace(/[\s-]+/g, "_");
  return (MAIL_KINDS as readonly string[]).includes(raw) ? (raw as MailKind) : "ALTRO";
}

export function normalizeCancelled(value: unknown): CancelledLesson[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const out: CancelledLesson[] = [];
  for (const item of list) {
    const record = (item && typeof item === "object" ? item : { date: item }) as Record<string, unknown>;
    const date = normalizeDate(record.date);
    if (date && !out.some((x) => x.date === date)) {
      out.push({ date, startTime: normalizeTime(record.startTime) });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Normalizzazione deterministica della risposta del modello: i tipi di mail
 * senza i dati che li rendono utilizzabili vengono declassati, con un avviso.
 */
export function normalizeClassification(
  raw: unknown,
  course: ParsedCourseDraft | null,
  today: ISODate,
): ParsedMail {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  let kind = normalizeKind(v.kind);
  const cancelled = normalizeCancelled(v.cancelled);
  const sessions = normalizeSessions(v.sessions);
  const changeFrom = normalizeDate(v.changeFrom);
  const meeting = normalizeSessions([v.meeting])[0] ?? null;
  const warnings: string[] = [];

  if (kind === "INCONTRO_PRELIMINARE" && !meeting) {
    kind = "ALTRO";
    warnings.push("Sembra un incontro preliminare ma non ho letto la data: leggi la mail.");
  }

  if (kind === "CONFERMA_CALENDARIO" && sessions.length === 0) {
    kind = "ALTRO";
    warnings.push("Sembra una conferma corso ma non ho letto le date: controllale a mano.");
  }

  if (kind === "ANNULLAMENTO" && cancelled.length === 0) {
    kind = "ALTRO";
    warnings.push("Sembra un annullamento ma non ho trovato la data della lezione: leggi la mail.");
  }
  if (kind === "CAMBIO_CALENDARIO" && !course?.schedule.length) {
    warnings.push("Cambio di calendario senza giorni e orari chiari: controlla la mail prima di applicare.");
  }
  if (kind === "NUOVO_CORSO" && !course) {
    kind = "ALTRO";
    warnings.push("Sembra un corso nuovo ma mancano i dati: leggi la mail.");
  }
  for (const lesson of cancelled) {
    if (lesson.date < today) {
      warnings.push(`La lezione annullata (${lesson.date}) è nel passato: controlla l'anno.`);
    }
  }
  if (kind === "CAMBIO_CALENDARIO" && changeFrom && changeFrom < today) {
    warnings.push("Il cambio parte da una data passata: il gestionale non riscrive lo storico.");
  }

  return {
    kind,
    meeting,
    hint: {
      courseName: str(v.courseName) || course?.name || "",
      clientCompany: str(v.clientCompany) || course?.clientCompany || "",
      studentReference: str(v.studentReference) || course?.studentReference || "",
      assignmentNumber: normalizeAssignmentNumber(v.assignmentNumber) || course?.assignmentNumber || "",
    },
    cancelled,
    sessions,
    changeFrom: changeFrom && isValidISODate(changeFrom) ? changeFrom : null,
    course: kind === "NUOVO_CORSO" || kind === "CAMBIO_CALENDARIO" ? course : null,
    summary: str(v.summary).slice(0, 300),
    warnings: [...warnings, ...(kind === "NUOVO_CORSO" ? (course?.warnings ?? []) : [])],
  };
}

/**
 * Legge una mail: prima il tipo, poi — se serve — i dati del corso con lo
 * stesso estrattore usato dal modulo "Incolla mail".
 */
export async function classifyMail(
  input: { subject: string; body: string },
  now?: Date,
): Promise<ParsedMail> {
  const today = todayInRome(now);
  const text = `Oggetto: ${input.subject}\n\n${input.body}`.trim();
  if (!text) throw new ParserError("Mail vuota.");
  const testo = text.slice(0, 20_000);

  const raw = await askDeepSeek(`${classifyPrompt()}\nOggi è ${today}.`, testo);
  const kind = normalizeKind((raw as Record<string, unknown>)?.kind);

  let course: ParsedCourseDraft | null = null;
  if (kind === "NUOVO_CORSO" || kind === "CAMBIO_CALENDARIO") {
    const datiCorso = await askDeepSeek(`${CORSO_PROMPT}\nOggi è ${today}.`, testo);
    const draft = normalizeExtraction(datiCorso, today);
    // Un corso senza nome né giorni non è utilizzabile: meglio nessuna proposta.
    course = draft.name || draft.schedule.length > 0 ? draft : null;
  }
  return normalizeClassification(raw, course, today);
}
