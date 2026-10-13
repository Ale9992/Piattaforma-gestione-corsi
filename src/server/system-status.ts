import "server-only";
import fs from "node:fs";
import path from "node:path";
import { getDb, resolveDatabasePath, type Executor } from "@/db";
import { isMailConfigured } from "@/lib/mail/config";
import { health, quandoInParole, SOGLIE, type StatusRow } from "@/lib/system-status";
import { isSyncConfigured, ULTIMA_SYNC, ULTIMO_ERRORE_SYNC } from "./calendar-sync";
import { readSetting, ULTIMO_CONTROLLO, ULTIMO_ERRORE } from "./mail-service";

/** Backup più recente presente nel volume dei dati. */
function ultimoBackup(): { at: string | null; nome: string } {
  const db = resolveDatabasePath();
  if (db === ":memory:") return { at: null, nome: "" };
  const cartella = path.join(/*turbopackIgnore: true*/ path.dirname(db), "backups");
  try {
    const file = fs
      .readdirSync(/*turbopackIgnore: true*/ cartella)
      .filter((f) => f.endsWith(".db"))
      .map((f) => ({ nome: f, mtime: fs.statSync(path.join(cartella, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0];
    return file ? { at: new Date(file.mtime).toISOString(), nome: file.nome } : { at: null, nome: "" };
  } catch {
    return { at: null, nome: "" };
  }
}

/** Le tre righe dello stato: posta, calendario Apple, backup. */
export function getSystemStatus(ex: Executor = getDb(), now = Date.now()): StatusRow[] {
  const posta = {
    configured: isMailConfigured(),
    at: readSetting(ex, ULTIMO_CONTROLLO),
    error: readSetting(ex, ULTIMO_ERRORE) ?? "",
  };
  const apple = {
    configured: isSyncConfigured(),
    at: readSetting(ex, ULTIMA_SYNC),
    error: readSetting(ex, ULTIMO_ERRORE_SYNC) ?? "",
  };
  const backup = ultimoBackup();

  return [
    {
      key: "posta",
      label: "Controllo posta",
      ...posta,
      health: health(posta, SOGLIE.posta, now),
      detail: posta.configured ? `ultimo giro ${quandoInParole(posta.at, now)}` : "non configurato",
    },
    {
      key: "apple",
      label: "Calendario Apple",
      ...apple,
      health: health(apple, SOGLIE.apple, now),
      detail: apple.configured ? `ultima sincronizzazione ${quandoInParole(apple.at, now)}` : "non configurato",
    },
    {
      key: "backup",
      label: "Backup del database",
      at: backup.at,
      error: "",
      configured: true,
      health: health({ configured: true, at: backup.at, error: "" }, SOGLIE.backup, now),
      detail: backup.at ? `ultimo ${quandoInParole(backup.at, now)}` : "nessun backup trovato",
    },
  ];
}
