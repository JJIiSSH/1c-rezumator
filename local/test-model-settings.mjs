import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ModelSettings,validateModelSettings} from './model-settings.mjs';
const catalog=[{model:'gpt-6-sol',efforts:['low','medium','high'],defaultEffort:'medium'},{model:'another-model',efforts:['medium']}];
test('validates model and effort against discovered capabilities',()=>{
 assert.deepEqual(validateModelSettings({model:'another-model',reasoning_effort:'medium'},catalog),{model:'another-model',reasoning_effort:'medium'});
 assert.throws(()=>validateModelSettings({model:'unknown',reasoning_effort:'high'},catalog),/недоступна/);
 assert.throws(()=>validateModelSettings({model:'another-model',reasoning_effort:'high'},catalog),/не поддерживает/);
});
test('persists selection, rejects stale saves, preserves in-flight job snapshot',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'rezumator-model-'));
 try{
  const file=path.join(dir,'settings.json'),client={list:async()=>catalog},settings=new ModelSettings(file,client);await settings.init();
  const before=settings.snapshot(),job=await settings.validatedSnapshot();
  await settings.save({provider:'openai',model:'another-model',reasoning_effort:'medium'},before);
  assert.equal(job.model,'gpt-6-sol');assert.equal(job.reasoning_effort,'high');
  const reload=new ModelSettings(file,client);await reload.init();assert.equal(reload.snapshot().model,'another-model');
  await assert.rejects(settings.save({...before,provider:'openai'},before),e=>e.status===409);
  assert.equal(settings.snapshot().model,'another-model');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('model catalog is refreshed on request and never silently substitutes unavailable choice',async()=>{
 let current=catalog,calls=0;const s=new ModelSettings('/unused',{list:async()=>{calls++;return current;}});
 await s.models();await s.models();assert.equal(calls,1);
 current=[catalog[1]];await s.models('openai',true);await assert.rejects(s.validatedSnapshot(),/недоступна/);assert.equal(s.snapshot().model,'gpt-6-sol');
});
test('После вывода GPT-5.6 Sol сохранённый выбор переносится на доступную GPT-6 Sol',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'rezumator-model-migration-'));
 try{
  const file=path.join(dir,'settings.json');
  await writeFile(file,JSON.stringify({provider:'openai',choices:{openai:{model:'gpt-5.6-sol',reasoning_effort:'medium'},anthropic:{model:'default',reasoning_effort:'high'}}}));
  const settings=new ModelSettings(file,{list:async()=>catalog});await settings.init();
  assert.equal((await settings.validatedSnapshot()).model,'gpt-6-sol');
  assert.equal(settings.snapshot().reasoning_effort,'medium');
  const reload=new ModelSettings(file,{list:async()=>catalog});await reload.init();
  assert.equal(reload.snapshot().model,'gpt-6-sol');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('keeps independent choices for ChatGPT and Claude and migrates old settings',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'rezumator-provider-'));
 try{
  const file=path.join(dir,'settings.json');await writeFile(file,JSON.stringify({model:'another-model',reasoning_effort:'medium'}));
  const settings=new ModelSettings(file,{list:async()=>catalog});await settings.init();
  assert.deepEqual(settings.snapshot(),{provider:'openai',model:'another-model',reasoning_effort:'medium'});
  const before=settings.snapshot();await settings.save({provider:'anthropic',model:'opus',reasoning_effort:'high'},before);
  assert.deepEqual(settings.snapshot(),{provider:'anthropic',model:'opus',reasoning_effort:'high'});
  assert.deepEqual(settings.snapshot('openai'),{provider:'openai',model:'another-model',reasoning_effort:'medium'});
 }finally{await rm(dir,{recursive:true,force:true});}
});
