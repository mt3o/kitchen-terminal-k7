CREATE TABLE `oauth_credentials` (
	`provider` text PRIMARY KEY NOT NULL,
	`ciphertext` blob NOT NULL,
	`iv` blob NOT NULL,
	`auth_tag` blob NOT NULL,
	`scope` text NOT NULL,
	`account_email` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
