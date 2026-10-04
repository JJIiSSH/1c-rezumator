import {createHash} from 'node:crypto';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {validateStudent,normalizeResumeText} from './engine.mjs';
import {legendNotion} from './legend-format.mjs';

export const notionWorkspace={id:process.env.REZUMATOR_NOTION_WORKSPACE_ID||'',name:'Ваше пространство Notion'};
export const notionContainerTitle='Резюме учеников';
export function escapeNotion(text){return String(text??'').replace(/[\\*~`$\[\]<>{}|^]/g,'\\$&');}
export function notionDate(value=new Date()){
 const date=value instanceof Date?value:new Date(value);if(Number.isNaN(date.valueOf()))throw new Error('Некорректная дата страницы Notion.');
 return new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',timeZone:'Europe/Moscow'}).format(date);
}
function textBlocks(text){return normalizeResumeText(text||'').split('\n').map(line=>{
 if(/^\s*-\s+/.test(line))return '- '+escapeNotion(line.replace(/^\s*-\s+/,''));
 if(/^(Желаемая должность и зарплата|Опыт работы.*|Образование|Навыки|Дополнительная информация)$/.test(line.trim()))return '## '+escapeNotion(line.trim());
 return escapeNotion(line);
}).join('\n');}
export function notionPage(s){
 validateStudent(s);
 if(!s.result?.resume_text?.trim())throw new Error('Сначала создайте резюме.');
 const title='Резюме '+notionDate();
 const resume=s.result.resume_text.split('\n');if(resume[0].trim()===s.name?.trim())resume.shift();
 const parts=['# Резюме {color="green_bg"}',textBlocks(resume.join('\n').trim())];
 if(s.legend?.legend_text?.trim())parts.push('# Легенда для собеседования',legendNotion(s.legend.legend_text));
 const page={properties:{title},content:parts.join('\n\n')};
 if(page.content.length>250000)throw new Error('Слишком большой материал для одной страницы Notion.');
 return page;
}
export function protectNotionLegend(page,previous,{replaceLegend=false}={}){
 if(replaceLegend)return page;
 const content=previous.text.match(/<content>\n?([\s\S]*)\n?<\/content>/)?.[1]??previous.text;
 const index=content.search(/^#{1,6}[ \t]+[^\n]*легенд(?:а|ы)(?=[ \t{:]|$)[^\n]*$/im);
 if(index<0)return page;
 const oldResume=content.slice(0,index).trimEnd();
 if(!oldResume.trim())throw Error('Не найден отдельный блок резюме. Авторская легенда сохранена; обновление отменено.');
 const localLegend=page.content.search(/^# Легенда для собеседования$/m);
 const newResume=(localLegend<0?page.content:page.content.slice(0,localLegend)).trimEnd();
 return {...page,content:newResume+'\n\n'+content.slice(index).trimEnd(),contentUpdates:[{old_str:oldResume,new_str:newResume,replace_all_matches:false}],legendPreserved:true};
}
export function studentHubPage(s){
 const title=escapeNotion(s.name||s.telegram||'Ученик');
 return {properties:{title},icon:'💻',content:'## Точка A\n- List\n\n## Точка B\n- List\n\n# Занятия с ментором/HR {color="green_bg"}'};
}
export const studentHubFooter='<callout color="blue_bg">\n\t<empty-block/>\n</callout>\n\n# Личные странички ученика {color="green_bg"}';
export function notionPageUrl(value){
 if(typeof value!=='string')return null;
 try{const u=new URL(value);return u.protocol==='https:'&&['notion.so','www.notion.so','app.notion.com','www.notion.com'].includes(u.hostname)&&u.pathname!=='/'?u.href:null;}catch{return null;}
}
export function createdPage(result){
 const page=result?.pages?.[0];const url=notionPageUrl(page?.url);
 if(!url)throw new Error('Notion не вернул ссылку на созданную страницу.');
 return {url,pageId:page.id||null};
}

export class NotionExports {
 constructor({file,client,workspace=notionWorkspace}){this.file=file;this.client=client;this.workspace=workspace;this.entries=Object.create(null);this.container=null;this.saveQueue=Promise.resolve();this.busy=false;}
 async init(){
  try{const saved=JSON.parse(await readFile(this.file,'utf8'));this.container=saved.__container||null;delete saved.__container;this.entries=Object.assign(Object.create(null),saved);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(this.container?.status==='creating'){this.container.status='uncertain';this.container.message='Создание папки было прервано. Проверьте Notion, чтобы не создать дубль.';}
  for(const e of Object.values(this.entries))if(e.status==='creating'){e.status='uncertain';e.message='Экспорт был прерван. Проверьте Notion перед созданием ещё одной страницы.';}
  for(const e of Object.values(this.entries))if(e.status==='updating'){e.status='update_error';e.message='Обновление было прервано. Проверьте страницу; повтор обновит тот же адрес.';}
 }
 save(){const data=JSON.stringify({...this.entries,...(this.container?{__container:this.container}:{})},null,2);this.saveQueue=this.saveQueue.catch(()=>{}).then(async()=>{await writeFile(this.file+'.tmp',data,{mode:0o600});await rename(this.file+'.tmp',this.file);});return this.saveQueue;}
 status(){return {workspace:this.workspace,container:this.container,entries:this.entries};}
 async ensureContainer(){
  if(this.container?.pageId&&notionPageUrl(this.container.url))return this.container;
  if(this.container?.status==='uncertain')throw new Error(this.container.message);
  this.container={title:notionContainerTitle,status:'creating',message:'Создаём папку для резюме…',createdAt:new Date().toISOString()};await this.save();
  let attempted=false;
  try{
   await this.client.connect();attempted=true;
   const page={properties:{title:notionContainerTitle},icon:'📁',content:'Здесь хранятся готовые резюме и легенды учеников, созданные в 1с-резюматоре.'};
   Object.assign(this.container,createdPage(await this.client.createPage(page)),{status:'done',message:'Папка для резюме создана.'});await this.save();return this.container;
  }catch(error){this.container.status=attempted&&!error.creationRejected?'uncertain':'error';this.container.message=this.container.status==='uncertain'?'Не удалось подтвердить создание папки. Проверьте Notion перед повтором.':error.message;await this.save();throw error;}
 }
 async start(student){
  const page=notionPage(student),existing=this.entries[student.id];
  if(existing&&(existing.pageId||['done','creating','uncertain','updating','update_error'].includes(existing.status)))return existing;
  if(this.busy)throw new Error('Дождитесь завершения текущего экспорта в Notion.');
  this.busy=true;
  const entry={...existing,studentId:student.id,title:page.properties.title,status:'creating',message:'Подключаемся к Notion…',createdAt:existing?.createdAt||new Date().toISOString(),contentHash:createHash('sha256').update(JSON.stringify(page)).digest('hex')};
  this.entries[student.id]=entry;
  try{await this.save();}catch(e){delete this.entries[student.id];this.busy=false;throw e;}
  this.run(student,page,entry);return entry;
 }
 async update(student,{replaceLegend=false}={}){
  if(replaceLegend&&!student.legend?.legend_text?.trim())throw Error('Сначала создайте легенду в резюматоре, чтобы заменить ею легенду Notion.');
  const page=notionPage(student),entry=this.entries[student.id];
  if(!entry?.pageId||!notionPageUrl(entry.url))throw new Error('Сначала создайте страницу этого ученика в Notion.');
  if(entry.status==='updating')return entry;
  if(this.busy)throw new Error('Дождитесь завершения текущего экспорта в Notion.');
  const previous={...entry};this.busy=true;
  entry.status='updating';entry.message='Подключаемся для обновления страницы…';
  try{await this.save();}catch(e){Object.assign(entry,previous);this.busy=false;throw e;}
  this.runUpdate(page,entry,{replaceLegend});return entry;
 }
 async runUpdate(page,entry,options){
  try{
   await this.client.connect();
   const previous=await this.client.fetchPage(entry.pageId);
   if(previous.metadata?.type!=='page'||typeof previous.text!=='string'||previous.truncated||previous.unknown_block_count>0)throw new Error('Не удалось полностью прочитать прежнюю страницу. Обновление отменено.');
   const backups=path.join(path.dirname(this.file),'notion-backups');await mkdir(backups,{recursive:true});
   const backup=path.join(backups,createHash('sha256').update(entry.pageId).digest('hex').slice(0,16)+'-'+Date.now()+'.json');
   await writeFile(backup,JSON.stringify(previous,null,2),{mode:0o600,flag:'wx'});
   const updatedPage=protectNotionLegend(page,previous,options);
   entry.message='Обновляем существующую страницу в Notion…';
   await this.client.updatePage(entry.pageId,updatedPage);
   Object.assign(entry,{status:'done',title:page.properties.title,message:updatedPage.legendPreserved?'Резюме обновлено. Легенда в Notion сохранена.':'Страница обновлена в Notion.',updatedAt:new Date().toISOString(),contentHash:createHash('sha256').update(JSON.stringify({properties:page.properties,content:updatedPage.content})).digest('hex')});
  }catch(error){entry.status='update_error';entry.message=error.message+' Ссылка сохранена. Можно повторить обновление той же страницы.';}
  finally{try{await this.save();}catch{entry.message+=' Не удалось сохранить статус на компьютере.';}this.busy=false;}
 }
 async run(student,page,entry){
  let attempted=false;
  try{
   await this.client.connect();entry.message='Создаём страницу в Notion…';
   const container=await this.ensureContainer();
   attempted=true;
   let hub;
   if(entry.hubPageId&&notionPageUrl(entry.hubUrl))hub={pageId:entry.hubPageId,url:entry.hubUrl};
   else{
    hub=createdPage(await this.client.createPage(studentHubPage(student),{page_id:container.pageId}));
    Object.assign(entry,{hubPageId:hub.pageId,hubUrl:hub.url,hubTitle:student.name||student.telegram||'Ученик'});await this.save();
   }
   const created=createdPage(await this.client.createPage(page,{page_id:hub.pageId}));
   Object.assign(entry,created,{status:'done',message:'Страница создана в Notion.'});
   try{await this.client.insertPageContent(hub.pageId,studentHubFooter,'end');}catch{entry.message='Резюме создано. Раздел «Личные странички ученика» не удалось добавить автоматически.';}
  }catch(error){entry.status=attempted&&!error.creationRejected?'uncertain':'error';entry.message=entry.status==='uncertain'?'Не удалось подтвердить создание. Проверьте Notion: повторный запрос отключён, чтобы не создать дубль.':error.message;}
  finally{this.busy=false;try{await this.save();}catch{entry.message+=' Не удалось сохранить статус на компьютере.';}}
 }
}
