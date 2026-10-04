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
 for(const status of ['done','error','cancelled']){
  const old={legend_text:'Старая легенда'},fresh={legend_text:'Новый рассказ',rules_version:'rules'};
  const values=[student('target',{legend:old,legendReady:false,resumeReady:true}),student('selected',{legendReady:false})];
  const noop=()=>{},saved=[];
  const context={students:values,activeJob:{id:'job',studentId:'target',kind:'legend',signature:'stamp',batch:true},currentLegendRulesVersion:'',currentRulesVersion:'',sessionStorage:{removeItem:noop},$:()=>({classList:{add:noop}}),current:()=>values[1],api:async()=>({id:'job',status,result:status==='done'?fresh:null,message:'Остановлено'}),scheduleSave:noop,save:async()=>saved.push(structuredClone(values)),showJob:noop,toast:noop,renderStudents:noop,renderReadiness:noop,renderResult:noop,renderBatchControls:noop,advanceGenerationBatch:success=>context.batchSuccess=success,setTimeout:noop};
  vm.createContext(context);await vm.runInContext(poll+'\npollJob()',context);
  assert.equal(values[0].legendReady,status==='done');assert.equal(values[0].legend,status==='done'?fresh:old);assert.equal(values[0].resumeReady,true);assert.equal(values[1].legendReady,false);
  assert.equal(context.batchSuccess,status==='done');assert.equal(saved.length,status==='done'?1:0);if(status==='done')assert.equal(saved[0][0].legendReady,true);
 }
});
