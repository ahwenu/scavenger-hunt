import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {randomUUID,createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),base=process.env.TARGET_BASE_URL||'https://ai-karimono-race.ahwenu.chatgpt.site';
const report={testedAt:new Date().toISOString(),target:base,mode:'ai',paidCallsExpected:{agents:1,decisions:2},authentication:'Anonymous HTTP, room host cookie and participant token only',errors:[]};
let cookie='',token='',prefix='';
/** Retain room credentials in memory and return only bounded API outcomes. */
async function api(route,body,host=false,expected){const start=performance.now();const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...(host&&cookie?{Cookie:cookie}:{}),...(!host&&token?{Authorization:`Bearer ${token}`}:{ }),...(body!==undefined&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});const data=await r.json();if(r.headers.get('set-cookie')?.includes('host_'))cookie=r.headers.get('set-cookie').split(';')[0];if(expected?r.status!==expected:!r.ok)throw Error(`${route}: HTTP${r.status}: ${data.error||'request_failed'}`);return {data,status:r.status,elapsedMs:Math.round(performance.now()-start)};}
/** Observe an authoritative final verdict, including its durable pass event. */
async function submit(bytes,label){const s=(await api(prefix+'/state')).data;const f=new FormData();f.set('photo',new Blob([bytes],{type:'image/jpeg'}),label+'.jpg');f.set('roundId',s.round.id);f.set('requestId',randomUUID());const receipt=await api(prefix+'/submit',f);const at=performance.now();for(let i=0;i<50;i++){const state=(await api(prefix+'/state')).data,mine=state.mine.find(x=>x.id===receipt.data.id);if(mine&&!['queued','processing','uploading','retrying','pending'].includes(mine.status))return {receipt:{httpStatus:receipt.status,elapsedMs:receipt.elapsedMs},status:mine.status,verdict:mine.verdict,passEventId:mine.passEventId,events:state.events.filter(x=>x.submissionId===mine.id),observedAfterAckMs:Math.round(performance.now()-at)};await new Promise(r=>setTimeout(r,1000));}throw Error('judgment_timeout');}
try{
 const created=await api('/api/rooms',{name:'参考写真・公開実AI検証'});prefix='/api/rooms/'+created.data.id;report.roomId=created.data.id;
 await api(prefix+'/host/mode',{mode:'ai'},true);
 const joined=await api(prefix+'/join',{name:'実写真検証',profile:'持参している実物は黄色いバナナの房のみです。黄色いバナナの房を撮影できます。'});token=joined.data.token;
 const began=performance.now();let started;
 for(let i=0;i<65;i++){const state=(await api(prefix+'/state')).data;if(!state.round&&JSON.stringify(state).includes('upload.wikimedia.org'))throw Error('reference_leaked_before_start');if(state.preparationError)throw Error(state.preparationError);if(state.round){started=state;break;}await new Promise(r=>setTimeout(r,700));}
 if(!started)throw Error('auto_start_timeout');report.autoStartObservedMs=Math.round(performance.now()-began);report.challenge=started.round.challenge;report.preStartReferenceHidden=true;
 const trace=(await api(prefix+'/host/reference-trace',undefined,true)).data;report.toolTrace=trace;
 const ref=report.challenge.reference;if(!ref?.url)throw Error('missing_reference');
 const response=await fetch(base+ref.url),bytes=Buffer.from(await response.arrayBuffer());if(!response.ok)throw Error('reference_unavailable');report.referenceDownload={status:response.status,bytes:bytes.length,mime:response.headers.get('content-type'),cacheControl:response.headers.get('cache-control'),sha256:createHash('sha256').update(bytes).digest('hex')};
 const burstAt=performance.now();const fetched=await Promise.all(Array.from({length:70},async()=>{const r=await fetch(base+ref.url);return {status:r.status,bytes:(await r.arrayBuffer()).byteLength};}));report.reference70={count:fetched.length,allOK:fetched.every(x=>x.status===200&&x.bytes===bytes.length),elapsedMs:Math.round(performance.now()-burstAt)};
 const form=new FormData();form.set('photo',new Blob([bytes],{type:ref.mime}),'reference.jpg');form.set('roundId',started.round.id);form.set('requestId',randomUUID());report.exactCopy=(await api(prefix+'/submit',form,false,409)).status;
 const copy=await sharp(bytes).resize({width:850}).jpeg({quality:69}).toBuffer();report.reencodedCopy=await submit(copy,'reference-reencoded');if(report.reencodedCopy.status!=='rejected')throw Error('reference_reproduction_not_rejected');
 const banana=await sharp(await fs.readFile(path.join(root,'test-assets/banana.png'))).resize({width:960,height:960,fit:'inside'}).jpeg({quality:75}).toBuffer();report.submittedPhoto={source:'https://commons.wikimedia.org/wiki/File:Banana.png',author:'Mark Schellhase',license:'Public domain',bytes:banana.length,changes:'max960 JPEG75 EXIF stripped',fixture:'A separate physical-object photograph; no claim of fresh user capture'};
 report.realObject=await submit(banana,'separate-banana');report.success=report.realObject.status==='accepted'&&!!report.realObject.passEventId&&report.reference70.allOK;
 if(!report.success)report.errors.push('Separate real-object fixture did not yield an accepted durable event; inspect criterion results without overriding.');
}catch(e){report.errors.push(e.message);report.success=false;if(prefix)try{report.diagnostic=(await api(prefix+'/host/preparation-diagnostics',undefined,true)).data;}catch{}}
finally{if(prefix)try{await api(prefix+'/host/end',{},true);}catch{}}
await fs.writeFile(path.join(root,'docs/public-reference-smoke.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.success)process.exitCode=1;
