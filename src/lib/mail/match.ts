import { agencyAliases } from "@/lib/agency";

/**
 * Abbinamento di una mail al corso a cui si riferisce. Deterministico e
 * testabile: nessuna decisione è lasciata al modello linguistico, che si limita
 * a estrarre i riferimenti scritti nella mail.
 */
export interface CourseRef {
  id: number;
  name: string;
  clientCompany: string;
  studentReference: string;
  /** Numero dell'ordine d'incarico: quando c'è, è l'aggancio più sicuro. */
  assignmentNumber?: string;
  status: string;
}

export interface MatchHint {
  courseName: string;
  clientCompany: string;
  studentReference: string;
  /** Numero d'incarico citato nella mail, se c'è. */
  assignmentNumber?: string;
}

export interface MatchResult {
  course: CourseRef | null;
  /** Punteggio del migliore, 0–100. */
  score: number;
  /** Corsi a pari merito: in questo caso decide l'utente. */
  ambiguous: CourseRef[];
}

const PAROLE_INUTILI = new Set([
  "srl", "spa", "snc", "sas", "s", "r", "l", "p", "a", "di", "del", "della", "dei", "delle",
  "il", "lo", "la", "i", "gli", "le", "e", "ed", "con", "per", "corso", "corsi", "ufficio",
  "personale", "comune", "ente", "cliente", "azienda", "sig", "sigra", "dott",
  "formazione", "lezione", "lezioni", "annullamento",
]);

/**
 * Le parole che contano in un testo. Oltre a quelle inutili per tutti si
 * scartano i nomi dell'agenzia: nelle sue mail compaiono ovunque e non
 * distinguono un corso dall'altro.
 */
export function tokens(value: string, agenzia: readonly string[] = agencyAliases()): string[] {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !PAROLE_INUTILI.has(t) && !agenzia.includes(t));
}

/** Quanto due testi si somigliano, 0–1, contando le parole in comune. */
export function similarity(a: string, b: string): number {
  const x = new Set(tokens(a));
  const y = new Set(tokens(b));
  if (x.size === 0 || y.size === 0) return 0;
  let comuni = 0;
  for (const t of x) if (y.has(t)) comuni++;
  return comuni / Math.min(x.size, y.size);
}

/**
 * Punteggio di un corso rispetto ai riferimenti della mail. Il cliente e il
 * nominativo dell'allievo pesano più del titolo del corso, che spesso nelle
 * mail è scritto in modo diverso.
 *
 * Ogni campo del corso viene confrontato con TUTTI i riferimenti della mail:
 * "Bianchi" può arrivare come nome del corso, come cliente o come allievo a
 * seconda di come è scritta la mail, mentre nel gestionale sta in un campo solo.
 */
export function scoreCourse(course: CourseRef, hint: MatchHint): number {
  // Il numero d'incarico identifica il corso senza ambiguità: se coincide, basta.
  const numero = (hint.assignmentNumber ?? "").replace(/\D+/g, "");
  if (numero.length >= 3 && (course.assignmentNumber ?? "").replace(/\D+/g, "") === numero) return 100;

  const riferimenti = [hint.clientCompany, hint.courseName, hint.studentReference];
  const migliore = (campo: string) => Math.max(...riferimenti.map((v) => similarity(campo, v)));
  const perCliente = migliore(course.clientCompany);
  const perAllievo = migliore(course.studentReference);
  const perTitolo = migliore(course.name);
  // Il solo titolo non basta: corsi diversi hanno spesso lo stesso nome
  // ("Gemini e NotebookLM" per due clienti), e un corso può non essere affatto
  // nel gestionale. Serve che a corrispondere sia il cliente o l'allievo.
  const punteggio = perCliente * 45 + perAllievo * 35 + perTitolo * 20;
  // Un corso già concluso raramente è quello di cui parla la mail.
  return course.status === "COMPLETED" ? punteggio * 0.6 : punteggio;
}

/** Soglia sotto la quale non si propone nessun abbinamento. */
export const SOGLIA = 30;

export function matchCourse(courses: readonly CourseRef[], hint: MatchHint): MatchResult {
  const punteggi = courses
    .map((course) => ({ course, score: Math.round(scoreCourse(course, hint)) }))
    .sort((a, b) => b.score - a.score);
  const migliore = punteggi[0];
  if (!migliore || migliore.score < SOGLIA) return { course: null, score: migliore?.score ?? 0, ambiguous: [] };

  // Due corsi quasi identici: meglio chiedere che indovinare.
  const pari = punteggi.filter((p) => migliore.score - p.score <= 5);
  if (pari.length > 1) {
    return { course: null, score: migliore.score, ambiguous: pari.map((p) => p.course) };
  }
  return { course: migliore.course, score: migliore.score, ambiguous: [] };
}
