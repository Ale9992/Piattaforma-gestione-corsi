"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckIcon, Loader2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { IconButton, Section } from "@/components/common";
import { useMutation } from "@/components/mutation-provider";
import { formatDateWithWeekday, formatTimeRange } from "@/lib/dates";
import { courseColor, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { setLessonStatusAction, setPreLessonStatusAction } from "@/server/actions";
import type { UnmarkedLesson } from "@/server/queries";

/**
 * Lezioni passate ancora "Programmata": si segnano da qui, senza aprire i corsi.
 * Nessun cambio automatico: svolta o annullata lo decidi tu.
 */
export function UnmarkedLessons({ lessons }: { lessons: UnmarkedLesson[] }) {
  const run = useMutation();
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);

  if (lessons.length === 0) return null;

  async function segna(lesson: UnmarkedLesson, status: "COMPLETED" | "CANCELLED") {
    setBusyId(lesson.id);
    try {
      const fatto = status === "COMPLETED";
      if (lesson.kind === "PRE_LESSON") {
        const result = await setPreLessonStatusAction(lesson.courseId, status);
        if (result.ok) {
          toast.success(fatto ? "Prelezione segnata come svolta" : "Prelezione annullata");
          router.refresh();
        } else toast.error(result.error);
        return;
      }
      const result = await run((confirm) => setLessonStatusAction(lesson.id, status, confirm), {
        success: fatto ? "Lezione segnata come svolta" : "Lezione annullata",
      });
      if (result?.ok) router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Section title={`Da segnare (${lessons.length})`}>
      <p className="mb-1 text-[13px] text-muted-foreground">
        {plural(lessons.length, "lezione passata", "lezioni passate")} in attesa: finché non {lessons.length === 1 ? "la segni" : "le segni"}, le ore svolte non tornano.
      </p>
      <ul className="space-y-px">
        {lessons.map((lesson) => (
          <li key={`${lesson.kind}-${lesson.id}`} className="hairline flex items-center gap-3 py-2.5">
            <span className="tabular w-[132px] shrink-0 text-[13px] text-muted-foreground">
              {formatDateWithWeekday(lesson.date).replace(/^\w/, (c) => c.toUpperCase())}
            </span>
            <span className={cn("h-7 w-[3px] shrink-0 rounded-full", courseColor(lesson.courseId).dot)} />
            <Link href={`/corsi/${lesson.courseId}`} className="min-w-0 flex-1 hover:underline">
              <span className="block truncate text-sm">{lesson.courseName}</span>
              <span className="tabular block truncate text-xs text-muted-foreground">
                {lesson.kind === "PRE_LESSON" ? "Prelezione · " : ""}
                {formatTimeRange(lesson.startMin, lesson.endMin)}
                {lesson.clientCompany ? ` · ${lesson.clientCompany}` : ""}
              </span>
            </Link>
            <span className="flex shrink-0 items-center gap-1.5">
              {busyId === lesson.id ? (
                <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <>
                  <IconButton
                    label="Segna come svolta"
                    tone="ok"
                    onClick={() => segna(lesson, "COMPLETED")}
                    disabled={busyId !== null}
                  >
                    <CheckIcon className="size-[15px]" />
                  </IconButton>
                  <IconButton
                    label="Segna come annullata"
                    tone="danger"
                    onClick={() => segna(lesson, "CANCELLED")}
                    disabled={busyId !== null}
                  >
                    <XIcon className="size-[15px]" />
                  </IconButton>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
