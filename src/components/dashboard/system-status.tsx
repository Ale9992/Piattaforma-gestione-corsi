import { Section } from "@/components/common";
import type { StatusRow } from "@/lib/system-status";
import { cn } from "@/lib/utils";

const COLORE = {
  ok: "bg-ok",
  attenzione: "bg-warn",
  fermo: "bg-danger",
  spento: "bg-muted-foreground/40",
} as const;

/**
 * Tre righe in fondo alla dashboard: se un automatismo si ferma non lo dice
 * nessuno, quindi lo si guarda qui invece che nei log del server.
 */
export function SystemStatus({ rows }: { rows: StatusRow[] }) {
  return (
    <Section title="Stato del sistema" className="mt-6">
      <ul className="space-y-px">
        {rows.map((r) => (
          <li key={r.key} className="hairline flex items-center gap-3 py-2">
            <span className={cn("size-2 shrink-0 rounded-full", COLORE[r.health])} />
            <span className="min-w-0 flex-1 truncate text-sm">{r.label}</span>
            <span
              className={cn(
                "truncate text-xs",
                r.health === "fermo" ? "text-danger" : "text-muted-foreground",
              )}
            >
              {r.error ? r.error : r.detail}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
