/** 合格の確定と公開通知イベントを同一SQLiteトランザクションへ記録する。 */
const INSERT_EVENT=`INSERT INTO pass_events (roomId,playerId,roundId,submissionId,receivedAt,createdAt,rankAtCreation,pendingAhead)
SELECT s.roomId,s.playerId,s.roundId,s.id,s.receivedAt,?,
  1+(SELECT COUNT(*) FROM submissions a WHERE a.roomId=s.roomId AND a.roundId=s.roundId AND a.status='accepted' AND (a.receivedAt<s.receivedAt OR (a.receivedAt=s.receivedAt AND a.seq<s.seq))),
  (SELECT COUNT(*) FROM submissions p WHERE p.roomId=s.roomId AND p.roundId=s.roundId AND p.status IN ('queued','processing','uploading','retrying','pending') AND (p.receivedAt<s.receivedAt OR (p.receivedAt=s.receivedAt AND p.seq<s.seq)))
FROM submissions s WHERE s.id=? AND s.status='accepted'
ON CONFLICT(submissionId) DO NOTHING`;
/** 起動時に一度だけ、通知テーブルと検索用インデックスを準備する。 */
export function createPassEventsSchema(db){
  db.exec(`CREATE TABLE IF NOT EXISTS pass_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    roomId TEXT NOT NULL,
    playerId TEXT NOT NULL,
    roundId TEXT NOT NULL,
    submissionId TEXT NOT NULL UNIQUE,
    receivedAt INTEGER NOT NULL,
    createdAt INTEGER NOT NULL,
    rankAtCreation INTEGER NOT NULL,
    pendingAhead INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS pass_events_room_id ON pass_events(roomId,id);`);
}
/** 合格だけを確定し、DBから導いたルーム・順位・先行判定待ち人数を一度だけ保存する。 */
export function recordPass(db,subId,verdict){
  if(verdict?.pass!==true)throw Error('pass_verdict_required');
  const encoded=JSON.stringify(verdict);
  db.exec('SAVEPOINT pass_event_record');
  try{
    db.prepare("UPDATE submissions SET status='accepted',verdict=? WHERE id=? AND status='processing'").run(encoded,subId);
    db.prepare(INSERT_EVENT).run(Date.now(),subId);
    const event=db.prepare('SELECT * FROM pass_events WHERE submissionId=?').get(subId);
    db.exec('RELEASE SAVEPOINT pass_event_record');
    return event;
  }catch(error){
    db.exec('ROLLBACK TO SAVEPOINT pass_event_record');
    db.exec('RELEASE SAVEPOINT pass_event_record');
    throw error;
  }
}
