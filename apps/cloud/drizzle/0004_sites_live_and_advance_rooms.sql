ALTER TABLE `players` ADD `lastSeenAt` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `autoStart` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `updatedAt` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TRIGGER rooms_live_update AFTER UPDATE OF name,autoStart,mode,generationLease,preparedChallenge,preparedMode,preparedAt,preparationError,lobbyDeadline,lobbyStartedAt ON rooms
WHEN OLD.name IS NOT NEW.name OR OLD.autoStart IS NOT NEW.autoStart OR OLD.mode IS NOT NEW.mode OR OLD.generationLease IS NOT NEW.generationLease OR OLD.preparedChallenge IS NOT NEW.preparedChallenge OR OLD.preparedMode IS NOT NEW.preparedMode OR OLD.preparedAt IS NOT NEW.preparedAt OR OLD.preparationError IS NOT NEW.preparationError OR OLD.lobbyDeadline IS NOT NEW.lobbyDeadline OR OLD.lobbyStartedAt IS NOT NEW.lobbyStartedAt
BEGIN
  UPDATE rooms SET revision=revision+1,updatedAt=MAX(updatedAt, CAST(strftime('%s','now') AS INTEGER)*1000) WHERE id=NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER players_live_insert AFTER INSERT ON players
BEGIN
  UPDATE rooms SET revision=revision+1,updatedAt=MAX(updatedAt, CAST(strftime('%s','now') AS INTEGER)*1000) WHERE id=NEW.roomId;
END;
--> statement-breakpoint
CREATE TRIGGER players_live_update AFTER UPDATE OF name,joinedAt,lastSeenAt ON players
WHEN OLD.name IS NOT NEW.name OR OLD.joinedAt IS NOT NEW.joinedAt OR OLD.lastSeenAt IS NOT NEW.lastSeenAt
BEGIN
  UPDATE rooms SET revision=revision+1,updatedAt=MAX(updatedAt, CAST(strftime('%s','now') AS INTEGER)*1000) WHERE id=NEW.roomId;
END;
--> statement-breakpoint
CREATE TRIGGER players_live_delete AFTER DELETE ON players
BEGIN
  UPDATE rooms SET revision=revision+1,updatedAt=MAX(updatedAt, CAST(strftime('%s','now') AS INTEGER)*1000) WHERE id=OLD.roomId;
END;
--> statement-breakpoint
CREATE TRIGGER rounds_live_insert AFTER INSERT ON rounds
BEGIN
  UPDATE rooms SET revision=revision+1,updatedAt=MAX(updatedAt, CAST(strftime('%s','now') AS INTEGER)*1000) WHERE id=NEW.roomId;
END;
--> statement-breakpoint
CREATE TRIGGER rounds_live_update AFTER UPDATE OF number,mode,status,challenge,startedAt,endsAt,hint ON rounds
WHEN OLD.number IS NOT NEW.number OR OLD.mode IS NOT NEW.mode OR OLD.status IS NOT NEW.status OR OLD.challenge IS NOT NEW.challenge OR OLD.startedAt IS NOT NEW.startedAt OR OLD.endsAt IS NOT NEW.endsAt OR OLD.hint IS NOT NEW.hint
BEGIN
  UPDATE rooms SET revision=revision+1,updatedAt=MAX(updatedAt, CAST(strftime('%s','now') AS INTEGER)*1000) WHERE id=NEW.roomId;
END;
--> statement-breakpoint
CREATE TRIGGER rounds_live_delete AFTER DELETE ON rounds
BEGIN
  UPDATE rooms SET revision=revision+1,updatedAt=MAX(updatedAt, CAST(strftime('%s','now') AS INTEGER)*1000) WHERE id=OLD.roomId;
END;
--> statement-breakpoint
CREATE TRIGGER submissions_live_insert AFTER INSERT ON submissions
BEGIN
  UPDATE rooms SET revision=revision+1,updatedAt=MAX(updatedAt, CAST(strftime('%s','now') AS INTEGER)*1000) WHERE id=NEW.roomId;
END;
--> statement-breakpoint
CREATE TRIGGER submissions_live_update AFTER UPDATE OF playerId,roundId,receivedAt,status,verdict ON submissions
WHEN OLD.playerId IS NOT NEW.playerId OR OLD.roundId IS NOT NEW.roundId OR OLD.receivedAt IS NOT NEW.receivedAt OR OLD.status IS NOT NEW.status OR OLD.verdict IS NOT NEW.verdict
BEGIN
  UPDATE rooms SET revision=revision+1,updatedAt=MAX(updatedAt, CAST(strftime('%s','now') AS INTEGER)*1000) WHERE id=NEW.roomId;
END;
--> statement-breakpoint
CREATE TRIGGER submissions_live_delete AFTER DELETE ON submissions
BEGIN
  UPDATE rooms SET revision=revision+1,updatedAt=MAX(updatedAt, CAST(strftime('%s','now') AS INTEGER)*1000) WHERE id=OLD.roomId;
END;
--> statement-breakpoint
CREATE TRIGGER pass_events_live_insert AFTER INSERT ON pass_events
BEGIN
  UPDATE rooms SET revision=revision+1,updatedAt=MAX(updatedAt, CAST(strftime('%s','now') AS INTEGER)*1000) WHERE id=NEW.roomId;
END;
--> statement-breakpoint
CREATE TRIGGER pass_events_live_update AFTER UPDATE OF playerId,roundId,submissionId,receivedAt,createdAt,rankAtCreation,pendingAhead ON pass_events
WHEN OLD.playerId IS NOT NEW.playerId OR OLD.roundId IS NOT NEW.roundId OR OLD.submissionId IS NOT NEW.submissionId OR OLD.receivedAt IS NOT NEW.receivedAt OR OLD.createdAt IS NOT NEW.createdAt OR OLD.rankAtCreation IS NOT NEW.rankAtCreation OR OLD.pendingAhead IS NOT NEW.pendingAhead
BEGIN
  UPDATE rooms SET revision=revision+1,updatedAt=MAX(updatedAt, CAST(strftime('%s','now') AS INTEGER)*1000) WHERE id=NEW.roomId;
END;
--> statement-breakpoint
CREATE TRIGGER pass_events_live_delete AFTER DELETE ON pass_events
BEGIN
  UPDATE rooms SET revision=revision+1,updatedAt=MAX(updatedAt, CAST(strftime('%s','now') AS INTEGER)*1000) WHERE id=OLD.roomId;
END;
