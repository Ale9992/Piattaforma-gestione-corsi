import { eq } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/db";
import { courses } from "@/db/schema";
import { buildCalendarDocument } from "@/lib/caldav/ics";
import { buildCalendarEvents } from "@/server/calendar-sync";

/** DTSTAMP in UTC: è solo il momento in cui il file è stato generato. */
function stamp(now = new Date()): string {
  return `${now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")}`;
}

function fileName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "corso"}.ics`;
}

/**
 * Esporta il calendario di un corso come file .ics da importare a mano in
 * Apple Calendar. Gli UID sono gli stessi della sincronizzazione automatica:
 * accendendola in seguito, questi eventi vengono aggiornati e non duplicati.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const courseId = Number(id);
  if (!Number.isInteger(courseId) || courseId <= 0) {
    return new Response("Corso non valido.", { status: 400 });
  }

  const db = getDb();
  const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!course) return new Response("Corso non trovato.", { status: 404 });

  const events = buildCalendarEvents({ courseId }, db);
  const body = buildCalendarDocument(events, { name: course.name, timestamp: stamp() });

  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName(course.name)}"`,
      "Cache-Control": "no-store",
    },
  });
}
