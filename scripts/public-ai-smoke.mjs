import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {createHash,randomUUID} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),base=process.env.TARGET_BASE_URL||'https://ai-karimono-race.ahwenu.chatgpt.site';
const report={testedAt:new Date().toISOString(),target:base,mode:'ai',paidCallsExpected:{agents:1,decisions:1},errors:[]};
let cookie='',token='';
/** Keep browser credentials in memory only; record only non-secret outcomes. */
async function api(route,body,host=false){const start=performance.now();const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...(host&&cookie?{Cookie:cookie}:{}),...(!host&&token?{Authorization:`Bearer ${token}`}:{ }),...(body!==undefined&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});const data=await r.json();if(r.headers.get('set-cookie')?.includes('host_'))cookie=r.headers.get('set-cookie').split(';')[0];if(!r.ok)throw Error(`${route}: HTTP${r.status}: ${data.error||'request_failed'}`);return {data,status:r.status,elapsedMs:Math.round(performance.now()-start)};}
try{
 const created=await api('/api/rooms',{name:'実AIの公開接続確認'});const prefix='/api/rooms/'+created.data.id;report.roomId=created.data.id;
 const joined=await api(prefix+'/join',{name:'実写真検証',profile:'持参品は黄色いバナナの房です。撮影できる実物として黄色いバナナの房があります。'});token=joined.data.token;
 await api(prefix+'/host/mode',{mode:'ai'},true);
 const started=await api(prefix+'/host/start',{},true);report.generationMs=started.elapsedMs;
 const state=(await api(prefix+'/state')).data;report.challenge=state.round.challenge;
 const bytes=await sharp(await fs.readFile(path.join(root,'test-assets/banana.png'))).resize({width:960,height:960,fit:'inside'}).jpeg({quality:75}).toBuffer();
 report.photo={source:'https://commons.wikimedia.org/wiki/File:Banana.png',author:'Mark Schellhase',license:'Public domain',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),changes:'resize max960 JPEG75 EXIF stripped'};
 const form=new FormData();form.set('photo',new Blob([bytes],{type:'image/jpeg'}),'banana.jpg');form.set('roundId',state.round.id);form.set('requestId',randomUUID());
 const receipt=await api(prefix+'/submit',form);report.receipt={httpStatus:receipt.status,elapsedMs:receipt.elapsedMs,status:receipt.data.status};
 const observed=performance.now();
 for(let i=0;i<35;i++){const s=(await api(prefix+'/state')).data;const mine=s.mine.find(x=>x.id===receipt.data.id);if(mine&&!['pending','queued','processing','uploading','retrying'].includes(mine.status)){report.result={status:mine.status,verdict:mine.verdict,observedAfterAckMs:Math.round(performance.now()-observed)};report.ranking=s.ranks.map(x=>({name:x.name,wins:x.wins,totalMs:x.totalMs}));break;}await new Promise(r=>setTimeout(r,1000));}
 if(!report.result)throw Error('Judgment observation deadline');
 await api(prefix+'/host/end',{},true);report.success=['accepted','rejected'].includes(report.result.status);
}catch(error){report.errors.push(error.message);report.success=false;}
await fs.writeFile(path.join(root,'docs/public-ai-smoke.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(!report.success)process.exitCode=1;
