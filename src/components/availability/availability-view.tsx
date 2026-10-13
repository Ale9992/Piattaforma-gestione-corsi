"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  addDays,
  addMonths,
  eachDay,
  formatDateIT,
  formatDuration,
  formatTime,
  formatTimeRange,
  isValidTime,
  parseISODate,
  parseTime,
  MONTH_NAMES,
  startOfWeek,
  WEEKDAY_NAMES,
  WEEKDAY_SHORT,
  weekdayOf,
  type ISODate,
} from "@/lib/dates";
import { courseColor } from "@/lib/format";
import { computeAvailability, SLOT_DURATION_PRESETS, type DayAvailability } from "@/lib/scheduling/availability";
import type { BusyEvent } from "@/lib/scheduling/conflicts";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

export interface AvailabilityEvent extends BusyEvent {
  courseName: string;
}

interface Props {
  from: ISODate;
  to: ISODate;
  /** Numero di settimane, oppure null quando si guarda il mese intero. */
  weeks: number | null;
  /** Giorno di riferimento per muoversi fra i mesi. */
  anchor: ISODate;
  initialDuration: number;
  now: { date: ISODate; minutes: number };
  events: AvailabilityEvent[];
}

const PX_PER_MIN = 0.72;

export function AvailabilityView({ from, to, weeks, anchor, initialDuration, now, events }: Props) {
  const mese = weeks === null;
  const [duration, setDuration] = useState(initialDuration);
  const [custom, setCustom] = useState(formatTime(initialDuration));

  const courseNames = useMemo(() => new Map(events.map((e) => [e.courseId, e.courseName])), [events]);
  const days = useMemo(
    () => computeAvailability({ from, to, durationMin: duration, events, notBefore: now }),
    [from, to, duration, events, now],
  );
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const totalSlots = days.reduce((s, d) => s + d.slots.length, 0);

  // Righe della griglia: dall'ora più mattutina alla più tarda del periodo.
  const [dayStart, dayEnd] = useMemo(() => {
    const starts = days.flatMap((d) => [d.window?.startMin, ...d.busy.map((b) => b.startMin)]).filter(Boolean) as number[];
    const ends = days.flatMap((d) => [d.window?.endMin, ...d.busy.map((b) => b.endMin)]).filter(Boolean) as number[];
    return [Math.min(9 * 60, ...starts), Math.max(22 * 60, ...ends)];
  }, [days]);
  const gridHeight = (dayEnd - dayStart) * PX_PER_MIN;
  const hours = Array.from({ length: Math.ceil((dayEnd - dayStart) / 120) + 1 }, (_, i) => dayStart + i * 120).filter(
    (m) => m <= dayEnd,
  );

  const weekStarts = useMemo(
    () => [...new Set(eachDay(from, to).map((d) => startOfWeek(d)))],
    [from, to],
  );

  const nav = (params: { from?: string; weeks?: number | null; duration?: number }) => {
    const settimane = params.weeks === undefined ? weeks : params.weeks;
    const query = new URLSearchParams({
      from: params.from ?? (mese ? anchor : from),
      durata: String(params.duration ?? duration),
    });
    if (settimane !== null) query.set("weeks", String(settimane));
    return `/disponibilita?${query}`;
  };

  function selectDuration(minutes: number) {
    setDuration(minutes);
    setCustom(formatTime(minutes));
    window.history.replaceState(null, "", nav({ duration: minutes }));
  }

  function copy() {
    const lines = days
      .filter((d) => d.slots.length > 0)
      .map((d) => `${WEEKDAY_SHORT[d.weekday]} ${formatDateIT(d.date)}: ${d.slots.map((s) => formatTimeRange(s.startMin, s.endMin)).join(", ")}`);
    const text = lines.length
      ? `Disponibilità (slot da ${formatDuration(duration)}):\n${lines.join("\n")}`
      : "Nessuna disponibilità nel periodo.";
    copyText(text).then(
      () => toast.success("Elenco slot copiato"),
      () => toast.error("Copia non riuscita"),
    );
  }

  return (
    <div className="space-y-4">
      {/* Controlli */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-y py-3">
        <div className="flex items-center gap-2.5">
          <span className="label-group">Durata</span>
          <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
            {SLOT_DURATION_PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => selectDuration(m)}
                aria-pressed={duration === m}
                className={cn(
                  "tabular rounded-md px-2.5 py-1 text-xs transition-colors",
                  duration === m ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {formatDuration(m)}
              </button>
            ))}
            <input
              aria-label="Durata personalizzata"
              type="time"
              step={300}
              className="tabular w-[72px] rounded-md bg-transparent px-1.5 text-xs text-muted-foreground outline-none"
              value={custom}
              onChange={(e) => {
                setCustom(e.target.value);
                if (isValidTime(e.target.value) && parseTime(e.target.value) >= 15) {
                  selectDuration(parseTime(e.target.value));
                }
              }}
            />
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <span className="label-group">Periodo</span>
          <div className="flex items-center gap-1">
            <Link
              href={nav({ from: mese ? addMonths(anchor, -1) : addDays(from, -7 * weeks!) })}
              aria-label="Periodo precedente"
              className="inline-flex size-7 items-center justify-center rounded-md border hover:bg-muted"
            >
              <ChevronLeftIcon className="size-4" />
            </Link>
            <span className="tabular px-1 text-[13px] font-medium">
              {mese
                ? `${MONTH_NAMES[Number(anchor.slice(5, 7)) - 1]} ${anchor.slice(0, 4)}`
                : `${formatDateIT(from).slice(0, 5)} – ${formatDateIT(to)}`}
            </span>
            <Link
              href={nav({ from: mese ? addMonths(anchor, 1) : addDays(from, 7 * weeks!) })}
              aria-label="Periodo successivo"
              className="inline-flex size-7 items-center justify-center rounded-md border hover:bg-muted"
            >
              <ChevronRightIcon className="size-4" />
            </Link>
          </div>
          <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
            {[1, 2].map((w) => (
              <Link
                key={w}
                href={nav({ weeks: w, from: from })}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs transition-colors",
                  weeks === w ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {w} sett.
              </Link>
            ))}
            <Link
              href={nav({ weeks: null, from: anchor })}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs transition-colors",
                mese ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Mese
            </Link>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-[13px]">
            <strong className="tabular text-base font-medium">{totalSlots}</strong> slot da {formatDuration(duration)}
          </span>
          <Button size="sm" variant="outline" onClick={copy}>
            <CopyIcon /> Copia per MAC
          </Button>
        </div>
      </div>

      {/* Mese intero in un'unica griglia, come un calendario da parete */}
      {mese ? (
        <div className="hidden md:block">
          <MonthGrid days={days} from={from} to={to} today={now.date} courseNames={courseNames} />
        </div>
      ) : null}

      {/* Settimane: griglia oraria, gli slot liberi sono i protagonisti */}
      <div className={cn("hidden space-y-5", mese ? "" : "md:block")}>
        {weekStarts.map((weekStart) => {
          const weekDays = eachDay(weekStart, addDays(weekStart, 6)).filter((d) => d >= from && d <= to);
          return (
            <div key={weekStart} className="overflow-hidden rounded-xl border bg-card">
              <div
                className="grid border-b"
                style={{ gridTemplateColumns: `52px repeat(${weekDays.length}, minmax(0, 1fr))` }}
              >
                <div />
                {weekDays.map((date) => {
                  const day = byDate.get(date);
                  return (
                    <div
                      key={date}
                      className={cn("border-l py-2 text-center", day?.window === null && "bg-muted/40")}
                    >
                      <div className="text-[13px] font-medium">{WEEKDAY_SHORT[weekdayOf(date)]}</div>
                      <div className="tabular text-[11px] text-muted-foreground">
                        {String(parseISODate(date).day).padStart(2, "0")}/
                        {String(parseISODate(date).month).padStart(2, "0")}
                      </div>
                      {day?.holiday ? (
                        <div className="truncate px-1 text-[10px] text-danger">{day.holiday}</div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div
                className="grid"
                style={{ gridTemplateColumns: `52px repeat(${weekDays.length}, minmax(0, 1fr))` }}
              >
                <div className="relative" style={{ height: gridHeight }}>
                  {hours.map((minute) => (
                    <span
                      key={minute}
                      className="tabular absolute right-2 -translate-y-1/2 text-[11px] text-muted-foreground"
                      style={{ top: (minute - dayStart) * PX_PER_MIN }}
                    >
                      {formatTime(minute)}
                    </span>
                  ))}
                </div>

                {weekDays.map((date) => {
                  const day = byDate.get(date);
                  return (
                    <div
                      key={date}
                      className={cn(
                        "relative border-l px-1",
                        day?.window === null &&
                          "bg-[repeating-linear-gradient(135deg,var(--muted)_0_6px,transparent_6px_12px)]",
                      )}
                      style={{ height: gridHeight }}
                    >
                      {hours.map((minute) => (
                        <span
                          key={minute}
                          className="absolute inset-x-0 border-t border-hairline"
                          style={{ top: (minute - dayStart) * PX_PER_MIN }}
                        />
                      ))}

                      {/* Fuori orario lavorativo: tratteggio (es. il sabato dopo le 13). */}
                      {day?.window && day.window.startMin > dayStart ? (
                        <span
                          className="absolute inset-x-0 top-0 bg-[repeating-linear-gradient(135deg,var(--muted)_0_6px,transparent_6px_12px)]"
                          style={{ height: (day.window.startMin - dayStart) * PX_PER_MIN }}
                        />
                      ) : null}
                      {day?.window && day.window.endMin < dayEnd ? (
                        <span
                          className="absolute inset-x-0 bottom-0 bg-[repeating-linear-gradient(135deg,var(--muted)_0_6px,transparent_6px_12px)]"
                          style={{ top: (day.window.endMin - dayStart) * PX_PER_MIN }}
                        />
                      ) : null}

                      {day?.slots.map((slot) => (
                        <span
                          key={`s-${slot.startMin}`}
                          className="tabular absolute inset-x-1 overflow-hidden rounded-md border border-ok-line bg-ok-tint px-1.5 py-1 text-[11.5px] font-medium text-ok"
                          style={{
                            top: (slot.startMin - dayStart) * PX_PER_MIN,
                            height: (slot.endMin - slot.startMin) * PX_PER_MIN - 2,
                          }}
                        >
                          {formatTimeRange(slot.startMin, slot.endMin)}
                        </span>
                      ))}

                      {day?.busy.map((busy) => (
                        <span
                          key={`b-${busy.kind}-${busy.id}`}
                          className="absolute inset-x-1 overflow-hidden rounded-md border bg-muted px-1.5 py-1 text-[11px] text-muted-foreground"
                          style={{
                            top: (busy.startMin - dayStart) * PX_PER_MIN,
                            height: (busy.endMin - busy.startMin) * PX_PER_MIN - 2,
                          }}
                        >
                          <span className="flex items-center gap-1.5">
                            <span className={cn("size-1.5 shrink-0 rounded-full", courseColor(busy.courseId).dot)} />
                            <span className="truncate">
                              {busy.kind === "PRE_LESSON" ? "Prelezione · " : ""}
                              {courseNames.get(busy.courseId)}
                            </span>
                          </span>
                        </span>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Telefono: elenco per giorno */}
      <div className="space-y-3 md:hidden">
        {days
          .filter((d) => d.window !== null)
          .map((day) => (
            <DayCard key={day.date} day={day} courseNames={courseNames} />
          ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="h-3 w-4 rounded border border-ok-line bg-ok-tint" />
          slot libero della durata scelta
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-4 rounded border bg-muted" />
          impegno esistente
        </span>
        <span className="ml-auto">lun–ven 09–22 · sab 09–13 · domenica e festività escluse</span>
      </div>
    </div>
  );
}

/**
 * Il mese in un colpo solo: una cella per giorno, con dentro gli slot liberi.
 * Serve a rispondere "quando sei libero a ottobre?" senza scorrere sette tabelle.
 */
function MonthGrid({
  days,
  from,
  to,
  today,
  courseNames,
}: {
  days: DayAvailability[];
  from: ISODate;
  to: ISODate;
  today: ISODate;
  courseNames: Map<number, string>;
}) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const celle = eachDay(startOfWeek(from), addDays(startOfWeek(to), 6));

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="grid grid-cols-7 border-b">
        {celle.slice(0, 7).map((date) => (
          <div key={`h-${date}`} className="border-l py-2 text-center text-[13px] font-medium first:border-l-0">
            {WEEKDAY_NAMES[weekdayOf(date)]}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {celle.map((date, indice) => {
          const day = byDate.get(date);
          const nelMese = date >= from && date <= to;
          const passato = date < today;
          return (
            <div
              key={date}
              className={cn(
                "min-h-[124px] border-l border-t p-1.5 first:border-l-0",
                indice < 7 && "border-t-0",
                indice % 7 === 0 && "border-l-0",
                !nelMese && "bg-muted/30",
                nelMese && passato && "bg-muted/15",
              )}
            >
              <div className="mb-1 flex items-baseline justify-between gap-1">
                <span
                  className={cn(
                    "tabular text-[12.5px]",
                    date === today ? "font-semibold text-accent-ink" : "text-muted-foreground",
                    !nelMese && "opacity-40",
                  )}
                >
                  {parseISODate(date).day}
                </span>
                {day?.holiday && nelMese ? (
                  <span className="truncate text-[10px] text-danger">{day.holiday}</span>
                ) : null}
              </div>

              {nelMese ? (
                <div className="space-y-1">
                  {day?.slots.map((slot) => (
                    <div
                      key={`s-${slot.startMin}`}
                      className="tabular rounded border border-ok-line bg-ok-tint px-1 py-0.5 text-center text-[11px] font-medium text-ok"
                    >
                      {formatTimeRange(slot.startMin, slot.endMin)}
                    </div>
                  ))}
                  {day?.busy.map((busy) => (
                    <div
                      key={`b-${busy.kind}-${busy.id}`}
                      className="flex items-center gap-1 rounded bg-muted px-1 py-0.5 text-[10.5px] text-muted-foreground"
                      title={courseNames.get(busy.courseId)}
                    >
                      <span className={cn("size-1.5 shrink-0 rounded-full", courseColor(busy.courseId).dot)} />
                      <span className="tabular shrink-0">{formatTime(busy.startMin)}</span>
                      <span className="truncate">{courseNames.get(busy.courseId)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayCard({ day, courseNames }: { day: DayAvailability; courseNames: Map<number, string> }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-medium">
          {WEEKDAY_SHORT[day.weekday]} {formatDateIT(day.date)}
        </span>
        <span className="tabular text-xs text-muted-foreground">
          {day.slots.length > 0 ? `${day.slots.length} slot` : "nessuno slot"}
        </span>
      </div>
      {day.slots.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {day.slots.map((s) => (
            <span
              key={s.startMin}
              className="tabular rounded-md border border-ok-line bg-ok-tint px-2 py-1 text-xs font-medium text-ok"
            >
              {formatTimeRange(s.startMin, s.endMin)}
            </span>
          ))}
        </div>
      ) : null}
      {day.busy.length > 0 ? (
        <ul className="mt-2 space-y-1 border-t pt-2 text-xs text-muted-foreground">
          {day.busy.map((b) => (
            <li key={`${b.kind}-${b.id}`} className="flex items-center gap-2">
              <span className={cn("size-1.5 shrink-0 rounded-full", courseColor(b.courseId).dot)} />
              <span className="tabular">{formatTimeRange(b.startMin, b.endMin)}</span>
              <span className="truncate">
                {b.kind === "PRE_LESSON" ? "Prelezione · " : ""}
                {courseNames.get(b.courseId)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
