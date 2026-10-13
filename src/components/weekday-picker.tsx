"use client";

import { ALL_WEEKDAYS, WEEKDAY_SHORT } from "@/lib/dates";
import { maskHasWeekday, weekdayBit } from "@/lib/scheduling/types";
import { cn } from "@/lib/utils";

/** Selettore giorni della settimana su bitmask (bit 0 = lunedì). */
export function WeekdayPicker({
  value,
  onChange,
  id,
}: {
  value: number;
  onChange: (mask: number) => void;
  id?: string;
}) {
  return (
    <div id={id} role="group" aria-label="Giorni della settimana" className="flex flex-wrap gap-1.5">
      {ALL_WEEKDAYS.map((w) => {
        const active = maskHasWeekday(value, w);
        return (
          <button
            key={w}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(value ^ weekdayBit(w))}
            className={cn(
              "h-9 min-w-11 rounded-md border px-2 text-sm transition-colors",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background hover:bg-muted",
              w === 7 && !active && "text-muted-foreground",
            )}
          >
            {WEEKDAY_SHORT[w]}
          </button>
        );
      })}
    </div>
  );
}
