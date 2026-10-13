/**
 * Chi assegna i corsi.
 *
 * Il gestionale è pensato per un formatore che lavora su incarico: le mail
 * arrivano da un'agenzia, e il suo nome serve in due modi diversi. Uno è
 * cosmetico — compare sotto il titolo — l'altro è funzionale: nelle mail
 * l'agenzia si nomina da sola in continuazione ("Annullamento lezione 13/10
 * Rossi - Nome Agenzia"), e senza sapere come si chiama il riconoscimento la
 * prenderebbe per il cliente del corso.
 *
 * Sta in configurazione perché è l'unica cosa che cambia da formatore a
 * formatore. Senza configurazione il gestionale funziona: non mostra nessun
 * sottotitolo e non scarta nessuna parola.
 */

/** Nome dell'agenzia, come va scritto a schermo. Vuoto = non si mostra. */
export function agencyName(): string {
  return (process.env.AGENCY_NAME ?? "").trim();
}

/**
 * Parole con cui l'agenzia si nomina nelle mail, da ignorare quando si cerca di
 * capire di che corso si parla: il nome, le sue abbreviazioni, i suoi domini.
 */
export function agencyAliases(): string[] {
  const grezzo = process.env.AGENCY_ALIASES ?? process.env.AGENCY_NAME ?? "";
  return grezzo
    .split(",")
    .flatMap((pezzo) => pezzo.split(/[^\p{L}\p{N}]+/u))
    .map((parola) => parola.trim().toLowerCase())
    .filter((parola) => parola.length > 1);
}
