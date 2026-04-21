CREATE TABLE IF NOT EXISTS `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`key_prefix` text NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `api_keys_user_id_idx` ON `api_keys` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `api_keys_key_hash_idx` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `friends` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`friend_user_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`accepted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`friend_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `friends_user_id_idx` ON `friends` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `friends_friend_user_id_idx` ON `friends` (`friend_user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `friends_status_idx` ON `friends` (`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `friends_unique_idx` ON `friends` (`user_id`,`friend_user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tickets_from_user_id_idx` ON `tickets` (`from_user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tickets_to_user_id_idx` ON `tickets` (`to_user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tickets_to_device_idx` ON `tickets` (`to_device_id`);
