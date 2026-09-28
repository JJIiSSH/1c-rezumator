import test from 'node:test';
import assert from 'node:assert/strict';
import {studentStatus,inputSignature,legendSignature,buildPrompt,validateStudent} from './engine.mjs';

test('Срочность сохраняется после генерации и возвращается после снятия готовности',()=>{
 const s={id:'test',jobs:[],urgent:true};
 assert.equal(studentStatus(s).label,'Требуется срочно');
 s.result={resume_text:'Программист 1С',checks:[],changes:[]};
 assert.equal(studentStatus(s).label,'Требуется срочно');
 s.resumeReady=true;
 assert.equal(studentStatus(s).label,'Готово');
 assert.equal(s.urgent,true);
 s.resumeReady=false;
 assert.equal(studentStatus(s).label,'Требуется срочно');
 assert.equal(studentStatus({...s,urgent:false}).label,'Есть черновик');
});

test('Ручная готовность сохраняется в JSON и не делает резюме или легенду устаревшими',()=>{
 const s={id:'test',jobs:[],result:{resume_text:'Программист 1С',checks:[],changes:[]}};
 const ready=JSON.parse(JSON.stringify({...s,resumeReady:true}));
 assert.equal(studentStatus(validateStudent(ready)).label,'Готово');
 assert.equal(inputSignature(ready),inputSignature(s));
 assert.equal(legendSignature(ready),legendSignature(s));
 assert.equal(buildPrompt(ready,'RULES'),buildPrompt(s,'RULES'));
 assert.throws(()=>validateStudent({...s,resumeReady:'true'}));
});
