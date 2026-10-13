import "server-only";
import fs from "node:fs";
import path from "node:path";
import { resolveDatabasePath } from "@/db";

/**
 * Gli allegati stanno accanto al database, dentro il volume persistente:
 * sopravvivono ai deploy e finiscono nei backup insieme ai dati.
 */
export function cartellaAllegati(): string {
  const db = resolveDatabasePath();
  const base = db === ":memory:" ? process.cwd() : path.dirname(db);
  return path.join(/*turbopackIgnore: true*/ base, "allegati");
}

/** Nome file senza sorprese: niente percorsi, niente caratteri strani. */
export function nomeSicuro(nome: string): string {
  const pulito = (nome || "allegato").replace(/[/\\]/g, "-").replace(/[^\w .()+-]/g, "_").trim();
  return pulito.slice(0, 120) || "allegato";
}

export function salvaAllegato(mailId: number, nome: string, contenuto: Buffer): string {
  const cartella = path.join(cartellaAllegati(), `mail-${mailId}`);
  fs.mkdirSync(/*turbopackIgnore: true*/ cartella, { recursive: true });
  const file = path.join(cartella, nomeSicuro(nome));
  fs.writeFileSync(file, contenuto);
  return path.relative(cartellaAllegati(), file);
}

export function leggiAllegato(percorsoRelativo: string): Buffer | null {
  // Il percorso arriva dal database, ma si controlla comunque che resti dentro
  // la cartella degli allegati.
  const base = cartellaAllegati();
  const file = path.resolve(base, percorsoRelativo);
  if (!file.startsWith(path.resolve(base) + path.sep)) return null;
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}
