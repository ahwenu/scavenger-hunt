import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createReferenceTools,searchReferencePhotos,inspectImage} from '../apps/shared/reference-agent.mjs';
const photo=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1cAAAAASUVORK5CYII=','base64'));
/** Commonsの署名・ライセンス・URL処理をネットワークなしで再現する。 */
function page(overrides={}){return {pageid:42,title:'File:Yellow banana photograph.png',imageinfo:[{mime:'image/png',width:1000,height:1000,thumburl:'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Banana.png/640px-Banana.png',descriptionurl:'https://commons.wikimedia.org/wiki/File:Banana.png',extmetadata:{LicenseShortName:{value:'CC BY 4.0'},LicenseUrl:{value:'https://creativecommons.org/licenses/by/4.0'},Copyrighted:{value:'True'},Artist:{value:'<b>Alice</b>'},Categories:{value:'Photographs of bananas'},ImageDescription:{value:'A real yellow banana photograph'}},...overrides}]};}
/** リダイレクト禁止設定を含めて記録する制御済みfetch。 */
function transport(pages=[page()],imageResponse){const calls=[];return {calls,fetchImpl:async(url,options)=>{calls.push({url,options});if(new URL(url).hostname==='commons.wikimedia.org')return Response.json({query:{pages:Object.fromEntries(pages.map((p,i)=>[i,p]))}});return imageResponse?imageResponse():new Response(photo,{headers:{'Content-Type':'image/png'}});}};}

test('reference tools reject unknown IDs, non-English/oversized queries and exhausted call budgets',async()=>{
  const t=transport(),tools=createReferenceTools({fetchImpl:t.fetchImpl});
  await assert.rejects(()=>tools.execute('get_reference_photo',{candidateId:'https://evil.test/image'}),/reference_unknown_candidate/);assert.equal(t.calls.length,0);
  await assert.rejects(()=>searchReferencePhotos('バナナ',{fetchImpl:t.fetchImpl}),/reference_query_invalid/);
  await assert.rejects(()=>searchReferencePhotos('a'.repeat(121),{fetchImpl:t.fetchImpl}),/reference_query_invalid/);
  const searched=JSON.parse(await tools.execute('search_reference_photos',{queryEnglish:'banana fruit'}));assert.equal(searched.candidates.length,1);assert.equal(searched.candidates[0].author,'Alice');
  await tools.execute('search_reference_photos',{queryEnglish:'banana fruit'});
  await assert.rejects(()=>tools.execute('search_reference_photos',{queryEnglish:'banana fruit'}),/reference_search_limit/);
  const result=await tools.execute('get_reference_photo',{candidateId:'commons:42'});assert.equal(result[1].type,'input_image');assert.match(result[1].image_url,/^data:image\/png;base64,/);assert.equal(tools.assets.get('commons:42').bytes.length,photo.length);
  const beforeCached=t.calls.length;const cached=JSON.parse(await tools.execute('get_reference_photo',{candidateId:'commons:42'}));assert.equal(cached.applicationStatus,'REFERENCE_ALREADY_SELECTED');assert.match(cached.nextAction,/RETURN_FINAL_JSON_NOW/);assert.equal(t.calls.length,beforeCached);
  await assert.rejects(()=>tools.execute('get_reference_photo',{candidateId:'commons:999'}),/reference_tool_call_limit/);
  assert.ok(t.calls.every(c=>c.options.redirect==='manual'));
});

test('reference search excludes untrusted hosts, non-HTTPS, non-Commons sources and unsupported rights',async()=>{
  const bad=[
    page({thumburl:'https://evil.test/photo.png'}),
    page({thumburl:'http://upload.wikimedia.org/wikipedia/commons/photo.png'}),
    page({thumburl:'https://upload.wikimedia.org@evil.test/wikipedia/commons/photo.png'}),
    page({thumburl:'https://upload.wikimedia.org/arbitrary/path.png'}),
    page({descriptionurl:'https://evil.test/wiki/File:Banana.png'}),
    page({extmetadata:{...page().imageinfo[0].extmetadata,LicenseShortName:{value:'All rights reserved'}}}),
    page({extmetadata:{...page().imageinfo[0].extmetadata,LicenseUrl:{value:'https://evil.test/licenses/by/4.0'}}}),
    page({extmetadata:{...page().imageinfo[0].extmetadata,LicenseUrl:{value:'https://creativecommons.org/licenses/by-sa/4.0'}}}),
    page({extmetadata:{...page().imageinfo[0].extmetadata,ImageDescription:{value:'An AI-generated illustration of a banana'}}}),
  ];
  const t=transport(bad);assert.deepEqual(await searchReferencePhotos('banana',{fetchImpl:t.fetchImpl}),[]);assert.equal(t.calls.length,1);
});

test('reference downloads reject oversized bodies and invalid or oversized actual image dimensions',async()=>{
  const oversized=transport([page()],()=>new Response(new Uint8Array(1048577),{headers:{'Content-Type':'image/png'}}));const tools=createReferenceTools({fetchImpl:oversized.fetchImpl});await tools.execute('search_reference_photos',{queryEnglish:'banana'});
  await assert.rejects(()=>tools.execute('get_reference_photo',{candidateId:'commons:42'}),/reference_body_too_large/);
  const large=photo.slice();new DataView(large.buffer).setUint32(16,961);assert.throws(()=>inspectImage(large),/reference_invalid_image_dimensions/);assert.throws(()=>inspectImage(new Uint8Array([1,2,3])),/reference_invalid_image_dimensions/);
  assert.deepEqual(inspectImage(photo),{mime:'image/png',width:1,height:1});
});

test('cloud mirrored reference module stays identical to canonical shared module',async()=>{
  const [shared,cloud]=await Promise.all([fs.readFile(new URL('../apps/shared/reference-agent.mjs',import.meta.url),'utf8'),fs.readFile(new URL('../apps/cloud/lib/reference-agent.mjs',import.meta.url),'utf8')]);assert.equal(cloud,shared);
});

test('Agents function failures preserve safe stage/trace and correctly submit required action IDs',async()=>{
  const {generateReferenceChallenge}=await import('../apps/shared/reference-agent.mjs');const submitted=[];
  const stream={controller:new AbortController(),withResultCollection(){return this;},async *[Symbol.asyncIterator](){
    yield {type:'agent.session.created',session:{id:'session-test'}};
    yield {type:'agent.session.requires_action',session:{id:'session-test',required_actions:[{type:'function_call',turn_id:'turn-test',call_id:'call-test',name:'search_reference_photos',arguments:{queryEnglish:'banana'}}]}};
  }};
  const client={beta:{agents:{sessions:{create:async()=>stream,events:{create:async(id,event)=>submitted.push({id,...event})},delete:async()=>{}}}}};
  let failure;try{await generateReferenceChallenge(client,{participantCount:2},{fetchImpl:async()=>new Response('forbidden secret-body-must-not-be-logged',{status:403}),timeoutMs:1000});}catch(error){failure=error;}
  assert.equal(failure?.message,'reference_http_403');assert.equal(failure?.code,'reference_http_403');assert.equal(typeof failure?.referenceStage,'string');assert.ok(failure?.referenceElapsedMs>=0);
  assert.ok(failure?.referenceTrace.some(row=>row.phase==='started'));assert.ok(failure?.referenceTrace.some(row=>row.error==='reference_http_403'));
  assert.equal(submitted[0].events[0].turn_id,'turn-test');assert.equal(submitted[0].events[0].call_id,'call-test');assert.equal(submitted[0].events[0].success,false);
  assert.equal(JSON.stringify(failure).includes('secret-body'),false);
});

test('upstream SDK error text is replaced with a safe numeric HTTP code',async()=>{
  const {generateReferenceChallenge}=await import('../apps/shared/reference-agent.mjs');
  const client={beta:{agents:{sessions:{create:async()=>{throw Object.assign(new Error('private request headers and sensitive example'),{status:401});}}}}};
  await assert.rejects(()=>generateReferenceChallenge(client,{}),error=>{
    assert.equal(error.message,'reference_agent_http_401');assert.equal(error.referenceStage,'agent_create');assert.deepEqual(error.referenceTrace,[]);assert.equal(JSON.stringify(error).includes('sensitive'),false);return true;
  });
});


test('reference lookup rejects 302 and other redirects without fetching their Location targets',async()=>{
  for(const status of [301,302,303,307,308]){
    const calls=[];
    await assert.rejects(()=>searchReferencePhotos('banana',{fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(null,{status,headers:{Location:'https://evil.test/redirected-image'}});}}),/reference_redirect_rejected/);
    assert.equal(calls.length,1);assert.equal(new URL(calls[0].url).hostname,'commons.wikimedia.org');assert.equal(calls[0].options.redirect,'manual');
  }
  const t=transport([page()],()=>new Response(null,{status:302,headers:{Location:'https://evil.test/copied-photo.png'}})),tools=createReferenceTools({fetchImpl:t.fetchImpl});
  await tools.execute('search_reference_photos',{queryEnglish:'banana'});
  await assert.rejects(()=>tools.execute('get_reference_photo',{candidateId:'commons:42'}),/reference_redirect_rejected/);
  assert.equal(t.calls.length,2);assert.ok(t.calls.every(call=>new URL(call.url).hostname!=='evil.test'));assert.ok(t.calls.every(call=>call.options.redirect==='manual'));assert.equal(tools.assets.size,0);
});

test('same selected candidate is cached while two distinct image downloads remain bounded',async()=>{
  const pages=[42,43,44].map(id=>({...page(),pageid:id})),t=transport(pages),tools=createReferenceTools({fetchImpl:t.fetchImpl});
  await tools.execute('search_reference_photos',{queryEnglish:'banana'});await tools.execute('get_reference_photo',{candidateId:'commons:42'});const requests=t.calls.length;
  const cached=JSON.parse(await tools.execute('get_reference_photo',{candidateId:'commons:42'}));assert.equal(t.calls.length,requests);assert.equal(cached.reference.candidateId,'commons:42');assert.equal(cached.applicationStatus,'REFERENCE_ALREADY_SELECTED');assert.match(cached.nextAction,/Do not call tools again/);
  await tools.execute('get_reference_photo',{candidateId:'commons:43'});await assert.rejects(()=>tools.execute('get_reference_photo',{candidateId:'commons:44'}),/reference_download_limit/);assert.equal(tools.assets.size,2);
});

test('incomplete session is cancelled before deletion and cleanup errors preserve the original cause',async()=>{
  const {generateReferenceChallenge}=await import('../apps/shared/reference-agent.mjs');const order=[];let config;
  const stream={controller:new AbortController(),withResultCollection(){return this;},async *[Symbol.asyncIterator](){yield {type:'agent.session.created',session:{id:'ours'}};yield {type:'agent.session.requires_action',session:{id:'ours',required_actions:[{type:'function_call',turn_id:'turn',call_id:'call',name:'search_reference_photos',arguments:{queryEnglish:'banana'}}]}};}};
  const client={beta:{agents:{sessions:{create:async options=>{config=options;return stream;},events:{create:async(id,input)=>order.push(input.events[0].type)},delete:async()=>{order.push('delete');throw Error('private SDK details must not replace original error');}}}}};
  let failure;try{await generateReferenceChallenge(client,{}, {fetchImpl:async()=>new Response(null,{status:403}),timeoutMs:1000});}catch(error){failure=error;}
  assert.deepEqual(config.metadata,{app:'ai-karimono-race',purpose:'reference-challenge'});assert.equal(failure.message,'reference_http_403');assert.equal(failure.code,'reference_http_403');
  assert.deepEqual(order,['agent.session.input.tool_result','agent.session.input.cancel','delete']);assert.ok(failure.referenceTrace.some(row=>row.phase==='delete_failed'));assert.equal(JSON.stringify(failure).includes('private SDK'),false);
});

test('a lost deletion acknowledgement is accepted only after a separate 404 confirms session removal',async()=>{
  const {generateReferenceChallenge}=await import('../apps/shared/reference-agent.mjs');const order=[],t=transport([page()]);
  const stream={controller:new AbortController(),withResultCollection(){return this;},async *[Symbol.asyncIterator](){
    yield {type:'agent.session.created',session:{id:'ours-confirmed'}};
    for(const [name,args] of [['search_reference_photos',{queryEnglish:'banana'}],['get_reference_photo',{candidateId:'commons:42'}]])yield {type:'agent.session.requires_action',session:{id:'ours-confirmed',required_actions:[{type:'function_call',turn_id:'turn',call_id:name,name,arguments:args}]}};
    yield {type:'agent.session.turn.completed'};
  },async finalResult(){return {session_id:'ours-confirmed',output_text:JSON.stringify({objectType:'バナナ',referenceId:'commons:42',title:'バナナを探そう',description:'黄色い実物を撮る',criteria:['バナナが見える','黄色い部分が見える']})};}};
  const client={beta:{agents:{sessions:{create:async()=>stream,events:{create:async()=>{}},delete:async()=>{order.push('delete');throw new SyntaxError('empty acknowledgement');},retrieve:async()=>{order.push('verify');throw Object.assign(new Error('gone'),{status:404});}}}}};
  const result=await generateReferenceChallenge(client,{}, {fetchImpl:t.fetchImpl,timeoutMs:1000});assert.deepEqual(order,['delete','verify']);assert.ok(result.referenceAsset.bytes.length>0);assert.ok(result.referenceTrace.some(x=>x.phase==='deleted_confirmed'));
});
