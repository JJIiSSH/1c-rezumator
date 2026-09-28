// Plain browser UI; the same HTTP contract can be used by the future web client.
export function setupConnections({api,onNeedChatGPT,onChanged,onError}){
 const $=id=>document.getElementById(id),dialog=$('connectionsDialog');
 let snapshot=null,loading=false,working=false,workspace=null,poll=null,waitingUntil=0;
 const stopPoll=()=>{clearTimeout(poll);poll=null;};
 const post=(url,data={})=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 function button(text,click,className='secondary-button'){
  const el=document.createElement('button');el.type='button';el.className=className;el.textContent=text;el.onclick=click;return el;
 }
 function render(){
  $('connectionsLogin').classList.toggle('hidden',!!snapshot?.connected);
  $('driveSetup').classList.toggle('hidden',!snapshot?.connected);$('notionSetup').classList.toggle('hidden',!snapshot?.connected);
  const root=$('connectionProviders');root.replaceChildren();
  for(const p of snapshot?.providers||[]){
   const card=document.createElement('section');card.className='connection-card';
   const heading=document.createElement('h3');heading.textContent=p.name;card.append(heading);
   const steps=document.createElement('p');steps.className='connection-steps';steps.textContent=p.status==='connected'?'✓ Плагин установлен   ✓ Доступ выдан':'1. Установить плагин   2. Выдать доступ   3. Проверить';card.append(steps);
   const status=document.createElement('p');status.textContent=p.message;status.className=p.status==='connected'?'connection-ok':'connection-description';card.append(status);
   const actions=document.createElement('div');actions.className='desktop-account-actions';card.append(actions);
   if(['not_installed','disabled'].includes(p.status)){
    const panel=document.createElement('div');panel.className='plugin-review hidden';
    const description=document.createElement('p');description.textContent=p.description;panel.append(description);
    const publisher=document.createElement('p');publisher.textContent=`Разработчик: ${p.developer||p.name}. Плагин может читать и изменять данные в пределах разрешений, выданных в браузере.`;panel.append(publisher);
    for(const [label,url]of [['Конфиденциальность',p.privacyUrl],['Условия использования',p.termsUrl]])if(url){const link=document.createElement('a');link.textContent=label;link.href=url;link.target='_blank';link.rel='noreferrer';panel.append(link,document.createTextNode(' · '));}
    const label=document.createElement('label');label.className='check-label';const check=document.createElement('input');check.type='checkbox';label.append(check,document.createTextNode('Я ознакомился с доступом и хочу подключить этот плагин'));panel.append(label);
    const confirm=button('Установить и продолжить',async()=>{if(!check.checked)return;await action(async()=>{await post(`/api/connections/${p.id}/install`,{reviewed:true});await refresh(true);});});confirm.disabled=true;check.onchange=()=>{confirm.disabled=!check.checked||working;};panel.append(confirm);card.append(panel);
    const begin=button(p.status==='disabled'?'Включить плагин':'Установить плагин',()=>{panel.classList.remove('hidden');begin.classList.add('hidden');});actions.append(begin);
   }
   if(p.authUrl&&p.status!=='not_installed'&&p.status!=='unavailable'){
    const link=document.createElement('a');link.className='secondary-button';link.href=p.authUrl;link.target='_blank';link.rel='noreferrer';link.textContent=p.status==='connected'?'Управлять доступом':`Подключить ${p.name}`;
    link.onclick=()=>{waitingUntil=Date.now()+180000;schedulePoll();};actions.append(link);
   }
   actions.append(button('Проверить подключение',()=>refresh(true),'text-button'));
   root.append(card);
  }
  $('verifyDrive').disabled=working||snapshot?.providers?.find(p=>p.id==='google-drive')?.status!=='connected';
  $('verifyNotion').disabled=working||snapshot?.providers?.find(p=>p.id==='notion')?.status!=='connected';
  $('refreshConnections').disabled=loading||working;
  $('selectNotionWorkspace').disabled=working||!workspace;
 }
 function schedulePoll(){stopPoll();if(dialog.open&&Date.now()<waitingUntil)poll=setTimeout(()=>refresh(false),8000);}
 async function refresh(force=false){
  if(loading)return;loading=true;$('refreshConnections').disabled=true;
  try{snapshot=await api('/api/connections/status'+(force?'?refresh=1':''));render();$('connectionsMessage').textContent=snapshot.connected?'Подключения относятся к аккаунту ChatGPT, выбранному в приложении.':'Для настройки нужен вход в ChatGPT.';}
  catch(e){$('connectionsMessage').textContent=e.message;}
  finally{loading=false;$('refreshConnections').disabled=working;schedulePoll();}
 }
 async function action(fn){
  if(working)return;working=true;window.rezumatorConnectionsBusy=true;dialog.querySelectorAll('button[type="submit"],.connection-card button,#verifyNotion,#selectNotionWorkspace').forEach(b=>{b.disabled=true;});
  $('connectionsMessage').textContent='Проверяем подключение…';
  try{await fn();}catch(e){$('connectionsMessage').textContent=e.message;}
  finally{working=false;window.rezumatorConnectionsBusy=false;render();}
 }
 $('connectionSettings').onclick=async()=>{
  dialog.showModal();$('verifyDrive').disabled=true;$('verifyNotion').disabled=true;$('refreshConnections').disabled=true;$('connectionsMessage').textContent='Загружаем подключения…';
  try{
   const settings=await api('/api/connections');$('connectionSheet').value=settings.sheetUrl||'';
   $('driveConnectionResult').textContent=settings.sheetVerified?`Сохранено: ${settings.sheetVerified.title}, лист «${settings.sheetVerified.sheetTitle}».`:'';
   $('notionConnectionResult').textContent=settings.notionWorkspaceName?`Выбрано пространство: ${settings.notionWorkspaceName}.`:'';
   workspace=null;$('selectNotionWorkspace').classList.add('hidden');await refresh();
  }catch(e){$('connectionsMessage').textContent=e.message;onError?.(e.message);}
 };
 $('closeConnections').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{stopPoll();waitingUntil=0;});
 $('connectionsGoLogin').onclick=async()=>{dialog.close();try{await onNeedChatGPT?.();}catch(e){onError?.(e.message);}};
 $('refreshConnections').onclick=()=>refresh(true);
 window.addEventListener('focus',()=>{if(dialog.open&&waitingUntil>Date.now()&&!working)void refresh(true);});
 $('driveConnectionForm').onsubmit=e=>{e.preventDefault();void action(async()=>{
  const result=await post('/api/connections/google-drive/check',{sheetUrl:$('connectionSheet').value});
  const sheet=result.settings.sheetVerified;$('driveConnectionResult').textContent=`✓ ${sheet.title}, лист «${sheet.sheetTitle}». Можно загружать учеников.`;
  $('connectionsMessage').textContent=result.message;onChanged?.();
 });};
 $('verifyNotion').onclick=()=>action(async()=>{
  const result=await post('/api/connections/notion/check');workspace=result.workspace;
  $('notionConnectionResult').textContent=`Найдено пространство: ${workspace.name}.`;
  $('selectNotionWorkspace').classList.remove('hidden');$('selectNotionWorkspace').disabled=false;$('connectionsMessage').textContent=result.message;
 });
 $('selectNotionWorkspace').onclick=()=>action(async()=>{
  if(!workspace)return;const result=await post('/api/connections/notion/select',{workspaceId:workspace.id});
  $('notionConnectionResult').textContent=`✓ Подключено: ${result.workspace.name}. Можно создавать страницы.`;
  $('selectNotionWorkspace').classList.add('hidden');$('connectionsMessage').textContent=result.message;onChanged?.();
 });
}
