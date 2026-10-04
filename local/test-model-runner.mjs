import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {generationError,runModel} from './model-runner.mjs';

test('Квота, частота запросов, размер контекста и соединение различаются',()=>{
 const cases=[
  [{code:'usage_limit_reached',message:"You've hit your usage limit."},'GENERATION_QUOTA'],
  ['quota limit','GENERATION_QUOTA'],
  [{code:'rate_limit_exceeded',message:'Too many requests'},'GENERATION_RATE_LIMIT'],
  ['HTTP 429: slow_down','GENERATION_RATE_LIMIT'],
  ['usage statistics unavailable: stream disconnected; exceeded retry limit','GENERATION_CONNECTION'],
  ['maximum tokens exceeded; token limit','GENERATION_CONTEXT'],
  ['HTTP 401 Unauthorized','GENERATION_AUTH'],
  ['HTTP 403 permission denied','GENERATION_ACCESS'],
  ['server_is_overloaded HTTP 503','GENERATION_SERVICE'],
  ['usage statistics: retry_limit configured; unexpected response','GENERATION_FAILED'],
  ['output_limit configured; invalid schema','GENERATION_FAILED']
 ];
 for(const [input,code] of cases)assert.equal(generationError(input,'openai').code,code,JSON.stringify(input));
 assert.equal(generationError({code:'secret=value'},'openai').providerCode,undefined);
 assert.equal(generationError({code:'rate_limit_exceeded'},'anthropic').providerCode,'rate_limit_exceeded');
 assert.match(generationError({code:'rate_limit_exceeded'},'anthropic').message,/Claude/);
});

async function fixture(t,{events=[],stderr='',exit=0,claudeResponse}){
 const dir=await mkdtemp(path.join(tmpdir(),'rezumator-runner-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const cli=path.join(dir,'fake-cli');
 await writeFile(cli,`#!${process.execPath}\nprocess.stdin.resume();process.stdin.on('end',()=>{process.stderr.write(${JSON.stringify(stderr)});process.stdout.write(${JSON.stringify(claudeResponse===undefined?events.map(e=>JSON.stringify(e)).join('\n')+'\n':JSON.stringify(claudeResponse))});process.exit(${exit});});`,{mode:0o700});
 return overrides=>runModel({job:{status:'running'},prompt:'fixture',schemaPath:path.join(dir,'schema.json'),schema:{},settings:{provider:'openai',model:'fixture',reasoning_effort:'high'},desktop:false,codex:cli,claude:cli,cwd:dir,env:process.env,...overrides});
}
test('Последняя ошибка провайдера приоритетнее нерелевантной usage/quota записи stderr',async t=>{
 const run=await fixture(t,{stderr:'usage log: quota limit warning from earlier request',events:[{type:'turn.failed',error:{code:'server_is_overloaded',message:'HTTP 503'}}],exit:1});
 await assert.rejects(run(),e=>e.code==='GENERATION_SERVICE'&&e.providerCode==='server_is_overloaded');
});
test('Ошибка при нулевом exit code не сохраняет незавершённый материал',async t=>{
 const run=await fixture(t,{events:[{type:'item.completed',item:{type:'agent_message',text:'partial'}},{type:'turn.failed',error:{code:'rate_limit_exceeded'}}]});
 await assert.rejects(run(),e=>e.code==='GENERATION_RATE_LIMIT');
});
test('Восстановленный поток с подтверждённым завершением возвращает материал',async t=>{
 const usage={input_tokens:10,output_tokens:20};
 const run=await fixture(t,{events:[{type:'error',message:'stream disconnected; retry limit'},{type:'item.completed',item:{type:'agent_message',text:'ready'}},{type:'turn.completed',usage}]});
 assert.deepEqual(await run(),{text:'ready',usage});
});
test('Claude usage в JSON не превращает неизвестную ошибку в исчерпанную квоту',async t=>{
 const run=await fixture(t,{claudeResponse:{is_error:true,result:'Invalid output schema',usage:{input_tokens:10}}});
 await assert.rejects(run({settings:{provider:'anthropic',model:'fixture',reasoning_effort:'high'}}),e=>e.code==='GENERATION_FAILED');
});
