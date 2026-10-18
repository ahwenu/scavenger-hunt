/** Built Worker + local workerd/D1/R2. Explicit demo judgments only; never contacts a hosted Site. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..'), cloud = path.join(root, 'apps/cloud');
const require = createRequire(path.join(cloud, 'package.json'));
const { Miniflare } = require('miniflare'), sharp = require('sharp');
const report = { testedAt: new Date().toISOString(), environment: 'local workerd + D1 + R2',
  mode: 'demo', realAI: false, participants: 100, httpStatuses: {}, errors: [], success: false };
const serverRoot=path.join(cloud,'dist/server');
const workerFiles=(await readdir(serverRoot,{recursive:true})).filter(f=>/\.(?:m?js)$/.test(f)&&f!=='index.js');
const mf = new Miniflare({
  modulesRoot: serverRoot,
  modules: ['index.js',...workerFiles].map(file=>({type:'ESModule',path:path.join(serverRoot,file)})),
  compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
  d1Databases: { DB: 'issue1-local-validation' }, r2Buckets: ['BUCKET'], cf: false,
});
const latency = { join: [], state: [], submit: [], result: [] };
function summary(values) {
  const sorted = values.slice().sort((a,b) => a-b);
  return { count: sorted.length, p50: sorted[Math.max(0, Math.ceil(sorted.length * .5)-1)] ?? null,
    p95: sorted[Math.max(0, Math.ceil(sorted.length * .95)-1)] ?? null, max: sorted.at(-1) ?? null };
}
async function request(route, { method = 'GET', json, form, cookie, token, expected = 200, phase } = {}) {
  const started = performance.now();
  // Node's native FormData and Miniflare's undici may have different constructors.
  // Serialize multipart to standard wire bytes instead of passing a foreign FormData object.
  const encoded=form?new Request('https://local.test/',{method:'POST',body:form}):null;
  const formBytes=encoded?await encoded.arrayBuffer():undefined;
  const response = await mf.dispatchFetch(`https://local.test${route}`, { method,
    headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(encoded?{'Content-Type':encoded.headers.get('content-type')}:{}), ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(json ? { body: JSON.stringify(json) } : formBytes ? { body: formBytes } : {}),
  });
  report.httpStatuses[response.status] = (report.httpStatuses[response.status] || 0) + 1;
  if (phase) latency[phase].push(Math.round((performance.now() - started) * 100) / 100);
  const data = await response.json();
  assert.equal(response.status, expected, `${method} ${route}: HTTP ${response.status}: ${data.error||''}`);
  return { response, data };
}
try {
  const db = await mf.getD1Database('DB');
  for (const file of (await readdir(path.join(cloud, 'drizzle'))).filter(f=>f.endsWith('.sql')).sort()) {
    for (const sql of (await readFile(path.join(cloud, 'drizzle', file), 'utf8')).split('--> statement-breakpoint').filter(s=>s.trim())) await db.prepare(sql.trim()).run();
  }
  const { response, data: room } = await request('/api/rooms', { method: 'POST', json: { name: 'Issue #1 local 100-player test' }, expected: 201 });
  const api = `/api/rooms/${room.id}`, cookie = response.headers.get('set-cookie').split(';')[0];
  const players = await Promise.all(Array.from({length:100}, async (_,i) =>
    (await request(`${api}/join`, { method:'POST', json:{name:`fixture-${i}`}, expected:201, phase:'join' })).data));
  await request(`${api}/join`, { method:'POST', json:{name:'over-cap'}, expected:409 });
  const before = (await request(`${api}/state`, { token:players[0].token })).data;
  assert.equal(before.aiAvailable,false); assert.equal(before.mode,'demo');
  let start = await request(`${api}/host/start-now`, { method:'POST', cookie, expected: before.prepared ? 200 : 202 });
  let active;
  for(let i=0;i<150;i++) {
    active=(await request(`${api}/state`,{token:players[0].token})).data;
    if(active.round?.status==='active')break;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.equal(active.round?.mode,'demo');
  const roundId=active.round.id;
  await request(`${api}/host/hint`, {method:'POST',cookie,json:{roundId,text:'テスト用共通ヒント'}});
  await Promise.all(players.map(async p => {
    const state=(await request(`${api}/state`,{token:p.token,phase:'state'})).data;
    assert.equal(state.ranks.length,100); assert.equal(state.stages.length,10);
    assert.equal(state.mine.length,0);
  }));
  const photos=await Promise.all(players.map(()=>sharp(randomBytes(64*64*3),{raw:{width:64,height:64,channels:3}}).jpeg().toBuffer()));
  const submittedAt=performance.now();
  const receipts=await Promise.all(players.map(async(p,i)=>{
    const form=new FormData(); form.set('roundId',roundId); form.set('requestId',`burst-${i}`);form.set('demoResult','pass');
    form.set('photo',new Blob([photos[i]],{type:'image/jpeg'}),'fixture.jpg');
    return (await request(`${api}/submit`,{method:'POST',token:p.token,form,expected:202,phase:'submit'})).data;
  }));
  let final;
  for(let attempt=0;attempt<240;attempt++) {
    final=(await request(`${api}/state`,{token:players[0].token})).data;
    if(final.stats.accepted===100&&final.stats.pending===0)break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  const states=await Promise.all(players.map(p=>request(`${api}/state`,{token:p.token,phase:'result'})));
  states.forEach(({data},i)=>{
    assert.equal(data.mine.length,1); assert.equal(data.mine[0].id,receipts[i].id);
    assert.equal(data.mine[0].status,'accepted'); assert.equal(data.mine[0].awardedPoints,500);
    assert.ok(data.ranks.every(r=>r.score===500&&r.wins===1));
    assert.deepEqual(data.ranks.map(r=>r.rank),Array.from({length:100},(_,j)=>j+1));
    assert.equal(data.stats.accepted,100);assert.equal(data.stats.pending,0);
  });
  report.completedPlayers=100; report.burstToAllResultsMs=Math.round(performance.now()-submittedAt);
  report.photoBytes={count:100,total:photos.reduce((sum,b)=>sum+b.length,0)};
  report.latencyMs=Object.fromEntries(Object.entries(latency).map(([name,values])=>[name,summary(values)]));
  report.unexpected429=report.httpStatuses[429]||0;
  report.serverErrors=Object.entries(report.httpStatuses).filter(([code])=>Number(code)>=500).reduce((sum,[,n])=>sum+n,0);
  const eventCount=await db.prepare('SELECT COUNT(*) AS n FROM pass_events').first();
  assert.equal(eventCount.n,100);report.passEvents=eventCount.n;
  const hints=await Promise.all(players.map(p=>request(`${api}/hint?roundId=${roundId}`,{token:p.token})));
  assert.ok(hints.every(({data})=>data.text==='テスト用共通ヒント'&&data.available));
  report.sharedHintReads=100; report.success=true;
} catch(error) { report.errors.push(error.message); process.exitCode=1; }
finally {
  await mf.dispose();
  await mkdir(path.join(root,'.sites-runtime'),{recursive:true});
  await writeFile(path.join(root,'.sites-runtime/issue1-local-verification.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}
