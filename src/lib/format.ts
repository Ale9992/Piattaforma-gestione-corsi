import type { CourseStatus, LessonStatus } from "@/lib/scheduling/types";

export const COURSE_STATUS_LABEL: Record<CourseStatus, string> = {
  NOT_STARTED: "Da iniziare",
  IN_PROGRESS: "In corso",
  COMPLETED: "Concluso",
};

/** Lo stato del corso è un'informazione utile: resta un'etichetta, ma sobria. */
export const COURSE_STATUS_CLASS: Record<CourseStatus, string> = {
  NOT_STARTED: "border-warn-line bg-warn-tint text-warn",
  IN_PROGRESS: "border-transparent bg-accent-tint text-accent-ink",
  COMPLETED: "border-border bg-muted text-muted-foreground",
};

export const LESSON_STATUS_LABEL: Record<LessonStatus, string> = {
  PLANNED: "Programmata",
  COMPLETED: "Svolta",
  CANCELLED: "Annullata",
};

export interface CourseColor {
  /** Barretta o pallino identificativo. */
  dot: string;
  /** Blocco evento nel calendario. */
  event: string;
  /** Riempimento della barra di avanzamento. */
  fill: string;
}

// Tinte desaturate: distinguono i corsi senza urlare. Classi letterali per Tailwind.
const COURSE_COLORS: CourseColor[] = [
  {
    dot: "bg-[#4f7a5e]",
    event: "bg-[#eef4f0] border-[#4f7a5e] text-[#1b3325] dark:bg-[#1e2a23] dark:text-[#cfe3d7]",
    fill: "bg-[#4f7a5e]",
  },
  {
    dot: "bg-[#4a6fa8]",
    event: "bg-[#eef2f8] border-[#4a6fa8] text-[#1c2c44] dark:bg-[#1e2632] dark:text-[#cfdcee]",
    fill: "bg-[#4a6fa8]",
  },
  {
    dot: "bg-[#7a5f9e]",
    event: "bg-[#f4f0f8] border-[#7a5f9e] text-[#2e2440] dark:bg-[#272130] dark:text-[#ddd2ec]",
    fill: "bg-[#7a5f9e]",
  },
  {
    dot: "bg-[#b07d3f]",
    event: "bg-[#faf2e7] border-[#b07d3f] text-[#42301a] dark:bg-[#2e2619] dark:text-[#eeddc3]",
    fill: "bg-[#b07d3f]",
  },
  {
    dot: "bg-[#a8556b]",
    event: "bg-[#fbeff2] border-[#a8556b] text-[#41202a] dark:bg-[#2f1f24] dark:text-[#eecdd6]",
    fill: "bg-[#a8556b]",
  },
  {
    dot: "bg-[#3f7f7a]",
    event: "bg-[#eef5f4] border-[#3f7f7a] text-[#1a3331] dark:bg-[#1c2b2a] dark:text-[#c8e2df]",
    fill: "bg-[#3f7f7a]",
  },
  {
    dot: "bg-[#6b7f3f]",
    event: "bg-[#f2f5ec] border-[#6b7f3f] text-[#2b331a] dark:bg-[#252a1c] dark:text-[#dde5c8]",
    fill: "bg-[#6b7f3f]",
  },
  {
    dot: "bg-[#8a6a52]",
    event: "bg-[#f6f1ec] border-[#8a6a52] text-[#372a20] dark:bg-[#2a2320] dark:text-[#e5d6c9]",
    fill: "bg-[#8a6a52]",
  },
];

/** Colore stabile derivato dall'id del corso (non memorizzato). */
export function courseColor(courseId: number): CourseColor {
  return COURSE_COLORS[courseId % COURSE_COLORS.length];
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Solo il cognome, da un "COGNOME NOME" come lo scrivono gli incarichi.
 *
 * Serve ai titoli degli eventi del calendario, dove il nome per esteso non è
 * mai stato usato. Le lettere d'incarico scrivono sempre il cognome per primo
 * ("GRECO MARTINA", "DE ROSSI MARIA"), quindi si toglie l'ultima parola:
 * i cognomi composti restano interi. Resta fuori il caso del doppio nome di
 * battesimo ("ROSSI MARIA GRAZIA" darebbe "ROSSI MARIA"), che si corregge
 * cambiando il referente sul corso.
 */
export function soloCognome(nome: string): string {
  const parole = nome.trim().split(/\s+/).filter(Boolean);
  if (parole.length < 2) return nome.trim();
  return parole.slice(0, -1).join(" ");
}
