import { makeISODate, type ISODate } from "@/lib/dates";

/**
 * Lettura della lettera d'incarico allegata alla mail (PDF).
 *
 * Interessa soprattutto il compenso, che nella mail non c'è: sta nella clausola
 * "Corrispettivo". Nel testo compaiono altri importi — la penale, la somma da
 * rimborsare in caso di rinuncia — che NON vanno confusi con il compenso.
 */
export interface Contract {
  /** Compenso pattuito in centesimi, dalla clausola "Corrispettivo". */
  feeCents: number | null;
  assignmentNumber: string;
  /** Ore previste dall'incarico. */
  hours: number | null;
  from: ISODate | null;
  to: ISODate | null;
  courseName: string;
}

const compatta = (testo: string) => testo.replace(/\s+/g, " ").trim();

/** "1.338,00" -> 133800 centesimi. */
export function importoInCentesimi(testo: string): number | null {
  const pulito = testo.replace(/\./g, "").replace(",", ".");
  const valore = Number(pulito);
  return Number.isFinite(valore) && valore >= 0 ? Math.round(valore * 100) : null;
}

function dataIT(testo: string | undefined): ISODate | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(testo ?? "");
  if (!m) return null;
  const iso = makeISODate(Number(m[3]), Number(m[2]), Number(m[1]));
  return iso;
}

export function leggiContratto(testoGrezzo: string): Contract {
  const testo = compatta(testoGrezzo);

  // Solo l'importo della clausola "Corrispettivo": si guarda nelle vicinanze di
  // quella parola, non nel resto del contratto.
  const corrispettivo =
    /corrispettivo[^.]{0,200}?pari a\s*(?:euro|€)\s*([\d.]+,\d{2})/i.exec(testo) ??
    /corrispettivo[^.]{0,200}?(?:euro|€)\s*([\d.]+,\d{2})/i.exec(testo);

  const periodo = /\bdal\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*al\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(testo);
  const corso = /nel\s+corso\s+(.+?)(?:,\s*per conto|\s+per conto|\s+nel periodo)/i.exec(testo);

  return {
    feeCents: corrispettivo ? importoInCentesimi(corrispettivo[1]) : null,
    assignmentNumber: /n(?:r|\.)?\s*\.?\s*(\d{5,})/i.exec(testo)?.[1] ?? "",
    hours: Number(/per\s+n\.?\s*(\d+(?:[.,]\d+)?)\s*ore/i.exec(testo)?.[1]?.replace(",", ".")) || null,
    from: dataIT(periodo?.[1]),
    to: dataIT(periodo?.[2]),
    courseName: corso?.[1]?.trim() ?? "",
  };
}

/** Il nome del file dell'incarico porta il numero: "Incarico n. 260532_Rossi.pdf". */
export function numeroDaNomeFile(nome: string): string {
  return /(\d{5,})/.exec(nome ?? "")?.[1] ?? "";
}
