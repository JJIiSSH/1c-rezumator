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
