"use client";

import { useState } from "react";
import { Loader2Icon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog, Field } from "@/components/common";
import { useMutation } from "@/components/mutation-provider";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  formatDuration,
  formatTime,
  isValidISODate,
  isValidTime,
  parseTime,
  type ISODate,
} from "@/lib/dates";
import { deleteAppointmentAction, updateAppointmentAction } from "@/server/actions";

export interface EditableAppointment {
  id: number;
  title: string;
  date: ISODate;
  startMin: number;
  endMin: number;
}

/**
 * Un impegno senza corso — l'incontro preliminare — si corregge e si cancella
 * da qui: è l'unico posto in cui esiste, quindi deve bastare.
 */
export function AppointmentForm({
  appointment,
  onDone,
}: {
  appointment: EditableAppointment;
  onDone?: () => void;
}) {
  const run = useMutation();
  const [title, setTitle] = useState(appointment.title);
  const [date, setDate] = useState<string>(appointment.date);
  const [start, setStart] = useState(formatTime(appointment.startMin));
  const [end, setEnd] = useState(formatTime(appointment.endMin));
  const [busy, setBusy] = useState(false);
  const [confermaElimina, setConfermaElimina] = useState(false);

  const startMin = isValidTime(start) ? parseTime(start) : null;
  const endMin = isValidTime(end) ? parseTime(end) : null;
  const valid = title.trim() !== "" && isValidISODate(date) && startMin !== null && endMin !== null && startMin < endMin;

  async function salva(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    const result = await run(
      (confirm) => updateAppointmentAction(appointment.id, { title, date, startMin, endMin }, confirm),
      { success: "Impegno aggiornato" },
    );
    setBusy(false);
    if (result?.ok) onDone?.();
  }

  async function elimina() {
    setBusy(true);
    const result = await deleteAppointmentAction(appointment.id);
    setBusy(false);
    if (result.ok) {
      toast.success("Impegno eliminato");
      onDone?.();
    } else toast.error(result.error);
  }

  return (
    <form onSubmit={salva} className="grid gap-3">
      <Field label="Titolo" htmlFor="app-title">
        <Input id="app-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
      </Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Data" htmlFor="app-date" className="col-span-2 sm:col-span-1">
          <Input id="app-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Inizio" htmlFor="app-start">
          <Input id="app-start" type="time" step={300} value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Fine" htmlFor="app-end">
          <Input id="app-end" type="time" step={300} value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        Durata: {valid ? formatDuration(endMin! - startMin!) : "—"}. Non appartiene a nessun corso e non conta nel
        monte ore, ma occupa la fascia oraria: nelle disponibilità non risulta libera.
      </p>
      <DialogFooter className="gap-2 sm:justify-between">
        <Button type="button" variant="ghost" onClick={() => setConfermaElimina(true)} disabled={busy}>
          <Trash2Icon /> Elimina
        </Button>
        <Button type="submit" disabled={!valid || busy}>
          {busy ? <Loader2Icon className="animate-spin" /> : null}
          Salva impegno
        </Button>
      </DialogFooter>
      <ConfirmDialog
        open={confermaElimina}
        onOpenChange={setConfermaElimina}
        title="Eliminare l'impegno?"
        description={`«${appointment.title}» sparisce dal calendario, anche da quello Apple. Non è reversibile.`}
        confirmLabel="Elimina"
        destructive
        onConfirm={() => void elimina()}
      />
    </form>
  );
}
