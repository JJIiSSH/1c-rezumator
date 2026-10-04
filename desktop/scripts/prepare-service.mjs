import {mkdir,readFile,writeFile,cp,rm,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const local=path.join(desktop,'../local'),service=path.join(desktop,'stage/service');
// An allowlist is deliberate: .data, seed.json, backups and credentials cannot leak.
const files=['server.mjs','runtime-paths.mjs','engine.mjs','legend-plan.mjs','legend-format.mjs','legend-content.mjs','legend-map.mjs','legend-map-export.mjs','material-workflow.mjs','resume-chronology.mjs','model-runner.mjs','batch-operations.mjs','state-sync.mjs','model-settings.mjs','account-client.mjs','claude-client.mjs','desktop-settings.mjs','connection-wizard.mjs','notion-client.mjs','notion-export.mjs','drive-client.mjs','drive-import.mjs','schema.json','legend-schema.json','legend-plan-schema.json','public','prompts'];
await rm(service,{recursive:true,force:true});await mkdir(service,{recursive:true});
for(const file of files)await cp(path.join(local,file),path.join(service,file),{recursive:true});
await writeFile(path.join(service,'seed.json'),'[]\n');
const replacements={
 'drive-import.mjs':[[/export const sheetId='[^']+';/,"export const sheetId=process.env.REZUMATOR_SHEET_ID||'';"]],
 'notion-export.mjs':[[/export const notionWorkspace=\{[^\n]+\};/,"export const notionWorkspace={id:process.env.REZUMATOR_NOTION_WORKSPACE_ID||'',name:'Ваше пространство Notion'};"]],
 'notion-client.mjs':[[/Ожидается Ваше пространство Notion\./g,'Проверьте ID пространства в настройках подключений.']],
 'public/app.js':[[/Ваше пространство Notion/g,'Ваше пространство Notion']],
 'server.mjs':[[/\(existsSync\('\/Applications\/ChatGPT\.app\/Contents\/Resources\/codex'\)[^;]+;/,"'codex';"],[/\(existsSync\('\/Users\/a111\/[^;]+;/,"'python3';"]]
};
for(const [file,edits]of Object.entries(replacements)){const p=path.join(service,file);let text=await readFile(p,'utf8');for(const [from,to]of edits)text=text.replace(from,to);await writeFile(p,text);}
await writeFile(path.join(service,'desktop-bootstrap.mjs'),`import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {parseConnections} from './desktop-settings.mjs';
let settings={};try{settings=JSON.parse(await readFile(path.join(process.env.REZUMATOR_DATA_DIR,'connections.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const connections=parseConnections(settings);
process.env.REZUMATOR_SHEET_ID=connections.sheetId;
process.env.REZUMATOR_NOTION_WORKSPACE_ID=connections.notionWorkspaceId;
await import('./server.mjs');
`);
const vendor=path.join(desktop,'node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin');
await access(path.join(vendor,'bin/codex'));
await cp(vendor,path.join(desktop,'stage/runtime/codex'),{recursive:true});
const claude=path.join(desktop,'node_modules/@anthropic-ai/claude-code-darwin-arm64/claude');
await access(claude);await rm(path.join(desktop,'stage/runtime/claude'),{recursive:true,force:true});await mkdir(path.join(desktop,'stage/runtime/claude'),{recursive:true});
await cp(claude,path.join(desktop,'stage/runtime/claude/claude'));
await cp(path.join(desktop,'node_modules/@anthropic-ai/claude-code/LICENSE.md'),path.join(desktop,'stage/runtime/CLAUDE-CODE-LICENSE.md'));
await cp(path.join(desktop,'assets/fonts/LICENSE_DEJAVU'),path.join(desktop,'stage/runtime/LICENSE_DEJAVU'));
await cp(path.join(desktop,'assets/CODEX-LICENSE'),path.join(desktop,'stage/runtime/CODEX-LICENSE'));
await access(path.join(desktop,'stage/runtime/pdf/rezumator-pdf'));
console.log('Подготовлена чистая сборка с правилами, Codex, Claude Code и PDF-модулем.');
