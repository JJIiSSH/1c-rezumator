import {spawn} from 'node:child_process';
import {GENERATION_PROVIDERS} from './model-settings.mjs';

// Never infer exhausted quota from incidental words in CLI logs or usage statistics.
export function generationError(input,provider){
 const name=GENERATION_PROVIDERS[provider].name;
 const text=typeof input==='string'?input:JSON.stringify(input||{});
 const rawCode=typeof input==='object'?(input?.code||input?.type||input?.error?.code):null;
 const providerCode=typeof rawCode==='string'&&/^[a-zA-Z0-9_.-]{1,80}$/.test(rawCode)?rawCode:null;
 let code='GENERATION_FAILED',message=`${name} не вернул готовый материал. Повторите генерацию.`;
 if(/usage[_-]?limit[_-]?(?:reached|exceeded)|insufficient_quota|quota[ _-]+(?:exceeded|exhausted|limit)|(?:hit|reached|exhausted|exceeded).{0,35}(?:usage|weekly|monthly|subscription) limit|exceeded.{0,20}(?:current|available) quota/i.test(text)){
  code='GENERATION_QUOTA';message=`Достигнут лимит подписки ${name}. Дождитесь его обновления и повторите.`;
 }else if(/context_length_exceeded|context (?:window|length)|too many tokens|maximum.{0,20}tokens|token limit/i.test(text)){
  code='GENERATION_CONTEXT';message=`Запрос слишком большой для ${name}. Сократите исходные данные или выберите другую модель.`;
 }else if(/rate[_-]?limit|too many requests|slow_down|(?:HTTP|status(?:_code)?|statusCode)[\s"':=]*429\b/i.test(text)){
  code='GENERATION_RATE_LIMIT';message=`${name} временно ограничил частоту запросов. Повторите позже. Это не подтверждает исчерпание квоты подписки.`;
 }else if(/authentication_error|unauthorized|login_required|not logged in|please (?:log|sign) in|reauthenticat|invalid[_ -](?:api[_ -]key|access[_ -]token|token)|token.{0,15}expired|(?:log|sign)[ -]?in.{0,20}(?:required|again)|(?:HTTP|status(?:_code)?|statusCode)[\s"':=]*401\b/i.test(text)){
  code='GENERATION_AUTH';message=`Нужно обновить вход в ${name}.`;
 }else if(/permission_denied|access_denied|model_not_found|not authorized|(?:HTTP|status(?:_code)?|statusCode)[\s"':=]*403\b/i.test(text)){
  code='GENERATION_ACCESS';message=`${name} не разрешил этот запрос. Проверьте доступ к выбранной модели.`;
 }else if(/selected model is at capacity|model.{0,25}(?:at|over) capacity|server_is_overloaded|server_overloaded|overloaded|service_unavailable|internal_server_error|(?:HTTP|status(?:_code)?|statusCode)[\s"':=]*50[0234]\b/i.test(text)){
  code='GENERATION_SERVICE';message=/model.{0,25}(?:at|over) capacity/i.test(text)?`Выбранная модель ${name} сейчас перегружена. Выберите другую модель или повторите позже. Это не означает исчерпание лимитов подписки.`:`${name} временно недоступен. Повторите позже.`;
 }else if(/stream.{0,35}(?:disconnected|closed|error|failed)|connection|network|dns|timed? ?out|ECONN|ENOTFOUND|retry limit|retry budget|max(?:imum)? retries/i.test(text)){
  code='GENERATION_CONNECTION';message=`Соединение с ${name} прервалось до получения готового материала. Повторите генерацию.`;
 }
 return Object.assign(Error(message),{code,...(providerCode?{providerCode}:{})});
}
export function generationFailure(input,provider){return generationError(input,provider).message;}

// Each pass gets a fresh, tool-free process and the same captured model settings.
export function runModel({job,prompt,schemaPath,schema,settings,desktop,codex,claude,cwd,env,timeoutMs=480000}){
 return new Promise((resolve,reject)=>{
  if(job.status!=='running'){reject(Error('Генерация остановлена'));return;}
  const {provider,model,reasoning_effort}=settings,name=GENERATION_PROVIDERS[provider].name;
  const args=provider==='anthropic'
   ?['-p','--model',model,'--effort',reasoning_effort,'--bare','--restricted','--tools','','--disallowedTools','mcp__*','--permission-mode','dontAsk','--permission-prompts','none','--no-session-persistence','--no-chrome','--max-turns','1','--output-format','json','--json-schema',JSON.stringify(schema)]
   :['exec',...(desktop?['-c','cli_auth_credentials_store="file"']:[]),'--model',model,'-c',`model_reasoning_effort="${reasoning_effort}"`,'--ignore-user-config','--skip-git-repo-check','--ephemeral','--sandbox','read-only','-c','approval_policy="never"','-c','forced_login_method="chatgpt"','-c','project_doc_max_bytes=0','-c','web_search="disabled"','-c','features.shell_tool=false','-c','features.apps=false','-c','features.plugins=false','--color','never','--json','--output-schema',schemaPath,'-'];
  const child=spawn(provider==='anthropic'?claude:codex,args,{cwd,env,stdio:['pipe','pipe','pipe']});job.child=child;
  let buffer='',last='',errorText='',size=0,usage,transportError,failure;
  const terminate=message=>{transportError=Error(message);child.kill('SIGTERM');setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL');},1500).unref();};
  const timer=setTimeout(()=>terminate('Один этап генерации занял больше 8 минут. Повторите запрос.'),timeoutMs);
  child.stdin.on('error',()=>{});
  child.on('error',()=>{clearTimeout(timer);transportError=Error(`Не удалось запустить ${name}. Проверьте установку приложения.`);});
  child.stderr.on('data',c=>{errorText=(errorText+c.toString()).slice(-12000);});
  child.stdout.on('data',c=>{
   size+=c.length;if(size>2_000_000){terminate(`Слишком большой ответ ${name}`);return;}
   buffer+=c.toString();if(provider==='anthropic')return;
   let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);try{const e=JSON.parse(line);if(e.type==='item.completed'&&e.item?.type==='agent_message')last=e.item.text;if(e.type==='turn.completed'){usage=e.usage;failure=null;}if(e.type==='turn.failed'||e.type==='error')failure=e.error||e.message||{};}catch{}}
  });
  child.on('close',code=>{
   clearTimeout(timer);if(job.child===child)job.child=null;
   try{
    if(job.status!=='running')throw Error('Генерация остановлена');
    if(transportError)throw transportError;
    if(code!==0||failure)throw generationError(failure||errorText||buffer,provider);
    if(provider==='anthropic'){const response=JSON.parse(buffer.trim());if(response.is_error)throw generationError(response.error||response.result||buffer,provider);last=response.structured_output?JSON.stringify(response.structured_output):response.result;usage=response.usage||response.modelUsage||null;}
    if(!last)throw generationError(errorText,provider);
    resolve({text:last,usage});
   }catch(e){reject(e instanceof SyntaxError?Error(`${name} вернул ответ в неожиданном формате. Повторите генерацию.`):e);}
  });
  child.stdin.end(prompt);
 });
}
