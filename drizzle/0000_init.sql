CREATE TABLE `course_pauses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`course_id` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "course_pauses_start_chk" CHECK(date("course_pauses"."start_date") IS "course_pauses"."start_date"),
	CONSTRAINT "course_pauses_end_chk" CHECK(date("course_pauses"."end_date") IS "course_pauses"."end_date"),
	CONSTRAINT "course_pauses_range_chk" CHECK("course_pauses"."start_date" <= "course_pauses"."end_date")
);
--> statement-breakpoint
CREATE INDEX `course_pauses_course_idx` ON `course_pauses` (`course_id`,`start_date`);--> statement-breakpoint
CREATE TABLE `courses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`client_company` text DEFAULT '' NOT NULL,
	`mode` text DEFAULT '' NOT NULL,
	`students_count` integer,
	`student_reference` text DEFAULT '' NOT NULL,
	`total_minutes` integer NOT NULL,
	`start_date` text NOT NULL,
	`status` text DEFAULT 'NOT_STARTED' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "courses_name_chk" CHECK(length(trim("courses"."name")) > 0),
	CONSTRAINT "courses_status_chk" CHECK("courses"."status" IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED')),
	CONSTRAINT "courses_total_minutes_chk" CHECK("courses"."total_minutes" > 0),
	CONSTRAINT "courses_students_chk" CHECK("courses"."students_count" IS NULL OR "courses"."students_count" >= 0),
	CONSTRAINT "courses_start_date_chk" CHECK(date("courses"."start_date") IS "courses"."start_date")
);
--> statement-breakpoint
CREATE INDEX `courses_status_idx` ON `courses` (`status`);--> statement-breakpoint
CREATE TABLE `lessons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`course_id` integer NOT NULL,
	`date` text NOT NULL,
	`start_min` integer NOT NULL,
	`end_min` integer NOT NULL,
	`status` text DEFAULT 'PLANNED' NOT NULL,
	`schedule_rule_id` integer,
	`slot_date` text,
	`is_manual` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`schedule_rule_id`) REFERENCES `schedule_rules`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "lessons_date_chk" CHECK(date("lessons"."date") IS "lessons"."date"),
	CONSTRAINT "lessons_slot_date_chk" CHECK("lessons"."slot_date" IS NULL OR date("lessons"."slot_date") IS "lessons"."slot_date"),
	CONSTRAINT "lessons_status_chk" CHECK("lessons"."status" IN ('PLANNED', 'COMPLETED', 'CANCELLED')),
	CONSTRAINT "lessons_time_chk" CHECK("lessons"."start_min" >= 0 AND "lessons"."end_min" <= 1440 AND "lessons"."start_min" < "lessons"."end_min"),
	CONSTRAINT "lessons_is_manual_chk" CHECK("lessons"."is_manual" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `lessons_course_date_idx` ON `lessons` (`course_id`,`date`,`start_min`);--> statement-breakpoint
CREATE INDEX `lessons_date_idx` ON `lessons` (`date`,`start_min`);--> statement-breakpoint
CREATE TABLE `pre_lessons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`course_id` integer NOT NULL,
	`date` text,
	`start_min` integer,
	`end_min` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "pre_lessons_defined_chk" CHECK(("pre_lessons"."date" IS NULL AND "pre_lessons"."start_min" IS NULL AND "pre_lessons"."end_min" IS NULL) OR ("pre_lessons"."date" IS NOT NULL AND "pre_lessons"."start_min" IS NOT NULL AND "pre_lessons"."end_min" IS NOT NULL)),
	CONSTRAINT "pre_lessons_date_chk" CHECK("pre_lessons"."date" IS NULL OR date("pre_lessons"."date") IS "pre_lessons"."date"),
	CONSTRAINT "pre_lessons_duration_chk" CHECK("pre_lessons"."start_min" IS NULL OR ("pre_lessons"."start_min" >= 0 AND "pre_lessons"."end_min" = "pre_lessons"."start_min" + 60 AND "pre_lessons"."end_min" <= 1440))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pre_lessons_course_uq` ON `pre_lessons` (`course_id`);--> statement-breakpoint
CREATE INDEX `pre_lessons_date_idx` ON `pre_lessons` (`date`);--> statement-breakpoint
CREATE TABLE `schedule_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`course_id` integer NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`weekdays_mask` integer NOT NULL,
	`start_min` integer NOT NULL,
	`end_min` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "schedule_rules_valid_from_chk" CHECK(date("schedule_rules"."valid_from") IS "schedule_rules"."valid_from"),
	CONSTRAINT "schedule_rules_valid_to_chk" CHECK("schedule_rules"."valid_to" IS NULL OR (date("schedule_rules"."valid_to") IS "schedule_rules"."valid_to" AND "schedule_rules"."valid_to" >= "schedule_rules"."valid_from")),
	CONSTRAINT "schedule_rules_mask_chk" CHECK("schedule_rules"."weekdays_mask" BETWEEN 1 AND 127),
	CONSTRAINT "schedule_rules_time_chk" CHECK("schedule_rules"."start_min" >= 0 AND "schedule_rules"."end_min" <= 1440 AND "schedule_rules"."start_min" < "schedule_rules"."end_min")
);
--> statement-breakpoint
CREATE INDEX `schedule_rules_course_idx` ON `schedule_rules` (`course_id`,`valid_from`);