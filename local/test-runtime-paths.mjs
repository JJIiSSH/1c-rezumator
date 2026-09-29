import test from 'node:test';
import assert from 'node:assert/strict';
import {codexExecutable} from './runtime-paths.mjs';
import {ModelClient} from './model-settings.mjs';

test('Codex resolves the current app layout without relying on the launchd PATH',()=>{
 const current='/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
 const old='/Applications/ChatGPT.app/Contents/Resources/codex';
 assert.equal(codexExecutable({},p=>p===current),current);
 assert.equal(codexExecutable({},p=>p===old),old);
 assert.equal(codexExecutable({REZUMATOR_CODEX:'/bundled/codex'},()=>true),'/bundled/codex');
 assert.equal(codexExecutable({},()=>false),'codex');
});

test('A missing Codex executable reports the installation error instead of an account disconnect',async()=>{
 const client=new ModelClient({codex:'/no-such-rezumator-codex',env:process.env,cwd:'/tmp'});
 try{await assert.rejects(client.connect(),e=>e.code==='CODEX_UNAVAILABLE'&&/Не найден исполняемый файл/.test(e.message));}
 finally{client.close();}
});
