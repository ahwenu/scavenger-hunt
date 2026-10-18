import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createPassEventsSchema,recordPass} from '../apps/server/pass-events.mjs';
/** 実SQLite上に必要最小限の受付テーブルを作る。 */
function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE submissions(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE,roomId TEXT,playerId TEXT,roundId TEXT,receivedAt INTEGER,status TEXT,verdict TEXT);`);
  createPassEventsSchema(db);createPassEventsSchema(db);
  return db;
}
/** 外部ペイロードではなく、判定元のDBへ信頼済み受付を配置する。 */
function submission(db,id,receivedAt,status='processing',roomId='room-a',roundId='round-a'){
  db.prepare('INSERT INTO submissions(id,roomId,playerId,roundId,receivedAt,status) VALUES (?,?,?,?,?,?)').run(id,roomId,`player-${id}`,roundId,receivedAt,status);
}

test('pass commit records trusted row identity and duplicate calls preserve exactly one event',()=>{
  const db=fixture();try{
    submission(db,'a',100);
    const verdict={pass:true,provider:'デモ判定',reason:'test'};
    const first=recordPass(db,'a',verdict),again=recordPass(db,'a',{...verdict,reason:'must not replace committed verdict'});
    assert.equal(first.roomId,'room-a');assert.equal(first.playerId,'player-a');assert.equal(first.roundId,'round-a');assert.equal(first.submissionId,'a');assert.equal(first.receivedAt,100);
    assert.equal(first.rankAtCreation,1);assert.equal(first.pendingAhead,0);assert.ok(first.createdAt>0);
    assert.deepEqual(again,first);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pass_events').get().n,1);
    const saved=db.prepare('SELECT status,verdict FROM submissions WHERE id=?').get('a');assert.equal(saved.status,'accepted');assert.deepEqual(JSON.parse(saved.verdict),verdict);
  }finally{db.close();}
});

test('failed event insert rolls accepted verdict back to processing',()=>{
  const db=fixture();try{
    submission(db,'a',100);
    db.exec("CREATE TRIGGER fail_event BEFORE INSERT ON pass_events BEGIN SELECT RAISE(ABORT,'test_event_insert_failure'); END;");
    assert.throws(()=>recordPass(db,'a',{pass:true,provider:'test'}),/test_event_insert_failure/);
    const saved=db.prepare('SELECT status,verdict FROM submissions WHERE id=?').get('a');assert.equal(saved.status,'processing');assert.equal(saved.verdict,null);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pass_events').get().n,0);
    db.exec('DROP TRIGGER fail_event');assert.equal(recordPass(db,'a',{pass:true}).submissionId,'a');
  }finally{db.close();}
});

test('receipt timestamp and sequence determine event rank and earlier pending count within one room and round',()=>{
  const db=fixture();try{
    submission(db,'first',100);submission(db,'second',100);submission(db,'third',101);
    submission(db,'foreign-room',1,'accepted','room-b');submission(db,'foreign-round',1,'accepted','room-a','round-b');
    const third=recordPass(db,'third',{pass:true});assert.equal(third.rankAtCreation,1);assert.equal(third.pendingAhead,2);
    const first=recordPass(db,'first',{pass:true});assert.equal(first.rankAtCreation,1);assert.equal(first.pendingAhead,0);
    const second=recordPass(db,'second',{pass:true});assert.equal(second.rankAtCreation,2);assert.equal(second.pendingAhead,0);
    // A notification's historical fields stay immutable; consumers recompute the current rank.
    assert.equal(db.prepare('SELECT rankAtCreation FROM pass_events WHERE submissionId=?').get('third').rankAtCreation,1);
    assert.deepEqual(db.prepare("SELECT id FROM submissions WHERE roomId='room-a' AND roundId='round-a' AND status='accepted' ORDER BY receivedAt,seq").all().map(x=>x.id),['first','second','third']);
  }finally{db.close();}
});

test('queued, rejected, unknown and non-pass results never fabricate accepted events',()=>{
  const db=fixture();try{
    submission(db,'queued',100,'queued');submission(db,'rejected',100,'rejected');submission(db,'active',100);
    assert.equal(recordPass(db,'queued',{pass:true}),undefined);assert.equal(recordPass(db,'rejected',{pass:true}),undefined);assert.equal(recordPass(db,'missing',{pass:true}),undefined);
    assert.throws(()=>recordPass(db,'active',{pass:false}),/pass_verdict_required/);assert.throws(()=>recordPass(db,'active',null),/pass_verdict_required/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pass_events').get().n,0);assert.equal(db.prepare('SELECT status FROM submissions WHERE id=?').get('active').status,'processing');
  }finally{db.close();}
});
