import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {once} from 'node:events';

test('connection HTTP flow verifies before saving, applies immediately and isolates Notion journals',async t=>{
 const dir=await mkdtemp('/tmp/rezumator-connections-http-');await mkdir(path.join(dir,'data'));
 const a='12345678-1234-1234-1234-123456789abc',b='87654321-1234-1234-1234-123456789abc';
 const fakeState=path.join(dir,'fake-state.json'),fake=path.join(dir,'fake-codex');
 await writeFile(fakeState,JSON.stringify({workspace:a,validHeaders:true}));await writeFile(path.join(dir,'data/students.json'),'[]');
 await writeFile(fake,`#!${process.execPath}
const fs=require('node:fs');const readline=require('node:readline');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(m.id===undefined)return;
 const s=JSON.parse(fs.readFileSync(process.env.FAKE_STATE));let result={};const p=m.params||{};
 if(m.method==='account/read')result={account:{type:'chatgpt',email:'test@example.invalid'}};
 if(m.method==='plugin/list')result={marketplaces:[{name:'openai-curated-remote',plugins:['google-drive','notion'].map(name=>({id:name+'@openai-curated-remote',name,installed:true,enabled:true,localVersion:'1',source:{type:'remote'},installPolicy:'AVAILABLE',availability:'AVAILABLE'}))}]};
 if(m.method==='plugin/read')result={plugin:{apps:[{id:p.pluginName,name:p.pluginName==='notion'?'Notion':'Google Drive',installUrl:'https://chatgpt.com/apps/'+p.pluginName+'/'+p.pluginName}]}};
 if(m.method==='app/installed')result={apps:[{id:'notion',runtimeName:'Notion',enabled:true,callable:true},{id:'google-drive',runtimeName:'Google Drive',enabled:true,callable:true}]};
 if(m.method==='thread/start')result={thread:{id:'test-thread'}};
 if(m.method==='mcpServerStatus/list')result={data:[{name:'codex_apps',tools:Object.fromEntries(['notion.fetch','notion.notion-create-pages','notion.notion-update-page','google_drive.get_spreadsheet_metadata','google_drive.get_spreadsheet_range','google_drive.fetch','google_drive.get_file_metadata'].map(n=>[n,{}]))}]};
 if(m.method==='mcpServer/tool/call'){
  let data={};
  if(p.tool==='notion.fetch')data=p.arguments.id==='self'?{self:{workspace:{id:s.workspace,name:s.workspace===${JSON.stringify(a)}?'Workspace A':'Workspace B'}}}:{metadata:{type:'page'},text:'page'};
  if(p.tool==='notion.notion-create-pages')data={pages:[{id:'test-page',url:'https://www.notion.so/test-page'}]};
  if(p.tool==='google_drive.get_spreadsheet_metadata')data={properties:{title:'Тестовая таблица'},sheets:[{properties:{sheetId:42,title:'Ученики',gridProperties:{rowCount:20,columnCount:10}}}]};
  if(p.tool==='google_drive.get_spreadsheet_range')data={values:s.validHeaders?[['Отметка времени','Telegram','Мне нужно резюме','Где вы сейчас живете','Ваше резюме pdf','Напишите ваш возраст','Напишите ник на github','Опишите коротко проект','Какими задачами занимались','Самые интересные задачи']]:[['Неверный заголовок']]};
  result={structuredContent:data};
 }
 process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');
});
`,{mode:0o700});
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,REZUMATOR_PORT:'0',REZUMATOR_DESKTOP:'1',REZUMATOR_DATA_DIR:path.join(dir,'data'),REZUMATOR_CODEX:fake,FAKE_STATE:fakeState},stdio:['ignore','pipe','pipe']});
 let output='',error='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>error+=x);
 t.after(async()=>{child.kill('SIGTERM');await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,3000))]);await rm(dir,{recursive:true,force:true});});
 for(let i=0;i<100&&!output.match(/http:\/\/127\.0\.0\.1:\d+/);i++){if(child.exitCode!==null)throw Error(error);await new Promise(r=>setTimeout(r,25));}
 const origin=output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert.ok(origin,error);
 const{token}=await(await fetch(origin+'/api/session')).json();
 const request=async(route,body)=>{const r=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{'x-rezumator-token':token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 const save=async workspace=>{await writeFile(fakeState,JSON.stringify({workspace,validHeaders:true}));return request('/api/connections/notion/select',{workspaceId:workspace});};
 assert.equal((await request('/api/connections/status')).data.providers.every(p=>p.status==='connected'),true);
 assert.equal((await request('/api/connections/notion/select',{workspaceId:b})).status,400);
 assert.equal((await save(a)).status,200);
 let status=await request('/api/notion/status');assert.equal(status.data.workspace.id,a);
 const created=await request('/api/state/changes',[{id:'test',create:{id:'test',name:'Тест',jobs:[],result:{resume_text:'Программист 1С'}}}]);assert.equal(created.status,200,JSON.stringify(created.data));
 const exported=await request('/api/notion/pages',{id:'test',name:'Тест',jobs:[],result:{resume_text:'Программист 1С'}});assert.equal(exported.status,202,JSON.stringify(exported.data));
 for(let i=0;i<50;i++){status=await request('/api/notion/status');if(status.data.entries.test?.status==='done')break;await new Promise(r=>setTimeout(r,25));}
 assert.equal(status.data.entries.test.status,'done');
 assert.equal((await save(b)).status,200);assert.deepEqual((await request('/api/notion/status')).data.entries,{});
 assert.equal((await save(a)).status,200);assert.equal((await request('/api/notion/status')).data.entries.test.pageId,'test-page');
 let r=await request('/api/connections/google-drive/check',{sheetUrl:'https://docs.google.com/spreadsheets/d/test-sheet/edit#gid=42'});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.settings.sheetVerified.sheetTitle,'Ученики');
 const saved=await readFile(path.join(dir,'data/connections.json'),'utf8');
 await writeFile(fakeState,JSON.stringify({workspace:a,validHeaders:false}));
 r=await request('/api/connections/google-drive/check',{sheetUrl:'https://docs.google.com/spreadsheets/d/other-sheet/edit#gid=42'});assert.equal(r.status,400);assert.equal(await readFile(path.join(dir,'data/connections.json'),'utf8'),saved);
});
