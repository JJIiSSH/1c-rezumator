import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {studentChanges} from './state-sync.mjs';
test('Две HTTP-сессии сохраняют разные поля; старый клиент и конфликт отклоняются',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'rezumator-sync-http-'));
 const initial=[{id:'test',jobs:[],name:'Тест синхронизации',resumeReady:false,urgent:true,notes:''}];await writeFile(path.join(dir,'students.json'),JSON.stringify(initial));
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const child=spawn(process.execPath,['server.mjs'],{cwd:path.dirname(fileURLToPath(import.meta.url)),env:{...process.env,REZUMATOR_PORT:String(port),REZUMATOR_DATA_DIR:dir},stdio:'ignore'});
 t.after(async()=>{if(child.exitCode===null){const stopped=new Promise(r=>child.once('close',r));child.kill();await stopped;}await rm(dir,{recursive:true,force:true});});
 let session;const base='http://127.0.0.1:'+port;
 for(let i=0;i<100;i++){try{session=await(await fetch(base+'/api/session')).json();break;}catch{await new Promise(r=>setTimeout(r,30));}}assert.ok(session);
 async function request(p,body){return fetch(base+p,{method:body===undefined?'GET':'POST',headers:{'x-rezumator-token':session.token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});}
 const a=await(await request('/api/state')).json(),b=await(await request('/api/state')).json();
 const editedA=structuredClone(a);editedA[0].resumeReady=true;const editedB=structuredClone(b);editedB[0].notes='Правка из другого браузера';
 assert.equal((await request('/api/state/changes',studentChanges(a,editedA))).status,200);
 assert.equal((await request('/api/state/changes',studentChanges(b,editedB))).status,200);
 const saved=await(await request('/api/state')).json();assert.equal(saved[0].resumeReady,true);assert.equal(saved[0].urgent,true);assert.equal(saved[0].notes,editedB[0].notes);
 const stale=structuredClone(b);stale[0].notes='Конфликт';assert.equal((await request('/api/state/changes',studentChanges(b,stale))).status,409);assert.equal((await request('/api/state',b)).status,409);
 assert.deepEqual(await(await request('/api/state')).json(),saved);assert.deepEqual(JSON.parse(await readFile(path.join(dir,'students.json'),'utf8')),saved);
});
