/** D1/R2でルームと受付順を保持するWorkers API。写真は判定後に削除する。 */
import QRCode from 'qrcode';
import { generateChallenge,judgePhoto } from './cloud-ai';
import {recordPass} from './pass-events';
import {createReferenceTools} from './reference-agent.mjs';
import { MAX_PLAYERS, PASS_POINTS, TOTAL_ROUNDS } from './game-contract';
import { gameProjection } from './game-state';
export type GameEnv = {DB:D1Database;BUCKET:R2Bucket;OPENAI_API_KEY?:string;AI_REFERENCE_PHOTOS?:string};
let expiryAt=0;
let runningPump:Promise<void>|undefined;
const snapshotCache=new Map<string,{until:number,revision:number,rows:any[]}>();
const ACTIVE_WINDOW_MS=30000;
const PRESENCE_WRITE_INTERVAL_MS=10000;
const pending="('uploading','queued','processing')";
/** JSONはキャッシュせず、他サイトからの操作を制限する。 */
function json(value:any,status=200,headers:Record<string,string>={}){return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});}
/** Content-Lengthのないアップロードも1.1MBで打ち切り、メモリを保護する。 */
async function boundedForm(req:Request){
  const reader=req.body?.getReader();if(!reader)throw Error('missing_body');
  let size=0;const chunks:Uint8Array[]=[];
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>1100000){await reader.cancel();throw Error('body_too_large');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return new Request(req.url,{method:'POST',headers:{'content-type':req.headers.get('content-type')||''},body:bytes}).formData();
}
/** ランダムなトークンはホスト用のみハッシュで保存する。 */
async function hash(value:string|ArrayBuffer){const b=typeof value==='string'?new TextEncoder().encode(value):value;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');}
/** D1の配列結果を取得する。 */
async function all(db:D1Database,sql:string,...args:any[]){return (await db.prepare(sql).bind(...args).all<any>()).results;}
/** 現在のルーム限定で最新ラウンドを取得する。 */
async function current(db:D1Database,id:string){return db.prepare('SELECT * FROM rounds WHERE roomId=? ORDER BY number DESC LIMIT 1').bind(id).first<any>();}
/** HttpOnlyの部屋別ホストCookieを検証する。 */
async function hostOf(req:Request,room:any){const name=`host_${room.id}=`;const token=(req.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name))?.slice(name.length);return !!token&&await hash(token)===room.hostHash;}
/** 期限切れラウンドと中断した判定を回復する。 */
async function expire(env:GameEnv){const now=Date.now();if(now<expiryAt)return;expiryAt=now+1000;const changes=await env.DB.batch([
  env.DB.prepare("UPDATE rounds SET status='closed' WHERE status='active' AND endsAt<=?").bind(now),
  env.DB.prepare("UPDATE rooms SET generationLease=0,preparedMode=NULL,preparationError=? WHERE generationLease>0 AND generationLease<? AND preparedChallenge IS NULL").bind('準備処理が中断しました。ホストがもう一度準備してください。',now),
  env.DB.prepare(`UPDATE submissions SET status='error',hash=NULL,leaseUntil=0,verdict=? WHERE (status='processing' AND leaseUntil<=?) OR (status IN ('uploading','queued') AND receivedAt<?)`).bind(JSON.stringify({reason:'判定処理が中断しました。再投稿してください。'}),now,now-120000),
]);
  if(changes.some(result=>result.meta.changes>0))snapshotCache.clear();
  const stale=await all(env.DB,"SELECT id,objectKey FROM submissions WHERE status IN ('accepted','rejected','error') AND objectKey!='' LIMIT 20");
  await Promise.all(stale.map(async sub=>{try{await env.BUCKET.delete(sub.objectKey);await env.DB.prepare("UPDATE submissions SET objectKey='' WHERE id=?").bind(sub.id).run();}catch{ /* 次の同期で削除を再試行する。 */ }}));
}
/** room外の参加者情報や回答を含めずにスナップショットを作る。 */
async function snapshot(req:Request,env:GameEnv,room:any,player:any){
  const cached=snapshotCache.get(room.id);
  let out=cached&&cached.until>Date.now()&&cached.revision===room.revision?cached.rows:undefined;
  if(!out){out=await env.DB.batch([
    env.DB.prepare('SELECT id,name,joinedAt,lastSeenAt FROM players WHERE roomId=? ORDER BY joinedAt,id').bind(room.id),
    env.DB.prepare('SELECT * FROM rounds WHERE roomId=? ORDER BY number').bind(room.id),
    env.DB.prepare('SELECT s.seq,s.id,s.playerId,s.roundId,s.receivedAt,s.status,s.verdict,e.id AS passEventId FROM submissions s LEFT JOIN pass_events e ON e.submissionId=s.id WHERE s.roomId=? ORDER BY s.receivedAt,s.seq').bind(room.id),
    env.DB.prepare('SELECT * FROM pass_events WHERE roomId=? ORDER BY id DESC LIMIT 40').bind(room.id),
    env.DB.prepare('SELECT * FROM rooms WHERE id=?').bind(room.id),
  ]);snapshotCache.set(room.id,{until:Date.now()+500,revision:out[4].results[0]?.revision,rows:out});if(snapshotCache.size>1000)snapshotCache.delete(snapshotCache.keys().next().value!);}
  room=out[4].results[0]||room;
  const presence=out[0].results as any[],players=presence.map(({lastSeenAt,...publicPlayer})=>publicPlayer),rounds=out[1].results as any[],subs=out[2].results as any[],round=rounds.at(-1),currentSubs=subs.filter(s=>s.roundId===round?.id);
  const now=Date.now(),progress=gameProjection(players,rounds,subs,now),ranks=progress.ranks;
  const events=(out[3].results as any[]).slice().reverse().map(e=>{
    const own=subs.find(s=>s.id===e.submissionId),ordered=subs.filter(s=>s.roundId===e.roundId&&s.status==='accepted');
    const ahead=subs.filter(s=>s.roundId===e.roundId&&['queued','processing','uploading','retrying','pending'].includes(s.status)&&own&&(s.receivedAt<own.receivedAt||s.receivedAt===own.receivedAt&&s.seq<own.seq)).length;
    return {id:e.id,type:'pass',playerId:e.playerId,name:players.find(p=>p.id===e.playerId)?.name,roundId:e.roundId,submissionId:e.submissionId,createdAt:e.createdAt,rank:ordered.findIndex(s=>s.id===e.submissionId)+1,provisional:ahead>0,pendingAhead:ahead};
  });
  const origin=new URL(req.url).origin;
  return {
    room:{id:room.id,name:room.name,autoStart:room.autoStart!==0}, game:progress.game, stages:progress.stages,
    isHost:await hostOf(req,room),mode:room.mode,aiAvailable:!!env.OPENAI_API_KEY,
    publicUrl:origin,joinUrl:`${origin}/rooms/${room.id}/join`,serverTime:now,
    revision:room.revision??0,live:{pollIntervalMs:2000,activeWindowMs:ACTIVE_WINDOW_MS,updatedAt:room.updatedAt||room.createdAt},
    generating:room.generationLease>now,
    preparing:room.generationLease>now&&room.preparedMode===room.mode&&!room.preparedChallenge,
    prepared:!!(room.preparedChallenge&&room.preparedMode===room.mode&&now-room.preparedAt<300000),
    preparationError:room.preparationError||null,
    preparationStage:room.generationLease>now?(room.mode==='ai'&&env.AI_REFERENCE_PHOTOS==='true'?'searching':'generating'):null,
    lobby:{autoStart:room.autoStart!==0,deadline:room.lobbyDeadline??null,startedAt:room.lobbyStartedAt||round?.startedAt||null,status:room.lobbyStartedAt||round?'started':room.preparationError?'error':room.generationLease>now?'preparing':players.length?'waiting':'empty'},
    players,ranks,events,eventCursor:events.at(-1)?.id||0,
    round:round?{id:round.id,number:round.number,mode:round.mode,status:round.status==='active'&&round.endsAt<=now?'closed':round.status,challenge:publicChallenge(JSON.parse(round.challenge),room.id,round.id),startedAt:round.startedAt,endsAt:round.endsAt}:null,
    stats:{players:players.length,activePlayers:presence.filter(p=>p.lastSeenAt>now-ACTIVE_WINDOW_MS).length,answered:new Set(currentSubs.map(s=>s.playerId)).size,accepted:new Set(currentSubs.filter(s=>progress.awardedIds.has(s.id)).map(s=>s.playerId)).size,pending:currentSubs.filter(s=>['uploading','queued','processing'].includes(s.status)).length,queued:currentSubs.filter(s=>s.status==='queued').length,processing:currentSubs.filter(s=>s.status==='processing').length},
    finishers:currentSubs.filter(s=>progress.awardedIds.has(s.id)).map((s,i)=>({rank:i+1,playerId:s.playerId,submissionId:s.id,name:players.find(p=>p.id===s.playerId)?.name,elapsedMs:s.receivedAt-round.startedAt})),
    mine:player?subs.filter(s=>s.playerId===player.id).map(s=>({...s,status:s.status==='uploading'?'queued':s.status,awardedPoints:progress.awardedIds.has(s.id)?PASS_POINTS:0,verdict:s.verdict?JSON.parse(s.verdict):null})):[],
    sync:'polling',queue:{maxConcurrency:8,maxRoomPending:100,maxGlobalPending:200},
  };
}
/** 実際のroom限定参加情報・回答率・正解率・履歴を生成に渡す。 */
async function generationContext(env:GameEnv,roomId:string){
  const players=await all(env.DB,'SELECT name,profile FROM players WHERE roomId=? ORDER BY joinedAt,id',roomId),rounds=await all(env.DB,'SELECT * FROM rounds WHERE roomId=? ORDER BY number',roomId),last=rounds.at(-1);
  const subs=last?await all(env.DB,'SELECT playerId,status FROM submissions WHERE roomId=? AND roundId=?',roomId,last.id):[];
  const answered=new Set(subs.map(s=>s.playerId)).size,correct=new Set(subs.filter(s=>s.status==='accepted').map(s=>s.playerId)).size;
  return {participantCount:players.length,waitingCount:players.length-answered,participants:players.map(p=>({name:p.name,selfReportedInfo:p.profile})),responseRate:players.length?answered/players.length:0,correctRate:answered?correct/answered:0,history:rounds.map(r=>JSON.parse(r.challenge)),roundCount:rounds.length};
}
/** Store a single, bounded reference asset before making the prepared task usable. */
async function persistChallenge(env:GameEnv,roomId:string,value:any){
  const {referenceAsset,...challenge}=value;
  if(referenceAsset){
    const bytes=referenceAsset.bytes as Uint8Array;
    if(!bytes?.byteLength||bytes.byteLength>1048576||!['image/jpeg','image/png','image/webp'].includes(referenceAsset.mime))throw Error('invalid_reference_asset');
    const storageKey=`references/${roomId}/${crypto.randomUUID()}`;
    const sha=await hash(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer);
    if(challenge.reference?.sha256!==sha)throw Error('reference_hash_mismatch');
    await env.BUCKET.put(storageKey,bytes,{httpMetadata:{contentType:referenceAsset.mime}});
    challenge.reference={...challenge.reference,storageKey};
  }
  if(challenge.provider==='Agents API'&&!challenge.reference?.storageKey)throw Error('reference_missing');
  return challenge;
}
/** Prepared bytes and tool traces are never disclosed by public snapshots. */
function publicChallenge(challenge:any,roomId:string,roundId:string){
  const {referenceAsset,referenceTrace,hint,...out}=challenge;
  if(out.reference){const {storageKey,sha256,canonicalHash,canonicalHashes,...reference}=out.reference;out.reference={...reference,url:`/api/rooms/${roomId}/reference/${roundId}`};}
  return out;
}
const referenceCache=new Map<string,{bytes:Uint8Array,mime:string,dataUrl:string}>();
const referenceLoads=new Map<string,Promise<{bytes:Uint8Array,mime:string,dataUrl:string}>>();
/** Coalesce reference reads for simultaneous participants and judgments in one isolate. */
async function readReference(env:GameEnv,roomId:string,reference:any){
  const key=reference?.storageKey;if(typeof key!=='string'||!key.startsWith(`references/${roomId}/`))throw Error('reference_missing');
  if(referenceCache.has(key))return referenceCache.get(key)!;
  if(!referenceLoads.has(key))referenceLoads.set(key,(async()=>{
    const object=await env.BUCKET.get(key);if(!object||object.size>1048576)throw Error('reference_missing');
    const bytes=new Uint8Array(await object.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
    const value={bytes,mime:reference.mime,dataUrl:`data:${reference.mime};base64,${btoa(binary)}`};
    referenceCache.set(key,value);if(referenceCache.size>8)referenceCache.delete(referenceCache.keys().next().value!);return value;
  })().finally(()=>referenceLoads.delete(key)));
  return referenceLoads.get(key)!;
}
/** A first-round preparation freezes its real input once, preventing join-triggered generation loops. */
async function beginPreparation(env:GameEnv,roomId:string,ctx:ExecutionContext,retry=false){
  const now=Date.now(),room=await env.DB.prepare('SELECT * FROM rooms WHERE id=?').bind(roomId).first<any>();
  if(!room)return false;
  if(room.generationLease>now)return false;
  const round=await current(env.DB,roomId);
  if(round&&round.number>=TOTAL_ROUNDS)return false;
  if(round?.status==='active'||await env.DB.prepare(`SELECT id FROM submissions WHERE roomId=? AND status IN ${pending} LIMIT 1`).bind(roomId).first())return false;
  const context=await generationContext(env,roomId);if(!context.participantCount)return false;
  const frozen=!round&&room.lobbyDeadline!==null;
  const serialized=JSON.stringify(context);
  if(room.preparedChallenge&&room.preparedMode===room.mode&&now-room.preparedAt<300000&&(frozen||room.preparedContext===serialized))return true;
  if(room.preparationError&&!retry)return false;
  const lease=now+45000;
  const claimed=await env.DB.prepare("UPDATE rooms SET generationLease=?,preparedChallenge=NULL,preparedContext=NULL,preparedMode=mode,preparedAt=NULL,preparationError=NULL WHERE id=? AND generationLease<=? AND NOT EXISTS(SELECT 1 FROM rounds WHERE roomId=? AND status='active') RETURNING mode")
    .bind(lease,roomId,now,roomId).first<any>();
  if(!claimed)return false;
  snapshotCache.delete(roomId);
  ctx.waitUntil((async()=>{
    let preparedReferenceKey:string|undefined;
    try{
      const generated=await generateChallenge(env.OPENAI_API_KEY,claimed.mode,context,env.AI_REFERENCE_PHOTOS);
      if(!frozen&&JSON.stringify(await generationContext(env,roomId))!==serialized)throw Error('context_changed');
      const challenge=await persistChallenge(env,roomId,generated);
      preparedReferenceKey=challenge.reference?.storageKey;
      const saved=await env.DB.prepare('UPDATE rooms SET preparedChallenge=?,preparedContext=?,preparedMode=?,preparedAt=?,preparationError=NULL WHERE id=? AND generationLease=? AND mode=? AND (?=1 OR (SELECT COUNT(*) FROM players WHERE roomId=?)=?) RETURNING id')
        .bind(JSON.stringify(challenge),serialized,claimed.mode,Date.now(),roomId,lease,claimed.mode,frozen?1:0,roomId,context.participantCount).first();
      if(!saved)throw Error('context_changed');
      preparedReferenceKey=undefined;
    }catch(error:any){
      const diagnostic={code:/^reference_[a-z0-9_]+$/.test(error?.message)?error.message:'reference_preparation_failed',stage:error?.referenceStage,elapsedMs:error?.referenceElapsedMs,trace:error?.referenceTrace};
      console.error('reference_preparation_failed',JSON.stringify(diagnostic));
      if(preparedReferenceKey)try{await env.BUCKET.delete(preparedReferenceKey);}catch{ /* Retryable storage cleanup does not publish an incomplete task. */ }
      await env.DB.prepare('UPDATE rooms SET preparedChallenge=NULL,preparedContext=?,preparedMode=NULL,preparedAt=NULL,preparationError=? WHERE id=? AND generationLease=?')
        .bind(JSON.stringify(diagnostic),'お題・参考写真を準備できませんでした。ホストが「もう一度準備」で再試行してください。',roomId,lease).run();
    }finally{
      await env.DB.prepare('UPDATE rooms SET generationLease=0 WHERE id=? AND generationLease=?').bind(roomId,lease).run();snapshotCache.delete(roomId);
      await startInitialIfReady(env,roomId);
    }
  })());return false;
}
/** Atomically claim the persisted deadline and publish exactly one initial round. */
async function startInitialIfReady(env:GameEnv,roomId:string){
  const now=Date.now(),lease=now+10000;
  const room=await env.DB.prepare("UPDATE rooms SET generationLease=? WHERE id=? AND lobbyDeadline IS NOT NULL AND lobbyDeadline<=? AND lobbyStartedAt IS NULL AND generationLease<=? AND preparedChallenge IS NOT NULL AND preparedMode=mode AND preparedAt>? AND NOT EXISTS(SELECT 1 FROM rounds WHERE roomId=?) RETURNING *")
    .bind(lease,roomId,now,now,now-300000,roomId).first<any>();
  if(!room)return false;
  const challenge=JSON.parse(room.preparedChallenge);
  try{
    const result=await env.DB.batch([
      env.DB.prepare("INSERT INTO rounds(id,number,mode,status,challenge,context,startedAt,endsAt,roomId,hint) SELECT ?,1,?,'active',?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM rounds WHERE roomId=?) AND EXISTS(SELECT 1 FROM rooms WHERE id=? AND generationLease=?)")
        .bind(crypto.randomUUID(),room.mode,room.preparedChallenge,room.preparedContext,now,now+challenge.durationSeconds*1000,roomId,typeof challenge.hint==='string'?challenge.hint.slice(0,500):null,roomId,roomId,lease),
      env.DB.prepare('UPDATE rooms SET lobbyStartedAt=(SELECT MIN(startedAt) FROM rounds WHERE roomId=?),preparedChallenge=NULL,preparedContext=NULL,preparedMode=NULL,preparedAt=NULL,preparationError=NULL,generationLease=0 WHERE id=? AND generationLease=?').bind(roomId,roomId,lease),
    ]);snapshotCache.delete(roomId);return result[0].meta.changes>0;
  }finally{await env.DB.prepare('UPDATE rooms SET generationLease=0 WHERE id=? AND generationLease=?').bind(roomId,lease).run();}
}
/** Request-driven durable scheduling works while any participant is polling, regardless of the host tab. */
async function driveLobby(env:GameEnv,roomId:string,ctx:ExecutionContext){
  const room=await env.DB.prepare('SELECT * FROM rooms WHERE id=?').bind(roomId).first<any>();
  if(!room||room.lobbyDeadline===null||room.lobbyStartedAt||await current(env.DB,roomId))return;
  if(await startInitialIfReady(env,roomId))return;
  if(room.generationLease<=Date.now()&&!room.preparationError)await beginPreparation(env,roomId,ctx);
}
/** Later rounds remain an explicit host action, sharing the same generation CAS guard. */
async function manualStart(env:GameEnv,roomId:string){
  const now=Date.now(),lease=now+45000;
  const claimed=await env.DB.prepare("UPDATE rooms SET generationLease=? WHERE id=? AND generationLease<=? AND COALESCE((SELECT MAX(number) FROM rounds WHERE roomId=?),0)<? AND NOT EXISTS(SELECT 1 FROM rounds WHERE roomId=? AND status='active') AND NOT EXISTS(SELECT 1 FROM submissions WHERE roomId=? AND status IN ('uploading','queued','processing')) RETURNING *").bind(lease,roomId,now,roomId,TOTAL_ROUNDS,roomId,roomId).first<any>();
  if(!claimed)return {error:'全競技が終了したか、ラウンド・準備・判定の終了待ちです。',status:409};
  try{
    const context=await generationContext(env,roomId),serialized=JSON.stringify(context);
    const valid=claimed.preparedChallenge&&claimed.preparedMode===claimed.mode&&now-claimed.preparedAt<300000&&claimed.preparedContext===serialized;
    const challenge=valid?JSON.parse(claimed.preparedChallenge):await persistChallenge(env,roomId,await generateChallenge(env.OPENAI_API_KEY,claimed.mode,context,env.AI_REFERENCE_PHOTOS));
    const startedAt=Date.now();
    const result=await env.DB.batch([
      env.DB.prepare("INSERT INTO rounds(id,number,mode,status,challenge,context,startedAt,endsAt,roomId,hint) SELECT ?,COALESCE((SELECT MAX(number) FROM rounds WHERE roomId=?),0)+1,?,'active',?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM rooms WHERE id=? AND generationLease=? AND generationLease>?) AND COALESCE((SELECT MAX(number) FROM rounds WHERE roomId=?),0)<?")
        .bind(crypto.randomUUID(),roomId,claimed.mode,JSON.stringify(challenge),serialized,startedAt,startedAt+challenge.durationSeconds*1000,roomId,typeof challenge.hint==='string'?challenge.hint.slice(0,500):null,roomId,lease,startedAt,roomId,TOTAL_ROUNDS),
      env.DB.prepare('UPDATE rooms SET preparedChallenge=NULL,preparedContext=NULL,preparedMode=NULL,preparedAt=NULL,preparationError=NULL WHERE id=? AND generationLease=?').bind(roomId,lease),
    ]);return result[0].meta.changes>0?{ok:true,usedPrepared:!!valid,status:200}:{error:'開始処理が失効しました。状態を再取得してください。',status:409};
  }catch{return {error:'お題と参考写真の準備に失敗しました。もう一度準備してください。',status:502};}
  finally{await env.DB.prepare('UPDATE rooms SET generationLease=0 WHERE id=? AND generationLease=?').bind(roomId,lease).run();snapshotCache.delete(roomId);}
}

/** D1の条件付きUPDATEで全Worker合計8件までのAIリースを取得する。 */
async function claim(env:GameEnv){const now=Date.now();return env.DB.prepare(`UPDATE submissions SET status='processing',leaseUntil=? WHERE seq=(SELECT seq FROM submissions WHERE status='queued' ORDER BY receivedAt,seq LIMIT 1) AND status='queued' AND (SELECT COUNT(*) FROM submissions WHERE status='processing' AND leaseUntil>?)<8 RETURNING *`).bind(now+65000,now).first<any>();}
/** 8件ずつbackgroundで処理する。読み込みや受付が残りのキューを継続して駆動する。 */
async function runPump(env:GameEnv){
  const started=Date.now();
  if(!await env.DB.prepare("SELECT seq FROM submissions WHERE status='queued' LIMIT 1").first())return;
  await Promise.all(Array.from({length:8},async()=>{
    do{
      const sub=await claim(env);if(!sub)return;
      try{
        const object=await env.BUCKET.get(sub.objectKey);if(!object)throw Error('photo_missing');
        const bytes=new Uint8Array(await object.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
        const round=await env.DB.prepare('SELECT * FROM rounds WHERE id=? AND roomId=?').bind(sub.roundId,sub.roomId).first<any>();if(!round)throw Error('round_missing');
        const challenge=JSON.parse(round.challenge);const referenceDataUrl=challenge.reference?(await readReference(env,sub.roomId,challenge.reference)).dataUrl:undefined;
        let verdict;const judgingStarted=Date.now();
        try{verdict=await judgePhoto(env.OPENAI_API_KEY,round.mode,challenge,`data:${sub.mime};base64,${btoa(binary)}`,sub.demoResult,referenceDataUrl);}catch(error:any){
          if(![429,503].includes(Number(error?.status))||Date.now()-judgingStarted>1500)throw error;
          await new Promise(resolve=>setTimeout(resolve,400));
          verdict=await judgePhoto(env.OPENAI_API_KEY,round.mode,challenge,`data:${sub.mime};base64,${btoa(binary)}`,sub.demoResult,referenceDataUrl);
        }
        if(verdict.pass){if(!await recordPass(env.DB,sub.id,verdict))throw Error('pass_commit_failed');}
        else await env.DB.prepare("UPDATE submissions SET status='rejected',verdict=?,leaseUntil=0 WHERE id=? AND status='processing'").bind(JSON.stringify(verdict),sub.id).run();snapshotCache.delete(sub.roomId);
      }catch{
        await env.DB.prepare("UPDATE submissions SET status='error',hash=NULL,verdict=?,leaseUntil=0 WHERE id=? AND status='processing'").bind(JSON.stringify({reason:'実AI判定に接続できませんでした。合格としては扱いません。再投稿してください。'}),sub.id).run();snapshotCache.delete(sub.roomId);
      }finally{try{await env.BUCKET.delete(sub.objectKey);await env.DB.prepare("UPDATE submissions SET objectKey='' WHERE id=?").bind(sub.id).run();}catch{ /* transient R2 cleanup can be retried by admin */ }}
    }while(Date.now()-started<5000);
  }));
}
/** 本番はポーリングで共有状態と判定キューを同期する。 */
/** 同一isolateでポンプをまとめ、複数isolate間の上限はD1リースで保つ。 */
export function pump(env:GameEnv){if(!runningPump)runningPump=runPump(env).finally(()=>{runningPump=undefined;});return runningPump;}
export async function handleApi(req:Request,env:GameEnv,ctx:ExecutionContext):Promise<Response>{
  let receivedAt=Date.now();const url=new URL(req.url),p=url.pathname;
  if(req.method!=='GET'&&req.headers.get('origin')&&req.headers.get('origin')!==url.origin)return json({error:'別サイトからの操作はできません。'},403);
  try{
    if(p==='/api/rooms'&&req.method==='POST'){
      const {name,autoStart=true}=await req.json() as any;if(typeof name!=='string'||!name.trim()||name.length>48)return json({error:'部屋の名前を1〜48文字で入力してください。'},400);
      if(typeof autoStart!=='boolean')return json({error:'自動開始の設定を確認してください。'},400);
      const id=crypto.randomUUID().replaceAll('-',''),token=crypto.randomUUID()+crypto.randomUUID();
      const mode=env.OPENAI_API_KEY?'ai':'demo';
      const inserted=await env.DB.prepare("INSERT INTO rooms(id,name,hostHash,mode,createdAt,autoStart,updatedAt,generationLease) SELECT ?,?,?,?,?,?,?,0 WHERE (SELECT COUNT(*) FROM rooms)<1000 RETURNING id").bind(id,name.trim(),await hash(token),mode,receivedAt,autoStart?1:0,receivedAt).first();
      if(!inserted)return json({error:'部屋の作成上限に達しました。'},409);
      return json({id,autoStart,hostUrl:`/rooms/${id}/host`,joinUrl:`${url.origin}/rooms/${id}/join`},201,{'Set-Cookie':`host_${id}=${token}; Path=/api/rooms/${id}; HttpOnly; SameSite=Strict; Secure; Max-Age=2592000`});
    }
    const match=p.match(/^\/api\/rooms\/([a-zA-Z0-9-]+)\/(.+)$/);if(!match)return json({error:'APIが見つかりません。'},404);
    const [,roomId,action]=match;
    let room=await env.DB.prepare('SELECT * FROM rooms WHERE id=?').bind(roomId).first<any>();if(!room)return json({error:'この部屋は見つかりません。共有リンクを確認してください。'},404);
    const token=req.headers.get('authorization')?.replace(/^Bearer /,'');let player:any;
    if(token){
      player=await env.DB.prepare('SELECT * FROM players WHERE roomId=? AND token=?').bind(roomId,token).first();if(!player)return json({error:'この部屋の参加登録が見つかりません。'},401);
      if(player.lastSeenAt<receivedAt-PRESENCE_WRITE_INTERVAL_MS){await env.DB.prepare('UPDATE players SET lastSeenAt=? WHERE id=? AND roomId=? AND lastSeenAt<?').bind(receivedAt,player.id,roomId,receivedAt-PRESENCE_WRITE_INTERVAL_MS).run();snapshotCache.delete(roomId);}
    }
    if(action==='state'&&req.method==='GET'){await expire(env);if(!room.lobbyStartedAt){await driveLobby(env,roomId,ctx);room=await env.DB.prepare('SELECT * FROM rooms WHERE id=?').bind(roomId).first<any>();}const state=await snapshot(req,env,room,player);if(state.stats.pending>0)ctx.waitUntil(pump(env));return json(state);}
    if(action==='hint'&&req.method==='GET'){
      if(!player)return json({error:'この部屋に参加登録してください。'},401);
      const roundId=url.searchParams.get('roundId');
      const round=await current(env.DB,roomId);
      if(!round||round.id!==roundId||round.status!=='active'||round.endsAt<=Date.now()||player.joinedAt>round.startedAt)return json({error:'現在参加できる競技のヒントだけ取得できます。'},409);
      return json({roundId:round.id,text:round.hint||null,available:!!round.hint});
    }
    if(action.startsWith('reference/')&&req.method==='GET'){
      const roundId=action.slice('reference/'.length);const r=await env.DB.prepare('SELECT challenge FROM rounds WHERE id=? AND roomId=?').bind(roundId,roomId).first<any>();
      if(!r)return json({error:'参考写真はゲーム開始後に表示されます。'},404);
      const reference=JSON.parse(r.challenge).reference;if(!reference)return json({error:'参考写真がありません。'},404);
      const etag='"'+reference.sha256+'"';if(req.headers.get('if-none-match')===etag)return new Response(null,{status:304,headers:{ETag:etag,'Cache-Control':'public,max-age=86400,immutable'}});
      const asset=await readReference(env,roomId,reference);return new Response(asset.bytes.slice().buffer as ArrayBuffer,{headers:{'Content-Type':asset.mime,'Cache-Control':'public,max-age=86400,immutable',ETag:etag,'X-Content-Type-Options':'nosniff'}});
    }
    if(action==='events'&&req.method==='GET')return json({error:'公開版は定期同期を使用します。'},404);
    if((action==='qr.svg'||action==='qr.png')&&req.method==='GET'){
      const target=`${url.origin}/rooms/${roomId}/join`,options={margin:2,width:480,color:{dark:'#182017',light:'#ffffff'}};
      if(action==='qr.svg')return new Response(await QRCode.toString(target,{...options,type:'svg'}),{headers:{'Content-Type':'image/svg+xml','Cache-Control':'private,max-age=300'}});
      return new Response(new Uint8Array(await QRCode.toBuffer(target,options)).buffer,{headers:{'Content-Type':'image/png',...(url.searchParams.get('download')==='1'?{'Content-Disposition':`attachment; filename="ai-karimono-${roomId}.png"`}:{})}});
    }
    if(action==='join'&&req.method==='POST'){
      const {name,profile=''}=await req.json() as any;if(typeof name!=='string'||!name.trim()||name.length>24||typeof profile!=='string'||profile.length>240)return json({error:'名前は1〜24文字、自己紹介は240文字以内です。'},400);
      const id=crypto.randomUUID(),token=crypto.randomUUID()+crypto.randomUUID();
      const inserted=await env.DB.prepare('INSERT INTO players(id,token,name,profile,joinedAt,lastSeenAt,roomId) SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM players WHERE roomId=?)<? AND NOT EXISTS(SELECT 1 FROM rounds WHERE roomId=? AND number>=? AND (status=\'closed\' OR endsAt<=?)) RETURNING id').bind(id,token,name.trim(),profile,receivedAt,receivedAt,roomId,roomId,MAX_PLAYERS,roomId,TOTAL_ROUNDS,receivedAt).first();
      if(inserted){
        await env.DB.prepare('UPDATE rooms SET lobbyDeadline=COALESCE(lobbyDeadline,(SELECT MIN(joinedAt)+30000 FROM players WHERE roomId=?)) WHERE id=? AND autoStart=1 AND NOT EXISTS(SELECT 1 FROM rounds WHERE roomId=?)').bind(roomId,roomId,roomId).run();
        await env.DB.prepare('UPDATE rooms SET preparedChallenge=NULL,preparedContext=NULL,preparedMode=CASE WHEN generationLease>? THEN preparedMode ELSE NULL END,preparedAt=NULL,preparationError=NULL WHERE id=? AND ((autoStart=0 AND lobbyDeadline IS NULL) OR EXISTS(SELECT 1 FROM rounds WHERE roomId=?))').bind(Date.now(),roomId,roomId).run();
        ctx.waitUntil(driveLobby(env,roomId,ctx));
      }
      return inserted?json({id,token},201):json({error:'この部屋は満員、または全競技が終了しています。'},409);
    }
    if(action.startsWith('host/')){
      if(!await hostOf(req,room))return json({error:'この部屋を作成したブラウザーで操作してください。'},403);
      if(action==='host/preparation-diagnostics'&&req.method==='GET')return json({diagnostic:room.preparationError&&room.preparedContext?JSON.parse(room.preparedContext):null});
      if(action==='host/reference-network-probe'&&req.method==='POST'){
        const probe=createReferenceTools();try{const found=JSON.parse(await probe.execute('search_reference_photos',{queryEnglish:'banana fruit'}) as string);if(found.candidates[0])await probe.execute('get_reference_photo',{candidateId:found.candidates[0].candidateId});return json({ok:probe.assets.size>0,trace:probe.trace});}catch(error:any){return json({ok:false,code:/^reference_[a-z0-9_]+$/.test(error?.message)?error.message:'reference_probe_failed',trace:probe.trace});}
      }
      if(action==='host/reference-trace'&&req.method==='GET'){const r=await current(env.DB,roomId);return r?json({referenceTrace:JSON.parse(r.challenge).referenceTrace||null}):json({error:'開始後に確認できます。'},404);}
      await expire(env);const round=await current(env.DB,roomId);
      if(action==='host/hint'&&req.method==='POST'){
        const {roundId,text}=await req.json() as any;
        if(typeof roundId!=='string'||(text!==null&&(typeof text!=='string'||!text.trim()||text.length>500)))return json({error:'ヒントは1〜500文字、削除時はnullを指定してください。'},400);
        const saved=await env.DB.prepare("UPDATE rounds SET hint=? WHERE id=? AND roomId=? AND status='active' AND endsAt>? AND number=(SELECT MAX(number) FROM rounds WHERE roomId=?) RETURNING id").bind(text===null?null:text.trim(),roundId,roomId,Date.now(),roomId).first();
        return saved?json({roundId,text:text===null?null:text.trim(),available:text!==null}):json({error:'現在の競技だけヒントを設定できます。'},409);
      }
      if(action==='host/end'&&req.method==='POST'){if(round)await env.DB.prepare("UPDATE rounds SET status='closed' WHERE id=? AND roomId=?").bind(round.id,roomId).run();return json({ok:true});}
      if(action==='host/extend-lobby'&&req.method==='POST'){
        const changed=await env.DB.prepare('UPDATE rooms SET lobbyDeadline=lobbyDeadline+10000 WHERE id=? AND lobbyDeadline IS NOT NULL AND lobbyStartedAt IS NULL AND (generationLease<=? OR preparedChallenge IS NULL) AND NOT EXISTS(SELECT 1 FROM rounds WHERE roomId=?) RETURNING lobbyDeadline').bind(roomId,Date.now(),roomId).first<any>();
        return changed?json({ok:true,deadline:changed.lobbyDeadline}):json({error:'初回の開始待ちの間だけ延長できます。'},409);
      }
      if((action==='host/start-now'||action==='host/start')&&req.method==='POST'&&!round){
        if(!await env.DB.prepare('SELECT id FROM players WHERE roomId=? LIMIT 1').bind(roomId).first())return json({error:'最初の参加者を待ってください。'},400);
        await env.DB.prepare('UPDATE rooms SET lobbyDeadline=? WHERE id=? AND lobbyStartedAt IS NULL').bind(Date.now(),roomId).run();
        const started=await startInitialIfReady(env,roomId);
        if(!started)await beginPreparation(env,roomId,ctx,true);
        return json({ok:true,usedPrepared:started,preparing:!started},started?200:202);
      }
      if(action==='host/start-now'&&req.method==='POST')return json({error:'初回のゲームは開始済みです。'},409);
      if(round&&round.number>=TOTAL_ROUNDS&&['host/start','host/prepare','host/mode'].includes(action))return json({error:'最終競技です。次の競技は作成できません。'},409);
      const waiting=await env.DB.prepare(`SELECT id FROM submissions WHERE roomId=? AND status IN ${pending} LIMIT 1`).bind(roomId).first();
      if(round?.status==='active'||waiting)return json({error:'ラウンドと判定の終了を待ってください。'},409);
      if(action==='host/mode'&&req.method==='POST'){
        const {mode}=await req.json() as any;if(!['demo','ai'].includes(mode))return json({error:'モードを確認してください。'},400);if(mode==='ai'&&!env.OPENAI_API_KEY)return json({error:'実AI接続シークレットが未設定です。'},400);
        const changed=await env.DB.prepare('UPDATE rooms SET mode=?,preparedChallenge=NULL,preparedContext=NULL,preparedMode=NULL,preparedAt=NULL,preparationError=NULL WHERE id=? AND generationLease<=? RETURNING id').bind(mode,roomId,Date.now()).first();
        if(changed)await driveLobby(env,roomId,ctx);
        return changed?json({ok:true}):json({error:'お題の準備中です。'},409);
      }
      if(action==='host/prepare'&&req.method==='POST'){
        if(!await env.DB.prepare('SELECT id FROM players WHERE roomId=? LIMIT 1').bind(roomId).first())return json({error:'参加者を1人以上登録してください。'},400);
        const prepared=await beginPreparation(env,roomId,ctx,true);return json({prepared,preparing:!prepared},202);
      }
      if(action==='host/start'&&req.method==='POST'){const result=await manualStart(env,roomId);return json(result,result.status);}
    }
    if(action==='submit'&&req.method==='POST'){
      if(!player)return json({error:'この部屋に参加登録してください。'},401);
      if(Number(req.headers.get('content-length')||0)>1100000)return json({error:'写真を1MB以内に圧縮してください。'},413);
      let form:FormData;try{form=await boundedForm(req);}catch{return json({error:'写真を1MB以内に圧縮して送信してください。'},413);}receivedAt=Date.now();const photo=form.get('photo'),requestId=form.get('requestId'),roundId=form.get('roundId');
      if(typeof requestId!=='string'||!requestId||requestId.length>80||typeof roundId!=='string')return json({error:'投稿情報を確認してください。'},400);
      const prior=await env.DB.prepare('SELECT id,status,receivedAt FROM submissions WHERE roomId=? AND playerId=? AND roundId=? AND requestId=?').bind(roomId,player.id,roundId,requestId).first<any>();if(prior)return json({...prior,status:prior.status==='uploading'?'queued':prior.status,duplicate:true},['uploading','queued','processing'].includes(prior.status)?202:200);
      const round=await current(env.DB,roomId);if(!round||round.id!==roundId)return json({error:'お題が切り替わりました。'},409);if(round.status!=='active'||receivedAt>=round.endsAt)return json({error:'受付時間が終了しました。'},409);if(player.joinedAt>round.startedAt)return json({error:'次のお題から挑戦できます。'},409);
      if(!(photo instanceof File)||photo.size===0||photo.size>1048576)return json({error:'写真は1MB以内にしてください。'},413);
      const bytes=await photo.arrayBuffer(),b=new Uint8Array(bytes);let mime:string;
      if(b[0]===255&&b[1]===216&&b[2]===255)mime='image/jpeg';else if(b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71)mime='image/png';else if(new TextDecoder().decode(b.subarray(0,4))==='RIFF'&&new TextDecoder().decode(b.subarray(8,12))==='WEBP')mime='image/webp';else return json({error:'JPEG・PNG・WebPの写真を使ってください。'},400);
      const submittedHash=await hash(bytes);receivedAt=Date.now();const challenge=JSON.parse(round.challenge);if(challenge.reference?.sha256===submittedHash)return json({error:'参考写真そのものは送信できません。実物を撮影してください。'},409);
      if(receivedAt>=round.endsAt)return json({error:'受付時間が終了しました。'},409);
      const id=crypto.randomUUID(),objectKey=`pending/${roomId}/${id}`,digest=submittedHash,demoResult=form.get('demoResult')==='reject'?'reject':'pass';
      let inserted;
      try{inserted=await env.DB.prepare(`INSERT INTO submissions(id,playerId,roundId,requestId,hash,receivedAt,status,roomId,objectKey,mime,demoResult,leaseUntil) SELECT ?,?,?,?,?,?,'uploading',?,?,?,?,0 WHERE (SELECT COUNT(*) FROM submissions WHERE status IN ${pending})<200 AND (SELECT COUNT(*) FROM submissions WHERE roomId=? AND status IN ${pending})<100 AND (SELECT COUNT(*) FROM submissions WHERE roomId=? AND playerId=? AND roundId=?)<8 AND EXISTS(SELECT 1 FROM rounds WHERE id=? AND roomId=? AND status='active' AND endsAt>? AND startedAt>=? AND number<=? AND number=(SELECT MAX(number) FROM rounds WHERE roomId=?)) RETURNING id`).bind(id,player.id,roundId,requestId,digest,receivedAt,roomId,objectKey,mime,demoResult,roomId,roomId,player.id,roundId,roundId,roomId,receivedAt,player.joinedAt,TOTAL_ROUNDS,roomId).first();}
      catch{
        const repeated=await env.DB.prepare('SELECT id,status,receivedAt FROM submissions WHERE roomId=? AND playerId=? AND roundId=? AND requestId=?').bind(roomId,player.id,roundId,requestId).first<any>();
        if(repeated)return json({...repeated,status:repeated.status==='uploading'?'queued':repeated.status,duplicate:true},['uploading','queued','processing'].includes(repeated.status)?202:200);
        return json({error:'判定中・合格済みか、同じ写真をすでに受け付けています。'},409);
      }
      if(!inserted){
        const latest=await current(env.DB,roomId);
        if(!latest||latest.id!==roundId||latest.status!=='active'||latest.endsAt<=Date.now())return json({error:'お題の受付が終了しました。'},409);
        return json({error:'判定キューまたは投稿回数の上限です。少し待ってください。'},429);
      }
      try{await env.BUCKET.put(objectKey,bytes,{httpMetadata:{contentType:mime},customMetadata:{roomId}});await env.DB.prepare("UPDATE submissions SET status='queued' WHERE id=? AND status='uploading'").bind(id).run();}
      catch{await env.DB.prepare("UPDATE submissions SET status='error',hash=NULL,verdict=? WHERE id=?").bind(JSON.stringify({reason:'写真を保存できませんでした。再投稿してください。'}),id).run();return json({error:'写真を受け付けられませんでした。再投稿してください。'},503);}
      ctx.waitUntil(pump(env));return json({id,status:'queued',queued:true,receivedAt},202);
    }
    return json({error:'APIが見つかりません。'},404);
  }catch{return json({error:'リクエストを処理できませんでした。'},400);}finally{if(req.method!=='GET'){const id=p.match(/^\/api\/rooms\/([^/]+)/)?.[1];if(id)snapshotCache.delete(id);}}
}
