import path from "node:path";
import { resolveDatabasePath } from "@/db";

/**
 * Lettura della posta Outlook tramite Microsoft Graph, in sola lettura.
 * L'accesso con password per app (IMAP) è stato disattivato da Microsoft:
 * serve un'app registrata su Entra e un'autorizzazione data una volta sola.
 */
export interface OutlookConfig {
  /** Casella monitorata: serve solo per controllare di aver autorizzato l'account giusto. */
  email: string;
  clientId: string;
  /** Mittenti da seguire, minuscoli. Vuoto = tutti quelli della cartella. */
  senders: string[];
  /** Cartella da leggere: "inbox" oppure il nome di una cartella personale. */
  folder: string;
  pollMinutes: number;
}

export function readOutlookConfig(): OutlookConfig | null {
  const email = process.env.OUTLOOK_EMAIL?.trim() ?? "";
  const clientId = process.env.OUTLOOK_CLIENT_ID?.trim() ?? "";
  if (!email || !clientId) return null;
  const poll = Number(process.env.OUTLOOK_POLL_MINUTES?.trim() || 10);
  return {
    email: email.toLowerCase(),
    clientId,
    senders: parseSenders(process.env.OUTLOOK_SENDERS),
    folder: process.env.OUTLOOK_FOLDER?.trim() || "inbox",
    pollMinutes: Number.isFinite(poll) && poll >= 1 ? Math.round(poll) : 10,
  };
}

export function parseSenders(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes("@"));
}

export function isOutlookConfigured(): boolean {
  return readOutlookConfig() !== null;
}

/**
 * Le credenziali di accesso stanno accanto al database, cioè nel volume
 * persistente: sopravvivono ai deploy e non finiscono mai nel repository.
 */
export function tokenFilePath(): string {
  const db = resolveDatabasePath();
  return db === ":memory:"
    ? path.resolve(/*turbopackIgnore: true*/ process.cwd(), "data", "outlook-token.json")
    : path.join(/*turbopackIgnore: true*/ path.dirname(db), "outlook-token.json");
}
