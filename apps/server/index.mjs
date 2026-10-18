import express from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { OpenAIAdapter, DemoAdapter } from './ai.mjs';
import {createPassEventsSchema,recordPass} from './pass-events.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path.join(dataDir, 'game.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY,name TEXT NOT NULL,hostHash TEXT NOT NULL,mode TEXT NOT NULL,createdAt INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY,token TEXT UNIQUE,name TEXT,profile TEXT,joinedAt INTEGER,roomId TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rounds (id TEXT PRIMARY KEY,number INTEGER,mode TEXT,status TEXT,challenge TEXT,context TEXT,startedAt INTEGER,endsAt INTEGER,roomId TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS submissions (seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE,playerId TEXT,roundId TEXT,requestId TEXT,hash TEXT,receivedAt INTEGER,status TEXT,verdict TEXT,roomId TEXT NOT NULL,UNIQUE(playerId,roundId,requestId),UNIQUE(roundId,hash));`);
/** Hash credentials before timing-safe host comparison and durable storage. */
const digest = value => createHash('sha256').update(value).digest('hex');
/** Preserve the old single-room database, assigning its rows to an explicit legacy room. */
function migrateLegacy() {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of ['players', 'rounds', 'submissions']) {
      if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === 'roomId')) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN roomId TEXT`);
      }
    }
    const legacyRows = db.prepare('SELECT COUNT(*) AS n FROM players WHERE roomId IS NULL').get().n
      + db.prepare('SELECT COUNT(*) AS n FROM rounds WHERE roomId IS NULL').get().n;
    if (legacyRows) {
      const oldToken = db.prepare("SELECT value FROM meta WHERE key='hostToken'").get()?.value || randomBytes(32).toString('hex');
      const oldMode = db.prepare("SELECT value FROM meta WHERE key='mode'").get()?.value || 'demo';
      db.prepare('INSERT OR IGNORE INTO rooms (id,name,hostHash,mode,createdAt) VALUES (?,?,?,?,?)').run('legacy', '以前のプロトタイプ', digest(oldToken), oldMode, Date.now());
      for (const table of ['players', 'rounds', 'submissions']) db.prepare(`UPDATE ${table} SET roomId='legacy' WHERE roomId IS NULL`).run();
    }
    db.exec(`CREATE INDEX IF NOT EXISTS players_room ON players(roomId);
      CREATE UNIQUE INDEX IF NOT EXISTS rounds_room_number ON rounds(roomId,number);
      CREATE INDEX IF NOT EXISTS submissions_room ON submissions(roomId); COMMIT;`);
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
migrateLegacy();
createPassEventsSchema(db);
for(const [column,type] of [['preparedChallenge','TEXT'],['preparedContext','TEXT'],['preparedMode','TEXT'],['preparedAt','INTEGER'],['preparationError','TEXT'],['lobbyDeadline','INTEGER'],['lobbyStartedAt','INTEGER']]){if(!db.prepare('PRAGMA table_info(rooms)').all().some(c=>c.name===column))db.exec(`ALTER TABLE rooms ADD COLUMN ${column} ${type}`);}
if (!db.prepare('PRAGMA table_info(submissions)').all().some(c => c.name === 'rawHash')) db.exec('ALTER TABLE submissions ADD COLUMN rawHash TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS submissions_raw_hash ON submissions(roundId,rawHash)');
// Photos are transient, so interrupted judgments become retryable rather than fabricated passes.
db.prepare("UPDATE submissions SET status='error',hash=NULL,verdict=? WHERE status IN ('pending','queued','processing','retrying')")
  .run(JSON.stringify({ reason: 'サーバーが再起動しました。再投稿してください。' }));
db.prepare("UPDATE rounds SET status='error' WHERE status='generating'").run();
const referenceDir=path.join(dataDir,'references');fs.mkdirSync(referenceDir,{recursive:true,mode:0o700});
const ai = new OpenAIAdapter();
const demo = new DemoAdapter();
const clients = new Map();
const generating = new Set();
const preparing = new Set();
const publicCache = new Map();
const notificationTimers = new Map();
const queue = [];
let runningJobs = 0;
const concurrency = Math.max(1, Math.min(16, Number(process.env.AI_CONCURRENCY || 8)));
const queueCapacity = 200;
let receptionSequence = Number(db.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM submissions').get().n);
const app = express();
const port = Number(process.env.PORT || 4317);
const lan = Object.values(os.networkInterfaces()).flat().find(a => a?.family === 'IPv4' && !a.internal)?.address;
const publicUrl = (process.env.PUBLIC_URL || `http://${lan || 'localhost'}:${port}`).replace(/\/$/, '');
app.disable('x-powered-by');
app.use(express.json({ limit: '8kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== `${req.protocol}://${req.get('host')}`) {
    return res.status(403).json({ error: '別サイトからの操作はできません。' });
  }
  next();
});
/** Every round lookup is scoped to the resolved room, including asynchronous guards. */
function currentRound(roomId) {
  return db.prepare('SELECT * FROM rounds WHERE roomId=? ORDER BY number DESC LIMIT 1').get(roomId);
}
/** Notify subscribers of this room only. Notification contents contain no participant data. */
function broadcast(roomId) {
  publicCache.delete(roomId);
  if (notificationTimers.has(roomId)) return;
  notificationTimers.set(roomId, setTimeout(() => {
    notificationTimers.delete(roomId);
    for (const res of clients.get(roomId) || []) res.write('data: update\n\n');
  }, 40));
}
/** Expiry and pending judgments remain independent across rooms. */
function expire() {
  const expired = db.prepare("SELECT id,roomId FROM rounds WHERE status='active' AND endsAt<=?").all(Date.now());
  for (const round of expired) {
    db.prepare("UPDATE rounds SET status='closed' WHERE id=? AND roomId=?").run(round.id, round.roomId);
    broadcast(round.roomId);
  }
}
setInterval(()=>{expire();for(const room of db.prepare('SELECT id FROM rooms WHERE lobbyDeadline IS NOT NULL AND lobbyStartedAt IS NULL').all())driveLobby(room.id);},500).unref();
/** Read cookie values defensively; host credentials never travel in shareable links. */
function cookieValue(req, name) {
  return req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}
/** A host may control only rooms created by that browser, using room-specific HttpOnly cookies. */
function isHost(req) {
  const token = cookieValue(req, `host_${req.room.id}`) || (req.room.id === 'legacy' ? cookieValue(req, 'host') : '');
  return !!token && timingSafeEqual(Buffer.from(digest(token), 'hex'), Buffer.from(req.room.hostHash, 'hex'));
}
function host(req, res, next) {
  if (!isHost(req)) return res.status(403).json({ error: 'この部屋を作成したブラウザーで操作してください。' });
  next();
}
/** Reject foreign-room bearer tokens rather than treating them as anonymous sessions. */
function session(req, res, next) {
  if (req.headers.authorization) {
    req.player = db.prepare('SELECT * FROM players WHERE roomId=? AND token=?')
      .get(req.room.id, req.headers.authorization.replace(/^Bearer /, ''));
    if (!req.player) return res.status(401).json({ error: 'この部屋の参加登録が見つかりません。登録し直してください。' });
  }
  next();
}
function player(req, res, next) {
  if (!req.player) return res.status(401).json({ error: 'この部屋への参加登録をしてください。' });
  next();
}
/** Public snapshots expose only this room, with private verdicts limited to the authenticated player. */
function snapshot(req) {
  const roomId = req.room.id;
  const cached = publicCache.get(roomId);
  if (cached && Date.now() - cached.createdAt < 2000) return { ...cached.value, ...roomFlags(req.room), isHost: isHost(req), serverTime: Date.now(), mine: ownSubmissions(req) };
  const players = db.prepare('SELECT id,name,joinedAt FROM players WHERE roomId=? ORDER BY joinedAt,id').all(roomId);
  const rounds = db.prepare('SELECT * FROM rounds WHERE roomId=? ORDER BY number').all(roomId);
  const round = rounds.at(-1);
  const subs = db.prepare('SELECT seq,id,playerId,roundId,receivedAt,status,verdict FROM submissions WHERE roomId=? ORDER BY receivedAt,seq').all(roomId);
  const accepted = subs.filter(s => s.status === 'accepted');
  const starts = new Map(rounds.map(r => [r.id, r.startedAt]));
  const ranks = players.map(p => {
    const wins = accepted.filter(s => s.playerId === p.id);
    return { ...p, wins: wins.length, totalMs: wins.reduce((sum, s) => sum + s.receivedAt - starts.get(s.roundId), 0) };
  }).sort((a, b) => b.wins - a.wins || a.totalMs - b.totalMs || a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
  const currentSubs = subs.filter(s => s.roundId === round?.id);
  const events = passEvents(roomId,subs,players);
  const value = {
    room: { id: roomId, name: req.room.name }, isHost: isHost(req), mode: req.room.mode,
    aiAvailable: ai.available, publicUrl, joinUrl: `${publicUrl}/rooms/${roomId}/join`, serverTime: Date.now(), ...roomFlags(req.room),
    players, ranks, events, eventCursor:events.at(-1)?.id||0, round: round ? { id: round.id, number: round.number, mode: round.mode, status: round.status,
      challenge: publicChallenge(JSON.parse(round.challenge),round), startedAt: round.startedAt, endsAt: round.endsAt } : null,
    stats: { players: players.length, answered: new Set(currentSubs.map(s => s.playerId)).size,
      accepted: new Set(currentSubs.filter(s => s.status === 'accepted').map(s => s.playerId)).size,
      pending: currentSubs.filter(s => ['queued','processing','retrying','pending'].includes(s.status)).length,
      queued: currentSubs.filter(s => s.status === 'queued').length, processing: currentSubs.filter(s => s.status === 'processing').length },
    finishers: currentSubs.filter(s => s.status === 'accepted').map((s, i) => ({ rank: i + 1, playerId:s.playerId,submissionId:s.id,
      name: players.find(p => p.id === s.playerId)?.name, elapsedMs: s.receivedAt - round.startedAt })),
  };
  publicCache.set(roomId, { createdAt: Date.now(), value });
  return { ...value, mine: ownSubmissions(req) };
}
/** Recompute a cut-in's current receipt rank; a stored event does not freeze provisional placement. */
function passEvents(roomId,subs,players){
 return db.prepare('SELECT * FROM pass_events WHERE roomId=? ORDER BY id DESC LIMIT 40').all(roomId).reverse().map(event=>{
  const ordered=subs.filter(s=>s.roundId===event.roundId&&s.status==='accepted');
  const own=subs.find(s=>s.id===event.submissionId);
  const ahead=subs.filter(s=>s.roundId===event.roundId&&['queued','processing','uploading','retrying','pending'].includes(s.status)&&own&&(s.receivedAt<own.receivedAt||s.receivedAt===own.receivedAt&&s.seq<own.seq)).length;
  return {id:event.id,type:'pass',playerId:event.playerId,name:players.find(p=>p.id===event.playerId)?.name,roundId:event.roundId,submissionId:event.submissionId,createdAt:event.createdAt,rank:ordered.findIndex(s=>s.id===event.submissionId)+1,provisional:ahead>0,pendingAhead:ahead};
 });
}
/** Read only one participant's receipt and verdict state. */
function ownSubmissions(req) {
  return req.player ? db.prepare('SELECT s.seq,s.id,s.playerId,s.roundId,s.receivedAt,s.status,s.verdict,e.id AS passEventId FROM submissions s LEFT JOIN pass_events e ON e.submissionId=s.id WHERE s.roomId=? AND s.playerId=? ORDER BY s.receivedAt,s.seq').all(req.room.id,req.player.id).map(s => ({...s,verdict:s.verdict?JSON.parse(s.verdict):null})) : [];
}
const limits = new Map();
/** Bound creation/join rates per remote address without logging addresses or request bodies. */
function rateLimit(req, res, kind, maximum) {
  const now = Date.now();
  const key = `${kind}:${req.socket.remoteAddress}`;
  const recent = (limits.get(key) || []).filter(time => now - time < 60000);
  limits.set(key, [...recent, now]);
  if (recent.length < maximum) return false;
  res.status(429).json({ error: '少し待ってからもう一度お試しください。' });
  return true;
}
app.post('/api/rooms', (req, res) => {
  if (rateLimit(req, res, 'create', 15)) return;
  const name = req.body?.name;
  if (typeof name !== 'string' || !name.trim() || name.length > 48) return res.status(400).json({ error: '部屋の名前を1〜48文字で入力してください。' });
  if (db.prepare('SELECT COUNT(*) AS n FROM rooms').get().n >= 1000) return res.status(409).json({ error: '部屋の作成上限です。サーバー管理者にお問い合わせください。' });
  const id = randomBytes(16).toString('hex');
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO rooms (id,name,hostHash,mode,createdAt) VALUES (?,?,?,?,?)').run(id, name.trim(), digest(token), 'demo', Date.now());
  res.cookie(`host_${id}`, token, { path: `/api/rooms/${id}`, httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: 30 * 86400000 });
  res.status(201).json({ id, hostUrl: `/rooms/${id}/host`, joinUrl: `${publicUrl}/rooms/${id}/join` });
});
const api = express.Router({ mergeParams: true });
app.use('/api/rooms/:roomId', (req, res, next) => {
  req.room = db.prepare('SELECT * FROM rooms WHERE id=?').get(req.params.roomId);
  if (!req.room) return res.status(404).json({ error: 'この部屋は見つかりません。共有リンクを確認してください。' });
  session(req, res, next);
}, api);
api.get('/state', (req, res) => { expire();driveLobby(req.room.id);req.room=roomById(req.room.id);res.json(snapshot(req)); });
api.get('/events', (req, res) => {
  const roomId = req.room.id;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write('data: update\n\n');
  if (!clients.has(roomId)) clients.set(roomId, new Set());
  clients.get(roomId).add(res);
  const timer = setInterval(() => res.write(': heartbeat\n\n'), 20000);
  req.on('close', () => {
    clearInterval(timer); clients.get(roomId)?.delete(res);
    if (!clients.get(roomId)?.size) clients.delete(roomId);
  });
});
api.get(['/qr.svg', '/qr.png'], async (req, res) => {
  const url = `${publicUrl}/rooms/${req.room.id}/join`;
  const options = { margin: 2, width: 480, color: { dark: '#182017', light: '#ffffff' } };
  if (req.path.endsWith('.png')) {
    if (req.query.download === '1') res.attachment(`ai-karimono-${req.room.id}.png`);
    res.type('png').send(await QRCode.toBuffer(url, options));
  } else res.type('svg').send(await QRCode.toString(url, { ...options, type: 'svg' }));
});
api.post('/join', (req, res) => {
  if (rateLimit(req, res, `join:${req.room.id}`, 300)) return;
  const { name, profile = '' } = req.body;
  if (typeof name !== 'string' || !name.trim() || name.length > 24 || typeof profile !== 'string' || profile.length > 240) return res.status(400).json({ error: '名前は1〜24文字、自己紹介は240文字以内です。' });
  if(req.player)return res.json({id:req.player.id,token:req.player.token});
  if (db.prepare('SELECT COUNT(*) AS n FROM players WHERE roomId=?').get(req.room.id).n >= 200) return res.status(409).json({ error: 'この部屋の参加上限に達しました。' });
  const id = randomUUID(), token = randomBytes(24).toString('hex'),joinedAt=Date.now(),initial=!currentRound(req.room.id);
  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare('INSERT INTO players (id,token,name,profile,joinedAt,roomId) VALUES (?,?,?,?,?,?)').run(id,token,name.trim(),profile,joinedAt,req.room.id);
    if(initial)db.prepare('UPDATE rooms SET lobbyDeadline=COALESCE(lobbyDeadline,?) WHERE id=? AND NOT EXISTS(SELECT 1 FROM rounds WHERE roomId=?)').run(joinedAt+30000,req.room.id,req.room.id);
    else db.prepare('UPDATE rooms SET preparedChallenge=NULL,preparedContext=NULL,preparedMode=NULL,preparedAt=NULL,preparationError=NULL WHERE id=?').run(req.room.id);
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  broadcast(req.room.id);driveLobby(req.room.id);res.json({ id, token });
});
/** Pending work blocks only its own room's mode changes and next-round creation. */
function hasPending(roomId) {
  return !!db.prepare("SELECT id FROM submissions WHERE roomId=? AND status IN ('pending','queued','processing','retrying') LIMIT 1").get(roomId);
}
api.post('/host/mode', host, (req, res) => {
  const roomId = req.room.id;
  if (generating.has(roomId) || currentRound(roomId)?.status === 'active' || hasPending(roomId)) return res.status(409).json({ error: 'ラウンドと判定の終了後に切り替えてください。' });
  if (!['demo', 'ai'].includes(req.body.mode)) return res.status(400).json({ error: 'プレイモードを確認してください。' });
  if (req.body.mode === 'ai' && !ai.available) return res.status(400).json({ error: '既存キーファイルが見つかりません。OPENAI_KEY_FILEを確認してください。' });
  db.prepare('UPDATE rooms SET mode=?,preparedChallenge=NULL,preparedContext=NULL,preparedMode=NULL,preparedAt=NULL,preparationError=NULL WHERE id=?').run(req.body.mode, roomId);
  broadcast(roomId); res.json({ ok: true });
});
/** Supply actual metrics and history from this room only to the generation adapter. */
function contextForGeneration(roomId) {
  const players = db.prepare('SELECT name,profile,joinedAt FROM players WHERE roomId=? ORDER BY joinedAt,id').all(roomId);
  const rounds = db.prepare("SELECT * FROM rounds WHERE roomId=? AND status!='error' ORDER BY number").all(roomId);
  const last = rounds.at(-1);
  const subs = last ? db.prepare('SELECT * FROM submissions WHERE roomId=? AND roundId=?').all(roomId, last.id) : [];
  const answered = new Set(subs.map(s => s.playerId)).size;
  const correct = new Set(subs.filter(s => s.status === 'accepted').map(s => s.playerId)).size;
  return { participantCount: players.length, waitingCount: players.length - answered,
    participants: players.map(p => ({ name: p.name, selfReportedInfo: p.profile })),
    responseRate: players.length ? answered / players.length : 0, correctRate: answered ? correct / answered : 0,
    history: rounds.map(r => publicChallenge(JSON.parse(r.challenge),r)), roundCount: rounds.length };
}
/** Sanitize upstream failures; never expose their response bodies or request payloads. */
function safeError(error) {
  return error.status ? `API HTTP ${Number(error.status)}` : error.message?.startsWith('session_cleanup_failed:') ? error.message : '接続・応答形式を確認してください';
}
/** 最新の部屋情報を読み、接続時に取得した古い設定を使わない。 */
function roomById(roomId){return db.prepare('SELECT * FROM rooms WHERE id=?').get(roomId);}
/** 私有ファイル名を限定し、参考写真ディレクトリの外を読み込まない。 */
function referencePath(storageKey){if(typeof storageKey!=='string'||!/^[-a-f0-9]{36}\.jpg$/.test(storageKey))throw Error('reference_unavailable');return path.join(referenceDir,storageKey);}
/** 投稿と参考写真に同じ正規化を適用する。 */
async function normalizePhoto(buffer){return sharp(buffer,{limitInputPixels:25000000}).rotate().resize({width:960,height:960,fit:'inside',withoutEnlargement:true}).jpeg({quality:75}).toBuffer();}
/** 内部ファイル名・ハッシュ・生成トレースを公開スナップショットから除去する。 */
function publicChallenge(challenge,round){
 const {referenceAsset,referenceTrace,...output}=challenge;
 if(challenge.reference){const {storageKey,sha256,canonicalHash,canonicalHashes,...reference}=challenge.reference;output.reference={...reference,url:`/api/rooms/${round.roomId}/reference/${round.id}`};}
 return output;
}
/** AIモードのお題には必ず取得済みの参考写真を保存し、外部URLを参加者に読ませない。 */
async function persistChallenge(challenge,mode){
 const {referenceAsset,...output}=challenge;
 if(mode!=='ai')return output;
 const bytes=referenceAsset?.bytes&&Buffer.from(referenceAsset.bytes);
 if(!bytes?.length||bytes.length>1024*1024||referenceAsset.mime!=='image/jpeg'||!challenge.reference)throw Error('reference_unavailable');
 const canonical=await normalizePhoto(bytes),secondCanonical=await normalizePhoto(canonical),storageKey=`${randomUUID()}.jpg`;
 fs.writeFileSync(referencePath(storageKey),bytes,{mode:0o600,flag:'wx'});
 output.reference={...challenge.reference,mime:'image/jpeg',byteLength:bytes.length,sha256:digest(bytes),canonicalHash:digest(canonical),canonicalHashes:[digest(canonical),digest(secondCanonical)],storageKey};
 return output;
}
/** 初回は生成開始時の参加状況を維持し、以降の準備だけは状況変化で失効させる。 */
function preparedValid(room){
 if(!room?.preparedChallenge||room.preparedMode!==room.mode)return false;
 if(currentRound(room.id)&&(Date.now()-room.preparedAt>=300000||room.preparedContext!==JSON.stringify(contextForGeneration(room.id))))return false;
 try{const challenge=JSON.parse(room.preparedChallenge);if(room.mode==='ai'&&(!challenge.reference?.storageKey||!fs.existsSync(referencePath(challenge.reference.storageKey))))return false;return true;}catch{return false;}
}
/** 公開前の情報を含めず、初回ロビーの時刻と準備状況だけを配信する。 */
function roomFlags(room){
 const round=currentRound(room.id),hasPlayers=!!db.prepare('SELECT id FROM players WHERE roomId=? LIMIT 1').get(room.id);
 const status=round||room.lobbyStartedAt!=null?'started':!hasPlayers||room.lobbyDeadline==null?'empty':room.preparationError?'error':preparing.has(room.id)?'preparing':'waiting';
 return{generating:generating.has(room.id),preparing:preparing.has(room.id),prepared:preparedValid(room),preparationError:room.preparationError||null,lobby:{deadline:room.lobbyDeadline??null,startedAt:room.lobbyStartedAt??round?.startedAt??null,status}};
}
/** 生成が完了した準備内容だけを、同期トランザクションで一度公開する。 */
function startPrepared(roomId){
 if(generating.has(roomId)||hasPending(roomId)||currentRound(roomId)?.status==='active')return false;
 const room=roomById(roomId);if(!preparedValid(room))return false;
 generating.add(roomId);
 try{
  db.exec('BEGIN IMMEDIATE');
  const fresh=roomById(roomId),previous=currentRound(roomId);
  if(previous?.status==='active'||!preparedValid(fresh)){db.exec('ROLLBACK');return false;}
  const challenge=JSON.parse(fresh.preparedChallenge),now=Date.now(),number=(previous?.number||0)+1;
  db.prepare('INSERT INTO rounds (id,number,mode,status,challenge,context,startedAt,endsAt,roomId) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),number,fresh.mode,'active',JSON.stringify(challenge),fresh.preparedContext,now,now+challenge.durationSeconds*1000,roomId);
  db.prepare('UPDATE rooms SET lobbyStartedAt=COALESCE(lobbyStartedAt,?),preparedChallenge=NULL,preparedContext=NULL,preparedMode=NULL,preparedAt=NULL,preparationError=NULL WHERE id=?').run(now,roomId);
  db.exec('COMMIT');return true;
 }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
 finally{generating.delete(roomId);broadcast(roomId);}
}
/** 初回の期限に達した時だけ、サーバー自身が準備済みラウンドを開始する。 */
function driveLobby(roomId){
 const room=roomById(roomId);if(!room||room.lobbyStartedAt!=null||currentRound(roomId)||room.lobbyDeadline==null)return;
 if(!db.prepare('SELECT id FROM players WHERE roomId=? LIMIT 1').get(roomId))return;
 if(preparedValid(room)){if(room.lobbyDeadline<=Date.now())startPrepared(roomId);return;}
 if(!room.preparationError)queuePreparation(roomId);
}
/** お題と写真を先に取得し、初回は後から参加者が増えても同じ入力を使う。 */
function queuePreparation(roomId,{retry=false}={}){
 const room=roomById(roomId);if(!room||generating.has(roomId)||currentRound(roomId)?.status==='active'||hasPending(roomId))return false;
 if(preparedValid(room))return true;if(room.preparationError&&!retry)return false;
 const context=contextForGeneration(roomId);if(!context.participantCount)return false;
 const initial=!currentRound(roomId),mode=room.mode,serialized=JSON.stringify(context);
 generating.add(roomId);preparing.add(roomId);
 db.prepare('UPDATE rooms SET preparedChallenge=NULL,preparedContext=?,preparedMode=?,preparedAt=NULL,preparationError=NULL WHERE id=?').run(serialized,mode,roomId);broadcast(roomId);
 setImmediate(async()=>{
  let persisted;
  try{
   persisted=await persistChallenge(await(mode==='ai'?ai:demo).generate(context),mode);
   const fresh=roomById(roomId);
   if(fresh.mode!==mode||(!initial&&JSON.stringify(contextForGeneration(roomId))!==serialized))throw Error('context_changed');
   db.prepare('UPDATE rooms SET preparedChallenge=?,preparedContext=?,preparedMode=?,preparedAt=?,preparationError=NULL WHERE id=?').run(JSON.stringify(persisted),serialized,mode,Date.now(),roomId);
  }catch{
   if(persisted?.reference?.storageKey)try{fs.unlinkSync(referencePath(persisted.reference.storageKey));}catch{}
   db.prepare('UPDATE rooms SET preparedChallenge=NULL,preparedContext=NULL,preparedMode=NULL,preparedAt=NULL,preparationError=? WHERE id=?').run('参考写真とお題を準備できませんでした。通信を確認して、もう一度準備してください。',roomId);
  }finally{generating.delete(roomId);preparing.delete(roomId);broadcast(roomId);driveLobby(roomId);}
 });return true;
}
api.post('/host/prepare',host,(req,res)=>{
 const roomId=req.room.id;expire();
 if(currentRound(roomId)?.status==='active'||hasPending(roomId))return res.status(409).json({error:'ラウンドと判定の終了を待ってください。'});
 if(!contextForGeneration(roomId).participantCount)return res.status(400).json({error:'参加者を1人以上登録してください。'});
 queuePreparation(roomId,{retry:true});const room=roomById(roomId);res.status(202).json({preparing:preparing.has(roomId),prepared:preparedValid(room)});
});
/** 初回だけ期限を今に変更する。未準備なら成功を装わず受付済み202を返す。 */
function forceInitial(req,res){
 const roomId=req.room.id;if(currentRound(roomId)||req.room.lobbyStartedAt!=null)return res.status(409).json({error:'最初のラウンドはすでに開始しています。'});
 if(!db.prepare('SELECT id FROM players WHERE roomId=? LIMIT 1').get(roomId))return res.status(400).json({error:'参加者を1人以上登録してください。'});
 db.prepare('UPDATE rooms SET lobbyDeadline=? WHERE id=? AND lobbyStartedAt IS NULL').run(Date.now(),roomId);broadcast(roomId);
 if(preparedValid(roomById(roomId))&&startPrepared(roomId))return res.json({ok:true,usedPrepared:true});
 queuePreparation(roomId,{retry:true});res.status(202).json({preparing:true});
}
api.post('/host/start-now',host,forceInitial);
api.post('/host/extend-lobby',host,(req,res)=>{
 const roomId=req.room.id;if(currentRound(roomId)||req.room.lobbyStartedAt!=null)return res.status(409).json({error:'最初のラウンドはすでに開始しています。'});
 if(req.room.lobbyDeadline==null||!db.prepare('SELECT id FROM players WHERE roomId=? LIMIT 1').get(roomId))return res.status(400).json({error:'参加者を1人以上登録してください。'});
 db.prepare('UPDATE rooms SET lobbyDeadline=lobbyDeadline+10000 WHERE id=? AND lobbyStartedAt IS NULL').run(roomId);broadcast(roomId);res.json({ok:true,deadline:roomById(roomId).lobbyDeadline});
});
api.post('/host/start',host,async(req,res)=>{
 const roomId=req.room.id;expire();if(!currentRound(roomId))return forceInitial(req,res);
 if(generating.has(roomId)||currentRound(roomId)?.status==='active'||hasPending(roomId))return res.status(409).json({error:'この部屋のラウンドや判定の終了を待ってください。'});
 if(!contextForGeneration(roomId).participantCount)return res.status(400).json({error:'参加者を1人以上登録してください。'});
 const room=roomById(roomId);if(preparedValid(room)&&startPrepared(roomId))return res.json({ok:true,usedPrepared:true});
 generating.add(roomId);broadcast(roomId);
 try{
  const context=contextForGeneration(roomId),challenge=await persistChallenge(await(room.mode==='ai'?ai:demo).generate(context),room.mode);
  const now=Date.now(),number=(currentRound(roomId)?.number||0)+1;
  db.prepare('INSERT INTO rounds (id,number,mode,status,challenge,context,startedAt,endsAt,roomId) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),number,room.mode,'active',JSON.stringify(challenge),JSON.stringify(context),now,now+challenge.durationSeconds*1000,roomId);
  db.prepare('UPDATE rooms SET preparedChallenge=NULL,preparedContext=NULL,preparedMode=NULL,preparedAt=NULL,preparationError=NULL WHERE id=?').run(roomId);res.json({ok:true,usedPrepared:false});
 }catch(error){res.status(502).json({error:`参考写真とお題の準備に失敗しました（${safeError(error)}）。通信を確認して再試行してください。`});}
 finally{generating.delete(roomId);broadcast(roomId);}
});
/** 開始後のその部屋の参考写真をキャッシュ配信する。未公開準備データは配信しない。 */
api.get('/reference/:roundId',(req,res)=>{
 const round=db.prepare('SELECT * FROM rounds WHERE roomId=? AND id=?').get(req.room.id,req.params.roundId);if(!round)return res.status(404).json({error:'参考写真はまだ公開されていません。'});
 try{const reference=JSON.parse(round.challenge).reference,bytes=fs.readFileSync(referencePath(reference?.storageKey));if(bytes.length>1024*1024)throw Error('reference_unavailable');res.setHeader('Cache-Control','public, max-age=86400, immutable');res.setHeader('ETag',`"${digest(bytes)}"`);res.type('image/jpeg').send(bytes);}catch{res.status(404).json({error:'参考写真を読み込めません。ホストに確認してください。'});}
});
/** 実行した検索・取得記録は開始済みラウンドに限りホストだけが確認できる。 */
api.get('/host/reference-trace',host,(req,res)=>{const round=currentRound(req.room.id);if(!round)return res.status(404).json({error:'お題はまだ公開されていません。'});res.json({roundId:round.id,trace:JSON.parse(round.challenge).referenceTrace||[]});});
api.post('/host/end', host, (req, res) => {
  const round = currentRound(req.room.id);
  if (round?.status === 'active') db.prepare("UPDATE rounds SET status='closed' WHERE id=? AND roomId=?").run(round.id, req.room.id);
  broadcast(req.room.id); res.json({ ok: true });
});
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 1, fields: 4 } });
/** Bound the in-memory work queue; each accepted job retains at most 1MB until processing. */
function pumpQueue() {
  while (runningJobs < concurrency && queue.length) {
    const job = queue.shift(); runningJobs++;
    runJob(job).finally(() => { runningJobs--; pumpQueue(); });
  }
}
/** Decode off the event loop, then judge with bounded concurrency and publish the durable result. */
async function runJob({ id, roomId, round, buffer, demoResult }) {
  db.prepare("UPDATE submissions SET status='processing' WHERE id=?").run(id);
  broadcast(roomId);
  try {
    let bytes;
    try { bytes = await normalizePhoto(buffer); }
    catch { throw new Error('invalid_photo'); }
    try { db.prepare('UPDATE submissions SET hash=? WHERE id=?').run(digest(bytes),id); }
    catch { throw new Error('duplicate_photo'); }
    const challenge=JSON.parse(round.challenge),reference=challenge.reference;let referenceDataUrl;
    if(round.mode==='ai'){
      if(!reference?.storageKey)throw Error('reference_unavailable');
      if(reference.sha256===digest(buffer)||reference.canonicalHash===digest(bytes)||reference.canonicalHashes?.includes(digest(bytes)))throw Error('reference_photo');
      const referenceBytes=fs.readFileSync(referencePath(reference.storageKey));if(referenceBytes.length>1024*1024)throw Error('reference_unavailable');
      referenceDataUrl=`data:image/jpeg;base64,${referenceBytes.toString('base64')}`;
    }
    const result = await (round.mode === 'ai' ? ai : demo).judge(challenge, `data:image/jpeg;base64,${bytes.toString('base64')}`, demoResult,referenceDataUrl);
    if(result.pass){if(!recordPass(db,id,result))throw Error('pass_commit_failed');}
    else db.prepare("UPDATE submissions SET status='rejected',verdict=? WHERE id=? AND roomId=? AND status='processing'").run(JSON.stringify(result),id,roomId);
  } catch (error) {
    const reason = error.message==='reference_photo'?'参考写真そのものは使えません。会場にある実物を自分で撮影してください。':error.message==='reference_unavailable'?'参考写真を読み込めません。ホストに確認してください。':error.message === 'invalid_photo' ? '写真を読み込めません。有効な画像で再挑戦してください。'
      : error.message === 'duplicate_photo' ? '同じ写真はすでに受け付けています。別の写真で挑戦してください。'
      : `判定に接続できませんでした（${safeError(error)}）。再挑戦してください。`;
    db.prepare("UPDATE submissions SET status='error',hash=NULL,rawHash=NULL,verdict=? WHERE id=? AND roomId=? AND status='processing'")
      .run(JSON.stringify({reason}),id,roomId);
  } finally { broadcast(roomId); }
}
api.post('/submit', player, (req,res,next) => {
  if (queue.length + runningJobs >= queueCapacity) return res.status(503).json({error:'受付が混み合っています。数秒後に再送してください。'});
  next();
}, upload.single('photo'), (req, res) => {
  const roomId = req.room.id, receivedAt = Date.now(), receptionOrder = ++receptionSequence;
  expire();
  const round = currentRound(roomId);
  if (!round || req.body.roundId !== round.id) return res.status(409).json({ error: 'お題が切り替わりました。画面を更新してください。' });
  const prior = db.prepare('SELECT * FROM submissions WHERE roomId=? AND playerId=? AND roundId=? AND requestId=?')
    .get(roomId, req.player.id, round.id, req.body.requestId || '');
  if (prior) return res.status(202).json({ id: prior.id, status: prior.status, receivedAt:prior.receivedAt, duplicate: true });
  if (round.status !== 'active' || receivedAt >= round.endsAt) return res.status(409).json({ error: '受付時間が終了しました。' });
  if (req.player.joinedAt > round.startedAt) return res.status(409).json({ error: '途中参加のため、次のお題から挑戦できます。' });
  if (!req.file || !req.body.requestId || req.body.requestId.length > 80) return res.status(400).json({ error: '写真を選んでください。' });
  const existing = db.prepare('SELECT * FROM submissions WHERE roomId=? AND playerId=? AND roundId=?').all(roomId, req.player.id, round.id);
  if (existing.some(s => ['pending','queued','processing','retrying','accepted'].includes(s.status))) return res.status(409).json({ error: '受付済み・判定中、またはすでに合格しています。' });
  if (existing.length >= 8) return res.status(429).json({ error: 'このラウンドの投稿上限です。' });
  const roomPending = db.prepare("SELECT COUNT(*) n FROM submissions WHERE roomId=? AND status IN ('queued','processing','retrying')").get(roomId).n;
  if (roomPending >= 100 || queue.length + runningJobs >= queueCapacity) return res.status(503).json({error:'受付が混み合っています。数秒後に再送してください。'});
  // Header-only signature validation is cheap; full decoding happens in the bounded queue.
  const buffer = req.file.buffer;
  const valid = buffer.length >= 12 && (buffer[0]===0xff && buffer[1]===0xd8 || buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || buffer.subarray(0,4).toString()==='RIFF' && buffer.subarray(8,12).toString()==='WEBP');
  if (!valid) return res.status(400).json({error:'JPEG・PNG・WebP形式の写真を選んでください。'});
  const id = randomUUID(), rawHash = digest(buffer);
  const reference=JSON.parse(round.challenge).reference;if(round.mode==='ai'&&reference?.sha256===rawHash)return res.status(403).json({error:'参考写真そのものは使えません。会場にある実物を自分で撮影してください。'});
  try {
    db.prepare('INSERT INTO submissions (seq,id,playerId,roundId,requestId,rawHash,receivedAt,status,roomId) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(receptionOrder,id,req.player.id,round.id,req.body.requestId,rawHash,receivedAt,'queued',roomId);
  } catch { return res.status(409).json({error:'同じ写真はすでに受け付けています。別の写真で挑戦してください。'}); }
  queue.push({id,roomId,round,buffer,demoResult:req.body.demoResult});
  broadcast(roomId);
  res.status(202).json({id,status:'queued',receivedAt});
  setImmediate(pumpQueue);
});
app.use('/api', (req, res) => res.status(404).json({ error: 'APIが見つかりません。' }));
app.use(express.static(path.join(root, 'apps/web')));
app.get(['/', '/rooms/:roomId/host', '/rooms/:roomId/join'], (req, res) => res.sendFile(path.join(root, 'apps/web/index.html')));
app.get(['/host', '/join'], (req, res) => res.redirect('/'));
app.use((error, req, res, next) => res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? '写真は圧縮後1MB以内にしてください。' : 'リクエストを処理できませんでした。' }));
app.listen(port, '0.0.0.0', () => console.log(`AI借り物競争: http://localhost:${port}/\nスマホ用トップ: ${publicUrl}/\n既存キー: ${ai.available ? '実行時読み込み済み（非表示）' : '未設定'}`));
