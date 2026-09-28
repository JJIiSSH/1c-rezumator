import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {parseConnections} from '../local/desktop-settings.mjs';
import {AccountClient} from '../local/account-client.mjs';
import {ClaudeAccountClient,parseClaudeLoginUrl} from '../local/claude-client.mjs';

test('connection settings accept only Google Sheets URLs and normalized workspace IDs',()=>{
 assert.deepEqual(parseConnections({}),{sheetId:'',sheetUrl:'',sheetGid:0,notionWorkspaceId:''});
 assert.equal(parseConnections({sheetUrl:'https://docs.google.com/spreadsheets/d/test_id/edit#gid=0'}).sheetId,'test_id');
 for(const sheetUrl of ['file:///etc/passwd','https://evil.test/spreadsheets/d/a/edit'])assert.throws(()=>parseConnections({sheetUrl}));
 assert.equal(parseConnections({sheetUrl:'https://docs.google.com/spreadsheets/d/a/edit#gid=9'}).sheetGid,9);
 assert.throws(()=>parseConnections({notionWorkspaceId:'wrong'}));
 assert.equal(parseConnections({notionWorkspaceId:'12345678123412341234123456789abc'}).notionWorkspaceId,'12345678-1234-1234-1234-123456789abc');
});
test('account uses managed ChatGPT flow, cancels pending login and clears its state',async()=>{
 const c=new AccountClient({});const calls=[];c.connect=async()=>{};
 c.rpc=async(method,params)=>{calls.push({method,params});return method==='account/login/start'?{authUrl:'https://auth.openai.com/authorize?test',loginId:'test'}:{};};
 await c.login();await c.login();assert.equal(calls.length,1);assert.deepEqual(calls[0].params,{type:'chatgpt'});
 await c.logout();assert.equal(calls[1].method,'account/login/cancel');assert.equal(calls[2].method,'account/logout');assert.equal(c.loginId,null);
 c.rpc=async()=>({authUrl:'file:///etc/passwd'});await assert.rejects(c.login());
});
test('Claude login accepts only the official authorization page',()=>{
 assert.match(parseClaudeLoginUrl('Open https://claude.com/cai/oauth/authorize?state=test now'),/^https:\/\/claude\.com\/cai\/oauth\/authorize/);
 assert.equal(parseClaudeLoginUrl('no link'),null);
 assert.equal(parseClaudeLoginUrl('https://claude.com.evil.test/cai/oauth/authorize'),null);
});
test('Claude account flow opens official login, accepts a fallback code and logs out',async()=>{
 const dir=await mkdtemp('/tmp/rezumator-claude-account-'),state=path.join(dir,'state'),fake=path.join(dir,'claude');await writeFile(state,'0');
 await writeFile(fake,`#!${process.execPath}
const fs=require('node:fs'),args=process.argv.slice(2),state=process.env.FAKE_STATE;
if(args[1]==='status'){const loggedIn=fs.readFileSync(state,'utf8')==='1';console.log(JSON.stringify({loggedIn,authMethod:loggedIn?'claude.ai':'none'}));process.exit(loggedIn?0:1);}
if(args[1]==='login'){console.log('Open https://claude.com/cai/oauth/authorize?state=test');process.stdin.once('data',()=>{fs.writeFileSync(state,'1');process.exit(0);});}
if(args[1]==='logout'){fs.writeFileSync(state,'0');process.exit(0);}
`,{mode:0o700});
 try{
  const client=new ClaudeAccountClient({claude:fake,env:{...process.env,FAKE_STATE:state},cwd:dir});const login=await client.login();assert.match(login.authUrl,/^https:\/\/claude\.com/);
  await client.submitCode('one-time-code');for(let i=0;i<50&&!(await client.account()).connected;i++)await new Promise(r=>setTimeout(r,10));assert.equal((await client.account()).connected,true);
  await client.logout();assert.equal((await client.account()).connected,false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('distribution has empty seed, exact canonical prompts and no personal defaults',async()=>{
 const stage=new URL('./stage/service/',import.meta.url);
 assert.deepEqual(JSON.parse(await readFile(new URL('seed.json',stage))),[]);
 for(const name of ['rules.md','legend.md'])assert.equal(await readFile(new URL(`prompts/${name}`,stage),'utf8'),await readFile(new URL(`../local/prompts/${name}`,import.meta.url),'utf8'));
 async function inspect(dir){for(const e of await readdir(dir,{withFileTypes:true})){
  assert.ok(!['.data','auth.json','students.json','work','node_modules'].includes(e.name),e.name);
  const file=new URL(e.name+(e.isDirectory()?'/':''),dir);if(e.isDirectory())await inspect(file);else {
   const text=await readFile(file,'utf8');assert.doesNotMatch(text,/\/Users\/a111|private_workspace_name|private_sheet_id|private_workspace_id/);
  }
 }}await inspect(stage);
});
