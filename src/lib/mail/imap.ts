import "server-only";
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import type { MailConfig } from "./config";
import {
  aggiungiLinkRiunione,
  cleanForwardedBody,
  findOriginalSender,
  htmlToText,
  type MailMessage,
} from "./message";

export class MailError extends Error {}

export interface MailboxState {
  /** UID dell'ultimo messaggio presente, senza scaricarne il contenuto. */
  lastUid: number;
  /**
   * Cambia quando il server rinumera la cartella (o quando si cambia cartella):
   * gli UID salvati non valgono più e si riparte da capo.
   */
  uidValidity: string;
}

export async function mailboxState(config: MailConfig): Promise<MailboxState> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.password },
    logger: false,
  });
  try {
    await client.connect();
    const stato = await client.status(config.folder, { uidNext: true, uidValidity: true });
    return {
      lastUid: Math.max(0, Number(stato.uidNext ?? 1) - 1),
      uidValidity: String(stato.uidValidity ?? ""),
    };
  } catch (error) {
    const dettaglio = error instanceof Error ? error.message : String(error);
    throw new MailError(
      /no such|not exist|nonexistent/i.test(dettaglio)
        ? `Cartella "${config.folder}" non trovata nella casella: controlla MAIL_FOLDER.`
        : `Lettura della posta non riuscita: ${dettaglio}`,
    );
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** Da messaggio grezzo a messaggio utilizzabile. */
async function daSorgente(
  uid: number,
  source: Buffer,
  internalDate: Date | string | undefined,
  config: MailConfig,
): Promise<MailMessage> {
  const parsed = (await simpleParser(source)) as ParsedMail;
  const headers: Record<string, string> = {};
  for (const [key, value] of parsed.headers) {
    headers[key.toLowerCase()] = typeof value === "string" ? value : JSON.stringify(value);
  }
  const envelopeSender = (parsed.from?.value?.[0]?.address ?? "").toLowerCase();
  const testo = parsed.text ?? (parsed.html ? htmlToText(parsed.html) : "");
  const body = aggiungiLinkRiunione(cleanForwardedBody(testo), parsed.html || "");
  return {
    uid,
    messageId: parsed.messageId ?? `uid-${uid}@${config.host}`,
    envelopeSender,
    sender: findOriginalSender({ envelopeSender, headers, body, known: config.senders }),
    subject: parsed.subject?.trim() || "(senza oggetto)",
    receivedAt: new Date(parsed.date ?? internalDate ?? Date.now()).toISOString(),
    body,
    attachments: parsed.attachments.map((a) => ({
      filename: a.filename ?? "allegato",
      contentType: a.contentType ?? "application/octet-stream",
      content: a.content as Buffer,
    })),
  };
}

/** La cartella "tutti i messaggi": ci finisce anche ciò che è stato archiviato. */
async function cartellaArchivio(client: ImapFlow): Promise<string | null> {
  try {
    const elenco = await client.list();
    return elenco.find((box) => box.specialUse === "\\All")?.path ?? null;
  } catch {
    return null;
  }
}

/**
 * Rilegge dalla casella un messaggio già archiviato.
 *
 * Serve quando la lettura migliora: il testo salvato è quello che
 * l'applicazione sapeva ricavare il giorno in cui la mail è arrivata. Si cerca
 * prima nella cartella seguita, per UID; poi, per identificativo del messaggio,
 * fra tutti i messaggi — le mail vecchie spesso non hanno più l'etichetta da
 * cui erano state lette, e l'identificativo invece non cambia mai.
 */
export async function fetchMessage(
  config: MailConfig,
  chiave: { uid: number; messageId: string },
): Promise<MailMessage | null> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.password },
    logger: false,
  });

  const campi = { uid: true, source: true, internalDate: true } as const;
  const prendi = async (uid: number) => {
    const esito = await client.fetchOne(String(uid), campi, { uid: true }).catch(() => false as const);
    if (esito === false || !esito?.source) return null;
    return await daSorgente(esito.uid, esito.source, esito.internalDate, config);
  };

  const cercaIn = async (cartella: string, conUid: boolean) => {
    const lock = await client.getMailboxLock(cartella, { readOnly: true });
    try {
      if (conUid) {
        const perUid = await prendi(chiave.uid);
        if (perUid?.messageId === chiave.messageId) return perUid;
      }
      const uids = await client.search({ header: { "message-id": chiave.messageId } }, { uid: true });
      const uid = Array.isArray(uids) ? uids[uids.length - 1] : undefined;
      return uid ? await prendi(uid) : null;
    } finally {
      lock.release();
    }
  };

  try {
    await client.connect();
    const seguita = await cercaIn(config.folder, true).catch(() => null);
    if (seguita) return seguita;
    const archivio = await cartellaArchivio(client);
    if (!archivio || archivio === config.folder) return null;
    return await cercaIn(archivio, false).catch(() => null);
  } catch {
    // La rilettura è un di più: se la casella non risponde si tiene il testo salvato.
    return null;
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/**
 * Legge la casella in SOLA LETTURA: non segna i messaggi come letti, non
 * sposta e non cancella nulla (`readOnly: true` su mailboxOpen).
 */
export async function fetchMessages(
  config: MailConfig,
  options: { sinceUid?: number; limit?: number } = {},
): Promise<MailMessage[]> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.password },
    logger: false,
  });

  const out: MailMessage[] = [];
  try {
    await client.connect();
    const lock = await client.getMailboxLock(config.folder, { readOnly: true });
    try {
      const from = (options.sinceUid ?? 0) + 1;
      const range = `${from}:*`;
      for await (const raw of client.fetch(
        { uid: range },
        { uid: true, envelope: true, source: true, internalDate: true },
        { uid: true },
      )) {
        // `uid:from:*` restituisce comunque l'ultimo messaggio se non ce ne sono di nuovi.
        if (raw.uid < from || !raw.source) continue;
        out.push(await daSorgente(raw.uid, raw.source, raw.internalDate, config));
        if (options.limit && out.length >= options.limit) break;
      }
    } finally {
      lock.release();
    }
  } catch (error) {
    const dettaglio = error instanceof Error ? error.message : String(error);
    throw new MailError(
      /auth/i.test(dettaglio)
        ? "Accesso alla casella rifiutato: controlla MAIL_USER e la password per app."
        : `Lettura della posta non riuscita: ${dettaglio}`,
    );
  } finally {
    await client.logout().catch(() => client.close());
  }
  return out.sort((a, b) => a.uid - b.uid);
}
