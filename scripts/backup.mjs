#!/usr/bin/env node
// Backup consistente a caldo del database SQLite (API di backup online di SQLite:
// sicuro anche con l'applicazione in esecuzione e in modalità WAL).
// Uso: npm run db:backup [-- percorso/destinazione.db]
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const raw = (process.env.DATABASE_URL || "./data/app.db").trim();
const dbPath = path.resolve(raw.replace(/^file:/, ""));
if (!fs.existsSync(dbPath)) {
  console.error(`Database non trovato: ${dbPath}`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const target = path.resolve(
  process.argv[2] || path.join(process.env.BACKUP_DIR || path.join(path.dirname(dbPath), "backups"), `app-${stamp}.db`),
);
fs.mkdirSync(path.dirname(target), { recursive: true });

const sqlite = new Database(dbPath, { fileMustExist: true });
await sqlite.backup(target);
sqlite.close();

// La copia eredita la modalità WAL: la riportiamo a un singolo file autosufficiente.
const check = new Database(target);
check.pragma("journal_mode = DELETE");
const result = check.pragma("integrity_check", { simple: true });
check.close();
if (result !== "ok") {
  console.error(`Backup creato ma integrity_check fallito: ${result}`);
  process.exit(1);
}
console.log(`Backup creato: ${target}`);
