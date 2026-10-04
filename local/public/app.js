import {same,studentChanges,keepPendingEdits} from '/state-sync.mjs';
import {completeness,normalizeResumeText,inputSignature,legendSignature,studentStatus} from '/engine.mjs';
import {legendHtml} from '/legend-format.mjs';
import {batchResumeEligible,studentsMissingResume,studentsWithoutReadyResume,studentsPendingNotion,notionEntryPreventsDuplicate} from '/batch-operations.mjs';
const $=s=>document.querySelector(s);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let students=[],selected='',tab='questionnaire',token='',currentRulesVersion='',currentLegendRulesVersion='',resultView='resume',generationStarting=false,connected=false,activeJob=null,saveTimer=null,toastTimer=null;
let notionEntries={},notionContainer=null,notionTimer=null,notionWorkspaceName='',generationBatch=null,notionBatch=null;
const jobMessages=new Map();
let startingStudentId=null;
let savedStudents=[],saving=false,syncing=false,statePoll=null,loaded=false;
const blank={name:'',telegram:'',age:'',github:'',location:'РФ',urgent:false,resumeReady:false,sourceUrl:'',project:'',configurations:'',tasks:'',complex:'',resume:'',pdfName:'',title:'Программист 1С',track:'Универсальный профиль',targetExperienceYears:'',notes:'',showAge:false,showGithub:true,fillMetrics:true,metrics:[],jobs:[],result:null,resultSignature:'',legend:null,legendSignature:'',legendNotes:''};
function current(){return students.find(s=>s.id===selected);}
function signature(s){return inputSignature(s);}
function toast(text){$('#toast').textContent=text;$('#toast').classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.add('hidden'),4500);}
async function api(url,opts={}){
 let r=await fetch(url,{...opts,headers:{'x-rezumator-token':token,...opts.headers}});
 if(r.status===403){token=(await(await fetch('/api/session')).json()).token;r=await fetch(url,{...opts,headers:{'x-rezumator-token':token,...opts.headers}});}
 let d;try{d=await r.json();}catch{throw new Error('Локальный сервер недоступен. Перезапустите 1с-резюматор.');}
 if(!r.ok){const e=new Error(d.error||'Не удалось выполнить запрос');e.status=r.status;throw e;}return d;
}
function replaceLocalState(next){
 const oldCurrent=structuredClone(current());
 students=next.map(remote=>{const local=students.find(s=>s.id===remote.id);if(!local)return remote;for(const [k,v]of Object.entries(remote))if(!same(local[k],v))local[k]=v;return local;});
 if(!current())selected=students[0]?.id||'';
 if(!current())return;
 renderStudents();
 if(same(oldCurrent,current()))return;
 const focused=document.activeElement;
 const selector=focused?.id?'#'+CSS.escape(focused.id):focused?.dataset.field?'[data-field="'+CSS.escape(focused.dataset.field)+'"]':focused?.dataset.job!==undefined?'[data-job="'+focused.dataset.job+'"][data-key="'+CSS.escape(focused.dataset.key)+'"]':focused?.dataset.metric!==undefined?'[data-metric="'+focused.dataset.metric+'"][data-key="'+CSS.escape(focused.dataset.key)+'"]':null;
 const cursor={start:focused?.selectionStart,end:focused?.selectionEnd,scroll:focused?.scrollTop};
 render();
 const restored=selector?$(selector):null;if(restored){restored.focus({preventScroll:true});if(cursor.start!=null&&restored.setSelectionRange)restored.setSelectionRange(cursor.start,cursor.end);restored.scrollTop=cursor.scroll||0;}
}
async function save(){
 clearTimeout(saveTimer);saveTimer=null;if(saving||!loaded)return;
 const sent=structuredClone(students),changes=studentChanges(savedStudents,sent);if(!changes.length)return;
 saving=true;$('#saveStatus').textContent='Сохраняем…';
 try{
  const response=await api('/api/state/changes',{method:'POST',body:JSON.stringify(changes),headers:{'Content-Type':'application/json'}});
  const next=keepPendingEdits(sent,students,response.students);savedStudents=structuredClone(response.students);replaceLocalState(next);
  $('#saveStatus').textContent='Сохранено на компьютере';
  if(studentChanges(savedStudents,students).length)scheduleSave();
 }catch(e){$('#saveStatus').textContent='Не сохранено';toast(e.message);}finally{saving=false;}
}
function scheduleSave(){clearTimeout(saveTimer);$('#saveStatus').textContent='Есть изменения';saveTimer=setTimeout(save,600);}
async function syncState(){
 if(!loaded||syncing||saving||studentChanges(savedStudents,students).length)return;
 syncing=true;const start=structuredClone(savedStudents);
 try{
  const remote=await api('/api/state');
  // Ignore an old read that overtook a save or new local edit.
  if(saving||!same(start,savedStudents)||studentChanges(savedStudents,students).length)return;
  if(!same(remote,savedStudents)){savedStudents=structuredClone(remote);replaceLocalState(remote);$('#saveStatus').textContent='Обновлено из другого окна';}
 }catch(e){$('#saveStatus').textContent='Нет связи с сервером';}finally{syncing=false;}
}
function startStateSync(){clearInterval(statePoll);statePoll=setInterval(syncState,2000);window.addEventListener('focus',syncState);document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncState();});}
function input(key,label,placeholder='',type='text'){const s=current();return `<label class="field"><span>${label}</span><input data-field="${key}" type="${type}" value="${escape(s[key])}" placeholder="${placeholder}" ${key==='age'?'min="14" max="100"':''}></label>`;}
function textarea(key,label,placeholder='',hint=''){return `<label class="field"><span>${label}</span><textarea data-field="${key}" placeholder="${placeholder}">${escape(current()[key])}</textarea>${hint?`<small>${hint}</small>`:''}</label>`;}
function checkbox(key,label){return `<label class="check-label"><input data-field="${key}" type="checkbox" ${current()[key]?'checked':''}>${label}</label>`;}
const configurationGroups=[
 [
  "Торговля и малый бизнес",
  [
   [
    "УТ 11.5",
    "Управление торговлей — 11.5"
   ],
   [
    "УТ 11.4",
    "Управление торговлей — 11.4"
   ],
   [
    "УТ 10.3",
    "Управление торговлей — 10.3"
   ],
   [
    "УНФ 3.0",
    "Управление нашей фирмой — 3.0"
   ],
   [
    "УНФ 1.6",
    "Управление нашей фирмой — 1.6"
   ],
   [
    "Розница 3.0",
    "Розница — 3.0"
   ],
   [
    "Розница 2.3",
    "Розница — 2.3"
   ]
  ]
 ],
 [
  "Бухгалтерия",
  [
   [
    "БП 3.0",
    "Бухгалтерия предприятия — 3.0"
   ],
   [
    "БП 2.0",
    "Бухгалтерия предприятия — 2.0"
   ],
   [
    "БП КОРП 3.0",
    "Бухгалтерия предприятия КОРП — 3.0"
   ],
   [
    "БП КОРП 2.0",
    "Бухгалтерия предприятия КОРП — 2.0"
   ]
  ]
 ],
 [
  "Зарплата и кадры",
  [
   [
    "ЗУП 3.1",
    "Зарплата и управление персоналом — 3.1"
   ],
   [
    "ЗУП 2.5",
    "Зарплата и управление персоналом — 2.5"
   ],
   [
    "ЗУП КОРП 3.1",
    "Зарплата и управление персоналом КОРП — 3.1"
   ],
   [
    "ЗУП КОРП 2.5",
    "Зарплата и управление персоналом КОРП — 2.5"
   ]
  ]
 ],
 [
  "ERP и производство",
  [
   [
    "ERP 2.5",
    "ERP Управление предприятием — 2.5"
   ],
   [
    "ERP 2.4",
    "ERP Управление предприятием — 2.4"
   ],
   [
    "КА 2.5",
    "Комплексная автоматизация — 2.5"
   ],
   [
    "КА 2.4",
    "Комплексная автоматизация — 2.4"
   ],
   [
    "УПП 1.3",
    "Управление производственным предприятием — 1.3"
   ]
  ]
 ],
 [
  "Управление холдингом",
  [
   [
    "Управление холдингом 3.3",
    "Управление холдингом — 3.3"
   ],
   [
    "Управление холдингом 3.2",
    "Управление холдингом — 3.2"
   ],
   [
    "ERP. Управление холдингом 3.2",
    "ERP. Управление холдингом — 3.2"
   ]
  ]
 ],
 [
  "Документооборот",
  [
   [
    "Документооборот 3.0",
    "Документооборот — 3.0 (вариант не указан)"
   ],
   [
    "Документооборот 2.1",
    "Документооборот — 2.1 (вариант не указан)"
   ],
   [
    "Документооборот КОРП 3.0",
    "Документооборот КОРП — 3.0"
   ],
   [
    "Документооборот КОРП 2.1",
    "Документооборот КОРП — 2.1"
   ],
   [
    "Документооборот ПРОФ 3.0",
    "Документооборот ПРОФ — 3.0"
   ],
   [
    "Документооборот ПРОФ 2.1",
    "Документооборот ПРОФ — 2.1"
   ]
  ]
 ],
 [
  "Государственные учреждения",
  [
   [
    "БГУ 2.0",
    "Бухгалтерия государственного учреждения — 2.0"
   ],
   [
    "БГУ КОРП 2.0",
    "Бухгалтерия государственного учреждения КОРП — 2.0"
   ],
   [
    "ЗКГУ 3.1",
    "Зарплата и кадры государственного учреждения — 3.1"
   ],
   [
    "Документооборот государственного учреждения 3.0",
    "Документооборот государственного учреждения — 3.0"
   ],
   [
    "Документооборот государственного учреждения 2.1",
    "Документооборот государственного учреждения — 2.1"
   ]
  ]
 ],
 [
  "CRM, склад и транспорт",
  [
   [
    "1С:CRM ПРОФ 3.1",
    "CRM ПРОФ — 3.1"
   ],
   [
    "1С:CRM КОРП 3.1",
    "CRM КОРП — 3.1"
   ],
   [
    "Управление торговлей и взаимоотношениями с клиентами (CRM) 3.1",
    "Управление торговлей и CRM — 3.1"
   ],
   [
    "1С:WMS Логистика. Управление складом 5.0",
    "WMS Логистика. Управление складом — 5.0"
   ],
   [
    "Управление автотранспортом Стандарт 2.2",
    "Управление автотранспортом Стандарт — 2.2"
   ]
  ]
 ],
 [
  "Собственные решения",
  [
   [
    "Самописная конфигурация 1С",
    "Самописная конфигурация 1С"
   ]
  ]
 ]
];
const configurationOptions=configurationGroups.flatMap(([,options])=>options);
function configurationPicker(){return `<div class="configuration-picker"><label class="field" for="configurationPreset"><span>Конфигурации 1С · выбор из списка</span></label><div class="configuration-picker-row"><select id="configurationPreset" aria-describedby="configurationHint"><option value="">Выбери конфигурацию и версию</option>${configurationGroups.map(([group,options])=>`<optgroup label="${escape(group)}">${options.map(([value,label])=>`<option value="${escape(value)}">${escape(label)}</option>`).join('')}</optgroup>`).join('')}</select><button type="button" class="secondary-button" id="addConfiguration" disabled>Добавить</button></div><p id="configurationHint">В списке ${configurationOptions.length} варианта по направлениям, включая прежние редакции для прошлых мест работы. Можно добавить несколько. Свой вариант или точный релиз впиши ниже; пустое поле подберём по контексту.</p>${textarea('configurations','Выбранные конфигурации и дополнения','Например: УТ 11.5; БП 3.0','Здесь можно изменить или удалить выбранное. Всё сохранится в анкете и попадёт в промпт.')}</div>`;}
const metricPresets=[
 ['Количество пользователей','Например: 100 пользователей'],
 ['Объём информационной базы','Например: 200 ГБ'],
 ['Объём загрузки данных','Например: 50 000 строк'],
 ['Количество баз в обмене','Например: 8 баз'],
 ['Количество интеграций','Например: 4 интеграции'],
 ['Количество перенесённых объектов','Например: 30 объектов'],
 ['Время загрузки данных','Например: с 25 до 10 минут'],
 ['Время формирования отчёта','Например: с 4 до 1 минуты'],
 ['Ускорение формирования отчёта','Например: в 3 раза'],
 ['Время подготовки управленческой отчётности','Например: с 4 часов до 30 минут'],
 ['Сокращение обращений в поддержку','Например: на 25%'],
 ['Количество доработок, перенесённых в расширения','Например: 20 доработок'],
 ['Количество подразделений с разграничением доступа','Например: 6 подразделений'],
 ['Количество подключённых маркетплейсов','Например: 2 маркетплейса'],
 ['Сокращение ручных операций','Например: на 30%'],
 ['Количество документов в день','Например: 2 000 документов в день']
];
function metricsEditor(){const s=current();return `<section class="metrics-editor"><div class="section-title"><div><h3>Метрики</h3><p>Масштаб работы и результаты в цифрах.</p></div></div>${checkbox('fillMetrics','Заполнять метрики')}<p class="metrics-hint">${s.fillMetrics!==false?'Готовые значения используем как указано. Пустые дополним правдоподобными цифрами и отметим их в «Что изменено». Если список пуст, предложим метрики сами.':'Метрики не попадут в новое резюме. Введённые значения сохранятся; даты и версии конфигураций останутся.'}</p><fieldset class="metrics-fields" ${s.fillMetrics===false?'disabled':''}><legend class="visually-hidden">Список метрик</legend><div class="configuration-picker-row"><select id="metricPreset" aria-label="Выбрать метрику"><option value="">Своя метрика</option>${metricPresets.map(([label])=>`<option value="${escape(label)}">${escape(label)}</option>`).join('')}</select><button type="button" class="secondary-button" id="addMetric">Добавить</button></div><div>${(s.metrics||[]).map((m,i)=>metricCard(m,i)).join('')}</div></fieldset></section>`;}
function metricCard(m,i){const hint=metricPresets.find(([label])=>label===m.label)?.[1]||'Например: 100; 30%; с 20 до 8 минут';return `<div class="metric-card"><div class="job-card-head"><strong>Метрика ${i+1}</strong><button type="button" class="danger-link" data-remove-metric="${i}" aria-label="Удалить метрику ${i+1}">Убрать</button></div><label class="field"><span>Что измеряем</span><input data-metric="${i}" data-key="label" value="${escape(m.label)}" maxlength="500" placeholder="Выбери вариант выше или напиши свою метрику"></label><label class="field"><span>Значение</span><input data-metric="${i}" data-key="value" value="${escape(m.value)}" maxlength="500" placeholder="${escape(hint)}"><small>Число с единицей измерения или значения до и после. Можно оставить пустым.</small></label><label class="field"><span>Место работы или задача · необязательно</span><input data-metric="${i}" data-key="context" value="${escape(m.context)}" maxlength="500" placeholder="Например: последний работодатель, загрузка прайс-листов"></label></div>`;}
let driveTimer=null,driveBusy=false;
function renderDriveHistory(s){
 const d=s.driveImport;if(!d)return '';
 const history=d.history||[],pending=history.filter(h=>!h.reviewedAt);
 const format=v=>typeof v==='boolean'?(v?'Да':'Нет'):String(v||'Не заполнено');
 return `<section class="drive-history"><strong>Данные из Google Drive</strong><p>Проверено: ${escape(new Date(d.lastImportedAt).toLocaleString('ru'))}. <a href="${escape(d.url)}" target="_blank" rel="noopener noreferrer">Открыть таблицу</a></p>${s.result?.resume_text&&pending.length?'<p class="drive-alert">После создания резюме найдены дополнения или расхождения. Проверь их перед обновлением резюме.</p>':''}${(d.warnings||[]).map(w=>`<p class="drive-alert">${escape(w)}</p>`).join('')}${history.length?`<details ${pending.length?'open':''}><summary>Изменения и расхождения · ${pending.length} не проверено</summary>${[...history].reverse().map(h=>`<article class="drive-change"><strong>${escape(h.label)}</strong><small>${escape(new Date(h.at).toLocaleString('ru'))} · ${h.status==='conflict'?'Сохранено ваше значение':h.status==='accepted'?'Подставлено вручную':'Обновлено из источника'}${h.reviewedAt?' · Проверено':''}</small><details><summary>Сравнить значения</summary><div class="drive-values"><b>Было в анкете</b><pre>${escape(format(h.before))}</pre><b>Из Google Drive</b><pre>${escape(format(h.value))}</pre></div></details>${h.status==='conflict'&&!h.reviewedAt?`<button class="secondary-button" data-drive-accept="${escape(h.id)}">Подставить из таблицы</button>`:''}</article>`).join('')}</details>${pending.length?'<button class="text-button" id="reviewDriveChanges">Отметить изменения проверенными</button>':''}`:'<p>Исходные данные загружены. Новые изменения появятся здесь.</p>'}</section>`;
}
function bindDriveHistory(s){
 $('#formContent').querySelectorAll('[data-drive-accept]').forEach(b=>b.onclick=()=>{
  const h=s.driveImport.history.find(h=>h.id===b.dataset.driveAccept);if(!h)return;
  h.before=s[h.field]??'';s[h.field]=h.value;h.status='accepted';h.reviewedAt=new Date().toISOString();scheduleSave();render();
 });
 if($('#reviewDriveChanges'))$('#reviewDriveChanges').onclick=()=>{for(const h of s.driveImport.history)h.reviewedAt||=new Date().toISOString();scheduleSave();renderForm();};
}
async function refreshDrive(){
 try{
  const r=await api('/api/drive/status');driveBusy=r.status==='running';
  $('#importDrive').disabled=driveBusy;$('#importDrive').textContent=driveBusy?'Загружаем из Google Drive…':'Загрузить из Google Drive';
  $('#driveStatus').textContent=r.message+(r.warnings?.length?` Проблем с файлами/строками: ${r.warnings.length}. Подробности в анкетах.`:'');
  if(r.status==='done')await syncState();
  clearTimeout(driveTimer);if(driveBusy)driveTimer=setTimeout(refreshDrive,2000);
 }catch(e){$('#driveStatus').textContent=e.message;clearTimeout(driveTimer);if(driveBusy)driveTimer=setTimeout(refreshDrive,4000);}
}
if($('#importDrive'))$('#importDrive').onclick=async()=>{
 if(driveBusy)return;
 await save();if(saving||studentChanges(savedStudents,students).length){toast('Сначала дождитесь сохранения полей анкеты.');return;}
 driveBusy=true;$('#importDrive').disabled=true;
 try{await api('/api/drive/import',{method:'POST'});await refreshDrive();}catch(e){driveBusy=false;$('#importDrive').disabled=false;$('#driveStatus').textContent=e.message;}
};

function saveGenerationBatch(){
 if(generationBatch?.running)sessionStorage.setItem('rezumator:generation-batch',JSON.stringify(generationBatch));
 else sessionStorage.removeItem('rezumator:generation-batch');
}
function renderBatchControls(){
 const generate=$('#generateMissing'),generateNotReady=$('#generateNotReady'),stop=$('#stopGenerationBatch'),notion=$('#exportAllNotion'),status=$('#batchStatus');if(!generate||!generateNotReady||!stop||!notion||!status)return;
 const missing=studentsMissingResume(students).length,notReady=studentsWithoutReadyResume(students).length,pending=studentsPendingNotion(students,notionEntries).length;
 generate.textContent=`Сгенерировать всем без резюме · ${missing}`;
 generateNotReady.textContent=`Сгенерировать без галочки «Готово» · ${notReady}`;
 if(generationBatch?.running){
  const current=Math.min(generationBatch.completed+generationBatch.failed+1,generationBatch.total);
  const activeButton=generationBatch.mode==='not_ready'?generateNotReady:generate;
  activeButton.textContent=`Генерация · ${current}/${generationBatch.total}`;
  generate.disabled=true;generateNotReady.disabled=true;stop.classList.remove('hidden');stop.disabled=false;
 }else{generate.disabled=Boolean(activeJob||generationStarting||notionBatch?.running||!missing);generateNotReady.disabled=Boolean(activeJob||generationStarting||notionBatch?.running||!notReady);stop.classList.add('hidden');}
 if(notionBatch?.running){notion.textContent=`Добавляем в Notion · ${notionBatch.completed+notionBatch.failed+1}/${notionBatch.total}`;notion.disabled=true;}
 else{notion.textContent=`Добавить готовые в Notion · ${pending}`;notion.disabled=Boolean(activeJob||generationStarting||generationBatch?.running||!pending);}
 status.textContent=generationBatch?.message||notionBatch?.message||'';
}
function advanceGenerationBatch(success){
 if(!generationBatch)return;
 const stopped=!generationBatch.running;
 if(success)generationBatch.completed++;else if(!stopped)generationBatch.failed++;
 generationBatch.currentId=null;generationBatch.message=`Готово ${generationBatch.completed} из ${generationBatch.total}${generationBatch.failed?`, ошибок: ${generationBatch.failed}`:''}`;
 if(!generationBatch.running||!generationBatch.queue.length){
  generationBatch.running=false;generationBatch.message=stopped?`Массовая генерация остановлена. Готово: ${generationBatch.completed}.`:`Массовая генерация завершена: ${generationBatch.completed} готово${generationBatch.failed?`, ${generationBatch.failed} с ошибкой`:''}.`;
  saveGenerationBatch();renderBatchControls();toast(generationBatch.message);return;
 }
 saveGenerationBatch();renderBatchControls();setTimeout(startNextGenerationBatch,250);
}
async function startNextGenerationBatch(){
 if(!generationBatch?.running||activeJob||generationStarting)return;
 while(generationBatch.queue.length){
  const id=generationBatch.queue.shift(),student=students.find(s=>s.id===id);
  if(!batchResumeEligible(student,generationBatch.mode||'missing')){generationBatch.completed++;continue;}
  generationBatch.currentId=id;generationBatch.message=`Генерируем: ${student.name||student.telegram||'ученик'}`;saveGenerationBatch();renderBatchControls();
  generationStarting=true;startingStudentId=id;showJob(`Запускаем ${providerName(generationSettings?.provider)}…`,false,id);
  try{
   const snapshot=structuredClone(student),j=await api('/api/generate',{method:'POST',body:JSON.stringify(snapshot)});
   activeJob={id:j.id,studentId:id,kind:'resume',provider:j.provider,providerName:j.providerName,signature:signature(snapshot),batch:true};
   sessionStorage.setItem('rezumator:job',JSON.stringify(activeJob));renderJobStatus();renderReadiness();setTimeout(pollJob,1200);return;
  }catch(e){showJob(e.message,true,id);generationBatch.running=false;generationBatch.queue.unshift(id);generationBatch.currentId=null;generationBatch.message=`Очередь остановлена: ${e.message} Генерация не запущена; осталось анкет: ${generationBatch.queue.length}.`;saveGenerationBatch();renderBatchControls();toast(generationBatch.message);return;}
  finally{generationStarting=false;startingStudentId=null;renderReadiness();renderBatchControls();}
 }
 generationBatch.running=false;generationBatch.message=`Массовая генерация завершена: ${generationBatch.completed} готово${generationBatch.failed?`, ${generationBatch.failed} с ошибкой`:''}.`;saveGenerationBatch();renderBatchControls();toast(generationBatch.message);
}
async function startGenerationBatch(mode='missing'){
 if(activeJob||generationStarting||generationBatch?.running||notionBatch?.running)return;
 await save();if(saving||studentChanges(savedStudents,students).length){toast('Сначала дождитесь сохранения анкет.');return;}
 const queue=(mode==='not_ready'?studentsWithoutReadyResume(students):studentsMissingResume(students)).map(s=>s.id);
 if(!queue.length){toast(mode==='not_ready'?'У всех заполненных учеников есть галочка «Резюме готово».':'У всех заполненных учеников уже есть резюме.');renderBatchControls();return;}
 generationBatch={running:true,mode,queue,total:queue.length,completed:0,failed:0,currentId:null,message:`В очереди: ${queue.length}`};saveGenerationBatch();renderBatchControls();startNextGenerationBatch();
}
async function stopGenerationBatch(){
 if(!generationBatch?.running)return;
 generationBatch.running=false;generationBatch.queue=[];generationBatch.message='Останавливаем массовую генерацию…';saveGenerationBatch();renderBatchControls();
 if(activeJob?.batch){try{await api('/api/jobs/'+activeJob.id,{method:'DELETE'});}catch(e){toast(e.message);}return;}
 generationBatch.message=`Массовая генерация остановлена. Готово: ${generationBatch.completed}.`;renderBatchControls();toast(generationBatch.message);
}

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitNotionEntry(studentId){
 for(let i=0;i<240;i++){
  await delay(1500);const state=await api('/api/notion/status');notionEntries=state.entries;notionContainer=state.container||notionContainer;notionWorkspaceName=state.workspace?.name||notionWorkspaceName;renderNotion();renderBatchControls();
  const entry=notionEntries[studentId];if(entry&&!['creating','updating'].includes(entry.status))return entry;
 }
 throw new Error('Notion не завершил экспорт за 6 минут. Повтор не запущен, чтобы не создать дубль.');
}
async function startNotionBatch(){
 if(notionBatch?.running||activeJob||generationStarting||generationBatch?.running)return;
 await save();if(saving||studentChanges(savedStudents,students).length){toast('Сначала дождитесь сохранения анкет.');return;}
 await refreshNotion();const queue=studentsPendingNotion(students,notionEntries).map(s=>s.id);
 if(!queue.length){toast('Все готовые резюме уже добавлены в Notion.');renderBatchControls();return;}
 notionBatch={running:true,total:queue.length,completed:0,failed:0,message:`В Notion будет добавлено: ${queue.length}`};renderBatchControls();
 for(const id of queue){
  const student=students.find(s=>s.id===id);if(!student?.result?.resume_text?.trim())continue;
  if(notionEntryPreventsDuplicate(notionEntries[id])){notionBatch.completed++;continue;}
  notionBatch.message=`Notion: ${student.name||student.telegram||'ученик'}`;renderBatchControls();
  try{
   const entry=await api('/api/notion/pages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(structuredClone(student))});notionEntries[id]=entry;
   const done=['creating','updating'].includes(entry.status)?await waitNotionEntry(id):entry;
   if(done.status==='done')notionBatch.completed++;else notionBatch.failed++;
  }catch(e){notionBatch.failed++;notionBatch.message=e.message;}
  renderBatchControls();
 }
 notionBatch.running=false;notionBatch.message=`Экспорт в Notion завершён: ${notionBatch.completed} создано${notionBatch.failed?`, ${notionBatch.failed} не удалось`:''}. Существующие страницы пропущены.`;renderBatchControls();renderNotion();toast(notionBatch.message);
}
if($('#generateMissing'))$('#generateMissing').onclick=()=>startGenerationBatch('missing');
if($('#generateNotReady'))$('#generateNotReady').onclick=()=>startGenerationBatch('not_ready');
if($('#stopGenerationBatch'))$('#stopGenerationBatch').onclick=stopGenerationBatch;
if($('#exportAllNotion'))$('#exportAllNotion').onclick=startNotionBatch;

let generationSettings=null,modelCatalog=[],modelSaving=false,modelSettingsReady=false;
const providerName=provider=>provider==='anthropic'?'Claude':'ChatGPT';
function renderModelPicker(){
 const provider=$('#generationProvider'),model=$('#generationModel'),effort=$('#generationEffort');if(!model)return;
 const available=modelCatalog.find(m=>m.model===generationSettings?.model);
 provider.value=generationSettings?.provider||'openai';provider.disabled=modelSaving||!!loginPoll;
 model.innerHTML=modelCatalog.map(m=>`<option value="${escape(m.model)}" ${m.model===generationSettings?.model?'selected':''}>${escape(m.name)}</option>`).join('');
 if(!available&&generationSettings)model.insertAdjacentHTML('afterbegin',`<option selected disabled>${escape(generationSettings.model)} (недоступна)</option>`);
 effort.innerHTML=(available?.efforts||[]).map(e=>`<option value="${escape(e)}" ${e===generationSettings?.reasoning_effort?'selected':''}>${escape(e)}</option>`).join('');
 model.disabled=modelSaving||!modelCatalog.length;effort.disabled=modelSaving||!available;$('#refreshModels').disabled=modelSaving;
 modelSettingsReady=!!available&&available.efforts.includes(generationSettings?.reasoning_effort);
 if($('#generationSubscription'))$('#generationSubscription').textContent=`Через подписку ${providerName(generationSettings?.provider)} · без API-ключа`;
 if(current())renderReadiness();
}
async function loadModels(refresh=false,provider=generationSettings?.provider){
 try{const query=new URLSearchParams();if(refresh)query.set('refresh','1');if(provider)query.set('provider',provider);const r=await api('/api/models'+(query.size?'?'+query:''));modelCatalog=r.models;generationSettings=r.settings;renderModelPicker();$('#modelSettingsStatus').textContent=modelSettingsReady?'Для резюме и легенд':'Выберите доступную модель';}
 catch(e){$('#modelSettingsStatus').textContent=e.message;modelSettingsReady=false;if(current())renderReadiness();}
}
async function saveModelChoice(model,reasoning_effort,provider=generationSettings.provider){
 if(modelSaving)return;modelSaving=true;renderModelPicker();$('#modelSettingsStatus').textContent='Сохраняем…';
 try{generationSettings=await api('/api/generation-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({settings:{provider,model,reasoning_effort},before:generationSettings})});$('#modelSettingsStatus').textContent=activeJob?'Сохранено для следующих генераций':'Выбор сохранён';await loadModels(false,provider);if($('#desktopAccount')&&!$('#desktopAccount').classList.contains('hidden'))showDesktopAccount(await api('/api/status'));}
 catch(e){$('#modelSettingsStatus').textContent=e.message;try{generationSettings=await api('/api/generation-settings');}catch{}}
 finally{modelSaving=false;renderModelPicker();}
}
async function selectGenerationProvider(provider){if(modelSaving||loginPoll||provider===generationSettings?.provider)return;const before=generationSettings;modelSaving=true;renderModelPicker();try{const r=await api('/api/models?provider='+encodeURIComponent(provider));modelCatalog=r.models;modelSaving=false;generationSettings=before;await saveModelChoice(r.settings.model,r.settings.reasoning_effort,r.settings.provider);}catch(error){modelSaving=false;renderModelPicker();$('#modelSettingsStatus').textContent=error.message;throw error;}}
if($('#generationModel')){
 $('#generationProvider').onchange=e=>void selectGenerationProvider(e.target.value).catch(()=>{});
 $('#generationModel').onchange=e=>{const m=modelCatalog.find(m=>m.model===e.target.value);if(m)saveModelChoice(m.model,m.efforts.includes(generationSettings?.reasoning_effort)?generationSettings.reasoning_effort:m.defaultEffort);};
 $('#generationEffort').onchange=e=>saveModelChoice(generationSettings.model,e.target.value);
 $('#refreshModels').onclick=()=>loadModels(true);
 setInterval(async()=>{if(!loaded||modelSaving||!generationSettings||document.hidden)return;try{const settings=await api('/api/generation-settings');if(!same(settings,generationSettings)){const changedProvider=settings.provider!==generationSettings.provider;generationSettings=settings;if(changedProvider)await loadModels(false,settings.provider);else renderModelPicker();$('#modelSettingsStatus').textContent='Обновлено из другого окна';if($('#desktopAccount')&&!$('#desktopAccount').classList.contains('hidden'))showDesktopAccount(await api('/api/status'));}}catch{}},5000);
}

function renderStudents(){
 $('#studentCount').textContent=students.length;
 $('#students').innerHTML=students.map((s,i)=>`<button class="student ${s.id===selected?'selected':''}" data-student="${s.id}" ${s.id===selected?'aria-current="true"':''}><span class="avatar">${String(i+1).padStart(2,'0')}</span><span class="student-info"><strong>${escape(s.name||s.telegram||'Новый ученик')}</strong><small class="${studentStatus(s).className}">${studentStatus(s).label}</small></span></button>`).join('');
 $('#students').querySelectorAll('[data-student]').forEach(b=>b.onclick=()=>{selected=b.dataset.student;localStorage.setItem('rezumator:selected',selected);render();});
 renderBatchControls();
}
function renderForm(){const s=current();let html='';
 if(tab==='questionnaire')html=`<div class="section-title"><div><h3>Знакомимся с учеником</h3><p>Можно заполнить только то, что уже известно.</p></div><span class="pill">Анкета</span></div><div class="fields-grid">${input('name','Имя и фамилия','Как обращаться к ученику')}${input('telegram','Telegram','@username')}${input('age','Возраст','Необязательно','number')}${input('github','GitHub','Имя пользователя')}</div>${checkbox('urgent','Резюме нужно как можно скорее')}${checkbox('resumeReady','Резюме готово')}<p class="completion-hint">Отметь после своей проверки. До этого срочность остаётся видна в списке учеников.</p><hr><div class="section-title"><div><h3>Прежнее резюме</h3><p>Из PDF извлечём текст для генерации.</p></div></div><label class="upload" tabindex="0" id="uploadLabel">↑ <span id="uploadTitle">${escape(s.pdfName||'Загрузить PDF')}</span><small>До 15 МБ · файл с текстовым слоем</small><input id="pdfFile" type="file" accept="application/pdf,.pdf"></label>${/^https:\/\/drive\.google\.com\//.test(s.sourceUrl)?`<a class="source-link" href="${escape(s.sourceUrl)}" target="_blank" rel="noopener noreferrer">Открыть исходный PDF из анкеты ↗</a>`:''}<details class="source-text"><summary>Текст резюме ${s.resume?'· '+s.resume.length.toLocaleString('ru')+' символов':''}</summary><textarea data-field="resume" placeholder="Или вставьте текст резюме вручную">${escape(s.resume)}</textarea></details><hr>${textarea('project','О проекте','Сфера, назначение системы, пользователи, объём данных','Размер системы — контекст проекта, а не личное достижение.')}${configurationPicker()}${textarea('tasks','Что делал ученик','Задачи, технологии, конфигурации 1С','Можно описать опыт на любом стеке. Задачи для 1С достроим сами; личный опыт и задачи коллег лучше разделить.')}${textarea('complex','Сложные задачи и результаты','Что было сложно, как решили, что изменилось')}`;
 if(tab==='settings')html=`<div class="section-title"><div><h3>Правила для этого резюме</h3><p>Твои параметры подставятся в запрос автоматически.</p></div></div><div class="settings-fixed"><strong>Город: Москва</strong><span>Общее правило курса</span></div>${input('title','Желаемая должность','Программист 1С')}<label class="field"><span>На чём сделать акцент</span><select data-field="track">${['Универсальный профиль','Торговля и склад','ERP и производство','Бухгалтерия','ЗУП и кадровый учёт','Интеграции','Ведущий разработчик'].map(t=>`<option ${t===s.track?'selected':''}>${t}</option>`).join('')}</select></label><label class="field"><span>Желаемый стаж, лет · необязательно</span><input data-field="targetExperienceYears" type="number" min="0" max="60" step="any" value="${escape(s.targetExperienceYears??'')}" placeholder="По умолчанию: 4–4,5 года"><small>Например, 3,5 = 3 года 6 месяцев. Ненулевой указанный стаж важнее дат мест работы: периоды будут пересчитаны. Пустое поле или 0 использует стандартные 4–4,5 года. Последняя работа будет указана по настоящее время.</small></label>${checkbox('showAge','Добавить возраст в резюме')}${checkbox('showGithub','Добавить GitHub, если указан')}<hr><div class="section-title"><div><h3>Места работы</h3><p>Заданные здесь значения имеют приоритет над PDF.</p></div></div><div class="section-note">Компании можно не заполнять: возьмём их из прежнего резюме или предложим подходящие компании и проекты. Периоды подберём под желаемый стаж; предложения будут отмечены в проверке.</div><div id="jobCards">${s.jobs.map((j,i)=>jobCard(j,i)).join('')}</div><button class="secondary-button" id="addJob">＋ Добавить место работы</button><hr>${metricsEditor()}<hr>${textarea('notes','Указания для генерации','Например: акцент на интеграциях; подробнее раскрыть последний проект; сократить нерелевантный опыт','Формулировки и структуру Codex выберет сам.')}`;
 if(tab==='prompt')html=`<div class="section-title"><div><h3>Запрос уже собран</h3><p>Общие правила + настройки + данные ученика.</p></div></div><div class="section-note">Это именно тот запрос, который отправится в выбранную модель. Редактировать его вручную не требуется: меняй поля анкеты и настройки.</div><textarea id="promptText" class="prompt-area" readonly aria-label="Собранный промпт">Собираем…</textarea><button id="copyPrompt" class="secondary-button">Копировать промпт</button>`;
 $('#formContent').innerHTML=(tab==='questionnaire'?renderDriveHistory(s):'')+html;
 bindDriveHistory(s);
 $('#formContent').querySelectorAll('[data-field]').forEach(el=>el.addEventListener('input',()=>{s[el.dataset.field]=el.type==='checkbox'?el.checked:el.value;scheduleSave();renderReadiness();if(['name','telegram','urgent','resumeReady'].includes(el.dataset.field)){renderStudents();$('#candidateHeading').textContent=s.name||s.telegram||'Новый ученик';}updateStale();if(el.dataset.field==='fillMetrics')renderForm();}));
 $('#formContent').querySelectorAll('[data-job]').forEach(el=>el.addEventListener('input',()=>{s.jobs[Number(el.dataset.job)][el.dataset.key]=el.type==='checkbox'?el.checked:el.value;if(el.dataset.key==='current'&&el.checked)s.jobs[Number(el.dataset.job)].end='';scheduleSave();renderReadiness();updateStale();if(el.dataset.key==='current')renderForm();}));
 $('#formContent').querySelectorAll('[data-remove-job]').forEach(el=>el.onclick=()=>{s.jobs.splice(Number(el.dataset.removeJob),1);scheduleSave();renderForm();renderReadiness();updateStale();});
 if($('#addJob'))$('#addJob').onclick=()=>{if(s.jobs.length>=20){toast('Максимум 20 мест работы');return;}s.jobs.push({company:'',role:'',start:'',end:'',current:false,tasks:''});scheduleSave();renderForm();};
 if($('#configurationPreset')){
  const preset=$('#configurationPreset'),add=$('#addConfiguration');
  preset.onchange=()=>{add.disabled=!preset.value;};
  add.onclick=()=>{
   const value=preset.value;if(!value)return;
   const field=$('#formContent [data-field="configurations"]');
   const entries=field.value.split(/[;,\n]/).map(v=>v.trim().toLocaleLowerCase('ru'));
   if(entries.includes(value.toLocaleLowerCase('ru'))){toast('Эта конфигурация уже добавлена');return;}
   field.value=field.value.trimEnd()+(field.value.trim()?'\n':'')+value;
   field.dispatchEvent(new Event('input',{bubbles:true}));
   preset.value='';add.disabled=true;preset.focus();toast('Добавлено: '+value);
  };
 }
 $('#formContent').querySelectorAll('[data-metric]').forEach(el=>el.addEventListener('input',()=>{s.metrics[Number(el.dataset.metric)][el.dataset.key]=el.value;scheduleSave();updateStale();}));
 $('#formContent').querySelectorAll('[data-remove-metric]').forEach(el=>el.onclick=()=>{s.metrics.splice(Number(el.dataset.removeMetric),1);scheduleSave();renderForm();updateStale();});
 if($('#addMetric'))$('#addMetric').onclick=()=>{s.metrics??=[];if(s.metrics.length>=20){toast('Максимум 20 метрик');return;}s.metrics.push({label:$('#metricPreset').value,value:'',context:''});scheduleSave();renderForm();updateStale();$('#formContent [data-metric="'+(s.metrics.length-1)+'"][data-key="'+(s.metrics.at(-1).label?'value':'label')+'"]').focus();};
 if($('#pdfFile'))$('#pdfFile').onchange=upload;
 if($('#uploadLabel'))$('#uploadLabel').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('#pdfFile').click();}};
 if(tab==='prompt'){api('/api/prompt',{method:'POST',body:JSON.stringify(s)}).then(r=>{if(tab==='prompt'&&s.id===selected){$('#promptText').value=r.prompt;currentRulesVersion=r.rules_version||'';updateStale();}}).catch(e=>toast(e.message));$('#copyPrompt').onclick=()=>copy($('#promptText').value);}
}
function jobCard(j,i){const f=(key,label,type='text')=>`<label class="field"><span>${label}</span><input type="${type}" data-job="${i}" data-key="${key}" value="${escape(j[key])}" ${key==='end'&&j.current?'disabled':''}></label>`;return `<div class="job-card"><div class="job-card-head"><strong>Место работы ${i+1}</strong><button class="danger-link" data-remove-job="${i}">Убрать</button></div><div class="fields-grid">${f('company','Компания')}${f('role','Должность')}${f('start','Начало','month')}${f('end','Окончание','month')}</div><label class="check-label"><input data-job="${i}" data-key="current" type="checkbox" ${j.current?'checked':''}>Работает сейчас</label><label class="field"><span>Задачи и проект · необязательно</span><textarea data-job="${i}" data-key="tasks" placeholder="Можно оставить пустым — задачи для этой работы достроим из общего контекста">${escape(j.tasks)}</textarea></label></div>`;}
function renderReadiness(){const c=completeness(current()),n=c.filter(x=>x.ok).length;$('#readinessCount').textContent=`${n} / ${c.length}`;$('#readinessBar').value=n;$('#inputChecks').innerHTML=c.map(x=>`<div class="input-check ${x.ok?'ok':''}"><span class="check-symbol">${x.ok?'✓':'·'}</span><div>${x.label}${!x.ok?`<small>${x.hint}</small>${x.field?`<button class="check-action" data-jump-field="${x.field}">Указать конфигурации →</button>`:''}`:''}</div></div>`).join('');$('#inputChecks').querySelectorAll('[data-jump-field]').forEach(b=>b.onclick=()=>{tab='questionnaire';setTab();renderForm();const field=b.dataset.jumpField==='configurations'?$('#configurationPreset'):$('#formContent [data-field="'+b.dataset.jumpField+'"]');field?.scrollIntoView({behavior:'smooth',block:'center'});field?.focus({preventScroll:true});});$('#generate').disabled=!connected||!modelSettingsReady||modelSaving||!!activeJob||generationStarting||(resultView==='legend'&&!current().result?.resume_text?.trim());renderJobStatus();}
function updateStale(){updateLegendStale();const s=current(),el=$('#stale');if(!el)return;const oldRules=currentRulesVersion&&s.result?.rules_version!==currentRulesVersion;const changed=s.resultSignature!==signature(s);el.classList.toggle('hidden',!oldRules&&!changed);el.textContent=oldRules?'Правила генерации обновились. Это резюме создано по прежним правилам — сгенерируй новую версию.':'Исходные данные изменились. Сгенерируй новую версию, чтобы учесть правки.';}
function renderResultMode(){
 const legend=resultView==='legend',s=current();
 $$('.result-tab').forEach(b=>{const on=b.dataset.resultView===resultView;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));});
 $('#resultHeading').textContent=legend?'Легенда для собеседования':'Резюме и проверка';
 $('#resumeReadiness').classList.toggle('hidden',legend);$('#legendIntro').classList.toggle('hidden',!legend);
 $('#generate').textContent=legend?'Сгенерировать легенду':'Сгенерировать резюме';
 $('#copyLegendRules').onclick=async()=>{try{const r=await api('/api/legend/rules');await copy(r.prompt);}catch(e){toast(e.message);}};
 $('#legendNotes').value=s.legendNotes||'';
 $('#legendNotes').oninput=e=>{s.legendNotes=e.target.value;scheduleSave();updateLegendStale();};
 $('#legendSourceHint').textContent=s.result?.resume_text?.trim()?'Основа: текст в редакторе резюме, включая ручные правки.':'Сначала создай резюме во вкладке «Резюме».';
 renderReadiness();
}
function updateLegendStale(){
 const s=current(),el=$('#legendStale');if(!s||!el)return;
 const oldRules=currentLegendRulesVersion&&s.legend?.rules_version!==currentLegendRulesVersion;
 const changed=s.legendSignature!==legendSignature(s);
 el.classList.toggle('hidden',!oldRules&&!changed);
 el.textContent=oldRules?'Правила легенды обновились. Сгенерируй новую версию.':'Резюме, анкета или указания изменились. Обнови легенду, чтобы рассказ им соответствовал.';
}
function legendCards(plan){
 if(!plan)return '';
 const fields=[['problem','Проблема'],['standard_gap','Зачем доработка'],['own_contribution','Мой вклад'],['solution','Решение'],['data_example','Пример пути данных'],['verification','Проверка'],['result','Результат'],['limits','Ограничения']];
 return `<div class="result-details"><details><summary>Карточки кейсов при генерации · ${plan.cases.length}</summary><p>${escape(plan.profile)}</p>${plan.cases.map(c=>`<div class="audit-item"><strong>${escape(c.title)}</strong><p>${escape(plan.employers.find(e=>e.id===c.employer_id)?.company||'')}</p>${fields.map(([key,label])=>`<p><b>${label}:</b> ${escape(c[key])}</p>`).join('')}</div>`).join('')}<button type="button" id="downloadLegendCards" class="secondary-button">Скачать карточки JSON</button><small>Карточки отражают результат генерации. Ручные правки текста легенды не изменяют их автоматически.</small></details></div>`;
}
function renderLegend(){
 const s=current(),r=s.legend;$('#versionLabel').textContent=r?'Есть легенда':'Черновик';
 if(!r){$('#resultContent').innerHTML='<div class="empty-result"><div class="paper-icon"><i></i><i></i><i></i></div><h3>От резюме к рассказу</h3><p>Короткий рассказ, 3–4 опорных кейса, личный вклад, масштаб и 2–3 факапа только в тесте. Затем вопросы по этим кейсам.</p></div>';return;}
 const labels={present:'Есть',missing:'Не хватает',clarify:'Уточнить',not_applicable:'Не требуется'};
 $('#resultContent').innerHTML=`<div id="legendStale" class="stale hidden"></div><div class="result-actions"><button class="secondary-button" id="copyLegend">Копировать легенду</button><button class="secondary-button" id="downloadLegend">Скачать легенду TXT</button><button class="secondary-button" id="editLegend">Редактировать текст</button><button class="secondary-button" id="saveLegendStudent">Сохранить анкету</button></div><div class="notion-export" id="notionExport"></div><p class="result-summary">${escape(r.summary)}</p><article class="legend-reading" id="legendPreview" aria-label="Легенда для собеседования">${legendHtml(r.legend_text)}</article><textarea class="resume-output legend-output hidden" id="legendOutput" aria-label="Редактор легенды">${escape(r.legend_text)}</textarea>${legendCards(r.case_plan)}<div class="result-details"><details open><summary>Что дополнено · ${r.changes.length}</summary><ul>${r.changes.map(c=>`<li>${escape(c)}</li>`).join('')}</ul></details><details><summary>Проверка согласованности</summary>${r.checks.map(c=>`<div class="audit-item ${c.status}"><strong>${escape(c.label)}</strong><span class="tag">${labels[c.status]||'Уточнить'}</span><p>${escape(c.detail)}</p>${c.evidence?`<small>Основание: ${escape(c.evidence)}</small>`:''}</div>`).join('')}</details><details><summary>Что уточнить у ученика · ${r.questions.length}</summary><ul>${r.questions.map(q=>`<li>${escape(q)}</li>`).join('')}</ul></details></div>`;
 $('#legendOutput').oninput=e=>{r.legend_text=normalizeResumeText(e.target.value);scheduleSave();};
 $('#editLegend').onclick=()=>{const editing=$('#legendOutput').classList.contains('hidden');$('#legendOutput').classList.toggle('hidden',!editing);$('#legendPreview').classList.toggle('hidden',editing);$('#editLegend').textContent=editing?'Готово, показать оформление':'Редактировать текст';if(editing)$('#legendOutput').focus();else $('#legendPreview').innerHTML=legendHtml(r.legend_text);};
 if($('#downloadLegendCards'))$('#downloadLegendCards').onclick=()=>download(`${filename(s)}-кейсы.json`,JSON.stringify(r.case_plan,null,2),'application/json');
 $('#copyLegend').onclick=()=>copy(r.legend_text);
 $('#downloadLegend').onclick=()=>download(`${filename(s)}-легенда.txt`,r.legend_text,'text/plain;charset=utf-8');
 $('#saveLegendStudent').onclick=()=>download(`${filename(s)}.json`,JSON.stringify(s,null,2),'application/json');
 renderNotion();updateLegendStale();
}
function renderResult(){renderResultMode();if(resultView==='legend'){renderLegend();return;}const s=current(),r=s.result;$('#versionLabel').textContent=r?'Есть результат':'Черновик';if(!r){$('#resultContent').innerHTML='<div class="empty-result"><div class="paper-icon"><i></i><i></i><i></i></div><h3>Здесь появится резюме</h3><p>Заполни анкету или загрузи PDF. Мы соберём текст и покажем, какие сведения стоит дополнить.</p></div>';return;}
 const cleanResume=normalizeResumeText(r.resume_text);if(cleanResume!==r.resume_text){r.resume_text=cleanResume;scheduleSave();}
 const labels={present:'Есть',missing:'Не хватает',clarify:'Уточнить',not_applicable:'Не требуется'};
 $('#resultContent').innerHTML=`<div id="stale" class="stale hidden">Исходные данные изменились. Сгенерируй новую версию, чтобы учесть правки.</div><div class="result-actions"><button class="secondary-button" id="copyResume">Копировать</button><button class="secondary-button" id="downloadTxt">Скачать TXT</button><button class="secondary-button" id="printPdf">Скачать PDF</button><button class="secondary-button" id="downloadJson">Сохранить анкету</button></div><div class="notion-export" id="notionExport"></div><p class="result-summary">${escape(r.summary)}</p><textarea class="resume-output" id="resumeOutput" aria-label="Редактор готового резюме">${escape(r.resume_text)}</textarea><div class="result-details"><details open><summary>Проверка резюме · ${r.checks.filter(c=>c.status==='missing'||c.status==='clarify').length} уточнений</summary>${r.checks.map(c=>`<div class="audit-item ${c.status}"><strong>${escape(c.label)}</strong><span class="tag">${labels[c.status]||'Уточнить'}</span><p>${escape(c.detail)}</p>${c.evidence?`<small>Основание: ${escape(c.evidence)}</small>`:''}</div>`).join('')}</details><details ${r.questions.length?'open':''}><summary>Вопросы ученику · ${r.questions.length}</summary><ul>${r.questions.map(q=>`<li>${escape(q)}</li>`).join('')}</ul></details><details><summary>Что изменено</summary><ul>${r.changes.map(q=>`<li>${escape(q)}</li>`).join('')}</ul></details></div>`;
 $('#resumeOutput').oninput=e=>{r.resume_text=normalizeResumeText(e.target.value);scheduleSave();updateLegendStale();};
 $('#copyResume').onclick=()=>copy(r.resume_text);$('#downloadTxt').onclick=()=>download(`${filename(s)}.txt`,r.resume_text,'text/plain;charset=utf-8');$('#downloadJson').onclick=()=>download(`${filename(s)}.json`,JSON.stringify(s,null,2),'application/json');$('#printPdf').onclick=()=>exportPdf(s,r,$('#printPdf'));renderNotion();updateStale();
}
function safeNotionUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&['notion.so','www.notion.so','app.notion.com','www.notion.com'].includes(u.hostname)?u.href:null;}catch{return null;}}
let legendMapEntries={},legendMapTimer;
function safeLegendMapUrl(value){try{const u=new URL(value);return u.origin==='https://excalidraw.com'&&u.pathname==='/'&&/^#json=[a-zA-Z0-9_-]+,[a-zA-Z0-9_-]{22}$/.test(u.hash)?u.href:null;}catch{return null;}}
function renderLegendMap(){
 const container=$('#legendMap');if(!container)return;const s=current(),entry=legendMapEntries[s.id],url=safeLegendMapUrl(entry?.url),busy=entry?.status==='running';
 container.innerHTML=`<div class="result-actions"><button class="secondary-button" id="createLegendMap" ${busy?'disabled':''}>${busy?'Создаём карту…':url?'Обновить карту в Excalidraw':'Создать карту в Excalidraw'}</button>${url?`<a class="secondary-button" href="${escape(url)}" target="_blank" rel="noopener noreferrer">Открыть карту легенды ↗</a>`:''}</div><small>Из актуальной легенды на странице Notion. Ссылка на карту появится там же.</small><p class="notion-status ${entry?.status==='error'?'error':''}" role="status">${escape(entry?.message||'')}</p>`;
 $('#createLegendMap').onclick=async()=>{const studentId=current().id;$('#createLegendMap').disabled=true;try{legendMapEntries[studentId]=await api('/api/legend/maps',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({studentId})});renderLegendMap();scheduleLegendMapPoll();}catch(e){toast(e.message);renderLegendMap();}};
}
function scheduleLegendMapPoll(){clearTimeout(legendMapTimer);legendMapTimer=setTimeout(refreshLegendMaps,2000);}
async function refreshLegendMaps(){try{const result=await api('/api/legend/maps');legendMapEntries=result.entries;renderLegendMap();if(Object.values(legendMapEntries).some(e=>e.status==='running'))scheduleLegendMapPoll();}catch{if(Object.values(legendMapEntries).some(e=>e.status==='running'))scheduleLegendMapPoll();}}
function renderNotion(){
 const container=$('#notionExport');if(!container)return;
 const s=current(),entry=notionEntries[s.id],url=safeNotionUrl(entry?.url),busy=['creating','updating'].includes(entry?.status),uncertain=entry?.status==='uncertain';
 const existing=Boolean(entry?.pageId&&url),batchBusy=Boolean(notionBatch?.running);
 const link=url?`<a class="secondary-button notion-link" href="${escape(url)}" target="_blank" rel="noopener noreferrer">Открыть резюме в NOTION ↗</a>`:'';
 const hubUrl=safeNotionUrl(entry?.hubUrl),hubLink=hubUrl?`<a class="secondary-button notion-link" href="${escape(hubUrl)}" target="_blank" rel="noopener noreferrer">Открыть страницу ученика ↗</a>`:'';
 const folderUrl=safeNotionUrl(notionContainer?.url),folderLink=folderUrl?`<a class="secondary-button notion-link" href="${escape(folderUrl)}" target="_blank" rel="noopener noreferrer">Открыть папку резюме ↗</a>`:'';
 container.innerHTML=`<div class="result-actions">${hubLink}${link}${folderLink}<button class="secondary-button" id="writeNotion" ${busy||uncertain||batchBusy?'disabled':''}>${batchBusy?'Идёт массовый экспорт…':busy?(existing?'Обновляем страницу…':'Создаём страницу…'):(existing?'Обновить страницу в NOTION':'Создать страницу в NOTION')}</button></div>${existing?'<label class="check-label"><input type="checkbox" id="replaceNotionLegend"> Заменить легенду в Notion текущей легендой резюматора</label>':''}<small>${existing?'Обновит резюме. Существующая легенда в Notion сохраняется, пока вы явно не выберете её замену. Проверки остаются в резюматоре. Прежняя версия сохраняется на компьютере.':escape(notionWorkspaceName||'Ваше пространство Notion')+' · Папка «Резюме учеников» · Резюме и легенда, если она есть'}</small><div id="legendMap"></div><p class="notion-status ${entry?.status==='error'||entry?.status==='update_error'||uncertain?'error':''}" role="status">${escape(entry?.message||'')}</p>`;
 renderLegendMap();
 $('#writeNotion').onclick=async()=>{
  const snapshot=structuredClone(current());if(existing)snapshot.replaceNotionLegend=$('#replaceNotionLegend')?.checked===true;const button=$('#writeNotion');button.disabled=true;button.textContent='Подключаемся к Notion…';
  try{const entry=await api(existing?'/api/notion/pages/update':'/api/notion/pages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot)});notionEntries[snapshot.id]=entry;renderNotion();if(['creating','updating'].includes(entry.status))scheduleNotionPoll();}
  catch(e){toast(e.message);renderNotion();}
 };
}
function scheduleNotionPoll(){clearTimeout(notionTimer);notionTimer=setTimeout(refreshNotion,2000);}
async function refreshNotion(){
 await refreshLegendMaps();
 try{const state=await api('/api/notion/status');notionEntries=state.entries;notionContainer=state.container||null;notionWorkspaceName=state.workspace?.name||'';renderNotion();renderBatchControls();if(Object.values(notionEntries).some(e=>['creating','updating'].includes(e.status)))scheduleNotionPoll();}
 catch{if(Object.values(notionEntries).some(e=>['creating','updating'].includes(e.status)))scheduleNotionPoll();}
}
async function exportPdf(s,r,button){
 button.disabled=true;button.textContent='Создаём PDF…';
 try{
  const response=await fetch('/api/export/pdf',{method:'POST',headers:{'x-rezumator-token':token,'Content-Type':'application/json'},body:JSON.stringify({resume_text:normalizeResumeText(r.resume_text),name:filename(s),candidate:{name:s.name,title:s.title,telegram:s.telegram,github:s.github,age:s.age,showAge:s.showAge,showGithub:s.showGithub}})});
  if(!response.ok){let data;try{data=await response.json();}catch{}throw new Error(data?.error||'Не удалось создать PDF');}
  const blob=await response.blob();download(`${filename(s)}.pdf`,blob,'application/pdf');toast('PDF готов. Проверь загрузки браузера.');
 }catch(e){toast(e.message||'Не удалось скачать PDF');}
 finally{button.disabled=false;button.textContent='Скачать PDF';}
}
function filename(s){return '1с-резюматор-'+(s.name||s.telegram||s.id).replace(/[^а-яёa-z0-9_-]/gi,'_');}
function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
async function copy(t){try{await navigator.clipboard.writeText(t);toast('Скопировано');}catch{toast('Не удалось скопировать. Выделите текст и нажмите ⌘C.');}}
function render(){renderStudents();$('#candidateHeading').textContent=current().name||current().telegram||'Новый ученик';renderForm();renderReadiness();renderResult();}
async function upload(e){const file=e.target.files[0];if(!file)return;if(file.size>15000000){toast('PDF должен быть меньше 15 МБ');return;}const s=current();$('#uploadTitle').textContent='Извлекаем текст…';try{const r=await api('/api/pdf',{method:'POST',headers:{'Content-Type':'application/pdf'},body:file});s.resume=r.text;s.pdfName=file.name;scheduleSave();if(selected===s.id){renderForm();renderReadiness();updateStale();}toast(`PDF прочитан: ${r.pages} стр.`);}catch(err){toast(err.message);if(selected===s.id)renderForm();}}
function renderJobStatus(){
 const message=jobMessages.get(selected);
 const ownJob=activeJob?.studentId===selected;
 const status=message||(ownJob?{text:activeJob.kind==='legend'?'Codex готовит легенду…':'Codex готовит резюме…',error:false}:null);
 $('#jobStatus').textContent=status?.text||'';
 $('#jobStatus').classList.toggle('hidden',!status);
 $('#jobStatus').classList.toggle('error',Boolean(status?.error));
 $('#cancel').classList.toggle('hidden',!ownJob);
}
function showJob(text,error=false,studentId=activeJob?.studentId||startingStudentId||selected){jobMessages.set(studentId,{text,error});renderJobStatus();}
async function pollJob(){
 if(!activeJob)return;const localJob=activeJob;
 try{
  const j=await api('/api/jobs/'+localJob.id);if(!activeJob||activeJob.id!==j.id)return;
  if(j.status==='running'){const name=j.providerName||localJob.providerName||providerName(localJob.provider);showJob(localJob.kind==='legend'?`${name} раскрывает проекты, личный вклад и нагрузки…`:`${name} готовит резюме и проверяет параметры…`,false,localJob.studentId);setTimeout(pollJob,2000);return;}
  let success=false;
  if(j.status==='done'){
   const s=students.find(x=>x.id===localJob.studentId);
   if(s){if(localJob.kind==='legend'){s.legend=j.result;s.legendSignature=localJob.signature;currentLegendRulesVersion=j.result.rules_version||currentLegendRulesVersion;}else{s.result=j.result;s.resultSignature=localJob.signature;currentRulesVersion=j.result.rules_version||currentRulesVersion;}scheduleSave();if(localJob.batch)await save();success=true;}
   showJob(localJob.kind==='legend'?'Легенда готова. Проверь рассказ и предложенные детали.':'Резюме готово. Проверь текст и вопросы ученику.',false,localJob.studentId);toast(localJob.kind==='legend'?'Легенда готова':'Резюме готово');
  }else showJob(j.message,j.status==='error',localJob.studentId);
  activeJob=null;sessionStorage.removeItem('rezumator:job');$('#cancel').classList.add('hidden');renderStudents();renderReadiness();renderResult();
  if(localJob.batch)advanceGenerationBatch(success);
 }catch(e){if(e.status===404||e.status===403){showJob(e.message,true,localJob.studentId);activeJob=null;sessionStorage.removeItem('rezumator:job');$('#cancel').classList.add('hidden');renderReadiness();renderBatchControls();if(localJob.batch)advanceGenerationBatch(false);}else{showJob('Связь с локальным сервером прервалась. Пробуем восстановить…',true,localJob.studentId);setTimeout(pollJob,4000);}}
}
$('#generate').onclick=async()=>{
 if(activeJob||generationStarting)return;
 const s=structuredClone(current()),kind=resultView,name=providerName(generationSettings?.provider);generationStarting=true;startingStudentId=s.id;renderReadiness();showJob(kind==='legend'?'Готовим рассказ по резюме…':`Запускаем ${name}…`,false,s.id);
 try{
  const j=await api(kind==='legend'?'/api/legend/generate':'/api/generate',{method:'POST',body:JSON.stringify(s)});
  activeJob={id:j.id,studentId:s.id,kind,provider:j.provider,providerName:j.providerName,signature:kind==='legend'?legendSignature(s):signature(s)};
  sessionStorage.setItem('rezumator:job',JSON.stringify(activeJob));renderJobStatus();renderBatchControls();setTimeout(pollJob,1200);
 }catch(e){showJob(e.message,true,s.id);}finally{generationStarting=false;startingStudentId=null;renderReadiness();renderBatchControls();}
};
$('#cancel').onclick=async()=>{const job=activeJob;if(job&&job.studentId===selected)try{if(job.batch&&generationBatch){generationBatch.running=false;generationBatch.queue=[];generationBatch.message='Останавливаем массовую генерацию…';saveGenerationBatch();renderBatchControls();}await api('/api/jobs/'+job.id,{method:'DELETE'});showJob('Останавливаем генерацию…',false,job.studentId);}catch(e){toast(e.message);}};
$('#addStudent').onclick=()=>{const s={...structuredClone(blank),id:'s_'+crypto.randomUUID().replaceAll('-','')};students.push(s);selected=s.id;tab='questionnaire';setTab();scheduleSave();render();};
function setTab(){$$('.tab').forEach(b=>{const on=b.dataset.tab===tab;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));});}
function $$(s){return [...document.querySelectorAll(s)];}
$$('.tab').forEach(b=>{b.onclick=()=>{tab=b.dataset.tab;setTab();renderForm();};b.onkeydown=e=>{const list=$$('.tab'),i=list.indexOf(b);let n;if(e.key==='ArrowRight')n=(i+1)%list.length;else if(e.key==='ArrowLeft')n=(i+list.length-1)%list.length;else if(e.key==='Home')n=0;else if(e.key==='End')n=list.length-1;else return;e.preventDefault();list[n].focus();list[n].click();};});
$$('.result-tab').forEach(b=>{
 b.onclick=()=>{resultView=b.dataset.resultView;renderResult();};
 b.onkeydown=e=>{const list=$$('.result-tab'),i=list.indexOf(b);let n;if(e.key==='ArrowRight')n=(i+1)%list.length;else if(e.key==='ArrowLeft')n=(i+list.length-1)%list.length;else if(e.key==='Home')n=0;else if(e.key==='End')n=list.length-1;else return;e.preventDefault();list[n].focus();list[n].click();};
});
async function init(){try{token=(await(await fetch('/api/session')).json()).token;students=(await api('/api/state')).map(s=>({...structuredClone(blank),...s}));savedStudents=structuredClone(students);loaded=true;startStateSync();if(!students.length)students=[{...structuredClone(blank),id:'s_new'}];selected=localStorage.getItem('rezumator:selected')||students[0].id;if(!students.some(s=>s.id===selected))selected=students[0].id;render();refreshNotion();refreshDrive();$('#saveStatus').textContent='Сохранение на компьютере';const status=await api('/api/status');connected=status.connected;if(status.desktop)initDesktopAccount(status);loadModels();currentRulesVersion=status.rules_version||'';currentLegendRulesVersion=status.legend_rules_version||'';updateStale();$('#account').textContent=status.message;$('#account').classList.toggle('connected',connected);renderReadiness();try{generationBatch=JSON.parse(sessionStorage.getItem('rezumator:generation-batch'));if(!generationBatch?.running)generationBatch=null;}catch{generationBatch=null;}try{activeJob=JSON.parse(sessionStorage.getItem('rezumator:job'));}catch{}renderBatchControls();if(activeJob){$('#cancel').classList.remove('hidden');renderReadiness();pollJob();}else if(generationBatch?.running)startNextGenerationBatch();}catch(e){toast(e.message);$('#saveStatus').textContent='Не удалось загрузить анкеты';}}

let loginPoll=null;
function showDesktopAccount(status){
 connected=status.connected;$('#account').textContent=status.message;$('#account').classList.toggle('connected',connected);
 const name=status.providerName||providerName(status.provider),isClaude=status.provider==='anthropic';
 $('#desktopAccountLabel').textContent=connected?`Подписка ${name} подключена`:`Подключите свою подписку ${name}`;
 $('#desktopAccountMessage').textContent=connected?(status.email||'Вход выполнен'):'Вход откроется в браузере. Анкеты хранятся на этом Mac.';
 $('#loginChatGPT').textContent=`Войти в ${name}`;
 $('#loginChatGPT').classList.toggle('hidden',connected);$('#logoutChatGPT').classList.toggle('hidden',!connected);
 if(!isClaude||connected)$('#claudeCodeForm').classList.add('hidden');
 if(current())renderReadiness();
}
function endLoginWait(){clearInterval(loginPoll);loginPoll=null;$('#cancelLogin').classList.add('hidden');$('#continueLogin').classList.add('hidden');$('#claudeCodeForm').classList.add('hidden');$('#claudeLoginCode').value='';$('#loginChatGPT').disabled=false;renderModelPicker();}
function initDesktopAccount(status){
 window.rezumatorBeforeClose=async()=>{
  const deadline=Date.now()+6000;
  while(saving&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));
  await save();
  return {saved:loaded&&!saving&&!studentChanges(savedStudents,students).length,busy:!!activeJob||generationStarting||window.rezumatorConnectionsBusy||driveBusy||Object.values(notionEntries).some(e=>['creating','updating'].includes(e.status))};
 };
 $('#desktopAccount').classList.remove('hidden');showDesktopAccount(status);
 $('#loginChatGPT').onclick=async()=>{
  $('#loginChatGPT').disabled=true;
  try{
   const {authUrl,needsCode}=await api('/api/account/login',{method:'POST'});
   const link=$('#continueLogin');link.href=authUrl;link.classList.remove('hidden');link.click();
   $('#cancelLogin').classList.remove('hidden');$('#desktopAccountMessage').textContent='Завершите вход в открывшемся браузере.';
   $('#claudeCodeForm').classList.toggle('hidden',!needsCode);
   clearInterval(loginPoll);let reading=false;loginPoll=true;renderModelPicker();
   loginPoll=setInterval(async()=>{if(reading)return;reading=true;try{const status=await api('/api/status');if(status.connected){endLoginWait();showDesktopAccount(status);await loadModels(true);}}catch(e){$('#desktopAccountMessage').textContent=e.message;}finally{reading=false;}},2500);
  }catch(e){endLoginWait();$('#desktopAccountMessage').textContent=e.message;}
 };
 $('#cancelLogin').onclick=async()=>{try{await api('/api/account/cancel',{method:'POST'});endLoginWait();showDesktopAccount(await api('/api/status'));}catch(e){toast(e.message);}};
 $('#logoutChatGPT').onclick=async()=>{try{await api('/api/account/logout',{method:'POST'});endLoginWait();showDesktopAccount(await api('/api/status'));}catch(e){toast(e.message);}};
 $('#claudeCodeForm').onsubmit=async event=>{event.preventDefault();const code=$('#claudeLoginCode').value.trim();if(!code)return;try{await api('/api/account/code',{method:'POST',body:JSON.stringify({code})});$('#claudeCodeForm').classList.add('hidden');$('#desktopAccountMessage').textContent='Проверяем вход в Claude…';}catch(e){$('#desktopAccountMessage').textContent=e.message;}};
 void import('/connections-ui.mjs').then(({setupConnections})=>setupConnections({api,onNeedChatGPT:async()=>{await selectGenerationProvider('openai');$('#loginChatGPT').click();},onChanged:()=>{refreshDrive();refreshNotion();},onError:toast})).catch(e=>toast(e.message));
}

init();
