PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mail_messages` (
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
	`attachments` text DEFAULT '[]' NOT NULL,
	`course_id` integer,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "mail_messages_status_chk" CHECK("__new_mail_messages"."status" IN ('NUOVA', 'CONFERMATA', 'IGNORATA', 'ERRORE')),
	CONSTRAINT "mail_messages_kind_chk" CHECK("__new_mail_messages"."kind" IS NULL OR "__new_mail_messages"."kind" IN ('NUOVO_CORSO', 'ANNULLAMENTO', 'CAMBIO_CALENDARIO', 'CONFERMA_CALENDARIO', 'CHIUSURA_CORSO', 'INCONTRO_PRELIMINARE', 'ALTRO'))
);
--> statement-breakpoint
INSERT INTO `__new_mail_messages`("id", "uid", "message_id", "sender", "envelope_sender", "subject", "received_at", "body", "kind", "status", "proposal", "attachments", "course_id", "note", "created_at", "updated_at") SELECT "id", "uid", "message_id", "sender", "envelope_sender", "subject", "received_at", "body", "kind", "status", "proposal", "attachments", "course_id", "note", "created_at", "updated_at" FROM `mail_messages`;--> statement-breakpoint
DROP TABLE `mail_messages`;--> statement-breakpoint
ALTER TABLE `__new_mail_messages` RENAME TO `mail_messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `mail_messages_message_id_uq` ON `mail_messages` (`message_id`);--> statement-breakpoint
CREATE INDEX `mail_messages_status_idx` ON `mail_messages` (`status`,`received_at`);