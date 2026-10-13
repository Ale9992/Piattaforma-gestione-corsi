import { addDays, makeISODate, parseISODate, type ISODate } from "@/lib/dates";

export interface Holiday {
  date: ISODate;
  name: string;
}

/**
 * Domenica di Pasqua (calendario gregoriano), algoritmo anonimo
 * di Meeus/Jones/Butcher.
 */
export function easterSunday(year: number): ISODate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return makeISODate(year, month, day);
}

/**
 * Festività nazionali italiane (L. 260/1949 e successive modifiche).
 * Il 4 ottobre (San Francesco d'Assisi) è festa nazionale dal 2026 (L. 151/2025).
 * Le feste patronali locali non sono nazionali e non sono incluse.
 */
export function getItalianHolidays(year: number): Holiday[] {
  const fixed = (month: number, day: number, name: string): Holiday => ({
    date: makeISODate(year, month, day),
    name,
  });
  const easter = easterSunday(year);

  const holidays: Holiday[] = [
    fixed(1, 1, "Capodanno"),
    fixed(1, 6, "Epifania"),
    { date: easter, name: "Pasqua" },
    { date: addDays(easter, 1), name: "Lunedì dell'Angelo" },
    fixed(4, 25, "Festa della Liberazione"),
    fixed(5, 1, "Festa dei Lavoratori"),
    fixed(6, 2, "Festa della Repubblica"),
    fixed(8, 15, "Ferragosto"),
    fixed(11, 1, "Ognissanti"),
    fixed(12, 8, "Immacolata Concezione"),
    fixed(12, 25, "Natale"),
    fixed(12, 26, "Santo Stefano"),
  ];
  if (year >= 2026) {
    holidays.push(fixed(10, 4, "San Francesco d'Assisi"));
  }
  return holidays.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}

const cache = new Map<number, Map<ISODate, string>>();

function holidaysByDate(year: number): Map<ISODate, string> {
  let map = cache.get(year);
  if (!map) {
    map = new Map(getItalianHolidays(year).map((h) => [h.date, h.name]));
    cache.set(year, map);
  }
  return map;
}

/** Nome della festività nazionale, oppure `null` se `date` non è festiva. */
export function getHolidayName(date: ISODate): string | null {
  return holidaysByDate(parseISODate(date).year).get(date) ?? null;
}

export function isItalianHoliday(date: ISODate): boolean {
  return getHolidayName(date) !== null;
}
