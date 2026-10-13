import { getAccessToken, type Fetcher } from "./auth";
import type { OutlookConfig } from "./config";

const GRAPH = "https://graph.microsoft.com/v1.0";

export class OutlookError extends Error {}

/** Messaggio ridotto a ciò che serve per capire di che corso parla. */
export interface MailMessage {
  id: string;
  sender: string;
  senderName: string;
  subject: string;
  receivedAt: string;
  /** Corpo in testo semplice: è quello che legge il parser. */
  body: string;
}

interface GraphMessage {
  id: string;
  subject?: string | null;
  receivedDateTime?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  body?: { content?: string; contentType?: string };
  bodyPreview?: string;
}

/**
 * Filtro OData: solo i messaggi arrivati dopo l'ultimo controllo e, se indicati,
 * solo dai mittenti da seguire. Il filtro viaggia sul server di Microsoft, così
 * non scarichiamo la posta che non ci riguarda.
 */
export function buildMessagesQuery(options: { since?: string; senders?: readonly string[]; top?: number }): string {
  const clauses: string[] = [];
  if (options.since) clauses.push(`receivedDateTime ge ${options.since}`);
  const senders = options.senders ?? [];
  if (senders.length > 0) {
    const ors = senders.map((s) => `from/emailAddress/address eq '${s.replace(/'/g, "''")}'`);
    clauses.push(`(${ors.join(" or ")})`);
  }
  const params = new URLSearchParams({
    $select: "id,subject,receivedDateTime,from,body",
    $orderby: "receivedDateTime asc",
    $top: String(options.top ?? 25),
  });
  if (clauses.length > 0) params.set("$filter", clauses.join(" and "));
  return params.toString();
}

/** Il corpo arriva in testo semplice, ma un mittente può sempre mandare HTML. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function toMailMessage(raw: GraphMessage): MailMessage {
  const content = raw.body?.content ?? raw.bodyPreview ?? "";
  return {
    id: raw.id,
    sender: (raw.from?.emailAddress?.address ?? "").toLowerCase(),
    senderName: raw.from?.emailAddress?.name ?? "",
    subject: raw.subject ?? "(senza oggetto)",
    receivedAt: raw.receivedDateTime ?? "",
    body: raw.body?.contentType === "html" ? htmlToText(content) : content.trim(),
  };
}

async function graphGet(url: string, accessToken: string, fetcher: Fetcher): Promise<unknown> {
  const response = await fetcher(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      // Chiede il corpo già in testo semplice invece che in HTML.
      Prefer: 'outlook.body-content-type="text"',
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail =
      response.status === 401
        ? "autorizzazione non più valida: rifai l'accesso con «npm run posta:accedi»"
        : response.status === 403
          ? "permesso Mail.Read mancante nell'app registrata"
          : response.status === 404
            ? "cartella non trovata: controlla OUTLOOK_FOLDER"
            : `HTTP ${response.status}`;
    throw new OutlookError(`Lettura della posta non riuscita (${detail}).`);
  }
  return response.json();
}

/** Identificativo della cartella: "inbox" è già valido, un nome personale va cercato. */
export async function resolveFolderId(
  folder: string,
  accessToken: string,
  fetcher: Fetcher = fetch,
): Promise<string> {
  const wellKnown = ["inbox", "archive", "sentitems", "drafts", "junkemail", "deleteditems"];
  if (wellKnown.includes(folder.toLowerCase())) return folder.toLowerCase();
  const url = `${GRAPH}/me/mailFolders?$select=id,displayName&$top=100`;
  const data = (await graphGet(url, accessToken, fetcher)) as { value?: { id: string; displayName: string }[] };
  const match = data.value?.find((f) => f.displayName.trim().toLowerCase() === folder.trim().toLowerCase());
  if (!match) {
    throw new OutlookError(
      `Cartella "${folder}" non trovata su Outlook. Disponibili: ${data.value?.map((f) => f.displayName).join(", ") || "nessuna"}.`,
    );
  }
  return match.id;
}

/** Messaggi da elaborare, dal più vecchio al più recente. */
export async function listMessages(
  config: OutlookConfig,
  options: { since?: string; top?: number; fetcher?: Fetcher } = {},
): Promise<MailMessage[]> {
  const fetcher = options.fetcher ?? fetch;
  const accessToken = await getAccessToken(config.clientId, { fetcher });
  const folderId = await resolveFolderId(config.folder, accessToken, fetcher);
  const query = buildMessagesQuery({ since: options.since, senders: config.senders, top: options.top });
  const data = (await graphGet(
    `${GRAPH}/me/mailFolders/${encodeURIComponent(folderId)}/messages?${query}`,
    accessToken,
    fetcher,
  )) as { value?: GraphMessage[] };
  return (data.value ?? []).map(toMailMessage);
}

/** Indirizzo dell'account autorizzato: serve a verificare di aver collegato la casella giusta. */
export async function readAccount(clientId: string, fetcher: Fetcher = fetch): Promise<string> {
  const accessToken = await getAccessToken(clientId, { fetcher });
  const data = (await graphGet(`${GRAPH}/me?$select=mail,userPrincipalName`, accessToken, fetcher)) as {
    mail?: string;
    userPrincipalName?: string;
  };
  return (data.mail ?? data.userPrincipalName ?? "").toLowerCase();
}
