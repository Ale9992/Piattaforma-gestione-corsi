import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type Executor = DB | Tx;

/** `DATABASE_URL` accetta `file:./data/app.db`, `./data/app.db` o un percorso assoluto. */
export function resolveDatabasePath(url: string | undefined = process.env.DATABASE_URL): string {
  const raw = url?.trim() || "./data/app.db";
  const filePath = raw.startsWith("file:") ? raw.slice("file:".length) : raw;
  // turbopackIgnore: percorso runtime, non deve far tracciare l'intero progetto nel build.
  return filePath === ":memory:" ? filePath : path.resolve(/*turbopackIgnore: true*/ process.cwd(), filePath);
}

export function resolveMigrationsDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.MIGRATIONS_DIR ?? "drizzle");
}

export function openDatabase(filePath: string, options: { migrate?: boolean } = {}) {
  if (filePath !== ":memory:") {
    fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(filePath), { recursive: true });
  }
  const sqlite = new Database(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
  const db = drizzle(sqlite, { schema });
  if (options.migrate ?? true) {
    // Alcune modifiche di schema fanno ricostruire una tabella (CREATE + DROP +
    // RENAME). Con i vincoli esterni attivi il DROP cancellerebbe a cascata le
    // righe collegate: le migration vanno applicate a vincoli spenti.
    sqlite.pragma("foreign_keys = OFF");
    try {
      migrate(db, { migrationsFolder: resolveMigrationsDir() });
    } finally {
      sqlite.pragma("foreign_keys = ON");
    }
  }
  return { sqlite, db };
}

const globalForDb = globalThis as unknown as {
  __gestioneCorsiDb?: ReturnType<typeof openDatabase>;
};

/** Connessione unica per processo; applica le migration pendenti alla prima apertura. */
export function getDb(): DB {
  if (!globalForDb.__gestioneCorsiDb) {
    globalForDb.__gestioneCorsiDb = openDatabase(resolveDatabasePath());
  }
  return globalForDb.__gestioneCorsiDb.db;
}

export { schema };
