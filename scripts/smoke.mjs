import {mkdir,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import {execute} from '../server/process.mjs';
import {wavDuration} from '../server/media.mjs';
import {runtimeStatus,invoke} from '../server/runtimes.mjs';
const folder=path.resolve('.data/verification');await mkdir(folder,{recursive:true});
if(process.argv.includes('--local')){
  console.log('FFmpeg',await stat(ffmpeg).then(info=>info.size));
  const result=await execute('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('scripts/speech.ps1')],{input:JSON.stringify({text:'Bienvenidos a Lumen. DHCP asigna direcciones de red automáticamente.',output:path.join(folder,'voice.wav')}),timeout:30000});
  console.log('Voz',result);if(result.code!==0)process.exitCode=1;
  else{const {readFile}=await import('node:fs/promises');console.log('Duración WAV',wavDuration(await readFile(path.join(folder,'voice.wav'))));}
  console.log('Sesiones',await runtimeStatus());
}
if(process.argv.includes('--agents')){
  for(const runtime of ['codex','claude']){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000);
    try{
      const result=await invoke({kind:'research',project:{id:'verification',prompt:'Resume en una frase el texto aportado sobre DHCP; usa únicamente la fuente local.',duration:30,style:'editorial',runtime,architecture:'single',desktop:false},task:{role:'investigador',instruction:'Sin llamadas a herramientas. Una fuente, un único concepto.'},context:{sources:[{name:'Apuntes',content:'DHCP permite asignar automáticamente una dirección IP a un cliente en una red. Identificador de fuente: apuntes.'}],artifacts:{},feedback:null},attemptDir:path.join(folder,runtime),signal:controller.signal});
      console.log(runtime,JSON.stringify(result));await writeFile(path.join(folder,`${runtime}-smoke.json`),JSON.stringify(result,null,2));
    }catch(error){console.log(runtime,error.message);process.exitCode=1;}finally{clearTimeout(timer);}
  }
}
