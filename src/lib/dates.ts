/**
 * Date e orari "floating" (ora locale Europe/Rome), senza fusi orari.
 *
 * - Una data è una stringa ISO `YYYY-MM-DD`.
 * - Un orario è un intero: minuti dalla mezzanotte (0..1440).
 *
 * L'aritmetica sui giorni usa esclusivamente `Date.UTC` come contatore di giorni
 * civili: nessuna conversione dipende dal fuso del processo, quindi il cambio
 * ora legale/solare non può spostare una lezione di giorno.
 */

export type ISODate = string;

/** 1 = lunedì … 7 = domenica (ISO 8601). */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const APP_TIME_ZONE = "Europe/Rome";

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export function isValidISODate(value: unknown): value is ISODate {
  if (typeof value !== "string") return false;
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function assertISODate(value: string): ISODate {
  if (!isValidISODate(value)) throw new Error(`Data non valida: ${value}`);
  return value;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

export function makeISODate(year: number, month: number, day: number): ISODate {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function parseISODate(date: ISODate): { year: number; month: number; day: number } {
  const m = ISO_DATE_RE.exec(date);
  if (!m) throw new Error(`Data non valida: ${date}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** Numero progressivo del giorno civile (giorni dal 1970-01-01). */
export function toDayNumber(date: ISODate): number {
  const { year, month, day } = parseISODate(date);
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

export function fromDayNumber(dayNumber: number): ISODate {
  const d = new Date(dayNumber * MS_PER_DAY);
  return makeISODate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromDayNumber(toDayNumber(date) + days);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return toDayNumber(a) - toDayNumber(b);
}

export function weekdayOf(date: ISODate): Weekday {
  // 1970-01-01 era un giovedì (ISO 4).
  const n = toDayNumber(date);
  return ((((n + 3) % 7) + 7) % 7 + 1) as Weekday;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b;
}

/** Lunedì della settimana che contiene `date`. */
export function startOfWeek(date: ISODate): ISODate {
  return addDays(date, 1 - weekdayOf(date));
}

export function startOfMonth(date: ISODate): ISODate {
  const { year, month } = parseISODate(date);
  return makeISODate(year, month, 1);
}

export function endOfMonth(date: ISODate): ISODate {
  const { year, month } = parseISODate(date);
  return makeISODate(year, month, daysInMonth(year, month));
}

export function addMonths(date: ISODate, months: number): ISODate {
  const { year, month, day } = parseISODate(date);
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  return makeISODate(y, m, Math.min(day, daysInMonth(y, m)));
}

/** Tutte le date da `from` a `to` inclusi. */
export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let n = toDayNumber(from), end = toDayNumber(to); n <= end; n++) {
    out.push(fromDayNumber(n));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Orari
// ---------------------------------------------------------------------------

const TIME_RE = /^(\d{1,2})[:.,](\d{2})$/;

export function isValidTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = TIME_RE.exec(value.trim());
  if (!m) return false;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return (h < 24 && mi < 60) || (h === 24 && mi === 0);
}

/** "14:00" / "14.00" / "14,00" → 840. */
export function parseTime(value: string): number {
  const m = TIME_RE.exec(value.trim());
  if (!m || !isValidTime(value)) throw new Error(`Orario non valido: ${value}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 840 → "14:00". */
export function formatTime(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export function formatTimeRange(startMin: number, endMin: number): string {
  return `${formatTime(startMin)}–${formatTime(endMin)}`;
}

/** 120 → "2h", 90 → "1h 30m", 30 → "30m". */
export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m}m`;
  if (m === 0) return `${sign}${h}h`;
  return `${sign}${h}h ${m}m`;
}

/** Ore in formato italiano: 1680 → "28", 1650 → "27,5". */
export function formatHours(minutes: number): string {
  const hours = minutes / 60;
  return hours.toLocaleString("it-IT", { maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// Formattazione italiana
// ---------------------------------------------------------------------------

export const WEEKDAY_NAMES: Record<Weekday, string> = {
  1: "Lunedì",
  2: "Martedì",
  3: "Mercoledì",
  4: "Giovedì",
  5: "Venerdì",
  6: "Sabato",
  7: "Domenica",
};

export const WEEKDAY_SHORT: Record<Weekday, string> = {
  1: "Lun",
  2: "Mar",
  3: "Mer",
  4: "Gio",
  5: "Ven",
  6: "Sab",
  7: "Dom",
};

export const MONTH_NAMES = [
  "Gennaio",
  "Febbraio",
  "Marzo",
  "Aprile",
  "Maggio",
  "Giugno",
  "Luglio",
  "Agosto",
  "Settembre",
  "Ottobre",
  "Novembre",
  "Dicembre",
] as const;

export const ALL_WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

/** "2026-09-24" → "24/09/2026". */
export function formatDateIT(date: ISODate | null | undefined): string {
  if (!date) return "—";
  const { year, month, day } = parseISODate(date);
  return `${pad(day)}/${pad(month)}/${pad(year, 4)}`;
}

/** "2026-09-24" → "Gio 24/09/2026". */
export function formatDateWithWeekday(date: ISODate): string {
  return `${WEEKDAY_SHORT[weekdayOf(date)]} ${formatDateIT(date)}`;
}

// ---------------------------------------------------------------------------
// "Adesso" in Europe/Rome
// ---------------------------------------------------------------------------

const romeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Data e minuto correnti nel fuso Europe/Rome, indipendentemente dal TZ del server. */
export function nowInRome(now: Date = new Date()): { date: ISODate; minutes: number } {
  const parts = Object.fromEntries(
    romeFormatter.formatToParts(now).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return {
    date: makeISODate(Number(parts.year), Number(parts.month), Number(parts.day)),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function todayInRome(now: Date = new Date()): ISODate {
  return nowInRome(now).date;
}
