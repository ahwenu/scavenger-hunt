/** D1のbatchトランザクションで合格と通知イベントを同時に確定する。 */
export type PassEvent={id:number;roomId:string;playerId:string;roundId:string;submissionId:string;receivedAt:number;createdAt:number;rankAtCreation:number;pendingAhead:number};
const INSERT_EVENT=`INSERT INTO pass_events (roomId,playerId,roundId,submissionId,receivedAt,createdAt,rankAtCreation,pendingAhead)
SELECT s.roomId,s.playerId,s.roundId,s.id,s.receivedAt,?,
  1+(SELECT COUNT(*) FROM submissions a WHERE a.roomId=s.roomId AND a.roundId=s.roundId AND a.status='accepted' AND (a.receivedAt<s.receivedAt OR (a.receivedAt=s.receivedAt AND a.seq<s.seq))),
  (SELECT COUNT(*) FROM submissions p WHERE p.roomId=s.roomId AND p.roundId=s.roundId AND p.status IN ('queued','processing','uploading','retrying','pending') AND (p.receivedAt<s.receivedAt OR (p.receivedAt=s.receivedAt AND p.seq<s.seq)))
FROM submissions s WHERE s.id=? AND s.status='accepted'
ON CONFLICT(submissionId) DO NOTHING`;
/** 合格の保存または通知INSERTのいずれかが失敗した場合は、全体をロールバックする。 */
export async function recordPass(db:D1Database,subId:string,verdict:{pass:boolean;[key:string]:unknown}):Promise<PassEvent|undefined>{
  if(verdict?.pass!==true)throw Error('pass_verdict_required');
  const results=await db.batch([
    db.prepare("UPDATE submissions SET status='accepted',verdict=?,leaseUntil=0 WHERE id=? AND status='processing'").bind(JSON.stringify(verdict),subId),
    db.prepare(INSERT_EVENT).bind(Date.now(),subId),
    db.prepare('SELECT * FROM pass_events WHERE submissionId=?').bind(subId),
  ]);
  return results[2].results[0] as PassEvent|undefined;
}
