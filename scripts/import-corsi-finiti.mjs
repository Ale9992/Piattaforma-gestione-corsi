#!/usr/bin/env node
/**
 * Importa in archivio i corsi già conclusi, a partire dal file JSON estratto dal
 * documento Numbers "Corsi Finiti" (scripts/numbers-corsi-finiti.py).
 *
 *   node scripts/import-corsi-finiti.mjs corsi.json             # anteprima
 *   node scripts/import-corsi-finiti.mjs corsi.json --scrivi    # importa
 *
 * I corsi entrano con stato "Concluso" e le lezioni segnate svolte o annullate.
 * Le lezioni sono "manuali": il motore di calendarizzazione non le tocca.
 * DATABASE_URL indica il database da scrivere (default ./data/app.db).
 */
import fs from "node:fs";
import path from "node:path";

/** "9 - 11", "13,00 - 14,00", "18-19.30", "09:00 - 11:00" -> minuti dalla mezzanotte. */
export function leggiOrario(testo) {
  const s = (testo ?? "").replace(/\s/g, "");
  const m = /^(\d{1,2})([.,:](\d{2}))?[-–](\d{1,2})([.,:](\d{2}))?$/.exec(s);
  if (!m) return null;
  const startMin = Number(m[1]) * 60 + Number(m[3] ?? 0);
  const endMin = Number(m[4]) * 60 + Number(m[6] ?? 0);
  return startMin < endMin && endMin <= 24 * 60 ? { startMin, endMin } : null;
}

export function leggiStato(testo) {
  const s = (testo ?? "").toLowerCase();
  if (/annullat/.test(s)) return "CANCELLED";
  if (/esegui|svolt|fatt/.test(s)) return "COMPLETED";
  return null;
}

/** Orario convenzionale quando il foglio non lo riporta. */
const ORA_INIZIO_DEFAULT = 9 * 60;
const DURATA_DEFAULT = 120;

export function preparaCorso(grezzo) {
  const senzaOrario = [];
  let preLezione = null;
  const lezioni = [];

  for (const riga of grezzo.lezioni) {
    const orario = leggiOrario(riga.orario);
    const stato = leggiStato(riga.stato) ?? "COMPLETED";
    if (/prelezione|pre-lezione/i.test(riga.etichetta ?? "")) {
      if (orario) preLezione = { date: riga.data, startMin: orario.startMin };
      continue;
    }
    if (orario) {
      lezioni.push({ date: riga.data, ...orario, status: stato });
      continue;
    }
    // Senza orario si contano due ore, e il corso lo dichiara nelle note.
    const durata = riga.ore && riga.ore > 0 ? Math.round(riga.ore * 60) : DURATA_DEFAULT;
    lezioni.push({
      date: riga.data,
      startMin: ORA_INIZIO_DEFAULT,
      endMin: ORA_INIZIO_DEFAULT + Math.max(30, durata),
      status: stato,
    });
    senzaOrario.push(riga.data);
  }

  lezioni.sort((a, b) => a.date.localeCompare(b.date));
  const minutiSvolti = lezioni
    .filter((l) => l.status === "COMPLETED")
    .reduce((somma, l) => somma + l.endMin - l.startMin, 0);
  const dichiarato = grezzo.oreDichiarate ? Math.round(grezzo.oreDichiarate * 60) : 0;

  return {
    nome: (grezzo.corso || `Corso ${grezzo.cliente}`).replace(/^corso:\s*/i, "").trim(),
    cliente: (grezzo.cliente ?? "").trim(),
    lezioni,
    preLezione,
    // Il monte ore dichiarato non può essere inferiore alle ore svolte.
    totalMinutes: Math.max(dichiarato, minutiSvolti),
    minutiSvolti,
    startDate: lezioni[0]?.date ?? null,
    endDate: lezioni.at(-1)?.date ?? null,
    annullate: lezioni.filter((l) => l.status === "CANCELLED").length,
    senzaOrario,
  };
}

// ---------------------------------------------------------------------------

const file = process.argv[2];
if (!file) {
  console.error("Indica il file JSON estratto dal documento Numbers.");
  process.exit(1);
}
const scrivi = process.argv.includes("--scrivi");
const corsi = JSON.parse(fs.readFileSync(file, "utf8")).map(preparaCorso).filter((c) => c.startDate);

const ore = (min) => (min / 60).toFixed(min % 60 === 0 ? 0 : 1).replace(".", ",");
console.log(`Corsi da importare: ${corsi.length}\n`);
console.log("cliente              | corso                                | dal        | al         | lez |   ore");
for (const c of corsi) {
  console.log(
    `${c.cliente.slice(0, 20).padEnd(20)} | ${c.nome.slice(0, 36).padEnd(36)} | ${c.startDate} | ${c.endDate} | ${String(c.lezioni.length).padStart(3)} | ${ore(c.totalMinutes).padStart(5)}`,
  );
}
const senzaOrario = corsi.filter((c) => c.senzaOrario.length > 0);
console.log(`\nOre totali: ${ore(corsi.reduce((s, c) => s + c.totalMinutes, 0))}`);
console.log(`Corsi con lezioni prive di orario nel foglio: ${senzaOrario.length}`);
for (const c of senzaOrario) console.log(`  ${c.cliente} / ${c.nome}: ${c.senzaOrario.length} lezioni`);

if (!scrivi) {
  console.log("\n(anteprima: nessuna scrittura. Aggiungi --scrivi per importare)");
  process.exit(0);
}

const { default: Database } = await import("better-sqlite3");
const raw = process.env.DATABASE_URL?.trim() || "./data/app.db";
const db = new Database(path.resolve(raw.startsWith("file:") ? raw.slice(5) : raw));
const adesso = new Date().toISOString();
const NOTA = "Importato dal foglio storico «Corsi Finiti».";

const esiste = db.prepare("select id from courses where name = ? and client_company = ? and start_date = ?");
const inserisciCorso = db.prepare(
  `insert into courses (name, client_company, mode, students_count, student_reference, assignment_number,
     client_contact, total_minutes, start_date, status, notes, created_at, updated_at)
   values (?, ?, '', null, '', '', '', ?, ?, 'COMPLETED', ?, ?, ?)`,
);
const inserisciLezione = db.prepare(
  `insert into lessons (course_id, schedule_rule_id, date, start_min, end_min, status, is_manual, slot_date, created_at, updated_at)
   values (?, null, ?, ?, ?, ?, 1, null, ?, ?)`,
);
const inserisciPre = db.prepare(
  "insert into pre_lessons (course_id, date, start_min, end_min, created_at, updated_at) values (?, ?, ?, ?, ?, ?)",
);

let importati = 0;
let saltati = 0;
db.transaction(() => {
  for (const c of corsi) {
    if (esiste.get(c.nome, c.cliente, c.startDate)) {
      saltati++;
      continue;
    }
    const note = [NOTA]
      .concat(
        c.senzaOrario.length
          ? [`Orario non presente nel foglio per ${c.senzaOrario.length} lezioni: registrate di 2 ore.`]
          : [],
      )
      .join("\n");
    const { lastInsertRowid } = inserisciCorso.run(
      c.nome,
      c.cliente,
      c.totalMinutes,
      c.startDate,
      note,
      adesso,
      adesso,
    );
    const id = Number(lastInsertRowid);
    for (const l of c.lezioni) inserisciLezione.run(id, l.date, l.startMin, l.endMin, l.status, adesso, adesso);
    if (c.preLezione) {
      inserisciPre.run(id, c.preLezione.date, c.preLezione.startMin, c.preLezione.startMin + 60, adesso, adesso);
    }
    importati++;
  }
})();
console.log(`\n✔ Importati ${importati} corsi in archivio (${saltati} già presenti, saltati).`);
