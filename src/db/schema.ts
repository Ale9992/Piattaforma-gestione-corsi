import { relations, sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Convenzioni:
 * - date: TEXT 'YYYY-MM-DD' (ora locale Europe/Rome, nessun fuso) — validate con `date(x) IS x`;
 * - orari: INTEGER minuti dalla mezzanotte;
 * - timestamp tecnici: TEXT ISO-8601 UTC.
 * Durata lezione, data fine prevista, ore svolte/residue e disponibilità sono derivate.
 */

const isoDate = (column: unknown) => sql`date(${column}) IS ${column}`;
const timestamps = {
  createdAt: text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
};

export const courses = sqliteTable(
  "courses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    clientCompany: text("client_company").notNull().default(""),
    mode: text("mode").notNull().default(""),
    studentsCount: integer("students_count"),
    studentReference: text("student_reference").notNull().default(""),
    /** Numero dell'ordine d'incarico MAC ("Incarico n. 260532"): serve in fattura. */
    assignmentNumber: text("assignment_number").notNull().default(""),
    /** Referente del cliente, quando è una persona diversa dall'allievo. */
    clientContact: text("client_contact").notNull().default(""),
    /**
     * Compenso pattuito per il corso, in centesimi. NULL = non indicato.
     * Senza CHECK: aggiungerlo obbligherebbe SQLite a ricostruire la tabella,
     * e la ricostruzione porterebbe con sé le lezioni collegate. Il valore è
     * comunque validato nel servizio.
     */
    feeCents: integer("fee_cents"),
    /** Lettera d'incarico allegata alla mail, dentro la cartella allegati. */
    contractFile: text("contract_file").notNull().default(""),
    /**
     * Accesso alla riunione Teams, quando il corso si fa online: link, utente e
     * password arrivano nella mail di conferma. Sono in chiaro, come il resto
     * della mail da cui vengono; il gestionale vive sulla rete di casa.
     */
    meetingUrl: text("meeting_url").notNull().default(""),
    meetingUser: text("meeting_user").notNull().default(""),
    meetingPassword: text("meeting_password").notNull().default(""),
    totalMinutes: integer("total_minutes").notNull(),
    startDate: text("start_date").notNull(),
    status: text("status", { enum: ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"] })
      .notNull()
      .default("NOT_STARTED"),
    notes: text("notes").notNull().default(""),
    ...timestamps,
  },
  (t) => [
    index("courses_status_idx").on(t.status),
    check("courses_name_chk", sql`length(trim(${t.name})) > 0`),
    check("courses_status_chk", sql`${t.status} IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED')`),
    check("courses_total_minutes_chk", sql`${t.totalMinutes} > 0`),
    check("courses_students_chk", sql`${t.studentsCount} IS NULL OR ${t.studentsCount} >= 0`),
    check("courses_start_date_chk", isoDate(t.startDate)),
  ],
);

export const scheduleRules = sqliteTable(
  "schedule_rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    courseId: integer("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to"),
    /** bit 0 = lunedì … bit 6 = domenica */
    weekdaysMask: integer("weekdays_mask").notNull(),
    startMin: integer("start_min").notNull(),
    endMin: integer("end_min").notNull(),
    ...timestamps,
  },
  (t) => [
    index("schedule_rules_course_idx").on(t.courseId, t.validFrom),
    check("schedule_rules_valid_from_chk", isoDate(t.validFrom)),
    check(
      "schedule_rules_valid_to_chk",
      sql`${t.validTo} IS NULL OR (date(${t.validTo}) IS ${t.validTo} AND ${t.validTo} >= ${t.validFrom})`,
    ),
    check("schedule_rules_mask_chk", sql`${t.weekdaysMask} BETWEEN 1 AND 127`),
    check(
      "schedule_rules_time_chk",
      sql`${t.startMin} >= 0 AND ${t.endMin} <= 1440 AND ${t.startMin} < ${t.endMin}`,
    ),
  ],
);

export const lessons = sqliteTable(
  "lessons",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    courseId: integer("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    startMin: integer("start_min").notNull(),
    endMin: integer("end_min").notNull(),
    status: text("status", { enum: ["PLANNED", "COMPLETED", "CANCELLED"] })
      .notNull()
      .default("PLANNED"),
    /** Regola che ha generato la lezione (null se la regola è stata eliminata). */
    scheduleRuleId: integer("schedule_rule_id").references(() => scheduleRules.id, {
      onDelete: "set null",
    }),
    /** Occorrenza della regola occupata dalla lezione; invariata se la lezione viene spostata. */
    slotDate: text("slot_date"),
    /** Modificata manualmente (data/orario): il motore non la rigenera. */
    isManual: integer("is_manual", { mode: "boolean" }).notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index("lessons_course_date_idx").on(t.courseId, t.date, t.startMin),
    index("lessons_date_idx").on(t.date, t.startMin),
    check("lessons_date_chk", isoDate(t.date)),
    check("lessons_slot_date_chk", sql`${t.slotDate} IS NULL OR date(${t.slotDate}) IS ${t.slotDate}`),
    check("lessons_status_chk", sql`${t.status} IN ('PLANNED', 'COMPLETED', 'CANCELLED')`),
    check(
      "lessons_time_chk",
      sql`${t.startMin} >= 0 AND ${t.endMin} <= 1440 AND ${t.startMin} < ${t.endMin}`,
    ),
    check("lessons_is_manual_chk", sql`${t.isManual} IN (0, 1)`),
  ],
);

export const coursePauses = sqliteTable(
  "course_pauses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    courseId: integer("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    ...timestamps,
  },
  (t) => [
    index("course_pauses_course_idx").on(t.courseId, t.startDate),
    check("course_pauses_start_chk", isoDate(t.startDate)),
    check("course_pauses_end_chk", isoDate(t.endDate)),
    check("course_pauses_range_chk", sql`${t.startDate} <= ${t.endDate}`),
  ],
);

/** Una riga = "Prelezione presente". Data/orario possono essere ancora da definire. */
export const preLessons = sqliteTable(
  "pre_lessons",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    courseId: integer("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    date: text("date"),
    startMin: integer("start_min"),
    endMin: integer("end_min"),
    /**
     * Anche se resta fuori dal monte ore, la prelezione va segnata: può slittare,
     * saltare o essere annullata come una lezione qualsiasi.
     */
    status: text("status", { enum: ["PLANNED", "COMPLETED", "CANCELLED"] })
      .notNull()
      .default("PLANNED"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("pre_lessons_course_uq").on(t.courseId),
    index("pre_lessons_date_idx").on(t.date),
    check(
      "pre_lessons_defined_chk",
      sql`(${t.date} IS NULL AND ${t.startMin} IS NULL AND ${t.endMin} IS NULL) OR (${t.date} IS NOT NULL AND ${t.startMin} IS NOT NULL AND ${t.endMin} IS NOT NULL)`,
    ),
    check("pre_lessons_date_chk", sql`${t.date} IS NULL OR date(${t.date}) IS ${t.date}`),
    check(
      "pre_lessons_duration_chk",
      sql`${t.startMin} IS NULL OR (${t.startMin} >= 0 AND ${t.endMin} = ${t.startMin} + 60 AND ${t.endMin} <= 1440)`,
    ),
  ],
);

export const coursesRelations = relations(courses, ({ many, one }) => ({
  rules: many(scheduleRules),
  lessons: many(lessons),
  pauses: many(coursePauses),
  preLesson: one(preLessons),
}));

export const scheduleRulesRelations = relations(scheduleRules, ({ one }) => ({
  course: one(courses, { fields: [scheduleRules.courseId], references: [courses.id] }),
}));

export const lessonsRelations = relations(lessons, ({ one }) => ({
  course: one(courses, { fields: [lessons.courseId], references: [courses.id] }),
  rule: one(scheduleRules, { fields: [lessons.scheduleRuleId], references: [scheduleRules.id] }),
}));

export const coursePausesRelations = relations(coursePauses, ({ one }) => ({
  course: one(courses, { fields: [coursePauses.courseId], references: [courses.id] }),
}));

export const preLessonsRelations = relations(preLessons, ({ one }) => ({
  course: one(courses, { fields: [preLessons.courseId], references: [courses.id] }),
}));

export type CourseRow = typeof courses.$inferSelect;
export type ScheduleRuleRow = typeof scheduleRules.$inferSelect;
export type LessonRow = typeof lessons.$inferSelect;
export type PauseRow = typeof coursePauses.$inferSelect;
export type PreLessonRow = typeof preLessons.$inferSelect;

/**
 * Impegni a calendario che non appartengono a nessun corso.
 *
 * Capita che l'agenzia fissi un incontro preliminare prima ancora che il corso
 * esista: non è una lezione né una prelezione — non ha un corso a cui agganciarsi
 * — ma occupa il tempo come le altre, e come le altre deve finire sul calendario
 * e togliere quella fascia dalle disponibilità.
 */
export const appointments = sqliteTable(
  "appointments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Come compare sul calendario: "Incontro preliminare AI GENERATIVA…". */
    title: text("title").notNull(),
    date: text("date").notNull(),
    startMin: integer("start_min").notNull(),
    endMin: integer("end_min").notNull(),
    notes: text("notes").notNull().default(""),
    ...timestamps,
  },
  (t) => [
    index("appointments_date_idx").on(t.date),
    check("appointments_title_chk", sql`length(trim(${t.title})) > 0`),
    check("appointments_date_chk", isoDate(t.date)),
    check(
      "appointments_time_chk",
      sql`${t.startMin} >= 0 AND ${t.endMin} > ${t.startMin} AND ${t.endMin} <= 1440`,
    ),
  ],
);

export type AppointmentRow = typeof appointments.$inferSelect;

/**
 * Posta in arrivo: ogni mail dei mittenti seguiti viene archiviata qui con la
 * proposta ricavata dal testo. Nulla viene applicato al calendario senza una
 * conferma esplicita: lo stato passa da NUOVA a CONFERMATA o IGNORATA.
 */
export const mailMessages = sqliteTable(
  "mail_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** UID nella casella: serve a non rileggere due volte lo stesso messaggio. */
    uid: integer("uid").notNull(),
    messageId: text("message_id").notNull(),
    /** Mittente originale (dietro l'inoltro) e mittente della busta. */
    sender: text("sender").notNull(),
    envelopeSender: text("envelope_sender").notNull().default(""),
    subject: text("subject").notNull().default(""),
    receivedAt: text("received_at").notNull(),
    body: text("body").notNull().default(""),
    kind: text("kind", {
      enum: [
        "NUOVO_CORSO",
        "ANNULLAMENTO",
        "CAMBIO_CALENDARIO",
        "CONFERMA_CALENDARIO",
        "CHIUSURA_CORSO",
        "INCONTRO_PRELIMINARE",
        "ALTRO",
      ],
    }),
    status: text("status", { enum: ["NUOVA", "CONFERMATA", "IGNORATA", "ERRORE"] })
      .notNull()
      .default("NUOVA"),
    /** Proposta calcolata dal gestionale (JSON), mostrata prima della conferma. */
    proposal: text("proposal"),
    /** Allegati salvati, come JSON: [{ "nome": "...", "file": "mail-3/..." }]. */
    attachments: text("attachments").notNull().default("[]"),
    /** Corso a cui la mail è stata abbinata, quando riconosciuto. */
    courseId: integer("course_id").references(() => courses.id, { onDelete: "set null" }),
    note: text("note").notNull().default(""),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("mail_messages_message_id_uq").on(t.messageId),
    index("mail_messages_status_idx").on(t.status, t.receivedAt),
    check("mail_messages_status_chk", sql`${t.status} IN ('NUOVA', 'CONFERMATA', 'IGNORATA', 'ERRORE')`),
    check(
      "mail_messages_kind_chk",
      sql`${t.kind} IS NULL OR ${t.kind} IN ('NUOVO_CORSO', 'ANNULLAMENTO', 'CAMBIO_CALENDARIO', 'CONFERMA_CALENDARIO', 'CHIUSURA_CORSO', 'INCONTRO_PRELIMINARE', 'ALTRO')`,
    ),
  ],
);

/** Valori tecnici di servizio, per esempio l'ultimo messaggio letto. */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  ...timestamps,
});

export const mailMessagesRelations = relations(mailMessages, ({ one }) => ({
  course: one(courses, { fields: [mailMessages.courseId], references: [courses.id] }),
}));
