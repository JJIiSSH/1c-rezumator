import {randomUUID} from 'node:crypto';
import {NotionClient,unwrapNotion} from './notion-client.mjs';

const MARKETPLACE='openai-curated-remote';
const PROVIDERS={
 'google-drive':{name:'Google Drive',runtimeName:'Google Drive',description:'Чтение таблицы с анкетами и прежних PDF. Исходную таблицу резюматор не изменяет.'},
 notion:{name:'Notion',runtimeName:'Notion',description:'Создание и обновление страниц с резюме и легендами. Проверки и предложенные изменения остаются на компьютере.'}
};
export function providerFor(id){const p=PROVIDERS[id];if(!p)throw Error('Неизвестное подключение.');return p;}
export function connectionUrl(value){
 try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='chatgpt.com'&&u.pathname.startsWith('/apps/')?u.href:null;}catch{return null;}
}
function externalPolicyUrl(value){try{const u=new URL(value);return u.protocol==='https:'?u.href:null;}catch{return null;}}
export class ConnectionWizard extends NotionClient {
 constructor(options){super(options);this.catalog=null;this.operation=null;this.catalogAt=0;}
 async initialize(){await this.startTransport();}
 async catalogRows(refresh=false){
  await this.connect();
  if(!refresh&&this.catalog&&Date.now()-this.catalogAt<60000)return this.catalog;
  const response=await this.rpc('plugin/list',{forceRefetch:refresh});
  const market=response.marketplaces?.find(m=>m.name===MARKETPLACE);
  if(!market)throw Error('Каталог подключений сейчас недоступен. Проверьте вход в ChatGPT и повторите.');
  this.catalog=market.plugins||[];this.catalogAt=Date.now();return this.catalog;
 }
 async provider(id,refresh=false,refreshRuntime=refresh){
  const info=providerFor(id),rows=await this.catalogRows(refresh),plugin=rows.find(p=>p.name===id&&p.id===`${id}@${MARKETPLACE}`);
  if(!plugin)return {id,...info,status:'unavailable',message:'Плагин недоступен для этого аккаунта.'};
  const {plugin:detail}=await this.rpc('plugin/read',{pluginName:id,remoteMarketplaceName:MARKETPLACE});
  const app=detail.apps?.find(a=>a.name===info.runtimeName);
  const installed=await this.rpc('app/installed',{forceRefresh:refreshRuntime});
  const runtime=installed.apps?.find(a=>a.id===app?.id);
  const blocked=plugin.installPolicy==='NOT_AVAILABLE'||plugin.availability==='DISABLED_BY_ADMIN';
  const authUrl=connectionUrl(app?.installUrl);
  const needsInstall=!plugin.installed||(plugin.source?.type==='remote'&&!plugin.localVersion);
  const status=blocked?'unavailable':needsInstall?'not_installed':!plugin.enabled?'disabled':runtime?.enabled&&runtime?.callable?'connected':'needs_auth';
  return {id,...info,status,installed:plugin.installed,needsInstall,appId:app?.id,authUrl,requiresReview:!!plugin.mustShowInstallationInterstitial,
   developer:plugin.interface?.developerName||'',capabilities:plugin.interface?.capabilities||[],
   privacyUrl:externalPolicyUrl(plugin.interface?.privacyPolicyUrl),termsUrl:externalPolicyUrl(plugin.interface?.termsOfServiceUrl),
   message:({unavailable:'Подключение ограничено настройками аккаунта.',not_installed:'Установите плагин, затем предоставьте доступ.',disabled:'Подключение выключено.',connected:'Аккаунт подключён. Можно проверить таблицу или пространство.',needs_auth:'Предоставьте доступ в браузере, затем нажмите «Проверить подключение».'})[status]};
 }
 async status(refresh=false){
  await this.catalogRows(refresh);const providers=[];
  for(const id of Object.keys(PROVIDERS)){try{providers.push(await this.provider(id,false,true));}catch(e){providers.push({id,...PROVIDERS[id],status:'error',message:e.message});}}
  return {providers};
 }
 async install(id,reviewed){
  providerFor(id);
  if(this.operation)throw Error('Дождитесь завершения подключения.');
  this.operation=id;
  try{
   const before=await this.provider(id,true);
   if(before.status==='unavailable')throw Error(before.message);
   if(before.requiresReview&&reviewed!==true)throw Error('Сначала ознакомьтесь с доступом плагина и подтвердите установку.');
   if(before.needsInstall)await this.rpc('plugin/install',{pluginName:id,remoteMarketplaceName:MARKETPLACE,installAttemptId:randomUUID()},120000);
   // Enable only this explicitly chosen plugin in the application's private config.
   await this.rpc('config/value/write',{keyPath:`plugins.\"${id}@${MARKETPLACE}\".enabled`,value:true,mergeStrategy:'replace'});
   if(before.appId)await this.rpc('config/value/write',{keyPath:`apps.\"${before.appId}\".enabled`,value:true,mergeStrategy:'replace'});
   this.catalog=null;return await this.provider(id,true);
  }finally{this.operation=null;}
 }
 close(){super.close();this.catalog=null;this.catalogAt=0;}
}

export class NotionWorkspaceProbe extends NotionClient {
 async initialize(){await this.openConnection('Notion',['notion.fetch','notion.notion-create-pages','notion.notion-update-page']);}
 async inspect(){
  await this.connect();const r=unwrapNotion(await this.rawCall('notion.fetch',{id:'self'}));
  const w=r.self?.workspace;
  if(!w?.id||!/^[a-f0-9-]{32,36}$/i.test(w.id))throw Error('Notion не вернул пространство. Проверьте доступ при подключении.');
  return {id:w.id,name:w.name||'Пространство Notion'};
 }
}
