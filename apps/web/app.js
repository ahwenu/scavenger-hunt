import {createLiveCamera} from './live-camera.js';
import {soundPlayer,gameSounds} from './sound-effects.js';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** URL内の部屋IDに資格情報と通信を分離する。 */
const roomMatch=location.pathname.match(/^\/rooms\/([a-zA-Z0-9_-]+)\/(host|join)\/?$/);
const roomId=roomMatch?.[1]||'',isJoin=roomMatch?.[2]==='join',isLanding=!roomMatch;
if(roomId&&!isJoin)document.body.classList.add('host-view');
const roomApi=`/api/rooms/${encodeURIComponent(roomId)}`;
const credentialKey=`karimono:${roomId}:token`,playerKey=`karimono:${roomId}:id`;
let token=localStorage.getItem(credentialKey)||'', playerId=localStorage.getItem(playerKey)||'',state=null,offset=0,busy=false,fileUrl='',uploadPhase='',selection=null,submissionKey='',submissionRound='',optimisticReceipt=null,unknownReceipt=false,stateETag='',refreshPromise=null,eventTimer=null,eventsStarted=false;
let resultsInitialized=false,lastEventCursor=0,seenOwnAccepted=new Set(),ownCelebrationTimer=null,cutinTimer=null,currentCutins=[],currentCutinCount=0,pendingOwnCelebration=null,ownCelebrationSubmission=null;
let liveCamera=null,participantRoundRendered='',unknownReceiptRound='',unknownReceiptBaseline=new Set(),seenOwnRejected=new Set(),captureError=null,submissionDemoResult='pass';
try{seenOwnAccepted=new Set(JSON.parse(localStorage.getItem(`karimono:${roomId}:seen-accepted`)||'[]'));}catch{}
try{seenOwnRejected=new Set(JSON.parse(localStorage.getItem(`karimono:${roomId}:seen-rejected`)||'[]'));}catch{}
const reducedMotion=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
const pendingStatuses=new Set(['uploading','queued','processing','retrying','pending']);
const duration=ms=>`${(ms/1000).toFixed(1)}s`;
/** Send same-origin requests with the current participant credential. */
async function api(url,body){const options={headers:token?{Authorization:`Bearer ${token}`}:{}};if(body!==undefined){options.method='POST';options.body=body instanceof FormData?body:JSON.stringify(body);if(!(body instanceof FormData))options.headers['Content-Type']='application/json';}const r=await fetch(url,options);let data;try{data=await r.json();}catch{const error=Error('サーバーの応答を確認できません。接続を確認して再試行してください。');if(!r.ok)error.httpStatus=r.status;throw error;}if(!r.ok){const error=Error(data.error||'通信に失敗しました');error.httpStatus=r.status;throw error;}return data;}
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('visible'),6500);}
/** Refresh live areas only, leaving form values and selected files untouched. */
async function refresh({force=false}={}){
 if(refreshPromise){const result=await refreshPromise;return force?refresh():result;}
 refreshPromise=(async()=>{try{
  const headers=token?{Authorization:`Bearer ${token}`} : {};
  if(stateETag)headers['If-None-Match']=stateETag;
  const response=await fetch(`${roomApi}/state`,{headers,cache:'no-store'});
  if(response.status!==304){if(!response.ok)throw Error('部屋に接続できません');state=await response.json();stateETag=response.headers?.get('ETag')||'';offset=state.serverTime-Date.now();}
  if(state){$('#room-error').hidden=true;if(optimisticReceipt&&state.mine?.some(item=>item.id===optimisticReceipt.id))optimisticReceipt=null;if(unknownReceipt&&(state.round?.id!==unknownReceiptRound||state.mine?.some(item=>item.roundId===unknownReceiptRound&&!unknownReceiptBaseline.has(item.id))))unknownReceipt=false;render();connectEvents();}
  $('#connection').textContent='LIVE · 接続中';$('#connection').classList.add('online');return true;
 }catch(e){$('#connection').textContent='再接続中';$('#connection').classList.remove('online');if(!state)$('#room-error').hidden=false;return false;}
 finally{refreshPromise=null;}})();return refreshPromise;
}
/** 公開版の定期同期では不要なSSE接続を作らない。 */
function connectEvents(){if(eventsStarted||!state)return;eventsStarted=true;if(state.sync==='polling'||typeof EventSource!=='function')return;const events=new EventSource(`${roomApi}/events`);events.onmessage=scheduleEventRefresh;events.onerror=()=>events.close();}
/** 同時更新をまとめ、待機中の回答がある時だけ確認頻度を上げる。 */
function scheduleEventRefresh(){if(eventTimer)return;eventTimer=setTimeout(()=>{eventTimer=null;refresh();},650+Math.random()*450);}
/** 通知非対応でも短い間隔で同期し、画面が隠れている間は通信を控える。 */
async function poll(){await refresh();const pending=unknownReceipt||optimisticReceipt||state?.mine?.some(item=>pendingStatuses.has(item.status))||state?.stats?.pending>0||state?.stats?.queued>0;const active=state?.round?.status==='active';const delay=document.hidden?8000+Math.random()*4000:pending||active?800+Math.random()*600:1500+Math.random()*1000;setTimeout(poll,delay);}
/** 選択画像を端末内で最大960px、JPEGに変換し、元画像は送信しない。 */
async function compressedPhoto(file){
 let image,release=()=>{};
 try{
  if(typeof createImageBitmap==='function'){try{image=await createImageBitmap(file,{imageOrientation:'from-image'});}catch{}}
  if(!image){const url=URL.createObjectURL(file);release=()=>URL.revokeObjectURL(url);image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('この写真を読み込めません。JPEG・PNG・WebPの写真を選んでください。'));img.src=url;});}
  const width=image.width||image.naturalWidth,height=image.height||image.naturalHeight;
  if(!width||!height)throw Error('写真のサイズを読み取れません。別の写真を選んでください。');
  const ratio=Math.min(1,960/Math.max(width,height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));
  const context=canvas.getContext('2d');if(!context)throw Error('写真を変換できません。別のブラウザでお試しください。');context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.75));if(!blob||blob.type!=='image/jpeg')throw Error('写真をJPEGに変換できません。別の写真を選んでください。');if(blob.size>1000000)throw Error('写真が1MBを超えています。より小さい写真を選んでください。');return blob;
 }finally{image?.close?.();release();}
}
/** カメラと端末撮影の両方を、同じ安全な受付経路で直ちに送信する。 */
async function submitCapturedPhoto(file,meta={}){
 unlockSound();const retry=meta.explicitRetry===true,unresolvedBefore=unknownReceipt;if(busy||(unknownReceipt&&!retry))throw Error('受付状況を確認中です。このままお待ちください。');
 if(retry&&(!unknownReceipt||file!==selection||!submissionKey||submissionRound!==unknownReceiptRound))throw Error('再試行できる写真がありません。受付状況を確認してください。');
 const requestedRound=meta.roundId||state?.round?.id;captureError=null;busy=true;uploadPhase='受付状況を確認しています…';render();let uploaded=false,result;
 try{
  if(!await refresh({force:true}))throw Error('接続を確認できません。通信が戻ってから撮影してください。');
  const round=state?.round,me=state?.players?.find(p=>p.id===playerId),mine=state?.mine?.filter(item=>item.roundId===round?.id)||[];
  if(!round||round.id!==requestedRound||round.status!=='active'||state.generating||Date.now()+offset>=round.endsAt)throw Error('このお題の受付は終了しました。次のお題を待ってください。');
  if(!me||me.joinedAt>round.startedAt)throw Error('途中参加のため、次のお題から挑戦できます。');
  const knownRetry=retry?mine.find(item=>!unknownReceiptBaseline.has(item.id)):null;if(knownRetry){unknownReceipt=false;return cameraReceiptResult(knownRetry);}
  if(mine.some(item=>pendingStatuses.has(item.status)||item.status==='accepted')||optimisticReceipt?.roundId===round.id)throw Error('すでに受け付けています。結果をお待ちください。');
  if(!file||file.type!=='image/jpeg'||file.size>1048576||!file.size)throw Error('写真を1MB以下のJPEGで撮影してください。');
  if(!retry&&(selection!==file||submissionRound!==round.id)){selection=file;submissionRound=round.id;submissionDemoResult=$('#demo-result')?.value||'pass';submissionKey=crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`;}
  const data=new FormData();data.set('photo',file,'photo.jpg');data.set('demoResult',submissionDemoResult);data.set('roundId',round.id);data.set('requestId',submissionKey);
  if(!retry){unknownReceiptRound=round.id;unknownReceiptBaseline=new Set((state.mine||[]).map(item=>item.id));}uploadPhase='撮影した写真を送信しています…';render();
  uploaded=true;result=await api(`${roomApi}/submit`,data);unknownReceipt=false;if(pendingStatuses.has(result.status))void soundPlayer.play('submit');
  optimisticReceipt=pendingStatuses.has(result.status)?{...result,roundId:round.id,receivedAt:result.receivedAt}:null;
  return cameraReceiptResult(result);
 }catch(error){
  unknownReceipt=(uploaded&&!error.httpStatus)||(retry&&unresolvedBefore&&!uploaded);
  if(unknownReceipt)return {status:'queued',message:'通信が途切れたため受付状況を確認しています。写真は自動で再送しません。'};
  captureError={roundId:requestedRound,message:error.message||'送信できませんでした。接続を確認して撮り直してください。'};throw error;
 }finally{busy=false;uploadPhase='';await refresh({force:true});render();}
}
/** 受付結果をカメラ表示用に変換する。成功演出は共有スナップショットだけで行う。 */
function cameraReceiptResult(result){return {status:result.status==='accepted'?'pass':result.status==='rejected'?'reject':pendingStatuses.has(result.status)?result.status==='processing'?'judging':'queued':'error',message:result.verdict?.reason||'写真を受け付けました。結果は自動で届きます。'};}
/** 未確認の写真はユーザーの明示操作だけで、同じ受付キー・同じバイトを再送する。 */
async function retryUnknownPhoto(){if(busy||!unknownReceipt||!selection)return;unlockSound();try{await submitCapturedPhoto(selection,{roundId:submissionRound,source:'explicit-retry',explicitRetry:true});}catch(error){toast(error.message);}finally{render();}}
/** 参加済みのカメラDOMを保持し、毎回作り直してストリームを切断しない。 */
function ensureParticipantCamera(){if(liveCamera)return;liveCamera=createLiveCamera($('#live-camera-mount'),{onCapture:submitCapturedPhoto,onFallback:submitCapturedPhoto,onGesture:unlockSound,onShutter:()=>{void soundPlayer.play('shutter');}});}
/** 参考写真は現在の部屋・現在のラウンドの配信URLだけをカメラへ渡す。 */
function participantReferenceUrl(round){try{const url=new URL(round?.challenge?.reference?.url,location.origin);return url.origin===location.origin&&url.pathname===`${roomApi}/reference/${encodeURIComponent(round.id)}`&&!url.username&&!url.password?url.href:'';}catch{return '';}}
/** 判定結果と他者の最新通過だけを、ライブ映像へ重ねて表示する。 */
function syncParticipantCamera(){
 if(!isJoin||!liveCamera||!state)return;const round=state.round,me=state.players.find(p=>p.id===playerId);if(!me)return;
 const mine=(state.mine||[]).filter(item=>item.roundId===round?.id);if(optimisticReceipt&&optimisticReceipt.roundId===round?.id&&!mine.some(item=>item.id===optimisticReceipt.id))mine.push(optimisticReceipt);
 const accepted=mine.find(item=>item.status==='accepted'),pending=mine.find(item=>pendingStatuses.has(item.status)),latest=mine.at(-1),late=!!round&&me.joinedAt>round.startedAt;
 const retainedError=captureError?.roundId===round?.id?captureError:null;
 let cameraStatus=accepted?'pass':pending?.status==='processing'?'judging':pending?'queued':latest?.status==='rejected'?'reject':['failed','error'].includes(latest?.status)?'error':'ready';if(retainedError&&!accepted&&!pending)cameraStatus='error';if(unknownReceipt)cameraStatus='queued';else if(busy&&!accepted)cameraStatus='sending';
 const message=unknownReceipt?'受付状況を確認中です。自動では再送しません。':busy?uploadPhase:retainedError&&!accepted&&!pending?retainedError.message:late?'途中参加のため次のお題から撮影できます。':accepted?accepted.verdict?.reason:pending?'受付時刻で順位を確保しました。判定結果を待っています。':latest?.verdict?.reason||'';
 const event=currentCutins.filter(item=>item.roundId===round?.id&&item.playerId!==playerId).at(-1),rank=event?placementFor(event.playerId,event.submissionId):null;
 const cutin=event?`${event.name}さんが${rank?`${Number(state.stats.pending)>0?'暫定':'いま'}${Number(rank)}位通過`:'クリア'}${currentCutinCount>1?` · ほか${currentCutinCount-1}人`:''}`:'';
 const cameraRound=late&&round?{...round,status:'closed'}:round;
 liveCamera.update({round:cameraRound,lobby:state.lobby,pending:!!(busy||unknownReceipt||pending),accepted:!!accepted,status:cameraStatus,ownStatus:message,referenceUrl:participantReferenceUrl(round),latestPass:cutin,serverTime:Date.now()+offset});
}
/** カメラ以外の詳細は折りたたみに集約し、撮影面を最初に見せる。 */
function renderParticipant(){
 if(captureError&&captureError.roundId!==state.round?.id)captureError=null;
 const me=state.players.find(p=>p.id===playerId);$('#registration').hidden=!!me;$('#player-board').hidden=!me;document.body.classList.toggle('participant-registered',!!me);
 if(!me){if(liveCamera){liveCamera.destroy();liveCamera=null;participantRoundRendered='';}return;}
 $('#player-welcome').innerHTML=`<div class="welcome"><span>✓ 参加中</span><strong>${esc(me.name)} さん</strong><span class="badge">${state.mode==='demo'?'DEMO':'LIVE AI'}</span></div>`;
 ensureParticipantCamera();const round=state.round,key=`${round?.id||''}:${round?.status||''}:${state.generating}`;
 if(participantRoundRendered!==key){$('#player-challenge').innerHTML=challengeHTML(round);participantRoundRendered=key;}
 $('#unknown-retry').hidden=!unknownReceipt||!selection||submissionRound!==round?.id||round?.status!=='active';$('#retry-unknown').disabled=busy;
 $('#camera-details').hidden=!round;$('#demo-controls').hidden=(round?.mode||state.mode)!=='demo';
 const mine=(state.mine||[]).filter(item=>item.roundId===round?.id),latest=mine.at(-1);
 $('#my-results').innerHTML=latest?`<p class="fineprint">${esc(latest.verdict?.provider||'')} · サーバー受付 ${latest.receivedAt?new Date(latest.receivedAt).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo'}):'確認中'}</p>`:'';
 syncParticipantCamera();
}

function skeleton(){ $('#app').innerHTML=`<div id="room-error" class="room-warning" hidden>部屋に接続できません。リンクを確認して再読み込みしてください。<a href="/">新しく部屋を作成 ↗</a></div><div class="room-heading"><span class="eyebrow">YOUR RACE ROOM</span><strong id="room-name">部屋を読み込み中…</strong></div><section id="lobby-status" class="lobby-status" role="status" aria-live="polite" hidden><p class="eyebrow">EVERYONE, GET READY</p><strong id="lobby-countdown">最初の参加者を待っています</strong><p id="lobby-detail"></p></section><aside id="live-cutins" class="live-cutins" role="status" aria-live="polite" hidden></aside>`+(isJoin?`<section class="participant-intro"><p class="eyebrow">WELCOME TO THE RACE</p><h1>見つけたら、<br><em>きみの勝ち。</em></h1><p>お題をチェック。会場で探す。写真でチャレンジ。</p></section><section id="registration" class="card registration"><div class="section-heading"><span class="step">01</span><h2>レースに参加する</h2></div><form id="join-form"><p class="room-join-note">このリンクの部屋に、そのまま参加できます。</p><label>ニックネーム<input name="name" required maxlength="24" autocomplete="nickname" placeholder="会場で呼んでほしい名前"></label><label>ひとこと自己紹介 <small>任意・お題づくりの参考にします</small><textarea name="profile" maxlength="240" placeholder="好きなもの、今日持ってきたものなど"></textarea></label><button class="button primary" type="submit">参加して待機する <span>↗</span></button></form><p class="fineprint">実AIモードでは、登録した名前・自己紹介や提出写真をOpenAIに送信してお題生成・判定に使います。秘密や個人情報は入力・撮影しないでください。写真は判定のため一時保存し、判定後に削除します。</p></section><section id="player-board" hidden><div class="participant-camera-heading"><div id="player-welcome"></div><div class="sound-control"><button id="sound-toggle" type="button" class="sound-toggle" aria-pressed="false">音を有効にする ♪</button></div></div><div id="live-camera-mount"></div><div id="unknown-retry" class="camera-retry" hidden><p>受付を確認できていません。再試行しても同じ写真として照合します。</p><button id="retry-unknown" type="button">同じ写真で再試行 ↗</button></div><section id="own-celebration" class="own-celebration" role="status" aria-live="polite" hidden></section><div id="demo-controls"><label>デモで返す結果<select id="demo-result" name="demoResult"><option value="pass">合格にする</option><option value="reject">不合格にする</option></select></label><p class="fineprint">デモは画像を評価せず、この選択結果を返します。</p></div><details id="camera-details" class="camera-details"><summary>お題・見本写真・判定基準を見る</summary><div id="player-challenge"></div></details><div id="my-results" role="status" aria-live="polite"></div></section><section class="card ranking"><div class="section-heading"><span class="step">↗</span><h2>いまのランキング</h2></div><div id="rank-list"></div></section>`:`<header class="host-board-title"><button id="sound-toggle" type="button" class="sound-toggle" aria-pressed="false">🔊 音を有効にする</button><h1>AI借り物<span>競争</span><i aria-hidden="true">↗</i></h1><p>FIND IT. SNAP IT. WIN IT.</p></header><div class="host-grid host-dashboard"><section class="card join-card host-invite"><div class="section-heading"><span class="step">01</span><h2>この部屋に参加</h2></div><div class="qr-wrap"><img src="${roomApi}/qr.svg" width="208" height="208" alt="この部屋の参加QRコード"></div><p class="qr-label">スマホでスキャン</p><a id="join-link" class="text-link" href="/rooms/${roomId}/join">参加ページを開く ↗</a><div class="host-share"><button id="share-link" class="button subtle" type="button">参加リンクを共有 ↗</button><label class="share-fallback" id="share-fallback" hidden>参加リンク<input id="share-url" readonly aria-label="参加用リンク"></label><p id="share-status" class="fineprint" role="status" aria-live="polite"></p><details class="host-secondary"><summary>QR画像の共有・保存</summary><div class="host-details-panel"><button id="share-qr" class="button subtle" type="button">QR画像を共有 ↗</button><a class="text-link" href="${roomApi}/qr.png?download=1" download="karimono-${roomId}-qr.png">QR画像を保存 ↓</a></div></details></div><div id="players" class="players"></div></section><div class="main-column host-center"><div id="host-challenge"></div><section class="card control-card"><div class="host-control-heading"><h2>レースの操作</h2><span id="mode-badge" class="badge"></span></div><div id="metrics" class="metrics"></div><p id="queue-status" class="fineprint" role="status" aria-live="polite"></p><p id="owner-warning" class="room-warning" hidden>開始・終了の操作は、部屋を作成したブラウザで行ってください。</p><div class="controls"><button id="prepare" class="button subtle" type="button" hidden>先にお題を準備</button><button id="start" class="button primary">お題を生成してスタート <span>↗</span></button><button id="extend-lobby" class="button subtle" type="button" hidden>+10秒追加</button><button id="end" class="button subtle" hidden>このラウンドを終了</button><details class="host-secondary host-settings"><summary>設定</summary><div class="host-details-panel"><label class="mode-label">プレイモード<select id="mode"><option value="demo">デモで体験</option><option value="ai">実AIでプレイ</option></select></label><p id="mode-note" class="fineprint"></p></div></details></div><p id="prepare-status" class="prepare-status" role="status" aria-live="polite" hidden></p></section></div><section class="card ranking host-leaderboard"><div class="section-heading"><span class="step">↗</span><h2>ランキング</h2><span id="host-rank-count" class="host-count"></span></div><p id="host-rank-note" class="host-rank-note"></p><div id="rank-list"></div><details class="host-secondary host-full-ranks"><summary id="host-full-ranks-label">全員の順位を見る</summary><div id="host-full-ranks" class="host-details-panel host-ranks-popover"></div></details><section class="host-recent"><div class="host-recent-heading"><h3>いまのクリア</h3><span>LIVE</span></div><div id="host-recent-passes"></div></section></section></div>`);
 wire();}
/** Wire fixed forms once; live snapshots never replace these elements. */
function wire(){if($('#sound-toggle'))$('#sound-toggle').onclick=toggleSound;updateSoundButton();if(isJoin){$('#retry-unknown').onclick=retryUnknownPhoto;$('#sound-toggle').onclick=toggleSound;updateSoundButton();$('#join-form').onsubmit=async e=>{e.preventDefault();unlockSound();const b=e.submitter;b.disabled=true;try{const d=await api(`${roomApi}/join`,Object.fromEntries(new FormData(e.target)));token=d.token;playerId=d.id;localStorage.setItem(credentialKey,token);localStorage.setItem(playerKey,playerId);await refresh();void soundPlayer.play('join');toast('参加できました！');}catch(e){toast(e.message);}finally{b.disabled=false;}};}else{$('#prepare').onclick=()=>hostAction(`${roomApi}/host/prepare`);$('#start').onclick=()=>hostAction(`${roomApi}/host/${isFirstLobby()?'start-now':'start'}`);$('#extend-lobby').onclick=()=>hostAction(`${roomApi}/host/extend-lobby`);$('#end').onclick=()=>hostAction(`${roomApi}/host/end`);$('#mode').onchange=e=>hostAction(`${roomApi}/host/mode`,{mode:e.target.value});$('#share-link').onclick=shareLink;$('#share-qr').onclick=shareQR;}}
async function hostAction(url,body={}){unlockSound();busy=true;render();try{if(!state?.isHost)throw Error('部屋を作成したブラウザで操作してください。');await api(url,body);}catch(e){toast(e.message);}finally{busy=false;await refresh();}}
/** 出典リンクにはHTTP(S)の絶対URLだけを許可し、資格情報や制御文字を除く。 */
function safeReferenceLink(value){try{if(typeof value!=='string'||/[\u0000-\u0020\u007f]/.test(value))return '';const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}}
/** 開始済みラウンドの参考写真だけを、同じ部屋の配信経路から表示する。 */
function referenceHTML(round){
 if(round.mode==='demo')return '';
 const reference=round.challenge?.reference;if(!reference)return '<p class="reference-unavailable">お題の判定条件に合う実物を撮影してください。</p>';
 let imageUrl='';try{const url=new URL(reference.url,location.origin),expected=`${roomApi}/reference/${encodeURIComponent(round.id)}`;if(['http:','https:'].includes(url.protocol)&&url.origin===location.origin&&url.pathname===expected&&!url.username&&!url.password)imageUrl=url.href;}catch{}
 const source=safeReferenceLink(reference.sourceUrl),license=safeReferenceLink(reference.licenseUrl);
 const sourceLabel=source?`<a href="${esc(source)}" target="_blank" rel="noopener noreferrer">写真の出典 ↗</a>`:'写真の出典情報';
 const licenseLabel=license?`<a href="${esc(license)}" target="_blank" rel="noopener noreferrer">${esc(reference.license||'ライセンス')} ↗</a>`:esc(reference.license||'ライセンス情報なし');
 return `<figure class="reference-photo"><figcaption><span>探すものの参考写真</span><strong>${esc(reference.title||'探すものの見本')}</strong></figcaption>${imageUrl?`<div class="reference-image-wrap"><img class="reference-image" src="${esc(imageUrl)}" alt="参考写真: ${esc(reference.title||round.challenge.title)}" decoding="async" referrerpolicy="no-referrer"></div>`:'<p class="reference-unavailable">参考写真を表示できません。通信と参加リンクを確認してください。</p>'}<p class="reference-instruction">同じ種類や、指定した色・形の実物を撮影。背景や構図を合わせる必要はありません。</p><p class="reference-credit">${sourceLabel}<span>撮影・作者: ${esc(reference.author||'出典を参照')}</span>${licenseLabel}</p><p class="reference-rule">会場にある実物を自分で撮影してください。参考写真そのものの送信や、画面・印刷物の撮影は参加ルールに合いません。</p></figure>`;
}
/** 準備の段階を、未公開のお題や参考写真を含めずに案内する。 */
function preparationMessage(){return ({searching:'参考写真を探しています。ルールを説明しながらお待ちください。',fetching:'参考写真を確認しています。もう少しお待ちください。',generating:'お題と判定条件を準備しています。ルールを説明しながらお待ちください。'})[state.preparationStage]||'お題を準備しています。ルールを説明しながらお待ちください。';}
function challengeHTML(r){if(state.generating)return `<section class="challenge card"><p class="eyebrow">AI IS THINKING…</p><h2>次のお題をつくっています<span class="thinking"> ●</span></h2><p>参加状況とこれまでのお題をもとに生成中。</p></section>`;if(!r)return `<section class="challenge card empty-challenge"><p class="eyebrow">READY, SET…</p><h2>${isJoin?'ホストのスタートを待とう。':'最初のお題を待っています。'}</h2><p>みんなが集まったら、レースをスタート！</p><span class="decorative-arrow" aria-hidden="true">↗</span></section>`;return `<section class="challenge card ${r.status!=='active'?'closed':''}"><div class="challenge-top"><p class="eyebrow">ROUND ${String(r.number).padStart(2,'0')} / ${r.status==='active'?'NOW PLAYING':'FINISHED'}</p><span class="countdown" data-ends="${Number(r.endsAt)}" data-active="${r.status==='active'}"></span></div><h2>${esc(r.challenge.title)}</h2><p>${esc(r.challenge.description)}</p>${referenceHTML(r)}<div class="criteria"><strong>写真の判定基準</strong>${r.challenge.criteria.map(c=>`<div><span>✓</span> ${esc(c)}</div>`).join('')}</div><div class="challenge-bottom"><span>${esc(r.challenge.provider||'')} / ${r.mode==='demo'?'画像評価なしのデモ':'写真判定: Decisions API'}</span><strong>${state.stats.accepted}人がクリア！</strong></div>${state.finishers.length?`<div class="finishers">${state.finishers.slice(0,5).map(f=>`<span>${f.rank===1?'⚑':'✓'} ${esc(f.name)} <b>${duration(f.elapsedMs)}</b></span>`).join('')}</div>`:''}</section>`;}
function rankings(){return state.ranks.length?`<div class="rank-header"><span>RANK / PLAYER</span><span>CLEAR / TIME</span></div>${state.ranks.map((p,i)=>`<div class="rank-row ${p.id===playerId?'me':''}" data-player-id="${esc(p.id)}"><span class="rank-number">${String(i+1).padStart(2,'0')}</span><span class="avatar">${esc(p.name.slice(0,1))}</span><strong>${esc(p.name)}${p.id===playerId?' <small>YOU</small>':''}</strong><div class="score"><b>${p.wins}<small> CLEAR</small></b><span>${duration(p.totalMs)}</span></div></div>`).join('')}`:`<div class="empty-state"><span>⚑</span><p>最初のチャレンジャーを待っています。<br><small>参加すると、ここに名前が登場します。</small></p></div>`;}
function render(){if(!state)return;$('#room-error').hidden=true;$('#room-name').textContent=state.room.name;const beforeRanks=rankPositions();$('#rank-list').innerHTML=isJoin?rankings():hostRankings();animateRankChanges(beforeRanks);if(isJoin){renderParticipant();}else{$('#owner-warning').hidden=!!state.isHost;$('#join-link').href=state.joinUrl;$('#players').innerHTML=`<p><b>${state.players.length}</b> 人が参加中</p><div>${state.players.slice(0,6).map(p=>`<span>${esc(p.name)}</span>`).join('')}${state.players.length>6?`<span>ほか${state.players.length-6}人</span>`:''}</div>`;const stats=state.stats;$('#queue-status').textContent=Number(stats.queued)>0?`受付済み・順番待ち ${Number(stats.queued)}件。結果は受付時刻順でランキングに反映します。`:Number(stats.pending)>0?`写真を判定しています（${Number(stats.pending)}件）。`:'';$('#metrics').innerHTML=`<div><strong>${stats.players}<small>人</small></strong><span>参加者</span></div><div><strong>${stats.answered}<small>人</small></strong><span>回答済み</span></div><div><strong>${stats.accepted}<small>人</small></strong><span>クリア</span></div><div><strong>${stats.players?Math.round(stats.answered/stats.players*100):0}<small>%</small></strong><span>回答率</span></div>`;$('#mode').value=state.mode;$('#mode-badge').textContent=state.mode==='demo'?'DEMO MODE':'LIVE AI';$('#mode-note').textContent=state.mode==='demo'?'デモ：参考写真は検索せず、固定のお題と選択した合否で体験します。写真の内容は評価しません。':'実AI：AIがお題と条件をつくり、みんなが撮った実物の写真を判定します。';const active=state.round?.status==='active';const preparing=!!state.preparing,prepared=!!state.prepared;$('#prepare').hidden=state.mode!=='ai';$('#prepare').disabled=!state.isHost||active||busy||state.generating||preparing||prepared||!stats.players||!!stats.pending||!!stats.queued;$('#prepare').textContent=preparing?'お題を準備しています…':prepared?'お題の準備完了':'先にお題を準備';$('#prepare-status').hidden=state.mode!=='ai'||(!preparing&&!prepared&&!state.preparationError);$('#prepare-status').textContent=preparing?preparationMessage():prepared?'お題準備できました。スタートですぐ配信':state.preparationError?'お題を準備できませんでした。もう一度「先にお題を準備」をお試しください。':'';$('#prepare-status').classList.toggle('ready',prepared);$('#mode').disabled=!state.isHost||active||preparing||state.generating||busy||!!stats.pending||!!stats.queued;$('#mode option[value="ai"]').disabled=!state.aiAvailable;$('#start').disabled=!state.isHost||active||preparing||state.generating||busy||!stats.players||!!stats.pending||!!stats.queued;$('#start').textContent=preparing?'お題を準備しています…':state.generating?'AIがお題を生成しています…':busy?'処理中…':prepared?'準備したお題でスタート ↗':state.round?'次のお題を生成してスタート ↗':'お題を生成してスタート ↗';$('#end').hidden=!active;$('#end').disabled=!state.isHost||busy;$('#host-challenge').innerHTML=hostChallengeHTML(state.round);renderHostDashboard();hostLobbyControls();}observeGameSounds();handleLiveResults();if(isJoin)syncParticipantCamera();tick();}
/** 会場画面は上位6人を読みやすく並べ、全員の順位は必要な時に開く。 */
function hostRankRows(players,start=0){return players.map((player,index)=>`<div class="rank-row ${player.id===playerId?'me':''}" data-player-id="${esc(player.id)}"><span class="rank-number">${String(start+index+1).padStart(2,'0')}</span><strong title="${esc(player.name)}">${esc(player.name)}</strong><div class="score"><b>${Number(player.wins)}<small> CLEAR</small></b><span>${duration(player.totalMs)}</span></div></div>`).join('');}
/** 主画面には大きな上位行だけを描き、70人分の行で高さを使わない。 */
function hostRankings(){return state.ranks.length?hostRankRows(state.ranks.slice(0,6)):'<div class="empty-state"><span>⚑</span><p>最初のチャレンジャーを<br>待っています。</p></div>';}
/** 会場用の参考写真を、出典を残しつつ判定基準の隣に配置する。 */
function hostReferenceHTML(round){
 const reference=round.challenge?.reference;if(round.mode==='demo')return '<div class="host-demo-art"><span aria-hidden="true">↗</span><strong>FIND<br>YOUR WIN.</strong><p>DEMO / 写真検索なし</p></div>';
 if(!reference)return '<div class="host-demo-art"><span aria-hidden="true">↗</span><strong>FIND<br>YOUR WIN.</strong><p>AI / お題の条件をチェック</p></div>';
 let imageUrl='';try{const url=new URL(reference.url,location.origin);if(['http:','https:'].includes(url.protocol)&&url.origin===location.origin&&url.pathname===`${roomApi}/reference/${encodeURIComponent(round.id)}`&&!url.username&&!url.password)imageUrl=url.href;}catch{}
 const source=safeReferenceLink(reference.sourceUrl),license=safeReferenceLink(reference.licenseUrl);
 return `<figure class="host-reference"><figcaption>探すものの参考写真</figcaption>${imageUrl?`<img src="${esc(imageUrl)}" alt="参考写真: ${esc(reference.title||round.challenge.title)}" decoding="async" referrerpolicy="no-referrer">`:'<p>参考写真を表示できません。</p>'}<p class="host-reference-credit">${source?`<a href="${esc(source)}" target="_blank" rel="noopener noreferrer">出典 ↗</a>`:''}<span>${esc(reference.author||'出典を参照')}</span>${license?`<a href="${esc(license)}" target="_blank" rel="noopener noreferrer">${esc(reference.license||'ライセンス')} ↗</a>`:esc(reference.license||'')}</p></figure>`;
}
/** ホストの重要情報は、長い導入を省き1画面の課題エリアへ集約する。 */
function hostChallengeHTML(round){
 if(state.generating)return `<section class="challenge card host-challenge host-ready"><p class="eyebrow">GETTING READY</p><h2>次のお題を準備しています<span class="thinking"> ●</span></h2><p>参加者にルールを説明してお待ちください。</p><span class="decorative-arrow" aria-hidden="true">↗</span></section>`;
 if(!round)return `<section class="challenge card host-challenge host-ready"><p class="eyebrow">READY, SET…</p><h2>会場ぜんぶが、<br>プレイグラウンド。</h2><p>QRで参加。お題を見て、探して、撮ろう。<br>${state?.lobby?.autoStart===false?'ホストが開始するとゲームが始まります。':'最初の参加から30秒でスタートします。'}</p><div class="host-howto"><span>01 参加する</span><span>02 探して撮る</span><span>03 一番をめざす</span></div><span class="decorative-arrow" aria-hidden="true">↗</span></section>`;
 return `<section class="challenge card host-challenge ${round.status!=='active'?'closed':''}"><div class="challenge-top"><p class="eyebrow">ROUND ${String(round.number).padStart(2,'0')} / ${round.status==='active'?'NOW PLAYING':'FINISHED'}</p><span class="countdown" data-ends="${Number(round.endsAt)}" data-active="${round.status==='active'}"></span></div><h2>${esc(round.challenge.title)}</h2><div class="host-task-grid">${hostReferenceHTML(round)}<div class="host-task-copy"><p class="host-task-description">${esc(round.challenge.description)}</p><div class="criteria"><strong>写真の判定基準</strong>${round.challenge.criteria.map(criterion=>`<div><span>✓</span> ${esc(criterion)}</div>`).join('')}</div></div></div><p class="host-task-rule">${round.mode==='demo'?'デモでは写真を評価せず、選択した合否を返します。':'同じ種類や指定の色・形の実物を、自分で撮影。背景・構図を合わせる必要はありません。参考写真や画面・印刷物の撮影は使えません。'}</p></section>`;
}
/** 上位人数、全員の順位、直近3件の確定通過だけを更新する。 */
function renderHostDashboard(){
 document.body.classList.toggle('host-playing',!!state.round);$('#host-rank-count').textContent=`${state.ranks.length}人`;
 $('#host-rank-note').textContent=Number(state.stats.pending)>0?`暫定順位 · ${Number(state.stats.pending)}件を判定中`:'合格数とサーバー受付時刻で決まります';
 $('#host-full-ranks-label').textContent=`全${state.ranks.length}人の順位を見る`;
 $('#host-full-ranks').innerHTML=state.ranks.length?hostRankRows(state.ranks):'<p>まだ参加者がいません。</p>';
 const passes=(state.events||[]).filter(event=>event.type==='pass'&&event.roundId===state.round?.id).slice(-3).reverse();
 $('#host-recent-passes').innerHTML=passes.length?passes.map(event=>{const rank=placementFor(event.playerId,event.submissionId);return `<div class="host-pass-row"><span aria-hidden="true">✓</span><strong title="${esc(event.name)}">${esc(event.name)}</strong><b>${rank?`${Number(state.stats.pending)>0?'暫定':''}${Number(rank)}位`:'クリア'}</b></div>`;}).join(''):'<p class="host-no-passes">最初のクリアを待っています。</p>';
}
/** 演出の既読状態は部屋ごとに保存し、リロードで過去の成功を再演しない。 */
function saveResultCursor(){seenOwnRejected=new Set([...seenOwnRejected].slice(-120));try{localStorage.setItem(`karimono:${roomId}:seen-rejected`,JSON.stringify([...seenOwnRejected]));}catch{}seenOwnAccepted=new Set([...seenOwnAccepted].slice(-120));try{localStorage.setItem(`karimono:${roomId}:event-cursor`,String(lastEventCursor));localStorage.setItem(`karimono:${roomId}:seen-accepted`,JSON.stringify([...seenOwnAccepted].slice(-120)));}catch{}}
/** 音の許可状態と端末別の消音を表示する。 */
function updateSoundButton(){const button=$('#sound-toggle');if(!button)return;const {enabled,unlocked}=soundPlayer.getState();button.textContent=!enabled?'🔇 音 OFF':unlocked?'🔊 音 ON':'🔊 音を有効にする';button.setAttribute?.('aria-pressed',String(enabled&&unlocked));}
/** 参加・撮影・ホスト操作を起点に再生許可を取得する。 */
async function unlockSound(){const unlocked=await soundPlayer.unlock();updateSoundButton();return unlocked;}
/** OFFは直ちに停止し、ON時は短いキラキラで確認する。 */
async function toggleSound(){const {enabled,unlocked}=soundPlayer.getState();if(enabled&&unlocked)soundPlayer.setEnabled(false);else{soundPlayer.setEnabled(true);if(await unlockSound())void soundPlayer.play('ready');}updateSoundButton();}
/** 自分の正解が確定した瞬間に報酬音を鳴らす。 */
function playSuccessSound(){void soundPlayer.play('success');}
/** 初回取得を基準にして、開始・締切後の結果・最終結果の変化を拾う。 */
function observeGameSounds(){if(!state)return;const pending=Number(state.stats.pending)>0,round=state.round;gameSounds.observe({roomId,roundId:round?.id,phase:pending&&round?.status!=='active'?'closing':state.game?.status==='finished'?'finished':round?.status==='active'?'active':round?'result':'lobby',ready:!!state.prepared,participants:isJoin?[]:state.players.map(player=>player.id)});}
/** 最後の5秒は各秒1回。本人の正解後は焦らせるカウント音を止める。 */
function tickGameSounds(){if(!state||isJoin&&!state.players.some(player=>player.id===playerId))return;const round=state.round,passed=isJoin&&state.mine?.some(item=>item.roundId===round?.id&&item.status==='accepted');const active=round?.status==='active'&&!passed;const lobby=!round&&state.lobby?.deadline;gameSounds.tick(active?`round:${round.id}`:lobby?`lobby:${roomId}`:null,active?Number(round.endsAt):Number(lobby),Date.now()+offset);}
/** 順位はイベント発生時の値を使わず、現在の共有スナップショットから求める。 */
function placementFor(player,submission){const finisher=state.finishers?.find(item=>item.playerId===player||(submission&&item.submissionId===submission));return finisher?.rank;}
/** 自分の確定した正解をカードで知らせる。撮影フォームやフォーカスは動かさない。 */
function celebrateOwn(submission){ownCelebrationSubmission=submission;const box=$('#own-celebration');if(!box)return;const rank=placementFor(playerId,submission.id),provisional=Number(state.stats.pending)>0,title=state.round?.mode==='demo'?'デモ成功！':'正解！';box.innerHTML=`<div><span class="celebration-symbol" aria-hidden="true">✦</span><p><strong>${title}</strong><span id="own-placement">${rank?`${provisional?'暫定':'いま'}${Number(rank)}位！`:'ランキングに反映しました'}</span></p></div>${reducedMotion()?'':`<div class="confetti" aria-hidden="true">${Array.from({length:8},(_,index)=>`<i></i>`).join('')}</div>`}`;box.hidden=false;box.classList.remove('rejected-feedback');box.classList.remove('celebrate');void box.offsetWidth;box.classList.add('celebrate');clearTimeout(ownCelebrationTimer);ownCelebrationTimer=setTimeout(()=>{box.hidden=true;},4000);playSuccessSound();}
/** 不正解の確定だけを短い低音と軽い色で通知し、通信エラーとは区別する。 */
function celebrateReject(submission){if(!isJoin)return;ownCelebrationSubmission=null;const box=$('#own-celebration');if(!box)return;box.classList.remove('celebrate');box.classList.add('rejected-feedback');box.innerHTML=`<div><span class="celebration-symbol" aria-hidden="true">↻</span><p><strong>もう一度！</strong><span>${esc(submission.verdict?.reason||'見本と似た実物を、はっきり撮影しよう。')}</span></p></div>`;box.hidden=false;clearTimeout(ownCelebrationTimer);ownCelebrationTimer=setTimeout(()=>{box.hidden=true;},2300);void soundPlayer.play('retry');}
/** 他の参加者は最新の1件と人数にまとめ、長い通知待ち列を作らない。 */
function showOtherPasses(events,{resetTimer=true,count=events.length}={}){currentCutins=events.slice(-1);currentCutinCount=count;const box=$('#live-cutins');if(!box||!events.length)return;const latest=events.at(-1),rank=placementFor(latest.playerId,latest.submissionId),provisional=Number(state.stats.pending)>0;box.innerHTML=`<span class="cutin-mark" aria-hidden="true">↗</span><strong>${esc(latest.name)}さんが${rank?`${provisional?'暫定':'いま'}${Number(rank)}位通過`:'クリア'}</strong>${count>1?`<small>ほか${count-1}人クリア</small>`:''}`;box.hidden=false;if(resetTimer){void soundPlayer.play(isJoin?'peer':'success');clearTimeout(cutinTimer);cutinTimer=setTimeout(()=>{box.hidden=true;currentCutins=[];if(isJoin)syncParticipantCamera();},2500);}}
/** DBの合格結果を監視し、イベント40件の上限から漏れた本人の結果も拾う。 */
function handleLiveResults(){
 const accepted=(state.mine||[]).filter(item=>item.status==='accepted');const rejected=(state.mine||[]).filter(item=>item.status==='rejected');
 const events=(state.events||[]).filter(event=>event.type==='pass'&&Number.isFinite(Number(event.id))).sort((a,b)=>Number(a.id)-Number(b.id));
 const cursor=Math.max(Number(state.eventCursor)||0,...events.map(event=>Number(event.id)),0);
 if(!resultsInitialized){for(const item of rejected)seenOwnRejected.add(item.id);for(const item of accepted)seenOwnAccepted.add(item.id);lastEventCursor=Math.max(cursor,Number(localStorage.getItem(`karimono:${roomId}:event-cursor`))||0);resultsInitialized=true;saveResultCursor();return;}
 const rejectedNew=rejected.filter(item=>!seenOwnRejected.has(item.id)&&item.roundId===state.round?.id);for(const item of rejected)seenOwnRejected.add(item.id);if(rejectedNew.length&&!document.hidden)celebrateReject(rejectedNew.at(-1));
 const ownNew=accepted.filter(item=>!seenOwnAccepted.has(item.id)&&item.roundId===state.round?.id);for(const item of accepted)seenOwnAccepted.add(item.id);if(pendingOwnCelebration?.roundId!==state.round?.id)pendingOwnCelebration=null;if(ownNew.length){const latest=ownNew.at(-1);if(document.hidden)pendingOwnCelebration=latest;else{pendingOwnCelebration=null;celebrateOwn(latest);}}else if(pendingOwnCelebration&&!document.hidden){const pending=pendingOwnCelebration;pendingOwnCelebration=null;celebrateOwn(pending);}else if(ownCelebrationSubmission&&isJoin&&!$('#own-celebration').hidden&&ownCelebrationSubmission.roundId!==state.round?.id){$('#own-celebration').hidden=true;}else if(ownCelebrationSubmission&&isJoin&&!$('#own-celebration').hidden){const rank=placementFor(playerId,ownCelebrationSubmission.id);$('#own-placement').textContent=rank?`${Number(state.stats.pending)>0?'暫定':'いま'}${Number(rank)}位！`:'ランキングに反映しました';}
 const others=events.filter(event=>Number(event.id)>lastEventCursor&&event.roundId===state.round?.id&&(event.playerId!==playerId||!isJoin));if(others.length)showOtherPasses(others);else if(currentCutins.length){const current=currentCutins.filter(event=>event.roundId===state.round?.id);if(current.length)showOtherPasses(current,{resetTimer:false,count:currentCutinCount});else{$('#live-cutins').hidden=true;currentCutins=[];}}
 lastEventCursor=Math.max(lastEventCursor,cursor);saveResultCursor();
}
/** 更新前の各行の位置だけを記録し、写真フォームは計測・変更しない。 */
function rankPositions(){return new Map([...document.querySelectorAll('#rank-list .rank-row')].map(row=>[row.dataset.playerId,row.getBoundingClientRect().top]));}
/** 順位が動いた行だけを最大12件アニメーションし、動きを減らす設定を守る。 */
function animateRankChanges(before){if(reducedMotion()||!before.size)return;let count=0;for(const row of document.querySelectorAll('#rank-list .rank-row')){const old=before.get(row.dataset.playerId);if(old===undefined)continue;const delta=old-row.getBoundingClientRect().top;if(Math.abs(delta)<1)continue;if(count++>=12)break;row.animate?.([{transform:`translateY(${Math.max(-32,Math.min(32,delta))}px)`,opacity:.72},{transform:'translateY(0)',opacity:1}],{duration:280,easing:'ease-out'});}}
/** 初回のロビーだけを判別し、以降のラウンド操作と分ける。 */
function isFirstLobby(){return !!state?.lobby&&state.lobby.status!=='started'&&!state.round;}
/** タイマーの進行と初回開始はサーバーに任せ、画面は受け取った時刻だけを表示する。 */
function updateLobby(){
 const box=$('#lobby-status');if(!box)return;const first=isFirstLobby();box.hidden=!first;if(!first)return;
 const lobby=state.lobby,players=state.stats.players,remaining=lobby.deadline==null?null:Math.max(0,Math.ceil((Number(lobby.deadline)-Date.now()-offset)/1000));
 const headline=$('#lobby-countdown'),detail=$('#lobby-detail');
 if(!players||lobby.status==='empty'){headline.textContent='最初の参加者を待っています';detail.textContent=lobby.autoStart===false?'QRを配布して参加者を集め、ホストが開始してください。':'1人目が参加すると、30秒後にゲームが始まります。';}
 else if(lobby.autoStart===false&&lobby.deadline==null){headline.textContent='ホストの開始を待っています';detail.textContent='参加できました。ホストが開始するまで、この画面でお待ちください。';}
 else if(lobby.status==='error'){headline.textContent='お題の準備を確認してください';detail.textContent=isJoin?'準備中にエラーが起きました。ホストの操作をお待ちください。':'準備中にエラーが起きました。「先にお題を準備」で再試行してください。';}
 else if(remaining!==null&&remaining>0){headline.textContent=`ゲーム開始まで ${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`;detail.textContent=state.prepared?'お題の準備ができました。みんなが集まるまでお待ちください。':state.mode==='ai'?'参考写真とお題を準備しています。みんなが集まるまでお待ちください。':'みんなが集まるまでお待ちください。';}
 else{headline.textContent=state.mode==='ai'?'参考写真とお題の準備中。完了後に開始':'お題の準備中。完了後に開始';detail.textContent='このままお待ちください。開始するとお題と残り時間が表示されます。';}
 if(!isJoin&&lobby.deadline!=null&&Number(lobby.deadline)<=Date.now()+offset)$('#start').disabled=true;
}
/** 初回のみ、今すぐ開始と時間追加を用意し、自動準備の失敗時は再試行を残す。 */
function hostLobbyControls(){
 const first=isFirstLobby(),extend=$('#extend-lobby');extend.hidden=!first||state?.lobby?.autoStart===false;if(!first)return;
 const noControl=!state.isHost||busy||!state.stats.players;
 const due=state.lobby.deadline!=null&&Number(state.lobby.deadline)<=Date.now()+offset;
 $('#start').disabled=noControl||due;$('#start').textContent=busy?'処理中…':'今すぐ開始 ↗';extend.disabled=noControl;
 $('#prepare').hidden=state.mode!=='ai'||!(state.preparationError||state.lobby.status==='error');
}
function tick(){updateLobby();tickGameSounds();document.querySelectorAll('.countdown').forEach(el=>{const sec=el.dataset.active==='true'?Math.max(0,Math.ceil((Number(el.dataset.ends)-Date.now()-offset)/1000)):0;el.textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;el.classList.toggle('urgent',sec>0&&sec<=20);});}
/** 共有をキャンセルした場合は通知せず、非対応環境では選択可能なURLを表示する。 */
async function shareLink(){if(!state?.joinUrl)return;const url=state.joinUrl;try{if(navigator.share){await navigator.share({title:`${state.room.name} | AI借り物競争`,text:'一緒にAI借り物競争で遊ぼう！',url});$('#share-status').textContent='参加リンクを共有しました。';return;}if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(url);$('#share-status').textContent='参加リンクをコピーしました。';return;}catch{}}$('#share-fallback').hidden=false;$('#share-url').value=url;$('#share-url').focus();$('#share-url').select();$('#share-status').textContent='上のリンクをコピーして送ってください。';}catch(e){if(e.name!=='AbortError'){ $('#share-fallback').hidden=false;$('#share-url').value=url;$('#share-status').textContent='共有できませんでした。上のリンクをコピーして送ってください。';}}}
/** 同じ部屋のQR画像だけを取得し、ファイル共有かダウンロードで渡す。 */
async function shareQR(){if(!state)return;const button=$('#share-qr');button.disabled=true;try{const response=await fetch(`${roomApi}/qr.png`);if(!response.ok)throw Error('QR画像を取得できません。再試行してください。');const blob=await response.blob();const file=new File([blob],`karimono-${roomId}-qr.png`,{type:'image/png'});if(navigator.canShare?.({files:[file]})&&navigator.share){await navigator.share({files:[file],title:`${state.room.name} の参加QR`});$('#share-status').textContent='QR画像を共有しました。';}else{const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);$('#share-status').textContent='QR画像を保存します。保存した画像を共有できます。';}}catch(e){if(e.name!=='AbortError')toast(e.message||'QR画像を共有できません。下の保存リンクをお試しください。');}finally{button.disabled=false;}}
/** 新しい部屋を作成し、サーバーが発行したホスト画面へ移動する。 */
function landing(){document.body.classList.add('landing');$('#connection').textContent='LET’S PLAY';$('#app').innerHTML=`<section class="hero landing-hero"><div><p class="eyebrow">YOUR PEOPLE. YOUR PLACE. YOUR RACE.</p><h1>AI借り物<span>競争</span><i>↗</i></h1><p class="hero-copy">ひらめきと、フットワーク。<br>会場ぜんぶが、プレイグラウンド。</p><div class="tags"><span>01 部屋をつくる</span><b>→</b><span>02 QRで集まる</span><b>→</b><span>03 探して撮る</span></div></div><div class="sticker" aria-hidden="true">FIND<br>YOUR<br><em>WIN!</em></div></section><div class="landing-grid"><section class="card create-room"><div class="section-heading"><span class="step">↗</span><h2>みんなの部屋をつくろう</h2></div><p class="create-intro">仲間が集まったら、準備はOK。<br>専用のQRをシェアして、レースを始めよう。</p><form id="create-room-form"><label>部屋の名前<input name="name" maxlength="60" required placeholder="例：ハッカソン会場のレース" autocomplete="off"></label><button class="button primary" type="submit">部屋を作成する <span>↗</span></button><p id="create-error" class="form-error" role="alert" hidden></p></form><p class="fineprint">作成したブラウザがホストになります。部屋の設定でプレイモードを確認できます。</p></section><section class="how-to"><p class="eyebrow">HOW TO PLAY</p><div><span>01</span><p><strong>QRで、全員集合。</strong>部屋のQRを読み取ってニックネームを登録。<br>参加コードの入力はいりません。</p></div><div><span>02</span><p><strong>お題を見て、探そう。</strong>実AIがお題と判定条件を会場に配信。<br>同じ種類や指定した色・形の実物を探して撮影。</p></div><div><span>03</span><p><strong>合格したら、即ランクイン。</strong>写真の判定後、受付時刻順でランキングに反映。<br>スピードも、ひらめきも、勝負のうち。</p></div></section></div><p class="landing-footnote">招待された方は、ホストから届いたQRまたは参加リンクを開いてください。</p>`;$('#create-room-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter,name=event.target.elements.name.value.trim();if(!name){event.target.elements.name.focus();return;}button.disabled=true;button.textContent='部屋をつくっています…';$('#create-error').hidden=true;try{const room=await api('/api/rooms',{name});const target=new URL(room.hostUrl,location.origin);if(target.origin!==location.origin)throw Error('部屋への移動先が不正です。再試行してください。');location.assign(target.pathname+target.search);}catch(e){$('#create-error').hidden=false;$('#create-error').textContent=e.message;button.disabled=false;button.innerHTML='部屋を作成する <span>↗</span>';}};}
soundPlayer.subscribe(updateSoundButton);
/** ボタンと折りたたみの操作に短い反応を返し、文字入力では鳴らさない。 */
document.addEventListener?.('click',event=>{const target=event.target?.closest?.('button,summary');if(!target||target.disabled||target.id==='sound-toggle')return;void unlockSound().then(unlocked=>{if(unlocked&&target.dataset?.camera!=='shutter')void soundPlayer.play('tap');});},true);
$('nav').innerHTML=`<a href="/">部屋を作成</a>${roomId?`<a href="/rooms/${roomId}/${isJoin?'host':'join'}">${isJoin?'ホスト画面':'参加する ↗'}</a>`:''}`;
if(isLanding){landing();}else{skeleton();document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});poll();setInterval(tick,250);}

