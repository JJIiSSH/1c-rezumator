import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {NotionExports,notionPage,notionDate,createdPage,protectNotionLegend} from './notion-export.mjs';
import {NotionClient,unwrapNotion} from './notion-client.mjs';

const student={id:'s1',jobs:[],name:'Тест',urgent:true,resumeReady:false,resume:'Исходный PDF не экспортируется',result:{resume_text:'Тест\nМосква\nОпыт работы\nПрограммист 1С\n- Отчёт <page url="https://example.com">',summary:'Черновик',checks:[],questions:[],changes:['Предложенная метрика: 10 минут']},legend:{legend_text:'Текущая легенда',summary:'Рассказ',checks:[],questions:[],changes:[]}};
const reply={pages:[{id:'123',url:'https://www.notion.so/123'}]};
async function settled(service){for(let i=0;service.busy&&i<200;i++)await new Promise(r=>setTimeout(r,5));assert.equal(service.busy,false);await service.saveQueue;}
async function fixture(t,client){const dir=await mkdtemp(path.join(tmpdir(),'rezumator-notion-'));t.after(()=>rm(dir,{recursive:true,force:true}));const service=new NotionExports({file:path.join(dir,'exports.json'),client});await service.init();service.container={title:'Резюме учеников',pageId:'folder-1',url:'https://www.notion.so/folder-1',status:'done'};return service;}

test('Новые страницы создаются внутри одной папки резюме',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'rezumator-notion-folder-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const calls=[];const client={connect:async()=>{},createPage:async(page,parent)=>{calls.push({page,parent});return calls.length===1?{pages:[{id:'folder-1',url:'https://www.notion.so/folder-1'}]}:calls.length===2?{pages:[{id:'student-1',url:'https://www.notion.so/student-1'}]}:reply;},insertPageContent:async()=>{}};
 const service=new NotionExports({file:path.join(dir,'exports.json'),client});await service.init();await service.start(student);await settled(service);
 assert.equal(calls.length,3);assert.equal(calls[0].page.properties.title,'Резюме учеников');assert.deepEqual(calls[1].parent,{page_id:'folder-1'});assert.deepEqual(calls[2].parent,{page_id:'student-1'});assert.equal(service.container.pageId,'folder-1');assert.equal(service.entries.s1.hubPageId,'student-1');
 assert.equal(calls[1].page.icon,'💻');
 const restored=new NotionExports({file:service.file,client});await restored.init();assert.equal(restored.container.pageId,'folder-1');
});

test('Явный отказ Notion в параметрах отличается от ошибки с неизвестным результатом',()=>{
 for(const result of [
  {isError:true,structuredContent:{error_code:'INVALID_ARGUMENT'}},
  {isError:true,content:[{type:'text',text:JSON.stringify({code:'validation_error',status:400})}]},
  {isError:true,content:[{type:'text',text:JSON.stringify({additional_data:{tool_error_class:'validation',tool_error_code:'invalid_input'}})}]}
 ])assert.throws(()=>unwrapNotion(result),e=>e.creationRejected===true);
 for(const result of [{isError:true},{isError:true,content:[{type:'text',text:JSON.stringify({code:'internal_server_error',status:500})}]}])assert.throws(()=>unwrapNotion(result),e=>e.creationRejected===false);
});

test('После отказа дочерней страницы повтор использует сохранённую страницу ученика',async t=>{
 let calls=0,reject=true;const parents=[];
 const client={connect:async()=>{},createPage:async(page,parent)=>{
  calls++;parents.push(parent.page_id);
  if(parent.page_id==='folder-1')return {pages:[{id:'hub-1',url:'https://www.notion.so/hub-1'}]};
  if(reject)unwrapNotion({isError:true,structuredContent:{error_code:'INVALID_ARGUMENT'}});
  return reply;
 },insertPageContent:async()=>{}};
 const service=await fixture(t,client);await service.start(student);await settled(service);
 assert.equal(service.entries.s1.status,'error');assert.equal(service.entries.s1.hubPageId,'hub-1');assert.match(service.entries.s1.message,/параметры/);
 const restored=new NotionExports({file:service.file,client});await restored.init();reject=false;
 await restored.start(student);await settled(restored);
 assert.equal(restored.entries.s1.status,'done');assert.equal(calls,3);assert.deepEqual(parents,['folder-1','hub-1','hub-1']);
});

test('Отказ параметров папки разрешает исправленный повтор без блокировки',async t=>{
 const service=await fixture(t,{connect:async()=>{},createPage:async()=>unwrapNotion({isError:true,structuredContent:{error_code:'INVALID_ARGUMENT'}})});service.container=null;
 await service.start(student);await settled(service);assert.equal(service.container.status,'error');assert.equal(service.entries.s1.status,'error');
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

test('Авторская легенда с таблицами и callout сохраняется целиком; меняется только резюме',async t=>{
 const manual='## Легенда {color="green_bg"}\n<callout icon="🧭">\n\tМой авторский рассказ\n</callout>\n<columns>Ручные колонки</columns>';
 const previous={metadata:{type:'page'},text:'<page>\n<content>\n# Резюме {color="green_bg"}\nСтарое резюме\n'+manual+'\n</content>\n</page>'};
 const page=protectNotionLegend(notionPage(student),previous);assert.ok(page.legendPreserved);assert.ok(page.content.endsWith(manual));assert.ok(!page.content.includes(student.legend.legend_text));
 assert.equal(page.contentUpdates.length,1);assert.ok(!page.contentUpdates[0].old_str.includes('Мой авторский рассказ'));assert.ok(!page.contentUpdates[0].new_str.includes('Текущая легенда'));
 let written;const service=await fixture(t,{connect:async()=>{},fetchPage:async()=>previous,updatePage:async(id,p)=>{written=p;}});service.entries.s1={studentId:'s1',...createdPage(reply),status:'done'};
 await service.update(student);await settled(service);assert.equal(written.content,page.content);assert.match(service.entries.s1.message,/Легенда.*сохранена/);
 await service.update(student,{replaceLegend:true});await settled(service);assert.ok(written.content.includes(student.legend.legend_text));assert.ok(!written.contentUpdates);
 await assert.rejects(service.update({...student,legend:null},{replaceLegend:true}),/Сначала создайте легенду/);
});
test('При сохранении авторской легенды клиент использует точечную замену',async()=>{
 const client=new NotionClient({}),calls=[];client.connect=async()=>{};client.rawCall=async(tool,args)=>{calls.push(args);return {structuredContent:{}};};client.fetchPage=async()=>({metadata:{type:'page'},text:'Проверено'});
 const page=protectNotionLegend(notionPage(student),{text:'# Резюме\nСтарое\n## Авторская легенда\nРучной текст'});
 await client.updatePage('123',page);assert.equal(calls[0].command,'update_content');assert.deepEqual(calls[0].content_updates,page.contentUpdates);assert.ok(!calls[0].new_str);assert.equal(calls[1].command,'update_properties');
});
test('Обрезанная страница не перезаписывается',async t=>{
 const service=await fixture(t,{connect:async()=>{},fetchPage:async()=>({metadata:{type:'page'},text:'Обрезанный текст',truncated:true}),updatePage:()=>assert.fail('Не перезаписывать')});service.entries.s1={studentId:'s1',...createdPage(reply),status:'done'};
 await service.update(student);await settled(service);assert.equal(service.entries.s1.status,'update_error');
});


test('Автоматическая отправка меняет только легенду существующей страницы и сохраняет ручное резюме',async t=>{
 const {replaceNotionLegendOnly}=await import('./notion-export.mjs');
 const previous={metadata:{type:'page'},text:'# Резюме\nРучной текст в Notion\n\n# Легенда для собеседования\nАвторская старая легенда\n\n## Карта легенды в Excalidraw\n[Старая карта](https://excalidraw.com/)'};
 const page=notionPage(student),updated=replaceNotionLegendOnly(page,previous);
 assert.ok(updated.content.startsWith('# Резюме\nРучной текст в Notion'));assert.ok(updated.content.includes('Текущая легенда'));assert.ok(updated.content.includes('## Карта легенды в Excalidraw'));
 assert.equal(updated.contentUpdates[0].old_str,'# Легенда для собеседования\nАвторская старая легенда');assert.ok(!updated.contentUpdates[0].new_str.includes(student.result.resume_text));
 let writes=0;
 const client={connect:async()=>{},fetchPage:async()=>previous,updatePage:async(id,data)=>{assert.equal(id,'123');assert.deepEqual(data.contentUpdates,updated.contentUpdates);writes++;},createPage:()=>assert.fail('Не создавать новую страницу')};
 const service=await fixture(t,client);service.entries.s1={studentId:'s1',...createdPage(reply),status:'done'};
 await service.syncLegend(student);await settled(service);
 assert.equal(writes,1);assert.equal(service.entries.s1.status,'done');assert.equal(service.entries.s1.url,reply.pages[0].url);assert.match(service.entries.s1.message,/Легенда обновлена/);
});

test('Легенда добавляется на страницу без раздела легенды, не заменяя резюме',async()=>{
 const {replaceNotionLegendOnly}=await import('./notion-export.mjs');
 const old='# Резюме\nРучные правки и контакты',updated=replaceNotionLegendOnly(notionPage(student),{text:old});
 assert.ok(updated.content.startsWith(old+'\n\n# Легенда'));assert.equal(updated.contentUpdates[0].old_str,old);
});

test('Автоматическая отправка создаёт недостающую страницу, а неопределённый исход не создаёт дубль',async t=>{
 let creations=0;
 const client={connect:async()=>{},createPage:async(page,parent)=>{creations++;return parent.page_id==='folder-1'?{pages:[{id:'hub-new',url:'https://www.notion.so/hub-new'}]}:reply;},insertPageContent:async()=>{}};
 const service=await fixture(t,client);await service.syncLegend(student);await settled(service);assert.equal(creations,2);
 const uncertain=await fixture(t,{createPage:()=>assert.fail('Нельзя повторять создание')});uncertain.entries.s1={studentId:'s1',status:'uncertain',message:'Не удалось подтвердить создание'};
 await assert.rejects(uncertain.syncLegend(student),/подтвердить/);assert.equal(uncertain.entries.s1.status,'uncertain');
 await assert.rejects(uncertain.syncLegend({...student,legend:null}),/создайте легенду/);
});
