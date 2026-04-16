-- Migration: remove FOREIGN KEY constraints that reference user(id)
-- These were created for Better Auth but we now use Clerk for authentication.
-- Clerk user IDs are not stored in the user table, so FK constraints cause
-- insert failures. SQLite requires recreating the table to drop constraints.

PRAGMA foreign_keys = OFF;

-- ── devices ──────────────────────────────────────────────────────────────────
CREATE TABLE `devices_new` (
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
	`updated_at` integer NOT NULL
);
INSERT INTO `devices_new` SELECT * FROM `devices`;
DROP TABLE `devices`;
ALTER TABLE `devices_new` RENAME TO `devices`;
CREATE INDEX `devices_user_id_idx` ON `devices` (`user_id`);
CREATE INDEX `devices_unique_device_idx` ON `devices` (`user_id`,`platform`,`device_id`);
CREATE INDEX `devices_online_idx` ON `devices` (`online`);
CREATE INDEX `devices_last_seen_idx` ON `devices` (`last_seen_at`);

-- ── tickets ───────────────────────────────────────────────────────────────────
CREATE TABLE `tickets_new` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`from_device_id` text NOT NULL,
	`ticket` text NOT NULL,
	`filename` text,
	`file_size` integer,
	`status` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`received_at` integer,
	`to_user_id` text,
	`to_device_id` text,
	`from_user_id` text
);
INSERT INTO `tickets_new` SELECT * FROM `tickets`;
DROP TABLE `tickets`;
ALTER TABLE `tickets_new` RENAME TO `tickets`;
CREATE INDEX `tickets_user_id_idx` ON `tickets` (`user_id`);
CREATE INDEX `tickets_from_device_id_idx` ON `tickets` (`from_device_id`);
CREATE INDEX `tickets_status_idx` ON `tickets` (`status`);
CREATE INDEX `tickets_expires_at_idx` ON `tickets` (`expires_at`);

-- ── transfers ─────────────────────────────────────────────────────────────────
CREATE TABLE `transfers_new` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`filename` text NOT NULL,
	`file_size` integer NOT NULL,
	`ticket` text,
	`status` text NOT NULL,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer
);
INSERT INTO `transfers_new` SELECT * FROM `transfers`;
DROP TABLE `transfers`;
ALTER TABLE `transfers_new` RENAME TO `transfers`;
CREATE INDEX `transfers_user_id_idx` ON `transfers` (`user_id`);
CREATE INDEX `transfers_status_idx` ON `transfers` (`status`);
CREATE INDEX `transfers_created_at_idx` ON `transfers` (`created_at`);

-- ── friends ───────────────────────────────────────────────────────────────────
CREATE TABLE `friends_new` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`friend_user_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`accepted_at` integer
);
INSERT INTO `friends_new` SELECT * FROM `friends`;
DROP TABLE `friends`;
ALTER TABLE `friends_new` RENAME TO `friends`;
CREATE INDEX `friends_user_id_idx` ON `friends` (`user_id`);
CREATE INDEX `friends_friend_user_id_idx` ON `friends` (`friend_user_id`);
CREATE UNIQUE INDEX `friends_unique_pair_idx` ON `friends` (`user_id`,`friend_user_id`);

PRAGMA foreign_keys = ON;
