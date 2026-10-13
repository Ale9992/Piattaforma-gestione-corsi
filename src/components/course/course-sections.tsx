"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangleIcon,
  CalendarArrowDownIcon,
  CalendarClockIcon,
  CalendarPlusIcon,
  CheckIcon,
  ChevronLeftIcon,
  FileTextIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  UndoIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  ConfirmDialog,
  ConflictMark,
  EmptyState,
  Field,
  IconButton,
  IconLink,
  LessonStatusMark,
  NoticeRow,
  Section,
  nativeSelectClass,
} from "@/components/common";
import { ConflictList, useMutation } from "@/components/mutation-provider";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ScheduleBlocksEditor,
  blocksToSchedule,
  emptyBlock,
  type BlockDraft,
} from "@/components/schedule-blocks";
import {
  diffDays,
  formatDateIT,
  formatDuration,
  formatHours,
  formatTime,
  formatTimeRange,
  isValidISODate,
  isValidTime,
  maxDate,
  minDate,
  MONTH_NAMES,
  parseISODate,
  parseTime,
  WEEKDAY_NAMES,
  WEEKDAY_SHORT,
  weekdayOf,
  type ISODate,
} from "@/lib/dates";
import { COURSE_STATUS_LABEL, plural } from "@/lib/format";
import { recalculateSchedule } from "@/lib/scheduling/recalculateSchedule";
import { planAddDays, planScheduleChange } from "@/lib/scheduling/rules";
import {
  COURSE_STATUSES,
  maskToWeekdays,
  type CourseStatus,
  type LessonStatus,
} from "@/lib/scheduling/types";
import { cn } from "@/lib/utils";
import {
  addPauseAction,
  addScheduleDaysAction,
  changeScheduleAction,
  deleteCourseAction,
  deletePauseAction,
  deleteScheduleRuleAction,
  recalculateCourseAction,
  setCourseStatusAction,
  setPreLessonAction,
  setPreLessonStatusAction,
  updateCourseAction,
  updateNotesAction,
  updatePauseAction,
} from "@/server/actions";
import type { CourseDetail } from "@/server/queries";
import { hoursToMinutes } from "./course-form";
import { LessonEditButton, LessonStatusActions } from "./lesson-controls";

type Props = { detail: CourseDetail; today: string };

function useBusy() {
  const [busy, setBusy] = useState(false);
  const wrap = async <T,>(fn: () => Promise<T>) => {
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  };
  return [busy, wrap] as const;
}

function shortDay(date: ISODate) {
  return `${WEEKDAY_SHORT[weekdayOf(date)].toLowerCase()} ${formatDateIT(date).slice(0, 5)}`;
}

// ---------------------------------------------------------------------------
// Testata
// ---------------------------------------------------------------------------

export function CourseHeaderActions({ detail }: Props) {
  const router = useRouter();
  const { course, lessons } = detail;
  const [busy, wrap] = useBusy();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const plannedLeft = lessons.filter((l) => l.status === "PLANNED").length;

  async function changeStatus(status: CourseStatus) {
    await wrap(async () => {
      const result = await setCourseStatusAction(course.id, status);
      if (result.ok) {
        toast.success(`Stato: ${COURSE_STATUS_LABEL[status]}`, {
          description: status === "COMPLETED" ? "Il corso è ora nell'Archivio." : undefined,
        });
      } else toast.error(result.error);
    });
  }

  async function remove() {
    await wrap(async () => {
      const result = await deleteCourseAction(course.id);
      if (result.ok) {
        toast.success("Corso eliminato");
        router.push("/corsi");
      } else toast.error(result.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Stato corso"
        className={nativeSelectClass}
        value={course.status}
        disabled={busy}
        onChange={(e) => {
          const status = e.target.value as CourseStatus;
          if (status === "COMPLETED" && plannedLeft > 0) setCompleteOpen(true);
          else void changeStatus(status);
        }}
      >
        {COURSE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {COURSE_STATUS_LABEL[s]}
          </option>
        ))}
      </select>

      <IconLink
        label="Esporta per Apple Calendar"
        size="md"
        href={`/corsi/${course.id}/calendario.ics`}
        download
      >
        <CalendarArrowDownIcon className="size-4" />
      </IconLink>
      {course.contractFile ? (
        <IconLink label="Apri la lettera d'incarico" size="md" href={`/corsi/${course.id}/contratto`}>
          <FileTextIcon className="size-4" />
        </IconLink>
      ) : null}
      <IconButton label="Modifica dati corso" size="md" onClick={() => setEditOpen(true)}>
        <PencilIcon className="size-4" />
      </IconButton>
      <IconButton label="Elimina corso" size="md" tone="danger" onClick={() => setDeleteOpen(true)}>
        <Trash2Icon className="size-4" />
      </IconButton>

      <CourseEditDialog detail={detail} open={editOpen} onOpenChange={setEditOpen} />
      <ConfirmDialog
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        title="Concludere il corso?"
        description={`Ci sono ancora ${plural(plannedLeft, "lezione programmata", "lezioni programmate")}. Il corso andrà nell'Archivio e le lezioni restano invariate.`}
        confirmLabel="Concludi corso"
        onConfirm={() => void changeStatus("COMPLETED")}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Eliminare definitivamente il corso?"
        description={`"${course.name}" verrà eliminato con tutte le lezioni, calendarizzazioni, pause, prelezione e note. L'operazione non è reversibile. Per conservarlo usa lo stato Concluso.`}
        confirmLabel="Elimina definitivamente"
        destructive
        onConfirm={() => void remove()}
      />
    </div>
  );
}

function CourseEditDialog({
  detail,
  open,
  onOpenChange,
}: {
  detail: CourseDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Modifica dati corso</DialogTitle>
          <DialogDescription>
            Cambiare monte ore o data di inizio ricalcola le lezioni programmate future.
          </DialogDescription>
        </DialogHeader>
        {open ? <CourseEditForm detail={detail} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CourseEditForm({ detail, onDone }: { detail: CourseDetail; onDone: () => void }) {
  const run = useMutation();
  const { course } = detail;
  const [busy, wrap] = useBusy();
  const [f, setF] = useState({
    name: course.name,
    clientCompany: course.clientCompany,
    mode: course.mode,
    studentsCount: course.studentsCount?.toString() ?? "",
    studentReference: course.studentReference,
    assignmentNumber: course.assignmentNumber,
    clientContact: course.clientContact,
    fee: course.feeCents != null ? (course.feeCents / 100).toFixed(2).replace(".", ",") : "",
    totalHours: formatHours(course.totalMinutes),
    startDate: course.startDate,
    meetingUrl: course.meetingUrl,
    meetingUser: course.meetingUser,
    meetingPassword: course.meetingPassword,
  });
  const set = (key: keyof typeof f, value: string) => setF((prev) => ({ ...prev, [key]: value }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const totalMinutes = hoursToMinutes(f.totalHours);
    if (!totalMinutes) return toast.error("Monte ore non valido.");
    const studentsCount = f.studentsCount.trim() ? Number(f.studentsCount) : null;
    if (studentsCount !== null && (!Number.isInteger(studentsCount) || studentsCount < 0)) {
      return toast.error("Numero allievi non valido.");
    }
    let feeCents: number | null = null;
    if (f.fee.trim()) {
      const valore = Number(f.fee.trim().replace(/[€\s.]/g, "").replace(",", "."));
      if (!Number.isFinite(valore) || valore < 0) return toast.error("Importo non valido.");
      feeCents = Math.round(valore * 100);
    }
    await wrap(async () => {
      const result = await run(
        (confirm) =>
          updateCourseAction(
            course.id,
            { ...f, studentsCount, totalMinutes, feeCents, notes: course.notes },
            confirm,
          ),
        { success: "Dati corso aggiornati" },
      );
      if (result?.ok) onDone();
    });
  }

  return (
    <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
      <Field label="Nome corso" htmlFor="e-name" className="sm:col-span-2">
        <Input id="e-name" value={f.name} onChange={(e) => set("name", e.target.value)} required />
      </Field>
      <Field label="Azienda cliente" htmlFor="e-company">
        <Input id="e-company" value={f.clientCompany} onChange={(e) => set("clientCompany", e.target.value)} />
      </Field>
      <Field label="Modalità" htmlFor="e-mode">
        <Input id="e-mode" value={f.mode} onChange={(e) => set("mode", e.target.value)} />
      </Field>
      <Field label="Numero allievi" htmlFor="e-students">
        <Input
          id="e-students"
          inputMode="numeric"
          value={f.studentsCount}
          onChange={(e) => set("studentsCount", e.target.value)}
        />
      </Field>
      <Field label="Referente allievi" htmlFor="e-ref">
        <Input id="e-ref" value={f.studentReference} onChange={(e) => set("studentReference", e.target.value)} />
      </Field>
      <Field label="Monte ore" htmlFor="e-hours">
        <Input id="e-hours" inputMode="decimal" value={f.totalHours} onChange={(e) => set("totalHours", e.target.value)} />
      </Field>
      <Field label="Data inizio" htmlFor="e-start">
        <Input id="e-start" type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} />
      </Field>
      <Field label="Importo" htmlFor="e-fee">
        <Input id="e-fee" inputMode="decimal" value={f.fee} onChange={(e) => set("fee", e.target.value)} />
      </Field>
      <Field label="Numero incarico" htmlFor="e-assignment">
        <Input
          id="e-assignment"
          placeholder="260532"
          value={f.assignmentNumber}
          onChange={(e) => set("assignmentNumber", e.target.value)}
        />
      </Field>
      <Field label="Referente cliente" htmlFor="e-contact">
        <Input id="e-contact" value={f.clientContact} onChange={(e) => set("clientContact", e.target.value)} />
      </Field>

      {/* Accesso alla riunione: di norma lo compila la mail di conferma, ma
          quando il formato della mail cambia si scrive qui. */}
      <Field label="Link riunione Teams" htmlFor="e-meeting" className="sm:col-span-2">
        <Input
          id="e-meeting"
          placeholder="https://teams.microsoft.com/l/meetup-join/..."
          value={f.meetingUrl}
          onChange={(e) => set("meetingUrl", e.target.value)}
        />
      </Field>
      <Field label="Utente Teams" htmlFor="e-meeting-user">
        <Input id="e-meeting-user" value={f.meetingUser} onChange={(e) => set("meetingUser", e.target.value)} />
      </Field>
      <Field label="Password Teams" htmlFor="e-meeting-password">
        <Input
          id="e-meeting-password"
          value={f.meetingPassword}
          onChange={(e) => set("meetingPassword", e.target.value)}
        />
      </Field>

      <DialogFooter className="sm:col-span-2">
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2Icon className="animate-spin" /> : null}
          Salva
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Avvisi
// ---------------------------------------------------------------------------

export function CourseAlerts({ detail }: Props) {
  const run = useMutation();
  const [busy, wrap] = useBusy();
  const { shortfallMinutes, excessMinutes, aligned, conflicts, course } = detail;
  if (shortfallMinutes === 0 && excessMinutes === 0 && aligned && conflicts.length === 0) return null;

  return (
    <div className="mb-5 space-y-px">
      {shortfallMinutes > 0 ? (
        <NoticeRow>
          {formatHours(shortfallMinutes)} ore del monte ore non sono coperte dalle fasi di calendarizzazione.
        </NoticeRow>
      ) : null}
      {excessMinutes > 0 ? (
        <NoticeRow>
          Le lezioni bloccate superano il monte ore di {formatHours(excessMinutes)} ore.
        </NoticeRow>
      ) : null}
      {!aligned ? (
        <NoticeRow
          action={
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                wrap(() =>
                  run((confirm) => recalculateCourseAction(course.id, confirm), {
                    success: "Calendario ricalcolato",
                  }),
                )
              }
            >
              <RefreshCwIcon /> Ricalcola
            </Button>
          }
        >
          Alcune lezioni programmate non corrispondono più alla calendarizzazione.
        </NoticeRow>
      ) : null}
      {conflicts.length > 0 ? (
        <div className="border-b py-3">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-warn">
            <AlertTriangleIcon className="size-4" />
            {plural(conflicts.length, "sovrapposizione", "sovrapposizioni")} con altri corsi
          </div>
          <ConflictList conflicts={conflicts} />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendarizzazione
// ---------------------------------------------------------------------------

function weekdaysLabel(mask: number) {
  const days = maskToWeekdays(mask);
  return days.length === 1 ? WEEKDAY_NAMES[days[0]] : days.map((d) => WEEKDAY_SHORT[d]).join(" + ");
}

type Phase = { validFrom: string; validTo: string | null; rules: CourseDetail["rules"] };

/** Una fase in una riga: giorni e orario a sinistra, periodo a destra. */
function PhaseRow({
  phase,
  today,
  onDelete,
}: {
  phase: Phase;
  today: string;
  onDelete: (() => void) | null;
}) {
  const active = phase.validFrom <= today && (phase.validTo === null || today <= phase.validTo);
  return (
    <li
      className={cn(
        "group/rule flex items-baseline gap-x-3 gap-y-0.5 border-l-2 py-1.5 pl-2.5",
        active ? "border-accent-ink" : "border-border",
      )}
    >
      <span className="min-w-0 flex-1">
        {phase.rules.map((r) => (
          <span key={r.id} className="mr-3 whitespace-nowrap text-[13px]">
            {weekdaysLabel(r.weekdaysMask)}
            <span className="tabular ml-1.5 text-muted-foreground">
              {formatTimeRange(r.startMin, r.endMin)}
            </span>
          </span>
        ))}
      </span>
      <span className="tabular shrink-0 text-xs text-muted-foreground">
        {phase.validTo
          ? `${formatDateIT(phase.validFrom)} → ${formatDateIT(phase.validTo)}`
          : `dal ${formatDateIT(phase.validFrom)}`}
      </span>
      {active ? <span className="shrink-0 text-[11px] text-accent-ink">attiva</span> : null}
      {onDelete ? (
        <span className="shrink-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover/rule:opacity-100 [@media(hover:none)]:opacity-100">
          <IconButton label="Elimina questa fase" tone="danger" onClick={onDelete}>
            <Trash2Icon className="size-[15px]" />
          </IconButton>
        </span>
      ) : null}
    </li>
  );
}

/**
 * Le lezioni dettate una per una: in riga sola, con il dettaglio a richiesta.
 * Vengono da un calendario che l'agenzia ha fissato data per data.
 */
function SingleDayPhases({ phases, today }: { phases: Phase[]; today: string }) {
  const [aperto, setAperto] = useState(false);
  const prima = phases[0];
  const ultima = phases.at(-1)!;
  return (
    <>
      <li className="flex items-baseline gap-x-3 border-l-2 border-border py-1.5 pl-2.5">
        <span className="min-w-0 flex-1 text-[13px]">
          {phases.length} {phases.length === 1 ? "lezione a data fissa" : "lezioni a date fisse"}
        </span>
        <span className="tabular shrink-0 text-xs text-muted-foreground">
          {formatDateIT(prima.validFrom)} → {formatDateIT(ultima.validFrom)}
        </span>
        <button
          type="button"
          className="shrink-0 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          onClick={() => setAperto((v) => !v)}
        >
          {aperto ? "nascondi" : "mostra"}
        </button>
      </li>
      {aperto
        ? phases.map((phase) => (
            <li
              key={phase.validFrom}
              className={cn(
                "tabular flex items-baseline gap-x-3 border-l-2 py-1 pl-6 text-xs",
                phase.validFrom === today ? "border-accent-ink" : "border-border",
              )}
            >
              <span className="min-w-0 flex-1">{shortDay(phase.validFrom)}</span>
              <span className="shrink-0 text-muted-foreground">
                {phase.rules.map((r) => formatTimeRange(r.startMin, r.endMin)).join(" · ")}
              </span>
            </li>
          ))
        : null}
    </>
  );
}

export function ScheduleSection({ detail, today }: Props) {
  const run = useMutation();
  const [mode, setMode] = useState<ScheduleFormMode | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { rules, course } = detail;

  // Più righe orario possono convivere nello stesso periodo: si mostrano insieme.
  const phases = useMemo(() => {
    const map = new Map<string, { validFrom: string; validTo: string | null; rules: typeof rules }>();
    for (const rule of rules) {
      const key = `${rule.validFrom}|${rule.validTo ?? ""}`;
      const phase = map.get(key);
      if (phase) phase.rules.push(rule);
      else map.set(key, { validFrom: rule.validFrom, validTo: rule.validTo, rules: [rule] });
    }
    return [...map.values()].sort((a, b) => (a.validFrom < b.validFrom ? -1 : 1));
  }, [rules]);

  /**
   * Le fasi di un solo giorno si accorpano in una riga sola.
   *
   * Un calendario dettato dall'agenzia, data per data, diventa una fase per
   * lezione: venti righe uguali che riempiono mezza pagina e non dicono niente
   * più di "queste date". Si contano e si aprono se servono.
   */
  const gruppi = useMemo(() => {
    const out: { singole: typeof phases; fase: (typeof phases)[number] | null }[] = [];
    let correnti: typeof phases = [];
    for (const phase of phases) {
      if (phase.validTo === phase.validFrom) {
        correnti.push(phase);
        continue;
      }
      out.push({ singole: correnti, fase: phase });
      correnti = [];
    }
    if (correnti.length > 0) out.push({ singole: correnti, fase: null });
    return out;
  }, [phases]);

  const ultimaFaseId = phases.at(-1)?.rules.at(-1)?.id ?? null;

  return (
    <Section
      title="Calendarizzazione"
      actions={
        <>
          <IconButton label="Aggiungi un giorno di lezione" onClick={() => setMode("add")}>
            <CalendarPlusIcon className="size-[15px]" />
          </IconButton>
          <IconButton label="Cambia calendarizzazione" tone="accent" onClick={() => setMode("change")}>
            <CalendarClockIcon className="size-[15px]" />
          </IconButton>
        </>
      }
    >
      {rules.length === 0 ? (
        <EmptyState>Nessuna fase di calendarizzazione.</EmptyState>
      ) : (
        <ol className="space-y-px">
          {gruppi.map(({ singole, fase }, i) => (
            <Fragment key={fase ? `${fase.validFrom}-${fase.validTo ?? "aperta"}` : `singole-${i}`}>
              {singole.length > 0 ? (
                <SingleDayPhases phases={singole} today={today} />
              ) : null}
              {fase ? (
                <PhaseRow
                  phase={fase}
                  today={today}
                  onDelete={
                    phases.length > 1 && fase.rules.at(-1)!.id === ultimaFaseId
                      ? () => setDeleteId(fase.rules.at(-1)!.id)
                      : null
                  }
                />
              ) : null}
            </Fragment>
          ))}
        </ol>
      )}

      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{mode === "add" ? "Aggiungi un giorno di lezione" : "Cambia calendarizzazione"}</DialogTitle>
            <DialogDescription>
              {mode === "add"
                ? "I giorni già calendarizzati restano come sono: il nuovo giorno si aggiunge dalla data indicata e le lezioni future vengono ridistribuite sul monte ore."
                : "La nuova fase sostituisce tutte le righe orario dalla data indicata in poi. Le lezioni precedenti restano invariate; svolte, annullate e modificate a mano non vengono toccate."}
            </DialogDescription>
          </DialogHeader>
          {mode ? (
            <ScheduleChangeForm key={mode} mode={mode} detail={detail} today={today} onDone={() => setMode(null)} />
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Eliminare l'ultima fase?"
        description="Le righe orario di questa fase vengono eliminate; se aveva chiuso la fase precedente, quella torna valida. Le lezioni programmate future vengono ricalcolate."
        confirmLabel="Elimina fase"
        destructive
        onConfirm={() => {
          const id = deleteId!;
          void run((confirm) => deleteScheduleRuleAction(course.id, id, confirm), { success: "Fase eliminata" });
        }}
      />
    </Section>
  );
}

type ScheduleFormMode = "change" | "add";

function ScheduleChangeForm({
  mode,
  detail,
  today,
  onDone,
}: Props & { mode: ScheduleFormMode; onDone: () => void }) {
  const run = useMutation();
  const [busy, wrap] = useBusy();
  const { course, rules, lessons, pauses } = detail;
  const nextPlanned = lessons.find((l) => l.status === "PLANNED" && l.date >= today)?.date;
  const [validFrom, setValidFrom] = useState(() =>
    mode === "add" ? maxDate(today, course.startDate) : maxDate(nextPlanned ?? today, course.startDate),
  );
  // Il cambio parte dalle righe in vigore (di solito si cambia poco); l'aggiunta da una riga vuota.
  const [blocks, setBlocks] = useState<BlockDraft[]>(() => {
    if (mode === "add") return [emptyBlock()];
    const attive = rules.filter((r) => r.validTo === null);
    const base = attive.length > 0 ? attive : rules.slice(-1);
    return base.length > 0
      ? base.map((r) => ({
          mask: r.weekdaysMask,
          start: formatTime(r.startMin),
          end: formatTime(r.endMin),
          from: r.validFrom > validFrom ? r.validFrom : "",
        }))
      : [emptyBlock()];
  });

  const parsed = useMemo(() => {
    if (!isValidISODate(validFrom) || validFrom < course.startDate) return null;
    const schedule = blocksToSchedule(blocks, validFrom);
    if ("error" in schedule) return null;
    const input = { validFrom, blocks: schedule };
    if (mode === "change") return { input, rules: planScheduleChange(rules, input, []).rules, clash: null };
    const plan = planAddDays(rules, input, []);
    return { input, rules: plan.rules, clash: plan.clash };
  }, [mode, validFrom, blocks, course.startDate, rules]);
  const input = parsed && parsed.clash === null ? parsed.input : null;

  const preview = useMemo(() => {
    if (!parsed || parsed.clash !== null) return null;
    return recalculateSchedule({
      courseStartDate: course.startDate,
      totalMinutes: course.totalMinutes,
      rules: parsed.rules,
      pauses,
      existing: lessons,
      from: parsed.input.validFrom,
      notBefore: today,
    });
  }, [parsed, pauses, lessons, course, today]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!input) return;
    await wrap(async () => {
      const action = mode === "add" ? addScheduleDaysAction : changeScheduleAction;
      const result = await run((confirm) => action(course.id, input, confirm), {
        success: mode === "add" ? "Giorno aggiunto" : "Calendarizzazione aggiornata",
      });
      if (result?.ok) onDone();
    });
  }

  return (
    <form onSubmit={save} className="grid gap-3">
      <Field label={mode === "add" ? "A partire dal" : "Valida dal"} htmlFor="rule-from" className="max-w-[200px]">
        <Input
          id="rule-from"
          type="date"
          min={course.startDate}
          value={validFrom}
          onChange={(e) => setValidFrom(e.target.value)}
          required
        />
      </Field>
      <ScheduleBlocksEditor
        value={blocks}
        onChange={setBlocks}
        idPrefix="rule"
        minFrom={isValidISODate(validFrom) ? validFrom : ""}
      />
      {parsed && parsed.clash !== null ? (
        <p className="text-sm text-danger">
          {WEEKDAY_NAMES[parsed.clash as 1]} è già calendarizzato in quel periodo: per cambiarne l&apos;orario usa
          &quot;Cambia calendarizzazione&quot;.
        </p>
      ) : null}
      {preview ? (
        <div className="rounded-lg bg-muted p-3 text-sm">
          <div>
            Fine prevista: <strong>{formatDateIT(detail.expectedEndDate)}</strong> →{" "}
            <strong>{formatDateIT(preview.expectedEndDate)}</strong>
          </div>
          <div className="text-xs text-muted-foreground">
            dal {formatDateIT(input!.validFrom)}: {preview.insert.length} lezioni nuove, {preview.removeIds.length}{" "}
            rimosse
            {preview.shortfallMinutes > 0 ? ` · ${formatHours(preview.shortfallMinutes)} h non calendarizzabili` : ""}
          </div>
        </div>
      ) : null}
      <DialogFooter>
        <Button type="submit" disabled={!input || busy}>
          {busy ? <Loader2Icon className="animate-spin" /> : null}
          {mode === "add" ? "Aggiungi dal" : "Applica dal"} {isValidISODate(validFrom) ? formatDateIT(validFrom) : "…"}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Prelezione
// ---------------------------------------------------------------------------

export function PreLessonSection({ detail }: Props) {
  const run = useMutation();
  const [busy, wrap] = useBusy();
  const { course, preLesson, preLessonConflict } = detail;
  const [present, setPresent] = useState(preLesson !== null);
  const [date, setDate] = useState(preLesson?.date ?? "");
  const [start, setStart] = useState(preLesson?.startMin != null ? formatTime(preLesson.startMin) : "");
  const [removeOpen, setRemoveOpen] = useState(false);

  const end = isValidTime(start) ? formatTime(parseTime(start) + 60) : "—";
  const dirty =
    present !== (preLesson !== null) ||
    (present &&
      (date !== (preLesson?.date ?? "") ||
        start !== (preLesson?.startMin != null ? formatTime(preLesson.startMin) : "")));

  async function segna(status: LessonStatus) {
    await wrap(async () => {
      const result = await setPreLessonStatusAction(course.id, status);
      if (result.ok) toast.success("Prelezione aggiornata");
      else toast.error(result.error);
    });
  }

  async function save() {
    if (!present) {
      await wrap(() =>
        run((confirm) => setPreLessonAction(course.id, null, confirm), { success: "Prelezione rimossa" }),
      );
      return;
    }
    const hasDate = isValidISODate(date);
    const hasTime = isValidTime(start);
    if (hasDate !== hasTime) {
      toast.error("Indica data e ora di inizio della prelezione (o lasciale entrambe vuote).");
      return;
    }
    await wrap(() =>
      run(
        (confirm) =>
          setPreLessonAction(
            course.id,
            { date: hasDate ? date : null, startMin: hasTime ? parseTime(start) : null },
            confirm,
          ),
        { success: "Prelezione salvata" },
      ),
    );
  }

  return (
    <Section
      title="Prelezione"
      actions={
        dirty ? (
          <Button size="sm" disabled={busy} onClick={() => (!present && preLesson?.date ? setRemoveOpen(true) : void save())}>
            {busy ? <Loader2Icon className="animate-spin" /> : null}
            Salva
          </Button>
        ) : null
      }
    >
      <label className="flex items-center gap-2 py-1 text-sm font-medium">
        <Checkbox checked={present} onCheckedChange={(v) => setPresent(Boolean(v))} />
        Prelezione presente
      </label>
      {present && preLesson?.date ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <LessonStatusMark status={preLesson.status} />
          <span className="text-[13px] text-muted-foreground">{STATO_PRELEZIONE[preLesson.status]}</span>
          <span className="ml-auto flex items-center gap-1.5">
            {preLesson.status !== "COMPLETED" ? (
              <IconButton label="Segna la prelezione come svolta" tone="ok" onClick={() => void segna("COMPLETED")} disabled={busy}>
                <CheckIcon className="size-[15px]" />
              </IconButton>
            ) : null}
            {preLesson.status !== "CANCELLED" ? (
              <IconButton label="Segna la prelezione come annullata" tone="danger" onClick={() => void segna("CANCELLED")} disabled={busy}>
                <XIcon className="size-[15px]" />
              </IconButton>
            ) : null}
            {preLesson.status !== "PLANNED" ? (
              <IconButton label="Riporta la prelezione in programma" onClick={() => void segna("PLANNED")} disabled={busy}>
                <UndoIcon className="size-[15px]" />
              </IconButton>
            ) : null}
          </span>
        </div>
      ) : null}
      {present ? (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Data" htmlFor="pre-date" className="col-span-2 sm:col-span-1">
            <Input id="pre-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Ora inizio" htmlFor="pre-start">
            <Input id="pre-start" type="time" step={300} value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Ora fine">
            <div className="tabular flex h-8 items-center text-sm text-muted-foreground">{end}</div>
          </Field>
        </div>
      ) : null}
      <p className="mt-2 text-xs text-muted-foreground">
        Un&apos;ora, fuori dal monte ore: occupa calendario e disponibilità, e va segnata come le lezioni.
        {preLesson && !preLesson.date ? " Data e orario ancora da definire." : ""}
      </p>
      {preLessonConflict ? (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-warn">
          <AlertTriangleIcon className="size-3.5" /> Si sovrappone a un altro corso.
        </p>
      ) : null}
      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title="Rimuovere la prelezione?"
        description={`La prelezione del ${formatDateIT(preLesson?.date)} verrà eliminata.`}
        confirmLabel="Rimuovi"
        destructive
        onConfirm={() => void save()}
      />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Lezioni
// ---------------------------------------------------------------------------

const STATO_PRELEZIONE: Record<LessonStatus, string> = {
  PLANNED: "In programma",
  COMPLETED: "Svolta",
  CANCELLED: "Annullata",
};

type Filter = "all" | "todo" | "next";

export function LessonsSection({ detail, today }: Props) {
  const { lessons, conflictLessonIds, skipped } = detail;
  const [filter, setFilter] = useState<Filter>("all");
  const conflictSet = useMemo(() => new Set(conflictLessonIds), [conflictLessonIds]);

  const rows = useMemo(() => {
    let n = 0;
    return lessons.map((l) => ({
      lesson: l,
      number: l.status === "CANCELLED" ? null : ++n,
      overdue: l.status === "PLANNED" && l.date < today,
    }));
  }, [lessons, today]);

  const todoCount = rows.filter((r) => r.overdue).length;
  const validCount = rows.filter((r) => r.number !== null).length;
  const cancelledCount = rows.length - validCount;

  const visible = rows.filter(({ lesson, overdue }) => {
    if (filter === "todo") return overdue;
    if (filter === "next") return lesson.status === "PLANNED" && lesson.date >= today;
    return true;
  });

  // Raggruppamento per mese: 78 righe diventano navigabili.
  const months = useMemo(() => {
    const map = new Map<string, typeof visible>();
    for (const row of visible) {
      const key = row.lesson.date.slice(0, 7);
      const list = map.get(key);
      if (list) list.push(row);
      else map.set(key, [row]);
    }
    return [...map.entries()];
  }, [visible]);

  return (
    <Section
      title={
        <>
          Lezioni{" "}
          <span className="tabular font-normal text-muted-foreground">
            {validCount} valide{cancelledCount > 0 ? ` · ${cancelledCount} annullate` : ""}
          </span>
        </>
      }
      actions={
        <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
          {(
            [
              ["all", "Tutte", null],
              ["todo", "Da segnare", todoCount],
              ["next", "Prossime", null],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs transition-colors",
                filter === value ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              {count ? <span className="tabular ml-1 text-warn">{count}</span> : null}
            </button>
          ))}
        </div>
      }
    >
      {visible.length === 0 ? (
        <EmptyState>{filter === "todo" ? "Nessuna lezione da segnare." : "Nessuna lezione."}</EmptyState>
      ) : (
        <div data-testid="lessons">
        {months.map(([month, list]) => {
          const { year, month: m } = parseISODate(`${month}-01`);
          const minutes = list
            .filter((r) => r.lesson.status !== "CANCELLED")
            .reduce((s, r) => s + r.lesson.endMin - r.lesson.startMin, 0);
          return (
            <div key={month}>
              <div className="label-group flex items-baseline justify-between pb-1.5 pt-4">
                <span>
                  {MONTH_NAMES[m - 1]} {year}
                </span>
                <span className="tabular tracking-normal">
                  {formatHours(minutes)} h · {plural(list.length, "lezione", "lezioni")}
                </span>
              </div>
              <ul>
                {list.map(({ lesson, number, overdue }) => (
                  <li
                    key={lesson.id}
                    className={cn(
                      "group/row hairline flex flex-wrap items-center gap-x-3 gap-y-2 py-2 text-[13.5px] md:flex-nowrap",
                      overdue && "-mx-2 rounded-md bg-warn-tint px-2 shadow-[inset_2px_0_0_var(--warn)]",
                    )}
                  >
                    <span className="tabular w-5 shrink-0 text-right text-xs text-muted-foreground">
                      {number ?? "–"}
                    </span>
                    <LessonStatusMark status={lesson.status} overdue={overdue} />
                    <span
                      className={cn(
                        "tabular w-[104px] shrink-0",
                        lesson.status === "CANCELLED" && "text-muted-foreground line-through",
                        overdue && "font-medium",
                      )}
                    >
                      {shortDay(lesson.date)}
                    </span>
                    <span
                      className={cn(
                        "tabular w-[104px] shrink-0 text-muted-foreground",
                        lesson.status === "CANCELLED" && "line-through",
                      )}
                    >
                      {formatTimeRange(lesson.startMin, lesson.endMin)}
                    </span>
                    <span className="tabular hidden w-12 shrink-0 text-xs text-muted-foreground sm:block">
                      {formatDuration(lesson.endMin - lesson.startMin)}
                    </span>
                    <span className="flex min-w-0 flex-1 items-center gap-2 text-xs">
                      {overdue ? <span className="text-warn">da segnare</span> : null}
                      {lesson.status === "CANCELLED" ? <span className="text-danger">annullata</span> : null}
                      {lesson.isManual ? (
                        <Badge variant="outline" className="font-normal">
                          manuale
                        </Badge>
                      ) : null}
                      {conflictSet.has(lesson.id) ? <ConflictMark /> : null}
                    </span>

                    {/* Desktop: le icone compaiono al passaggio del mouse. Dove il
                        mouse non c'è — un tablet — restano visibili, altrimenti
                        non ci sarebbe modo di farle comparire. */}
                    <span
                      className={cn(
                        "hidden shrink-0 gap-1 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100 md:flex",
                        overdue ? "opacity-100" : "opacity-0 [@media(hover:none)]:opacity-100",
                      )}
                    >
                      <LessonStatusActions lesson={lesson} />
                      <LessonEditButton lesson={lesson} />
                    </span>

                    {/* Telefono: azioni ampie, su ogni lezione. Una lezione finita
                        si segna la sera stessa, e quel giorno non è ancora "in
                        ritardo": mostrarle solo allora lasciava il telefono senza
                        modo di segnarla. */}
                    <span className="flex w-full shrink-0 gap-2 md:hidden">
                      <LessonStatusActions lesson={lesson} touch />
                      <LessonEditButton lesson={lesson} touch />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        </div>
      )}

      {skipped.length > 0 ? (
        <div className="mt-5 border-t pt-3">
          <div className="label-group mb-1.5">Date escluse</div>
          <ul className="flex flex-wrap gap-1.5 text-xs">
            {skipped.map((s) => (
              <li
                key={s.date}
                className={cn(
                  "tabular rounded border px-1.5 py-0.5",
                  s.reason === "HOLIDAY"
                    ? "border-danger-line bg-danger-tint text-danger"
                    : "border-border bg-muted text-muted-foreground",
                )}
              >
                {shortDay(s.date)} · {s.reason === "HOLIDAY" ? s.label : "pausa"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Pause
// ---------------------------------------------------------------------------

type PauseRow = CourseDetail["pauses"][number];

export function PausesSection({ detail, today }: Props) {
  const run = useMutation();
  const [editing, setEditing] = useState<PauseRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<PauseRow | null>(null);

  return (
    <Section
      title="Pause"
      actions={
        <IconButton label="Aggiungi pausa" onClick={() => setEditing("new")}>
          <PlusIcon className="size-[15px]" />
        </IconButton>
      }
    >
      {detail.pauses.length === 0 ? (
        <EmptyState>Nessuna pausa.</EmptyState>
      ) : (
        <ul>
          {detail.pauses.map((p) => (
            <li key={p.id} className="group/pause hairline flex items-center justify-between gap-2 py-2.5">
              <div>
                <div className="tabular text-[13.5px]">
                  {formatDateIT(p.startDate)} → {formatDateIT(p.endDate)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {plural(diffDays(p.endDate, p.startDate) + 1, "giorno", "giorni")}, estremi inclusi
                </div>
              </div>
              <div className="flex gap-1 opacity-100 transition-opacity md:opacity-0 md:focus-within:opacity-100 md:group-hover/pause:opacity-100">
                <IconButton label="Modifica pausa" onClick={() => setEditing(p)}>
                  <PencilIcon className="size-[15px]" />
                </IconButton>
                <IconButton label="Elimina pausa" tone="danger" onClick={() => setDeleting(p)}>
                  <Trash2Icon className="size-[15px]" />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Aggiungi pausa" : "Modifica pausa"}</DialogTitle>
            <DialogDescription>
              Nessuna lezione verrà generata tra le due date (incluse). Le date future vengono ricalcolate.
            </DialogDescription>
          </DialogHeader>
          {editing !== null ? (
            <PauseForm
              key={editing === "new" ? "new" : editing.id}
              detail={detail}
              today={today}
              pause={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Eliminare la pausa?"
        description={
          deleting
            ? `Pausa ${formatDateIT(deleting.startDate)} → ${formatDateIT(deleting.endDate)}: le lezioni future verranno ricalcolate.`
            : ""
        }
        confirmLabel="Elimina pausa"
        destructive
        onConfirm={() => {
          const id = deleting!.id;
          void run((confirm) => deletePauseAction(id, confirm), { success: "Pausa eliminata" });
        }}
      />
    </Section>
  );
}

function PauseForm({
  detail,
  today,
  pause,
  onDone,
}: {
  detail: CourseDetail;
  today: string;
  pause: PauseRow | null;
  onDone: () => void;
}) {
  const run = useMutation();
  const [busy, wrap] = useBusy();
  const [startDate, setStartDate] = useState(pause?.startDate ?? "");
  const [endDate, setEndDate] = useState(pause?.endDate ?? "");
  const valid = isValidISODate(startDate) && isValidISODate(endDate) && startDate <= endDate;

  const preview = useMemo(() => {
    if (!valid) return null;
    const pauses = detail.pauses
      .filter((p) => p.id !== pause?.id)
      .concat([
        { ...(pause ?? { id: -1, courseId: detail.course.id, createdAt: "", updatedAt: "" }), startDate, endDate },
      ]);
    return recalculateSchedule({
      courseStartDate: detail.course.startDate,
      totalMinutes: detail.course.totalMinutes,
      rules: detail.rules,
      pauses,
      existing: detail.lessons,
      from: pause ? minDate(pause.startDate, startDate) : startDate,
      notBefore: today,
    });
  }, [valid, detail, pause, startDate, endDate, today]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;
    await wrap(async () => {
      const input = { startDate, endDate };
      const result = await run(
        (confirm) =>
          pause ? updatePauseAction(pause.id, input, confirm) : addPauseAction(detail.course.id, input, confirm),
        { success: pause ? "Pausa aggiornata" : "Pausa aggiunta" },
      );
      if (result?.ok) onDone();
    });
  }

  return (
    <form onSubmit={save} className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Dal" htmlFor="pause-start">
          <Input id="pause-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </Field>
        <Field label="Al (incluso)" htmlFor="pause-end">
          <Input
            id="pause-end"
            type="date"
            min={startDate || undefined}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
          />
        </Field>
      </div>
      {preview ? (
        <div className="rounded-lg bg-muted p-3 text-sm">
          Fine prevista: <strong>{formatDateIT(detail.expectedEndDate)}</strong> →{" "}
          <strong>{formatDateIT(preview.expectedEndDate)}</strong>
          <div className="text-xs text-muted-foreground">
            {plural(
              preview.skipped.filter((s) => s.reason === "PAUSE").length,
              "lezione saltata",
              "lezioni saltate",
            )}{" "}
            per pausa
          </div>
        </div>
      ) : null}
      <DialogFooter>
        <Button type="submit" disabled={!valid || busy}>
          {busy ? <Loader2Icon className="animate-spin" /> : null}
          Salva pausa
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Note
// ---------------------------------------------------------------------------

export function NotesSection({ detail }: Props) {
  const [notes, setNotes] = useState(detail.course.notes);
  const [saved, setSaved] = useState(detail.course.notes);
  const [busy, wrap] = useBusy();

  async function save() {
    await wrap(async () => {
      const result = await updateNotesAction(detail.course.id, notes);
      if (result.ok) {
        setSaved(notes);
        toast.success("Note salvate");
      } else toast.error(result.error);
    });
  }

  return (
    <Section
      title="Note"
      actions={
        notes !== saved ? (
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : null}
            Salva note
          </Button>
        ) : null
      }
    >
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={5}
        placeholder="Note sul corso…"
        className="border-transparent bg-muted/50 focus-visible:border-ring"
      />
    </Section>
  );
}

export function BackToList({ status }: { status: CourseStatus }) {
  return (
    <Link
      href={status === "COMPLETED" ? "/archivio" : "/corsi"}
      className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2 text-muted-foreground")}
    >
      <ChevronLeftIcon /> {status === "COMPLETED" ? "Archivio" : "Corsi"}
    </Link>
  );
}
