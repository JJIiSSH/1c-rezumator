import {validateLegendPlan} from './legend-plan.mjs';
export function useful(v){return typeof v==='string'&&v.trim().length>1&&!/^(нет[у]?|ничего|опыта нет|[-—.\s]+)$/i.test(v.trim());}
function stableOffset(id){
 let hash=2166136261;
 for(const char of String(id||''))hash=Math.imul(hash^char.codePointAt(0),16777619)>>>0;
 return hash%7;
}
function countLabel(value,forms){
 const n=Math.abs(value)%100,tail=n%10;
 return forms[n>10&&n<20?2:tail===1?0:tail>=2&&tail<=4?1:2];
}
export function experienceLabel(months){
 const years=Math.floor(months/12),rest=months%12,parts=[];
 if(years)parts.push(`${years} ${countLabel(years,['год','года','лет'])}`);
 if(rest||!parts.length)parts.push(`${rest} ${countLabel(rest,['месяц','месяца','месяцев'])}`);
 return parts.join(' ');
}
export function experienceSettings(s){
 const raw=s.targetExperienceYears;
 if(raw==null||typeof raw==='string'&&!raw.trim()||['string','number'].includes(typeof raw)&&/^0+(?:[.,]0*)?$/.test(String(raw).trim())){
  const offset=stableOffset(s.id);
  const age=Number(String(s.age??'').trim());
  const target=Number.isInteger(age)&&age>=18&&age<=22?48+offset%2:Number.isInteger(age)&&age>=23&&age<=25?48+offset%4:48+offset;
  return {mode:'default',min_months:48,max_months:54,target_months:target};
 }
 if(!['string','number'].includes(typeof raw)||!/^\d+(?:[.,]\d*)?$/.test(String(raw).trim()))throw new Error('Укажите стаж числом лет, например 3,5, или оставьте поле пустым.');
 const years=Number(String(raw).trim().replace(',','.'));
 if(!Number.isFinite(years)||years<0||years>60)throw new Error('Стаж должен быть от 0 до 60 лет.');
 const months=Math.round(years*12);
 return {mode:'custom',years,target_months:months,min_months:months,max_months:months,required_resume_label:experienceLabel(months),overrides_job_dates:true};
}
export function validateStudent(s){
 if(!s||typeof s!=='object'||typeof s.id!=='string'||!Array.isArray(s.jobs))throw new Error('Некорректная анкета');
 if(!/^[a-zA-Z0-9_-]{1,80}$/.test(s.id))throw new Error('Некорректный идентификатор');
 for(const v of Object.values(s))if(typeof v==='string'&&v.length>120000)throw new Error('Слишком длинное поле');
 if(s.jobs.length>20)throw new Error('Максимум 20 мест работы');
 experienceSettings(s);
 if(s.resumeReady!==undefined&&typeof s.resumeReady!=='boolean')throw new Error('Некорректная отметка готовности');
 if(s.fillMetrics!==undefined&&typeof s.fillMetrics!=='boolean')throw new Error('Некорректная настройка метрик');
 if(s.legendNotes!==undefined&&typeof s.legendNotes!=='string')throw new Error('Некорректные указания для легенды');
 if(s.legend!=null)parseLegendResult(JSON.stringify(s.legend),{allowEmpty:true});
 if(s.metrics!==undefined){
  if(!Array.isArray(s.metrics)||s.metrics.length>20)throw new Error('Максимум 20 метрик');
  if(!s.metrics.every(m=>m&&typeof m==='object'&&!Array.isArray(m)&&['label','value','context'].every(k=>m[k]===undefined||(typeof m[k]==='string'&&m[k].length<=500))))throw new Error('Некорректная метрика');
 }
 return s;
}
export function completeness(s){
 const text=[s.project,s.tasks,s.complex,s.resume,...s.jobs.map(j=>j.tasks||'')].join(' ');
 return [
 {label:'Материал о кандидате',ok:useful(s.resume)||useful(s.project)||useful(s.tasks),hint:'Анкета или текст прежнего резюме'},
 {label:'Целевая должность',ok:useful(s.title),hint:'Для какой роли готовим резюме'},
 {label:'Места и периоды работы',ok:s.jobs.some(j=>useful(j.company)&&j.start&&(j.end||j.current)),hint:useful(s.resume)?'Можно извлечь из загруженного резюме':'Добавьте вручную или загрузите PDF'},
 {label:'Конкретные задачи',ok:useful(s.tasks)||s.jobs.some(j=>useful(j.tasks)),hint:'Необязательно: задачи для 1С достроим из общего опыта'},
 {label:'Конфигурации 1С',field:'configurations',ok:useful(s.configurations)||/1[сc]\s*[:：]?\s*(ERP|УТ|ЗУП|БП|КА|УНФ|Бухгалтер|Управлен|Документо)|\bERP\b.*1[сc]|(?:^|[\s,])(ЗУП|УТ|БП|КА|УНФ|УПП)(?=$|[\s,;.\d])/iu.test(text),hint:'Необязательно: подберём по контексту или учтём твой выбор в анкете'},
 {label:'Контекст проекта',ok:useful(s.project),hint:'Сфера, пользователи и назначение системы'}
 ];
}
export function metricSettings(s){
 const enabled=s.fillMetrics!==false;
 const metrics=enabled?(s.metrics||[]).map(m=>({label:(m.label||'').trim(),value:(m.value||'').trim(),context:(m.context||'').trim()})).filter(m=>m.label||m.value||m.context):[];
 const mode=!enabled?'off':!metrics.length?'auto':metrics.every(m=>m.label&&m.value)?'provided':'complete';
 return {enabled,mode,metrics};
}
export function buildPrompt(s,rules){
 validateStudent(s);
 const metricConfig=metricSettings(s);
 return rules+'\n\nДАННЫЕ КУРАТОРА И УЧЕНИКА (JSON):\n'+JSON.stringify({
 candidate:{name:s.name,telegram:s.telegram,age:s.age,github:s.github,original_location:s.location,project:s.project,configurations:s.configurations||'',tasks:s.tasks,complex_tasks:s.complex,old_resume:s.resume},
 settings:{title:/начинающ|junior|стаж[её]р/i.test(s.title||'')?'Программист 1С':s.title,track:/начинающ|junior|стаж[её]р/i.test(s.track||'')?'Универсальный профиль':s.track,city:'Москва',show_age:s.showAge,show_github:s.showGithub,fill_metrics:metricConfig.enabled,metrics_mode:metricConfig.mode,context_notes:s.notes},
 experience:experienceSettings(s),
 metrics:metricConfig.metrics,
 jobs:s.jobs.filter(j=>Object.values(j).some(v=>typeof v==='string'&&v.trim())),
 as_of_date:new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date())
 },null,2);
}
export function normalizeResumeText(text){
 const normalized=text.replace(/[\u2012-\u2015]/g,'-').replace(/^(\s*)[•●▪◦]\s*/gm,'$1- ');
 let desired=false;
 return normalized.split('\n').flatMap(line=>{
  const trimmed=line.trim();
  if(/^Желаемая должность(?: и зарплата)?$/i.test(trimmed))desired=true;
  else if(/^(?:Опыт работы|Образование|Навыки|Дополнительная информация|Обо мне)(?:\s|$)/i.test(trimmed))desired=false;
  if(/^(?:(?:желаемая|ожидаемая)\s+(?:зарплата|з\/п|оклад)|зарплатные ожидания|ожидания по зарплате|(?:зарплата|з\/п|оклад)\s*:)/i.test(trimmed))return [];
  if(desired&&/^(?:от\s+|до\s+)?\d[\d\s.,]*(?:₽|руб(?:лей|ля|\.)?)(?:\s+(?:на руки|gross|net))?$/i.test(trimmed))return [];
  if(desired)line=line.replace(/\s*(?:[,;]|\s-\s)\s*(?:от\s+|до\s+)?\d[\d\s.,]*(?:₽|руб(?:лей|ля|\.)?)(?:\s+(?:на руки|gross|net))?$/i,'');
  return [line];
 }).join('\n');
}
export function publicResumeDisclosure(text){
 const match=String(text||'').match(/(?:опыт\p{L}*[^.\n]{0,50}адаптир\p{L}*|адаптир\p{L}*[^.\n]{0,40}(?:для|под)\s+1[сc]|адаптац\p{L}*\s+(?:опыт\p{L}*|резюме|задач\p{L}*|стек\p{L}*)|не[- ]?1[сc]\p{L}*|не\s+из\s+1[сc]|исходн\p{L}*\s+(?:опыт|стек)|перенос\p{L}*\s+опыт\p{L}*\s+(?:из|в))/iu);
 return match?.[0]||'';
}
export function inputSignature(s){
 const {result,resultSignature,legend,legendSignature,legendNotes,resumeReady,driveImport,targetExperienceYears,...input}=s;
 if(targetExperienceYears!=null&&String(targetExperienceYears).trim())input.targetExperienceYears=targetExperienceYears;
 return JSON.stringify(input);
}
export function legendSignature(s){
 return JSON.stringify({input:inputSignature(s),resume:s.result?.resume_text||'',changes:s.result?.changes||[],checks:s.result?.checks||[],notes:s.legendNotes||''});
}
export function buildLegendPrompt(s,rules){
 validateStudent(s);
 if(typeof s.result?.resume_text!=='string'||!s.result.resume_text.trim())throw new Error('Сначала создайте резюме. Легенда строится по тексту в редакторе.');
 if(s.result.resume_text.length>120000)throw new Error('Резюме слишком длинное');
 const data=JSON.parse(buildPrompt(s,'').split('(JSON):\n')[1]);
 return rules+'\n\nДАННЫЕ ДЛЯ ЛЕГЕНДЫ (JSON):\n'+JSON.stringify({
  current_resume:s.result.resume_text,
  resume_changes:s.result.changes||[],resume_checks:s.result.checks||[],
  candidate:data.candidate,settings:data.settings,experience:data.experience,metrics:data.metrics,jobs:data.jobs,
  legend_notes:s.legendNotes||'',as_of_date:data.as_of_date
 },null,2);
}
export function parseLegendResult(text,{allowEmpty=false}={}){
 const clean=text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
 const value=JSON.parse(clean);
 if(value.case_plan!==undefined)validateLegendPlan(value.case_plan);
 if(typeof value?.legend_text!=='string'||(!allowEmpty&&!value.legend_text.trim())||value.legend_text.length>120000)throw new Error('Модель вернула неполную легенду. Повторите генерацию.');
 const {resume_text,...rest}=parseResult(JSON.stringify({...value,resume_text:value.legend_text}),{allowMetaDisclosure:true});
 return {...rest,legend_text:resume_text};
}

export function buildLegendPlanPrompt(s,rules){
 return buildLegendPrompt(s,rules)+'\n\nЭТАП СЕРВИСА: 1 из 2. Верни только JSON паспорта и карточек по заданной схеме. Пока не пиши legend_text или готовый рассказ. Поля карточек заполняй компактно; solution раскрой в 3-5 предложениях: механизм 1С и личная реализация, техническая сложность или выбор, диагностика причины, изменение и проверка. Не ограничивайся сбором требований и проверкой на копии базы. team_process раскрой в 3-5 предложениях: роли, постановка и планирование задач, ритм/методология, ревью, тестирование, приёмка и выпуск. По умолчанию team_process для обеих работ: Scrum и недельные спринты, планирование, ежедневная синхронизация, ревью, проверка на копии, приёмка и согласованный выпуск, итоги спринта и ретроспектива. Не изобретай другую методологию ради разнообразия; явно заданный процесс работы приоритетнее шаблона. Предложенный процесс отметить в proposals. Каждому работодателю и кейсу присвой уникальный id; employer_id и case_id должны ссылаться на эти id. Подготовь 3-4 кейса по STAR с личным вкладом и бизнес-результатом, соблюдая режим метрик, и 2-3 разных факапа исключительно в тестовых средах. Если в legend_notes есть вакансия, выбери релевантные кейсы из current_resume; требования вакансии не подтверждают опыт. Все достроенные детали включи в proposals с работодателем; существенные неизвестные в questions.';
}

export function buildLegendReviewPrompt(s,rules,plan){
 validateLegendPlan(plan);
 const input=JSON.parse(buildLegendPrompt(s,'').split('(JSON):\n')[1]);
 const {candidate,jobs,...source}=input;
 return rules+'\n\nДАННЫЕ ДЛЯ ПРОВЕРКИ ЛЕГЕНДЫ (JSON):\n'+JSON.stringify({...source,case_plan:plan},null,2)+'\n\nЭТАП СЕРВИСА: 2 из 2. Проверь карточки относительно current_resume и правил; это предложения первого прохода, не подтверждённые факты. Исправь несогласованность, несвязанные технические перечисления и необоснованные гарантии. Сохрани объяснимую техническую конкретику: механизм 1С, личную реализацию, сложность или выбор, диагностику, изменение и проверку. Не сокращай кейс до обсуждения требований и общих действий. Сверь team_process с отдельным описанием команды в рассказе: роли, постановка задач, ритм работы, ревью, тестирование, приёмка и выпуск; сохрани стандартный Scrum с недельными спринтами, планированием, ежедневной синхронизацией, ревью, проверкой на копии, приёмкой и согласованным выпуском, итогами и ретроспективой. Не заменяй его другой методологией, если в источнике явно не задан иной процесс; происхождение реконструкции сохрани в служебных полях. Не добавляй компании, даты или новые проекты независимо от резюме. Верни только JSON финального результата: legend_text с готовым материалом, summary, checks, questions, changes и case_plan с проверенными исправленными карточками. Содержание рассказа и ответов должно совпадать с исправленным case_plan. Проверь основной рассказ примерно на 10 минут, STAR, бизнес-эффект и акценты под вакансию из legend_notes, если она дана. Среди 8-10 вопросов обязательны причина ухода и ожидания от новой работы; неизвестные личные мотивы раскрой через 2-3 готовых альтернативы без выдуманной биографии. В legend_text не оставляй «нужно уточнить», ссылки на исходник, инструкции куратора и другие служебные оговорки. Добавь слои архитектуры проектов и выбора инструментов; разбей кейсы и факапы на короткие подписанные блоки. Перенеси происхождение предложений в changes/checks; отдельно проверь 2-3 факапа только в тесте. Оценку подачи по тексту и план репетиции не добавляй. Служебные замечания не включай в legend_text.';
}
export function parseResult(text,{allowMetaDisclosure=false}={}){
 const clean=text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
 const r=JSON.parse(clean);
 if(typeof r.resume_text!=='string'||typeof r.summary!=='string'||!Array.isArray(r.checks)||!Array.isArray(r.questions)||!Array.isArray(r.changes))throw new Error('Модель вернула неполный результат. Повторите генерацию.');
 if(!r.checks.every(c=>c&&typeof c.label==='string'&&typeof c.detail==='string'&&typeof c.evidence==='string'&&['present','missing','clarify','not_applicable'].includes(c.status))||![...r.questions,...r.changes].every(x=>typeof x==='string'))throw new Error('Некорректный формат проверки');
 r.resume_text=normalizeResumeText(r.resume_text);
 if(!allowMetaDisclosure&&publicResumeDisclosure(r.resume_text))throw new Error('Модель добавила в публичное резюме служебное пояснение об адаптации опыта. Повторите генерацию.');
 return r;
}

export function studentStatus(s){
 if(s.resumeReady===true)return {label:'Готово',className:'ready'};
 if(s.urgent)return {label:'Требуется срочно',className:'urgent'};
 return {label:s.result?'Есть черновик':'Анкета ученика',className:''};
}
