CREATE TABLE `appointments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`date` text NOT NULL,
	`start_min` integer NOT NULL,
	`end_min` integer NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "appointments_title_chk" CHECK(length(trim("appointments"."title")) > 0),
	CONSTRAINT "appointments_date_chk" CHECK(date("appointments"."date") IS "appointments"."date"),
	CONSTRAINT "appointments_time_chk" CHECK("appointments"."start_min" >= 0 AND "appointments"."end_min" > "appointments"."start_min" AND "appointments"."end_min" <= 1440)
);
--> statement-breakpoint
CREATE INDEX `appointments_date_idx` ON `appointments` (`date`);