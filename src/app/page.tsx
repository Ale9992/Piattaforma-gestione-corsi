import Link from "next/link";
import { connection } from "next/server";
import { InboxIcon, PlusIcon, VideoIcon } from "lucide-react";
import {
  ConflictMark,
  CourseStatusBadge,
  EmptyState,
  IconLink,
  LessonStatusMark,
  NoticeRow,
  PageHeader,
  ProgressBar,
  Section,
  StatCards,
} from "@/components/common";
import { SystemStatus } from "@/components/dashboard/system-status";
import { UnmarkedLessons } from "@/components/dashboard/unmarked-lessons";
import { buttonVariants } from "@/components/ui/button";
import {
  formatDateIT,
  formatDateWithWeekday,
  formatHours,
  formatTimeRange,
  todayInRome,
  WEEKDAY_NAMES,
  weekdayOf,
  type ISODate,
} from "@/lib/dates";
import { courseColor, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { countPendingMail } from "@/server/mail-service";
import { getSystemStatus } from "@/server/system-status";
import { getDashboardData, type CalendarEventView, type CourseListItem } from "@/server/queries";

/** Titolo del gruppo giorno: "Oggi", "Domani", poi "Giovedì 17/09". */
function dayLabel(date: ISODate, today: ISODate): string {
  if (date === today) return "Oggi";
  const days = (Date.parse(date) - Date.parse(today)) / 86_400_000;
  if (days === 1) return "Domani";
  return `${WEEKDAY_NAMES[weekdayOf(date)]} ${formatDateIT(date).slice(0, 5)}`;
}

function AgendaRow({ event, today }: { event: CalendarEventView; today: ISODate }) {
  const done = event.status === "COMPLETED";
  const cancelled = event.status === "CANCELLED";
  // Il collegamento serve il giorno stesso: sulle lezioni di domani in poi
  // sarebbe solo un'icona in più da ignorare.
  const teams = event.date === today && !cancelled ? event.teams : "";
  return (
    <li className="hairline flex items-center gap-2">
      <Link
        href={`/corsi/${event.courseId}`}
        className="flex min-w-0 flex-1 items-center gap-3 py-2 transition-colors hover:bg-muted/50"
      >
        <span className="tabular w-[92px] shrink-0 text-[13px] text-muted-foreground">
          {formatTimeRange(event.startMin, event.endMin)}
        </span>
        <span className={cn("h-7 w-[3px] shrink-0 rounded-full", courseColor(event.courseId).dot)} />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-sm",
              (done || cancelled) && "text-muted-foreground",
              cancelled && "line-through",
            )}
          >
            {event.courseName}
          </span>
          {event.kind === "PRE_LESSON" ? (
            <span className="text-xs text-pre">Prelezione</span>
          ) : event.clientCompany ? (
            <span className="text-xs text-muted-foreground">{event.clientCompany}</span>
          ) : null}
        </span>
        {event.hasConflict ? <ConflictMark /> : null}
        {event.status ? <LessonStatusMark status={event.status} /> : null}
      </Link>
      {teams ? (
        <IconLink label="Entra nella riunione" href={teams} tone="accent">
          <VideoIcon className="size-4" />
        </IconLink>
      ) : null}
    </li>
  );
}

export default async function DashboardPage() {
  await connection();
  const today = todayInRome();
  const data = getDashboardData(today);
  const postaInAttesa = countPendingMail();
  const statoSistema = getSystemStatus();

  // Agenda unica: oggi e i giorni successivi, raggruppati per data.
  const agenda = [...data.todayEvents, ...data.upcoming];
  const days = [...new Set(agenda.map((e) => e.date))].sort();
  const todayMinutes = data.todayEvents
    .filter((e) => e.kind === "LESSON" && e.status !== "CANCELLED")
    .reduce((sum, e) => sum + e.endMin - e.startMin, 0);
  const nextStart = data.notStarted
    .map((c) => c.startDate)
    .sort()
    .at(0);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={formatDateWithWeekday(today)}
        actions={
          <Link href="/corsi/nuovo" className={buttonVariants({ size: "lg" })}>
            <PlusIcon /> Nuovo corso
          </Link>
        }
      />

      {data.conflictCount > 0 || data.unscheduled.length > 0 ? (
        <div className="mb-5 space-y-px">
          {data.conflictCount > 0 ? (
            <NoticeRow
              action={
                <Link href="/calendario" className="text-[13px] font-medium text-accent-ink hover:underline">
                  Vedi nel calendario
                </Link>
              }
            >
              {plural(data.conflictCount, "sovrapposizione", "sovrapposizioni")} fra corsi:{" "}
              {data.conflicts.slice(0, 2).map((c) => c.a.courseName).join(", ")}
              {data.conflicts.length > 2 ? "…" : ""}
            </NoticeRow>
          ) : null}
          {data.unscheduled.map((c) => (
            <NoticeRow
              key={c.id}
              action={
                <Link href={`/corsi/${c.id}`} className="text-[13px] font-medium text-accent-ink hover:underline">
                  Apri corso
                </Link>
              }
            >
              <strong className="font-medium">{c.name}</strong>: {formatHours(c.progress.unscheduledMinutes)} ore non
              calendarizzate.
            </NoticeRow>
          ))}
        </div>
      ) : null}

      {data.unmarked.length > 0 ? (
        <div className="mb-5">
          <UnmarkedLessons lessons={data.unmarked} />
        </div>
      ) : null}

      <StatCards
        items={[
          {
            label: "Oggi",
            value: String(data.todayEvents.filter((e) => e.kind === "LESSON").length),
            hint: todayMinutes > 0 ? `${formatHours(todayMinutes)} ore di lezione` : "niente in programma",
            accent: todayMinutes > 0,
          },
          {
            label: "Questa settimana",
            value: `${formatHours(data.weekMinutes)} h`,
            hint: `${formatHours(data.weekDoneMinutes)} svolte · ${formatHours(
              data.weekMinutes - data.weekDoneMinutes,
            )} da svolgere`,
          },
          {
            label: "Corsi attivi",
            value: String(data.inProgress.length + data.notStarted.length),
            hint: `${data.inProgress.length} in corso · ${formatHours(
              data.inProgress.reduce((s, c) => s + c.progress.toDoMinutes, 0),
            )} h residue`,
            href: "/corsi",
          },
          {
            label: "Archivio",
            value: String(data.archive.courses),
            hint: `${formatHours(data.archive.minutes)} ore insegnate`,
            href: "/archivio",
          },
        ]}
      />

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Section
          // Senza min-w-0 la colonna della griglia si allarga sul testo lungo delle lezioni.
          className="min-w-0"
          title="Agenda"
          actions={
            <Link href="/calendario" className="text-[13px] text-accent-ink hover:underline">
              Calendario completo
            </Link>
          }
        >
          {agenda.length === 0 ? (
            <EmptyState>Nessuna lezione in programma.</EmptyState>
          ) : (
            days.map((date) => (
              <div key={date}>
                <div className={cn("label-group pb-1 pt-3.5", date === today && "text-foreground")}>
                  {dayLabel(date, today)}
                </div>
                <ul>
                  {agenda
                    .filter((e) => e.date === date)
                    .map((event) => (
                      <AgendaRow key={event.key} event={event} today={today} />
                    ))}
                </ul>
              </div>
            ))
          )}
        </Section>

        <div className="flex min-w-0 flex-col gap-6">
          <Section title="In corso" actions={<span className="tabular text-xs text-muted-foreground">{data.inProgress.length}</span>}>
            {data.inProgress.length === 0 ? (
              <EmptyState>Nessun corso in corso.</EmptyState>
            ) : (
              <div className="flex flex-col gap-2 pt-1">
                {data.inProgress.map((course) => (
                  <ActiveCourseCard key={course.id} course={course} />
                ))}
              </div>
            )}
          </Section>

          {postaInAttesa > 0 ? (
            <Link
              href="/posta"
              className="flex items-center gap-3 rounded-xl border bg-card px-3.5 py-3 transition-colors hover:border-input"
            >
              <InboxIcon className="size-[18px] shrink-0 text-accent-ink" />
              <span className="min-w-0 flex-1 text-sm">
                <strong className="font-medium">{postaInAttesa}</strong> mail da confermare
              </span>
              <span className="text-[13px] text-accent-ink">Apri</span>
            </Link>
          ) : null}

          <Section
            title="Da iniziare"
            actions={
              <span className="tabular text-xs text-muted-foreground">
                {data.notStarted.length}
                {nextStart ? ` · il primo il ${formatDateIT(nextStart).slice(0, 5)}` : ""}
              </span>
            }
          >
            {data.notStarted.length === 0 ? (
              <EmptyState>Nessun corso da iniziare.</EmptyState>
            ) : (
              <ul>
                {data.notStarted.map((course) => (
                  <li key={course.id} className="hairline">
                    <Link
                      href={`/corsi/${course.id}`}
                      className="flex items-center gap-2.5 py-2 transition-colors hover:bg-muted/50"
                    >
                      <span className={cn("h-4 w-[3px] shrink-0 rounded-full", courseColor(course.id).dot)} />
                      <span className="min-w-0 flex-1 truncate text-sm">{course.name}</span>
                      <span className="tabular text-xs text-muted-foreground">
                        {formatHours(course.progress.totalMinutes)} h
                      </span>
                      <span className="tabular w-14 text-right text-xs text-muted-foreground">
                        {formatDateIT(course.startDate).slice(0, 5)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      <SystemStatus rows={statoSistema} />
    </>
  );
}

function ActiveCourseCard({ course }: { course: CourseListItem }) {
  const color = courseColor(course.id);
  return (
    <Link
      href={`/corsi/${course.id}`}
      className="flex flex-col gap-2 rounded-xl border bg-card p-3 transition-colors hover:border-input"
    >
      <div className="flex items-center gap-2.5">
        <span className={cn("h-4 w-[3px] shrink-0 rounded-full", color.dot)} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{course.name}</span>
        <span className="tabular text-xs text-muted-foreground">
          {formatHours(course.progress.completedMinutes)} / {formatHours(course.progress.totalMinutes)} h
        </span>
      </div>
      <ProgressBar
        total={course.progress.totalMinutes}
        completed={course.progress.completedMinutes}
        planned={course.progress.plannedMinutes}
        fill={color.fill}
      />
      <div className="tabular flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {course.nextLessonDate ? `prossima ${formatDateIT(course.nextLessonDate)}` : "nessuna lezione futura"}
        </span>
        <span className="flex items-center gap-2">
          fine {formatDateIT(course.expectedEndDate)}
          <CourseStatusBadge status={course.status} className="hidden sm:inline-flex" />
        </span>
      </div>
    </Link>
  );
}
