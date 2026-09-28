import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const reportPath=process.argv[2];
if(!reportPath)throw new Error('Укажите отчёт миграции из .data/backups.');
const report=JSON.parse(await readFile(reportPath,'utf8'));
const students=JSON.parse(await readFile(path.join(root,'.data/students.json'),'utf8'));
const origin=process.env.REZUMATOR_ORIGIN||'http://127.0.0.1:4317';
const token=(await(await fetch(origin+'/api/session')).json()).token;
const request=async(route,options={})=>{
 const response=await fetch(origin+route,{...options,headers:{'x-rezumator-token':token,'Content-Type':'application/json',...options.headers}});
 const data=await response.json();
 if(!response.ok)throw new Error(data.error||'Ошибка локального сервера');
 return data;
};
const failures=[];
for(const change of report.changes){
 try{
  const student=students.find(s=>s.id===change.id);
  if(!student)throw new Error('Ученик не найден в локальной базе.');
  const started=await request('/api/notion/pages/update',{method:'POST',body:JSON.stringify(student)});
  if(!['updating','done'].includes(started.status))throw new Error(started.message||started.status);
  let entry=started;
  for(let attempt=0;entry.status==='updating'&&attempt<180;attempt++){
   await new Promise(resolve=>setTimeout(resolve,1000));
   entry=(await request('/api/notion/status')).entries[change.id];
  }
  if(entry.status!=='done')throw new Error(entry.message||'Обновление не завершилось');
  console.log(JSON.stringify({id:change.id,status:'done',pageId:entry.pageId}));
 }catch(error){
  failures.push({id:change.id,error:error.message});
  console.log(JSON.stringify({id:change.id,status:'error',message:error.message}));
 }
}
if(failures.length)throw new Error('Не обновлено страниц: '+JSON.stringify(failures));
