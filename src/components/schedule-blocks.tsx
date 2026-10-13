"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import { Field, IconButton } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WeekdayPicker } from "@/components/weekday-picker";
import { formatDateIT, isValidISODate, isValidTime, parseTime, WEEKDAY_NAMES } from "@/lib/dates";
import { findOverlappingWeekday, type ScheduleBlock } from "@/lib/scheduling/rules";

/** Riga orario in fase di compilazione: gli orari sono ancora testo. */
export interface BlockDraft {
  mask: number;
  start: string;
  end: string;
  /** Data da cui partono questi giorni ("" = dall'inizio). */
  from: string;
}

export const emptyBlock = (): BlockDraft => ({ mask: 0, start: "", end: "", from: "" });

/**
 * Converte le righe compilate, oppure spiega cosa manca. `phaseFrom` è la data
 * da cui vale l'insieme delle righe: una riga non può partire prima.
 */
export function blocksToSchedule(
  blocks: readonly BlockDraft[],
  phaseFrom?: string,
): ScheduleBlock[] | { error: string } {
  const out: ScheduleBlock[] = [];
  for (const block of blocks) {
    if (block.mask === 0) return { error: "Seleziona i giorni di ogni riga orario." };
    if (!isValidTime(block.start) || !isValidTime(block.end)) {
      return { error: "Orario non valido in una delle righe." };
    }
    const startMin = parseTime(block.start);
    const endMin = parseTime(block.end);
    if (startMin >= endMin) return { error: "L'ora di fine deve essere successiva all'inizio." };
    let from: string | null = null;
    if (block.from) {
      if (!isValidISODate(block.from)) return { error: "Data \"dal\" non valida in una delle righe." };
      if (phaseFrom && isValidISODate(phaseFrom) && block.from < phaseFrom) {
        return { error: `Una riga parte dal ${formatDateIT(block.from)}, prima dell'inizio (${formatDateIT(phaseFrom)}).` };
      }
      from = block.from;
    }
    out.push({ weekdaysMask: block.mask, startMin, endMin, from });
  }
  if (out.length === 0) return { error: "Serve almeno un giorno con orario." };
  const doppio = findOverlappingWeekday(out);
  if (doppio !== null) {
    return { error: `${WEEKDAY_NAMES[doppio as 1]} compare in due righe: scegline una sola.` };
  }
  return out;
}

/**
 * Editor delle righe orario di una fase. Più righe servono quando i giorni hanno
 * orari diversi: per esempio martedì 11–12 e mercoledì 9–11.
 */
export function ScheduleBlocksEditor({
  value,
  onChange,
  idPrefix = "blocco",
  minFrom,
}: {
  value: BlockDraft[];
  onChange: (blocks: BlockDraft[]) => void;
  idPrefix?: string;
  /** Se indicata, con più righe ognuna può partire da una data propria (non prima di questa). */
  minFrom?: string;
}) {
  const withFrom = minFrom !== undefined && value.length > 1;
  const update = (index: number, patch: Partial<BlockDraft>) =>
    onChange(value.map((block, i) => (i === index ? { ...block, ...patch } : block)));

  return (
    <div className="flex flex-col gap-3">
      {value.map((block, index) => (
        <div
          key={index}
          className={value.length > 1 ? "relative rounded-lg border bg-muted/30 p-3" : undefined}
        >
          {value.length > 1 ? (
            <div className="absolute top-2 right-2">
              <IconButton
                label="Rimuovi questa riga orario"
                tone="danger"
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                <Trash2Icon className="size-[15px]" />
              </IconButton>
            </div>
          ) : null}
          <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
            <Field label={index === 0 ? "Giorni *" : "Giorni"} className="max-w-full">
              <WeekdayPicker value={block.mask} onChange={(mask) => update(index, { mask })} />
            </Field>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Ora inizio *" htmlFor={`${idPrefix}-start-${index}`}>
                <Input
                  id={`${idPrefix}-start-${index}`}
                  type="time"
                  step={300}
                  className="w-[110px]"
                  value={block.start}
                  onChange={(e) => update(index, { start: e.target.value })}
                />
              </Field>
              <Field label="Ora fine *" htmlFor={`${idPrefix}-end-${index}`}>
                <Input
                  id={`${idPrefix}-end-${index}`}
                  type="time"
                  step={300}
                  className="w-[110px]"
                  value={block.end}
                  onChange={(e) => update(index, { end: e.target.value })}
                />
              </Field>
              {withFrom ? (
                <Field label="Dal" htmlFor={`${idPrefix}-from-${index}`}>
                  <Input
                    id={`${idPrefix}-from-${index}`}
                    type="date"
                    min={minFrom || undefined}
                    className="w-[150px]"
                    title="Lascia vuoto se questi giorni partono dall'inizio"
                    value={block.from}
                    onChange={(e) => update(index, { from: e.target.value })}
                  />
                </Field>
              ) : null}
            </div>
          </div>
        </div>
      ))}

      <div>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange([...value, emptyBlock()])}>
          <PlusIcon /> {minFrom !== undefined ? "Aggiungi giorni con orario o data di inizio diversi" : "Aggiungi giorni con orario diverso"}
        </Button>
        {withFrom ? (
          <p className="mt-1 px-2 text-xs text-muted-foreground">
            &quot;Dal&quot; vuoto = i giorni partono dall&apos;inizio. Indicalo se un giorno si aggiunge più avanti.
          </p>
        ) : null}
      </div>
    </div>
  );
}
