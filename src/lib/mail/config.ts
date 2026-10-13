/**
 * Lettura della posta in sola lettura via IMAP.
 *
 * La casella Outlook accetta ormai solo OAuth2 e registrare un'app costa una
 * carta di credito: una regola su Outlook inoltra le mail dei mittenti seguiti
 * a una casella Gmail, che qui viene letta con una password per app.
 * Il codice per leggere Outlook direttamente resta in `src/lib/outlook`.
 */
export interface MailConfig {
  user: string;
  password: string;
  host: string;
  port: number;
  folder: string;
  /** Mittenti originali da seguire (indirizzi o domini). Vuoto = tutti. */
  senders: string[];
  pollMinutes: number;
}

/**
 * Mittenti da seguire: indirizzi interi (`nome@azienda.it`) oppure interi
 * domini (`@azienda.it`), utili quando la stessa azienda scrive da più caselle.
 */
export function parseSenders(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes("@"));
}

export function readMailConfig(): MailConfig | null {
  const user = process.env.MAIL_USER?.trim();
  const password = process.env.MAIL_APP_PASSWORD?.trim().replace(/\s+/g, "");
  if (!user || !password) return null;
  const poll = Number(process.env.MAIL_POLL_MINUTES?.trim() || 10);
  return {
    user,
    password,
    host: process.env.MAIL_IMAP_HOST?.trim() || "imap.gmail.com",
    port: Number(process.env.MAIL_IMAP_PORT?.trim() || 993),
    folder: process.env.MAIL_FOLDER?.trim() || "INBOX",
    senders: parseSenders(process.env.MAIL_SENDERS),
    pollMinutes: Number.isFinite(poll) && poll >= 1 ? Math.round(poll) : 10,
  };
}

export function isMailConfigured(): boolean {
  return readMailConfig() !== null;
}
