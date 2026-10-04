const htmlEscape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const notionEscape=text=>String(text).replace(/[\\*~`$\[\]<>{}|^]/g,'\\$&');
const knownHeading=/^(?:Короткое представление|Представление|Рассказ о себе|Рассказ о (?:каждом|местах|месте).*|(?:Последнее|Предыдущее) место работы\s*[-:].*|Контекст (?:мест|работ).*|Профиль|Стек|Масштаб|Опорные кейсы|Кейсы|Факапы(?: только.*| в.*)?|Вопросы(?: и (?:опорные )?ответы| для.*| по.*)?|Что могут спросить|Места работы)$/i;
const caseHeading=/^(?:Кейс|Факап|Место работы|Работодатель|Компания)\s+\d+\b/i;
const detailHeading=/^(?:Контекст(?: компании)?|Тип проекта|Команда(?: и процесс)?|Задача|Проблема|Что (?:сделал|делал|могу)|Мой вклад|Личный вклад|Решение|Как работал.*|Результат|Проверка|Ограничения|Нагрузки и масштаб|Задачи, которыми горжусь|Почему понадобилась доработка|Среда|Ошибка|Как заметили|Последствия|Исправление|Профилактика)$/i;

function inline(text,escape,html=false){
 return String(text).split(/(\*\*[^\n]+?\*\*|`[^\n`]+`)/g).map(part=>{
  if(part.startsWith('**')&&part.endsWith('**'))return html?`<strong>${escape(part.slice(2,-2))}</strong>`:`**${escape(part.slice(2,-2))}**`;
  if(part.startsWith('`')&&part.endsWith('`'))return html?`<code>${escape(part.slice(1,-1))}</code>`:'`'+part.slice(1,-1)+'`';
  return escape(part);
 }).join('');
}
function legacyHeading(line){
 const numbered=line.match(/^(\d+)[.)]\s+(.+)$/),lettered=line.match(/^[А-ЯA-Z][.)]\s+(.+)$/u);
 const value=(numbered?.[2]||lettered?.[1]||line).trim();
 if(value.length>160||/[.!]$/.test(value))return null;
 if(knownHeading.test(value))return {type:'heading',level:2,text:value};
 if(caseHeading.test(value))return {type:'heading',level:3,text:value};
 if(lettered&&detailHeading.test(value))return {type:'heading',level:3,text:value};
 if(numbered&&value===value.toUpperCase()&&/[А-ЯA-Z]/.test(value))return {type:'heading',level:2,text:value};
 return null;
}
export function legendBlocks(text){
 const blocks=[];let paragraph=[],caseSection=false,questionSection=false;
 const flush=()=>{if(paragraph.length){blocks.push({type:'paragraph',text:paragraph.join('\n')});paragraph=[];}};
 for(const raw of String(text||'').replace(/\r\n?/g,'\n').split('\n')){
  const line=raw.trim();if(!line){flush();continue;}
  const heading=line.match(/^#{1,6}\s+(.+)$/),legacy=heading?null:legacyHeading(line);
  if(heading||legacy){flush();const block=heading?{type:'heading',level:Math.min(3,Math.max(2,raw.match(/^\s*(#+)/)[1].length)),text:heading[1]}:legacy;blocks.push(block);if(block.level===2){caseSection=/^(?:опорные кейсы|кейсы|факапы)/i.test(block.text);questionSection=/^(?:вопросы|что могут спросить)/i.test(block.text);}continue;}
  if(/^>\s?/.test(line)){flush();const value=line.replace(/^>\s?/,'');if(!value)continue;const last=blocks.at(-1);if(last?.type==='callout')last.text+='\n'+value;else blocks.push({type:'callout',text:value});continue;}
  if(/^[-*]\s+/.test(line)||/^\d+[.)]\s+/.test(line)){
   flush();const ordered=/^\d/.test(line),value=line.replace(/^(?:[-*]|\d+[.)])\s+/,'');
   const question=questionSection&&ordered&&value.match(/^([^.!?]{5,220}[.!?])\s*(.*)$/);
   if(question){blocks.push({type:'heading',level:3,text:line.match(/^\d+/)[0]+'. '+question[1]});if(question[2])blocks.push({type:'paragraph',text:question[2]});continue;}
   if(caseSection&&ordered&&value.length>350){
    const split=value.search(/(?<=[.!?])\s+(?=[А-ЯЁA-Z«])/u);
    if(split>0&&split<=220){blocks.push({type:'heading',level:3,text:line.match(/^\d+/)[0]+'. '+value.slice(0,split)});blocks.push({type:'paragraph',text:value.slice(split).trimStart()});continue;}
   }
   const last=blocks.at(-1);if(last?.type==='list'&&last.ordered===ordered)last.items.push(value);else blocks.push({type:'list',ordered,items:[value]});continue;
  }
  if(/^-{3,}$/.test(line)){flush();blocks.push({type:'divider'});continue;}
  if(line.length<220&&line.endsWith('?')){flush();blocks.push({type:'heading',level:3,text:line});continue;}
  const label=line.match(/^([^:*]{2,55}):\s+(.+)$/);
  if(label&&/^(?:Уровень|Опыт|Место|Специализация|Конфигурации|Платформа|Обмены|Интеграции|СУБД|Инфраструктура|Код|Стек|Компания|Период|Команда|Масштаб|Контекст|Задача|Решение|Результат|Мой вклад|Среда|Ошибка|Последствия|Исправление|Профилактика|Ответ)$/i.test(label[1])){flush();blocks.push({type:'paragraph',text:`**${label[1]}:** ${label[2]}`});continue;}
  paragraph.push(raw);
 }
 flush();return blocks;
}
function sections(blocks){
 const result=[];
 for(const block of blocks){if(block.type==='heading'&&block.level===2)result.push({title:block.text,blocks:[]});else{if(!result.length)result.push({title:null,blocks:[]});result.at(-1).blocks.push(block);}}
 return result;
}
function profilePair(a,b){return a?.title?.toLowerCase()==='профиль'&&b?.title?.toLowerCase()==='стек';}
function readableParagraphs(text){
 if(text.length<500||text.includes('\n'))return [text];
 const sentences=text.split(/(?<=[.!?])\s+(?=[А-ЯЁA-Z«])/u),out=[];let group=[];
 for(const sentence of sentences){if(group.length&&(group.length>=3||group.join(' ').length+sentence.length>550)){out.push(group.join(' '));group=[];}group.push(sentence);}
 if(group.length)out.push(group.join(' '));return out;
}
function htmlBlock(block){
 const rich=text=>inline(text,htmlEscape,true).replace(/\n/g,'<br>');
 if(block.type==='heading')return `<h3>${rich(block.text)}</h3>`;
 if(block.type==='callout')return `<aside class="legend-callout">${rich(block.text)}</aside>`;
 if(block.type==='divider')return '<hr>';
 if(block.type==='list'){const tag=block.ordered?'ol':'ul';return `<${tag}>${block.items.map(t=>`<li>${rich(t)}</li>`).join('')}</${tag}>`;}
 return readableParagraphs(block.text).map(t=>`<p>${rich(t)}</p>`).join('');
}
export function legendHtml(text){
 const parts=sections(legendBlocks(text)),titles=parts.filter(p=>p.title);
 const nav=titles.length?`<nav class="legend-toc" aria-label="Разделы легенды">${parts.map((p,i)=>p.title?`<a href="#legend-section-${i}">${htmlEscape(p.title)}</a>`:'').join('')}</nav>`:'';
 const section=(p,i)=>`<section class="legend-section" id="legend-section-${i}">${p.title?`<h2>${inline(p.title,htmlEscape,true)}</h2>`:''}${p.blocks.map(htmlBlock).join('')}</section>`;
 const rendered=[];for(let i=0;i<parts.length;i++){if(profilePair(parts[i],parts[i+1])){rendered.push(`<div class="legend-profile-grid">${section(parts[i],i)}${section(parts[i+1],i+1)}</div>`);i++;}else rendered.push(section(parts[i],i));}
 return nav+rendered.join('');
}
function notionBlock(block){
 const rich=text=>inline(text,notionEscape);
 if(block.type==='heading')return `### ${rich(block.text)}`;
 if(block.type==='callout')return `<callout color="blue_bg">\n\t${rich(block.text).replace(/\n/g,'<br>')}\n</callout>`;
 if(block.type==='divider')return '---';
 if(block.type==='list')return block.items.map((t,i)=>(block.ordered?`${i+1}. `:'- ')+rich(t)).join('\n');
 return readableParagraphs(block.text).map(rich).join('\n\n');
}
export function legendNotion(text){
 const parts=sections(legendBlocks(text));
 const section=p=>[p.title?`## ${inline(p.title,notionEscape)} {color="${p.title.toLowerCase()==='стек'?'purple':p.title.toLowerCase()==='профиль'?'blue':'green_bg'}"}`:'',...p.blocks.map(notionBlock)].filter(Boolean).join('\n\n');
 const out=[];if(!parts[0]?.blocks.some(b=>b.type==='callout'))out.push('<callout color="blue_bg">\n\t**Материал для подготовки к собеседованию**\n</callout>');
 for(let i=0;i<parts.length;i++){if(profilePair(parts[i],parts[i+1])){const col=p=>'\t<column ratio="50">\n'+section(p).split('\n').map(l=>'\t\t'+l).join('\n')+'\n\t</column>';out.push('<columns>\n'+col(parts[i])+'\n'+col(parts[i+1])+'\n</columns>');i++;}else out.push(section(parts[i]));}
 return out.filter(Boolean).join('\n\n');
}
