import test from 'node:test';
import assert from 'node:assert/strict';
import {experienceSettings} from './engine.mjs';
import {currentMonth,countExperience,resumePeriods,finalizeResumeChronology,repairStoredChronology} from './resume-chronology.mjs';
const asOf=2026*12+9;
const sample=(first,second,label='0 месяцев')=>({resume_text:`Опыт работы: ${label}\nКомпания А\nПрограммист 1С\n${first}\n- Обмен данными\nСтек: УТ 11.5\nКомпания Б\nПрограммист 1С\n${second}\n- Отчёты\nСтек: БП 3.0\nОбразование\nУниверситет`,summary:'Черновик',checks:[],questions:[],changes:[]});
const student={id:'s2',jobs:[],targetExperienceYears:''};
test('Ноль возвращает стандартный стаж, календарь использует московский месяц',()=>{
 for(const value of [0,'0','0.0','0,00'])assert.deepEqual(experienceSettings({...student,targetExperienceYears:value}),experienceSettings(student));
 assert.equal(currentMonth(new Date('2026-09-30T21:30:00Z')),asOf);
});
test('Проверка вычисляет заголовок по периодам с включёнными граничными месяцами',()=>{
 const r=sample('Ноябрь 2024 - по настоящее время','Ноябрь 2022 - Октябрь 2024');
 const updated=finalizeResumeChronology(r,student,{asOf});assert.match(updated.resume_text,/Опыт работы: 4 года\n/);assert.match(updated.resume_text,/- Обмен данными/);assert.match(r.resume_text,/0 месяцев/);
 assert.deepEqual(finalizeResumeChronology(updated,student,{asOf}),updated);
});
test('Закрытая последняя работа, отсутствующие даты, пересечение и неверная сумма не сохраняются',()=>{
 for(const r of [{...sample('',''),resume_text:'Программист 1С'},sample('Ноябрь 2024 - сентябрь 2026','Ноябрь 2022 - Октябрь 2024'),sample('Период: не указан','Период: не указан'),sample('Октябрь 2024 - настоящее время','Ноябрь 2022 - Октябрь 2024'),sample('Ноябрь 2025 - настоящее время','Ноябрь 2024 - Октябрь 2025')])assert.throws(()=>finalizeResumeChronology(r,student,{asOf}));
});
test('Ремонт нулевого резюме добавляет два периода, сохраняет компании и задачи',()=>{
 const old=sample('Период: не указан','Период: не указан');const source={...student,targetExperienceYears:'0',result:old};
 const repaired=repairStoredChronology(source,{asOf});const dates=resumePeriods(repaired.resume_text,asOf);
 assert.equal(countExperience(dates.periods),48);assert.equal(dates.periods[0].current,true);assert.ok(dates.periods[1].end<dates.periods[0].start);assert.match(repaired.resume_text,/Опыт работы: 4 года/);
 assert.match(repaired.resume_text,/Компания А/);assert.match(repaired.resume_text,/- Обмен данными/);assert.match(repaired.resume_text,/Стек: БП 3.0/);assert.equal(source.result,old);assert.match(old.resume_text,/0 месяцев/);
});
test('Продление закрытой работы сдвигает хронологию, сохраняя суммарный стаж',()=>{
 const source={...student,result:sample('Январь 2023 - январь 2026','Ноябрь 2021 - декабрь 2022','4 года 3 месяца')};
 const r=repairStoredChronology(source,{asOf});const dates=resumePeriods(r.resume_text,asOf);assert.equal(countExperience(dates.periods),51);assert.equal(dates.periods[0].end,asOf);assert.match(r.resume_text,/по настоящее время/);assert.match(r.resume_text,/4 года 3 месяца/);
});
test('Явные 5,2 года сохраняют приоритет после смены текущего месяца',()=>{
 const source={...student,targetExperienceYears:'5,2',result:sample('Март 2023 - настоящее время','Август 2021 - февраль 2023','5 лет 2 месяца')};
 const r=repairStoredChronology(source,{asOf});assert.equal(countExperience(resumePeriods(r.resume_text,asOf).periods),62);assert.doesNotThrow(()=>finalizeResumeChronology(r,source,{asOf}));
});
