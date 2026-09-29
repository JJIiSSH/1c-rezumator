import {existsSync} from 'node:fs';

export function codexExecutable(env=process.env,exists=existsSync){
 if(env.REZUMATOR_CODEX)return env.REZUMATOR_CODEX;
 return [
  '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
  '/Applications/ChatGPT.app/Contents/Resources/codex'
 ].find(exists)||'codex';
}
