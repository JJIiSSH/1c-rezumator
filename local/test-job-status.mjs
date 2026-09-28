import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./public/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/\ninit\(\);\s*$/,'');
function fixture(){const nodes=new Map();const document={querySelector(selector){if(!nodes.has(selector)){const classes=new Set();nodes.set(selector,{textContent:'',classList:{toggle(c,on){if(on)classes.add(c);else classes.delete(c);},contains:c=>classes.has(c)}});}return nodes.get(selector);},querySelectorAll:()=>[]};const context=vm.createContext({document,structuredClone,console,setInterval:()=>0});vm.runInContext(source,context);return{nodes,run:code=>vm.runInContext(code,context)};}
test('Плашка и остановка видны только владельцу генерации, включая поздние ответы',()=>{
 const f=fixture();f.run("selected='s1';activeJob={studentId:'s1',kind:'resume'};showJob('В работе',false,'s1');");
 assert.equal(f.nodes.get('#jobStatus').textContent,'В работе');assert.equal(f.nodes.get('#cancel').classList.contains('hidden'),false);
 f.run("selected='s2';renderJobStatus();showJob('Поздний ответ',false,'s1');");
 assert.equal(f.nodes.get('#jobStatus').classList.contains('hidden'),true);assert.equal(f.nodes.get('#cancel').classList.contains('hidden'),true);
 f.run("selected='s1';renderJobStatus();");assert.equal(f.nodes.get('#jobStatus').textContent,'Поздний ответ');
});
test('Завершение и ошибка остаются у своего ученика; восстановленное задание тоже имеет владельца',()=>{
 const f=fixture();f.run("selected='s2';activeJob={studentId:'s1',kind:'legend'};renderJobStatus();");assert.equal(f.nodes.get('#jobStatus').classList.contains('hidden'),true);
 f.run("showJob('Ошибка',true,'s1');activeJob=null;selected='s1';renderJobStatus();");assert.equal(f.nodes.get('#jobStatus').classList.contains('error'),true);assert.equal(f.nodes.get('#cancel').classList.contains('hidden'),true);
 f.run("selected='s2';renderJobStatus();");assert.equal(f.nodes.get('#jobStatus').textContent,'');assert.equal(f.nodes.get('#jobStatus').classList.contains('hidden'),true);
});
