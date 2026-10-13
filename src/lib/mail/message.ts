import { eUnaRiunione, trovaLinkTeams } from "./meeting";

/** Un messaggio ridotto a ciò che serve per capire di che corso parla. */
export interface MailMessage {
  /** Identificativo stabile nella casella: evita di rileggere due volte. */
  uid: number;
  messageId: string;
  /** Chi ha spedito davvero: dietro un inoltro non è il mittente della busta. */
  sender: string;
  /** Mittente della busta (con l'inoltro è la tua casella Outlook). */
  envelopeSender: string;
  subject: string;
  receivedAt: string;
  body: string;
  /** Allegati della mail: la lettera d'incarico arriva qui. */
  attachments: { filename: string; contentType: string; content: Buffer }[];
}

/** Testo leggibile a partire dall'HTML di una mail. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
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

/**
 * Il link della riunione spesso esiste solo nell'HTML, dietro un "fai clic qui
 * per partecipare": nella versione testuale della mail sparisce. Qui lo si
 * ripesca dagli indirizzi dei collegamenti e lo si scrive in fondo al testo,
 * così resta leggibile sia per chi apre la mail nel gestionale sia per la
 * lettura automatica.
 */
export function aggiungiLinkRiunione(testo: string, html: string): string {
  if (!html || trovaLinkTeams(testo)) return testo;
  for (const trovato of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const indirizzo = (trovato[1] ?? "").replace(/&amp;/gi, "&");
    const riunione = eUnaRiunione(indirizzo);
    if (riunione) return `${testo}\n\nLink riunione: ${riunione}`;
  }
  return testo;
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/** Un indirizzo è fra quelli seguiti? L'elenco accetta anche interi domini. */
export function matchesSender(address: string, senders: readonly string[]): boolean {
  const a = address.toLowerCase();
  return senders.some((s) => {
    const atteso = s.toLowerCase();
    return atteso.startsWith("@") ? a.endsWith(atteso) : a === atteso;
  });
}

/**
 * Mittente vero di una mail inoltrata. L'inoltro di Outlook mette la propria
 * casella nel campo "Da": il mittente originale resta nelle intestazioni di
 * inoltro oppure nella riga "Da:" del testo riportato.
 */
export function findOriginalSender(input: {
  envelopeSender: string;
  headers?: Record<string, string | undefined>;
  body: string;
  known?: readonly string[];
}): string {
  const known = (input.known ?? []).map((s) => s.toLowerCase());
  const conosciuto = (address: string) => known.length === 0 || matchesSender(address, known);

  const intestazioni = ["x-forwarded-for", "reply-to", "x-original-from", "resent-from", "return-path"];
  for (const nome of intestazioni) {
    for (const match of (input.headers?.[nome] ?? "").match(EMAIL) ?? []) {
      if (conosciuto(match) && match.toLowerCase() !== input.envelopeSender.toLowerCase()) {
        return match.toLowerCase();
      }
    }
  }

  // Testo riportato: "Da: Nome Cognome <indirizzo>" oppure "From: …".
  const righe = input.body.split(/\r?\n/).slice(0, 60);
  for (const riga of righe) {
    if (!/^\s*(da|from|mittente)\s*:/i.test(riga)) continue;
    for (const match of riga.match(EMAIL) ?? []) {
      if (conosciuto(match)) return match.toLowerCase();
    }
  }

  // Ultima risorsa: il primo indirizzo seguito che compare nel testo.
  if (known.length > 0) {
    for (const match of input.body.match(EMAIL) ?? []) {
      if (matchesSender(match, known)) return match.toLowerCase();
    }
  }
  return input.envelopeSender.toLowerCase();
}

/** Tiene solo le mail dei mittenti seguiti (originali o diretti). */
export function isFromWatched(message: MailMessage, senders: readonly string[]): boolean {
  if (senders.length === 0) return true;
  return matchesSender(message.sender, senders) || matchesSender(message.envelopeSender, senders);
}

/**
 * Ripulisce il testo inoltrato: via le firme e le catene di risposta, che
 * confondono il riconoscimento e allungano inutilmente la richiesta al parser.
 */
export function cleanForwardedBody(body: string): string {
  const testo = body.replace(/\r\n/g, "\n");
  const tagli = [
    /^-{2,}\s*Messaggio originale\s*-{2,}$/im,
    /^-{2,}\s*Original Message\s*-{2,}$/im,
    /^_{10,}$/m,
  ];
  let out = testo;
  for (const taglio of tagli) {
    const m = taglio.exec(out);
    // Il testo inoltrato sta DOPO l'intestazione: si toglie solo la riga separatrice.
    if (m) out = out.slice(0, m.index) + out.slice(m.index + m[0].length);
  }
  return out
    .split(/\n/)
    .filter((riga) => !/^\s*>\s*>/.test(riga))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
