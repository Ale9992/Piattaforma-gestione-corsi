import { connection } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { courses } from "@/db/schema";
import { leggiAllegato } from "@/lib/mail/storage";

/** Scarica la lettera d'incarico allegata al corso. */
export async function GET(_request: Request, { params }: RouteContext<"/corsi/[id]/contratto">) {
  await connection();
  const { id } = await params;
  const courseId = Number(id);
  const corso = Number.isInteger(courseId)
    ? getDb().select().from(courses).where(eq(courses.id, courseId)).get()
    : undefined;
  if (!corso?.contractFile) return new Response("Nessun contratto per questo corso.", { status: 404 });

  const contenuto = leggiAllegato(corso.contractFile);
  if (!contenuto) return new Response("File non trovato.", { status: 404 });

  const nome = corso.contractFile.split("/").pop() ?? "incarico.pdf";
  return new Response(new Uint8Array(contenuto), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${nome.replace(/"/g, "")}"`,
    },
  });
}
