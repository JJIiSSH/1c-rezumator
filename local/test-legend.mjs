import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLegendPrompt,inputSignature,legendSignature,parseLegendResult,validateStudent} from './engine.mjs';
const result={resume_text:'Компания А\nПрограммист 1С\n2023-01 - настоящее время\nУТ 11.5, 150 пользователей',summary:'Черновик',checks:[],questions:[],changes:['Предложенная метрика: 150 пользователей']};
const student={id:'test',jobs:[],resume:'Старый опыт на Python',result,fillMetrics:true,metrics:[{label:'Пользователи',value:'150',context:'Компания А'}]};
const legend={legend_text:'Рассказ — тест\n• Мой вклад',summary:'Черновик',checks:[{label:'Факап',status:'clarify',detail:'Предложенный сценарий',evidence:''}],questions:[],changes:['Предложенный сценарий: ошибка обмена']};
test('Легенда требует текущего резюме и передаёт ручные правки и происхождение метрик',()=>{
 assert.throws(()=>buildLegendPrompt({...student,result:null},'rules'),/Сначала создайте/);
 const s={...student,result:{...result,resume_text:'Ручная правка: Компания Б, 347 пользователей'},legendNotes:'Подробно про обмен'};
 const data=JSON.parse(buildLegendPrompt(s,'rules').split('(JSON):\n')[1]);
 assert.equal(data.current_resume,s.result.resume_text);assert.equal(data.legend_notes,s.legendNotes);
 assert.deepEqual(data.resume_changes,result.changes);assert.equal(data.settings.metrics_mode,'provided');
 assert.equal(data.candidate.old_resume,student.resume);
 const off=JSON.parse(buildLegendPrompt({...s,fillMetrics:false},'rules').split('(JSON):\n')[1]);
 assert.equal(off.settings.metrics_mode,'off');assert.deepEqual(off.metrics,[]);
});
test('Легенда не делает резюме устаревшим, но реагирует на изменение резюме и своего контекста',()=>{
 const original=inputSignature(student),stamp=legendSignature(student);
 const edited={...student,legend,legendSignature:stamp,legendNotes:''};
 assert.equal(inputSignature(edited),original);assert.equal(legendSignature(edited),stamp);
 assert.notEqual(legendSignature({...edited,legendNotes:'Другой проект'}),stamp);
 assert.equal(inputSignature({...edited,legendNotes:'Другой проект'}),original);
 assert.notEqual(legendSignature({...edited,result:{...result,resume_text:'Изменённое резюме'}}),stamp);
 assert.notEqual(legendSignature({...edited,result:{...result,changes:[]}}),stamp);
 assert.equal(legendSignature({...edited,legend:{...legend,legend_text:'Ручная правка легенды'}}),stamp);
});
test('Разбор легенды сохраняет проверки, нормализует текст и отклоняет неполные ответы',()=>{
 const r=parseLegendResult(JSON.stringify(legend));assert.equal(r.legend_text,'Рассказ - тест\n- Мой вклад');
 assert.deepEqual(r.checks,legend.checks);assert.ok(!('resume_text' in r));
 assert.throws(()=>parseLegendResult(JSON.stringify(result)));
 assert.throws(()=>parseLegendResult(JSON.stringify({...legend,legend_text:''})));
 assert.throws(()=>parseLegendResult(JSON.stringify({...legend,checks:[{status:'unknown'}]})));
});
test('Легенда, её правки и пустой редактор сохраняются вместе с анкетой',()=>{
 const stored=JSON.parse(JSON.stringify({...student,legend,legendNotes:'Контекст',legendSignature:'stamp'}));
 assert.doesNotThrow(()=>validateStudent(stored));assert.deepEqual(stored.result,result);assert.deepEqual(stored.legend,legend);
 assert.doesNotThrow(()=>validateStudent({...stored,legend:{...legend,legend_text:''}}));
 assert.throws(()=>validateStudent({...stored,legendNotes:42}));
 assert.throws(()=>validateStudent({...stored,legend:{...legend,legend_text:'x'.repeat(120001)}}));
});
