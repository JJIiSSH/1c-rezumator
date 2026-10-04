import {spawn} from 'node:child_process';
import {GENERATION_PROVIDERS} from './model-settings.mjs';

export function generationFailure(text,provider){
 const name=GENERATION_PROVIDERS[provider].name;
 if(/limit|quota|usage|429/i.test(text))return `Достигнут лимит ${name}. Дождитесь его обновления и повторите.`;
 if(/auth|login|401|403|token/i.test(text))return `Нужно обновить вход в ${name}.`;
 if(/connect|network|dns|timed? ?out|stream/i.test(text))return `Не удалось связаться с ${name}. Проверьте интернет и повторите.`;
 return `${name} не вернул готовый материал. Повторите генерацию.`;
}

// Each pass gets a fresh, tool-free process and the same captured model settings.
export function runModel({job,prompt,schemaPath,schema,settings,desktop,codex,claude,cwd,env,timeoutMs=480000}){
 return new Promise((resolve,reject)=>{
  if(job.status!=='running'){reject(Error('Генерация остановлена'));return;}
  const {provider,model,reasoning_effort}=settings,name=GENERATION_PROVIDERS[provider].name;
  const args=provider==='anthropic'
   ?['-p','--model',model,'--effort',reasoning_effort,'--bare','--restricted','--tools','','--disallowedTools','mcp__*','--permission-mode','dontAsk','--permission-prompts','none','--no-session-persistence','--no-chrome','--max-turns','1','--output-format','json','--json-schema',JSON.stringify(schema)]
   :['exec',...(desktop?['-c','cli_auth_credentials_store="file"']:[]),'--model',model,'-c',`model_reasoning_effort="${reasoning_effort}"`,'--ignore-user-config','--skip-git-repo-check','--ephemeral','--sandbox','read-only','-c','approval_policy="never"','-c','forced_login_method="chatgpt"','-c','project_doc_max_bytes=0','-c','web_search="disabled"','-c','features.shell_tool=false','-c','features.apps=false','-c','features.plugins=false','--color','never','--json','--output-schema',schemaPath,'-'];
  const child=spawn(provider==='anthropic'?claude:codex,args,{cwd,env,stdio:['pipe','pipe','pipe']});job.child=child;
  let buffer='',last='',errorText='',size=0,usage,transportError;
  const terminate=message=>{transportError=Error(message);child.kill('SIGTERM');setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL');},1500).unref();};
  const timer=setTimeout(()=>terminate('Один этап генерации занял больше 8 минут. Повторите запрос.'),timeoutMs);
  child.stdin.on('error',()=>{});
  child.on('error',()=>{clearTimeout(timer);transportError=Error(`Не удалось запустить ${name}. Проверьте установку приложения.`);});
  child.stderr.on('data',c=>{errorText=(errorText+c.toString()).slice(-12000);});
  child.stdout.on('data',c=>{
   size+=c.length;if(size>2_000_000){terminate(`Слишком большой ответ ${name}`);return;}
   buffer+=c.toString();if(provider==='anthropic')return;
   let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);try{const e=JSON.parse(line);if(e.type==='item.completed'&&e.item?.type==='agent_message')last=e.item.text;if(e.type==='turn.completed')usage=e.usage;if(e.type==='turn.failed'||e.type==='error')errorText+=JSON.stringify(e.error||e.message||'');}catch{}}
  });
  child.on('close',code=>{
   clearTimeout(timer);if(job.child===child)job.child=null;
   try{
    if(job.status!=='running')throw Error('Генерация остановлена');
    if(transportError)throw transportError;
    if(code!==0)throw Error(generationFailure(errorText||buffer,provider));
    if(provider==='anthropic'){const response=JSON.parse(buffer.trim());if(response.is_error)throw Error(generationFailure(response.result||buffer,provider));last=response.structured_output?JSON.stringify(response.structured_output):response.result;usage=response.usage||response.modelUsage||null;}
    if(!last)throw Error(generationFailure(errorText,provider));
    resolve({text:last,usage});
   }catch(e){reject(e instanceof SyntaxError?Error(`${name} вернул ответ в неожиданном формате. Повторите генерацию.`):e);}
  });
  child.stdin.end(prompt);
 });
}
