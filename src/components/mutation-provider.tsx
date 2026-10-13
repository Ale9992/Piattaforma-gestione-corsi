"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatDateWithWeekday, formatHours, formatTimeRange } from "@/lib/dates";
import { plural } from "@/lib/format";
import type { MutationActionResult } from "@/server/actions";
import type { ConflictItem, ConflictView, MutationSummary } from "@/server/course-service";

type Action = (confirmConflicts: boolean) => Promise<MutationActionResult>;
type Run = (action: Action, options?: { success?: string }) => Promise<MutationActionResult | null>;

const MutationContext = createContext<Run | null>(null);

export function summaryText(summary: MutationSummary | null): string | undefined {
  if (!summary) return undefined;
  const parts: string[] = [];
  if (summary.endDateBefore !== summary.endDateAfter) {
    const before = summary.endDateBefore ? formatDateWithWeekday(summary.endDateBefore) : "—";
    const after = summary.endDateAfter ? formatDateWithWeekday(summary.endDateAfter) : "—";
    parts.push(`Fine prevista: ${before} → ${after}`);
  }
  if (summary.inserted > 0) parts.push(`+${plural(summary.inserted, "lezione", "lezioni")}`);
  if (summary.removed > 0) parts.push(`−${plural(summary.removed, "lezione", "lezioni")}`);
  return parts.join(" · ") || undefined;
}

function ConflictLine({ item }: { item: ConflictItem }) {
  return (
    <span>
      <strong>{item.courseName}</strong>
      {item.kind === "PRE_LESSON" ? " (prelezione)" : ""} · {formatTimeRange(item.startMin, item.endMin)}
    </span>
  );
}

export function ConflictList({ conflicts }: { conflicts: ConflictView[] }) {
  return (
    <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
      {conflicts.map((c) => (
        <li key={c.key} className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-950">
          <div className="font-medium">{formatDateWithWeekday(c.a.date)}</div>
          <div className="flex flex-col">
            <ConflictLine item={c.a} />
            <ConflictLine item={c.b} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Esegue le server action di modifica: se l'operazione crea sovrapposizioni con altri
 * corsi mostra un avviso e la ripete solo dopo conferma esplicita.
 */
export function MutationProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<{
    conflicts: ConflictView[];
    summary: MutationSummary | null;
    resolve: (confirmed: boolean) => void;
  } | null>(null);

  const run = useCallback<Run>(async (action, options) => {
    let result: MutationActionResult;
    try {
      result = await action(false);
      if (result.ok && result.outcome.status === "needs-confirmation") {
        const { newConflicts, summary } = result.outcome;
        const confirmed = await new Promise<boolean>((resolve) =>
          setPending({ conflicts: newConflicts, summary, resolve }),
        );
        setPending(null);
        if (!confirmed) {
          toast.info("Operazione annullata: nessuna modifica salvata.");
          return null;
        }
        result = await action(true);
      }
    } catch {
      toast.error("Server non raggiungibile: nessuna modifica salvata.");
      return null;
    }

    if (!result.ok) {
      toast.error(result.error);
      return result;
    }
    const { summary, newConflicts } = result.outcome;
    toast.success(options?.success ?? "Modifica salvata", { description: summaryText(summary) });
    if (summary && summary.shortfallMinutes > 0) {
      toast.warning(
        `Le fasi di calendarizzazione non coprono ${formatHours(summary.shortfallMinutes)} ore del monte ore.`,
      );
    }
    if (newConflicts.length > 0) {
      toast.warning(`Salvato con ${plural(newConflicts.length, "sovrapposizione", "sovrapposizioni")}.`);
    }
    return result;
  }, []);

  return (
    <MutationContext.Provider value={run}>
      {children}
      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && pending?.resolve(false)}>
        <AlertDialogContent className="sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangleIcon className="size-5 text-amber-600" />
              Sovrapposizione con altri corsi
            </AlertDialogTitle>
            <AlertDialogDescription>
              Questa modifica crea{" "}
              {plural(pending?.conflicts.length ?? 0, "sovrapposizione", "sovrapposizioni")}. Nulla è
              stato ancora salvato.
              {pending?.summary && summaryText(pending.summary) ? (
                <span className="mt-1 block">{summaryText(pending.summary)}</span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pending ? <ConflictList conflicts={pending.conflicts} /> : null}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => pending?.resolve(false)}>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={() => pending?.resolve(true)}>Salva comunque</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MutationContext.Provider>
  );
}

export function useMutation(): Run {
  const run = useContext(MutationContext);
  if (!run) throw new Error("useMutation deve essere usato dentro <MutationProvider>.");
  return run;
}
