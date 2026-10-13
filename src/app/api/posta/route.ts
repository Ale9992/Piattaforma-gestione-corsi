import { connection } from "next/server";
import { isMailConfigured } from "@/lib/mail/config";
import { ingestMail } from "@/server/mail-service";

/**
 * Controllo periodico della posta, richiamato dal timer sul server.
 * Legge le mail nuove e archivia le proposte: non modifica mai il calendario.
 *
 * Se MAIL_POLL_TOKEN è impostata, la richiesta deve portarla nell'intestazione
 * `x-poll-token`. L'applicazione gira in LAN senza autenticazione (vedi README).
 */
export async function POST(request: Request) {
  await connection();
  const token = process.env.MAIL_POLL_TOKEN?.trim();
  if (token && request.headers.get("x-poll-token") !== token) {
    return Response.json({ ok: false, error: "Token non valido." }, { status: 401 });
  }
  if (!isMailConfigured()) {
    return Response.json({ ok: false, error: "Lettura della posta non configurata." }, { status: 503 });
  }
  const report = await ingestMail();
  return Response.json({ ok: report.errors.length === 0, ...report }, { status: report.errors.length ? 502 : 200 });
}
