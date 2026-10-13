import Link from "next/link";
import { CourseStatusBadge, EmptyState, ProgressBar } from "@/components/common";
import { formatDateIT, formatHours } from "@/lib/dates";
import { courseColor } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CourseListItem } from "@/server/queries";

export function CourseTable({ courses, empty }: { courses: CourseListItem[]; empty: string }) {
  if (courses.length === 0) return <EmptyState>{empty}</EmptyState>;

  return (
    <ul>
      {courses.map((course) => {
        const color = courseColor(course.id);
        const { progress } = course;
        return (
          <li key={course.id} className="hairline">
            <Link
              href={`/corsi/${course.id}`}
              className="flex flex-col gap-2 py-3 transition-colors hover:bg-muted/50 md:flex-row md:items-center md:gap-4"
            >
              <span className="flex min-w-0 flex-1 items-center gap-2.5">
                <span className={cn("h-7 w-[3px] shrink-0 rounded-full", color.dot)} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{course.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[course.clientCompany, course.mode].filter(Boolean).join(" · ") || "—"}
                  </span>
                </span>
              </span>

              <span className="tabular flex shrink-0 items-center gap-4 pl-[22px] text-xs text-muted-foreground md:pl-0">
                <span className="w-[108px]">
                  {formatDateIT(course.startDate).slice(0, 5)} → {formatDateIT(course.expectedEndDate)}
                </span>
                <span className="hidden w-[72px] sm:block">
                  {course.nextLessonDate ? `pross. ${formatDateIT(course.nextLessonDate).slice(0, 5)}` : "—"}
                </span>
              </span>

              <span className="flex shrink-0 items-center gap-3 pl-[22px] md:w-[210px] md:pl-0">
                <span className="min-w-0 flex-1">
                  <span className="tabular mb-1 flex items-baseline justify-between text-xs">
                    <span>
                      {formatHours(progress.completedMinutes)} / {formatHours(progress.totalMinutes)} h
                    </span>
                    {progress.unscheduledMinutes > 0 ? (
                      <span className="text-warn">{formatHours(progress.unscheduledMinutes)} h da fissare</span>
                    ) : null}
                  </span>
                  <ProgressBar
                    total={progress.totalMinutes}
                    completed={progress.completedMinutes}
                    planned={progress.plannedMinutes}
                    fill={color.fill}
                  />
                </span>
                <CourseStatusBadge status={course.status} className="shrink-0" />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
