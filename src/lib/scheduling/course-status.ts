import type { ISODate } from "@/lib/dates";
import type { CourseStatus, LessonStatus } from "./types";

/**
 * Stato del corso mostrato nell'applicazione. "In corso" non si imposta a mano:
 * un corso è iniziato quando la sua prima lezione è arrivata, quando una lezione
 * risulta svolta, oppure quando è stata svolta la PRELEZIONE — che pur restando
 * fuori dal monte ore è il primo incontro con l'allievo. "Concluso" resta invece
 * una scelta esplicita (è l'archiviazione), così un corso non sparisce dagli
 * elenchi da solo.
 */
export function effectiveCourseStatus(
  stored: CourseStatus,
  lessons: readonly { date: ISODate; status: LessonStatus }[],
  today: ISODate,
  preLesson?: { status: LessonStatus } | null,
): CourseStatus {
  if (stored === "COMPLETED") return "COMPLETED";
  if (preLesson?.status === "COMPLETED") return "IN_PROGRESS";
  const iniziato = lessons.some(
    (l) => l.status === "COMPLETED" || (l.status !== "CANCELLED" && l.date <= today),
  );
  return iniziato ? "IN_PROGRESS" : stored;
}
