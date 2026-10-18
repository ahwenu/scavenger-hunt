import fs from 'node:fs';
import path from 'node:path';
/** Bundle the shared monorepo frontend into the standalone Sites source checkout. */
const root=path.resolve(import.meta.dirname,'..');
const assets={};
for(const [url,file,type] of [['/','index.html','text/html; charset=utf-8'],['/app.js','app.js','text/javascript; charset=utf-8'],['/style.css','style.css','text/css; charset=utf-8'],['/host-view.css','host-view.css','text/css; charset=utf-8'],['/autumn-theme.css','autumn-theme.css','text/css; charset=utf-8'],['/live-camera.js','live-camera.js','text/javascript; charset=utf-8'],['/live-camera.css','live-camera.css','text/css; charset=utf-8'],['/sound-engine.js','sound-engine.js','text/javascript; charset=utf-8'],['/sound-events.js','sound-events.js','text/javascript; charset=utf-8'],['/sound-effects.js','sound-effects.js','text/javascript; charset=utf-8'],['/verification.html','verification.html','text/html; charset=utf-8'],['/verification.css','verification.css','text/css; charset=utf-8'],['/verification-data.json','verification-data.json','application/json; charset=utf-8']])assets[url]={body:fs.readFileSync(path.join(root,'apps/web',file),'utf8'),type};
// Workersの文字列バンドル内でもMP3の元バイトを保ち、外部CDNに依存しない。
for(const file of fs.readdirSync(path.join(root,'apps/web/sounds')).filter(file=>file.endsWith('.mp3')))assets[`/sounds/${file}`]={body:fs.readFileSync(path.join(root,'apps/web/sounds',file)).toString('base64'),type:'audio/mpeg',encoding:'base64'};
fs.writeFileSync(path.join(root,'apps/cloud/lib/assets.ts'),'/** Generated from apps/web by scripts/sync-cloud-assets.mjs. */\nexport const assets: Record<string,{body:string,type:string,encoding?:"base64"}> = '+JSON.stringify(assets)+';\n');
fs.copyFileSync(path.join(root,'apps/shared/reference-agent.mjs'),path.join(root,'apps/cloud/lib/reference-agent.mjs'));
console.log('Shared frontend and reference adapter synchronized.');
