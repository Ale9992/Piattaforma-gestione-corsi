import Link from "next/link";
import { connection } from "next/server";
import { PlusIcon } from "lucide-react";
import { PageHeader, Section } from "@/components/common";
import { CourseTable } from "@/components/course-table";
import { buttonVariants } from "@/components/ui/button";
import { todayInRome } from "@/lib/dates";
import { listCourses } from "@/server/queries";

export const metadata = { title: "Corsi" };

export default async function CoursesPage() {
  await connection();
  const today = todayInRome();
  const courses = listCourses(["IN_PROGRESS", "NOT_STARTED"], today);
  const inProgress = courses.filter((c) => c.status === "IN_PROGRESS");
  const notStarted = courses.filter((c) => c.status === "NOT_STARTED");

  return (
    <>
      <PageHeader
        title="Corsi"
        description="Corsi da iniziare e in corso. I corsi conclusi sono nell'Archivio."
        actions={
          <Link href="/corsi/nuovo" className={buttonVariants()}>
            <PlusIcon /> Nuovo corso
          </Link>
        }
      />
      <div className="space-y-4">
        <Section title={`In corso (${inProgress.length})`}>
          <CourseTable courses={inProgress} empty="Nessun corso in corso." />
        </Section>
        <Section title={`Da iniziare (${notStarted.length})`}>
          <CourseTable courses={notStarted} empty="Nessun corso da iniziare." />
        </Section>
      </div>
    </>
  );
}
