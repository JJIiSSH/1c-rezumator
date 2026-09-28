import test from 'node:test';
import assert from 'node:assert/strict';
import {hasCandidateData,studentsMissingResume,notionEntryPreventsDuplicate,studentsPendingNotion} from './batch-operations.mjs';

const student=(id,extra={})=>({id,jobs:[],name:'Ученик '+id,result:null,...extra});

test('Массовая генерация выбирает только заполненные анкеты без резюме',()=>{
 const blank={id:'blank',jobs:[],name:'',telegram:'',resume:'',project:'',tasks:'',complex:''};
 const existing=student('ready',{result:{resume_text:'Готовое резюме'}});
 const missing=student('missing');
 assert.equal(hasCandidateData(blank),false);
 assert.deepEqual(studentsMissingResume([blank,existing,missing]).map(s=>s.id),['missing']);
});

test('Массовый экспорт Notion пропускает существующие и неопределённые страницы',()=>{
 const students=[student('new',{result:{resume_text:'Новое'}}),student('done',{result:{resume_text:'Есть'}}),student('uncertain',{result:{resume_text:'Неясно'}}),student('error',{result:{resume_text:'Повторить'}}),student('empty')];
 const entries={done:{pageId:'page-1',status:'done'},uncertain:{status:'uncertain'},error:{status:'error'}};
 assert.equal(notionEntryPreventsDuplicate(entries.done),true);
 assert.equal(notionEntryPreventsDuplicate(entries.uncertain),true);
 assert.equal(notionEntryPreventsDuplicate(entries.error),false);
 assert.deepEqual(studentsPendingNotion(students,entries).map(s=>s.id),['new','error']);
});
