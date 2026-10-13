import { connection } from "next/server";
import { AvailabilityView, type AvailabilityEvent } from "@/components/availability/availability-view";
import { PageHeader } from "@/components/common";
import { agencyName } from "@/lib/agency";
import { addDays, endOfMonth, isValidISODate, nowInRome, startOfMonth } from "@/lib/dates";
import { getCalendarEvents } from "@/server/queries";

export const metadata = { title: "Disponibilità" };

export default async function AvailabilityPage({ searchParams }: PageProps<"/disponibilita">) {
  await connection();
  const params = await searchParams;
  const now = nowInRome();
  const agency = agencyName();

  // Periodo: il mese in corso (predefinito) oppure una o due settimane.
  const ancora = typeof params.from === "string" && isValidISODate(params.from) ? params.from : now.date;
  const weeksParam = Number(params.weeks);
  const weeks = [1, 2, 4, 8].includes(weeksParam) ? weeksParam : null;
  const durationParam = Number(params.durata);
  const duration = Number.isInteger(durationParam) && durationParam >= 15 && durationParam <= 780 ? durationParam : 120;

  // Il mese si vede intero, dal primo all'ultimo giorno: i giorni già passati
  // restano visibili ma senza slot liberi.
  const from = weeks ? ancora : startOfMonth(ancora);
  const to = weeks ? addDays(from, weeks * 7 - 1) : endOfMonth(ancora);

  // Disponibilità derivata esclusivamente da lezioni (non annullate) e prelezioni.
  const events: AvailabilityEvent[] = getCalendarEvents(from, to).map((e) => ({
    kind: e.kind,
    id: e.id,
    courseId: e.courseId,
    courseName: e.courseName,
    date: e.date,
    startMin: e.startMin,
    endMin: e.endMin,
  }));

  return (
    <>
      <PageHeader
        title="Disponibilità"
        description={`Slot liberi da comunicare${agency ? ` a ${agency}` : ""}, calcolati dagli intervalli realmente liberi tra lezioni e prelezioni.`}
      />
      <AvailabilityView
        key={`${from}-${weeks ?? "mese"}`}
        from={from}
        to={to}
        weeks={weeks}
        anchor={ancora}
        initialDuration={duration}
        now={now}
        events={events}
      />
    </>
  );
}
