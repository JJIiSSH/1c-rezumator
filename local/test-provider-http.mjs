import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import path from 'node:path';

test('Claude subscription can be selected and returns the same structured resume contract',async t=>{
 const dir=await mkdtemp('/tmp/rezumator-claude-http-'),data=path.join(dir,'data');await mkdir(data);await writeFile(path.join(data,'students.json'),'[]');
 const fakeCodex=path.join(dir,'fake-codex'),fakeClaude=path.join(dir,'fake-claude'),capture=path.join(dir,'claude-call.json');
 await writeFile(fakeCodex,`#!${process.execPath}\nprocess.stdin.resume();`,{mode:0o700});
 await writeFile(fakeClaude,`#!${process.execPath}
const fs=require('node:fs');const args=process.argv.slice(2);
if(args[0]==='auth'&&args[1]==='status'){console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',email:'claude@example.invalid'}));process.exit(0);}
if(args[0]==='auth'&&args[1]==='logout')process.exit(0);
let prompt='';process.stdin.on('data',c=>prompt+=c);process.stdin.on('end',()=>{
 fs.writeFileSync(process.env.CAPTURE,JSON.stringify({args,promptLength:prompt.length,hasApiKey:!!process.env.ANTHROPIC_API_KEY}));
 const data=JSON.parse(prompt.split('(JSON):\\n')[1]),date=data.as_of_date.split('-').map(Number),now=date[0]*12+date[1]-1;
 const stamp=n=>Math.floor(n/12)+'-'+String(n%12+1).padStart(2,'0');
 const resume_text='Программист 1С\\nМосква\\nОпыт работы\\nКомпания А\\n'+stamp(now-23)+' - по настоящее время\\nКомпания Б\\n'+stamp(now-data.experience.target_months+1)+' - '+stamp(now-24);
 console.log(JSON.stringify({structured_output:{resume_text,summary:'Готово',checks:[],questions:[],changes:[]},usage:{input_tokens:10,output_tokens:20}}));
});
`,{mode:0o700});
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,ANTHROPIC_API_KEY:'must-not-leak',REZUMATOR_PORT:'0',REZUMATOR_DESKTOP:'1',REZUMATOR_DATA_DIR:data,REZUMATOR_CODEX:fakeCodex,REZUMATOR_CLAUDE:fakeClaude,CAPTURE:capture},stdio:['ignore','pipe','pipe']});
 let output='',error='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>error+=x);
 t.after(async()=>{child.kill('SIGTERM');await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,3000))]);await rm(dir,{recursive:true,force:true});});
 for(let i=0;i<100&&!output.match(/http:\/\/127\.0\.0\.1:\d+/);i++){if(child.exitCode!==null)throw Error(error);await new Promise(r=>setTimeout(r,25));}
 const origin=output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert.ok(origin,error);
 const{token}=await(await fetch(origin+'/api/session')).json();
 const request=async(route,body)=>{const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{'x-rezumator-token':token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
 const before=(await request('/api/generation-settings')).data;
 const available=(await request('/api/models?provider=anthropic')).data;assert.equal(available.settings.model,'default');
 let response=await request('/api/generation-settings',{settings:available.settings,before});assert.equal(response.status,200);assert.equal(response.data.provider,'anthropic');
 response=await request('/api/status');assert.equal(response.data.connected,true);assert.equal(response.data.message,'Подписка Claude');
 response=await request('/api/generate',{id:'student',name:'Тест',jobs:[],fillMetrics:false});assert.equal(response.status,202,JSON.stringify(response.data));
 let job=response.data;for(let i=0;i<100&&job.status==='running';i++){await new Promise(r=>setTimeout(r,25));job=(await request('/api/jobs/'+job.id)).data;}
 assert.equal(job.status,'done',JSON.stringify(job));assert.equal(job.result.provider,'anthropic');assert.match(job.result.resume_text,/Программист 1С\nМосква\nОпыт работы: 4/);assert.match(job.result.resume_text,/по настоящее время/);
 const call=JSON.parse(await readFile(capture,'utf8'));assert.equal(call.hasApiKey,false);assert.ok(call.promptLength>100);assert.ok(call.args.includes('--restricted'));assert.equal(call.args[call.args.indexOf('--tools')+1],'');assert.ok(call.args.includes('--json-schema'));
});
