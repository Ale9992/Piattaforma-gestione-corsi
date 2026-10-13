import "server-only";
import {
  formatDateIT,
  formatTime,
  isValidISODate,
  isValidTime,
  makeISODate,
  parseTime,
  todayInRome,
  weekdayOf,
  WEEKDAY_NAMES,
  type ISODate,
  type Weekday,
} from "@/lib/dates";

/**
 * Parser OPZIONALE della mail di assegnazione corso.
 * DeepSeek estrae soltanto i campi testuali; il risultato viene normalizzato e
 * validato in modo deterministico e mostrato in un form modificabile.
 * Nessun dato viene salvato senza conferma esplicita.
 */

const WEEKDAY_CODES: Record<string, Weekday> = {
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 7,
};

/** Rete di sicurezza se il modello risponde in italiano invece che con i codici. */
const ITALIAN_WEEKDAYS: Record<string, Weekday> = {
  lunedì: 1,
  lunedi: 1,
  martedì: 2,
  martedi: 2,
  mercoledì: 3,
  mercoledi: 3,
  giovedì: 4,
  giovedi: 4,
  venerdì: 5,
  venerdi: 5,
  sabato: 6,
  domenica: 7,
};

export interface ParsedTimeSlot {
  date: ISODate | null;
  startTime: string | null;
  endTime: string | null;
}

/** Una riga orario estratta dalla mail: giorni + orario. */
export interface ParsedScheduleBlock {
  days: Weekday[];
  startTime: string | null;
  endTime: string | null;
  /** Se questi giorni partono dopo l'inizio del corso ("il sabato dal 3 ottobre"). */
  startDate: ISODate | null;
}

export interface ParsedCourseDraft {
  name: string;
  /** Numero dell'ordine d'incarico ("Incarico n. 260532"), se la mail lo riporta. */
  assignmentNumber: string;
  mode: string;
  studentsCount: number | null;
  totalHours: number | null;
  /** Una riga per ogni orario: "martedì 11–12, mercoledì 9–11" sono due righe. */
  schedule: ParsedScheduleBlock[];
  startDate: ISODate | null;
  clientCompany: string;
  studentReference: string;
  preLesson: ParsedTimeSlot | null;
  firstLesson: ParsedTimeSlot | null;
  /** Avvisi deterministici su dati mancanti o incoerenti. */
  warnings: string[];
}

export class ParserError extends Error {}

export const CORSO_PROMPT = `Sei un estrattore di dati. Ricevi il testo di una mail italiana che assegna un corso di formazione.
Restituisci SOLO un oggetto JSON con esattamente questa forma (esempio completo):
{
  "name": "Gemini e Notebook LM",
  "mode": "Videoconferenza",
  "studentsCount": 7,
  "totalHours": 28,
  "schedule": [
    {"days": ["TUESDAY", "THURSDAY"], "startTime": "14:00", "endTime": "16:00"}
  ],
  "startDate": "2026-09-24",
  "clientCompany": "ORIONE SRL",
  "studentReference": "ESPOSITO ANNA",
  "assignmentNumber": "260532",
  "preLesson": {"date": "2026-09-22", "startTime": "15:00", "endTime": "16:00"},
  "firstLesson": {"date": "2026-09-24", "startTime": "10:00", "endTime": "12:00"}
}
Regole:
- "schedule" è SEMPRE un array. Ogni elemento ha "days" (array di stringhe fra MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY; mai un oggetto) e il suo orario.
- Se i giorni hanno lo stesso orario, usa UN SOLO elemento con tutti i giorni.
- Se l'orario cambia col giorno, usa un elemento PER OGNI orario. Esempio: "martedì dalle 11,00 alle 12,00 - mercoledì dalle 9,00 alle 11,00" diventa
  [{"days":["TUESDAY"],"startTime":"11:00","endTime":"12:00"},{"days":["WEDNESDAY"],"startTime":"09:00","endTime":"11:00"}].
- Se alcuni giorni iniziano più tardi del corso (es. "mercoledì dal 16/09, il sabato a partire dal 3/10"), metti quei giorni in un elemento separato con "startDate" (YYYY-MM-DD). Gli altri elementi non hanno "startDate" (o null).
  Esempio: [{"days":["WEDNESDAY"],"startTime":"09:00","endTime":"13:00"},{"days":["SATURDAY"],"startTime":"09:00","endTime":"13:00","startDate":"2026-10-03"}].
- Se un giorno è "da definire" o la sua data di partenza non è indicata, NON inserirlo in "schedule".
- "totalHours" è il monte ore del corso SENZA l'eventuale ora di prelezione ("30 ore + 1 ora di pre-lezione" significa totalHours 30).
- "assignmentNumber" è il numero dell'ordine d'incarico, spesso nell'oggetto ("Incarico n. 260532"): riporta solo le cifre.
- L'azienda cliente può essere indicata come "Azienda cliente", "Ente cliente" o simili.
- Estrai solo informazioni presenti nel testo. Se un dato manca usa null. Non inventare.
- Converti solo i formati: date DD/MM/YYYY -> YYYY-MM-DD, orari "14,00" o "14.00" -> "14:00".
- Se una data non indica l'anno, usa l'anno della data di inizio corso; se manca anche quella, scegli l'anno che rende la data futura rispetto a oggi.
- "preLesson" solo se il testo menziona esplicitamente una prelezione (o pre-lezione / lezione preliminare), altrimenti null.
- "firstLesson" solo se il testo indica esplicitamente che la prima lezione ha giorno o orario diversi dalla frequenza abituale, altrimenti null.
- Non calcolare date di fine, numero di lezioni o altro.`;

function config() {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new ParserError(
      "DEEPSEEK_API_KEY non configurata: compila i dati manualmente oppure imposta la variabile d'ambiente.",
    );
  }
  return {
    apiKey,
    baseUrl: (process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/+$/, ""),
    // Modelli disponibili: deepseek-flash e deepseek-v4-pro (gli alias deepseek-chat
    // e deepseek-reasoner sono stati ritirati). Per una semplice estrazione basta flash.
    model: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-flash",
    // "none" disattiva il ragionamento: estrazione più rapida ed economica.
    reasoningEffort: process.env.DEEPSEEK_REASONING_EFFORT?.trim() || "none",
  };
}

export function isParserConfigured(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY?.trim());
}

export async function parseCourseEmail(text: string, now?: Date): Promise<ParsedCourseDraft> {
  const today = todayInRome(now);
  const input = text.trim();
  if (!input) throw new ParserError("Incolla il testo della mail.");
  if (input.length > 20_000) throw new ParserError("Testo troppo lungo (massimo 20.000 caratteri).");

  const raw = await askDeepSeek(`${CORSO_PROMPT}\nOggi è ${today}.`, input);
  return normalizeExtraction(raw, today);
}

/**
 * Una domanda a DeepSeek con risposta in JSON. Condivisa dall'estrazione dei
 * corsi e dal riconoscimento delle mail in arrivo.
 */
export async function askDeepSeek(systemPrompt: string, input: string): Promise<unknown> {
  const { apiKey, baseUrl, model, reasoningEffort } = config();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 1000,
        reasoning_effort: reasoningEffort,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: input },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
      cache: "no-store",
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "rete";
    throw new ParserError(`DeepSeek non raggiungibile (${reason}). Compila i dati manualmente.`);
  }

  if (!response.ok) {
    const detail =
      response.status === 401
        ? "chiave API non valida"
        : response.status === 402
          ? "credito esaurito"
          : response.status === 400
            ? `richiesta rifiutata (modello "${model}" inesistente?)`
            : `HTTP ${response.status}`;
    throw new ParserError(`Errore DeepSeek: ${detail}.`);
  }

  const payload = (await response.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
  } | null;
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new ParserError("Risposta DeepSeek vuota.");
  try {
    return JSON.parse(content);
  } catch {
    throw new ParserError("Risposta DeepSeek non in formato JSON.");
  }
}

// ---------------------------------------------------------------------------
// Normalizzazione deterministica (testabile senza rete)
// ---------------------------------------------------------------------------

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(",", ".").replace(/[^\d.]/g, ""));
    return value.trim() && Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Numero d'incarico: si tengono solo le cifre ("n. 260532" -> "260532"). */
export function normalizeAssignmentNumber(value: unknown): string {
  const cifre = str(value).replace(/\D+/g, "");
  return cifre.length >= 3 && cifre.length <= 20 ? cifre : "";
}

export function normalizeDate(value: unknown): ISODate | null {
  const s = str(value);
  if (isValidISODate(s)) return s;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) {
    const date = makeISODate(Number(m[3]), Number(m[2]), Number(m[1]));
    return isValidISODate(date) ? date : null;
  }
  return null;
}

export function normalizeTime(value: unknown): string | null {
  const s = str(value);
  if (/^\d{1,2}$/.test(s) && Number(s) <= 24) return formatTime(Number(s) * 60);
  return isValidTime(s) ? formatTime(parseTime(s)) : null;
}

function slot(value: unknown): ParsedTimeSlot | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const result = {
    date: normalizeDate(v.date),
    startTime: normalizeTime(v.startTime),
    endTime: normalizeTime(v.endTime),
  };
  return result.date || result.startTime ? result : null;
}

/**
 * I giorni possono arrivare come array (`["TUESDAY"]`), come oggetto
 * (`{"TUESDAY": true, "MONDAY": false}`) o come stringa ("martedì e giovedì"):
 * il modello non è vincolato, quindi accettiamo tutte e tre le forme.
 */
export function normalizeDays(value: unknown): Weekday[] {
  const codes: string[] = Array.isArray(value)
    ? value.map((d) => str(d))
    : value && typeof value === "object"
      ? Object.entries(value as Record<string, unknown>)
          .filter(([, enabled]) => enabled === true || str(enabled).toLowerCase() === "true")
          .map(([key]) => key)
      : typeof value === "string"
        ? value.split(/[,;/]|\se\s|\sand\s/i).map((s) => s.trim())
        : [];

  const days = codes
    .map((code) => WEEKDAY_CODES[code.trim().toUpperCase()] ?? ITALIAN_WEEKDAYS[code.trim().toLowerCase()])
    .filter((d): d is Weekday => Boolean(d));
  return [...new Set(days)].sort((a, b) => a - b);
}

/** Accetta sia la forma a righe (`schedule`) sia quella piatta di una volta. */
function normalizeSchedule(v: Record<string, unknown>): ParsedScheduleBlock[] {
  const raw = Array.isArray(v.schedule) ? v.schedule : null;
  const blocks = raw
    ? raw.map((b) => {
        const o = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
        return {
          days: normalizeDays(o.days),
          startTime: normalizeTime(o.startTime),
          endTime: normalizeTime(o.endTime),
          startDate: normalizeDate(o.startDate),
        };
      })
    : [
        {
          days: normalizeDays(v.days),
          startTime: normalizeTime(v.startTime),
          endTime: normalizeTime(v.endTime),
          startDate: null,
        },
      ];
  return blocks.filter((b) => b.days.length > 0 || b.startTime !== null);
}

export function normalizeExtraction(raw: unknown, today?: ISODate): ParsedCourseDraft {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const schedule = normalizeSchedule(v);
  const studentsCount = num(v.studentsCount);
  const totalHours = num(v.totalHours);

  const draft: ParsedCourseDraft = {
    name: str(v.name),
    assignmentNumber: normalizeAssignmentNumber(v.assignmentNumber),
    mode: str(v.mode),
    studentsCount: studentsCount !== null && Number.isInteger(studentsCount) ? studentsCount : null,
    totalHours: totalHours !== null && totalHours > 0 ? totalHours : null,
    schedule,
    startDate: normalizeDate(v.startDate),
    clientCompany: str(v.clientCompany),
    studentReference: str(v.studentReference),
    preLesson: slot(v.preLesson),
    firstLesson: slot(v.firstLesson),
    warnings: [],
  };

  const w = draft.warnings;
  // Una data "dal" uguale o precedente all'inizio corso non aggiunge nulla.
  for (const block of draft.schedule) {
    if (block.startDate && (!draft.startDate || block.startDate <= draft.startDate)) {
      if (draft.startDate && block.startDate < draft.startDate) {
        w.push(`Una riga orario indica una partenza (${formatDateIT(block.startDate)}) precedente all'inizio corso: ignorata.`);
      }
      block.startDate = null;
    }
  }
  const giorniTotali = draft.schedule.flatMap((b) => b.days);
  const giorniDaSubito = draft.schedule.filter((b) => !b.startDate).flatMap((b) => b.days);
  if (!draft.name) w.push("Titolo del corso non trovato.");
  if (draft.totalHours === null) w.push("Monte ore non trovato.");
  if (giorniTotali.length === 0) w.push("Giorni della settimana non trovati.");
  if (draft.schedule.some((b) => !b.startTime || !b.endTime)) {
    w.push("Orario delle lezioni non trovato.");
  } else if (
    draft.schedule.some((b) => parseTime(b.startTime!) >= parseTime(b.endTime!))
  ) {
    w.push("L'orario di fine precede quello di inizio.");
  }
  if (new Set(giorniTotali).size !== giorniTotali.length) {
    w.push("Lo stesso giorno compare in due righe orario: controlla la frequenza.");
  }
  const posticipati = draft.schedule.filter((b) => b.startDate);
  for (const block of posticipati) {
    const nomi = block.days.map((d) => WEEKDAY_NAMES[d].toLowerCase()).join(", ");
    w.push(`Il ${nomi || "giorno"} parte solo dal ${formatDateIT(block.startDate!)}: verifica la data.`);
  }
  if (draft.schedule.length > 1 && posticipati.length < draft.schedule.length - 1) {
    w.push("La mail indica orari diversi per giorni diversi: verifica le righe.");
  }
  if (!draft.startDate) w.push("Data di inizio non trovata.");
  else if (today && draft.startDate < today) {
    // Tipico quando la mail scrive "il 21 settembre" senza indicare l'anno.
    w.push(`La data di inizio (${formatDateIT(draft.startDate)}) è nel passato: controlla l'anno.`);
  }
  if (
    draft.startDate &&
    giorniDaSubito.length > 0 &&
    !draft.firstLesson &&
    !giorniDaSubito.includes(weekdayOf(draft.startDate))
  ) {
    w.push("La data di inizio non cade in uno dei giorni indicati: verifica o imposta una prima lezione diversa.");
  }
  if (draft.preLesson && (!draft.preLesson.date || !draft.preLesson.startTime)) {
    w.push("Prelezione indicata ma data/orario incompleti.");
  }
  return draft;
}
