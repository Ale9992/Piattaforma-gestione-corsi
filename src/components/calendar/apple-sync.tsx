"use client";

import { useState } from "react";
import { AppleIcon, Loader2Icon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDateIT } from "@/lib/dates";
import { plural } from "@/lib/format";
import { syncAppleCalendarAction } from "@/server/actions";
import type { SyncReport } from "@/server/calendar-sync";

export function AppleSyncButton({ calendarName }: { calendarName: string }) {
  const [report, setReport] = useState<SyncReport | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(apply: boolean) {
    setBusy(true);
    try {
      const result = await syncAppleCalendarAction(apply);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.report.error) {
        setReport(result.report);
        return;
      }
      if (apply) {
        setReport(null);
        toast.success("Calendario Apple aggiornato", {
          description: [
            result.report.created ? `${result.report.created} creati` : null,
            result.report.updated ? `${result.report.updated} aggiornati` : null,
            result.report.removed ? `${result.report.removed} rimossi` : null,
          ]
            .filter(Boolean)
            .join(" · "),
        });
        return;
      }
      if (result.report.created + result.report.updated + result.report.removed === 0) {
        toast.success("Calendario Apple già allineato");
        return;
      }
      setReport(result.report);
    } catch {
      toast.error("Server non raggiungibile.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => run(false)} disabled={busy}>
        {busy ? <Loader2Icon className="animate-spin" /> : <AppleIcon />}
        Sincronizza con Apple
      </Button>

      <Dialog open={report !== null} onOpenChange={(open) => !open && setReport(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Sincronizzazione con il calendario &quot;{calendarName}&quot;</DialogTitle>
            <DialogDescription>
              {report?.error
                ? "Sincronizzazione non riuscita."
                : `Dal ${formatDateIT(report?.from)} al ${formatDateIT(report?.to)}. Gli eventi che non ha creato questa applicazione non vengono mai modificati.`}
            </DialogDescription>
          </DialogHeader>

          {report?.error ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{report.error}</p>
          ) : report ? (
            <div className="space-y-3 text-sm">
              <ul className="grid grid-cols-2 gap-2">
                <Stat label="Da creare" value={report.created} />
                <Stat label="Da aggiornare" value={report.updated} />
                <Stat label="Da rimuovere" value={report.removed} />
                <Stat label="Già allineati" value={report.unchanged} />
              </ul>
              {report.ignored > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {plural(report.ignored, "evento personale", "eventi personali")} nel calendario: non verranno toccati.
                </p>
              ) : null}
              {report.samples.length > 0 ? (
                <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-md bg-muted p-2 text-xs tabular-nums">
                  {report.samples.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setReport(null)}>
              Chiudi
            </Button>
            {report && !report.error ? (
              <Button onClick={() => run(true)} disabled={busy}>
                {busy ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
                Applica su Apple Calendar
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <li className="rounded-md border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </li>
  );
}
