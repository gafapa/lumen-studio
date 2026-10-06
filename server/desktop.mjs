import {spawn} from 'node:child_process';
import {mkdir,readFile,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ffmpeg from 'ffmpeg-static';
import {execute} from './process.mjs';
import {startLoopback,finishLoopback} from './loopback.mjs';
const script=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../scripts/desktop.ps1');
const inputScript=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../scripts/input-log.ps1');
import {writeFile} from 'node:fs/promises';
// Telemetría de la grabación (clics, movimiento y ráfagas de teclado, sin identificar teclas) para zooms automáticos.
function startInputLog(seconds){
  const log={screen:null,epoch:null,events:[],child:null,buffer:''};
  try{log.child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',inputScript,String(Math.ceil(seconds+30))],{windowsHide:true,stdio:['ignore','pipe','ignore']});}catch{return log;}
  log.child.on('error',()=>{});
  log.child.stdout.on('data',chunk=>{log.buffer+=chunk;let index;while((index=log.buffer.indexOf('\n'))>=0){const line=log.buffer.slice(0,index).trim();log.buffer=log.buffer.slice(index+1);try{const event=JSON.parse(line);if(event.type==='screen'){log.screen={x:event.x,y:event.y,width:event.width,height:event.height};log.epoch=event.epoch;}else if(log.events.length<20000)log.events.push(event);}catch{}}});
  return log;
}
async function finishInputLog(log,readyAt,output){
  if(!log?.child)return null;
  if(log.child.exitCode===null){spawn('taskkill',['/pid',String(log.child.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'});await new Promise(resolve=>{log.child.once('close',resolve);setTimeout(resolve,3000);});}
  if(!log.epoch)return null;const shift=(log.epoch-readyAt)/1000;
  const events=log.events.map(event=>({...event,t:Math.round((event.t+shift)*1000)/1000,...(event.end!=null?{end:Math.round((event.end+shift)*1000)/1000}:{})})).filter(event=>event.t>=0);
  await writeFile(output,JSON.stringify({version:1,screen:log.screen,privacy:'Sin identificación de teclas; título de ventana solo en clics.',events},null,1));return events.length;
}
export class Desktop {
  constructor(store){this.store=store;this.owner=null;this.recording=null;this.tokens=new Map();this.pending=Promise.resolve();}
  status(){return {supported:process.platform==='win32',owner:this.owner?.projectId||null,recording:this.recording?{id:this.recording.id,projectId:this.recording.projectId,startedAt:this.recording.startedAt}:null};}
  acquire(projectId,actor){if(this.owner&&(this.owner.actor!==actor||this.owner.projectId!==projectId))throw new Error('El escritorio está reservado por otra tarea.');this.owner={projectId,actor};}
  async release(projectId,actor){if(this.owner?.projectId===projectId&&this.owner.actor===actor){try{if(this.recording)await this.stop(projectId,actor);}finally{this.owner=null;}}}
  authorize(projectId,actor){const project=this.store.get(projectId);if(!project?.desktop)throw new Error('Activa el control del PC para este proyecto.');if(process.platform!=='win32')throw new Error('El control del PC requiere Windows.');if(actor!=='human'&&(!this.owner||this.owner.projectId!==projectId||this.owner.actor!==actor))throw new Error('La sesión del operador ya no tiene acceso al escritorio.');if(this.owner&&(this.owner.projectId!==projectId||this.owner.actor!==actor))throw new Error('Otro agente está utilizando el escritorio.');return project;}
  async action(projectId,actor,action,params={}){
    const operation=this.pending.catch(()=>{}).then(async()=>{
      this.authorize(projectId,actor);const acquired=!this.owner;this.acquire(projectId,actor);
      try{return await this.perform(projectId,actor,action,params);}finally{if(acquired&&!this.recording)await this.release(projectId,actor);}
    });this.pending=operation;return operation;
  }
  async perform(projectId,actor,action,params={}){
    this.authorize(projectId,actor);
    if(action==='start_recording')return this.start(projectId,actor,params);
    if(action==='stop_recording')return this.stop(projectId,actor);
    if(!['screenshot','click','type','key'].includes(action))throw new Error('Acción de escritorio desconocida.');
    if(action==='type'&&(typeof params.text!=='string'||params.text.length>2000))throw new Error('Texto inválido.');
    if(action==='click'&&(!Number.isInteger(params.x)||!Number.isInteger(params.y)))throw new Error('Coordenadas inválidas.');
    if(action==='key'&&(typeof params.key!=='string'||params.key.length>20))throw new Error('Tecla inválida.');
    const dir=path.join(this.store.root,'projects',projectId,'media');await mkdir(dir,{recursive:true});
    const output=path.join(dir,`screen-${randomUUID()}.png`);
    const response=await execute('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script],{input:JSON.stringify({action,output,text:params.text,x:params.x,y:params.y,key:params.key}),timeout:60000});
    if(response.code!==0)throw new Error(response.stderr.slice(-1200));
    this.store.event(projectId,'desktop.action',{actor,action,...(action==='click'?{x:params.x,y:params.y}:{}),message:action==='type'?'Texto introducido en la ventana activa.':`Escritorio: ${action}`});
    const data=JSON.parse(response.stdout.trim());
    if(action==='screenshot')return {...data,path:`media/${path.basename(output)}`,image:(await readFile(output)).toString('base64')};
    return data;
  }
  async start(projectId,actor,{seconds=120,systemAudio=false}={}) {
    if(this.recording)throw new Error('Ya hay una grabación activa.');this.acquire(projectId,actor);
    const duration=Math.min(300,Math.max(5,Number(seconds)||120));
    const id=`recording-${randomUUID()}`,dir=path.join(this.store.root,'projects',projectId,'media');await mkdir(dir,{recursive:true});
    const output=path.join(dir,`${id}.mp4`);
    if(typeof systemAudio!=='boolean')throw new Error('Opción de audio inválida.');const audio=systemAudio?await startLoopback(output,duration):null;
    const child=spawn(ffmpeg,['-y','-f','gdigrab','-framerate','15','-probesize','32','-analyzeduration','0','-i','desktop','-t',String(duration),'-vf','scale=trunc(iw/2)*2:trunc(ih/2)*2','-c:v','libx264','-threads','2','-preset','ultrafast','-crf','24','-pix_fmt','yuv420p','-movflags','+faststart','-progress','pipe:2','-nostats',output],{windowsHide:true,stdio:['pipe','ignore','pipe']});
    const recording={id,projectId,actor,child,output,audio,systemAudio,startedAt:new Date().toISOString(),stderr:'',done:false};
    let resolveReady,rejectReady;const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
    child.stderr.on('data',chunk=>{recording.stderr=(recording.stderr+chunk).slice(-5000);if(!recording.ready&&/frame=\s*[1-9]\d*/.test(recording.stderr)){recording.ready=true;resolveReady();}});
    child.stdin.on('error',()=>{});
    recording.completion=new Promise(resolve=>{child.on('error',error=>{recording.stderr=error.message;resolve(-1);});child.on('close',resolve);});
    this.recording=recording;
    // Persist naturally completed recordings as well as manually stopped ones.
    recording.completion.then(async code=>{recording.done=true;await this.finish(recording,code);if(!recording.ready)rejectReady(new Error(recording.stderr.slice(-1000)||'La grabación no ha producido fotogramas.'));}).catch(rejectReady);
    this.store.event(projectId,'recording.started',{recordingId:id,message:'Grabación del escritorio iniciada.'});
    const timer=setTimeout(()=>rejectReady(new Error('El grabador no ha iniciado la captura a tiempo.')),90000);
    try{await ready;}catch(error){await this.stop(projectId,actor).catch(()=>{});throw error;}finally{clearTimeout(timer);}
    recording.readyAt=Date.now();if(process.platform==='win32')recording.input=startInputLog(duration);
    return {id,startedAt:recording.startedAt,maxSeconds:duration};
  }
  finish(recording,code){
    if(recording.finishPromise)return recording.finishPromise;
    recording.finishPromise=this.persistRecording(recording,code);return recording.finishPromise;
  }
  async persistRecording(recording,code){
    if(recording.audio){try{await finishLoopback(recording.audio,recording.output,recording.startedAt);}catch(error){recording.stderr+='\n'+error.message;code=-1;}}
    let eventsPath=null;try{const file=recording.output.replace(/\.mp4$/,'.events.json');if(await finishInputLog(recording.input,recording.readyAt||Date.parse(recording.startedAt),file)!=null)eventsPath='media/'+path.basename(file);}catch{}
    const project=this.store.get(recording.projectId);
    let valid=false;try{valid=code===0&&(await stat(recording.output)).size>1000;}catch{}
    const time=[...recording.stderr.matchAll(/out_time_us=(\d+)/g)].at(-1)?.[1],frames=[...recording.stderr.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1];const durationSeconds=Math.max(Number(time||0)/1000000,Number(frames||0)/15)||null;
    if(project){project.recordings ||= [];project.recordings.push({id:recording.id,path:`media/${path.basename(recording.output)}`,durationSeconds,systemAudio:recording.systemAudio,createdAt:recording.startedAt,status:valid?'completed':'failed',error:valid?null:recording.stderr.slice(-700),eventsPath});this.store.save(project);if(valid)this.onRecording?.(project.id,recording.id);this.store.event(project.id,valid?'recording.completed':'recording.failed',{recordingId:recording.id,message:valid?'Grabación guardada.':recording.stderr.slice(-700)});}
    if(this.recording===recording)this.recording=null;
    if(this.owner?.actor===recording.actor&&recording.actor==='human')this.owner=null;
  }
  async stop(projectId,actor){
    const recording=this.recording;
    if(!recording){const latest=this.store.get(projectId)?.recordings?.at(-1);if(latest?.status==='completed')return {id:latest.id,path:latest.path,alreadyStopped:true};throw new Error(latest?.error||'No hay una grabación de este proyecto.');}
    if(recording.projectId!==projectId)throw new Error('No hay una grabación de este proyecto.');
    if(recording.actor!==actor&&actor!=='human')throw new Error('La grabación pertenece a otra tarea.');
    recording.child.stdin.write('q\n');
    const timer=setTimeout(()=>recording.child.kill(),8000);
    const code=await recording.completion;clearTimeout(timer);await this.finish(recording,code);
    if(code!==0)throw new Error(recording.stderr.slice(-1000));
    if(this.store.get(projectId)?.recordings.at(-1)?.status!=='completed')throw new Error('La grabación no contiene fotogramas válidos.');
    return {id:recording.id,path:`media/${path.basename(recording.output)}`};
  }
}
