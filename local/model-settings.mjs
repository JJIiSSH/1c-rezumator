import {readFile,writeFile,rename} from 'node:fs/promises';
import {NotionClient} from './notion-client.mjs';

export const GENERATION_PROVIDERS={
 openai:{id:'openai',name:'ChatGPT',defaultModel:'gpt-6-sol',defaultEffort:'high'},
 anthropic:{id:'anthropic',name:'Claude',defaultModel:'default',defaultEffort:'high'}
};

export const CLAUDE_MODELS=[
 {model:'default',name:'Claude · рекомендуемая для подписки',defaultEffort:'high',efforts:['low','medium','high','xhigh']},
 {model:'sonnet',name:'Claude Sonnet',defaultEffort:'high',efforts:['low','medium','high','xhigh']},
 {model:'opus',name:'Claude Opus',defaultEffort:'high',efforts:['low','medium','high','xhigh','max']},
 {model:'haiku',name:'Claude Haiku',defaultEffort:'low',efforts:['low','medium','high']}
];

export class ModelClient extends NotionClient{
 async initialize(){await this.startTransport();}
 async list(){
  await this.connect();const models=[];let cursor;
  do{const r=await this.rpc('model/list',{limit:100,includeHidden:false,...(cursor?{cursor}:{})});models.push(...r.data);cursor=r.nextCursor;}while(cursor);
  return models.filter(m=>!m.hidden&&(!m.inputModalities||m.inputModalities.includes('text'))).map(m=>({model:m.model,name:m.displayName||m.model,defaultEffort:m.defaultReasoningEffort,efforts:m.supportedReasoningEfforts.map(e=>e.reasoningEffort)}));
 }
}

export function validateProvider(provider){if(!GENERATION_PROVIDERS[provider])throw Error('Неизвестный сервис генерации.');return provider;}
export function validateModelSettings(value,models){
 const model=models.find(m=>m.model===value?.model);
 if(!model)throw Error('Эта модель недоступна. Обновите список моделей.');
 if(!model.efforts.includes(value.reasoning_effort))throw Error('Модель не поддерживает выбранный уровень рассуждения.');
 return {model:model.model,reasoning_effort:value.reasoning_effort};
}

function defaults(){return Object.fromEntries(Object.values(GENERATION_PROVIDERS).map(p=>[p.id,{model:p.defaultModel,reasoning_effort:p.defaultEffort}]));}

export class ModelSettings{
 constructor(file,client,{claudeModels=CLAUDE_MODELS}={}){this.file=file;this.client=client;this.claudeModels=claudeModels;this.value={provider:'openai',choices:defaults()};this.queue=Promise.resolve();this.catalogs=new Map();this.loading=new Map();}
 async init(){
  try{
   const saved=JSON.parse(await readFile(this.file,'utf8'));
   if(saved?.choices&&GENERATION_PROVIDERS[saved.provider])this.value={provider:saved.provider,choices:{...defaults(),...saved.choices}};
   else if(saved?.model)this.value.choices.openai={model:saved.model,reasoning_effort:saved.reasoning_effort};
  }catch(e){if(e.code!=='ENOENT')throw e;}
 }
 snapshot(provider=this.value.provider){provider=validateProvider(provider);return {provider,...this.value.choices[provider]};}
 async models(provider=this.value.provider,refresh=false){
  provider=validateProvider(provider);
  if(provider==='anthropic')return this.claudeModels.map(m=>({...m,efforts:[...m.efforts]}));
  const cached=this.catalogs.get(provider);if(!refresh&&cached&&Date.now()-cached.at<300000)return cached.models;
  if(this.loading.has(provider))return this.loading.get(provider);
  const request=this.client.list().then(async models=>{
   if(!models.length)throw Error('Codex не вернул доступных моделей.');
   this.catalogs.set(provider,{models,at:Date.now()});
   await this.migrateRetiredSol(models);
   return models;
  }).finally(()=>this.loading.delete(provider));
  this.loading.set(provider,request);return request;
 }
 async migrateRetiredSol(models){
  const current=this.value.choices.openai;
  if(current.model!=='gpt-5.6-sol'||models.some(m=>m.model===current.model))return;
  const replacement=models.find(m=>m.model==='gpt-6-sol');
  if(!replacement)return;
  const transaction=this.queue.catch(()=>{}).then(async()=>{
   if(this.value.choices.openai.model!=='gpt-5.6-sol')return;
   const effort=replacement.efforts.includes(current.reasoning_effort)?current.reasoning_effort:replacement.defaultEffort;
   const next={...this.value,choices:{...this.value.choices,openai:{model:replacement.model,reasoning_effort:effort}}};
   await writeFile(this.file+'.tmp',JSON.stringify(next,null,2),{mode:0o600});
   await rename(this.file+'.tmp',this.file);
   this.value=next;
  });
  this.queue=transaction;await transaction;
 }
 async validatedSnapshot(){const provider=this.value.provider;const models=await this.models(provider,true);const value=this.snapshot();return {...value,...validateModelSettings(value,models)};}
 async save(value,before){
  const provider=validateProvider(value?.provider||'openai');
  const validated={provider,...validateModelSettings(value,await this.models(provider))};
  const transaction=this.queue.catch(()=>{}).then(async()=>{
   const current=this.snapshot();
   if(!before||before.provider!==current.provider||before.model!==current.model||before.reasoning_effort!==current.reasoning_effort){const e=Error('Сервис или модель уже изменены в другом окне. Повторите выбор.');e.status=409;throw e;}
   const next={provider,choices:{...this.value.choices,[provider]:{model:validated.model,reasoning_effort:validated.reasoning_effort}}};
   await writeFile(this.file+'.tmp',JSON.stringify(next,null,2),{mode:0o600});await rename(this.file+'.tmp',this.file);this.value=next;return this.snapshot();
  });this.queue=transaction;return transaction;
 }
}
