#!/usr/bin/env node
// Applica le migration Drizzle pendenti al database indicato da DATABASE_URL.
// Uso: npm run db:migrate   (in Docker: docker compose exec app node scripts/migrate.mjs)
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const raw = (process.env.DATABASE_URL || "./data/app.db").trim();
const dbPath = path.resolve(raw.replace(/^file:/, ""));
const migrationsFolder = path.resolve(process.env.MIGRATIONS_DIR || "drizzle");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

migrate(drizzle(sqlite), { migrationsFolder });
sqlite.close();
console.log(`Migration applicate a ${dbPath}`);
