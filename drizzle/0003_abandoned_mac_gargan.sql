CREATE TABLE `issue_log` (
	`id` text PRIMARY KEY NOT NULL,
	`severity` text NOT NULL,
	`source` text NOT NULL,
	`message` text NOT NULL,
	`detail` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `issue_log_created_idx` ON `issue_log` (`created_at`);