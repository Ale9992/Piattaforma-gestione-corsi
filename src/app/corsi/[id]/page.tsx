import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CourseStatusBadge, ProgressBar } from "@/components/common";
import {
  BackToList,
  CourseAlerts,
  CourseHeaderActions,
  LessonsSection,
  NotesSection,
  PausesSection,
  PreLessonSection,
  ScheduleSection,
} from "@/components/course/course-sections";
import { MeetingAccess } from "@/components/course/meeting-access";
import { formatDateIT, formatHours, todayInRome } from "@/lib/dates";
import { courseColor } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getCourseDetail } from "@/server/queries";

export async function generateMetadata({ params }: PageProps<"/corsi/[id]">) {
  const { id } = await params;
  await connection();
  const detail = Number.isInteger(Number(id)) ? getCourseDetail(Number(id)) : null;
  return { title: detail?.course.name ?? "Corso" };
}

export default async function CoursePage({ params }: PageProps<"/corsi/[id]">) {
  const { id } = await params;
  await connection();
  const courseId = Number(id);
  const detail = Number.isInteger(courseId) && courseId > 0 ? getCourseDetail(courseId) : null;
  if (!detail) notFound();

  const today = todayInRome();
  const { course, progress } = detail;
  const color = courseColor(course.id);
  const props = { detail, today };

  // Riga di identità: solo i campi valorizzati, niente trattini.
  const meta = [
    course.clientCompany,
    `${formatHours(course.totalMinutes)} h`,
    `${formatDateIT(course.startDate)} → ${formatDateIT(detail.expectedEndDate)}`,
    course.mode,
    course.studentsCount !== null ? `${course.studentsCount} allievi` : null,
    course.studentReference,
    course.clientContact || null,
    course.assignmentNumber ? `incarico n. ${course.assignmentNumber}` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-6">
      <div>
        <BackToList status={course.status} />
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-start gap-2.5">
              <span className={cn("mt-1 h-7 w-1 shrink-0 rounded-full", color.dot)} />
              <h1 className="min-w-0 text-xl font-semibold sm:text-[26px] sm:leading-tight">{course.name}</h1>
            </div>
            <div className="tabular mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 pl-3.5 text-[13px] text-muted-foreground">
              <CourseStatusBadge status={course.status} />
              {meta.map((item, i) => (
                <span key={item} className="flex items-center gap-2">
                  {/* Su schermo stretto i dati vanno a capo: il separatore sparisce. */}
                  {i > 0 ? <span className="hidden text-border sm:inline">·</span> : null}
                  {item}
                </span>
              ))}
            </div>
          </div>
          <CourseHeaderActions {...props} />
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <span className="tabular text-2xl font-medium">{formatHours(progress.completedMinutes)}</span>
            <span className="tabular text-sm text-muted-foreground">
              di {formatHours(progress.totalMinutes)} ore svolte
            </span>
          </div>
          <span className="tabular text-[13px] text-muted-foreground">
            restano {formatHours(progress.toDoMinutes)} h
            {progress.unscheduledMinutes > 0
              ? ` · ${formatHours(progress.unscheduledMinutes)} h da calendarizzare`
              : ""}
          </span>
        </div>
        <ProgressBar
          className="mt-3 h-2"
          total={progress.totalMinutes}
          completed={progress.completedMinutes}
          planned={progress.plannedMinutes}
          fill={color.fill}
        />
        <div className="tabular mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className={cn("size-2 rounded-sm", color.fill)} />
            svolte {formatHours(progress.completedMinutes)} h
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cn("size-2 rounded-sm opacity-30", color.fill)} />
            programmate {formatHours(progress.plannedMinutes)} h
          </span>
          {progress.cancelledMinutes > 0 ? (
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-danger-line" />
              annullate {formatHours(progress.cancelledMinutes)} h (non contano)
            </span>
          ) : null}
        </div>
      </div>

      <MeetingAccess
        url={course.meetingUrl}
        user={course.meetingUser}
        password={course.meetingPassword}
      />

      <CourseAlerts {...props} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <ScheduleSection {...props} />
        <PreLessonSection key={`pre-${detail.preLesson?.updatedAt ?? "none"}`} {...props} />
      </div>

      <LessonsSection {...props} />

      <div className="grid gap-6 lg:grid-cols-2">
        <PausesSection {...props} />
        <NotesSection key={`notes-${course.updatedAt}`} {...props} />
      </div>
    </div>
  );
}
