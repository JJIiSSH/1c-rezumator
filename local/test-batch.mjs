import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {batchResumeEligible,hasCandidateData,studentsMissingResume,studentsWithoutReadyResume,notionEntryPreventsDuplicate,studentsPendingNotion} from './batch-operations.mjs';

const student=(id,extra={})=>({id,jobs:[],name:'Ученик '+id,result:null,...extra});

test('Массовая генерация выбирает только заполненные анкеты без резюме',()=>{
 const blank={id:'blank',jobs:[],name:'',telegram:'',resume:'',project:'',tasks:'',complex:''};
 const existing=student('ready',{result:{resume_text:'Готовое резюме'}});
 const missing=student('missing');
 assert.equal(hasCandidateData(blank),false);
 assert.deepEqual(studentsMissingResume([blank,existing,missing]).map(s=>s.id),['missing']);
});

test('Генерация без галочки включает прежние черновики и пропускает отмеченных готовыми',()=>{
 const students=[
  student('draft',{resumeReady:false,result:{resume_text:'Старый черновик'}}),
  student('missing',{resumeReady:false}),
  student('ready',{resumeReady:true,result:{resume_text:'Проверенное резюме'}}),
  student('empty',{name:'',telegram:'',resume:'',project:'',tasks:'',complex:''})
 ];
 assert.deepEqual(studentsWithoutReadyResume(students).map(s=>s.id),['draft','missing']);
 assert.deepEqual(studentsMissingResume(students).map(s=>s.id),['missing']);
 students[0].resumeReady=true;
 assert.equal(batchResumeEligible(students[0],'not_ready'),false);
 assert.equal(batchResumeEligible(students[0],'missing'),false);
});

test('Массовый экспорт Notion пропускает существующие и неопределённые страницы',()=>{
 const students=[student('new',{result:{resume_text:'Новое'}}),student('done',{result:{resume_text:'Есть'}}),student('uncertain',{result:{resume_text:'Неясно'}}),student('error',{result:{resume_text:'Повторить'}}),student('empty')];
 const entries={done:{pageId:'page-1',status:'done'},uncertain:{status:'uncertain'},error:{status:'error'}};
 assert.equal(notionEntryPreventsDuplicate(entries.done),true);
 assert.equal(notionEntryPreventsDuplicate(entries.uncertain),true);
 assert.equal(notionEntryPreventsDuplicate(entries.error),false);
 assert.deepEqual(studentsPendingNotion(students,entries).map(s=>s.id),['new','error']);
});

test('Сбой подключения при запуске останавливает очередь после первой попытки',async()=>{
 const source=await readFile(new URL('./public/app.js',import.meta.url),'utf8');
 const runner=source.slice(source.indexOf('async function startNextGenerationBatch(){'),source.indexOf('async function startGenerationBatch('));
 let attempts=0;
 const noop=()=>{};
 const context={generationBatch:{running:true,mode:'not_ready',queue:['a','b','c'],total:3,completed:0,failed:0},students:['a','b','c'].map(id=>student(id)),activeJob:null,generationStarting:false,startingStudentId:null,generationSettings:{provider:'openai'},batchResumeEligible,structuredClone,signature:noop,providerName:()=> 'ChatGPT',saveGenerationBatch:noop,renderBatchControls:noop,renderReadiness:noop,showJob:noop,toast:noop,api:async()=>{attempts++;throw Error('Связь с подключением Codex прервалась.');}};
 vm.createContext(context);await vm.runInContext(runner+'\nstartNextGenerationBatch()',context);
 assert.equal(attempts,1);
 assert.equal(context.generationBatch.running,false);
 assert.equal(context.generationStarting,false);
 assert.equal(context.generationBatch.failed,0);
 assert.deepEqual(context.generationBatch.queue,['a','b','c']);
 assert.match(context.generationBatch.message,/Очередь остановлена/);
});

test('Очередь легенд требует резюме, включает старые легенды без галочки и пропускает готовые',async()=>{
 const {studentsWithoutReadyLegend,batchLegendEligible}=await import('./batch-operations.mjs');
 const values=[student('no-resume'),student('blank',{result:{resume_text:'  '}}),student('new',{result:{resume_text:'Резюме'}}),student('old',{result:{resume_text:'Резюме'},legend:{legend_text:'Прежняя легенда'},legendReady:false}),student('ready',{result:{resume_text:'Резюме'},legendReady:true})];
 assert.deepEqual(studentsWithoutReadyLegend(values).map(s=>s.id),['new','old']);
 assert.equal(batchLegendEligible(null),false);values[3].legendReady=true;assert.equal(batchLegendEligible(values[3]),false);
});

test('Очередь легенд берёт актуальное резюме и отменяет запуск, если нажали стоп до ответа сервера',async()=>{
 const {batchLegendEligible}=await import('./batch-operations.mjs');
 const {legendSignature}=await import('./engine.mjs');
 const source=await readFile(new URL('./public/app.js',import.meta.url),'utf8');
 const runner=source.slice(source.indexOf('async function startNextGenerationBatch(){'),source.indexOf('async function startGenerationBatch('));
 const values=[student('skip',{result:{resume_text:'Есть'},legendReady:true}),student('target',{result:{resume_text:'Ручная правка текущего резюме'},legendReady:false})];
 const calls=[],noop=()=>{};
 const context={generationBatch:{running:true,kind:'legend',mode:'not_ready',queue:['skip','target'],total:2,completed:0,failed:0},students:values,activeJob:null,generationStarting:false,startingStudentId:null,generationSettings:{provider:'openai'},batchLegendEligible,batchResumeEligible,structuredClone,legendSignature,signature:noop,providerName:()=> 'ChatGPT',saveGenerationBatch:noop,renderBatchControls:noop,renderReadiness:noop,renderJobStatus:noop,showJob:noop,toast:noop,setTimeout:noop,pollJob:noop,sessionStorage:{setItem:noop},api:async(url,options)=>{calls.push({url,options});if(options.method==='POST'){context.generationBatch.running=false;context.generationBatch.queue=[];return {id:'job-legend',kind:'legend'};}return {status:'cancelled'};}};
 vm.createContext(context);await vm.runInContext(runner+'\nstartNextGenerationBatch()',context);
 assert.deepEqual(calls.map(c=>c.url),['/api/legend/generate','/api/jobs/job-legend']);
 assert.equal(JSON.parse(calls[0].options.body).result.resume_text,values[1].result.resume_text);
 assert.equal(calls[1].options.method,'DELETE');assert.equal(context.activeJob.kind,'legend');assert.equal(context.activeJob.signature,legendSignature(values[1]));
 assert.equal(values[1].legendReady,false);assert.equal(context.generationStarting,false);
});

test('Только успешная легенда ставит галочку своему ученику; ошибка и отмена сохраняют старый результат',async()=>{
 const source=await readFile(new URL('./public/app.js',import.meta.url),'utf8');
 const poll=source.slice(source.indexOf('async function pollJob(){'),source.indexOf("$('#generate').onclick="));
 for(const scenario of ['done','error','cancelled','notion_error','map_error']){
  const status=['notion_error','map_error'].includes(scenario)?'done':scenario;
  const old={legend_text:'Старая легенда'},fresh={legend_text:'Новый рассказ',rules_version:'rules'};
  const values=[student('target',{legend:old,legendReady:false,resumeReady:true}),student('selected',{legendReady:false})];
  const noop=()=>{},saved=[],published=[];
  const context={students:values,savedStudents:structuredClone(values),generationBatch:{running:true,notionFailed:0},same:(a,b)=>JSON.stringify(a)===JSON.stringify(b),publishGeneratedLegend:async id=>{published.push(id);assert.equal(context.savedStudents[0].legendReady,true);if(scenario==='notion_error')throw Error('Нет подключения Notion');if(scenario==='map_error')throw Object.assign(Error('Excalidraw недоступен'),{stage:'map'});},activeJob:{id:'job',studentId:'target',kind:'legend',signature:'stamp',batch:true},currentLegendRulesVersion:'',currentRulesVersion:'',sessionStorage:{removeItem:noop},$:()=>({classList:{add:noop}}),current:()=>values[1],api:async()=>({id:'job',status,result:status==='done'?fresh:null,message:'Остановлено'}),scheduleSave:noop,save:async()=>{saved.push(structuredClone(values));context.savedStudents=structuredClone(values);},showJob:noop,toast:noop,renderStudents:noop,renderReadiness:noop,renderResult:noop,renderBatchControls:noop,advanceGenerationBatch:success=>context.batchSuccess=success,setTimeout:noop};
  vm.createContext(context);await vm.runInContext(poll+'\npollJob()',context);
  assert.equal(values[0].legendReady,status==='done');assert.equal(values[0].legend,status==='done'?fresh:old);assert.equal(values[0].resumeReady,true);assert.equal(values[1].legendReady,false);
  assert.equal(context.batchSuccess,status==='done');assert.equal(saved.length,status==='done'?1:0);if(status==='done')assert.equal(saved[0][0].legendReady,true);assert.deepEqual(published,status==='done'?['target']:[]);assert.equal(context.generationBatch.notionFailed,scenario==='notion_error'?1:0);assert.equal(context.generationBatch.mapFailed||0,scenario==='map_error'?1:0);
 }
});


test('Генерация публикует карту только после подтверждённой легенды в Notion',async()=>{
 const source=await readFile(new URL('./public/app.js',import.meta.url),'utf8');
 const functions=source.slice(source.indexOf('async function publishGeneratedLegendMap('),source.indexOf('async function startNotionBatch('));
 for(const scenario of ['done','notion_error','map_error','map_start_error']){
  const calls=[],messages=[],noop=()=>{},url='https://excalidraw.com/#json=scene-id,AAAAAAAAAAAAAAAAAAAAAA';let mapPolls=0;
  const context={autoNotionStudentId:null,notionEntries:{},notionContainer:null,notionWorkspaceName:'',legendMapEntries:{},renderNotion:noop,renderLegendMap:noop,showJob:(text,error,id)=>messages.push({text,id}),delay:async()=>{},safeLegendMapUrl:url=>url?.startsWith('https://excalidraw.com/#json=')?url:null,
   waitNotionEntry:async id=>{calls.push('notion:confirmed:'+id);return {status:scenario==='notion_error'?'update_error':'done',message:'Notion недоступен'};},
   api:async(route,options)=>{
    calls.push(route+':'+(options?.method||'GET'));
    if(route==='/api/notion/status')return {busy:false,entries:{},workspace:{name:'Test'}};
    if(options?.body)assert.equal(JSON.parse(options.body).studentId,'target');
    if(route==='/api/notion/legend')return {status:'updating'};
    if(options?.method==='POST'){
     if(scenario==='map_start_error')throw Error('Excalidraw занят');
     return {status:'running',studentId:'target',pageId:'page'};
    }
    mapPolls++;return {entries:{target:{status:mapPolls===1?'running':scenario==='map_error'?'error':'done',pageId:'page',url,message:'Карта не создана'}}};
   }};
  vm.createContext(context);
  if(scenario==='done'){
   await vm.runInContext(functions+'\npublishGeneratedLegend("target")',context);
   assert.equal(context.legendMapEntries.target.status,'done');assert.equal(context.legendMapEntries.target.url,url);
   assert.deepEqual(calls,['/api/notion/status:GET','/api/notion/legend:POST','notion:confirmed:target','/api/legend/maps:POST','/api/legend/maps:GET','/api/legend/maps:GET']);
  }else{
   await assert.rejects(vm.runInContext(functions+'\npublishGeneratedLegend("target")',context),error=>scenario==='notion_error'?error.message==='Notion недоступен'&&!error.stage:error.stage==='map');
   if(scenario==='notion_error')assert.equal(calls.some(c=>c.includes('/api/legend/maps')),false);
  }
  assert.equal(context.autoNotionStudentId,null);assert.ok(messages.every(m=>m.id==='target'));
 }
});

test('Очередь не переходит к следующему ученику до завершения публикации карты',async()=>{
 const source=await readFile(new URL('./public/app.js',import.meta.url),'utf8');
 const poll=source.slice(source.indexOf('async function pollJob(){'),source.indexOf("$('#generate').onclick="));
 for(const batch of [false,true]){
  const values=[student('target')],noop=()=>{};let release;
  const publication=new Promise(resolve=>{release=resolve;});
  const events=[],context={students:values,savedStudents:structuredClone(values),generationBatch:{running:true},same:(a,b)=>JSON.stringify(a)===JSON.stringify(b),publishGeneratedLegend:async()=>{events.push('publish');await publication;events.push('map-confirmed');},activeJob:{id:'job',studentId:'target',kind:'legend',signature:'stamp',batch},currentLegendRulesVersion:'',currentRulesVersion:'',sessionStorage:{removeItem:noop},$:()=>({classList:{add:noop}}),current:()=>values[0],api:async()=>({id:'job',status:'done',result:{legend_text:'Текст'}}),scheduleSave:noop,save:async()=>{context.savedStudents=structuredClone(values);events.push('saved');},showJob:noop,toast:noop,renderStudents:noop,renderReadiness:noop,renderResult:noop,renderBatchControls:noop,advanceGenerationBatch:()=>events.push('advance'),setTimeout:noop};
  vm.createContext(context);const pending=vm.runInContext(poll+'\npollJob()',context);
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(events,['saved','publish']);assert.equal(context.activeJob.id,'job');assert.equal(values[0].legendReady,true);
  release();await pending;assert.deepEqual(events,batch?['saved','publish','map-confirmed','advance']:['saved','publish','map-confirmed']);assert.equal(context.activeJob,null);
 }
});
