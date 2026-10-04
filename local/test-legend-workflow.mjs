import test from 'node:test';
import assert from 'node:assert/strict';
import {produceMaterial} from './material-workflow.mjs';
import {validateLegendPlan} from './legend-plan.mjs';
import {parseLegendResult,buildLegendReviewPrompt} from './engine.mjs';
import {plan,result,student} from './test-fixtures/legend.mjs';
import {currentMonth} from './resume-chronology.mjs';

test('Два прохода: проверенный план сохраняется, этапы и расход обоих вызовов доступны',async()=>{
 const calls=[],stages=[];const revised=structuredClone(result);revised.case_plan.cases[0].solution='Проверенное решение';
 const generated=await produceMaterial({student,rules:'Правила',kind:'legend',onStage:n=>stages.push(n),run:async(step,prompt)=>{calls.push({step,prompt});return {text:JSON.stringify(step==='legend-plan'?plan:revised),usage:{input_tokens:10,output_tokens:20}};}});
 assert.deepEqual(calls.map(c=>c.step),['legend-plan','legend']);assert.deepEqual(stages,[1,2]);
 assert.match(calls[1].prompt,/current_resume/);assert.match(calls[1].prompt,/case_plan/);assert.equal(generated.case_plan.cases[0].solution,'Проверенное решение');assert.equal(generated.generation_passes,2);assert.equal(generated.usage.passes.length,2);
 assert.deepEqual(student.legend,result);
});
test('Некорректный план и отмена после первого прохода не запускают второй',async()=>{
 let calls=0;const bad=structuredClone(plan);bad.failures[0].environment='production';
 await assert.rejects(produceMaterial({student,rules:'',kind:'legend',run:async()=>{calls++;return {text:JSON.stringify(bad)};}}),/тестовых/);assert.equal(calls,1);
 calls=0;let cancelled=false;
 await assert.rejects(produceMaterial({student,rules:'',kind:'legend',isCancelled:()=>cancelled,run:async()=>{calls++;cancelled=true;return {text:JSON.stringify(plan)};}}),/остановлена/);assert.equal(calls,1);
});
test('Схема защищает число факапов, связи и финальные проверенные карточки',async()=>{
 for(const mutation of [p=>p.failures.pop(),p=>p.failures.push(...p.failures),p=>p.cases[0].employer_id='missing',p=>p.failures[0].case_id='missing',p=>p.cases[1].id=p.cases[0].id]){const p=structuredClone(plan);mutation(p);assert.throws(()=>validateLegendPlan(p));}
 assert.doesNotThrow(()=>parseLegendResult(JSON.stringify({...result,case_plan:plan})));
 let calls=0;const {case_plan,...legacy}=result;
 await assert.rejects(produceMaterial({student,rules:'',kind:'legend',run:async()=>({text:JSON.stringify(++calls===1?plan:legacy)})}),/проверенные карточки/);
});
test('Резюме остаётся одним проходом; проверка легенды не повторяет старый PDF',async()=>{
 const now=currentMonth(),stamp=n=>`${Math.floor(n/12)}-${String(n%12+1).padStart(2,'0')}`;
 const resume={...student.result,resume_text:`Опыт работы: 4 года\nКомпания А\n${stamp(now-23)} - по настоящее время\nКомпания Б\n${stamp(now-47)} - ${stamp(now-24)}`};
 const calls=[];await produceMaterial({student:{...student,targetExperienceYears:'4'},rules:'',kind:'resume',run:async step=>{calls.push(step);return {text:JSON.stringify(resume)};}});assert.deepEqual(calls,['resume']);
 const prompt=buildLegendReviewPrompt({...student,resume:'Устаревшая уникальная биография'},'',plan);assert.ok(!prompt.includes('Устаревшая уникальная биография'));assert.ok(prompt.includes(student.result.resume_text.replace(/\n/g,'\\n')));
});
test('Вакансия доступна обоим этапам, сохраняя текущее резюме и выключенные метрики',async()=>{
 const vacancy='Вакансия: интеграция с маркетплейсами; 1000 запросов в секунду. Хочу задачи обмена данными.';
 const source={...student,legendNotes:vacancy,fillMetrics:false,metrics:[{label:'Пользователи',value:'1000',context:'Из вакансии'}]};
 const original=structuredClone(source),inputs=[];
 await produceMaterial({student:source,rules:'Общие правила',kind:'legend',run:async(step,prompt)=>{
  const input=JSON.parse(prompt.split('(JSON):\n')[1].split('\n\nЭТАП СЕРВИСА:')[0]);inputs.push(input);
  return {text:JSON.stringify(step==='legend-plan'?plan:result)};
 }});
 assert.equal(inputs.length,2);
 for(const input of inputs){assert.equal(input.legend_notes,vacancy);assert.equal(input.current_resume,source.result.resume_text);assert.equal(input.settings.metrics_mode,'off');assert.deepEqual(input.metrics,[]);}
 assert.deepEqual(source,original);assert.deepEqual(inputs[1].case_plan,plan);
});
test('Служебные оговорки в готовом ответе отклоняются, вопросы проверки остаются отдельно',async()=>{
 const leaked={...result,legend_text:'## Причина ухода\nПричина не указана в исходных данных. Нужен мой фактический ответ.'};
 await assert.rejects(produceMaterial({student,rules:'',kind:'legend',run:async step=>({text:JSON.stringify(step==='legend-plan'?plan:leaked)})}),/служебные замечания/);
 const ready={...result,legend_text:'## Почему ищу работу\nВариант 1: Хочу развивать обмены и интеграции в 1С.\nВариант 2: Интересна ответственность за развитие одной системы.',questions:['Выбрать вариант мотивации; нужно уточнить.']};
 const generated=await produceMaterial({student,rules:'',kind:'legend',run:async step=>({text:JSON.stringify(step==='legend-plan'?plan:ready)})});assert.deepEqual(generated.questions,ready.questions);
});
test('Правило готовности отличает служебную оговорку от нормального сбора требований',async()=>{const {assertReadyLegend}=await import('./legend-content.mjs');assert.doesNotThrow(()=>assertReadyLegend('Перед доработкой необходимо уточнить требования пользователя. Затем проверяю формат обмена.'));assert.throws(()=>assertReadyLegend('Реальную причину ухода нужно уточнить.'),/служебные/);});
