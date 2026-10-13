import "server-only";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { getDb, type DB, type Executor } from "@/db";
import { appointments } from "@/db/schema";
import { isValidISODate, type ISODate } from "@/lib/dates";
import { DomainError } from "./course-service";

/**
 * Impegni a calendario che non appartengono a nessun corso.
 *
 * Il caso concreto è l'incontro preliminare: l'agenzia lo fissa prima che il
 * corso esista, quindi non c'è un corso a cui appenderlo — ma occupa il tempo,
 * e deve comparire in calendario, togliere la fascia dalle disponibilità e
 * finire su iCloud come tutto il resto.
 */
export interface AppointmentInput {
  title: string;
  date: ISODate;
  startMin: number;
  endMin: number;
  notes?: string;
}

function assertInput(input: AppointmentInput): void {
  if (!input.title.trim()) throw new DomainError("L'impegno ha bisogno di un titolo.");
  if (!isValidISODate(input.date)) throw new DomainError("Data dell'impegno non valida.");
  if (!(input.startMin >= 0 && input.endMin > input.startMin && input.endMin <= 1440)) {
    throw new DomainError("L'orario dell'impegno non è valido: la fine deve seguire l'inizio.");
  }
}

const now = () => new Date().toISOString();

export function createAppointment(db: DB, input: AppointmentInput): number {
  assertInput(input);
  return db
    .insert(appointments)
    .values({
      title: input.title.trim(),
      date: input.date,
      startMin: input.startMin,
      endMin: input.endMin,
      notes: (input.notes ?? "").trim(),
    })
    .returning({ id: appointments.id })
    .get().id;
}

export function updateAppointment(db: DB, id: number, input: AppointmentInput): void {
  assertInput(input);
  const esito = db
    .update(appointments)
    .set({
      title: input.title.trim(),
      date: input.date,
      startMin: input.startMin,
      endMin: input.endMin,
      notes: (input.notes ?? "").trim(),
      updatedAt: now(),
    })
    .where(eq(appointments.id, id))
    .run();
  if (esito.changes === 0) throw new DomainError("Impegno non trovato.");
}

export function deleteAppointment(db: DB, id: number): void {
  const esito = db.delete(appointments).where(eq(appointments.id, id)).run();
  if (esito.changes === 0) throw new DomainError("Impegno non trovato.");
}

export function listAppointments(
  ex: Executor = getDb(),
  range?: { from?: ISODate; to?: ISODate },
) {
  return ex
    .select()
    .from(appointments)
    .where(
      and(
        range?.from ? gte(appointments.date, range.from) : undefined,
        range?.to ? lte(appointments.date, range.to) : undefined,
      ),
    )
    .orderBy(asc(appointments.date), asc(appointments.startMin))
    .all();
}
