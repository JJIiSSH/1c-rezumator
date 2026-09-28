import test from 'node:test';
import assert from 'node:assert/strict';
import {inputSignature,buildLegendPrompt,experienceSettings} from './engine.mjs';
const s={id:'experience',jobs:[],title:'Программист 1С',result:{resume_text:'Пример текущего резюме',changes:[],checks:[]}};
test('Пустое поле стажа совместимо со старой подписью, явное значение делает результат устаревшим',()=>{
 assert.equal(inputSignature(s),inputSignature({...s,targetExperienceYears:''}));
 assert.notEqual(inputSignature(s),inputSignature({...s,targetExperienceYears:'3'}));
 assert.notEqual(inputSignature(s),inputSignature({...s,targetExperienceYears:0}));
});
test('Легенда получает выбранную цель и сохраняет текущий текст источника',()=>{
 const p=buildLegendPrompt({...s,targetExperienceYears:'5.5'},'RULES');const data=JSON.parse(p.split('(JSON):\n')[1]);
 assert.equal(data.experience.target_months,66);assert.equal(data.experience.required_resume_label,'5 лет 6 месяцев');assert.equal(data.experience.overrides_job_dates,true);assert.equal(data.current_resume,s.result.resume_text);
});
test('Стандартный стаж стабилен для ученика и различается между анкетами',()=>{
 const ids=['s2','s3','s5'];
 const months=ids.map(id=>experienceSettings({id}).target_months);
 assert.deepEqual(months,[48,53,48]);
 for(const id of ids)assert.equal(experienceSettings({id}).target_months,experienceSettings({id}).target_months);
 assert.equal(experienceSettings({id:'s3',age:'20'}).target_months,49);
 assert.equal(experienceSettings({id:'s6',age:'22'}).target_months,48);
 assert.equal(experienceSettings({id:'s2',age:'25'}).target_months,48);
 assert.equal(experienceSettings({id:'drive_f546eee4a982277112f808a7',age:'24'}).target_months,49);
 assert.equal(experienceSettings({id:'s2',targetExperienceYears:'5,2'}).target_months,62);
});
