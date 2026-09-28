// Arrays such as jobs/metrics and each result are atomic fields.
export const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function studentChanges(base,current){
 const old=new Map(base.map(s=>[s.id,s]));const changes=[];
 for(const s of current){const previous=old.get(s.id);if(!previous){changes.push({id:s.id,create:s});continue;}
  const fields={};for(const key of Object.keys(s))if(key!=='id'&&!same(previous[key],s[key]))fields[key]={before:previous[key],value:s[key]};
  if(Object.keys(fields).length)changes.push({id:s.id,fields});
 }
 return changes;
}
export function applyStudentChanges(state,changes){
 if(!Array.isArray(changes)||changes.length>150)throw Error('Некорректный список изменений');
 const next=structuredClone(state);const conflicts=[];const ids=new Set();
 for(const change of changes){
  if(!change||typeof change.id!=='string'||ids.has(change.id))throw Error('Некорректный идентификатор изменения');ids.add(change.id);
  let s=next.find(s=>s.id===change.id);
  if(change.create){if(change.create.id!==change.id)throw Error('Некорректная новая анкета');if(s){if(!same(s,change.create))conflicts.push(change.id);}else next.push(structuredClone(change.create));continue;}
  if(!s){conflicts.push(change.id);continue;}
  if(!change.fields||typeof change.fields!=='object'||Array.isArray(change.fields))throw Error('Некорректные поля изменения');
  for(const [key,edit] of Object.entries(change.fields)){
   if(['id','__proto__','constructor','prototype'].includes(key)||!edit||!Object.hasOwn(edit,'value'))throw Error('Недопустимое поле изменения');
   if(!same(s[key],edit.before)&&!same(s[key],edit.value)){conflicts.push(change.id+':'+key);continue;}
   s[key]=structuredClone(edit.value);
  }
 }
 if(next.length>150)throw Error('Максимум 150 анкет');
 return {students:next,conflicts};
}
// Incorporate a response without discarding edits made while the request was in flight.
export function keepPendingEdits(sent,current,remote){
 const pending=studentChanges(sent,current);
 const next=structuredClone(remote);
 for(const change of pending){let s=next.find(s=>s.id===change.id);
  if(change.create){if(!s)next.push(structuredClone(change.create));continue;}
  if(!s){const local=current.find(s=>s.id===change.id);if(local)next.push(structuredClone(local));continue;}
  for(const [key,edit]of Object.entries(change.fields))s[key]=structuredClone(edit.value);
 }
 return next;
}
