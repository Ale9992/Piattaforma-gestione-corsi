"use client";

import { useState } from "react";
import { CheckIcon, Loader2Icon, PencilIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { Field, IconButton, nativeSelectClass } from "@/components/common";
import { useMutation } from "@/components/mutation-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  formatDateIT,
  formatDateWithWeekday,
  formatDuration,
  formatTime,
  isValidISODate,
  isValidTime,
  parseTime,
} from "@/lib/dates";
import { LESSON_STATUS_LABEL } from "@/lib/format";
import { LESSON_STATUSES, type LessonStatus } from "@/lib/scheduling/types";
import { cn } from "@/lib/utils";
import { resetLessonAction, setLessonStatusAction, updateLessonAction } from "@/server/actions";

export interface EditableLesson {
  id: number;
  date: string;
  startMin: number;
  endMin: number;
  status: LessonStatus;
  isManual: boolean;
}

/** Al tocco l'area cresce a 44px: la forma resta la stessa. */
const TOUCH = "size-11 md:size-[30px]";

export function LessonStatusActions({
  lesson,
  onDone,
  touch = false,
}: {
  lesson: EditableLesson;
  onDone?: () => void;
  touch?: boolean;
}) {
  const run = useMutation();
  const [busy, setBusy] = useState(false);

  async function setStatus(status: LessonStatus) {
    setBusy(true);
    const result = await run((confirm) => setLessonStatusAction(lesson.id, status, confirm), {
      success: `Lezione del ${formatDateIT(lesson.date)}: ${LESSON_STATUS_LABEL[status]}`,
    });
    setBusy(false);
    if (result?.ok) onDone?.();
  }

  const size = touch ? TOUCH : undefined;

  if (busy) {
    return (
      <IconButton label="Salvataggio in corso" disabled className={cn(size)}>
        <Loader2Icon className="animate-spin" />
      </IconButton>
    );
  }

  if (lesson.status !== "PLANNED") {
    return (
      <IconButton
        label="Riporta a programmata"
        className={cn(size)}
        onClick={() => void setStatus("PLANNED")}
      >
        <RotateCcwIcon className="size-[15px]" />
      </IconButton>
    );
  }

  return (
    <>
      <IconButton
        label="Segna svolta"
        tone="ok"
        className={cn(size)}
        onClick={() => void setStatus("COMPLETED")}
      >
        <CheckIcon className="size-[15px] stroke-[2.6]" />
      </IconButton>
      <IconButton
        label="Annulla lezione"
        tone="danger"
        className={cn(size)}
        onClick={() => void setStatus("CANCELLED")}
      >
        <XIcon className="size-[15px] stroke-[2.4]" />
      </IconButton>
    </>
  );
}

export function LessonEditButton({
  lesson,
  onSaved,
  touch = false,
}: {
  lesson: EditableLesson;
  onSaved?: () => void;
  touch?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton label="Modifica lezione" className={cn(touch && TOUCH)} onClick={() => setOpen(true)}>
        <PencilIcon className="size-[15px]" />
      </IconButton>
      <LessonEditDialog
        lesson={lesson}
        open={open}
        onOpenChange={setOpen}
        onSaved={() => {
          setOpen(false);
          onSaved?.();
        }}
      />
    </>
  );
}

export function LessonEditDialog({
  lesson,
  open,
  onOpenChange,
  onSaved,
}: {
  lesson: EditableLesson;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Modifica singola lezione</DialogTitle>
          <DialogDescription>
            {formatDateWithWeekday(lesson.date)}. La modifica vale solo per questa lezione e non cambia la
            calendarizzazione del corso.
          </DialogDescription>
        </DialogHeader>
        {open ? <LessonEditForm key={lesson.id} lesson={lesson} onSaved={onSaved} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function LessonEditForm({ lesson, onSaved }: { lesson: EditableLesson; onSaved?: () => void }) {
  const run = useMutation();
  const [date, setDate] = useState(lesson.date);
  const [start, setStart] = useState(formatTime(lesson.startMin));
  const [end, setEnd] = useState(formatTime(lesson.endMin));
  const [status, setStatus] = useState<LessonStatus>(lesson.status);
  const [busy, setBusy] = useState(false);

  const startMin = isValidTime(start) ? parseTime(start) : null;
  const endMin = isValidTime(end) ? parseTime(end) : null;
  const valid = isValidISODate(date) && startMin !== null && endMin !== null && startMin < endMin;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    const result = await run(
      (confirm) => updateLessonAction(lesson.id, { date, startMin, endMin, status }, confirm),
      { success: "Lezione aggiornata" },
    );
    setBusy(false);
    if (result?.ok) onSaved?.();
  }

  async function reset() {
    setBusy(true);
    const result = await run((confirm) => resetLessonAction(lesson.id, confirm), {
      success: "Lezione riallineata alla calendarizzazione",
    });
    setBusy(false);
    if (result?.ok) onSaved?.();
  }

  return (
    <form onSubmit={save} className="grid gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Data" htmlFor="lesson-date" className="col-span-2 sm:col-span-1">
          <Input id="lesson-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Inizio" htmlFor="lesson-start">
          <Input id="lesson-start" type="time" step={300} value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Fine" htmlFor="lesson-end">
          <Input id="lesson-end" type="time" step={300} value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <Field label="Stato" htmlFor="lesson-status">
        <select
          id="lesson-status"
          className={nativeSelectClass}
          value={status}
          onChange={(e) => setStatus(e.target.value as LessonStatus)}
        >
          {LESSON_STATUSES.map((s) => (
            <option key={s} value={s}>
              {LESSON_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </Field>
      <p className="text-xs text-muted-foreground">
        Durata: {valid ? formatDuration(endMin! - startMin!) : "—"}.
        {lesson.isManual
          ? " Lezione già modificata manualmente: il ricalcolo automatico non la sposta."
          : " Se sposti data o orario la lezione diventa manuale e il ricalcolo non la sposterà più."}
      </p>
      <DialogFooter className="gap-2 sm:justify-between">
        {lesson.isManual ? (
          <Button type="button" variant="ghost" onClick={reset} disabled={busy}>
            <RotateCcwIcon /> Riallinea alla regola
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={!valid || busy}>
          {busy ? <Loader2Icon className="animate-spin" /> : null}
          Salva lezione
        </Button>
      </DialogFooter>
    </form>
  );
}
