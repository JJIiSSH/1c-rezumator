import {NotionClient} from './notion-client.mjs';
import {sheetId,parseSheet,findStudent,extractCandidateName} from './drive-import.mjs';
function unwrap(response){
 if(response?.isError)throw Error('Google Drive отклонил запрос. Проверьте доступ к файлу в Codex.');
 let data=response?.structuredContent;
 if(!data)for(const c of response?.content||[])if(c.type==='text'){try{data=JSON.parse(c.text);break;}catch{}}
 if(!data)throw Error('Не удалось прочитать ответ Google Drive.');
 return data.result||data;
}
function driveId(url){try{const u=new URL(url);if(u.protocol!=='https:'||u.hostname!=='drive.google.com')return null;const id=u.searchParams.get('id')||u.pathname.match(/^\/file\/d\/([^/]+)/)?.[1];return /^[a-zA-Z0-9_-]+$/.test(id||'')?id:null;}catch{return null;}}
export class DriveClient extends NotionClient{
 async initialize(){await this.openConnection('Google Drive',['google_drive.get_spreadsheet_metadata','google_drive.get_spreadsheet_range','google_drive.fetch','google_drive.get_file_metadata']);}
 async call(tool,args){await this.connect();return unwrap(await this.rawCall('google_drive.'+tool,args));}
 async inspectSheet(source={id:sheetId,gid:0}){
  const meta=await this.call('get_spreadsheet_metadata',{spreadsheet_id:source.id});
  const sheet=meta.sheets?.find(s=>s.properties?.sheetId===(source.gid||0))?.properties;
  if(!sheet||sheet.hidden)throw Error('Выбранный лист с анкетами не найден или скрыт.');
  const title="'"+sheet.title.replace(/'/g,"''")+"'";
  const headers=await this.call('get_spreadsheet_range',{spreadsheet_id:source.id,sheet_name:title,range:'A1:Z1'});
  parseSheet(headers.values||[]);
  return {title:meta.properties?.title||meta.title||'Таблица учеников',sheetTitle:sheet.title,gid:sheet.sheetId,rowCount:sheet.gridProperties?.rowCount||0};
 }
 async readStudents(students,progress=()=>{},source={id:sheetId,gid:0}){
  progress('Читаем Google-таблицу…');
  const meta=await this.call('get_spreadsheet_metadata',{spreadsheet_id:source.id});
  const sheet=meta.sheets?.find(s=>s.properties?.sheetId===(source.gid||0))?.properties;
  if(!sheet||sheet.hidden)throw Error('Выбранный лист с анкетами не найден.');
  const title="'"+sheet.title.replace(/'/g,"''")+"'",rowCount=sheet.gridProperties.rowCount,colCount=Math.min(sheet.gridProperties.columnCount,26);
  if(rowCount>10000)throw Error('Таблица превышает лимит 10 000 строк. Уточните диапазон импорта.');
  const values=[];
  for(let start=1;start<=rowCount;start+=200){
   const end=Math.min(start+199,rowCount),r=await this.call('get_spreadsheet_range',{spreadsheet_id:source.id,sheet_name:title,range:`A${start}:${String.fromCharCode(64+colCount)}${end}`});
   for(let i=0;i<=end-start;i++)values.push(r.values?.[i]||[]);
  }
  const parsed=parseSheet(values);
  for(const row of parsed.rows){
   const s=findStudent(students,row,source),id=driveId(row.fields.sourceUrl);
   if(!s?.name&&s?.resume){const name=extractCandidateName(s.resume);if(name)row.fields.name=name;}
   if(!id){row.warnings=['В анкете нет доступной ссылки на PDF в Google Drive.'];continue;}
   progress(`Проверяем прежнее резюме @${row.key}…`);
   try{
    const file=await this.call('get_file_metadata',{fileId:id,fields:'id,name,mimeType,modifiedTime,webViewLink,size'});
    if(file.mime_type!=='application/pdf')throw Error('В ссылке не PDF. Загрузите этот файл вручную.');
    const modified=s?.driveImport?.file;
    row.file={id,modifiedTime:file.modified_time,title:file.title};
    if(s?.resume?.trim()&&modified?.id===id&&modified.modifiedTime===file.modified_time)continue;
    // Existing manually loaded text is preserved by the merge; initial sync only fills its filename.
    if(s?.resume?.trim()&&!modified){if(!s.pdfName)row.fields.pdfName=file.title;continue;}
    const pdf=await this.call('fetch',{url:`https://drive.google.com/file/d/${id}/view`});
    if(!pdf.content?.trim())throw Error('В PDF не найден текст. Загрузите файл с текстовым слоем вручную.');
    if(pdf.content.length>120000)throw Error('Текст PDF превышает лимит 120 000 символов.');
    row.fields.resume=pdf.content;row.fields.pdfName=file.title;
    if(!s?.name){const name=extractCandidateName(pdf.content);if(name)row.fields.name=name;}
   }catch(e){row.warnings=[`Прежнее резюме: ${e.message}`];row.file=s?.driveImport?.file||null;parsed.warnings.push(`@${row.key}: ${e.message}`);}
  }
  return parsed;
 }
}
