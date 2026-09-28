import test from 'node:test';
import assert from 'node:assert/strict';
import {studentChanges,applyStudentChanges,keepPendingEdits} from './state-sync.mjs';
const base=[{id:'s1',jobs:[],name:'Ученик',resumeReady:false,urgent:true,notes:'',result:{resume_text:'Прежний текст'}},{id:'s2',jobs:[],name:'Другой',notes:''}];
test('Старая вкладка не снимает готовность при сохранении другого поля или ученика',()=>{
 const chrome=structuredClone(base),iab=structuredClone(base);chrome[0].resumeReady=true;iab[0].notes='Свои заметки';iab[1].name='Изменённое имя';
 const server=applyStudentChanges(base,studentChanges(base,chrome));assert.deepEqual(server.conflicts,[]);
 const merged=applyStudentChanges(server.students,studentChanges(base,iab));assert.deepEqual(merged.conflicts,[]);assert.equal(merged.students[0].resumeReady,true);assert.equal(merged.students[0].urgent,true);assert.equal(merged.students[0].notes,'Свои заметки');assert.equal(merged.students[1].name,'Изменённое имя');
 assert.equal(base[0].resumeReady,false);
});
test('Одновременные изменения одного поля выявляются, одинаковая повторная запись допустима',()=>{
 const one=structuredClone(base),two=structuredClone(base);one[0].notes='Первый';two[0].notes='Второй';
 const server=applyStudentChanges(base,studentChanges(base,one)).students;
 const conflict=applyStudentChanges(server,studentChanges(base,two));assert.deepEqual(conflict.conflicts,['s1:notes']);assert.equal(server[0].notes,'Первый');
 assert.deepEqual(applyStudentChanges(server,studentChanges(base,one)).conflicts,[]);
});
test('Ответ сохранения сохраняет ввод, сделанный во время запроса',()=>{
 const sent=structuredClone(base);sent[0].notes='Отправлено';const current=structuredClone(sent);current[0].notes='Допечатано';const remote=structuredClone(sent);remote[0].resumeReady=true;
 const merged=keepPendingEdits(sent,current,remote);assert.equal(merged[0].notes,'Допечатано');assert.equal(merged[0].resumeReady,true);assert.deepEqual(Object.keys(studentChanges(remote,merged)[0].fields),['notes']);
});
test('Добавления в разных вкладках не удаляют новых учеников друг друга',()=>{
 const one=[...structuredClone(base),{id:'new1',jobs:[],name:'Один'}],two=[...structuredClone(base),{id:'new2',jobs:[],name:'Два'}];
 const result=applyStudentChanges(applyStudentChanges(base,studentChanges(base,one)).students,studentChanges(base,two));assert.equal(result.students.length,4);assert.deepEqual(result.conflicts,[]);
});
test('Изменение вложенного текста не мутирует базовую копию, опасные ключи отклоняются',()=>{
 const local=structuredClone(base);local[0].result.resume_text='Правка';const delta=studentChanges(base,local);assert.deepEqual(Object.keys(delta[0].fields),['result']);assert.equal(applyStudentChanges(base,delta).students[0].result.resume_text,'Правка');assert.equal(base[0].result.resume_text,'Прежний текст');
 assert.throws(()=>applyStudentChanges(base,JSON.parse('[{"id":"s1","fields":{"__proto__":{"value":{}}}}]')),/Недопустимое/);
});
