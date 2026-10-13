ALTER TABLE `courses` ADD `fee_cents` integer;--> statement-breakpoint
ALTER TABLE `courses` ADD `contract_file` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `mail_messages` ADD `attachments` text DEFAULT '[]' NOT NULL;