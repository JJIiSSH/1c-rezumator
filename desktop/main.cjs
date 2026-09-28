const {app,BrowserWindow,Menu,dialog,shell,utilityProcess,session}=require('electron');
const path=require('node:path');
const fs=require('node:fs/promises');
let window,backend,origin,quitting=false,checkingQuit=false;
const resources=app.isPackaged?process.resourcesPath:path.join(__dirname,'stage');
const smoke=process.env.REZUMATOR_SMOKE_DIR;
if(smoke)app.setPath('userData',smoke);
app.setName('1с-резюматор');
if(!app.requestSingleInstanceLock())app.quit();
else {
 app.on('second-instance',()=>{if(window){window.show();window.focus();}});
 app.whenReady().then(start).catch(fail);
 app.on('activate',()=>{if(window)window.show();else if(origin)createWindow();});
 app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
 app.on('before-quit',event=>{
  if(quitting)return;
  event.preventDefault();if(checkingQuit)return;checkingQuit=true;
  void (async()=>{
   try{
    const state=window?await window.webContents.executeJavaScript('window.rezumatorBeforeClose ? window.rezumatorBeforeClose() : ({saved:true,busy:false})'):{saved:true,busy:false};
    if(!state.saved){dialog.showErrorBox('Анкета ещё не сохранена','Дождитесь сохранения полей перед выходом.');return;}
    if(state.busy){const {response}=await dialog.showMessageBox(window,{type:'question',buttons:['Продолжить работу','Остановить и выйти'],defaultId:0,cancelId:0,message:'Ещё идёт операция. Остановить её и выйти?'});if(response!==1)return;}
    quitting=true;backend?.kill();app.quit();
   }catch{dialog.showErrorBox('Не удалось проверить сохранение','Откройте окно приложения и проверьте сохранение анкеты перед выходом.');}
   finally{checkingQuit=false;}
  })();
 });
}
function external(url){
 try{const u=new URL(url);if(['https:','http:'].includes(u.protocol))void shell.openExternal(u.href);}catch{}
}
function createWindow(){
 window=new BrowserWindow({width:1440,height:960,minWidth:1024,minHeight:700,title:'1с-резюматор',backgroundColor:'#faf9f6',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,spellcheck:false}});
 window.webContents.setWindowOpenHandler(({url})=>{external(url);return {action:'deny'};});
 window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin){event.preventDefault();external(url);}});
 window.on('closed',()=>{window=null;});
 window.on('close',event=>{if(!quitting){event.preventDefault();window.hide();}});
 window.loadURL(origin);
}
async function start(){
 const data=path.join(app.getPath('userData'),'data');
 const codexHome=path.join(app.getPath('userData'),'codex');
 const claudeHome=path.join(app.getPath('userData'),'claude');
 await fs.mkdir(data,{recursive:true,mode:0o700});await fs.mkdir(codexHome,{recursive:true,mode:0o700});await fs.mkdir(claudeHome,{recursive:true,mode:0o700});
 // Only initialize new app-owned settings. Never read/copy the developer's login.
 try{await fs.writeFile(path.join(codexHome,'config.toml'),'forced_login_method = "chatgpt"\ncli_auth_credentials_store = "file"\n',{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
 const runtime=path.join(resources,'runtime');
 const childEnv={...process.env,REZUMATOR_DESKTOP:'1',REZUMATOR_PORT:'0',REZUMATOR_DATA_DIR:data,CODEX_HOME:codexHome,CLAUDE_CONFIG_DIR:claudeHome,REZUMATOR_CODEX:path.join(runtime,'codex/bin/codex'),REZUMATOR_CLAUDE:path.join(runtime,'claude/claude'),REZUMATOR_PDF_TOOL:path.join(runtime,'pdf/rezumator-pdf'),PATH:path.join(runtime,'codex/codex-path')+':/usr/bin:/bin:/usr/sbin:/sbin'};
 for(const key of ['OPENAI_API_KEY','CODEX_API_KEY','OPENAI_BASE_URL','CODEX_THREAD_ID','CODEX_SESSION_ID','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN','ANTHROPIC_BASE_URL','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY','REZUMATOR_PYTHON','REZUMATOR_OPEN_BROWSER','NODE_OPTIONS','NODE_PATH','PYTHONPATH','PYTHONHOME','ELECTRON_RUN_AS_NODE'])delete childEnv[key];
 session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 session.defaultSession.setPermissionCheckHandler(()=>false);
 session.defaultSession.on('will-download',(_event,item)=>item.setSaveDialogOptions({defaultPath:path.join(app.getPath('downloads'),path.basename(item.getFilename()))}));
 Menu.setApplicationMenu(Menu.buildFromTemplate([
  {label:'1с-резюматор',submenu:[{role:'about'},{type:'separator'},{label:'Папка с анкетами',click:()=>shell.openPath(data)},{label:'Правила генерации',click:()=>shell.openPath(path.join(resources,'service/prompts'))},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]},
  {role:'editMenu'}, {label:'Вид',submenu:[{role:'reload'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]}, {role:'windowMenu'}
 ]));
 backend=utilityProcess.fork(path.join(resources,'service/desktop-bootstrap.mjs'),[],{cwd:data,env:childEnv,stdio:'pipe',serviceName:'1с-резюматор: локальный сервер'});
 let errorTail='';backend.stderr.on('data',chunk=>{errorTail=(errorTail+chunk).slice(-3000);});backend.stdout.on('data',()=>{});
 const timeout=setTimeout(()=>fail(Error('Локальный сервер не запустился за 30 секунд.')),30000);
 backend.on('exit',code=>{clearTimeout(timeout);if(quitting)return;if(code===0){quitting=true;app.quit();return;}fail(Error(`Локальный сервер остановился (${code}). ${errorTail}`));});
 backend.on('message',async message=>{
  if(message.type!=='ready')return;
  clearTimeout(timeout);origin=message.origin;createWindow();
  if(smoke){await fs.writeFile(path.join(smoke,'ready.json'),JSON.stringify({origin,pid:process.pid}));}
 });
}
function fail(error){
 if(quitting)return;quitting=true;
 dialog.showErrorBox('Не удалось запустить 1с-резюматор',String(error.message).slice(0,4000));
 backend?.kill();app.quit();
}
