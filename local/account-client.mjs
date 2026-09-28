import {NotionClient} from './notion-client.mjs';

// The bundled app has its own CODEX_HOME; login/logout never alter the host app.
export class AccountClient extends NotionClient {
 async initialize(){await this.startTransport();}
 async account(){
  await this.connect();
  const {account}=await this.rpc('account/read',{refreshToken:false});
  const connected=account?.type==='chatgpt';
  if(connected){this.loginId=null;this.authUrl=null;}
  return {connected,message:connected?'Подписка ChatGPT':'Войдите в ChatGPT',email:connected?account.email:null};
 }
 async login(){
  await this.connect();
  if(this.loginId)return {authUrl:this.authUrl};
  const result=await this.rpc('account/login/start',{type:'chatgpt'});
  const url=new URL(result.authUrl);
  if(url.protocol!=='https:'||url.hostname!=='auth.openai.com')throw Error('Codex вернул неизвестный адрес входа.');
  this.loginId=result.loginId;this.authUrl=url.href;
  return {authUrl:url.href};
 }
 async cancel(){await this.connect();if(this.loginId)await this.rpc('account/login/cancel',{loginId:this.loginId});this.loginId=null;this.authUrl=null;}
 async logout(){await this.cancel();await this.rpc('account/logout',{});}
}
