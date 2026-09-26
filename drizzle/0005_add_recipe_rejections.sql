CREATE TABLE `recipe_rejections` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`reason` text NOT NULL,
	`attempted_input` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `recipe_rejections_created_idx` ON `recipe_rejections` (`created_at`);