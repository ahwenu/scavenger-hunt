/** 明示的なカメラ許可から、シャッター1回で即送信する参加者用ビュー。 */
export function createLiveCamera(root,options={}){
  const doc=options.document||root.ownerDocument||globalThis.document;
  const win=options.window||doc.defaultView||globalThis.window;
  const nav=options.navigator||globalThis.navigator;
  const media=options.mediaDevices||nav?.mediaDevices;
  const now=options.now||Date.now;
  const imageDecoders=new Set();
  let stream=null,disposed=false,cameraStatus='off',status='ready',model={},roundId=null,mediaEpoch=0,captureEpoch=0;
  let operation=false,localPending=false,localAccepted=false,serverOffset=0,notice='',reference='';
  root.classList.add('live-camera');
  root.innerHTML=`<section class="live-camera-shell" aria-label="ライブカメラで参加"><div class="live-camera-topline"><span>LIVE / YOUR CAMERA</span><button type="button" data-camera="pause" class="live-camera-pause" hidden>カメラを休止</button></div><div class="live-camera-stage"><video data-camera="video" autoplay muted playsinline aria-label="送信前のライブ映像"></video><div class="live-camera-shade"></div><div class="live-camera-target"><img data-camera="reference" alt="探すものの見本" hidden><div><span class="live-camera-target-label">FIND THIS</span><strong data-camera="title">カメラを準備して待とう</strong></div><span data-camera="timer" class="live-camera-timer"></span></div><div class="live-camera-permission" data-camera="permission"><span class="live-camera-lens" aria-hidden="true">◎</span><h3 data-camera="permission-title">見つけた瞬間、撮ろう。</h3><p data-camera="permission-copy">カメラを許可すると、ここに映像が表示されます。<br>シャッターを押すまで写真は送信しません。</p><button type="button" data-camera="enable" class="live-camera-enable">カメラを許可して待機 ↗</button></div><div data-camera="cutin" class="live-camera-cutin" role="status" aria-live="polite" hidden></div><div class="live-camera-own"><span data-camera="status" class="live-camera-status" role="status" aria-live="polite">準備OK</span><p data-camera="message"></p></div><div class="live-camera-controls"><span class="live-camera-controls-spacer" aria-hidden="true"></span><button type="button" data-camera="shutter" class="live-camera-shutter" aria-label="撮影してすぐに送信" disabled><span aria-hidden="true"></span></button><button type="button" data-camera="fallback" class="live-camera-fallback">端末の<br>カメラを使う</button></div></div><p class="live-camera-note">シャッター1回で撮影・送信。見本と似た実物を、画面いっぱいに。</p><input data-camera="file" class="live-camera-file" type="file" accept="image/*" capture="environment" hidden></section>`;
  const el=name=>root.querySelector(`[data-camera="${name}"]`);
  const video=el('video');video.muted=true;video.playsInline=true;
  const labels={ready:'READY',capturing:'撮影中…',sending:'送信中…',queued:'受付完了 · 順番待ち',judging:'AIが判定中…',pass:'✓ 正解！',reject:'もう一度、チャレンジ',error:'送信できませんでした'};
  /** 有効な同一オリジンの見本URLだけを表示する。 */
  function safeReference(raw){if(typeof raw!=='string'||!raw)return '';try{const u=new URL(raw,win.location.href);return u.origin===win.location.origin&&['http:','https:'].includes(u.protocol)?u.href:'';}catch{return '';}}
  /** いまのお題と判定状態から、連打・受付終了後の送信を防ぐ。 */
  function canSubmit(){const round=model.round;return !disposed&&!!roundId&&round?.status==='active'&&(!round.endsAt||now()+serverOffset<round.endsAt)&&!operation&&!localPending&&!model.pending&&!localAccepted&&!model.accepted;}
  /** 機器状態と公開ゲーム状態だけを外へ返す。 */
  function getState(){return {cameraStatus,status,roundId,pending:!!(operation||localPending||model.pending),accepted:!!(localAccepted||model.accepted),canCapture:canSubmit()&&cameraStatus==='live'};}
  /** 取得済みの全トラックを止め、見えないバックグラウンド撮影を残さない。 */
  function stopTracks(){for(const track of stream?.getTracks?.()||[])track.stop();stream=null;video.srcObject=null;}
  /** ロビー・ゲーム・撮影状態を映像の周囲へ反映する。 */
  function render(){
    if(disposed)return;
    const round=model.round,active=round?.status==='active',live=cameraStatus==='live';
    root.dataset.cameraState=cameraStatus;root.dataset.captureState=status;
    el('permission').hidden=live;el('pause').hidden=!live&&cameraStatus!=='requesting';el('pause').textContent=cameraStatus==='requesting'?'後で · 許可待ちを中止':'カメラを休止';
    el('shutter').disabled=!canSubmit()||!live;
    el('fallback').disabled=!canSubmit();el('enable').disabled=cameraStatus==='requesting';
    el('title').textContent=round?.challenge?.title|| (model.lobby?.status==='preparing'?'お題を準備しています': 'お題が出たら、すぐ探そう');
    el('status').textContent=labels[status]||labels.ready;
    let message=notice||model.ownStatus||'';
    if(!message&&localAccepted)message='ナイス発見！ 次のお題まで、そのまま待とう。';
    if(!message&&!active)message='映像を見ながら待機できます。お題が出たら撮影しよう。';
    if(!message&&active&&status==='ready')message='真ん中のシャッターで撮影 → そのまま送信';
    el('message').textContent=typeof message==='string'?message:'';
    if(cameraStatus==='requesting'){el('permission-title').textContent='カメラの許可を待っています';el('permission-copy').textContent='ブラウザに表示されたカメラの確認を選んでください。';el('enable').textContent='許可を確認中…';}
    else if(cameraStatus==='denied'){el('permission-title').textContent='カメラの許可を確認しよう';el('permission-copy').textContent='ブラウザの設定でカメラを許可してから、もう一度お試しください。端末のカメラから送信することもできます。';el('enable').textContent='もう一度カメラを開く ↗';}
    else if(cameraStatus==='unavailable'){el('permission-title').textContent='端末のカメラで参加できます';el('permission-copy').textContent='ライブ映像を開けませんでした。お題が出たら「端末のカメラを使う」を選んでください。';el('enable').textContent='ライブカメラを再試行 ↗';}
    else if(cameraStatus==='paused'){el('permission-title').textContent='カメラを休止しました';el('permission-copy').textContent='映像を再開するには、下のボタンを押してください。';el('enable').textContent='カメラを再開する ↗';}
    else if(cameraStatus==='error'){el('permission-title').textContent='カメラを開けませんでした';el('permission-copy').textContent='ほかのアプリでカメラを使っていないか確認して再試行してください。';el('enable').textContent='もう一度カメラを開く ↗';}
    else{el('permission-title').textContent='見つけた瞬間、撮ろう。';el('permission-copy').textContent='カメラを許可すると、ここに映像が表示されます。シャッターを押すまで写真は送信しません。';el('enable').textContent='カメラを許可して待機 ↗';}
    const raw=model.referenceUrl||round?.challenge?.reference?.imageUrl||'';const next=safeReference(raw);
    if(next!==reference){reference=next;if(next)el('reference').src=next;else el('reference').removeAttribute('src');}el('reference').hidden=!next;
    const pass=model.latestPass;const cutin=typeof pass==='string'?pass:pass?.playerName?`${pass.playerName} さんが正解！`:pass?.name?`${pass.name} さんが正解！`:'';
    el('cutin').hidden=!cutin;el('cutin').textContent=cutin;
    tick();
  }
  /** 時計は補正済みのサーバー時刻を使い、終了時にシャッターを無効化する。 */
  function tick(){if(disposed)return;const end=model.round?.status==='active'?model.round.endsAt:model.lobby?.deadline||model.lobby?.endsAt;const seconds=end?Math.max(0,Math.ceil((end-now()-serverOffset)/1000)):null;el('timer').textContent=seconds===null?'':`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;if(seconds===0)el('shutter').disabled=true;}
  /** ユーザー操作だけで背面カメラの許可を要求する。 */
  async function enable(){
    if(disposed||cameraStatus==='requesting')return;
    options.onGesture?.();const epoch=++mediaEpoch;
    stopTracks();
    if(win?.isSecureContext===false||!media?.getUserMedia){cameraStatus='unavailable';render();return;}
    cameraStatus='requesting';render();
    try{
      const acquired=await media.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:960}}});
      if(disposed||epoch!==mediaEpoch){for(const track of acquired.getTracks?.()||[])track.stop();return;}
      stream=acquired;video.srcObject=stream;
      for(const track of stream.getVideoTracks?.()||[])track.addEventListener?.('ended',()=>{if(!disposed&&stream===acquired){pause();notice='カメラが停止しました。再開ボタンで戻れます。';render();}},{once:true});
      await video.play();if(disposed||epoch!==mediaEpoch){stopTracks();return;}cameraStatus='live';notice='';render();
    }catch(error){if(disposed||epoch!==mediaEpoch)return;stopTracks();cameraStatus=['NotAllowedError','PermissionDeniedError','SecurityError'].includes(error?.name)?'denied':['NotFoundError','DevicesNotFoundError','OverconstrainedError'].includes(error?.name)?'unavailable':'error';render();}
  }
  /** 一時停止後は勝手に再要求せず、明示操作による再開を待つ。 */
  function pause(){if(disposed)return;++mediaEpoch;if(operation&&status==='capturing'){++captureEpoch;operation=false;status='ready';notice='';}stopTracks();cameraStatus='paused';render();}
  /** JPEGを960px以下・1MB以下に収める。 */
  async function jpegFrom(source,width,height,crop=null){
    if(!width||!height)throw Error('映像の準備中です。少し待ってもう一度撮影してください。');
    const outputWidth=crop?.width||width,outputHeight=crop?.height||height;
    const canvas=doc.createElement('canvas');let scale=Math.min(1,960/Math.max(outputWidth,outputHeight)),blob;
    for(let attempt=0;attempt<4;attempt++){
      canvas.width=Math.max(1,Math.round(outputWidth*scale));canvas.height=Math.max(1,Math.round(outputHeight*scale));const context=canvas.getContext('2d');if(!context)throw Error('このブラウザでは撮影できません。端末のカメラを使ってください。');if(crop)context.drawImage(source,crop.x,crop.y,crop.width,crop.height,0,0,canvas.width,canvas.height);else context.drawImage(source,0,0,canvas.width,canvas.height);
      blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',[.82,.7,.55,.4][attempt]));
      if(blob&&blob.size<=1048576)return blob;scale*=.8;
    }
    throw Error('写真を送れるサイズにできませんでした。もう一度撮影してください。');
  }
  /** 圧縮が終わった瞬間に送信コールバックを一度だけ実行する。 */
  async function deliver(blob,source,epoch,capturedRound){
    if(disposed||epoch!==captureEpoch||capturedRound!==roundId)return;
    if(model.round?.status!=='active'||(model.round.endsAt&&now()+serverOffset>=model.round.endsAt))throw Error('このお題の受付は終了しました。次のお題を待ってください。');
    const FileClass=options.File||globalThis.File;const file=FileClass?new FileClass([blob],`karimono-${now()}.jpg`,{type:'image/jpeg'}):blob;
    status='sending';render();const callback=source==='file-fallback'?(options.onFallback||options.onCapture):options.onCapture;
    if(typeof callback!=='function')throw Error('送信の準備ができていません。画面を再読み込みしてください。');
    const result=await callback(file,{roundId:capturedRound,source});
    if(disposed||epoch!==captureEpoch||capturedRound!==roundId)return;
    status=result?.status||'queued';if(status==='accepted')status='pass';if(status==='rejected')status='reject';if(status==='processing')status='judging';if(status==='pending')status='queued';
    if(!Object.hasOwn(labels,status))status='queued';
    localPending=['queued','judging','sending'].includes(status);localAccepted=status==='pass';notice=typeof result?.message==='string'?result.message:'';
  }
  /** シャッターを1回押すと現在の映像を撮影し、そのまま送信する。 */
  async function capture(){
    if(!canSubmit()||cameraStatus!=='live')return;
    options.onGesture?.();options.onShutter?.();const epoch=++captureEpoch,capturedRound=roundId;operation=true;status='capturing';notice='';render();
    try{
      const width=video.videoWidth,height=video.videoHeight,viewWidth=video.clientWidth,viewHeight=video.clientHeight;let crop=null;
      // object-fit:cover / object-position:center と同じ領域を、回転後も毎回計算する。
      if(width>0&&height>0&&viewWidth>0&&viewHeight>0){
        const viewRatio=viewWidth/viewHeight,sourceRatio=width/height;
        const cropWidth=sourceRatio>viewRatio?height*viewRatio:width,cropHeight=sourceRatio>viewRatio?height:width/viewRatio;
        crop={x:(width-cropWidth)/2,y:(height-cropHeight)/2,width:cropWidth,height:cropHeight};
      }
      const blob=await jpegFrom(video,width,height,crop);await deliver(blob,'live-camera',epoch,capturedRound);
    }
    catch(error){if(epoch===captureEpoch&&!disposed){status='error';localPending=false;notice=error?.message||'撮影に失敗しました。もう一度お試しください。';}}
    finally{if(epoch===captureEpoch){operation=false;render();}}
  }
  /** Safariなどのbitmap未対応・復号失敗時も、画像要素で開いて必ず再圧縮する。 */
  function decodeFallbackImage(file){
    return new Promise((resolve,reject)=>{
      const ImageClass=options.Image||win?.Image||globalThis.Image,urls=options.URL||win?.URL||globalThis.URL;
      if(!ImageClass||!urls?.createObjectURL)throw Error('この写真を開けません。JPEG・PNGで撮影し直してください。');
      const image=new ImageClass(),url=urls.createObjectURL(file);let settled=false,released=false,urlReleased=false;
      const entry={cancel:()=>{release();if(!settled){settled=true;reject(Error('写真の読み込みを中止しました。'));}}};
      /** 画像表示後の圧縮・読み込み失敗・破棄の全経路でObjectURLを解放する。 */
      function revoke(){if(!urlReleased){urlReleased=true;urls.revokeObjectURL(url);}}
      function release(){if(released)return;released=true;image.onload=null;image.onerror=null;revoke();image.removeAttribute?.('src');imageDecoders.delete(entry);}
      imageDecoders.add(entry);
      image.onload=()=>{if(settled)return;settled=true;revoke();if(disposed){release();reject(Error('写真の読み込みを中止しました。'));return;}resolve({image,width:image.naturalWidth||image.width,height:image.naturalHeight||image.height,release});};
      image.onerror=()=>{if(settled)return;settled=true;release();reject(Error('この写真を読み込めません。JPEG・PNGで撮影し直してください。'));};
      try{image.src=url;}catch{entry.cancel();}
    });
  }
  /** ライブ映像を使えない端末でも、EXIF等を残さず圧縮した写真だけを直ちに送信する。 */
  async function fallbackChanged(){
    const file=el('file').files?.[0];el('file').value='';if(!file||!canSubmit())return;
    options.onGesture?.();options.onShutter?.();const epoch=++captureEpoch,capturedRound=roundId;operation=true;status='capturing';notice='';render();let bitmap,decoded;
    try{
      if(file.size>20*1024*1024)throw Error('写真が大きすぎます。カメラの画質を下げてください。');
      const createBitmap=options.createImageBitmap||globalThis.createImageBitmap;
      if(createBitmap){try{bitmap=await createBitmap(file,{imageOrientation:'from-image'});}catch{ /* Safari等では画像要素のデコーダーを試す。 */ }}
      if(disposed||epoch!==captureEpoch)return;
      if(bitmap){const blob=await jpegFrom(bitmap,bitmap.width,bitmap.height);await deliver(blob,'file-fallback',epoch,capturedRound);}
      else{decoded=await decodeFallbackImage(file);if(disposed||epoch!==captureEpoch)return;const blob=await jpegFrom(decoded.image,decoded.width,decoded.height);await deliver(blob,'file-fallback',epoch,capturedRound);}
    }catch(error){if(epoch===captureEpoch&&!disposed){status='error';localPending=false;notice=error?.message||'写真を読み込めませんでした。';}}
    finally{bitmap?.close?.();decoded?.release();if(epoch===captureEpoch){operation=false;render();}}
  }
  /** 外部状態の更新でラウンドを切り替え、古い撮影の遅い完了を無視する。 */
  function update(next={}){
    if(disposed)return;const nextRound=next.round===undefined?model.round:next.round,nextId=nextRound?.id||null;
    if(nextId!==roundId){++captureEpoch;roundId=nextId;operation=false;localPending=false;localAccepted=false;status='ready';notice='';}
    if(!operation&&typeof next.ownStatus==='string'&&next.ownStatus)notice='';
    model={...model,...next};if(Number.isFinite(next.serverTime))serverOffset=next.serverTime-now();
    if(next.accepted){localAccepted=true;localPending=false;status='pass';}
    else if(typeof next.status==='string'&&!operation){const mapped={accepted:'pass',rejected:'reject',processing:'judging',pending:'queued',uploading:'sending'};status=mapped[next.status]||next.status;if(!Object.hasOwn(labels,status))status='ready';localPending=['queued','judging','sending'].includes(status);if(status==='pass')localAccepted=true;}
    else if(next.pending&&!operation){localPending=true;if(!['queued','judging','sending'].includes(status))status='queued';}
    else if(next.pending===false&&!operation){localPending=false;if(['queued','judging','sending'].includes(status)&&!localAccepted)status='ready';}
    render();
  }
  /** 画面を離れたときにカメラを止め、戻っても自動で許可を要求しない。 */
  const pagehide=()=>pause(),visibility=()=>{if(doc.visibilityState==='hidden')pause();},pageshow=()=>{if(cameraStatus==='live'&&!stream)pause();};
  el('enable').addEventListener('click',enable);el('pause').addEventListener('click',pause);el('shutter').addEventListener('click',capture);el('fallback').addEventListener('click',()=>{if(canSubmit()){options.onGesture?.();el('file').click();}});el('file').addEventListener('change',fallbackChanged);
  win?.addEventListener('pagehide',pagehide);win?.addEventListener('pageshow',pageshow);doc.addEventListener('visibilitychange',visibility);
  const timer=win?.setInterval?.(tick,250);
  render();
  /** 取り外し時はトラック、時計、イベントを破棄する。 */
  function destroy(){if(disposed)return;disposed=true;++mediaEpoch;++captureEpoch;for(const decoder of [...imageDecoders])decoder.cancel();stopTracks();if(timer!==undefined)win?.clearInterval?.(timer);win?.removeEventListener('pagehide',pagehide);win?.removeEventListener('pageshow',pageshow);doc.removeEventListener('visibilitychange',visibility);root.innerHTML='';}
  return {update,enable,capture,pause,resume:enable,destroy,getState};
}
