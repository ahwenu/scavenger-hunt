CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`name` text NOT NULL,
	`profile` text NOT NULL,
	`joinedAt` integer NOT NULL,
	`roomId` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `players_token` ON `players` (`token`);--> statement-breakpoint
CREATE INDEX `players_room` ON `players` (`roomId`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`hostHash` text NOT NULL,
	`mode` text NOT NULL,
	`createdAt` integer NOT NULL,
	`generationLease` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`number` integer NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`challenge` text NOT NULL,
	`context` text NOT NULL,
	`startedAt` integer NOT NULL,
	`endsAt` integer NOT NULL,
	`roomId` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rounds_room_number` ON `rounds` (`roomId`,`number`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`playerId` text NOT NULL,
	`roundId` text NOT NULL,
	`requestId` text NOT NULL,
	`hash` text,
	`receivedAt` integer NOT NULL,
	`status` text NOT NULL,
	`verdict` text,
	`roomId` text NOT NULL,
	`objectKey` text NOT NULL,
	`mime` text NOT NULL,
	`demoResult` text NOT NULL,
	`leaseUntil` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submission_id` ON `submissions` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `submission_request` ON `submissions` (`playerId`,`roundId`,`requestId`);--> statement-breakpoint
CREATE UNIQUE INDEX `submission_hash` ON `submissions` (`roundId`,`hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `submission_active_player` ON `submissions` (`playerId`,`roundId`) WHERE status IN ('uploading','queued','processing','accepted');--> statement-breakpoint
CREATE INDEX `submission_queue` ON `submissions` (`status`,`seq`);--> statement-breakpoint
CREATE INDEX `submission_room` ON `submissions` (`roomId`);