/**
 * Stato degli automatismi (posta, calendario Apple, backup).
 *
 * Servono a rispondere a una domanda sola: "sta ancora funzionando tutto?".
 * Un automatismo che si ferma non dà errori visibili — semplicemente non
 * succede più niente — quindi qui si guarda da quanto tempo non gira.
 */
export type Health = "ok" | "attenzione" | "fermo" | "spento";

export interface StatusRow {
  key: "posta" | "apple" | "backup";
  label: string;
  /** Ultimo giro andato a buon fine, in ISO; null = mai. */
  at: string | null;
  error: string;
  configured: boolean;
  health: Health;
  detail: string;
}

const MINUTO = 60_000;
const ORA = 60 * MINUTO;

/** Da quanto tempo, in millisecondi. `Infinity` se non è mai successo. */
export function elapsed(at: string | null, now: number): number {
  if (!at) return Infinity;
  const quando = Date.parse(at);
  return Number.isFinite(quando) ? Math.max(0, now - quando) : Infinity;
}

/**
 * Salute di un automatismo: l'errore vince su tutto, poi conta l'attesa.
 * `warn` e `stale` sono le due soglie in millisecondi.
 */
export function health(
  input: { configured: boolean; at: string | null; error: string },
  soglie: { warn: number; stale: number },
  now: number,
): Health {
  if (!input.configured) return "spento";
  if (input.error) return "fermo";
  const da = elapsed(input.at, now);
  if (da >= soglie.stale) return "fermo";
  if (da >= soglie.warn) return "attenzione";
  return "ok";
}

/** "2 minuti fa", "ieri", "3 giorni fa". */
export function quandoInParole(at: string | null, now: number): string {
  const da = elapsed(at, now);
  if (!Number.isFinite(da)) return "mai";
  const minuti = Math.floor(da / MINUTO);
  if (minuti < 1) return "adesso";
  if (minuti < 60) return `${minuti} ${minuti === 1 ? "minuto" : "minuti"} fa`;
  const ore = Math.floor(da / ORA);
  if (ore < 24) return `${ore} ${ore === 1 ? "ora" : "ore"} fa`;
  const giorni = Math.floor(ore / 24);
  return giorni === 1 ? "ieri" : `${giorni} giorni fa`;
}

/** Soglie: la posta gira ogni 10 minuti, il backup ogni notte. */
export const SOGLIE = {
  posta: { warn: 45 * MINUTO, stale: 3 * ORA },
  // La sincronizzazione parte dopo ogni modifica: può restare ferma a lungo
  // senza che sia un guasto, quindi si allarga la soglia.
  apple: { warn: 7 * 24 * ORA, stale: 30 * 24 * ORA },
  backup: { warn: 26 * ORA, stale: 3 * 24 * ORA },
} as const;
