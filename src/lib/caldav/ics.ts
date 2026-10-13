import { createHash } from "node:crypto";
import { parseISODate, type ISODate } from "@/lib/dates";

/**
 * Generazione iCalendar (RFC 5545) per la sincronizzazione con Apple Calendar.
 *
 * Gli orari sono "floating" (senza TZID e senza Z), come nel resto dell'applicazione:
 * una lezione alle 14:00 resta alle 14:00, senza conversioni di fuso.
 */

/** Marchio di proprietà: l'app tocca SOLO gli eventi che contengono questa proprietà. */
export const OWNER_TAG = "X-GESTIONE-CORSI";
export const OWNER_VALUE = "1";
/** Impronta del contenuto: evita PUT inutili quando nulla è cambiato. */
export const HASH_TAG = "X-GESTIONE-CORSI-HASH";
export const UID_PREFIX = "gestione-corsi";

export type EventKind = "LESSON" | "PRE_LESSON" | "APPOINTMENT";

export interface CalendarEventData {
  kind: EventKind;
  /** Id della lezione, della prelezione o dell'impegno nel database. */
  id: number;
  date: ISODate;
  startMin: number;
  endMin: number;
  summary: string;
  location: string;
  description: string;
}

const NOME_UID: Record<EventKind, string> = {
  LESSON: "lezione",
  PRE_LESSON: "prelezione",
  APPOINTMENT: "incontro",
};

export function eventUid(kind: EventKind, id: number): string {
  return `${UID_PREFIX}-${NOME_UID[kind]}-${id}@gestione-corsi`;
}

export function isOwnedUid(uid: string): boolean {
  return uid.startsWith(`${UID_PREFIX}-`);
}

function pad(n: number, width = 2) {
  return String(n).padStart(width, "0");
}

/** "2026-09-24" + 840 → "20260924T140000" (ora locale, senza fuso). */
export function icsDateTime(date: ISODate, minutes: number): string {
  const { year, month, day } = parseISODate(date);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${pad(year, 4)}${pad(month)}${pad(day)}T${pad(h)}${pad(m)}00`;
}

/** Escape secondo RFC 5545 §3.3.11. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Piegatura delle righe a 75 ottetti (RFC 5545 §3.1). */
function foldLine(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;
  const chars = [...line];
  const out: string[] = [];
  let current = "";
  for (const ch of chars) {
    const candidate = current + ch;
    if (Buffer.byteLength(candidate, "utf8") > (out.length === 0 ? 75 : 74)) {
      out.push(current);
      current = ch;
    } else {
      current = candidate;
    }
  }
  out.push(current);
  return out.join("\r\n ");
}

export function eventHash(event: CalendarEventData): string {
  const payload = [
    event.date,
    event.startMin,
    event.endMin,
    event.summary,
    event.location,
    event.description,
  ].join("|");
  return createHash("sha1").update(payload).digest("hex").slice(0, 16);
}

/** Documento iCalendar completo con un singolo evento. */
export function buildCalendarObject(event: CalendarEventData, timestamp = "19700101T000000Z"): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Gestione Corsi//IT",
    "CALSCALE:GREGORIAN",
    ...veventLines(event, timestamp),
    "END:VCALENDAR",
  ].filter((l): l is string => l !== null);
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

function veventLines(event: CalendarEventData, timestamp: string): (string | null)[] {
  return [
    "BEGIN:VEVENT",
    `UID:${eventUid(event.kind, event.id)}`,
    `DTSTAMP:${timestamp}`,
    `DTSTART:${icsDateTime(event.date, event.startMin)}`,
    `DTEND:${icsDateTime(event.date, event.endMin)}`,
    `SUMMARY:${escapeText(event.summary)}`,
    event.location ? `LOCATION:${escapeText(event.location)}` : null,
    event.description ? `DESCRIPTION:${escapeText(event.description)}` : null,
    "TRANSP:OPAQUE",
    `${OWNER_TAG}:${OWNER_VALUE}`,
    `${HASH_TAG}:${eventHash(event)}`,
    "END:VEVENT",
  ];
}

/**
 * Documento iCalendar con più eventi: è il file che si scarica per importarlo
 * a mano in Apple Calendar. Gli UID sono gli stessi della sincronizzazione, così
 * accendendola in seguito gli eventi già importati vengono aggiornati, non duplicati.
 */
export function buildCalendarDocument(
  events: readonly CalendarEventData[],
  options: { name?: string; timestamp?: string } = {},
): string {
  const timestamp = options.timestamp ?? "19700101T000000Z";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Gestione Corsi//IT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    options.name ? `X-WR-CALNAME:${escapeText(options.name)}` : null,
    ...events.flatMap((event) => veventLines(event, timestamp)),
    "END:VCALENDAR",
  ].filter((l): l is string => l !== null);
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** Rimuove la piegatura delle righe prima di leggerle. */
function unfold(ics: string): string {
  return ics.replace(/\r?\n[ \t]/g, "");
}

export interface RemoteEventInfo {
  uid: string | null;
  hash: string | null;
  owned: boolean;
}

/** Legge dall'iCalendar remoto solo ciò che serve: UID, impronta e marchio di proprietà. */
export function readCalendarObject(ics: string): RemoteEventInfo {
  const text = unfold(ics);
  const value = (tag: string) => {
    const m = new RegExp(`^${tag}(?:;[^:\\r\\n]*)?:(.*)$`, "mi").exec(text);
    return m ? m[1].trim() : null;
  };
  const uid = value("UID");
  return {
    uid,
    hash: value(HASH_TAG),
    owned: value(OWNER_TAG) === OWNER_VALUE && uid !== null && isOwnedUid(uid),
  };
}
