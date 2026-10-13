import { PHASE_PRODUCTION_BUILD } from "next/constants";

/** All'avvio del server apre il database e applica le migration pendenti. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return;
  const { getDb } = await import("./db");
  getDb();

  // Controllo periodico della posta: legge le mail dei mittenti seguiti e
  // prepara le proposte. Non modifica mai corsi o calendario da solo.
  const { readMailConfig } = await import("./lib/mail/config");
  const config = readMailConfig();
  if (!config) return;
  const { ingestMail } = await import("./server/mail-service");

  let inCorso = false;
  const controlla = async () => {
    if (inCorso) return;
    inCorso = true;
    try {
      const report = await ingestMail();
      if (report.errors.length > 0) console.error(`Posta: ${report.errors[0]}`);
      else if (report.stored > 0) console.log(`Posta: ${report.stored} nuove mail da confermare.`);
    } catch (error) {
      console.error("Posta:", error instanceof Error ? error.message : error);
    } finally {
      inCorso = false;
    }
  };

  setTimeout(controlla, 30_000).unref?.();
  setInterval(controlla, config.pollMinutes * 60_000).unref?.();
}
