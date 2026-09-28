import test from 'node:test';
import assert from 'node:assert/strict';
import {ConnectionWizard,connectionUrl} from './connection-wizard.mjs';
import {mergeDriveRows} from './drive-import.mjs';

function fixture(overrides={}){
 const c=new ConnectionWizard({}),calls=[];let installed=overrides.installed??true;
 c.connect=async()=>{};
 c.rpc=async(method,params)=>{
  calls.push({method,params});
  if(method==='plugin/list')return {marketplaces:[{name:'untrusted-market',plugins:[{name:'notion',id:'notion@untrusted-market'}]},{name:'openai-curated-remote',plugins:[{name:'notion',id:'notion@openai-curated-remote',installed,enabled:true,localVersion:installed?'1':null,source:{type:'remote'},availability:'AVAILABLE',installPolicy:'AVAILABLE',mustShowInstallationInterstitial:true,...overrides}]}]};
  if(method==='plugin/read'){assert.equal(params.remoteMarketplaceName,'openai-curated-remote');return{plugin:{apps:[{id:'notion-app',name:'Notion',installUrl:'https://chatgpt.com/apps/notion/notion-app'}]}};}
  if(method==='app/installed')return {apps:installed?[{id:'notion-app',runtimeName:'Notion',enabled:true,callable:true}]:[]};
  if(method==='plugin/install'){installed=true;return {appsNeedingAuth:[],authPolicy:'ON_INSTALL'};}
  if(method==='config/value/write')return {};
  throw Error(method);
 };
 return {c,calls};
}
test('wizard trusts only the official plugin and authenticates through a validated app URL',async()=>{
 const{c}=fixture();const p=await c.provider('notion');assert.equal(p.status,'connected');
 assert.equal(connectionUrl('https://chatgpt.com/apps/notion/123'),'https://chatgpt.com/apps/notion/123');
 for(const url of ['javascript:alert(1)','https://chatgpt.com.evil.test/apps/notion','https://chatgpt.com/account','file:///tmp/a'])assert.equal(connectionUrl(url),null);
 await assert.rejects(c.provider('unknown'));
});
test('install requires the actual review and never installs an admin-blocked plugin',async()=>{
 const{c,calls}=fixture({installed:false});await assert.rejects(c.install('notion',false));
 assert.ok(!calls.some(x=>x.method==='plugin/install'));
 await c.install('notion',true);assert.equal(calls.filter(x=>x.method==='plugin/install').length,1);
 assert.deepEqual(calls.filter(x=>x.method==='config/value/write').map(x=>x.params.keyPath),['plugins."notion@openai-curated-remote".enabled','apps."notion-app".enabled']);
 const blocked=fixture({installed:false,availability:'DISABLED_BY_ADMIN'});await assert.rejects(blocked.c.install('notion',true));assert.ok(!blocked.calls.some(x=>x.method==='plugin/install'));
});
test('a remote installation still needs to be downloaded on a fresh Mac',async()=>{
 const{c}=fixture({installed:true,localVersion:null});const p=await c.provider('notion');assert.equal(p.status,'not_installed');assert.equal(p.needsInstall,true);
});
test('switching sheet sources does not treat previous imported values as a new source baseline',()=>{
 const s={id:'a',telegram:'@tester1',project:'Правка куратора',driveImport:{sheetId:'old',sheetGid:0,values:{project:'Правка куратора'},history:[]},result:{resume_text:'Готовое резюме'},resumeReady:true};
 const r=mergeDriveRows([s],[{key:'tester1',fields:{project:'Новый источник'},row:2,timestamp:'x'}],{},'now',{id:'new',gid:42,url:'https://example.test'});
 assert.equal(r.students[0].project,'Правка куратора');assert.equal(r.report.conflicts,1);assert.equal(r.students[0].resumeReady,true);assert.equal(r.students[0].result.resume_text,'Готовое резюме');assert.equal(r.students[0].driveImport.sheetGid,42);
});
