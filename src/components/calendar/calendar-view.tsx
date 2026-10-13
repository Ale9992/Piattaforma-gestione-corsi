"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangleIcon, ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon } from "lucide-react";
import { ConflictMark, LessonStatusMark } from "@/components/common";
import { AppointmentForm } from "@/components/calendar/appointment-dialog";
import { LessonEditDialog, LessonStatusActions } from "@/components/course/lesson-controls";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  addDays,
  addMonths,
  eachDay,
  formatDateWithWeekday,
  formatDuration,
  formatTime,
  formatTimeRange,
  MONTH_NAMES,
  parseISODate,
  WEEKDAY_SHORT,
  weekdayOf,
  type ISODate,
} from "@/lib/dates";
import { courseColor } from "@/lib/format";
import { getHolidayName } from "@/lib/scheduling/holidays";
import { cn } from "@/lib/utils";
import type { CalendarEventView } from "@/server/queries";

export type CalendarMode = "week" | "month";

interface Props {
  view: CalendarMode;
  anchor: ISODate;
  today: ISODate;
  from: ISODate;
  to: ISODate;
  events: CalendarEventView[];
}

const PX_PER_MIN = 0.8;

function href(view: CalendarMode, date: ISODate) {
  return `/calendario?view=${view}&date=${date}`;
}

function title(view: CalendarMode, anchor: ISODate, from: ISODate, to: ISODate) {
  const { year, month } = parseISODate(anchor);
  if (view === "month") return `${MONTH_NAMES[month - 1]} ${year}`;
  const a = parseISODate(from);
  const b = parseISODate(to);
  return a.month === b.month
    ? `${a.day}–${b.day} ${MONTH_NAMES[b.month - 1]} ${b.year}`
    : `${a.day} ${MONTH_NAMES[a.month - 1].slice(0, 3)} – ${b.day} ${MONTH_NAMES[b.month - 1].slice(0, 3)} ${b.year}`;
}

export function CalendarView({ view, anchor, today, from, to, events }: Props) {
  const [selected, setSelected] = useState<CalendarEventView | null>(null);
  const [editing, setEditing] = useState(false);

  const byDate = useMemo(() => {
    const map = new Map<ISODate, CalendarEventView[]>();
    for (const e of events) {
      const list = map.get(e.date);
      if (list) list.push(e);
      else map.set(e.date, [e]);
    }
    return map;
  }, [events]);

  const legend = useMemo(() => {
    const seen = new Map<number, string>();
    for (const e of events) seen.set(e.courseId, e.courseName);
    return [...seen.entries()];
  }, [events]);

  const step = (dir: 1 | -1) => (view === "week" ? addDays(anchor, 7 * dir) : addMonths(anchor, dir));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h2 className="mr-2 text-lg font-semibold sm:text-xl">{title(view, anchor, from, to)}</h2>
          <Link
            href={href(view, step(-1))}
            className="inline-flex size-[30px] items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Periodo precedente"
          >
            <ChevronLeftIcon className="size-4" />
          </Link>
          <Link
            href={href(view, today)}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-[30px]")}
          >
            Oggi
          </Link>
          <Link
            href={href(view, step(1))}
            className="inline-flex size-[30px] items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Periodo successivo"
          >
            <ChevronRightIcon className="size-4" />
          </Link>
        </div>
        <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
          {(["week", "month"] as const).map((v) => (
            <Link
              key={v}
              href={href(v, anchor)}
              className={cn(
                "rounded-md px-3 py-1 text-xs transition-colors",
                v === view ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "week" ? "Settimana" : "Mese"}
            </Link>
          ))}
        </div>
      </div>

      {view === "week" ? (
        <WeekGrid days={eachDay(from, to)} byDate={byDate} today={today} onSelect={setSelected} />
      ) : (
        <MonthGrid anchor={anchor} days={eachDay(from, to)} byDate={byDate} today={today} onSelect={setSelected} />
      )}

      {legend.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {legend.map(([id, name]) => (
            <li key={id} className="flex items-center gap-1.5">
              <span className={cn("size-2.5 rounded-full", courseColor(id).dot)} />
              <Link href={`/corsi/${id}`} className="hover:underline">
                {name}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <Dialog open={selected !== null && !editing} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="sm:max-w-md">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className={cn("size-3 rounded-full", courseColor(selected.courseId).dot)} />
                  {selected.courseName}
                </DialogTitle>
                <DialogDescription>
                  {selected.kind === "PRE_LESSON" ? "Prelezione · " : selected.kind === "APPOINTMENT" ? "Impegno · " : "Lezione · "}
                  {formatDateWithWeekday(selected.date)} · {formatTimeRange(selected.startMin, selected.endMin)} (
                  {formatDuration(selected.endMin - selected.startMin)})
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {selected.clientCompany ? <span>{selected.clientCompany}</span> : null}
                {selected.status && selected.status !== "PLANNED" ? (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <LessonStatusMark status={selected.status} />
                    {selected.status === "COMPLETED" ? "Svolta" : "Annullata"}
                  </span>
                ) : null}
                {selected.hasConflict ? (
                  <span className="flex items-center gap-1.5 text-warn">
                    <ConflictMark /> Sovrapposizione
                  </span>
                ) : null}
              </div>
              {selected.kind === "APPOINTMENT" ? (
                <AppointmentForm
                  key={selected.id}
                  appointment={{
                    id: selected.id,
                    title: selected.courseName,
                    date: selected.date,
                    startMin: selected.startMin,
                    endMin: selected.endMin,
                  }}
                  onDone={() => setSelected(null)}
                />
              ) : null}
              <div className="flex flex-wrap gap-2">
                {selected.kind === "LESSON" && selected.status ? (
                  <>
                    <LessonStatusActions
                      touch
                      lesson={{ ...selected, status: selected.status }}
                      onDone={() => setSelected(null)}
                    />
                    <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                      Modifica lezione
                    </Button>
                  </>
                ) : null}
                {selected.kind === "APPOINTMENT" ? null : (
                  <Link href={`/corsi/${selected.courseId}`} className={buttonVariants({ size: "sm" })}>
                    <ExternalLinkIcon /> Apri corso
                  </Link>
                )}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {selected?.kind === "LESSON" && selected.status ? (
        <LessonEditDialog
          lesson={{ ...selected, status: selected.status }}
          open={editing}
          onOpenChange={(o) => {
            setEditing(o);
            if (!o) setSelected(null);
          }}
          onSaved={() => {
            setEditing(false);
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}

function EventChip({ event, onSelect, compact }: { event: CalendarEventView; onSelect: (e: CalendarEventView) => void; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      className={cn(
        "flex w-full items-center gap-1 truncate rounded border-l-4 px-1 py-0.5 text-left text-xs",
        courseColor(event.courseId).event,
        event.status === "CANCELLED" && "line-through opacity-50",
        event.kind === "PRE_LESSON" && "border-dashed",
      )}
      title={`${event.courseName} ${formatTimeRange(event.startMin, event.endMin)}`}
    >
      {event.hasConflict ? <AlertTriangleIcon className="size-3 shrink-0 text-amber-700" /> : null}
      <span className="tabular-nums">{formatTime(event.startMin)}</span>
      {!compact ? (
        <span className="truncate font-medium">
          {event.kind === "PRE_LESSON" ? "Pre · " : ""}
          {event.courseName}
        </span>
      ) : null}
    </button>
  );
}

/** Colonne affiancate per eventi sovrapposti nello stesso giorno. */
function layoutDay(events: CalendarEventView[]) {
  const sorted = [...events].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const placed: { event: CalendarEventView; lane: number; lanes: number }[] = [];
  let cluster: typeof placed = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((p) => p.lane + 1));
    for (const p of cluster) p.lanes = lanes;
    placed.push(...cluster);
    cluster = [];
  };
  for (const event of sorted) {
    if (event.startMin >= clusterEnd && cluster.length > 0) flush();
    const used = new Set(cluster.filter((p) => p.event.endMin > event.startMin).map((p) => p.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    cluster.push({ event, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, event.endMin);
  }
  flush();
  return placed;
}

function WeekGrid({
  days,
  byDate,
  today,
  onSelect,
}: {
  days: ISODate[];
  byDate: Map<ISODate, CalendarEventView[]>;
  today: ISODate;
  onSelect: (e: CalendarEventView) => void;
}) {
  const all = days.flatMap((d) => byDate.get(d) ?? []);
  const startHour = Math.min(8, ...all.map((e) => Math.floor(e.startMin / 60)));
  const endHour = Math.max(22, ...all.map((e) => Math.ceil(e.endMin / 60)));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const height = (endHour - startHour) * 60 * PX_PER_MIN;

  return (
    <>
      {/* Desktop/iPad: griglia oraria */}
      <div className="hidden overflow-x-auto rounded-xl border bg-background md:block">
        <div className="grid min-w-[760px] grid-cols-[3rem_repeat(7,minmax(0,1fr))]">
          <div className="border-b" />
          {days.map((d) => {
            const holiday = getHolidayName(d);
            return (
              <div key={d} className={cn("border-b border-l px-1 py-1.5 text-center text-xs", d === today && "bg-sky-50")}>
                <div className={cn("font-medium", d === today && "text-sky-700")}>
                  {WEEKDAY_SHORT[weekdayOf(d)]} {parseISODate(d).day}
                </div>
                {holiday ? <div className="truncate text-[10px] text-rose-700">{holiday}</div> : null}
              </div>
            );
          })}
          <div className="relative" style={{ height }}>
            {hours.map((h) => (
              <div
                key={h}
                className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
                style={{ top: (h - startHour) * 60 * PX_PER_MIN }}
              >
                {h > startHour ? `${String(h).padStart(2, "0")}:00` : ""}
              </div>
            ))}
          </div>
          {days.map((d) => (
            <div
              key={d}
              className={cn(
                "relative border-l",
                (weekdayOf(d) === 7 || getHolidayName(d)) && "bg-muted/50",
                d === today && "bg-sky-50/40",
              )}
              style={{ height }}
            >
              {hours.map((h) => (
                <div
                  key={h}
                  className="absolute inset-x-0 border-t border-hairline"
                  style={{ top: (h - startHour) * 60 * PX_PER_MIN }}
                />
              ))}
              {layoutDay(byDate.get(d) ?? []).map(({ event, lane, lanes }) => (
                <button
                  key={event.key}
                  type="button"
                  onClick={() => onSelect(event)}
                  className={cn(
                    "absolute overflow-hidden rounded border-l-4 px-1 py-0.5 text-left text-[11px] leading-tight shadow-sm hover:z-10 hover:shadow",
                    courseColor(event.courseId).event,
                    event.status === "CANCELLED" && "line-through opacity-50",
                    event.kind === "PRE_LESSON" && "border-dashed",
                    event.hasConflict && "ring-2 ring-amber-500",
                  )}
                  style={{
                    top: (event.startMin - startHour * 60) * PX_PER_MIN,
                    height: Math.max(18, (event.endMin - event.startMin) * PX_PER_MIN - 2),
                    left: `calc(${(lane / lanes) * 100}% + 2px)`,
                    width: `calc(${100 / lanes}% - 4px)`,
                  }}
                >
                  <div className="tabular-nums">{formatTimeRange(event.startMin, event.endMin)}</div>
                  <div className="truncate font-medium">
                    {event.kind === "PRE_LESSON" ? "Prelezione · " : ""}
                    {event.courseName}
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Mobile: agenda della settimana */}
      <ul className="space-y-2 md:hidden">
        {days.map((d) => {
          const list = byDate.get(d) ?? [];
          const holiday = getHolidayName(d);
          return (
            <li key={d} className={cn("rounded-lg border bg-background p-2", d === today && "border-sky-400")}>
              <div className="mb-1 flex items-center justify-between text-sm font-medium">
                {formatDateWithWeekday(d)}
                {holiday ? <span className="text-xs font-normal text-rose-700">{holiday}</span> : null}
              </div>
              {list.length === 0 ? (
                <div className="text-xs text-muted-foreground">Nessun evento</div>
              ) : (
                <div className="space-y-1">
                  {list.map((e) => (
                    <EventChip key={e.key} event={e} onSelect={onSelect} />
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function MonthGrid({
  anchor,
  days,
  byDate,
  today,
  onSelect,
}: {
  anchor: ISODate;
  days: ISODate[];
  byDate: Map<ISODate, CalendarEventView[]>;
  today: ISODate;
  onSelect: (e: CalendarEventView) => void;
}) {
  const month = parseISODate(anchor).month;
  const initial = days.find((d) => d === today && parseISODate(d).month === month) ?? anchor;
  const [selectedDay, setSelectedDay] = useState<ISODate>(initial);
  const dayEvents = byDate.get(selectedDay) ?? [];

  return (
    <>
      <div className="overflow-hidden rounded-xl border bg-background">
        <div className="grid grid-cols-7 border-b text-center text-xs font-medium text-muted-foreground">
          {[1, 2, 3, 4, 5, 6, 7].map((w) => (
            <div key={w} className="py-1.5">
              {WEEKDAY_SHORT[w as 1]}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const list = byDate.get(d) ?? [];
            const inMonth = parseISODate(d).month === month;
            const holiday = getHolidayName(d);
            return (
              <div
                key={d}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedDay(d)}
                onKeyDown={(e) => e.key === "Enter" && setSelectedDay(d)}
                className={cn(
                  "min-h-14 cursor-pointer border-b border-l p-1 first:border-l-0 md:min-h-24 [&:nth-child(7n+1)]:border-l-0",
                  !inMonth && "bg-muted/40 text-muted-foreground",
                  (weekdayOf(d) === 7 || holiday) && inMonth && "bg-muted/30",
                  d === selectedDay && "ring-2 ring-inset ring-primary/40 md:ring-0",
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
                      d === today && "bg-sky-600 font-semibold text-white",
                    )}
                  >
                    {parseISODate(d).day}
                  </span>
                  {holiday ? <span className="hidden truncate text-[10px] text-rose-700 md:inline">{holiday}</span> : null}
                </div>
                {/* Desktop: chip */}
                <div className="mt-0.5 hidden space-y-0.5 md:block">
                  {list.slice(0, 4).map((e) => (
                    <EventChip key={e.key} event={e} onSelect={onSelect} />
                  ))}
                  {list.length > 4 ? <div className="text-[10px] text-muted-foreground">+{list.length - 4} altri</div> : null}
                </div>
                {/* Mobile: pallini */}
                <div className="mt-1 flex flex-wrap gap-0.5 md:hidden">
                  {list.slice(0, 6).map((e) => (
                    <span
                      key={e.key}
                      className={cn("size-1.5 rounded-full", courseColor(e.courseId).dot, e.status === "CANCELLED" && "opacity-30")}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile: eventi del giorno selezionato */}
      <div className="rounded-lg border bg-background p-2 md:hidden">
        <div className="mb-1 text-sm font-medium">
          {formatDateWithWeekday(selectedDay)}
          {getHolidayName(selectedDay) ? (
            <span className="ml-2 text-xs font-normal text-rose-700">{getHolidayName(selectedDay)}</span>
          ) : null}
        </div>
        {dayEvents.length === 0 ? (
          <div className="text-xs text-muted-foreground">Nessun evento</div>
        ) : (
          <div className="space-y-1">
            {dayEvents.map((e) => (
              <EventChip key={e.key} event={e} onSelect={onSelect} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
