/**
 * Accesso alla riunione Teams, letto dalla mail di conferma del corso.
 *
 * Le lezioni online si fanno sul Teams del committente: la mail porta il link
 * della riunione e l'account con cui entrare. Qui si legge solo ciò che è
 * scritto accanto a un'etichetta ("Utente:", "Password:"): se il formato della
 * mail cambia questa lettura non restituisce niente invece di restituire
 * qualcosa di sbagliato. Un campo vuoto si vede e si riempie a mano; un campo
 * sbagliato manda fuori strada il giorno stesso della lezione.
 */
export interface TeamsAccess {
  /** Link di partecipazione nella forma https, come arriva nella mail. */
  url: string;
  user: string;
  password: string;
}

export const ACCESSO_VUOTO: TeamsAccess = { url: "", user: "", password: "" };

/** Domini Teams: il link di partecipazione arriva da uno di questi. */
const TEAMS_HOST = /^(?:[\w-]+\.)*(?:teams\.microsoft\.com|teams\.live\.com|teams\.microsoft\.us)$/i;

/** Punteggiatura che la mail appiccica in coda a un link: non ne fa parte. */
const CODA = /[)\]>",.;:!?]+$/;

/**
 * Percorso di un invito a una riunione. Serve a distinguerlo dai rimandi
 * generici a Teams ("scarica l'applicazione da teams.microsoft.com"), che nelle
 * mail abbondano e come link di partecipazione non valgono niente.
 */
const PERCORSO_RIUNIONE = /^\/(?:l\/)?(?:meetup-join|meeting|meet)\//i;

/** Outlook riscrive i link dietro Safe Links: l'originale sta nel parametro `url`. */
function srotolaSafeLink(url: URL): URL {
  if (!/(^|\.)safelinks\.protection\.outlook\.com$/i.test(url.hostname)) return url;
  const dentro = url.searchParams.get("url");
  if (!dentro) return url;
  try {
    return new URL(dentro);
  } catch {
    return url;
  }
}

/** L'indirizzo è un invito a una riunione Teams? */
export function eUnaRiunione(indirizzo: string): string {
  try {
    const url = srotolaSafeLink(new URL(indirizzo.replace(CODA, "")));
    const buono = url.protocol === "https:" && TEAMS_HOST.test(url.hostname) && PERCORSO_RIUNIONE.test(url.pathname);
    return buono ? url.toString() : "";
  } catch {
    return "";
  }
}

/** Il primo invito a una riunione presente nel testo. */
export function trovaLinkTeams(testo: string): string {
  for (const grezzo of testo.match(/https?:\/\/[^\s<>"']+/gi) ?? []) {
    const buono = eUnaRiunione(grezzo);
    if (buono) return buono;
  }
  return "";
}

/**
 * Lo stesso link nella forma che apre l'applicazione invece del browser: è solo
 * lo schema a cambiare, `msteams:` è registrato dal Teams installato.
 */
export function linkApp(url: string): string {
  try {
    const indirizzo = new URL(url);
    if (indirizzo.protocol !== "https:" || !TEAMS_HOST.test(indirizzo.hostname)) return "";
    return `msteams://${url.slice("https://".length)}`;
  } catch {
    return "";
  }
}

/**
 * Apertura dell'applicazione Teams senza una riunione precisa.
 *
 * Le conferme di MAC non portano un invito: danno un account sul loro Teams, e
 * la lezione si trova dentro l'applicazione una volta entrati. In quel caso il
 * massimo che il gestionale può fare — ed è comunque ciò che serve — è aprire
 * Teams e avere le credenziali a portata di mano.
 */
export const APP_TEAMS = "msteams://teams.microsoft.com/";

const ETICHETTA_UTENTE =
  "nome\\s*utente|user\\s*name|username|utenza|utente|user|account|login|e-?mail\\s*(?:di\\s*)?accesso";
const ETICHETTA_PASSWORD = "password(?:\\s*(?:temporanea|provvisoria|iniziale|di\\s*accesso))?|pwd|psw";

/** Valori che sono il resto della frase, non un dato. */
const NON_E_UN_VALORE = /^(?:[-—–.·*_]+|n\.?d\.?|nessuna?|vedi|come|sotto|sopra|allegat\w*)$/i;

/** Una credenziale non è una parola italiana: ha una cifra, una maiuscola, una @ o un simbolo. */
const SEMBRA_CREDENZIALE = /[\d@._\-+!#$%&*?A-Z]/;

function ripulisci(valore: string): string {
  const primo = valore.trim().split(/\s+/)[0] ?? "";
  const candidato = primo.replace(/^[<"'(]+|[>"'),.;]+$/g, "");
  if (!candidato || candidato.length > 80 || NON_E_UN_VALORE.test(candidato)) return "";
  return candidato;
}

/**
 * Valore scritto dopo un'etichetta: "Utente: mario@…".
 *
 * Prima si guardano le righe che iniziano con l'etichetta — è così che le
 * credenziali sono scritte di solito, una per riga. Solo se lì non c'è niente
 * si cerca anche in mezzo a una riga, e in quel caso il valore deve somigliare
 * a una credenziale: altrimenti una frase come "se hai perso la password:
 * scrivi al supporto" verrebbe letta come una password.
 */
function dopoEtichetta(testo: string, etichette: string): string {
  const inizioRiga = new RegExp(`^[ \\t>*]*(?:${etichette})[ \\t]*[:=][ \\t]*(.+)$`, "im");
  const suRiga = ripulisci(inizioRiga.exec(testo)?.[1] ?? "");
  if (suRiga) return suRiga;

  const ovunque = new RegExp(`(?:${etichette})[ \\t]*[:=][ \\t]*(\\S+)`, "gi");
  for (const trovato of testo.matchAll(ovunque)) {
    const candidato = ripulisci(trovato[1] ?? "");
    if (candidato && SEMBRA_CREDENZIALE.test(candidato)) return candidato;
  }
  return "";
}

export function leggiAccessoTeams(testoGrezzo: string): TeamsAccess {
  const testo = (testoGrezzo ?? "").replace(/\r\n?/g, "\n");
  return {
    url: trovaLinkTeams(testo),
    user: dopoEtichetta(testo, ETICHETTA_UTENTE),
    password: dopoEtichetta(testo, ETICHETTA_PASSWORD),
  };
}

/** C'è qualcosa da salvare? */
export const haAccesso = (a: TeamsAccess): boolean => Boolean(a.url || a.user || a.password);
