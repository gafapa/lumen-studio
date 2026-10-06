import {packager} from '@electron/packager';
import {readFile,mkdir,copyFile,cp,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('.'),nodeFolder=(await readFile('.tools/node-path.txt','utf8')).trim(),releaseFolder=path.resolve(root,'releases');
if(!releaseFolder.startsWith(root+path.sep)||!path.resolve(releaseFolder,'Lumen Studio-win32-x64').startsWith(releaseFolder+path.sep))throw new Error('Ruta de empaquetado inválida.');
const outputs=await packager({dir:root,name:'Lumen Studio',platform:'win32',arch:'x64',electronVersion:'44.5.1',out:releaseFolder,overwrite:true,asar:false,prune:true,ignore:[/^\/(\.data|\.tools|releases|test|test-results|playwright-report)(\/|$)/,/^\/\.env$/, /^\/(iniciar.ps1|playwright.config.mjs|package-lock.json)$/],afterPrune:[async ({buildPath:appPath})=>{
  const tools=path.join(appPath,'vendor/tools');await mkdir(tools,{recursive:true});await copyFile(path.join(nodeFolder,'node.exe'),path.join(appPath,'vendor/node.exe'));
  for(const name of ['whisper','ocr','audio','python'])try{await stat(path.join(root,'.tools',name));await cp(path.join(root,'.tools',name),path.join(tools,name),{recursive:true,filter:file=>!file.endsWith('.zip')});}catch(error){if(error.code!=='ENOENT')throw error;}
  try{const cli=(await readFile(path.join(root,'.tools/whisper/cli-path.txt'),'utf8')).trim();await writeFile(path.join(tools,'whisper/cli-path.txt'),path.relative(path.join(root,'.tools'),cli));}catch{}
  await cp(path.join(root,'node_modules/.remotion'),path.join(appPath,'node_modules/.remotion'),{recursive:true});
}]});console.log('Aplicación portátil: '+outputs[0]);
