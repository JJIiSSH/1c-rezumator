import {spawn,spawnSync} from 'node:child_process';

function safeUrl(text){
 const match=String(text).match(/https:\/\/claude\.com\/[^\s\x1b\x07]+/);
 if(!match)return null;
 const url=new URL(match[0]);
 if(url.protocol!=='https:'||url.hostname!=='claude.com')throw Error('Claude Code вернул неизвестный адрес входа.');
 return url.href;
}

function run(claude,args,options={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(claude,args,{...options,stdio:['ignore','pipe','pipe']});let output='';
  const timer=setTimeout(()=>{child.kill();reject(Error('Claude Code не ответил вовремя.'));},15000);
  child.stdout.on('data',chunk=>output=(output+chunk).slice(-20000));child.stderr.on('data',chunk=>output=(output+chunk).slice(-20000));
  child.on('error',error=>{clearTimeout(timer);reject(error);});
  child.on('close',code=>{clearTimeout(timer);code===0?resolve(output):reject(Error(output.trim()||`Claude Code завершился с кодом ${code}.`));});
 });
}

export class ClaudeAccountClient{
 constructor({claude='claude',env=process.env,cwd=process.cwd()}={}){this.claude=claude;this.env=env;this.cwd=cwd;this.loginChild=null;this.authUrl=null;}
 account(){
  const result=spawnSync(this.claude,['auth','status'],{cwd:this.cwd,env:this.env,encoding:'utf8',timeout:7000});
  let status={};try{status=JSON.parse(result.stdout||'{}');}catch{}
  const connected=result.status===0&&status.loggedIn===true&&status.authMethod!=='api_key';
  if(connected){this.authUrl=null;if(this.loginChild&&!this.loginChild.killed)this.loginChild.kill();this.loginChild=null;}
  return {connected,message:connected?'Подписка Claude':'Войдите в Claude',email:connected?(status.email||null):null};
 }
 async login(){
  if(this.loginChild&&!this.loginChild.killed&&this.authUrl)return {authUrl:this.authUrl,needsCode:true};
  await this.cancel();
  return await new Promise((resolve,reject)=>{
   const env={...this.env,BROWSER:'/usr/bin/false'};
   const child=spawn(this.claude,['auth','login','--claudeai'],{cwd:this.cwd,env,stdio:['pipe','pipe','pipe']});this.loginChild=child;
   let output='',settled=false;
   const timer=setTimeout(()=>{if(!settled){settled=true;child.kill();this.loginChild=null;reject(Error('Claude Code не открыл страницу входа. Повторите попытку.'));}},15000);
   const onData=chunk=>{
    output=(output+chunk).slice(-30000);let url;
    try{url=safeUrl(output);}catch(error){if(!settled){settled=true;clearTimeout(timer);child.kill();this.loginChild=null;reject(error);}return;}
    if(url&&!settled){settled=true;clearTimeout(timer);this.authUrl=url;resolve({authUrl:url,needsCode:true});}
   };
   child.stdout.on('data',onData);child.stderr.on('data',onData);
   child.on('error',error=>{clearTimeout(timer);this.loginChild=null;if(!settled){settled=true;reject(Error(`Не удалось запустить Claude Code: ${error.message}`));}});
   child.on('close',code=>{clearTimeout(timer);this.loginChild=null;if(!settled){settled=true;reject(Error(code===0?'Вход Claude завершён. Проверяем аккаунт.':output.trim()||'Не удалось начать вход в Claude.'));}});
  });
 }
 async submitCode(code){
  if(!this.loginChild||this.loginChild.killed||!this.loginChild.stdin.writable)throw Error('Сначала начните вход в Claude.');
  const value=String(code||'').trim();if(!value||value.length>2000)throw Error('Вставьте код, показанный на странице Claude.');
  this.loginChild.stdin.write(value+'\n');return {ok:true};
 }
 async cancel(){if(this.loginChild&&!this.loginChild.killed)this.loginChild.kill();this.loginChild=null;this.authUrl=null;}
 async logout(){await this.cancel();await run(this.claude,['auth','logout'],{cwd:this.cwd,env:this.env});}
 close(){void this.cancel();}
}

export function parseClaudeLoginUrl(text){return safeUrl(text);}
