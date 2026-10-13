import { connection } from "next/server";
import { PageHeader, Section } from "@/components/common";
import { CourseTable } from "@/components/course-table";
import { todayInRome } from "@/lib/dates";
import { listCourses } from "@/server/queries";

export const metadata = { title: "Archivio" };

export default async function ArchivePage() {
  await connection();
  const courses = listCourses(["COMPLETED"], todayInRome()).sort((a, b) =>
    (b.expectedEndDate ?? b.startDate).localeCompare(a.expectedEndDate ?? a.startDate),
  );

  return (
    <>
      <PageHeader
        title="Archivio"
        description="Corsi conclusi: storico completo consultabile. Per riaprirne uno cambia lo stato dalla pagina del corso."
      />
      <Section title={`Corsi conclusi (${courses.length})`}>
        <CourseTable courses={courses} empty="Nessun corso concluso." />
      </Section>
    </>
  );
}
