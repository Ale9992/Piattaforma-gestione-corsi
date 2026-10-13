"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArchiveIcon,
  CalendarClockIcon,
  CalendarPlusIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  Loader2Icon,
  RefreshCwIcon,
  UndoIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState, NoticeRow, Section } from "@/components/common";
import { useMutation } from "@/components/mutation-provider";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatDateIT, formatDateWithWeekday, formatHours, formatTimeRange } from "@/lib/dates";
import { WEEKDAY_SHORT } from "@/lib/dates";
import { maskToWeekdays } from "@/lib/scheduling/types";
import { cn } from "@/lib/utils";
import {
  checkMailAction,
  confirmMailAction,
  createCourseFromMailAction,
  ignoreMailAction,
  reparseMailAction,
  restoreMailAction,
} from "@/server/actions";
import type { CalendarioAllegato, MailRow } from "@/server/mail-service";

const ETICHETTA: Record<string, string> = {
  NUOVO_CORSO: "Corso nuovo",
  ANNULLAMENTO: "Annullamento",
  CAMBIO_CALENDARIO: "Cambio calendario",
  CONFERMA_CALENDARIO: "Conferma corso",
  CHIUSURA_CORSO: "Chiusura corso",
  INCONTRO_PRELIMINARE: "Incontro preliminare",
  ALTRO: "Da leggere",
};

function giorni(mask: number) {
  return maskToWeekdays(mask)
    .map((d) => WEEKDAY_SHORT[d])
    .join(" + ");
}

/** Cosa succede se confermi: in una riga, senza gergo. */
function descriviProposta(mail: MailRow): { testo: string; azione: string | null } {
  const p = mail.proposal;
  if (p.kind === "ANNULLAMENTO") {
    if (p.lessonIds.length === 0) {
      const gia = p.alreadyCancelled ?? [];
      return {
        testo:
          gia.length > 0
            ? `${gia.length === 1 ? "La lezione" : "Le lezioni"} del ${gia.map(formatDateIT).join(", ")} di «${mail.courseName}» ${gia.length === 1 ? "risulta già annullata" : "risultano già annullate"}: niente da fare.`
            : "Nessuna lezione in programma in quelle date: controlla la mail.",
        azione: null,
      };
    }
    const date = p.dates.map(formatDateIT).join(", ");
    return {
      testo: `Annulla ${p.dates.length === 1 ? "la lezione" : "le lezioni"} del ${date} di «${mail.courseName}». Le ore tolte vengono recuperate in coda al corso.`,
      azione: "Annulla la lezione",
    };
  }
  if (p.kind === "INCONTRO_PRELIMINARE") {
    return {
      testo: `Mette a calendario «${p.title}»: ${formatDateWithWeekday(p.date)}, ${formatTimeRange(p.startMin, p.endMin)}. È un impegno a sé, non una lezione: non tocca nessun corso e non conta nel monte ore.`,
      azione: "Metti a calendario",
    };
  }
  if (p.kind === "CAMBIO_CALENDARIO") {
    const righe = p.blocks
      .map((b) => `${giorni(b.weekdaysMask)} ${formatTimeRange(b.startMin, b.endMin)}`)
      .join(" · ");
    return {
      testo:
        p.mode === "add"
          ? `Aggiunge a «${mail.courseName}» ${righe}, dal ${formatDateIT(p.validFrom)}. I giorni già fissati restano.`
          : `Cambia la calendarizzazione di «${mail.courseName}» dal ${formatDateIT(p.validFrom)}: ${righe}. Sostituisce i giorni attuali.`,
      azione: p.mode === "add" ? "Aggiungi il giorno" : "Applica il cambio",
    };
  }
  if (p.kind === "CONFERMA_CALENDARIO") {
    const problemi = p.missing.length + p.extra.length + p.differentTimes.length;
    if (problemi === 0) {
      return {
        testo: `Le ${p.confirmed} lezioni confermate coincidono con il calendario di «${mail.courseName}»: niente da correggere.`,
        azione: null,
      };
    }
    const parti = [
      p.missing.length ? `${p.missing.length} date confermate che non hai in calendario (${p.missing.slice(0, 4).map(formatDateIT).join(", ")}${p.missing.length > 4 ? "…" : ""})` : null,
      p.extra.length ? `${p.extra.length} lezioni tue che la conferma non elenca (${p.extra.slice(0, 4).map(formatDateIT).join(", ")}${p.extra.length > 4 ? "…" : ""})` : null,
      p.differentTimes.length ? `${p.differentTimes.length} con orario diverso (${p.differentTimes.slice(0, 3).map((d) => `${formatDateIT(d.date)}: loro ${d.mail}, tu ${d.app}`).join("; ")})` : null,
    ].filter(Boolean);
    return {
      testo: `Confronto con «${mail.courseName}»: ${parti.join(" · ")}. Controlla e correggi a mano.`,
      azione: null,
    };
  }
  if (p.kind === "CHIUSURA_CORSO") {
    if (p.alreadyArchived) {
      return { testo: `«${mail.courseName}» è già archiviato: niente da fare.`, azione: null };
    }
    const avvisi = [
      p.unmarkedPast.length
        ? `${p.unmarkedPast.length} lezioni passate sono ancora da segnare`
        : null,
      p.remainingMinutes > 0 ? `mancano ${formatHours(p.remainingMinutes)} ore sul monte ore` : null,
    ].filter(Boolean);
    return {
      testo: `Archivia «${mail.courseName}»: il corso risulta concluso.${avvisi.length ? ` Attenzione: ${avvisi.join(" e ")}.` : ""}`,
      azione: "Archivia il corso",
    };
  }
  if (p.kind === "NUOVO_CORSO") {
    const d = p.draft;
    const dettagli = [
      d.totalHours ? `${String(d.totalHours).replace(".", ",")} ore` : null,
      d.startDate ? `dal ${formatDateIT(d.startDate)}` : null,
      d.clientCompany || null,
    ]
      .filter(Boolean)
      .join(" · ");
    // Le ragioni sociali finiscono spesso con un punto ("S.R.L."): non se ne aggiunge un altro.
    const frase = `Corso nuovo: «${d.name || "senza titolo"}»${dettagli ? ` — ${dettagli}` : ""}`;
    return { testo: frase.endsWith(".") ? frase : `${frase}.`, azione: null };
  }
  if (p.kind === "ALTRO" && p.reason === "corso-non-trovato") {
    return {
      testo:
        "Non ho trovato il corso di cui parla: se non è in gestionale non c'è niente da fare, altrimenti aprilo e sistemalo a mano.",
      azione: null,
    };
  }
  return { testo: "Non ho riconosciuto una richiesta sul calendario: leggila e decidi tu.", azione: null };
}

function useBusy() {
  const [busy, setBusy] = useState(false);
  return [
    busy,
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await fn();
      } finally {
        setBusy(false);
      }
    },
  ] as const;
}

function MailCard({ mail }: { mail: MailRow }) {
  const run = useMutation();
  const router = useRouter();
  const [busy, wrap] = useBusy();
  const [aperta, setAperta] = useState(false);
  const { testo, azione } = descriviProposta(mail);
  const gestita = mail.status === "CONFERMATA" || mail.status === "IGNORATA";

  async function conferma() {
    await wrap(async () => {
      const result = await run((confirm) => confirmMailAction(mail.id, confirm), {
        success: "Proposta applicata",
      });
      if (result?.ok) router.refresh();
    });
  }

  async function creaDalCalendario() {
    await wrap(async () => {
      const result = await run((confirm) => createCourseFromMailAction(mail.id, confirm), {
        success: "Corso creato dal calendario allegato",
      });
      if (result?.ok && result.courseId) router.push(`/corsi/${result.courseId}`);
    });
  }

  async function ignora() {
    await wrap(async () => {
      const result = await ignoreMailAction(mail.id);
      if (result.ok) {
        toast.success("Mail archiviata");
        router.refresh();
      } else toast.error(result.error);
    });
  }

  async function rileggi() {
    await wrap(async () => {
      const result = await reparseMailAction(mail.id);
      if (result.ok) {
        toast.success("Mail riletta");
        router.refresh();
      } else toast.error(result.error);
    });
  }

  async function ripristina() {
    await wrap(async () => {
      const result = await restoreMailAction(mail.id);
      if (result.ok) router.refresh();
      else toast.error(result.error);
    });
  }

  return (
    <li className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={cn(mail.kind === "ALTRO" || !mail.kind ? "" : "border-transparent bg-accent-tint text-accent-ink")}>
              {ETICHETTA[mail.kind ?? "ALTRO"]}
            </Badge>
            {mail.status === "CONFERMATA" ? <Badge variant="outline" className="border-ok-line text-ok">Applicata</Badge> : null}
            {mail.status === "IGNORATA" ? <Badge variant="outline">Archiviata</Badge> : null}
            {mail.status === "ERRORE" ? <Badge variant="outline" className="border-danger-line text-danger">Non letta</Badge> : null}
            <span className="tabular text-xs text-muted-foreground">
              {formatDateIT(mail.receivedAt.slice(0, 10))} · {mail.sender}
            </span>
          </div>
          <p className="mt-1.5 truncate text-sm font-medium">{mail.subject}</p>
        </div>
      </div>

      <p className="mt-2 text-sm">{testo}</p>
      {mail.proposal.kind === "NUOVO_CORSO" && mail.proposal.duplicateOf ? (
        <NoticeRow tone="warn">
          Hai già un corso con gli stessi riferimenti: «{mail.proposal.duplicateOf.name}». Se è lo stesso
          incarico, archivia questa mail invece di creare un doppione.
        </NoticeRow>
      ) : null}
      {mail.proposal.kind === "ANNULLAMENTO" && mail.proposal.unknownDates.length > 0 ? (
        <NoticeRow tone="warn">
          Date indicate nella mail senza lezione corrispondente:{" "}
          {mail.proposal.unknownDates.map(formatDateIT).join(", ")}.
        </NoticeRow>
      ) : null}
      {mail.proposal.kind === "NUOVO_CORSO" && mail.proposal.calendar ? (
        <CalendarioAllegatoBox calendario={mail.proposal.calendar} />
      ) : null}
      {mail.note ? <p className="mt-1.5 text-xs text-muted-foreground">{mail.note}</p> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!gestita && azione ? (
          <Button size="sm" onClick={conferma} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : mail.proposal.kind === "ANNULLAMENTO" ? <XIcon /> : mail.proposal.kind === "CHIUSURA_CORSO" ? <ArchiveIcon /> : mail.proposal.kind === "INCONTRO_PRELIMINARE" ? <CalendarPlusIcon /> : mail.proposal.kind === "CAMBIO_CALENDARIO" && mail.proposal.mode === "add" ? <CalendarPlusIcon /> : <CalendarClockIcon />}
            {azione}
          </Button>
        ) : null}
        {!gestita && mail.proposal.kind === "NUOVO_CORSO" ? (
          <>
            {mail.proposal.calendar?.matches ? (
              <Button size="sm" onClick={creaDalCalendario} disabled={busy}>
                {busy ? <Loader2Icon className="animate-spin" /> : <CalendarClockIcon />}
                Crea il corso col calendario
              </Button>
            ) : null}
            <Link
              href={`/corsi/nuovo?mail=${mail.id}`}
              className={cn(buttonVariants({ size: "sm", variant: mail.proposal.calendar?.matches || mail.proposal.duplicateOf ? "outline" : "default" }))}
            >
              <CheckIcon /> Apri il modulo compilato
            </Link>
            {mail.proposal.duplicateOf ? (
              <Link
                href={`/corsi/${mail.proposal.duplicateOf.id}`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                Apri il corso esistente
              </Link>
            ) : null}
          </>
        ) : null}
        {mail.courseId ? (
          <Link
            href={`/corsi/${mail.courseId}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Apri il corso
          </Link>
        ) : null}
        {/* Rileggere non applica niente: torna al messaggio nella casella e
            ricostruisce la proposta. Vale anche sulle mail già gestite, ed è il
            modo di recuperare ciò che una lettura vecchia non sapeva estrarre. */}
        <Button size="sm" variant="ghost" onClick={rileggi} disabled={busy}>
          <RefreshCwIcon /> Rileggi
        </Button>
        {!gestita ? (
          <Button size="sm" variant="ghost" onClick={ignora} disabled={busy}>
            Archivia
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={ripristina} disabled={busy}>
            <UndoIcon /> Rimetti fra le nuove
          </Button>
        )}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setAperta((v) => !v)}>
          {aperta ? <ChevronUpIcon /> : <ChevronDownIcon />}
          {aperta ? "Nascondi la mail" : "Leggi la mail"}
        </Button>
      </div>

      {aperta ? (
        <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">
          {mail.body || "(nessun testo)"}
        </pre>
      ) : null}
    </li>
  );
}

export function MailInbox({
  mail,
  configured,
  showingHandled,
}: {
  mail: MailRow[];
  configured: boolean;
  showingHandled: boolean;
}) {
  const router = useRouter();
  const [busy, wrap] = useBusy();

  async function controlla() {
    await wrap(async () => {
      const result = await checkMailAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { report } = result;
      if (report.errors.length > 0) toast.error(report.errors[0]);
      else if (report.stored === 0) toast.success("Nessuna mail nuova.");
      else toast.success(`${report.stored} mail da controllare.`);
      router.refresh();
    });
  }

  return (
    <Section
      title={showingHandled ? "Tutte le mail" : "Da confermare"}
      actions={
        <div className="flex items-center gap-2">
          <Link
            href={showingHandled ? "/posta" : "/posta?tutte=1"}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            {showingHandled ? "Solo da confermare" : "Mostra tutte"}
          </Link>
          <Button size="sm" variant="secondary" onClick={controlla} disabled={busy || !configured}>
            {busy ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
            Controlla ora
          </Button>
        </div>
      }
    >
      {!configured ? (
        <NoticeRow tone="warn">
          Lettura della posta non configurata: imposta MAIL_USER e MAIL_APP_PASSWORD nel file .env.
        </NoticeRow>
      ) : null}
      {mail.length === 0 ? (
        <EmptyState>
          {showingHandled ? "Nessuna mail archiviata." : "Nessuna mail in attesa: tutto sistemato."}
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {mail.map((m) => (
            <MailCard key={m.id} mail={m} />
          ))}
        </ul>
      )}
    </Section>
  );
}

/**
 * Il calendario allegato all'incarico, riassunto: quante lezioni, in che
 * periodi e se le date tornano. Senza questo riquadro il pulsante "crea il
 * corso" chiederebbe di fidarsi di un PDF che non si è visto.
 */
function CalendarioAllegatoBox({ calendario }: { calendario: CalendarioAllegato }) {
  const prima = calendario.lessons[0];
  const ultima = calendario.lessons[calendario.lessons.length - 1];
  if (!prima || !ultima) return null;

  return (
    <div className="mt-2.5 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="label-group">Calendario allegato</span>
        <span className="tabular text-xs text-muted-foreground">
          {calendario.lessons.length} lezioni · {formatHours(calendario.totalMinutes)} h ·{" "}
          {formatDateIT(prima.date)} → {formatDateIT(ultima.date)}
        </span>
      </div>
      <ul className="tabular mt-2 space-y-1 text-[13px]">
        {calendario.aRitmo ? (
          calendario.phases.flatMap((fase) =>
            fase.blocks.map((blocco) => (
              <li key={`${fase.from}-${blocco.from}-${blocco.startMin}`} className="flex flex-wrap gap-x-2">
                <span>{blocco.weekdays.map((g) => WEEKDAY_SHORT[g]).join(" e ")}</span>
                <span>{formatTimeRange(blocco.startMin, blocco.endMin)}</span>
                <span className="text-muted-foreground">
                  dal {formatDateIT(blocco.from > fase.from ? blocco.from : fase.from)}
                  {fase.to ? ` al ${formatDateIT(fase.to)}` : ""}
                </span>
              </li>
            )),
          )
        ) : (
          <li className="text-muted-foreground">
            Date fisse, una per una: il calendario non segue una frequenza settimanale.
          </li>
        )}
        {calendario.preLesson ? (
          <li className="text-muted-foreground">
            Prelezione {formatDateIT(calendario.preLesson.date)}{" "}
            {formatTimeRange(calendario.preLesson.startMin, calendario.preLesson.endMin)}
          </li>
        ) : null}
      </ul>
      {!calendario.matches ? (
        <NoticeRow tone="warn">
          Queste date non si riducono a un ritmo fisso: il corso va creato dal modulo e le lezioni
          sistemate a mano.
        </NoticeRow>
      ) : null}
    </div>
  );
}
