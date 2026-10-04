import {assertReadyLegend} from './legend-content.mjs';
import {createHash,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {deflateSync,inflateSync} from 'node:zlib';
import {legendBlocks} from './legend-format.mjs';

export const MAP_VERSION=2;
const hash=text=>createHash('sha256').update(text).digest('hex');
const clean=text=>String(text).replace(/\s*\{color="[^"]+"\}/g,'').replace(/\\([\\*~`$\[\]<>{}|^])/g,'$1').replace(/\*\*|`/g,'').replace(/<br\s*\/?\s*>/gi,'\n');
export function mapSource(text){
 return String(text||'').replace(/\r\n?/g,'\n').split('\n').filter(line=>!/^\s*<\/?(?:columns|column|callout|empty-block|table_of_contents)\b/.test(line)).map(line=>clean(line.trim())).join('\n').trim();
}
export function mapHash(name,source){return hash(JSON.stringify({version:MAP_VERSION,name,source:mapSource(source)}));}
export function legendMapSections(source){
 const sections=[];let section=null;
 for(const block of legendBlocks(mapSource(source))){
  if(block.type==='heading'&&block.level===2){section={title:clean(block.text),cards:[]};sections.push(section);continue;}
  if(!section){section={title:'Введение',cards:[]};sections.push(section);}
  if(block.type==='heading'){section.cards.push({title:clean(block.text),lines:[]});continue;}
  if(block.type==='divider')continue;
  if(!section.cards.length)section.cards.push({title:section.title,lines:[]});
  if(block.type==='list')section.cards.at(-1).lines.push(...block.items.map((text,i)=>(block.ordered?`${i+1}. `:'• ')+clean(text)));
  else section.cards.at(-1).lines.push(clean(block.text));
 }
 return sections.filter(s=>s.cards.some(c=>c.lines.length));
}
const columns=[{title:'01 · Рассказ о себе',color:'#dbeafe'},{title:'02 · Места работы',color:'#e0e7ff'},{title:'03 · Архитектура проектов',color:'#ccfbf1'},{title:'04 · Стек и выбор решений',color:'#fef3c7'},{title:'05 · Опорные кейсы',color:'#dcfce7'},{title:'06 · Факапы в тесте',color:'#ffedd5'},{title:'07 · Вопросы и ответы',color:'#f3e8ff'}];
function lane(title){if(/факап|ошибк/i.test(title))return 5;if(/вопрос|спросят|спросить/i.test(title))return 6;if(/архитектур|устройство проект/i.test(title))return 2;if(/стек|выбор решен|инструмент/i.test(title))return 3;if(/кейс|горжусь/i.test(title))return 4;if(/мест.*работ|работодател|компани|контекст работ/i.test(title))return 1;return 0;}
function chunks(text,max=330){
 const sentences=text.split(/(?<=[.!?])\s+(?=[А-ЯЁA-Z«])/u),out=[];let group='';
 for(const sentence of sentences){if(group&&group.length+sentence.length>max){out.push(group);group='';}group+=(group?' ':'')+sentence;}
 if(group)out.push(group);return out;
}
export function mapCardParts(card,{brief=false}={}){
 const parts=[];for(const raw of card.lines){for(const line of raw.split('\n').filter(Boolean)){
  const value=clean(line),match=value.match(/^([^:]{2,55}):\s*(.+)$/);
  if(match){
   if(match[1].toLowerCase()==='путь данных'){
    const paths=match[2].split(/(?=(?:В обратном направлении|Для отчёта):)/u);
    for(const path of paths){const named=path.match(/^(В обратном направлении|Для отчёта):\s*(.+)$/u);parts.push({title:named?'Путь данных · '+named[1].toLowerCase():match[1],text:(named?named[2]:path).trim()});}
   }else parts.push({title:match[1],text:match[2]});
  }
  else {const paragraph=brief?value.split(/(?<=[.!?])\s+(?=[А-ЯЁA-Z«])/u)[0]:value;for(const piece of chunks(paragraph))parts.push({title:'',text:piece});}
 }}
 return parts;
}
function wrap(text,width,size){
 const limit=Math.max(12,Math.floor(width/(size*.57)));
 return text.split('\n').flatMap(line=>{const out=[];let current='';for(const word of line.split(/\s+/)){if(current&&current.length+word.length+1>limit){out.push(current);current='';}current+=(current?' ':'')+word;}out.push(current);return out;}).join('\n');
}
export function createLegendMap({name,source,notionUrl=null}){
 if(!mapSource(source))throw Error('Сначала создайте легенду.');
 assertReadyLegend(mapSource(source));
 const elements=[];let count=0;
 function element(type,x,y,width,height,props={}){const id=`map-${++count}`,seed=parseInt(hash(id).slice(0,7),16);const e={id,type,x,y,width,height,angle:0,strokeColor:'#263238',backgroundColor:'transparent',fillStyle:'solid',strokeWidth:1,strokeStyle:'solid',roughness:0,opacity:100,groupIds:[],frameId:null,index:null,roundness:null,seed,version:1,versionNonce:seed,isDeleted:false,boundElements:null,updated:1,link:null,locked:false,...props};elements.push(e);return e;}
 function text(value,x,y,width,size=18,props={}){const wrapped=wrap(value,width,size);return element('text',x,y,width,wrapped.split('\n').length*size*1.25,{text:wrapped,originalText:wrapped,fontSize:size,fontFamily:2,textAlign:'left',verticalAlign:'top',containerId:null,lineHeight:1.25,autoResize:true,...props});}
 text(`КАРТА ЛЕГЕНДЫ · ${name||'Ученик'}`,40,20,3900,34);
 text('Начни с рассказа о себе, затем переходи к работе и кейсам. Увеличивай нужные карточки колёсиком с Ctrl / ⌘. Ссылка открывает сохранённую версию карты.',40,86,3900,18);
 if(notionUrl)text('Полная легенда в Notion ↗',40,140,550,18,{link:notionUrl,strokeColor:'#1971c2'});
 const positions=columns.map((column,i)=>{const x=40+i*570;element('rectangle',x,200,530,64,{backgroundColor:column.color,roundness:{type:3}});text(column.title,x+18,218,494,22);if(i<columns.length-1)element('arrow',x+538,232,22,0,{points:[[0,0],[22,0]],startBinding:null,endBinding:null,startArrowhead:null,endArrowhead:'arrow'});return {x,y:290};});
 for(const section of legendMapSections(source)){
  const index=lane(section.title),p=positions[index];
  text(section.title,p.x,p.y,530,23,{strokeColor:'#364152'});p.y+=wrap(section.title,530,23).split('\n').length*29+20;
  for(const card of section.cards){
   if(card.title!==section.title||section.cards.length>1){const parent=text(card.title,p.x+8,p.y,514,21,{strokeColor:'#334155'});p.y+=parent.height+16;}
   const parts=mapCardParts(card,{brief:index===0||index===1});let previous=null;
   for(const part of parts){
    const steps=part.title.toLowerCase().startsWith('путь данных')?part.text.split(/\s*(?:->|→)\s*/).filter(Boolean):[];
    if(steps.length>=2&&steps.length<=6&&steps.every(step=>step.length<130)){
     if(part.title){text(part.title,p.x+8,p.y,514,17,{strokeColor:'#0f766e'});p.y+=30;}
     const rows=Math.ceil(steps.length/2);let previousBottom=null;
     for(let row=0;row<rows;row++){
      if(previousBottom!==null)element('arrow',p.x+125,previousBottom,278,p.y-previousBottom,{points:[[278,0],[278,18],[0,18],[0,p.y-previousBottom]],startBinding:null,endBinding:null,startArrowhead:null,endArrowhead:'arrow'});
      const pair=steps.slice(row*2,row*2+2),heights=pair.map(step=>wrap(step,210,16).split('\n').length*20+34),height=Math.max(...heights);
      pair.forEach((step,j)=>{const x=p.x+j*278;element('rectangle',x,p.y,250,height,{backgroundColor:'#ecfdf5',strokeColor:'#86bda3',roundness:{type:3}});text(step,x+18,p.y+15,214,16);if(j===0&&pair.length===2)element('arrow',x+256,p.y+height/2,16,0,{points:[[0,0],[16,0]],startBinding:null,endBinding:null,startArrowhead:null,endArrowhead:'arrow'});});
      previousBottom=p.y+height;p.y+=height+(row<rows-1?36:18);
     }
     previous=null;continue;
    }
    const titleHeight=part.title?wrap(part.title,486,18).split('\n').length*22.5+10:0;
    const bodyHeight=wrap(part.text,486,17).split('\n').length*21.25,height=titleHeight+bodyHeight+34;
    const groupId=`node-${count}`,node=element('rectangle',p.x,p.y,530,height,{backgroundColor:part.title?columns[index].color:'#ffffff',strokeColor:'#cbd5e1',roundness:{type:3},groupIds:[groupId]});
    if(previous&&index>=2&&index<=5)element('arrow',p.x+265,previous.y+previous.height,0,p.y-(previous.y+previous.height),{points:[[0,0],[0,p.y-(previous.y+previous.height)]],startBinding:null,endBinding:null,startArrowhead:null,endArrowhead:'arrow',strokeColor:'#94a3b8'});
    if(part.title)text(part.title,p.x+22,p.y+15,486,18,{groupIds:[groupId],strokeColor:'#334155'});
    text(part.text,p.x+22,p.y+16+titleHeight,486,17,{groupIds:[groupId]});p.y+=height+18;previous=node;
   }
   p.y+=28;
  }
  p.y+=22;
 }
 return {type:'excalidraw',version:2,source:'https://excalidraw.com',elements,appState:{viewBackgroundColor:'#f8fafc',gridSize:null},files:{}};
}
function pack(...chunks){const total=4+chunks.reduce((sum,chunk)=>sum+4+chunk.length,0),out=Buffer.alloc(total);out.writeUInt32BE(1,0);let offset=4;for(const chunk of chunks){out.writeUInt32BE(chunk.length,offset);offset+=4;chunk.copy(out,offset);offset+=chunk.length;}return out;}
function unpack(data){const buffer=Buffer.from(data);if(buffer.length<4||buffer.readUInt32BE(0)!==1)throw Error('Некорректный формат Excalidraw.');const chunks=[];let i=4;while(i<buffer.length){if(i+4>buffer.length)throw Error('Повреждённая карта.');const size=buffer.readUInt32BE(i);i+=4;if(i+size>buffer.length)throw Error('Повреждённая карта.');chunks.push(buffer.subarray(i,i+size));i+=size;}return chunks;}
export function encodeScene(scene){
 const key=randomBytes(16),iv=randomBytes(12),cipher=createCipheriv('aes-128-gcm',key,iv);
 const compressed=deflateSync(pack(Buffer.from('null'),Buffer.from(JSON.stringify(scene))));
 const encrypted=Buffer.concat([cipher.update(compressed),cipher.final(),cipher.getAuthTag()]);
 return {key:key.toString('base64url'),payload:pack(Buffer.from(JSON.stringify({version:2,compression:'pako@1',encryption:'AES-GCM'})),iv,encrypted)};
}
export function decodeScene(payload,key){
 const chunks=unpack(payload);if(chunks.length!==3)throw Error('Некорректный формат карты.');
 const [meta,iv,ciphertext]=chunks;const info=JSON.parse(meta);if(info.encryption!=='AES-GCM'||info.compression!=='pako@1')throw Error('Неизвестный формат карты.');
 const decipher=createDecipheriv('aes-128-gcm',Buffer.from(key,'base64url'),iv);decipher.setAuthTag(ciphertext.subarray(-16));
 const decrypted=inflateSync(Buffer.concat([decipher.update(ciphertext.subarray(0,-16)),decipher.final()]),{maxOutputLength:2_000_000});const inner=unpack(decrypted);if(inner.length!==2)throw Error('Некорректное содержимое карты.');return JSON.parse(inner[1]);
}
export function safeMapUrl(value){try{const url=new URL(value);return url.origin==='https://excalidraw.com'&&url.pathname==='/'&&/^#json=[a-zA-Z0-9_-]+,[a-zA-Z0-9_-]{22}$/.test(url.hash)?url.href:null;}catch{return null;}}
export async function publishScene(scene,{fetchImpl=fetch,onPublished=async()=>{}}={}){
 const {key,payload}=encodeScene(scene);
 const response=await fetchImpl('https://json.excalidraw.com/api/v2/post/',{method:'POST',body:payload,signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error(`Excalidraw не принял карту (${response.status}).`);
 const result=await response.json();if(!/^[a-zA-Z0-9_-]+$/.test(result.id||''))throw Error('Excalidraw не вернул адрес карты.');
 const url=`https://excalidraw.com/#json=${result.id},${key}`;await onPublished(url);
 await verifyScene(url,scene,{fetchImpl});return url;
}
export async function verifyScene(url,scene,{fetchImpl=fetch}={}){
 if(!safeMapUrl(url))throw Error('Некорректный адрес карты.');const [id,key]=new URL(url).hash.slice(6).split(',');
 const saved=await fetchImpl(`https://json.excalidraw.com/api/v2/${id}`,{signal:AbortSignal.timeout(30000)});
 if(!saved.ok)throw Error('Карта отправлена, но её сохранение пока не подтверждено. Повторная проверка использует тот же адрес.');
 const restored=decodeScene(await saved.arrayBuffer(),key);
 if(JSON.stringify(restored)!==JSON.stringify(scene))throw Error('Сохранённая карта отличается от исходной.');
 return url;
}

// Static preview of the same scene; no scripts, remote fonts or new story content.
export function mapSvg(scene){
 const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
 const width=Math.ceil(Math.max(...scene.elements.map(e=>e.x+e.width))+40),height=Math.ceil(Math.max(...scene.elements.map(e=>e.y+e.height))+40);
 const shapes=scene.elements.map(e=>{
  if(e.type==='rectangle')return `<rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" rx="12" fill="${esc(e.backgroundColor)}" stroke="${esc(e.strokeColor)}"/>`;
  if(e.type==='arrow')return `<path d="${e.points.map(([x,y],i)=>(i?'L':'M')+(e.x+x)+' '+(e.y+y)).join(' ')}" stroke="${esc(e.strokeColor)}" fill="none" marker-end="url(#arrow)"/>`;
  if(e.type==='text')return `<text font-family="Arial, sans-serif" font-size="${e.fontSize}" fill="${esc(e.strokeColor)}">${e.text.split('\n').map((line,i)=>`<tspan x="${e.x}" y="${e.y+e.fontSize+i*e.fontSize*1.25}">${esc(line)}</tspan>`).join('')}</text>`;
  return '';
 }).join('\n');
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8" fill="#263238"/></marker></defs><rect width="100%" height="100%" fill="#f8fafc"/>${shapes}</svg>`;
}
