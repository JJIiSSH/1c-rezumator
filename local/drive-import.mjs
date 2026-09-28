import {createHash,randomUUID} from 'node:crypto';
export const sheetId=process.env.REZUMATOR_SHEET_ID||'';
export const sheetUrl=sheetId?`https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=0`:"";
export const fieldLabels={telegram:'Telegram',age:'Возраст',github:'GitHub',location:'Место проживания',urgent:'Срочность',sourceUrl:'Ссылка на прежнее резюме',project:'О проекте',tasks:'Что делал ученик',complex:'Сложные задачи',resume:'Текст прежнего резюме',pdfName:'Файл резюме',name:'Имя'};
export const telegramKey=value=>String(value||'').trim().replace(/^https?:\/\/(?:www\.)?t\.me\//i,'').replace(/^@/,'').replace(/\/$/,'').toLowerCase();
const empty=value=>value==null||typeof value==='string'&&(!value.trim()||/^(нет[у]?|ничего|нет проектов|проектов нет|аккаунта нету|[-—.\s]+)$/i.test(value.trim()));
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function extractCandidateName(text){
 // A conservative text-only convenience; never replace a curator's filled name.
 for(const line of String(text||'').split(/\r?\n/).slice(0,15)){
  const name=line.trim().replace(/(?<=[А-Яа-яЁё])o|o(?=[А-Яа-яЁё])/g,'о');
  if(/^(?:[А-ЯЁ][а-яё-]{1,30} ){1,2}[А-ЯЁ][а-яё-]{1,30}$/.test(name)&&!/образование|навыки|резюме|опыт|должность|работа|контакты|информация/i.test(name))return name;
 }
 return '';
}
export function parseSheet(values){
 const headers=values[0]||[];
 const patterns={telegram:/^telegram$/i,urgent:/мне нужно резюме/i,location:/где вы.*живете/i,sourceUrl:/ваше резюме.*pdf/i,age:/ваш возраст/i,github:/ник на github/i,project:/опишите коротко/i,tasks:/какими.*задачами/i,complex:/самые интересные|сложные.*задач/i};
 const columns=Object.fromEntries(Object.entries(patterns).map(([k,re])=>[k,headers.findIndex(h=>re.test(String(h)))]));
 if(Object.values(columns).some(i=>i<0))throw Error('Структура Google-таблицы изменилась: не найдены обязательные заголовки. Анкеты не изменены.');
 const timeColumn=headers.findIndex(h=>/отметка времени/i.test(String(h)));
 const rows=new Map();const warnings=[];
 values.slice(1).forEach((row,index)=>{
  if(!row.some(v=>String(v).trim()))return;
  const key=telegramKey(row[columns.telegram]);
  if(!/^[a-z0-9_]{5,32}$/.test(key)){warnings.push(`Строка ${index+2}: проверьте Telegram, строка пропущена.`);return;}
  const fields={};for(const [field,col]of Object.entries(columns)){
   let value=String(row[col]??'').trim();
   if(field==='telegram')value='@'+key;
   else if(field==='urgent'){if(!value)continue;if(!/^(да|нет)(?:\s|,|$)/i.test(value)){warnings.push(`Строка ${index+2}: не распознана срочность.`);continue;}value=/^да/i.test(value);}
   else if(field==='age'){value=value.match(/^\d{1,3}\b/)?.[0]||'';if(+value<14||+value>100)value='';}
   if(empty(value))continue;
   fields[field]=value;
  }
  if(rows.has(key))warnings.push(`Повторная анкета @${key}: использована последняя строка.`);
  rows.set(key,{key,row:index+2,timestamp:String(row[timeColumn]||''),fields});
 });
 return {rows:[...rows.values()],warnings};
}
export function findStudent(students,row,source={id:sheetId,gid:0}){
 const matches=students.filter(s=>telegramKey(s.telegram)===row.key||row.timestamp&&s.driveImport?.sheetId===source.id&&(s.driveImport.sheetGid||0)===(source.gid||0)&&s.driveImport.timestamp===row.timestamp||row.fields.sourceUrl&&s.sourceUrl===row.fields.sourceUrl);
 if(matches.length>1)throw Error(`Найдено несколько анкет для @${row.key}. Уберите дубли перед импортом.`);
 return matches[0];
}
// Three-way merge: source baseline, current curator value, latest source value.
export function mergeDriveRows(students,rows,defaults,now=new Date().toISOString(),source={id:sheetId,gid:0,url:sheetUrl}){
 const next=structuredClone(students),report={created:0,updated:0,filled:0,conflicts:0,unchanged:0};
 for(const row of rows){
  let s=findStudent(next,row,source);const created=!s;
  if(!s){s={...structuredClone(defaults),id:'drive_'+createHash('sha256').update(source.id+(source.gid?':'+source.gid:'')+':'+row.key).digest('hex').slice(0,24)};next.push(s);report.created++;}
  const previous=s.driveImport||{},baseline=previous.sheetId===source.id&&(previous.sheetGid||0)===(source.gid||0)?previous.values||{}:{},history=[...(previous.history||[])];let changes=0;
  for(const [field,value]of Object.entries(row.fields)){
   if(!Object.hasOwn(fieldLabels,field))continue;
   const old=s[field];
   if(equal(old,value)||equal(baseline[field],value)||field==='telegram'&&telegramKey(old)===telegramKey(value))continue;
   const applied=created||empty(old)||Object.hasOwn(baseline,field)&&equal(old,baseline[field]);
   if(applied){s[field]=value;if(!created&&empty(old))report.filled++;}
   else report.conflicts++;
   if(!created)history.push({id:randomUUID(),field,label:fieldLabels[field],before:old??'',value,at:now,status:applied?'applied':'conflict',hadResume:!!s.result?.resume_text});
   changes++;
  }
  s.driveImport={...previous,sheetId:source.id,sheetGid:source.gid||0,url:source.url,timestamp:row.timestamp,row:row.row,values:{...baseline,...row.fields},lastImportedAt:now,history:history.slice(-100),file:row.file||previous.file||null,warnings:row.warnings||[]};
  if(!created){if(changes)report.updated++;else report.unchanged++;}
 }
 if(next.length>150)throw Error('После импорта получится больше 150 анкет. Данные не изменены.');
 return {students:next,report};
}
