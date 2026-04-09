-- Migration: Add friends system and extend tickets for friend-to-friend transfers

-- Add new columns to tickets table for friend-to-friend routing
ALTER TABLE `tickets` ADD COLUMN `to_user_id` text;--> statement-breakpoint
ALTER TABLE `tickets` ADD COLUMN `to_device_id` text;--> statement-breakpoint
ALTER TABLE `tickets` ADD COLUMN `from_user_id` text;--> statement-breakpoint

-- Add indexes for the new columns
CREATE INDEX `tickets_to_user_id_idx` ON `tickets` (`to_user_id`);--> statement-breakpoint
CREATE INDEX `tickets_to_device_idx` ON `tickets` (`to_device_id`);--> statement-breakpoint
CREATE INDEX `tickets_from_user_id_idx` ON `tickets` (`from_user_id`);--> statement-breakpoint

-- Create friends table for tracking friend relationships
CREATE TABLE `friends` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`friend_user_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`accepted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`friend_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint

-- Add indexes for friends table
CREATE INDEX `friends_user_id_idx` ON `friends` (`user_id`);--> statement-breakpoint
CREATE INDEX `friends_friend_user_id_idx` ON `friends` (`friend_user_id`);--> statement-breakpoint
CREATE INDEX `friends_status_idx` ON `friends` (`status`);--> statement-breakpoint
CREATE INDEX `friends_unique_idx` ON `friends` (`user_id`, `friend_user_id`);
