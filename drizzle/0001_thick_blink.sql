CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mail_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uid` integer NOT NULL,
	`message_id` text NOT NULL,
	`sender` text NOT NULL,
	`envelope_sender` text DEFAULT '' NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`received_at` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`kind` text,
	`status` text DEFAULT 'NUOVA' NOT NULL,
	`proposal` text,
	`course_id` integer,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "mail_messages_status_chk" CHECK("mail_messages"."status" IN ('NUOVA', 'CONFERMATA', 'IGNORATA', 'ERRORE')),
	CONSTRAINT "mail_messages_kind_chk" CHECK("mail_messages"."kind" IS NULL OR "mail_messages"."kind" IN ('NUOVO_CORSO', 'ANNULLAMENTO', 'CAMBIO_CALENDARIO', 'ALTRO'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_messages_message_id_uq` ON `mail_messages` (`message_id`);--> statement-breakpoint
CREATE INDEX `mail_messages_status_idx` ON `mail_messages` (`status`,`received_at`);