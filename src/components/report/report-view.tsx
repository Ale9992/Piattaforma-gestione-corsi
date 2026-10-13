"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { EmptyState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { formatDateIT, formatHours, MONTH_NAMES } from "@/lib/dates";
import { dataIncasso } from "@/lib/scheduling/payments";
import { cn } from "@/lib/utils";
import type { ReportRow } from "@/server/queries";

/** "33800" -> "338,00 €" */
function euro(cents: number): string {
  return `${(cents / 100).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/** Una quota da incassare: il corso può averne due (acconto e saldo). */
interface Quota {
  row: ReportRow;
  kind: "ACCONTO" | "SALDO" | "UNICA";
  cents: number;
  /** Quando si matura il diritto e si emette fattura. */
  date: string;
  /** Quando arriva il bonifico: è questa la data che fa il mese. */
  incasso: string;
  matured: boolean;
}

const ETICHETTA_QUOTA: Record<Quota["kind"], string> = {
  ACCONTO: "Acconto",
  SALDO: "Saldo",
  UNICA: "",
};

function quoteDi(rows: ReportRow[]): Quota[] {
  return rows.flatMap((row) =>
    row.tranches.map((t) => {
      const data = t.date ?? row.endDate ?? row.startDate;
      return {
        row,
        kind: t.kind,
        cents: t.cents,
        date: data,
        incasso: t.paymentDate ?? dataIncasso(data) ?? data,
        matured: t.matured,
      };
    }),
  );
}

/** Da cosa nasce la fattura: la data dice cose diverse a seconda della quota. */
function quando(q: Quota): string {
  const data = formatDateIT(q.date);
  if (q.kind === "ACCONTO") return q.matured ? `80 ore raggiunte il ${data}` : `80 ore attese il ${data}`;
  if (q.kind === "SALDO") return q.matured ? `corso chiuso il ${data}` : `fine corso il ${data}`;
  return q.matured ? `chiuso il ${data}` : `finisce il ${data}`;
}

const meseInParole = (mese: string) => `${MONTH_NAMES[Number(mese.slice(5, 7)) - 1]} ${mese.slice(0, 4)}`;

export function ReportView({ rows, today }: { rows: ReportRow[]; today: string }) {
  // Le cifre restano coperte finché non le chiedi: capita di aprire il gestionale
  // davanti a un allievo.
  const [visibili, setVisibili] = useState(false);
  // I corsi senza importo (quasi tutto l'archivio storico) sono rumore: fuori.
  const [conVuoti, setConVuoti] = useState(false);

  const quote = useMemo(() => quoteDi(rows), [rows]);
  const anni = useMemo(
    () => [...new Set(quote.map((q) => q.incasso.slice(0, 4)))].sort((a, b) => b.localeCompare(a)),
    [quote],
  );
  const [anno, setAnno] = useState(() => anni.find((a) => a === today.slice(0, 4)) ?? anni[0] ?? today.slice(0, 4));

  const dellAnno = useMemo(() => quote.filter((q) => q.incasso.startsWith(anno)), [quote, anno]);
  const conImporto = useMemo(() => dellAnno.filter((q) => q.row.feeCents != null), [dellAnno]);
  const senzaImporto = useMemo(
    () => new Set(dellAnno.filter((q) => q.row.feeCents == null).map((q) => q.row.id)).size,
    [dellAnno],
  );
  const mostrate = conVuoti ? dellAnno : conImporto;

  const somma = (elenco: Quota[]) => elenco.reduce((totale, q) => totale + q.cents, 0);
  // Incassato ≠ fatturato: finché non passa la scadenza, i soldi non ci sono.
  const incassate = conImporto.filter((q) => q.matured && q.incasso <= today);
  const previste = conImporto.filter((q) => !(q.matured && q.incasso <= today));

  const perMese = useMemo(() => {
    const mappa = new Map<string, Quota[]>();
    for (const q of mostrate) {
      const chiave = q.incasso.slice(0, 7);
      const lista = mappa.get(chiave);
      if (lista) lista.push(q);
      else mappa.set(chiave, [q]);
    }
    return [...mappa.entries()]
      .map(([mese, elenco]) => ({
        mese,
        quote: [...elenco].sort((a, b) => a.incasso.localeCompare(b.incasso)),
      }))
      .sort((a, b) => a.mese.localeCompare(b.mese));
  }, [mostrate]);

  /** Le cifre si vedono solo quando l'utente lo chiede. */
  const cifra = (testo: string | null) => (testo === null ? "—" : visibili ? testo : "••••");

  return (
    <div className="space-y-5">
      {/* Comandi: anno a sinistra, visibilità a destra */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-y py-3">
        <div className="flex items-center gap-2.5">
          <span className="label-group">Anno</span>
          <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
            {anni.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAnno(a)}
                aria-pressed={anno === a}
                className={cn(
                  "tabular rounded-md px-2.5 py-1 text-xs transition-colors",
                  anno === a ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => setVisibili((v) => !v)}>
          {visibili ? <EyeOffIcon /> : <EyeIcon />}
          {visibili ? "Nascondi importi" : "Mostra importi"}
        </Button>
      </div>

      {/* Il totale dell'anno, con la parte già maturata */}
      <div className="rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <div className="label-group">Totale {anno}</div>
            <div className={cn("tabular mt-1 text-[34px] font-medium leading-none", visibili && "text-accent-ink")}>
              {cifra(euro(somma(conImporto)))}
            </div>
            <div className="mt-1.5 text-[13px] text-muted-foreground">
              {new Set(conImporto.map((q) => q.row.id)).size} corsi con importo
              {senzaImporto > 0 ? ` · ${senzaImporto} senza` : ""}
            </div>
          </div>
          <div className="flex gap-x-8">
            <div>
              <div className="label-group">Già incassato</div>
              <div className="tabular mt-1 text-xl font-medium">{cifra(euro(somma(incassate)))}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {incassate.length} {incassate.length === 1 ? "quota arrivata" : "quote arrivate"}
              </div>
            </div>
            <div>
              <div className="label-group">In arrivo</div>
              <div className="tabular mt-1 text-xl font-medium text-muted-foreground">
                {cifra(euro(somma(previste)))}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {previste.length} {previste.length === 1 ? "quota da incassare" : "quote da incassare"}
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className="text-[13px] text-muted-foreground">
        Ogni quota è contata nel mese in cui arriva il bonifico, non in quello della fattura: si fattura a corso
        chiuso e si incassa a 30 giorni dalla fine di quel mese. I corsi da 100 ore in su si fatturano in due volte:
        metà al raggiungimento delle 80 ore svolte, il resto a fine corso.
        {senzaImporto > 0 ? (
          <>
            {" "}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-foreground"
              onClick={() => setConVuoti((v) => !v)}
            >
              {conVuoti ? "Nascondi i corsi senza importo" : `Mostra anche i ${senzaImporto} corsi senza importo`}
            </button>
          </>
        ) : null}
      </p>

      {perMese.length === 0 ? (
        <EmptyState>Nessun incasso previsto in questo anno.</EmptyState>
      ) : (
        <div className="space-y-3">
          {perMese.map(({ mese, quote: quoteDelMese }) => (
            <section key={mese} className="overflow-hidden rounded-xl border bg-card">
              <header className="flex items-baseline justify-between gap-3 border-b px-4 py-2.5">
                <h2 className="text-sm font-medium">{meseInParole(mese)}</h2>
                <span className="tabular text-base font-medium">{cifra(euro(somma(quoteDelMese)))}</span>
              </header>
              <ul className="px-4">
                {quoteDelMese.map((q) => (
                  <li key={`${q.row.id}-${q.kind}`} className="hairline">
                    <Link
                      href={`/corsi/${q.row.id}`}
                      className="flex items-center gap-3 py-2.5 transition-colors hover:bg-muted/50"
                    >
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          q.matured && q.incasso <= today ? "bg-ok" : "bg-muted-foreground/35",
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm">{q.row.name}</span>
                          {ETICHETTA_QUOTA[q.kind] ? (
                            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                              {ETICHETTA_QUOTA[q.kind]}
                            </span>
                          ) : null}
                        </span>
                        <span className="tabular block truncate text-xs text-muted-foreground">
                          {[
                            q.row.clientCompany,
                            quando(q),
                            `incasso ${formatDateIT(q.incasso)}`,
                            `${formatHours(q.row.doneMinutes)} di ${formatHours(q.row.totalMinutes)} h`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "tabular shrink-0 text-right text-sm font-medium",
                          !(q.matured && q.incasso <= today) && "text-muted-foreground",
                        )}
                      >
                        {cifra(q.row.feeCents == null ? null : euro(q.cents))}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
