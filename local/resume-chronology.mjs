import {experienceLabel,experienceSettings} from './engine.mjs';

const months=['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
const stamp=`(?:${months.join('|')})\\s+\\d{4}|\\d{4}[-.]\\d{2}|\\d{4}`;
const period=new RegExp(`^(?:Период:\\s*)?(${stamp})\\s*-\\s*(${stamp}|(?:по\\s+)?настоящее время|н\\.\\s*в\\.)(?:\\s*\\([^)]*\\))?$`,'i');
export function currentMonth(date=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit'}).formatToParts(date);
 return Number(parts.find(p=>p.type==='year').value)*12+Number(parts.find(p=>p.type==='month').value)-1;
}
function monthIndex(value,end=false){
 const iso=value.match(/^(\d{4})[-.](\d{2})$/);if(iso)return Number(iso[2])>=1&&Number(iso[2])<=12?Number(iso[1])*12+Number(iso[2])-1:NaN;
 if(/^\d{4}$/.test(value))return Number(value)*12+(end?11:0);
 const match=value.toLowerCase().match(/^(\S+)\s+(\d{4})$/);return match?Number(match[2])*12+months.indexOf(match[1]):NaN;
}
export function resumePeriods(text,asOf=currentMonth()){
 const lines=text.split('\n'),heading=lines.findIndex(l=>/^Опыт работы(?:\s|:|$)/i.test(l.trim()));
 if(heading<0)return {lines,heading,periods:[]};
 let end=lines.findIndex((l,i)=>i>heading&&/^(?:Образование|Навыки|Ключевые навыки|Дополнительная информация|Обо мне)(?:\s|:|$)/i.test(l.trim()));if(end<0)end=lines.length;
 const periods=[];
 for(let i=heading+1;i<end;i++){
  const value=lines[i].trim(),match=value.match(period);
  if(match){const current=/настоящее|н\.\s*в\./i.test(match[2]);periods.push({line:i,start:monthIndex(match[1]),end:current?asOf:monthIndex(match[2],true),current});}
  else if(/^Период:\s*не указан$/i.test(value))periods.push({line:i,start:NaN,end:NaN,current:false});
 }
 return {lines,heading,periods};
}
export function countExperience(periods){
 const sorted=periods.toSorted((a,b)=>a.start-b.start);let total=0,end=-Infinity;
 for(const p of sorted){if(!Number.isInteger(p.start)||!Number.isInteger(p.end)||p.end<p.start)throw Error('В резюме не заполнены или перепутаны даты работы. Повторите генерацию.');total+=Math.max(0,p.end-Math.max(end+1,p.start)+1);end=Math.max(end,p.end);}
 return total;
}
export function finalizeResumeChronology(result,student,{asOf=currentMonth()}={}){
 const parsed=resumePeriods(result.resume_text,asOf);
 if(parsed.heading<0)throw Error('Модель не указала раздел опыта работы. Повторите генерацию.');
 if(parsed.periods.length!==2)throw Error('Модель не указала периоды двух мест работы. Повторите генерацию.');
 const [latest,earlier]=parsed.periods;
 const actual=countExperience(parsed.periods);
 if(!latest.current||earlier.current)throw Error('Последнее место работы должно заканчиваться «по настоящее время». Повторите генерацию.');
 if(earlier.end>=latest.start)throw Error('Периоды двух работ пересекаются. Повторите генерацию.');
 const target=experienceSettings(student),hasExplicitDates=student.jobs.some(j=>j.start&&(j.end||j.current));
 if((target.mode==='custom'||!hasExplicitDates)&&actual!==target.target_months)throw Error(`Периоды резюме дают ${experienceLabel(actual)}, а требуется ${experienceLabel(target.target_months)}. Повторите генерацию.`);
 const header=`Опыт работы: ${experienceLabel(actual)}`;
 if(parsed.lines[parsed.heading].trim()===header)return result;
 const old=parsed.lines[parsed.heading];parsed.lines[parsed.heading]=header;
 return {...result,resume_text:parsed.lines.join('\n'),changes:[...result.changes,`Проверка дат: заголовок «${old}» исправлен на «${header}» по двум показанным периодам.`]};
}

function monthText(index){return `${months[index%12][0].toUpperCase()+months[index%12].slice(1)} ${Math.floor(index/12)}`;}
// An explicit repair of stored drafts; never applied automatically on page load.
export function repairStoredChronology(student,{asOf=currentMonth()}={}){
 const result=structuredClone(student.result),parsed=resumePeriods(result.resume_text,asOf),target=experienceSettings(student);
 if(parsed.heading<0)return result;
 if(parsed.periods.length!==2)throw Error('Не удалось выделить два периода для исправления.');
 const [latest,earlier]=parsed.periods;let total,datesChanged=false;
 if(latest.current&&Number.isInteger(earlier.start)&&(target.mode!=='custom'||countExperience(parsed.periods)===target.target_months)){
  total=countExperience(parsed.periods);
 }else{
  const existing=parsed.periods.every(p=>Number.isInteger(p.start)&&Number.isInteger(p.end)&&p.end>=p.start)?countExperience(parsed.periods):0;
  total=target.mode==='custom'?target.target_months:existing>=48&&existing<=54?existing:target.target_months;
  const latestOld=latest.end-latest.start+1;
  const latestLength=Math.min(total-1,Math.max(1,Number.isFinite(latestOld)?Math.round(total*latestOld/(existing||total)):Math.round(total*0.6)));
  latest.end=asOf;latest.start=asOf-latestLength+1;latest.current=true;
  earlier.end=latest.start-1;earlier.start=asOf-total+1;
  parsed.lines[latest.line]=`${monthText(latest.start)} - по настоящее время`;
  parsed.lines[earlier.line]=`${monthText(earlier.start)} - ${monthText(earlier.end)}`;
  datesChanged=true;
 }
 const oldHeader=parsed.lines[parsed.heading],header=`Опыт работы: ${experienceLabel(total)}`;
 if(!datesChanged&&oldHeader.trim()===header)return result;
 parsed.lines[parsed.heading]=header;result.resume_text=parsed.lines.join('\n');
 const detail=`Периоды черновика проверены: ${parsed.lines[latest.line].trim()}; ${parsed.lines[earlier.line].trim()}. Сумма ${experienceLabel(total)} на текущий месяц. Последняя работа указана по настоящее время. Компании и задачи сохранены; изменённые периоды предложены куратором для черновика.`;
 result.checks=result.checks.filter(c=>c.label!=='Хронология');result.checks.push({label:'Хронология',status:datesChanged?'clarify':'present',detail,evidence:`До исправления: ${oldHeader}; ${student.result.resume_text.split('\n')[latest.line]}; ${student.result.resume_text.split('\n')[earlier.line]}`});
 result.changes.push(detail);
 if(/0 месяцев/i.test(oldHeader)){
  result.summary=result.summary.replace(/Цель «0 месяцев»[^.]*\./g,'').trim();
  result.questions=result.questions.filter(q=>!/(?:цель стажа|0 месяцев)/i.test(q));
  result.changes.push('Нулевая цель стажа снята: применён стандартный диапазон 4-4,5 года. Прежние служебные записи о нуле описывают состояние до исправления.');
 }
 return result;
}
