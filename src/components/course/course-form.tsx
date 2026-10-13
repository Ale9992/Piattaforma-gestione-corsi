"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, Loader2Icon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";
import { Field, Section, nativeSelectClass } from "@/components/common";
import { useMutation } from "@/components/mutation-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScheduleBlocksEditor, blocksToSchedule, emptyBlock, type BlockDraft } from "@/components/schedule-blocks";
import {
  addDays,
  formatDateWithWeekday,
  formatHours,
  formatTime,
  formatTimeRange,
  isValidISODate,
  isValidTime,
  parseTime,
  weekdayOf,
} from "@/lib/dates";
import type { ParsedCourseDraft } from "@/lib/deepseek/parser";
import { COURSE_STATUS_LABEL } from "@/lib/format";
import { generateSchedule } from "@/lib/scheduling/generateSchedule";
import { blockToRule } from "@/lib/scheduling/rules";
import {
  maskHasWeekday,
  weekdayBit,
  weekdaysToMask,
  type CourseStatus,
  type ScheduleRuleInput,
} from "@/lib/scheduling/types";
import { createCourseAction, parseEmailAction } from "@/server/actions";

interface FormState {
  name: string;
  clientCompany: string;
  mode: string;
  studentsCount: string;
  studentReference: string;
  assignmentNumber: string;
  clientContact: string;
  /** Compenso pattuito, in euro come si scrive ("338" o "338,50"). */
  fee: string;
  totalHours: string;
  startDate: string;
  /** Righe orario: più di una quando i giorni hanno orari diversi. */
  blocks: BlockDraft[];
  hasFirstLesson: boolean;
  firstDate: string;
  firstStart: string;
  firstEnd: string;
  hasPreLesson: boolean;
  preDate: string;
  preStart: string;
  status: CourseStatus;
  notes: string;
}

const EMPTY: FormState = {
  name: "",
  clientCompany: "",
  mode: "",
  studentsCount: "",
  studentReference: "",
  assignmentNumber: "",
  clientContact: "",
  fee: "",
  totalHours: "",
  startDate: "",
  blocks: [emptyBlock()],
  hasFirstLesson: false,
  firstDate: "",
  firstStart: "",
  firstEnd: "",
  hasPreLesson: false,
  preDate: "",
  preStart: "",
  status: "NOT_STARTED",
  notes: "",
};

/** "28" / "27,5" → minuti; null se non valido. */
export function hoursToMinutes(value: string): number | null {
  const n = Number(value.trim().replace(",", "."));
  if (!value.trim() || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 60);
}

function timeRange(start: string, end: string) {
  if (!isValidTime(start) || !isValidTime(end)) return null;
  const startMin = parseTime(start);
  const endMin = parseTime(end);
  return startMin < endMin ? { startMin, endMin } : null;
}

function applyDraft(prev: FormState, d: ParsedCourseDraft): FormState {
  return {
    ...prev,
    name: d.name || prev.name,
    clientCompany: d.clientCompany || prev.clientCompany,
    mode: d.mode || prev.mode,
    studentsCount: d.studentsCount !== null ? String(d.studentsCount) : prev.studentsCount,
    studentReference: d.studentReference || prev.studentReference,
    assignmentNumber: d.assignmentNumber || prev.assignmentNumber,
    totalHours: d.totalHours !== null ? String(d.totalHours).replace(".", ",") : prev.totalHours,
    startDate: d.startDate ?? prev.startDate,
    blocks:
      d.schedule.length > 0
        ? d.schedule.map((b) => ({
            mask: weekdaysToMask(b.days),
            start: b.startTime ?? "",
            end: b.endTime ?? "",
            from: b.startDate ?? "",
          }))
        : prev.blocks,
    hasFirstLesson: d.firstLesson !== null,
    firstDate: d.firstLesson?.date ?? "",
    firstStart: d.firstLesson?.startTime ?? "",
    firstEnd: d.firstLesson?.endTime ?? "",
    hasPreLesson: d.preLesson !== null,
    preDate: d.preLesson?.date ?? "",
    preStart: d.preLesson?.startTime ?? "",
  };
}

function buildPayload(s: FormState): { payload: unknown } | { error: string } {
  if (!s.name.trim()) return { error: "Inserisci il nome del corso." };
  const totalMinutes = hoursToMinutes(s.totalHours);
  if (!totalMinutes) return { error: "Inserisci un monte ore valido." };
  if (!isValidISODate(s.startDate)) return { error: "Inserisci la data di inizio corso." };
  const schedule = blocksToSchedule(s.blocks, s.startDate);
  if ("error" in schedule) return { error: schedule.error };

  let studentsCount: number | null = null;
  if (s.studentsCount.trim()) {
    studentsCount = Number(s.studentsCount);
    if (!Number.isInteger(studentsCount) || studentsCount < 0) return { error: "Numero allievi non valido." };
  }

  // Importo pattuito: facoltativo, si scrive in euro.
  let feeCents: number | null = null;
  if (s.fee.trim()) {
    const valore = Number(s.fee.trim().replace(/[€\s.]/g, "").replace(",", "."));
    if (!Number.isFinite(valore) || valore < 0) return { error: "Importo non valido." };
    feeCents = Math.round(valore * 100);
  }

  let firstLesson = null;
  if (s.hasFirstLesson) {
    const range = timeRange(s.firstStart, s.firstEnd);
    if (!isValidISODate(s.firstDate) || !range) return { error: "Prima lezione: data o orario non validi." };
    firstLesson = { date: s.firstDate, ...range };
  }

  let preLesson = null;
  if (s.hasPreLesson) {
    const hasDate = isValidISODate(s.preDate);
    const hasTime = isValidTime(s.preStart);
    if (hasDate !== hasTime) return { error: "Prelezione: indica data e ora di inizio (o lasciale entrambe vuote)." };
    preLesson = { date: hasDate ? s.preDate : null, startMin: hasTime ? parseTime(s.preStart) : null };
  }

  return {
    payload: {
      name: s.name,
      clientCompany: s.clientCompany,
      mode: s.mode,
      studentsCount,
      studentReference: s.studentReference,
      assignmentNumber: s.assignmentNumber,
      clientContact: s.clientContact,
      feeCents,
      totalMinutes,
      startDate: s.startDate,
      notes: s.notes,
      status: s.status,
      schedule,
      firstLesson,
      preLesson,
    },
  };
}

function usePreview(s: FormState) {
  return useMemo(() => {
    const totalMinutes = hoursToMinutes(s.totalHours);
    const schedule = blocksToSchedule(s.blocks, s.startDate);
    if (!totalMinutes || !isValidISODate(s.startDate) || "error" in schedule) return null;

    const rules: ScheduleRuleInput[] = [];
    let mainFrom = s.startDate;
    const first = timeRange(s.firstStart, s.firstEnd);
    if (s.hasFirstLesson && isValidISODate(s.firstDate) && first && s.firstDate >= s.startDate) {
      rules.push({
        id: 1,
        validFrom: s.firstDate,
        validTo: s.firstDate,
        weekdaysMask: weekdayBit(weekdayOf(s.firstDate)),
        ...first,
      });
      mainFrom = addDays(s.firstDate, 1);
    }
    schedule.forEach((block, i) => {
      rules.push({ id: 10 + i, ...blockToRule(block, mainFrom) });
    });
    return generateSchedule({ from: s.startDate, remainingMinutes: totalMinutes, rules, pauses: [] });
  }, [s]);
}

export function CourseForm({
  parserConfigured,
  initialDraft,
  initialFeeCents,
  mailId,
}: {
  parserConfigured: boolean;
  /** Dati già estratti da una mail arrivata in "Posta". */
  initialDraft?: ParsedCourseDraft;
  /** Compenso letto dalla lettera d'incarico allegata alla mail. */
  initialFeeCents?: number | null;
  /** Mail di provenienza: alla creazione risulta gestita. */
  mailId?: number;
}) {
  const router = useRouter();
  const run = useMutation();
  const [state, setState] = useState<FormState>(() => {
    const base = initialDraft ? applyDraft(EMPTY, initialDraft) : EMPTY;
    return initialFeeCents != null
      ? { ...base, fee: (initialFeeCents / 100).toFixed(2).replace(".", ",") }
      : base;
  });
  const [email, setEmail] = useState("");
  const [parsing, setParsing] = useState(false);
  const [warnings, setWarnings] = useState<string[]>(initialDraft?.warnings ?? []);
  const [saving, setSaving] = useState(false);
  const preview = usePreview(state);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((prev) => ({ ...prev, [key]: value }));

  async function extract() {
    setParsing(true);
    try {
      const result = await parseEmailAction(email);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setState((prev) => applyDraft(prev, result.draft));
      setWarnings(result.draft.warnings);
      toast.success("Dati estratti: verificali prima di salvare.");
    } catch {
      toast.error("Server non raggiungibile.");
    } finally {
      setParsing(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const built = buildPayload(state);
    if ("error" in built) {
      toast.error(built.error);
      return;
    }
    setSaving(true);
    const result = await run((confirm) => createCourseAction(built.payload, confirm, mailId), {
      success: "Corso creato e calendario generato",
    });
    setSaving(false);
    if (result?.ok && result.courseId) router.push(`/corsi/${result.courseId}`);
  }

  // Solo i giorni che partono dall'inizio: quelli con una data propria arrivano dopo.
  const allDays = state.blocks
    .filter((b) => !b.from || b.from <= state.startDate)
    .reduce((mask, b) => mask | b.mask, 0);
  const startNotLessonDay =
    isValidISODate(state.startDate) &&
    allDays > 0 &&
    !state.hasFirstLesson &&
    !maskHasWeekday(allDays, weekdayOf(state.startDate));
  const preEnd = isValidTime(state.preStart) ? formatTime(parseTime(state.preStart) + 60) : "—";

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <form onSubmit={submit} className="space-y-4">
        <Section title="Incolla mail (opzionale)">
          <Textarea
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            rows={6}
            placeholder={"Corso: …\nModalità: …\nDurata: 28 ore\nFrequenza: martedì e giovedì\nOrario: dalle 14,00 alle 16,00\nData inizio corso: …"}
            className="font-mono text-xs"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={extract} disabled={parsing || !email.trim()}>
              {parsing ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
              Estrai dati con DeepSeek
            </Button>
            <span className="text-xs text-muted-foreground">
              {parserConfigured
                ? "I dati estratti compilano il form: nulla viene salvato senza conferma."
                : "DEEPSEEK_API_KEY non configurata: compila il form manualmente."}
            </span>
          </div>
          {warnings.length > 0 ? (
            <ul className="mt-2 space-y-1 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">
              {warnings.map((w) => (
                <li key={w} className="flex gap-1.5">
                  <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" /> {w}
                </li>
              ))}
            </ul>
          ) : null}
        </Section>

        <Section title="Dati corso">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome corso *" htmlFor="name" className="sm:col-span-2">
              <Input id="name" value={state.name} onChange={(e) => set("name", e.target.value)} required />
            </Field>
            <Field label="Azienda cliente" htmlFor="clientCompany">
              <Input
                id="clientCompany"
                value={state.clientCompany}
                onChange={(e) => set("clientCompany", e.target.value)}
              />
            </Field>
            <Field label="Modalità" htmlFor="mode">
              <Input id="mode" list="modes" value={state.mode} onChange={(e) => set("mode", e.target.value)} />
              <datalist id="modes">
                <option value="Videoconferenza" />
                <option value="Presenza" />
              </datalist>
            </Field>
            <Field label="Numero allievi" htmlFor="studentsCount">
              <Input
                id="studentsCount"
                inputMode="numeric"
                value={state.studentsCount}
                onChange={(e) => set("studentsCount", e.target.value)}
              />
            </Field>
            <Field label="Referente allievi" htmlFor="studentReference">
              <Input
                id="studentReference"
                value={state.studentReference}
                onChange={(e) => set("studentReference", e.target.value)}
              />
            </Field>
            <Field label="Importo" htmlFor="fee" hint="Euro, come sul contratto">
              <Input id="fee" inputMode="decimal" value={state.fee} onChange={(e) => set("fee", e.target.value)} />
            </Field>
            <Field label="Numero incarico" htmlFor="assignmentNumber" hint="Come nella mail: 260532">
              <Input
                id="assignmentNumber"
                value={state.assignmentNumber}
                onChange={(e) => set("assignmentNumber", e.target.value)}
              />
            </Field>
            <Field label="Referente cliente" htmlFor="clientContact">
              <Input
                id="clientContact"
                value={state.clientContact}
                onChange={(e) => set("clientContact", e.target.value)}
              />
            </Field>
            <Field label="Monte ore *" htmlFor="totalHours" hint="Es. 28 oppure 27,5">
              <Input
                id="totalHours"
                inputMode="decimal"
                value={state.totalHours}
                onChange={(e) => set("totalHours", e.target.value)}
                required
              />
            </Field>
            <Field label="Stato" htmlFor="status">
              <select
                id="status"
                className={nativeSelectClass}
                value={state.status}
                onChange={(e) => set("status", e.target.value as CourseStatus)}
              >
                <option value="NOT_STARTED">{COURSE_STATUS_LABEL.NOT_STARTED}</option>
                <option value="IN_PROGRESS">{COURSE_STATUS_LABEL.IN_PROGRESS}</option>
              </select>
            </Field>
          </div>
        </Section>

        <Section title="Calendarizzazione">
          <div className="flex flex-col gap-3">
            <Field label="Data inizio corso *" htmlFor="startDate" className="max-w-[200px]">
              <Input
                id="startDate"
                type="date"
                value={state.startDate}
                onChange={(e) => set("startDate", e.target.value)}
                required
              />
            </Field>
            <ScheduleBlocksEditor
              value={state.blocks}
              onChange={(blocks) => set("blocks", blocks)}
              minFrom={isValidISODate(state.startDate) ? state.startDate : ""}
            />
          </div>
          {startNotLessonDay ? (
            <p className="mt-2 text-xs text-amber-700">
              La data di inizio non cade in un giorno selezionato: la prima lezione sarà il primo giorno utile, oppure
              imposta una prima lezione diversa.
            </p>
          ) : null}

          <label className="mt-4 flex items-center gap-2 text-sm font-medium">
            <Checkbox checked={state.hasFirstLesson} onCheckedChange={(v) => set("hasFirstLesson", Boolean(v))} />
            Prima lezione con giorno/orario diverso
          </label>
          {state.hasFirstLesson ? (
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <Field label="Data prima lezione" htmlFor="firstDate">
                <Input
                  id="firstDate"
                  type="date"
                  value={state.firstDate}
                  onChange={(e) => set("firstDate", e.target.value)}
                />
              </Field>
              <Field label="Ora inizio" htmlFor="firstStart">
                <Input
                  id="firstStart"
                  type="time"
                  step={300}
                  value={state.firstStart}
                  onChange={(e) => set("firstStart", e.target.value)}
                />
              </Field>
              <Field label="Ora fine" htmlFor="firstEnd">
                <Input
                  id="firstEnd"
                  type="time"
                  step={300}
                  value={state.firstEnd}
                  onChange={(e) => set("firstEnd", e.target.value)}
                />
              </Field>
            </div>
          ) : null}
        </Section>

        <Section title="Prelezione">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox checked={state.hasPreLesson} onCheckedChange={(v) => set("hasPreLesson", Boolean(v))} />
            Prelezione presente
          </label>
          {state.hasPreLesson ? (
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <Field label="Data" htmlFor="preDate">
                <Input id="preDate" type="date" value={state.preDate} onChange={(e) => set("preDate", e.target.value)} />
              </Field>
              <Field label="Ora inizio" htmlFor="preStart">
                <Input
                  id="preStart"
                  type="time"
                  step={300}
                  value={state.preStart}
                  onChange={(e) => set("preStart", e.target.value)}
                />
              </Field>
              <Field label="Ora fine" hint="Sempre 1 ora, esclusa dal monte ore">
                <div className="flex h-8 items-center text-sm tabular-nums">{preEnd}</div>
              </Field>
            </div>
          ) : null}
        </Section>

        <Section title="Note">
          <Textarea value={state.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
        </Section>

        <div className="sticky bottom-16 z-10 flex justify-end gap-2 rounded-xl border bg-background/95 p-3 backdrop-blur md:bottom-2">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Annulla
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2Icon className="animate-spin" /> : null}
            Crea corso
          </Button>
        </div>
      </form>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <Section title="Anteprima calendario">
          {!preview ? (
            <p className="text-sm text-muted-foreground">
              Compila monte ore, data inizio, giorni e orario per vedere le lezioni generate.
            </p>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-muted-foreground">Lezioni</div>
                  <div className="text-lg font-semibold tabular-nums">{preview.lessons.length}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Fine prevista</div>
                  <div className="font-semibold tabular-nums">
                    {preview.lessons.length ? formatDateWithWeekday(preview.lessons.at(-1)!.date) : "—"}
                  </div>
                </div>
              </div>
              {preview.shortfallMinutes > 0 ? (
                <p className="text-xs text-amber-700">
                  {formatHours(preview.shortfallMinutes)} ore non calendarizzabili.
                </p>
              ) : null}
              {preview.skipped.length > 0 ? (
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Festività escluse</div>
                  <ul className="text-xs">
                    {preview.skipped.map((s) => (
                      <li key={s.date}>
                        {formatDateWithWeekday(s.date)} · {s.label}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <ol className="max-h-80 space-y-0.5 overflow-y-auto border-t pt-2 text-xs tabular-nums">
                {preview.lessons.map((l, i) => (
                  <li key={l.date} className="flex justify-between gap-2">
                    <span>
                      {i + 1}. {formatDateWithWeekday(l.date)}
                    </span>
                    <span className="text-muted-foreground">{formatTimeRange(l.startMin, l.endMin)}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </Section>
      </aside>
    </div>
  );
}
