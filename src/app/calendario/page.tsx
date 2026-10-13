import { connection } from "next/server";
import { AppleSyncButton } from "@/components/calendar/apple-sync";
import { CalendarView, type CalendarMode } from "@/components/calendar/calendar-view";
import { PageHeader } from "@/components/common";
import { addDays, endOfMonth, isValidISODate, startOfMonth, startOfWeek, todayInRome } from "@/lib/dates";
import { readSyncConfig } from "@/server/calendar-sync";
import { getCalendarEvents } from "@/server/queries";

export const metadata = { title: "Calendario" };

export default async function CalendarPage({ searchParams }: PageProps<"/calendario">) {
  await connection();
  const params = await searchParams;
  const today = todayInRome();
  const view: CalendarMode = params.view === "month" ? "month" : "week";
  const anchor = typeof params.date === "string" && isValidISODate(params.date) ? params.date : today;

  const from = view === "week" ? startOfWeek(anchor) : startOfWeek(startOfMonth(anchor));
  const to = view === "week" ? addDays(from, 6) : addDays(startOfWeek(endOfMonth(anchor)), 6);
  const events = getCalendarEvents(from, to, { includeCancelled: true });

  return (
    <>
      <PageHeader
        title="Calendario"
        description="Lezioni e prelezioni di tutti i corsi. Tocca un evento per aprire il corso o modificare la lezione."
        actions={<AppleSyncButton calendarName={readSyncConfig()?.calendarName ?? "Casa"} />}
      />
      <CalendarView view={view} anchor={anchor} today={today} from={from} to={to} events={events} />
    </>
  );
}
