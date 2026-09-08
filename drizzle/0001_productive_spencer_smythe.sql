CREATE TABLE `upstream_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`upstream` text NOT NULL,
	`payload` text NOT NULL,
	`fetched_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
