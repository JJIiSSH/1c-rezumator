import {LegendMaps} from './legend-map-export.mjs';
import {ConnectionWizard,NotionWorkspaceProbe,providerFor} from './connection-wizard.mjs';
import {AccountClient} from './account-client.mjs';
import {ClaudeAccountClient} from './claude-client.mjs';
import {parseConnections} from './desktop-settings.mjs';
import {GENERATION_PROVIDERS,ModelClient,ModelSettings,validateProvider} from './model-settings.mjs';
import {DriveClient} from './drive-client.mjs';
import {mergeDriveRows,sheetUrl} from './drive-import.mjs';
import {applyStudentChanges} from './state-sync.mjs';
import {NotionClient} from './notion-client.mjs';
import {codexExecutable} from './runtime-paths.mjs';
import {NotionExports,notionWorkspace} from './notion-export.mjs';
import http from 'node:http';
import {readFile,writeFile,mkdir,rename,mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {buildPrompt,validateStudent,normalizeResumeText,buildLegendPrompt} from './engine.mjs';
import {runModel} from './model-runner.mjs';
import {produceMaterial} from './material-workflow.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
let port=Number(process.env.REZUMATOR_PORT||4317);
let origin=`http://127.0.0.1:${port}`;
const desktop=process.env.REZUMATOR_DESKTOP==='1';
const csrf=randomBytes(32).toString('hex');
const dataDir=process.env.REZUMATOR_DATA_DIR||path.join(root,'.data');await mkdir(dataDir,{recursive:true});
const runDir=path.join(dataDir,'runs');await mkdir(runDir,{recursive:true});
const readRules=()=>readFile(path.join(root,'prompts/rules.md'),'utf8');
const readLegendRules=()=>readFile(path.join(root,'prompts/legend.md'),'utf8');
const schemaFiles={resume:'schema.json',legend:'legend-schema.json','legend-plan':'legend-plan-schema.json'};
const outputSchemas=Object.fromEntries(await Promise.all(Object.entries(schemaFiles).map(async([kind,file])=>[kind,JSON.parse(await readFile(path.join(root,file),'utf8'))])));
const rulesVersion=rules=>createHash('sha256').update(rules).digest('hex').slice(0,12);
const defaults={name:'',telegram:'',age:'',github:'',location:'РФ',urgent:false,resumeReady:false,legendReady:false,sourceUrl:'',project:'',configurations:'',tasks:'',complex:'',resume:'',pdfName:'',title:'Программист 1С',track:'Универсальный профиль',targetExperienceYears:'',notes:'',showAge:false,showGithub:true,fillMetrics:true,metrics:[],jobs:[],result:null,resultSignature:'',legend:null,legendSignature:'',legendNotes:''};
let state;
try{state=JSON.parse(await readFile(path.join(dataDir,'students.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;state=(JSON.parse(await readFile(path.join(root,'seed.json'),'utf8'))).map(s=>({...defaults,...s}));}
// Legacy records must expose false too, so the first checkbox edit has the same CAS baseline in both browsers.
state=state.map(s=>({...s,legendReady:s.legendReady===undefined?false:s.legendReady}));
const codex=codexExecutable();
const claude=process.env.REZUMATOR_CLAUDE||'claude';
const python=process.env.REZUMATOR_PYTHON||'python3';
const env={...process.env};for(const k of ['OPENAI_API_KEY','CODEX_API_KEY','OPENAI_BASE_URL','CODEX_THREAD_ID','CODEX_SESSION_ID','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN','ANTHROPIC_BASE_URL','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY'])delete env[k];
const accountClient=desktop?new AccountClient({codex,env,cwd:runDir}):null;
const claudeAccountClient=new ClaudeAccountClient({claude,env,cwd:runDir});
const connectionFile=path.join(dataDir,'connections.json');
let connectionSettings=desktop?{}:{sheetUrl,notionWorkspaceId:notionWorkspace.id,notionWorkspaceName:notionWorkspace.name};
if(desktop)try{connectionSettings=JSON.parse(await readFile(connectionFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
connectionSettings={...connectionSettings,...parseConnections(connectionSettings)};
const connectionWizard=desktop?new ConnectionWizard({codex,env,cwd:runDir}):null;
const notionProbe=desktop?new NotionWorkspaceProbe({codex,env,cwd:runDir}):null;
let connectionBusy=false;
const driveSource=()=>({id:connectionSettings.sheetId,gid:connectionSettings.sheetGid||0,url:connectionSettings.sheetUrl});
async function saveConnections(next){await writeFile(connectionFile+'.tmp',JSON.stringify(next,null,2),{mode:0o600});await rename(connectionFile+'.tmp',connectionFile);connectionSettings=next;}

const modelClient=new ModelClient({codex,env,cwd:runDir});
const modelSettings=new ModelSettings(path.join(dataDir,'generation-settings.json'),modelClient);await modelSettings.init();
const notionClient=new NotionClient({codex,env,cwd:runDir,workspaceId:connectionSettings.notionWorkspaceId});
let notionExports;
async function prepareNotionJournal(settings,migrate=false){
 const id=settings.notionWorkspaceId;
 const file=path.join(dataDir,desktop&&id?`notion-exports.${id}.json`:'notion-exports.json');
 const legacy=path.join(dataDir,'notion-exports.json');
 if(desktop&&migrate&&id&&!existsSync(file)&&existsSync(legacy))await writeFile(file,await readFile(legacy),{mode:0o600,flag:'wx'});
 const next=new NotionExports({file,client:notionClient,workspace:{id,name:settings.notionWorkspaceName||'Ваше пространство Notion'}});await next.init();
 if(desktop)await next.save();return next;
}
notionExports=await prepareNotionJournal(connectionSettings,true);
const legendMaps=new LegendMaps({file:path.join(dataDir,'legend-maps.json')});await legendMaps.init();
async function accountStatus(provider=modelSettings.snapshot().provider){
 validateProvider(provider);const status=provider==='anthropic'?claudeAccountClient.account():(desktop?accountClient.account():auth());
 return {...await status,provider,providerName:GENERATION_PROVIDERS[provider].name};
}
function auth(){const r=spawnSync(codex,['login','status'],{env,encoding:'utf8',timeout:7000});const t=(r.stdout||'')+(r.stderr||'');return {connected:r.status===0&&/Logged in using ChatGPT/i.test(t),message:r.status===0&&/Logged in using ChatGPT/i.test(t)?'Подписка ChatGPT':'Войдите в Codex через ChatGPT: codex login'};}
const driveClient=new DriveClient({codex,env,cwd:runDir});
let driveStatus={status:'idle',message:'',sourceUrl:connectionSettings.sheetUrl};
const jobs=new Map();let active=null;let saveQueue=Promise.resolve();
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req,limit=2_000_000){let bytes=0;const chunks=[];for await(const c of req){bytes+=c.length;if(bytes>limit)throw new Error('Слишком большой файл или анкета');chunks.push(c);}return Buffer.concat(chunks);}
function stop(job){if(job.child&&!job.child.killed){job.child.kill('SIGTERM');setTimeout(()=>{try{job.child.kill('SIGKILL');}catch{}},1500).unref();}job.status='cancelled';job.message='Генерация остановлена';}
function publicJob(j){return {id:j.id,studentId:j.studentId,kind:j.kind||'resume',provider:j.provider,providerName:j.providerName,model:j.model,reasoning_effort:j.reasoning_effort,status:j.status,message:j.message,result:j.result||null,createdAt:j.createdAt,stage:j.stage||null,errorCode:j.errorCode||null};}
function generate(s,rules,kind='resume',settings){
 const {provider,model,reasoning_effort}=settings,providerName=GENERATION_PROVIDERS[provider].name;
 const job={id:randomUUID(),studentId:s.id,kind,provider,providerName,model,reasoning_effort,status:'running',message:kind==='legend'?'Этап 1/2: собираем профиль и карточки кейсов…':`${providerName} готовит резюме…`,createdAt:Date.now()};jobs.set(job.id,job);active=job;
 for(const [id,j]of jobs)if(j.status!=='running'&&Date.now()-j.createdAt>3_600_000)jobs.delete(id);
 void (async()=>{
  try{
   const result=await produceMaterial({student:s,rules,kind,
    isCancelled:()=>job.status!=='running',
    onStage:(stage,message)=>{job.stage=stage;job.message=message;},
    run:(step,prompt)=>runModel({job,prompt,schemaPath:path.join(root,schemaFiles[step]),schema:outputSchemas[step],settings,desktop,codex,claude,cwd:runDir,env})
   });
   if(job.status!=='running')return;
   job.result={...result,rules_version:rulesVersion(rules),provider,model,reasoning_effort};job.status='done';job.message=kind==='legend'?'Легенда готова':'Резюме готово';
  }catch(e){if(job.status==='running'){job.status='error';job.message=e instanceof SyntaxError?`${providerName} вернул ответ в неожиданном формате. Повторите генерацию.`:e.message;job.errorCode=/^GENERATION_[A-Z_]+$/.test(e.code||'')?e.code:'GENERATION_FAILED';console.warn(JSON.stringify({event:'generation_failed',jobId:job.id,studentId:job.studentId,kind,stage:job.stage||null,provider,model,errorCode:job.errorCode,providerCode:e.providerCode||null}));}}
  finally{if(active===job)active=null;}
 })();return job;
}
async function importDrive(){
 try{
  const selectedSource=driveSource();
  const source=await driveClient.readStudents(structuredClone(state),message=>{driveStatus={...driveStatus,message};},selectedSource);
  const transaction=saveQueue.catch(()=>{}).then(async()=>{
   const merged=mergeDriveRows(state,source.rows,defaults,new Date().toISOString(),selectedSource);
   merged.students.forEach(validateStudent);
   const backupDir=path.join(dataDir,'drive-backups');await mkdir(backupDir,{recursive:true});
   await writeFile(path.join(backupDir,Date.now()+'.json'),JSON.stringify(state,null,2),{mode:0o600});
   const tmp=path.join(dataDir,'students.tmp');await writeFile(tmp,JSON.stringify(merged.students,null,2),{mode:0o600});await rename(tmp,path.join(dataDir,'students.json'));
   state=merged.students;
   driveStatus={status:'done',sourceUrl:connectionSettings.sheetUrl,finishedAt:new Date().toISOString(),report:merged.report,warnings:source.warnings,message:`Добавлено: ${merged.report.created}. Обновлено анкет: ${merged.report.updated}. Заполнено пропусков: ${merged.report.filled}. Расхождений для проверки: ${merged.report.conflicts}.`};
  });saveQueue=transaction;await transaction;
 }catch(e){driveStatus={...driveStatus,status:'error',message:e.message};}
}
const server=http.createServer(async(req,res)=>{try{
 if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)){json(res,403,{error:'Только localhost'});return;}
 if(req.headers.origin&&![origin,`http://localhost:${port}`].includes(req.headers.origin)){json(res,403,{error:'Недопустимый источник'});return;}
 const url=new URL(req.url,origin);
 if(url.pathname==='/api/session'&&req.method==='GET'){json(res,200,{token:csrf});return;}
 if(url.pathname.startsWith('/api/')&&req.headers['x-rezumator-token']!==csrf){json(res,403,{error:'Обновите страницу'});return;}
 if(url.pathname==='/api/status'&&req.method==='GET'){json(res,200,{...await accountStatus(),desktop,...modelSettings.snapshot(),rules_version:rulesVersion(await readRules()),legend_rules_version:rulesVersion(await readLegendRules())});return;}
 if(desktop&&url.pathname.startsWith('/api/account/')){
  if(active||connectionBusy||connectionWizard.operation||driveStatus.status==='running'||notionExports.busy){json(res,409,{error:'Дождитесь завершения текущей операции перед сменой аккаунта.'});return;}
  const provider=modelSettings.snapshot().provider,client=provider==='anthropic'?claudeAccountClient:accountClient;
  if(url.pathname==='/api/account/login'&&req.method==='POST'){json(res,200,await client.login());return;}
  if(url.pathname==='/api/account/code'&&req.method==='POST'){if(provider!=='anthropic')throw Error('Код входа нужен только для Claude.');const {code}=JSON.parse((await body(req,4000)).toString());json(res,200,await claudeAccountClient.submitCode(code));return;}
  if(url.pathname==='/api/account/cancel'&&req.method==='POST'){await client.cancel();json(res,200,{ok:true});return;}
  if(url.pathname==='/api/account/logout'&&req.method==='POST'){
   await client.logout();
   if(provider==='openai'){await saveConnections({...connectionSettings,sheetVerified:null,notionVerifiedAt:null});connectionWizard.close();notionProbe.close();modelClient.close();driveClient.close();notionClient.close();}
   json(res,200,{ok:true});return;
  }
 }
 if(desktop&&url.pathname==='/api/connections'&&req.method==='GET'){json(res,200,connectionSettings);return;}
 if(desktop&&url.pathname==='/api/connections/status'&&req.method==='GET'){
  if(!(await accountStatus('openai')).connected){json(res,200,{connected:false,providers:[],settings:connectionSettings});return;}
  json(res,200,{connected:true,...await connectionWizard.status(url.searchParams.get('refresh')==='1'),settings:connectionSettings});return;
 }
 if(desktop&&url.pathname.startsWith('/api/connections/')&&req.method==='POST'){
  const [, , ,provider,action]=url.pathname.split('/');providerFor(provider);
  if(connectionBusy||connectionWizard.operation||driveStatus.status==='running'||notionExports.busy)throw Error('Дождитесь завершения текущей операции с подключением.');
  if(!(await accountStatus('openai')).connected)throw Error('Сначала войдите в ChatGPT.');
  connectionBusy=true;
  try{
   const data=JSON.parse((await body(req,10000)).toString()||'{}');
   if(action==='install'){
    const result=await connectionWizard.install(provider,data.reviewed);driveClient.close();notionClient.close();notionProbe.close();json(res,200,result);return;
   }
   const status=await connectionWizard.provider(provider,true);
   if(status.status!=='connected')throw Error(status.message);
   if(provider==='google-drive'&&action==='check'){
    const parsed=parseConnections({...connectionSettings,sheetUrl:data.sheetUrl});if(!parsed.sheetId)throw Error('Вставьте ссылку на таблицу с анкетами.');
    driveClient.close();const checked=await driveClient.inspectSheet({id:parsed.sheetId,gid:parsed.sheetGid});
    await saveConnections({...connectionSettings,...parsed,sheetVerified:{...checked,at:new Date().toISOString()}});
    driveStatus={status:'idle',message:'Таблица проверена и подключена.',sourceUrl:connectionSettings.sheetUrl};
    json(res,200,{settings:connectionSettings,message:'Таблица проверена. Можно загружать учеников.'});return;
   }
   if(provider==='notion'&&(action==='check'||action==='select')){
    notionProbe.close();const workspace=await notionProbe.inspect();
    if(action==='select'){
     if(data.workspaceId!==workspace.id)throw Error('Пространство Notion изменилось. Повторите проверку.');
     const parsed=parseConnections({...connectionSettings,notionWorkspaceId:workspace.id});
     const settings={...connectionSettings,...parsed,notionWorkspaceName:workspace.name,notionVerifiedAt:new Date().toISOString()};
     const journal=await prepareNotionJournal(settings);await saveConnections(settings);
     notionClient.close();notionClient.workspaceId=parsed.notionWorkspaceId;notionExports=journal;
    }
    json(res,200,{workspace,settings:connectionSettings,message:action==='select'?'Пространство подключено. Можно создавать страницы.':'Проверьте пространство и подтвердите выбор.'});return;
   }
   json(res,404,{error:'Неизвестное действие подключения'});return;
  }finally{connectionBusy=false;}
 }
 if(url.pathname==='/api/models'&&req.method==='GET'){const provider=validateProvider(url.searchParams.get('provider')||modelSettings.snapshot().provider);json(res,200,{models:await modelSettings.models(provider,url.searchParams.get('refresh')==='1'),settings:modelSettings.snapshot(provider)});return;}
 if(url.pathname==='/api/generation-settings'&&req.method==='GET'){json(res,200,modelSettings.snapshot());return;}
 if(url.pathname==='/api/generation-settings'&&req.method==='POST'){
  const {settings,before}=JSON.parse((await body(req)).toString());
  try{json(res,200,await modelSettings.save(settings,before));}catch(e){json(res,e.status||400,{error:e.message});}return;
 }
 if(url.pathname==='/api/drive/status'&&req.method==='GET'){json(res,200,driveStatus);return;}
 if(url.pathname==='/api/drive/import'&&req.method==='POST'){
  if(desktop&&!connectionSettings.sheetId)throw Error('Укажите свою Google-таблицу в разделе «Подключения» и проверьте подключение.');
  if(connectionBusy||legendMaps.busy)throw Error('Дождитесь проверки подключения.');
  if(driveStatus.status==='running'){json(res,202,driveStatus);return;}
  driveStatus={status:'running',sourceUrl:connectionSettings.sheetUrl,message:'Подключаем Google Drive…'};
  void importDrive();json(res,202,driveStatus);return;
 }
 if(url.pathname==='/api/legend/maps'&&req.method==='GET'){json(res,200,legendMaps.status(notionExports));return;}
 if(url.pathname==='/api/legend/maps'&&req.method==='POST'){if(connectionBusy||legendMaps.busy)throw Error('Дождитесь проверки подключения.');const {studentId}=JSON.parse((await body(req)).toString());const student=state.find(s=>s.id===studentId);if(!student)throw Error('Ученик не найден');json(res,202,await legendMaps.start(student,notionExports));return;}
 if(url.pathname==='/api/notion/status'&&req.method==='GET'){json(res,200,notionExports.status());return;}
 if(url.pathname==='/api/notion/legend'&&req.method==='POST'){
  if(desktop&&!connectionSettings.notionWorkspaceId)throw Error('Укажите своё пространство Notion в разделе «Подключения».');
  if(connectionBusy||legendMaps.busy)throw Error('Дождитесь проверки подключения или обновления карты.');
  const {studentId}=JSON.parse((await body(req)).toString()),student=state.find(s=>s.id===studentId);
  if(!student)throw Error('Ученик не найден');
  json(res,202,await notionExports.syncLegend(student));return;
 }
 if(url.pathname==='/api/notion/pages'&&req.method==='POST'){if(desktop&&!connectionSettings.notionWorkspaceId)throw Error('Укажите ID своего пространства Notion в разделе «Подключения» и проверьте подключение.');if(connectionBusy||legendMaps.busy)throw Error('Дождитесь проверки подключения.');const student=JSON.parse((await body(req)).toString());if(!state.some(s=>s.id===student.id))throw new Error('Ученик не найден');json(res,202,await notionExports.start(student));return;}
 if(url.pathname==='/api/notion/pages/update'&&req.method==='POST'){if(connectionBusy||legendMaps.busy)throw Error('Дождитесь проверки подключения.');const student=JSON.parse((await body(req)).toString());if(!state.some(s=>s.id===student.id))throw new Error('Ученик не найден');if(student.replaceNotionLegend!==undefined&&typeof student.replaceNotionLegend!=='boolean')throw Error('Некорректный выбор замены легенды');json(res,202,await notionExports.update(student,{replaceLegend:student.replaceNotionLegend===true}));return;}
 if(url.pathname==='/api/state'&&req.method==='GET'){json(res,200,state);return;}
 if(url.pathname==='/api/state/changes'&&req.method==='POST'){
  const changes=JSON.parse((await body(req,12_000_000)).toString());
  let response;
  const transaction=saveQueue.catch(()=>{}).then(async()=>{
   const merged=applyStudentChanges(state,changes);
   if(merged.conflicts.length){response={conflicts:merged.conflicts};return;}
   merged.students.forEach(validateStudent);
   const tmp=path.join(dataDir,'students.tmp');await writeFile(tmp,JSON.stringify(merged.students,null,2),{mode:0o600});await rename(tmp,path.join(dataDir,'students.json'));
   state=merged.students;response={students:state};
  });saveQueue=transaction;await transaction;
  if(response.conflicts)json(res,409,{error:'Это поле уже изменено в другом окне. Ваш текст оставлен в редакторе: скопируйте его перед обновлением страницы.',conflicts:response.conflicts});
  else json(res,200,response);return;
 }
 if(url.pathname==='/api/state'&&req.method==='POST'){
  json(res,409,{error:'Открыта старая версия резюматора. Обновите страницу: сохранение всего списка отключено, чтобы не потерять изменения из другого окна.'});return;
 }
 if(url.pathname==='/api/prompt'&&req.method==='POST'){const s=JSON.parse((await body(req)).toString());const rules=await readRules();json(res,200,{prompt:buildPrompt(s,rules),rules_version:rulesVersion(rules)});return;}
 if(url.pathname==='/api/legend/rules'&&req.method==='GET'){const rules=await readLegendRules();json(res,200,{prompt:rules,rules_version:rulesVersion(rules)});return;}
 if(url.pathname==='/api/legend/prompt'&&req.method==='POST'){const s=JSON.parse((await body(req)).toString());const rules=await readLegendRules();json(res,200,{prompt:buildLegendPrompt(s,rules),rules_version:rulesVersion(rules)});return;}
 if((url.pathname==='/api/generate'||url.pathname==='/api/legend/generate')&&req.method==='POST'){
  const kind=url.pathname==='/api/legend/generate'?'legend':'resume';
  if(active){json(res,409,{error:'Уже идёт генерация. Дождитесь её завершения.'});return;}
  const s=validateStudent(JSON.parse((await body(req)).toString()));if(kind==='legend')buildLegendPrompt(s,'');const settings=await modelSettings.validatedSnapshot();
  if(!(await accountStatus(settings.provider)).connected){json(res,400,{error:`Войдите в ${GENERATION_PROVIDERS[settings.provider].name}. API-ключ не используется.`});return;}
  const rules=kind==='legend'?await readLegendRules():await readRules();if(active){json(res,409,{error:'Уже идёт генерация. Дождитесь её завершения.'});return;}json(res,202,publicJob(generate(s,rules,kind,settings)));return;
 }
 if(url.pathname.startsWith('/api/jobs/')){const id=url.pathname.split('/')[3],j=jobs.get(id);if(!j){json(res,404,{error:'Задание не найдено. Возможно, сервер перезапускался.'});return;}if(req.method==='DELETE')stop(j);if(req.method==='GET'||req.method==='DELETE'){json(res,200,publicJob(j));return;}}
 if(url.pathname==='/api/export/pdf'&&req.method==='POST'){
  const data=JSON.parse((await body(req,600_000)).toString());
  if(typeof data?.resume_text!=='string'||!data.resume_text.trim())throw new Error('Сначала создайте или заполните резюме');
  if(data.resume_text.length>120000)throw new Error('Текст резюме слишком длинный');
  const pdf=await new Promise((resolve,reject)=>{
   const child=spawn(process.env.REZUMATOR_PDF_TOOL||python,process.env.REZUMATOR_PDF_TOOL?['export']:[path.join(root,'export_pdf.py')],{stdio:['pipe','pipe','pipe']});const chunks=[];let size=0,tooLarge=false,timedOut=false;
   const timer=setTimeout(()=>{timedOut=true;child.kill();},30000);
   child.stdin.on('error',()=>{});child.stderr.on('data',()=>{});
   child.stdout.on('data',chunk=>{size+=chunk.length;if(size>12_000_000){tooLarge=true;child.kill();}else chunks.push(chunk);});
   child.on('error',()=>{clearTimeout(timer);reject(new Error('Не удалось запустить создание PDF. Проверьте Python.'));});
   child.on('close',code=>{clearTimeout(timer);const pdf=Buffer.concat(chunks);if(timedOut)reject(new Error('Создание PDF заняло слишком много времени'));else if(tooLarge)reject(new Error('PDF получился слишком большим'));else if(code!==0||!pdf.subarray(0,5).equals(Buffer.from('%PDF-')))reject(new Error('Не удалось создать PDF. Проверьте установку reportlab и шрифтов.'));else resolve(pdf);});
   const candidate={};for(const key of ['name','title','telegram','github','age'])candidate[key]=typeof data.candidate?.[key]==='string'?data.candidate[key].slice(0,300):'';candidate.showAge=data.candidate?.showAge===true;candidate.showGithub=data.candidate?.showGithub!==false;
   child.stdin.end(JSON.stringify({resume_text:normalizeResumeText(data.resume_text),candidate,updated_at:new Date().toISOString()}));
  });
  const name=(typeof data.name==='string'?data.name:'resume').replace(/[^а-яёa-z0-9_-]/gi,'_').slice(0,100)||'resume';
  res.writeHead(200,{'Content-Type':'application/pdf','Content-Length':pdf.length,'Content-Disposition':`attachment; filename="resume.pdf"; filename*=UTF-8''${encodeURIComponent(name+'.pdf')}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(pdf);return;
 }
 if(url.pathname==='/api/pdf'&&req.method==='POST'){
  const bytes=await body(req,15_000_000);if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw new Error('Выберите PDF-файл');
  const dir=await mkdtemp(path.join(dataDir,'pdf-'));try{const p=path.join(dir,'resume.pdf');await writeFile(p,bytes,{mode:0o600});const script="import sys,json,pdfplumber\nwith pdfplumber.open(sys.argv[1]) as p:\n if len(p.pages)>80: raise ValueError('Максимум 80 страниц')\n text='\\n\\n'.join(x.extract_text() or '' for x in p.pages)\n print(json.dumps({'text':text[:120000],'pages':len(p.pages)},ensure_ascii=False))";
   const output=await new Promise((resolve,reject)=>{const p2=spawn(process.env.REZUMATOR_PDF_TOOL||python,process.env.REZUMATOR_PDF_TOOL?['extract',p]:['-c',script,p],{stdio:['ignore','pipe','pipe']});let text='';const timer=setTimeout(()=>p2.kill(),40000);p2.stdout.on('data',c=>text+=c);p2.stderr.on('data',()=>{});p2.on('error',()=>reject(new Error('Не найден Python с pdfplumber')));p2.on('close',code=>{clearTimeout(timer);code===0?resolve(text):reject(new Error('Не удалось прочитать PDF: проверьте пароль, объём и формат.'));});});
   const result=JSON.parse(output);if(!result.text.trim())throw new Error('В PDF нет текстового слоя. Вставьте текст резюме вручную.');json(res,200,result);
  }finally{await rm(dir,{recursive:true,force:true});}return;
 }
 const assets={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/engine.mjs':'../engine.mjs','/legend-plan.mjs':'../legend-plan.mjs','/legend-format.mjs':'../legend-format.mjs','/state-sync.mjs':'../state-sync.mjs','/batch-operations.mjs':'../batch-operations.mjs','/connections-ui.mjs':'connections-ui.mjs'};
 if(req.method==='GET'&&assets[url.pathname]){const name=assets[url.pathname];const b=await readFile(path.join(root,'public',name));res.writeHead(200,{'Content-Type':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(b);return;}
 json(res,404,{error:'Не найдено'});
 }catch(e){if(!res.headersSent)json(res,400,{error:e.message||'Ошибка запроса'});else res.end();}});
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`Порт ${port} занят. Возможно, 1с-резюматор уже запущен.`:e.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>{port=server.address().port;origin=`http://127.0.0.1:${port}`;process.parentPort?.postMessage({type:'ready',origin});console.log(`1с-резюматор: ${origin}`);if(process.env.REZUMATOR_OPEN_BROWSER==='1')spawn('open',[origin],{stdio:'ignore'}).on('error',()=>{});});
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{connectionWizard?.close();notionProbe?.close();accountClient?.close();claudeAccountClient.close();modelClient.close();driveClient.close();notionClient.close();if(active)stop(active);server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),2500).unref();});
