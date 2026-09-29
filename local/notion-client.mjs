import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

// Use the existing Codex connector session. No model turn or API key is needed.
export class NotionClient {
 constructor({codex,env,cwd,workspaceId}){Object.assign(this,{codex,env,cwd,workspaceId});this.pending=new Map();this.sequence=0;}
 async connect(){
  if(this.connection)return this.connection;
  this.connection=this.initialize().catch(error=>{this.close();throw error;});
  return this.connection;
 }
 async startTransport(){
  const child=spawn(this.codex,['app-server',...(this.env?.REZUMATOR_DESKTOP==='1'?['-c','features.apps=true','-c','features.plugins=true']:[])],{cwd:this.cwd,env:this.env,stdio:['pipe','pipe','pipe']});this.child=child;
  const fail=error=>{if(this.child!==child)return;this.threadId=null;this.connection=null;for(const p of this.pending.values()){clearTimeout(p.timer);const reason=new Error(error?.code==='ENOENT'?'Не найден исполняемый файл Codex. Проверьте установку приложения Codex.':'Связь с подключением Codex прервалась.');reason.code=error?.code==='ENOENT'?'CODEX_UNAVAILABLE':'CODEX_DISCONNECTED';p.reject(reason);}this.pending.clear();};
  child.on('error',fail);child.on('close',fail);child.stdin.on('error',fail);child.stderr.on('data',()=>{});
  createInterface({input:child.stdout}).on('line',line=>{
   let m;try{m=JSON.parse(line);}catch{return;}
   if(m.id!==undefined&&m.method){
    // Do not silently approve an interactive permission or account change.
    this.send({id:m.id,error:{code:-32601,message:'Откройте Codex, чтобы завершить запрос доступа.'}});return;
   }
   const p=this.pending.get(m.id);if(!p)return;
   this.pending.delete(m.id);clearTimeout(p.timer);
   if(m.error){const error=new Error('Подключение Codex не выполнило запрос. Проверьте вход и разрешения в Codex.');error.rpcMethod=p.method;error.rpcCode=m.error.code;error.rpcDetail=m.error.message;p.reject(error);}else p.resolve(m.result);
  });
  await this.rpc('initialize',{clientInfo:{name:'rezumator_notion',title:'1с-резюматор',version:'0.1.0'},capabilities:{experimentalApi:true}});
  this.send({method:'initialized',params:{}});
 }
 async openConnection(runtimeName,requiredTools){
  await this.startTransport();
  const apps=await this.rpc('app/installed',{forceRefresh:true});
  if(!apps.apps?.some(a=>a.runtimeName===runtimeName&&a.enabled&&a.callable))throw new Error(`Подключите ${runtimeName} в Codex и повторите загрузку.`);
  const {thread}=await this.rpc('thread/start',{ephemeral:true,cwd:this.cwd,sandbox:'read-only',config:{project_doc_max_bytes:0}});
  this.threadId=thread.id;
  const inventory=await this.rpc('mcpServerStatus/list',{threadId:this.threadId,detail:'toolsAndAuthOnly',limit:100});
  const server=inventory.data?.find(s=>s.name==='codex_apps');
  if(!requiredTools.every(tool=>server?.tools?.[tool]))throw new Error(`Инструменты ${runtimeName} недоступны в Codex.`);
  return server.tools;
 }
 async initialize(){
  await this.openConnection('Notion',['notion.fetch','notion.notion-create-pages','notion.notion-update-page']);
  const self=unwrapNotion(await this.rawCall('notion.fetch',{id:'self'}));
  if(self.self?.workspace?.id!==this.workspaceId)throw new Error('В Codex подключено другое пространство Notion. Проверьте выбранное пространство в «Подключениях».');
  await this.rawCall('notion.fetch',{id:'notion://docs/enhanced-markdown-spec'});
 }
 send(message){this.child?.stdin.write(JSON.stringify(message)+'\n');}
 rpc(method,params,timeout=60000){return new Promise((resolve,reject)=>{
  const id=++this.sequence;
  const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Подключение Codex не ответило вовремя.'));},timeout);
  this.pending.set(id,{resolve,reject,timer,method});this.send({method,id,params});
 });}
 rawCall(tool,args){return this.rpc('mcpServer/tool/call',{threadId:this.threadId,server:'codex_apps',tool,arguments:args},90000);}
 async createPage(page,parent){
  await this.connect();
  const args={pages:[page]};if(parent)args.parent=parent;
  return unwrapNotion(await this.rawCall('notion.notion-create-pages',args));
 }
 async insertPageContent(pageId,content,position='end'){
  await this.connect();
  return unwrapNotion(await this.rawCall('notion.notion-update-page',{page_id:pageId,command:'insert_content',content,position:{type:position},allow_async:false}));
 }
 async fetchPage(pageId){await this.connect();return unwrapNotion(await this.rawCall('notion.fetch',{id:pageId}));}
 async updatePage(pageId,page){
  await this.connect();
  // The caller snapshots the fetched page first. Never allow deletion of child pages.
  let result=unwrapNotion(await this.rawCall('notion.notion-update-page',{page_id:pageId,command:'replace_content',new_str:page.content,allow_async:false}));
  if(result.async_task){
   const taskId=result.async_task.task_id||result.async_task.id;
   if(!taskId)throw new Error('Notion принял обновление, но не вернул номер задания. Проверьте страницу.');
   const deadline=Date.now()+180000;
   while(Date.now()<deadline){
    await new Promise(resolve=>setTimeout(resolve,2000));
    result=unwrapNotion(await this.rawCall('notion.notion-get-async-task',{task_id:taskId}));
    const task=result.async_task||result;
    if(task.status==='succeeded')break;
    if(task.status==='failed')throw new Error('Notion не завершил обновление страницы.');
   }
   if((result.async_task||result).status!=='succeeded')throw new Error('Обновление ещё не подтверждено. Проверьте страницу Notion перед повтором.');
  }
  unwrapNotion(await this.rawCall('notion.notion-update-page',{page_id:pageId,command:'update_properties',properties:{title:page.properties.title},allow_async:false}));
  const saved=await this.fetchPage(pageId);
  if(saved.metadata?.type!=='page'||typeof saved.text!=='string')throw new Error('Не удалось проверить обновлённую страницу Notion.');
  return saved;
 }
 close(){
  for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Подключение Codex закрыто.'));}this.pending.clear();
  this.child?.kill('SIGTERM');this.child=null;this.threadId=null;this.connection=null;
 }
}

export function unwrapNotion(result){
 if(result?.isError)throw new Error('Notion отклонил запрос. Проверьте доступ к пространству в Codex.');
 if(result?.structuredContent)return result.structuredContent;
 for(const c of result?.content||[])if(c.type==='text'){try{return JSON.parse(c.text);}catch{}}
 throw new Error('Не удалось прочитать ответ Notion.');
}
