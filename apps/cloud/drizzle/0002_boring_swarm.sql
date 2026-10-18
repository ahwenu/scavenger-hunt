CREATE TABLE `pass_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`roomId` text NOT NULL,
	`playerId` text NOT NULL,
	`roundId` text NOT NULL,
	`submissionId` text NOT NULL,
	`receivedAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`rankAtCreation` integer NOT NULL,
	`pendingAhead` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pass_events_submission` ON `pass_events` (`submissionId`);--> statement-breakpoint
CREATE INDEX `pass_events_room_id` ON `pass_events` (`roomId`,`id`);--> statement-breakpoint
ALTER TABLE `rooms` ADD `lobbyDeadline` integer;--> statement-breakpoint
ALTER TABLE `rooms` ADD `lobbyStartedAt` integer;