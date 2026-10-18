import fs from 'node:fs/promises';
import path from 'node:path';
const base=process.env.TARGET_BASE_URL||'https://ai-karimono-race.ahwenu.chatgpt.site';
const report={testedAt:new Date().toISOString(),target:base,mode:'ai',platformAuthentication:'none',paidCallsExpected:{agents:1,decisions:0},errors:[]};
let cookie='';
/** Use only this fresh game's host cookie, never platform authentication. */
async function api(route,body,host=false){const start=performance.now();const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...(host?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});const data=await response.json();if(response.headers.get('set-cookie')?.includes('host_'))cookie=response.headers.get('set-cookie').split(';')[0];if(!response.ok)throw Error(`HTTP${response.status}: ${data.error||'failed'}`);return {data,status:response.status,elapsedMs:Math.round(performance.now()-start)};}
try{
 const room=await api('/api/rooms',{name:'お題準備の実AI検証'});report.roomId=room.data.id;const prefix='/api/rooms/'+room.data.id;
 await api(prefix+'/join',{name:'準備検証',profile:'机の上に丸いコースターとペンがあります。'});
 await api(prefix+'/host/mode',{mode:'ai'},true);
 const since=performance.now();const prepared=await api(prefix+'/host/prepare',{},true);report.prepareReceipt={httpStatus:prepared.status,elapsedMs:prepared.elapsedMs};
 let ready=false;
 for(let i=0;i<30;i++){const state=(await api(prefix+'/state',undefined,true)).data;if(state.round)throw Error('Premature round reveal');if(state.prepared){ready=true;break;}if(state.preparationError)throw Error(state.preparationError);await new Promise(r=>setTimeout(r,1000));}
 if(!ready)throw Error('Preparation observation deadline');report.preparationObservedMs=Math.round(performance.now()-since);report.taskHiddenUntilStart=true;
 const start=await api(prefix+'/host/start',{},true);report.startReceipt={elapsedMs:start.elapsedMs,usedPrepared:start.data.usedPrepared};
 const revealed=(await api(prefix+'/state',undefined,true)).data;report.challenge=revealed.round?.challenge;report.preparedConsumed=!revealed.prepared;report.success=start.data.usedPrepared===true&&revealed.round?.status==='active';
 await api(prefix+'/host/end',{},true);
}catch(error){report.errors.push(error.message);report.success=false;}
await fs.writeFile(path.resolve(import.meta.dirname,'../docs/public-prepare-ai.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.success)process.exitCode=1;
