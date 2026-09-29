import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {NotionExports,notionPage,notionDate,createdPage} from './notion-export.mjs';
import {NotionClient} from './notion-client.mjs';

const student={id:'s1',jobs:[],name:'Тест',urgent:true,resumeReady:false,resume:'Исходный PDF не экспортируется',result:{resume_text:'Тест\nМосква\nОпыт работы\nПрограммист 1С\n- Отчёт <page url="https://example.com">',summary:'Черновик',checks:[],questions:[],changes:['Предложенная метрика: 10 минут']},legend:{legend_text:'Текущая легенда',summary:'Рассказ',checks:[],questions:[],changes:[]}};
const reply={pages:[{id:'123',url:'https://www.notion.so/123'}]};
async function settled(service){for(let i=0;service.busy&&i<200;i++)await new Promise(r=>setTimeout(r,5));assert.equal(service.busy,false);await service.saveQueue;}
async function fixture(t,client){const dir=await mkdtemp(path.join(tmpdir(),'rezumator-notion-'));t.after(()=>rm(dir,{recursive:true,force:true}));const service=new NotionExports({file:path.join(dir,'exports.json'),client});await service.init();service.container={title:'Резюме учеников',pageId:'folder-1',url:'https://www.notion.so/folder-1',status:'done'};return service;}

test('Новые страницы создаются внутри одной папки резюме',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'rezumator-notion-folder-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const calls=[];const client={connect:async()=>{},createPage:async(page,parent)=>{calls.push({page,parent});return calls.length===1?{pages:[{id:'folder-1',url:'https://www.notion.so/folder-1'}]}:calls.length===2?{pages:[{id:'student-1',url:'https://www.notion.so/student-1'}]}:reply;},insertPageContent:async()=>{}};
 const service=new NotionExports({file:path.join(dir,'exports.json'),client});await service.init();await service.start(student);await settled(service);
 assert.equal(calls.length,3);assert.equal(calls[0].page.properties.title,'Резюме учеников');assert.deepEqual(calls[1].parent,{page_id:'folder-1'});assert.deepEqual(calls[2].parent,{page_id:'student-1'});assert.equal(service.container.pageId,'folder-1');assert.equal(service.entries.s1.hubPageId,'student-1');
 const restored=new NotionExports({file:service.file,client});await restored.init();assert.equal(restored.container.pageId,'folder-1');
});

test('Notion получает только текст редактора и легенду, сохраняя проверки локально',()=>{
 const before=structuredClone(student);const page=notionPage(student);
 assert.match(page.properties.title,/^Резюме \d{2}\.\d{2}$/);assert.ok(page.content.startsWith('# Резюме {color="green_bg"}'));
 assert.ok(page.content.includes('Текущая легенда'));
 assert.ok(!page.content.includes('Предложенная метрика: 10 минут'));
 assert.ok(!page.content.includes('Проверка и предложенные изменения'));
 assert.ok(!page.content.includes('<details>'));
 const reviewed=structuredClone(student);
 for(const result of [reviewed.result,reviewed.legend]){result.summary='Служебное резюме проверки';result.checks=[{label:'Служебный пункт',status:'clarify',detail:'Внутреннее замечание',evidence:'Источник замечания'}];result.questions=['Внутренний вопрос'];result.changes=['Внутренняя адаптация'];}
 const clean=notionPage(reviewed).content;
 for(const marker of ['Служебное резюме проверки','Служебный пункт','Внутреннее замечание','Источник замечания','Внутренний вопрос','Внутренняя адаптация'])assert.ok(!clean.includes(marker));
 assert.equal(reviewed.result.checks.length,1);assert.equal(reviewed.legend.changes.length,1);
 assert.ok(!page.content.includes('Исходный PDF'));
 assert.ok(!/(?<!\\)<page url=/.test(page.content));
 assert.ok(page.content.includes('\\<page'));
 assert.deepEqual(student,before);
 assert.throws(()=>notionPage({...student,result:null}));
 assert.throws(()=>createdPage({pages:[{url:'javascript:alert(1)'}]}));
});
test('Повторный клик и перезапуск возвращают ту же страницу, не меняя готовность',async t=>{
 let count=0,finish;
 const client={connect:async()=>{},createPage:async(page,parent)=>{count++;if(parent?.page_id==='folder-1')return {pages:[{id:'student-1',url:'https://www.notion.so/student-1'}]};return new Promise(r=>{finish=r;});},insertPageContent:async()=>{}};
 const service=await fixture(t,client);
 const first=await service.start(student);assert.equal((await service.start(student)),first);
 for(let i=0;!finish&&i<20;i++)await new Promise(r=>setTimeout(r,5));finish(reply);await settled(service);
 assert.equal(count,2);assert.equal(first.url,reply.pages[0].url);assert.equal(first.hubPageId,'student-1');
 const restored=new NotionExports({file:service.file,client});await restored.init();
 assert.equal((await restored.start(student)).url,first.url);assert.equal(count,2);
 assert.equal(student.resumeReady,false);assert.equal(student.urgent,true);
});
test('Ошибка подключения допускает повтор, неопределённый результат записи блокирует дубли',async t=>{
 let available=false,count=0;
 const client={connect:async()=>{if(!available)throw new Error('Нет входа');},createPage:async()=>{count++;throw new Error('Разрыв после отправки');}};
 const service=await fixture(t,client);
 await service.start(student);await settled(service);assert.equal(service.entries.s1.status,'error');assert.equal(count,0);
 available=true;await service.start(student);await settled(service);assert.equal(service.entries.s1.status,'uncertain');
 await service.start(student);assert.equal(count,1);
});
test('Незавершённый экспорт после перезапуска не отправляется повторно',async t=>{
 const service=await fixture(t,{});service.entries.s1={studentId:'s1',status:'creating'};await service.save();
 const restored=new NotionExports({file:service.file,client:{createPage:()=>assert.fail('Не создавать дубль')}});await restored.init();
 assert.equal((await restored.start(student)).status,'uncertain');
});

test('Обновление использует прежний ID, сохраняет копию, новый текст и легенду',async t=>{
 const {readdir,readFile}=await import('node:fs/promises');let updates=0,finish;const fetched={metadata:{type:'page'},text:'Предыдущая страница с ручными правками'};
 const client={connect:async()=>{},fetchPage:async id=>{assert.equal(id,'123');return fetched;},updatePage:async(id,page)=>{assert.equal(id,'123');assert.ok(page.content.includes('Исправленное резюме'));assert.ok(page.content.includes('Исправленная легенда'));updates++;return new Promise(r=>finish=r);},createPage:()=>assert.fail('Не создавать дубль')};
 const service=await fixture(t,client);service.entries.s1={studentId:'s1',...createdPage(reply),status:'done',contentHash:'old'};
 const changed=structuredClone(student);changed.result.resume_text='Исправленное резюме';changed.legend.legend_text='Исправленная легенда';
 const entry=await service.update(changed);assert.equal(entry.status,'updating');assert.equal(await service.update(changed),entry);
 for(let i=0;!finish&&i<100;i++)await new Promise(r=>setTimeout(r,5));assert.ok(finish);finish();await settled(service);
 assert.equal(updates,1);assert.equal(entry.status,'done');assert.equal(entry.title,notionPage(changed).properties.title);assert.equal(entry.url,reply.pages[0].url);assert.notEqual(entry.contentHash,'old');assert.ok(entry.updatedAt);
 const backups=path.join(path.dirname(service.file),'notion-backups');const files=await readdir(backups);assert.equal(files.length,1);assert.deepEqual(JSON.parse(await readFile(path.join(backups,files[0]),'utf8')),fetched);
 assert.equal(changed.resumeReady,false);assert.equal(changed.urgent,true);
 const restored=new NotionExports({file:service.file,client});await restored.init();assert.equal(restored.entries.s1.url,entry.url);assert.equal(restored.entries.s1.contentHash,entry.contentHash);
});
test('При обновлении Notion меняется и заголовок с текущей датой',async()=>{
 const calls=[];const client=new NotionClient({});
 client.connect=async()=>{};
 client.rawCall=async(tool,args)=>{calls.push({tool,args});return {structuredContent:{}};};
 client.fetchPage=async()=>({metadata:{type:'page'},text:'Обновлённое резюме'});
 const page=notionPage(student);
 await client.updatePage('123',page);
 assert.deepEqual(calls.map(c=>c.args.command),['replace_content','update_properties']);
 assert.deepEqual(calls[1].args.properties,{title:page.properties.title});
 assert.equal(calls[1].args.page_id,'123');
 assert.equal(notionDate(new Date('2026-09-29T21:30:00Z')),'30.09');
});
test('Ошибка обновления сохраняет ссылку и хеш, повтор обновляет ту же страницу',async t=>{
 let updates=0,fail=true;const client={connect:async()=>{},fetchPage:async()=>({metadata:{type:'page'},text:'Старая версия'}),updatePage:async()=>{updates++;if(fail)throw Error('Нет связи');},createPage:()=>assert.fail('Не создавать дубль')};
 const service=await fixture(t,client);service.entries.s1={studentId:'s1',...createdPage(reply),status:'done',contentHash:'old'};
 await service.update(student);await settled(service);assert.equal(service.entries.s1.status,'update_error');assert.equal(service.entries.s1.contentHash,'old');assert.equal(service.entries.s1.pageId,'123');
 await service.start(student);assert.equal(updates,1);
 fail=false;await service.update(student);await settled(service);assert.equal(updates,2);assert.equal(service.entries.s1.status,'done');assert.equal(service.entries.s1.url,reply.pages[0].url);
});
test('Нельзя обновить непрочитанную страницу; после перезапуска сохранён адрес',async t=>{
 const service=await fixture(t,{connect:async()=>{},fetchPage:async()=>{throw Error('Нет доступа');},updatePage:()=>assert.fail('Не менять непрочитанную страницу')});
 await assert.rejects(service.update(student),/Сначала создайте/);
 service.entries.s1={studentId:'s1',...createdPage(reply),status:'updating',contentHash:'old'};await service.save();
 const restored=new NotionExports({file:service.file,client:service.client});await restored.init();assert.equal(restored.entries.s1.status,'update_error');
 await restored.update(student);await settled(restored);assert.equal(restored.entries.s1.status,'update_error');assert.equal(restored.entries.s1.pageId,'123');assert.equal(restored.entries.s1.contentHash,'old');
});
