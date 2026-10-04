import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createLegendMap,mapHash,mapSource,publishScene,verifyScene,safeMapUrl,mapSvg} from './legend-map.mjs';

const heading='## Карта легенды в Excalidraw {color="green_bg"}';
export function notionContent(page){
 if(page.metadata?.type!=='page'||typeof page.text!=='string'||page.truncated||page.unknown_block_count>0)throw Error('Не удалось полностью прочитать страницу Notion. Карта не изменена.');
 return page.text.match(/<content>\n?([\s\S]*?)\n?<\/content>/)?.[1]??page.text;
}
export function notionLegend(content){
 const start=content.search(/^#{1,6}[ \t]+[^\n]*легенд(?:а|ы)(?=[ \t{:]|$)[^\n]*$/im);
 if(start<0)throw Error('На странице Notion нет легенды. Сначала добавьте её через «Обновить страницу в NOTION».');
 const body=content.slice(start).replace(/^[^\n]*\n?/,'');
 return body.split(/^## Карта легенды в Excalidraw[^\n]*$/m)[0].trim();
}
export function mapNotionBlock(url){if(!safeMapUrl(url))throw Error('Некорректная ссылка Excalidraw.');return `${heading}\n\n[Открыть карту легенды ↗](${url})\n\nКарта этой легенды: рассказ о себе, места работы, архитектура проектов, выбор инструментов, кейсы, факапы в тесте и вопросы. Открывается в браузере. При изменении легенды обновите карту в резюматоре.`;}
export function oldMapBlock(content){return content.match(/^## Карта легенды в Excalidraw[^\n]*\n[\s\S]*?(?=\n#{1,6} |(?![\s\S]))/m)?.[0]?.trimEnd()||null;}
export class LegendMaps {
 constructor({file,fetchImpl=fetch}){Object.assign(this,{file,fetchImpl});this.entries={};this.saveQueue=Promise.resolve();this.busy=false;}
 async init(){try{this.entries=JSON.parse(await readFile(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}for(const e of Object.values(this.entries))if(e.status==='running'){e.status='error';e.message='Создание карты прервано. Можно повторить проверку.';}}
 save(){const data=JSON.stringify(this.entries,null,2);this.saveQueue=this.saveQueue.catch(()=>{}).then(async()=>{await writeFile(this.file+'.tmp',data,{mode:0o600});await rename(this.file+'.tmp',this.file);});return this.saveQueue;}
 key(student,notion){return `${notion.workspace.id}/${student.id}`;}
 status(notion){return {entries:Object.fromEntries(Object.entries(this.entries).filter(([key])=>key.startsWith(notion.workspace.id+'/')).map(([,entry])=>[entry.studentId,entry]))};}
 async start(student,notion){
  if(this.busy||notion.busy)throw Error('Дождитесь завершения текущей карты или экспорта в Notion.');
  const page=notion.entries[student.id];if(!page?.pageId)throw Error('Сначала создайте страницу этого ученика в Notion.');
  this.busy=true;notion.busy=true;const key=this.key(student,notion),previous=this.entries[key];
  const entry={...(previous?.pageId===page.pageId?previous:{}),studentId:student.id,pageId:page.pageId,status:'running',message:'Читаем актуальную легенду в Notion…'};this.entries[key]=entry;
  try{await this.save();}catch(e){if(previous)this.entries[key]=previous;else delete this.entries[key];this.busy=false;notion.busy=false;throw e;}
  void this.run(student,page,entry,notion);return entry;
 }
 async run(student,page,entry,notion){
  try{
   const previous=await notion.client.fetchPage(page.pageId),content=notionContent(previous),source=notionLegend(content),name=student.name||student.telegram||'Ученик';
   if(mapSource(source).length>120000)throw Error('Легенда слишком большая для карты.');
   const sourceHash=mapHash(name,source),scene=createLegendMap({name,source,notionUrl:page.url});
   const folder=path.join(path.dirname(this.file),'legend-maps',sourceHash);await mkdir(folder,{recursive:true});
   await writeFile(path.join(folder,'map.excalidraw'),JSON.stringify(scene,null,2),{mode:0o600});
   await writeFile(path.join(folder,'source.txt'),source,{mode:0o600});
   await writeFile(path.join(folder,'preview.svg'),mapSvg(scene),{mode:0o600});
   if(entry.sourceHash===sourceHash&&safeMapUrl(entry.url)){
    entry.message='Проверяем сохранённую карту…';await this.save();await verifyScene(entry.url,scene,{fetchImpl:this.fetchImpl});
   }else{
    Object.assign(entry,{sourceHash,url:null,message:'Собираем и публикуем карту в Excalidraw…'});await this.save();
    await publishScene(scene,{fetchImpl:this.fetchImpl,onPublished:async url=>{entry.url=url;entry.message='Проверяем сохранение карты…';await this.save();}});
   }
   // Re-read before writing: the author may have edited the legend during publication.
   const latest=await notion.client.fetchPage(page.pageId),latestContent=notionContent(latest);
   if(mapHash(name,notionLegend(latestContent))!==sourceHash)throw Error('Легенда в Notion изменилась во время создания карты. Нажмите «Обновить карту», чтобы учесть правки.');
   const old=oldMapBlock(latestContent),block=mapNotionBlock(entry.url);
   if(!old?.includes(']('+entry.url+')')){
    const backups=path.join(path.dirname(this.file),'notion-backups');await mkdir(backups,{recursive:true});
    await writeFile(path.join(backups,createHash('sha256').update(page.pageId).digest('hex').slice(0,16)+'-map-'+Date.now()+'.json'),JSON.stringify(latest,null,2),{mode:0o600,flag:'wx'});
    entry.message='Добавляем ссылку на карту в Notion…';await this.save();
    if(old)await notion.client.rawCallChecked('notion.notion-update-page',{page_id:page.pageId,command:'update_content',content_updates:[{old_str:old,new_str:block,replace_all_matches:false}],allow_async:false});
    else await notion.client.insertPageContent(page.pageId,block,'end');
   }
   const saved=notionContent(await notion.client.fetchPage(page.pageId));
   if(!saved.includes(entry.url))throw Error('Карта готова, но ссылку в Notion пока не удалось подтвердить. Повторная проверка использует ту же карту.');
   Object.assign(entry,{status:'done',updatedAt:new Date().toISOString(),message:'Карта готова. Ссылка добавлена в Notion.'});
  }catch(error){entry.status='error';entry.message=error.message;}
  finally{try{await this.save();}catch{entry.message+=' Не удалось сохранить статус на компьютере.';}this.busy=false;notion.busy=false;}
 }
}
