import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSheet,mergeDriveRows,sheetId,extractCandidateName} from './drive-import.mjs';
import {inputSignature} from './engine.mjs';
const defaults={name:'',telegram:'',resume:'',project:'',age:'',urgent:false,resumeReady:false,jobs:[],result:null};
const row=(fields={})=>({key:'student1',timestamp:'1',row:2,fields:{telegram:'@student1',...fields}});
test('fills blanks, retains manual values, generated resume and ready flag',()=>{
 const original={...defaults,id:'s1',telegram:'@Student1',resumeReady:true,project:'Ручной текст',result:{resume_text:'Готовое резюме'}};
 const {students:[s],report}=mergeDriveRows([original],[row({age:'24',project:'Из таблицы'})],defaults,'2026-09-12');
 assert.equal(s.age,'24');assert.equal(s.project,'Ручной текст');assert.equal(s.resumeReady,true);assert.deepEqual(s.result,original.result);assert.equal(report.created,0);assert.ok(s.driveImport.history.some(h=>h.field==='project'&&h.status==='conflict'&&h.hadResume));
});
test('repeat import is idempotent; source changes update only untouched fields; empty cells never erase',()=>{
 let result=mergeDriveRows([],[row({project:'A',tasks:'one'})],defaults);assert.equal(result.report.created,1);
 let s=result.students[0];s.tasks='manual';
 result=mergeDriveRows([s],[row({project:'B',tasks:'two'})],defaults);s=result.students[0];
 assert.equal(s.project,'B');assert.equal(s.tasks,'manual');assert.equal(result.report.conflicts,1);
 const history=s.driveImport.history.length;
 result=mergeDriveRows([s],[row({project:'B',tasks:'two'})],defaults);assert.equal(result.students[0].driveImport.history.length,history);assert.equal(result.report.updated,0);
 result=mergeDriveRows(result.students,[row()],defaults);assert.equal(result.students[0].project,'B');
});
test('matches changed Telegram by saved submission timestamp, refuses ambiguous students',()=>{
 const old=mergeDriveRows([],[row()],defaults).students;
 const changed={...row({telegram:'@student2'}),key:'student2'};
 assert.equal(mergeDriveRows(old,[changed],defaults).students.length,1);
 assert.throws(()=>mergeDriveRows([{...defaults,id:'a',telegram:'@student1'},{...defaults,id:'b',telegram:'@STUDENT1'}],[row()],defaults),/несколько/);
});
test('source metadata never invalidates resume signature',()=>{
 const s={...defaults,id:'a'};assert.equal(inputSignature(s),inputSignature({...s,driveImport:{sheetId,history:[{foo:'bar'}]}}));
});
test('parses actual Russian headings, booleans, age, missing values and repeated responses',()=>{
 const headers=['Отметка времени','Telegram','Мне нужно резюме, как можно скорее','Где вы сейчас живете?','Ваше резюме в формате pdf','Напишите ваш возраст','Напишите ваш ник на github','Опишите коротко','Напишите, какими бекенд задачами','Напишите самые интересные или сложные задачи'];
 const result=parseSheet([headers,['1','Student1','Нет, могу подождать','РФ','','24 года','Нет проектов','нету','',''],['2','@student2','Да, очень','СНГ','','25','user2','Проект','','']]);
 assert.equal(result.rows[0].fields.age,'24');assert.equal(result.rows[0].fields.urgent,false);assert.equal(result.rows[1].fields.urgent,true);assert.equal(result.rows[0].fields.github,undefined);assert.equal(result.rows[0].fields.project,undefined);
 assert.throws(()=>parseSheet([['different']]),/заголовки/);
});

test('recognizes source names without turning headings into names',()=>{
 assert.equal(extractCandidateName('Обновлено 17 августа 2025\nИгорь Гаврилов\n49 лет'),'Игорь Гаврилов');
 assert.equal(extractCandidateName('Маршалoва Ксения Вадимoвна\nЖенщина'),'Маршалова Ксения Вадимовна');
 assert.equal(extractCandidateName('Опыт Работы\nПрофессиональные Навыки'),'');
});
