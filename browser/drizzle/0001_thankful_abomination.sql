CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`platform` text NOT NULL,
	`device_id` text NOT NULL,
	`name` text NOT NULL,
	`ip_address` text,
	`hostname` text,
	`user_agent` text,
	`online` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `devices_user_id_idx` ON `devices` (`user_id`);--> statement-breakpoint
CREATE INDEX `devices_unique_device_idx` ON `devices` (`user_id`,`platform`,`device_id`);--> statement-breakpoint
CREATE INDEX `devices_online_idx` ON `devices` (`online`);--> statement-breakpoint
CREATE INDEX `devices_last_seen_idx` ON `devices` (`last_seen_at`);