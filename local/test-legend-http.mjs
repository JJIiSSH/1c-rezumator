import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import path from 'node:path';
import {plan,result,student} from './test-fixtures/legend.mjs';

async function fixture(t){
 const dir=await mkdtemp('/tmp/rezumator-legend-http-'),data=path.join(dir,'data');await mkdir(data);await writeFile(path.join(data,'students.json'),JSON.stringify([student]));
 const mode=path.join(dir,'mode'),calls=path.join(dir,'calls'),responses=path.join(dir,'responses.json'),fake=path.join(dir,'fake-cli');
 await writeFile(mode,'normal');await writeFile(calls,'');await writeFile(responses,JSON.stringify({plan,result}));
 await writeFile(fake,`#!${process.execPath}
const fs=require('node:fs'),args=process.argv.slice(2);
if(args[0]==='login'){console.log('Logged in using ChatGPT');process.exit(0);}
if(args[0]==='auth'){console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai'}));process.exit(0);}
if(args[0]==='app-server'){
 require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;let result={};if(m.method==='model/list')result={data:[{model:'gpt-6-sol',displayName:'Sol',defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'high'}]}]};process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');});
}else{
 let prompt='';process.stdin.on('data',c=>prompt+=c);process.stdin.on('end',()=>{
  const schema=args.includes('--json-schema')?JSON.parse(args[args.indexOf('--json-schema')+1]):JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema')+1]));
  const step=schema.properties.legend_text?'review':'plan',mode=fs.readFileSync(process.env.TEST_MODE,'utf8'),responses=JSON.parse(fs.readFileSync(process.env.TEST_RESPONSES));
  fs.appendFileSync(process.env.TEST_CALLS,JSON.stringify({step,args,prompt})+'\\n');
  if(mode==='fail-review'&&step==='review'){console.error('quota limit');process.exit(1);}
  const output=structuredClone(step==='plan'?responses.plan:responses.result);if(mode==='bad-plan'&&step==='plan')output.failures[0].environment='production';
  const finish=()=>{if(args.includes('--json-schema'))console.log(JSON.stringify({structured_output:output,usage:{input_tokens:10,output_tokens:20}}));else {console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(output)}}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:20}}));}};
  setTimeout(finish,mode==='slow-'+step?5000:step==='review'?150:40);
 });
}
`,{mode:0o700});
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,REZUMATOR_PORT:'0',REZUMATOR_DATA_DIR:data,REZUMATOR_CODEX:fake,REZUMATOR_CLAUDE:fake,TEST_MODE:mode,TEST_CALLS:calls,TEST_RESPONSES:responses},stdio:['ignore','pipe','pipe']});
 let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);
 t.after(async()=>{if(child.exitCode===null){const finished=once(child,'exit');child.kill('SIGTERM');await finished;}await rm(dir,{recursive:true,force:true});});
 for(let i=0;i<200&&!out.match(/http:\/\/127\.0\.0\.1:\d+/);i++){if(child.exitCode!==null)throw Error(err);await new Promise(r=>setTimeout(r,20));}
 const base=out.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert.ok(base,err);const{token}=await(await fetch(base+'/api/session')).json();
 const request=async(route,body,method=body===undefined?'GET':'POST')=>{const r=await fetch(base+route,{method,headers:{'x-rezumator-token':token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 const poll=async(id,predicate=j=>j.status!=='running')=>{for(let i=0;i<200;i++){const j=(await request('/api/jobs/'+id)).data;if(predicate(j))return j;await new Promise(r=>setTimeout(r,20));}throw Error('Job did not settle');};
 return {data,mode,calls,request,poll};
}

for(const provider of ['openai','anthropic'])test(`Легенда ${provider}: два этапа с одной моделью и отдельный промпт`,async t=>{
 const f=await fixture(t);if(provider==='anthropic'){const before=(await f.request('/api/generation-settings')).data;const r=await f.request('/api/generation-settings',{before,settings:{provider,model:'sonnet',reasoning_effort:'high'}});assert.equal(r.status,200);}
 const standalone=await f.request('/api/legend/rules');assert.equal(standalone.status,200);assert.match(standalone.data.prompt,/Самостоятельный промпт/);
 const started=await f.request('/api/legend/generate',student);assert.equal(started.status,202,JSON.stringify(started.data));assert.match(started.data.message,/1\/2/);
 const during=await f.poll(started.data.id,j=>/2\/2/.test(j.message));assert.equal(during.status,'running');assert.equal((await f.request('/api/legend/generate',student)).status,409);
 const job=await f.poll(started.data.id);assert.equal(job.status,'done',JSON.stringify(job));assert.equal(job.result.generation_passes,2);assert.equal(job.result.case_plan.failures.length,2);assert.equal(job.result.provider,provider);assert.equal(job.result.usage.passes.length,2);
 const calls=(await readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);assert.deepEqual(calls.map(c=>c.step),['plan','review']);for(const c of calls)assert.equal(c.args[c.args.indexOf('--model')+1],job.model);
 assert.deepEqual(JSON.parse(await readFile(path.join(f.data,'students.json'),'utf8')),[student]);
});
for(const stage of ['plan','review'])test(`Остановка на этапе ${stage} отменяет задание и сохраняет прежнюю легенду`,async t=>{
 const f=await fixture(t);await writeFile(f.mode,'slow-'+stage);const started=await f.request('/api/legend/generate',student);assert.equal(started.status,202);
 if(stage==='review'){await f.poll(started.data.id,j=>/2\/2/.test(j.message));for(let i=0;i<100;i++){if((await readFile(f.calls,'utf8')).trim().split('\n').filter(Boolean).length===2)break;await new Promise(r=>setTimeout(r,10));}}else await new Promise(r=>setTimeout(r,100));
 const stopped=await f.request('/api/jobs/'+started.data.id,undefined,'DELETE');assert.equal(stopped.data.status,'cancelled');await new Promise(r=>setTimeout(r,120));
 const job=(await f.request('/api/jobs/'+started.data.id)).data;assert.equal(job.status,'cancelled');assert.equal(job.result,null);
 const calls=(await readFile(f.calls,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);assert.equal(calls.length,stage==='plan'?1:2);
 assert.deepEqual(JSON.parse(await readFile(path.join(f.data,'students.json'),'utf8')),[student]);
});
test('Ошибка второго этапа и неверная среда не заменяют сохранённую легенду',async t=>{
 const f=await fixture(t);for(const mode of ['bad-plan','fail-review']){
  await writeFile(f.mode,mode);await writeFile(f.calls,'');const started=await f.request('/api/legend/generate',student);const job=await f.poll(started.data.id);assert.equal(job.status,'error');assert.equal(job.result,null);assert.match(job.message,mode==='bad-plan'?/тестовых/:/лимит/);
  assert.equal((await readFile(f.calls,'utf8')).trim().split('\n').filter(Boolean).length,mode==='bad-plan'?1:2);
 }assert.deepEqual(JSON.parse(await readFile(path.join(f.data,'students.json'),'utf8')),[student]);
});
