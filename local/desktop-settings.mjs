export function parseConnections(value){
 const sheetUrl=String(value.sheetUrl||'').trim();
 let sheetId='',sheetGid=0;
 if(sheetUrl){
  let url;try{url=new URL(sheetUrl);}catch{throw Error('Вставьте ссылку на Google-таблицу.');}
  sheetId=url.pathname.match(/^\/spreadsheets\/d\/([\w-]+)(?:\/|$)/)?.[1]||'';
  if(url.protocol!=='https:'||url.hostname!=='docs.google.com'||!sheetId)throw Error('Нужна ссылка https://docs.google.com/spreadsheets/d/…');
  const rawGid=new URLSearchParams(url.hash.slice(1)).get('gid')??url.searchParams.get('gid')??'0';
  if(!/^\d+$/.test(rawGid))throw Error('Некорректный номер листа Google-таблицы.');
  sheetGid=Number(rawGid);
  if(!Number.isSafeInteger(sheetGid)||sheetGid<0)throw Error('Некорректный номер листа Google-таблицы.');
 }
 let notionWorkspaceId=String(value.notionWorkspaceId||'').trim().toLowerCase().replace(/-/g,'');
 if(notionWorkspaceId&&!/^[a-f0-9]{32}$/.test(notionWorkspaceId))throw Error('ID пространства Notion должен быть UUID.');
 if(notionWorkspaceId)notionWorkspaceId=notionWorkspaceId.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,'$1-$2-$3-$4-$5');
 return {sheetUrl:sheetId?`https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=${sheetGid}`:'',sheetId,sheetGid,notionWorkspaceId};
}
