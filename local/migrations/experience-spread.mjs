import {createHash} from 'node:crypto';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {experienceLabel,experienceSettings} from '../engine.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const file=path.join(root,'.data/students.json');
const monthNames=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const monthIndex=new Map(monthNames.map((name,index)=>[name.toLocaleLowerCase('ru'),index]));
const periodPattern=/^([А-ЯЁ][а-яё]+) (20\d{2}) - ((?:[А-ЯЁ][а-яё]+ 20\d{2})|настоящее время)$/gm;
const now=new Intl.DateTimeFormat('ru-RU',{year:'numeric',month:'2-digit',timeZone:'Europe/Moscow'}).formatToParts(new Date());
const asOfYear=Number(now.find(part=>part.type==='year').value);
const asOfMonth=Number(now.find(part=>part.type==='month').value)-1;
const monthNumber=(year,month)=>year*12+month;
const currentMonth=monthNumber(asOfYear,asOfMonth);

function parseMonth(text){
 const match=text.match(/^([А-ЯЁа-яё]+) (20\d{2})$/);
 if(!match||!monthIndex.has(match[1].toLocaleLowerCase('ru')))throw new Error('Неизвестная дата: '+text);
 return monthNumber(Number(match[2]),monthIndex.get(match[1].toLocaleLowerCase('ru')));
}
function formatMonth(number){
 return monthNames[((number%12)+12)%12]+' '+Math.floor(number/12);
}
function monthPhrase(number){
 const n=number%100,last=n%10;
 return number+' '+(n>=11&&n<=14?'месяцев':last===1?'месяц':last>=2&&last<=4?'месяца':'месяцев');
}
function updateAudit(text,{oldPeriod,newPeriod,oldEarlierMonths,newEarlierMonths,target}){
 if(typeof text!=='string')return text;
 return text
  .replace(new RegExp(oldPeriod.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),newPeriod)
  .replaceAll('4 года 3 месяца',experienceLabel(target))
  .replace(/51 календарн(?:ый|ых) месяц(?:ев|а)?/gi,target+' календарных '+monthPhrase(target).split(' ')[1])
  .replace(/51 месяц(?:ев|а)?/gi,monthPhrase(target))
  .replace(new RegExp(oldEarlierMonths+' месяц(?:ев|а)?','gi'),monthPhrase(newEarlierMonths));
}

const students=JSON.parse(await readFile(file,'utf8'));
const rules=await readFile(path.join(root,'prompts/rules.md'),'utf8');
const rulesVersion=createHash('sha256').update(rules).digest('hex').slice(0,12);
const changes=[],skipped=[];
for(const student of students){
 const result=student.result,text=result?.resume_text;
 if(!text||String(student.targetExperienceYears??'').trim()){skipped.push({id:student.id,reason:'нет результата или задан стаж'});continue;}
 if(student.jobs?.some(job=>job.start&&(job.end||job.current))){skipped.push({id:student.id,reason:'даты заданы куратором'});continue;}
 const target=experienceSettings(student).target_months;
 const periods=[...text.matchAll(periodPattern)].map(match=>({
  line:match[0],index:match.index,start:parseMonth(match[1]+' '+match[2]),
  end:match[3]==='настоящее время'?currentMonth:parseMonth(match[3]),
  suffix:match[3]
 })).sort((a,b)=>a.start-b.start);
 if(periods.length!==2){skipped.push({id:student.id,reason:'нужна ручная проверка периодов'});continue;}
 const [earlier,later]=periods;
 const oldEarlierMonths=earlier.end-earlier.start+1;
 const oldTotal=oldEarlierMonths+later.end-later.start+1;
 if(earlier.end>=later.start||oldTotal!==51||!text.includes('4 года 3 месяца')){
  skipped.push({id:student.id,reason:'хронология отличается от шаблона 51 месяца'});continue;
 }
 if(target===51){result.rules_version=rulesVersion;skipped.push({id:student.id,reason:'целевой срок уже совпадает'});continue;}
 const newStart=earlier.start-(target-oldTotal);
 // A blind shift into 2021 could put a configuration before its first release.
 if(newStart<monthNumber(2022,0)&&newStart<earlier.start){skipped.push({id:student.id,reason:'сдвиг назад до 2022 года требует проверки конфигурации'});continue;}
 const newPeriod=formatMonth(newStart)+' - '+earlier.suffix;
 const newEarlierMonths=earlier.end-newStart+1;
 const facts={oldPeriod:earlier.line,newPeriod,oldEarlierMonths,newEarlierMonths,target};
 const oldResume=text;
 const lineIndex=oldResume.indexOf(earlier.line);
 result.resume_text=(oldResume.slice(0,lineIndex)+newPeriod+oldResume.slice(lineIndex+earlier.line.length))
  .replace('4 года 3 месяца',experienceLabel(target));
 result.summary=updateAudit(result.summary,facts);
 result.changes=(result.changes||[]).map(value=>updateAudit(value,facts));
 result.changes.unshift('Корректировка черновика для разброса стажа: ранний период '+earlier.line+' заменён на '+newPeriod+'; общий стаж '+experienceLabel(oldTotal)+' заменён на '+experienceLabel(target)+'. Подтвердите предложенные даты у ученика.');
 result.checks=(result.checks||[]).map(check=>({...check,detail:updateAudit(check.detail,facts)}));
 result.rules_version=rulesVersion;
 changes.push({id:student.id,name:student.name||student.telegram||student.id,old:oldTotal,target,oldPeriod:earlier.line,newPeriod});
}
if(process.argv.includes('--apply')){
 const backupDir=path.join(root,'.data/backups');await mkdir(backupDir,{recursive:true});
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');
 const backup=path.join(backupDir,'students-before-experience-spread-'+stamp+'.json');
 await writeFile(backup,await readFile(file),{mode:0o600,flag:'wx'});
 const tmp=file+'.tmp';
 await writeFile(tmp,JSON.stringify(students,null,2)+'\n',{mode:0o600});
 await rename(tmp,file);
 const report=path.join(backupDir,'experience-spread-'+stamp+'.json');
 await writeFile(report,JSON.stringify({changes,skipped,backup},null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({applied:changes.length,report,changes,skipped},null,2));
}else console.log(JSON.stringify({dryRun:true,changes,skipped},null,2));
