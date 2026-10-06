// Índice local del material del usuario: metadatos, planos, miniaturas, silencios y transcripción
// palabra a palabra. Los agentes lo consultan en lugar de cargar vídeos completos.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile,rm,stat,readdir,copyFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {execute} from './process.mjs';
import {whisperPaths} from './audio-review.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hyperframesCli=path.join(root,'node_modules/hyperframes/bin/hyperframes.mjs');
export const FILLERS=new Set(['eh','ehh','eeh','ehm','em','emm','mm','mmm','hmm','um','uh','uhm','ah','aah','erm']);
const queues=new Map();

// Python portable instalado por scripts/setup-kokoro.ps1 (voz Kokoro de HyperFrames).
// python-path.txt solo marca que la instalación terminó; la ruta se resuelve relativa a .tools para que funcione también empaquetado.
export function kokoroPython(){const tools=process.env.LUMEN_TOOLS_DIR||path.join(root,'.tools'),python=path.join(tools,'python','python.exe');return existsSync(path.join(tools,'python','python-path.txt'))&&existsSync(python)?python:null;}
export function hyperframesEnv(){
  const chrome=path.join(root,'node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe');
  const python=kokoroPython();
  return {...process.env,...(python?{HYPERFRAMES_PYTHON:python}:{}),HYPERFRAMES_FFMPEG_PATH:ffmpeg,HYPERFRAMES_FFPROBE_PATH:ffprobe.path,HYPERFRAMES_BROWSER_PATH:chrome,HYPERFRAMES_NO_UPDATE_CHECK:'1',HYPERFRAMES_TELEMETRY_DISABLED:'1',DO_NOT_TRACK:'1',PRODUCER_LOW_MEMORY_MODE:'1'};
}
export function runHyperframes(args,options={}){return execute(process.execPath,[hyperframesCli,...args],{env:hyperframesEnv(),timeout:600000,...options});}

// Material indexable de un proyecto: recursos importados o derivados y grabaciones terminadas.
export function mediaItems(project){
  return [
    ...(project.assets||[]).filter(asset=>['image','video','music','voice'].includes(asset.kind)).map(asset=>({id:asset.id,kind:asset.kind,path:asset.path,name:asset.name||path.basename(asset.path),origin:asset.derivedFrom?'derived':'asset',derivedFrom:asset.derivedFrom||null,scope:asset.scope||'video'})),
    ...(project.recordings||[]).filter(recording=>recording.status==='completed').map(recording=>({id:recording.id,kind:'video',path:recording.path,name:'Grabación '+new Date(recording.createdAt).toLocaleString('es'),origin:'recording',events:recording.eventsPath||null})),
  ];
}
export function findMedia(project,mediaId){const item=mediaItems(project).find(entry=>entry.id===mediaId);if(!item)throw new Error('Material inexistente: '+mediaId);return item;}
function inside(folder,file){const absolute=path.resolve(folder,file),relative=path.relative(path.resolve(folder),absolute);if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('El material debe pertenecer al proyecto.');return absolute;}
const round=value=>Math.round(value*1000)/1000;

export async function probeMedia(file,signal){
  const result=await execute(ffprobe.path,['-v','error','-show_entries','format=duration:stream=codec_type,width,height,avg_frame_rate','-of','json',file],{signal,timeout:60000});
  if(result.code!==0)throw new Error('No se puede leer el archivo multimedia.');
  const data=JSON.parse(result.stdout),video=data.streams?.find(stream=>stream.codec_type==='video'),audio=data.streams?.some(stream=>stream.codec_type==='audio');
  const [num,den]=String(video?.avg_frame_rate||'0/1').split('/').map(Number);
  return {duration:Number(data.format?.duration)||null,width:video?.width||null,height:video?.height||null,fps:den?Math.round(num/den*100)/100:null,hasVideo:Boolean(video),hasAudio:Boolean(audio)};
}

export async function detectShots(file,duration,signal,threshold=0.32){
  const result=await execute(ffmpeg,['-hide_banner','-i',file,'-an','-vf',`scale=320:-2,select='gt(scene,${threshold})',showinfo`,'-f','null','-'],{signal,timeout:1800000});
  const cuts=[...result.stderr.matchAll(/pts_time:([\d.]+)/g)].map(match=>Number(match[1])).filter(time=>time>0.05&&time<duration-0.05);
  const shots=[];let start=0;
  for(const cut of cuts){if(cut-start>=0.8){shots.push({start:round(start),end:round(cut)});start=cut;}}
  shots.push({start:round(start),end:round(duration)});
  return shots;
}

export async function detectSilences(file,signal,noise='-35dB',minimum=0.4){
  const result=await execute(ffmpeg,['-hide_banner','-i',file,'-vn','-af',`silencedetect=noise=${noise}:d=${minimum}`,'-f','null','-'],{signal,timeout:1800000});
  const starts=[...result.stderr.matchAll(/silence_start: ([\d.]+)/g)].map(match=>Number(match[1])),ends=[...result.stderr.matchAll(/silence_end: ([\d.]+)/g)].map(match=>Number(match[1]));
  return starts.map((start,index)=>({start:round(start),end:round(ends[index]??start)}));
}

// whisper.cpp con segmentos de una palabra (-ml 1 -sow) para obtener tiempos por palabra.
export async function transcribeWords(file,directory,signal,language=process.env.LUMEN_WHISPER_LANG||'auto'){
  const config=await whisperPaths();if(!config.ready)return null;
  const wav=path.join(directory,'audio.wav');
  const decoded=await execute(ffmpeg,['-y','-v','error','-i',file,'-vn','-ar','16000','-ac','1','-c:a','pcm_s16le',wav],{signal,timeout:1800000});
  if(decoded.code!==0)throw new Error('No se pudo extraer el audio para transcribir.');
  const output=path.join(directory,'whisper');
  const result=await execute(config.executable,['-m',config.model,'-f',wav,'-l',language,'-ml','1','-sow','-ojf','-of',output,'-t','4'],{signal,timeout:3600000});
  await rm(wav,{force:true});
  if(result.code!==0)throw new Error('Whisper no pudo transcribir: '+result.stderr.slice(-600));
  const json=JSON.parse(await readFile(output+'.json','utf8'));
  const words=(json.transcription||[]).map(segment=>({text:segment.text.trim(),start:round((segment.offsets?.from||0)/1000),end:round((segment.offsets?.to||0)/1000)})).filter(word=>word.text&&!/^\[.*\]$/.test(word.text));
  for(const word of words){const bare=word.text.toLocaleLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^\p{L}]/gu,'');if(FILLERS.has(bare))word.filler=true;}
  return {words,language:json.result?.language||language,engine:'whisper.cpp',model:path.basename(config.model)};
}

// Agrupa palabras en frases por puntuación o pausas, para búsquedas y lectura.
export function sentences(words,gap=0.7){
  const result=[];let current=null;
  for(const word of words){
    if(current&&(word.start-current.end>gap||/[.!?…]$/.test(current.text)))current=null;
    if(!current){current={start:word.start,end:word.end,text:word.text};result.push(current);}else{current.end=word.end;current.text+=' '+word.text;}
  }
  return result;
}

async function thumbnails(file,shots,directory,signal,limit=36){
  const step=Math.max(1,Math.ceil(shots.length/limit)),picked=shots.filter((_,index)=>index%step===0).slice(0,limit);
  let index=0;
  for(const shot of picked){
    index++;const name=`thumb-${String(index).padStart(3,'0')}.jpg`,time=(shot.start+shot.end)/2;
    const result=await execute(ffmpeg,['-y','-v','error','-ss',String(time),'-i',file,'-frames:v','1','-vf','scale=480:-2','-q:v','4',path.join(directory,name)],{signal,timeout:60000});
    if(result.code===0)shot.thumb=name;
  }
  const count=picked.filter(shot=>shot.thumb).length;let sheet=null;
  if(count){
    const columns=Math.min(6,count),rows=Math.ceil(count/columns);
    const result=await execute(ffmpeg,['-y','-v','error','-start_number','1','-i',path.join(directory,'thumb-%03d.jpg'),'-frames:v','1','-vf',`scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2:color=0x101218,tile=${columns}x${rows}:padding=4:color=0x101218`,'-q:v','4',path.join(directory,'sheet.jpg')],{signal,timeout:60000});
    if(result.code===0)sheet='sheet.jpg';
  }
  return {sheet,sheetShots:picked.filter(shot=>shot.thumb).map(shot=>({start:shot.start,end:shot.end,thumb:shot.thumb}))};
}

async function recordingEvents(folder,item){
  if(!item.events)return null;
  try{const data=JSON.parse(await readFile(inside(folder,item.events),'utf8'));return summarizeEvents(data);}catch{return null;}
}
// Resume la telemetría de una grabación: clics y propuestas de zoom agrupando clics cercanos.
export function summarizeEvents(data){
  const clicks=(data.events||[]).filter(event=>event.type==='click').map(event=>({time:event.t,x:event.x,y:event.y,button:event.button||'left',window:event.window||null}));
  const keys=(data.events||[]).filter(event=>event.type==='keys');
  const zooms=[];
  for(const click of clicks){
    const last=zooms.at(-1);
    if(last&&click.time-last.end<2.5&&Math.hypot(click.x-last.x,click.y-last.y)<0.25){last.end=click.time+1.2;last.x=(last.x+click.x)/2;last.y=(last.y+click.y)/2;last.clicks++;}
    else zooms.push({start:Math.max(0,click.time-0.6),end:click.time+1.2,x:click.x,y:click.y,clicks:1});
  }
  const idle=[];const activity=[...clicks.map(click=>click.time),...keys.map(key=>key.t),...(data.events||[]).filter(event=>event.type==='move').map(event=>event.t)].sort((a,b)=>a-b);
  for(let i=1;i<activity.length;i++)if(activity[i]-activity[i-1]>3)idle.push({start:round(activity[i-1]+0.5),end:round(activity[i]-0.3)});
  return {screen:data.screen||null,clicks,typing:keys.map(key=>({start:key.t,end:key.end??key.t,count:key.count||1})),zooms:zooms.map(zoom=>({...zoom,start:round(zoom.start),end:round(zoom.end),x:round(zoom.x),y:round(zoom.y)})),idle,coordinates:'x,y normalizados 0–1 sobre la pantalla grabada.'};
}

export function indexDirectory(folder,mediaId){return path.join(folder,'index',mediaId.replace(/[^a-zA-Z0-9-]/g,'_'));}

export async function buildIndex(folder,item,signal,{transcribe=true}={}){
  const file=inside(folder,item.path),directory=indexDirectory(folder,item.id);
  await rm(directory,{recursive:true,force:true});await mkdir(directory,{recursive:true});
  const info=await stat(file),probe=await probeMedia(file,signal);
  const index={mediaId:item.id,kind:item.kind,name:item.name,path:item.path,size:info.size,...probe,shots:[],sheet:null,sheetShots:[],silences:[],transcript:null,events:null,descriptions:{},indexedAt:null};
  if(probe.hasVideo&&probe.duration&&item.kind!=='image'){
    index.shots=await detectShots(file,probe.duration,signal);
    Object.assign(index,await thumbnails(file,index.shots,directory,signal));
  }else if(item.kind==='image'){
    const result=await execute(ffmpeg,['-y','-v','error','-i',file,'-vf','scale=480:-2','-q:v','4',path.join(directory,'thumb-001.jpg')],{signal,timeout:60000});
    index.shots=[{start:0,end:0}];if(result.code===0){index.sheet='thumb-001.jpg';index.sheetShots=[{start:0,end:0,thumb:'thumb-001.jpg'}];}
  }
  if(probe.hasAudio&&probe.duration){
    index.silences=await detectSilences(file,signal);
    if(transcribe){const transcript=await transcribeWords(file,directory,signal);if(transcript){await writeFile(path.join(directory,'words.json'),JSON.stringify(transcript.words));index.transcript={language:transcript.language,engine:transcript.engine,model:transcript.model,words:transcript.words.length,fillers:transcript.words.filter(word=>word.filler).length,text:sentences(transcript.words).map(sentence=>sentence.text).join(' ').slice(0,4000)};}}
  }
  index.events=await recordingEvents(folder,item);
  index.indexedAt=new Date().toISOString();
  await writeFile(path.join(directory,'index.json'),JSON.stringify(index,null,2));
  return index;
}

// Cola por proyecto: indexar no bloquea la interfaz y no lanza varios Whisper a la vez.
export function queueIndex(store,projectId,folder,mediaId,onDone=()=>{}){
  const project=store.get(projectId);if(!project)return;
  const item=findMedia(project,mediaId);
  project.mediaIndex||={};project.mediaIndex[mediaId]={...(project.mediaIndex[mediaId]||{}),status:'queued',error:null};store.save(project);
  const previous=queues.get(projectId)||Promise.resolve();
  const operation=previous.catch(()=>{}).then(async()=>{
    const current=store.get(projectId);if(!current)return;current.mediaIndex||={};current.mediaIndex[mediaId]={...current.mediaIndex[mediaId],status:'running'};store.save(current);
    try{
      const index=await buildIndex(folder,item,AbortSignal.timeout(3*3600000));
      const latest=store.get(projectId);latest.mediaIndex||={};latest.mediaIndex[mediaId]={status:'ready',error:null,...compactIndex(index)};store.save(latest);store.event(projectId,'media.indexed',{mediaId,message:'Material indexado: '+item.name});
    }catch(error){const latest=store.get(projectId);if(latest){latest.mediaIndex||={};latest.mediaIndex[mediaId]={status:'failed',error:error.message};store.save(latest);store.event(projectId,'media.index-failed',{mediaId,message:error.message});}}
    onDone();
  });
  queues.set(projectId,operation);return operation;
}
export function compactIndex(index){return {kind:index.kind,name:index.name,duration:index.duration,width:index.width,height:index.height,fps:index.fps,hasAudio:index.hasAudio,hasVideo:index.hasVideo,shots:index.shots.length,sheet:index.sheet,transcript:index.transcript?{words:index.transcript.words,fillers:index.transcript.fillers,language:index.transcript.language,text:index.transcript.text.slice(0,600)}:null,events:index.events?{clicks:index.events.clicks.length,zooms:index.events.zooms.length}:null,indexedAt:index.indexedAt};}

export async function readIndex(folder,mediaId){try{return JSON.parse(await readFile(path.join(indexDirectory(folder,mediaId),'index.json'),'utf8'));}catch{return null;}}
export async function readWords(folder,mediaId){try{return JSON.parse(await readFile(path.join(indexDirectory(folder,mediaId),'words.json'),'utf8'));}catch{return [];}}

// Información de un material para un agente: metadatos, planos, transcripción por frases (opcionalmente acotada) y telemetría.
export async function mediaInfo(project,folder,mediaId,{from=0,to=Infinity}={}){
  const item=findMedia(project,mediaId),index=await readIndex(folder,mediaId);
  if(!index)return {...item,indexed:false,status:project.mediaIndex?.[mediaId]?.status||'pending',hint:'Usa media_index para indexarlo antes de buscar en él.'};
  const words=(await readWords(folder,mediaId)).filter(word=>word.end>=from&&word.start<=to);
  return {...item,indexed:true,duration:index.duration,width:index.width,height:index.height,fps:index.fps,hasAudio:index.hasAudio,shots:index.shots.map((shot,i)=>({index:i,...shot,description:index.descriptions?.[i]||null})).filter(shot=>shot.end>=from&&shot.start<=to),contactSheet:index.sheet?path.join(indexDirectory(folder,mediaId),index.sheet):null,contactSheetShots:index.sheetShots,silences:index.silences.filter(silence=>silence.end>=from&&silence.start<=to),sentences:sentences(words),fillers:words.filter(word=>word.filler).map(({text,start,end})=>({text,start,end})),events:index.events};
}

const normalize=value=>String(value||'').toLocaleLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
// Búsqueda léxica sobre nombre, frases transcritas y descripciones visuales que hayan guardado los agentes.
export async function searchMedia(project,folder,query,limit=20){
  const terms=normalize(query).match(/[\p{L}\p{N}]{2,}/gu)||[];if(!terms.length)return [];
  const hits=[];
  for(const item of mediaItems(project)){
    const index=await readIndex(folder,item.id);
    const nameScore=terms.filter(term=>normalize(item.name).includes(term)).length;
    if(nameScore)hits.push({mediaId:item.id,name:item.name,kind:item.kind,match:'name',score:nameScore,start:0,end:index?.duration||null,text:item.name});
    if(!index)continue;
    for(const sentence of sentences(await readWords(folder,item.id))){const text=normalize(sentence.text),score=terms.filter(term=>text.includes(term)).length;if(score)hits.push({mediaId:item.id,name:item.name,kind:item.kind,match:'speech',score:score+0.5,start:sentence.start,end:sentence.end,text:sentence.text});}
    for(const [shotIndex,description] of Object.entries(index.descriptions||{})){const score=terms.filter(term=>normalize(description).includes(term)).length;const shot=index.shots[Number(shotIndex)];if(score&&shot)hits.push({mediaId:item.id,name:item.name,kind:item.kind,match:'visual',score:score+0.25,start:shot.start,end:shot.end,text:description});}
  }
  return hits.sort((a,b)=>b.score-a.score).slice(0,limit);
}

// Descripciones visuales por plano que un agente escribe tras mirar la hoja de contactos; alimentan la búsqueda.
export async function describeShots(folder,mediaId,descriptions){
  const index=await readIndex(folder,mediaId);if(!index)throw new Error('Indexa el material antes de describirlo.');if(index.kind==='image'&&!index.shots?.length)index.shots=[{start:0,end:0}];
  for(const item of descriptions.slice(0,200)){if(!Number.isInteger(item.shot)||!index.shots[item.shot]||typeof item.description!=='string')continue;index.descriptions[item.shot]=item.description.slice(0,400);}
  await writeFile(path.join(indexDirectory(folder,mediaId),'index.json'),JSON.stringify(index,null,2));return {mediaId,described:Object.keys(index.descriptions).length};
}

export async function mediaFrames(project,folder,mediaId,times){
  const item=findMedia(project,mediaId),file=inside(folder,item.path),directory=path.join(indexDirectory(folder,mediaId),'frames');await mkdir(directory,{recursive:true});
  const frames=[];
  for(const time of times.slice(0,8)){
    if(!Number.isFinite(time)||time<0)continue;const name=`frame-${Math.round(time*1000)}.jpg`,output=path.join(directory,name);
    try{await stat(output);}catch{const result=await execute(ffmpeg,['-y','-v','error','-ss',String(time),'-i',file,'-frames:v','1','-vf','scale=960:-2','-q:v','3',output],{timeout:60000});if(result.code!==0)continue;}
    frames.push({time,path:output});
  }
  return frames;
}

// Rangos que conservar al quitar silencios largos y muletillas a partir de la transcripción.
export function speechRanges(words,{minSilence=0.45,removeFillers=true,padding=0.12,duration=Infinity}={}){
  const ranges=[];let split=false;
  for(const word of words){
    if(removeFillers&&word.filler){split=true;continue;}
    const last=ranges.at(-1);if(last&&!split&&word.start-last.end<minSilence)last.end=word.end;else ranges.push({start:word.start,end:word.end});split=false;
  }
  return ranges.map(range=>({start:round(Math.max(0,range.start-padding)),end:round(Math.min(duration,range.end+padding))})).filter(range=>range.end-range.start>0.15).reduce((merged,range)=>{const last=merged.at(-1);if(last&&range.start<=last.end)last.end=Math.max(last.end,range.end);else merged.push({...range});return merged;},[]);
}
export function remapWords(words,ranges,{removeFillers=true}={}){
  const result=[];let offset=0;
  for(const range of ranges){for(const word of words)if(word.start>=range.start&&word.end<=range.end+0.01&&!(removeFillers&&word.filler))result.push({...word,start:round(word.start-range.start+offset),end:round(word.end-range.start+offset)});offset+=range.end-range.start;}
  return result;
}

function newAsset(project,source,file,kind,extra){const asset={id:randomUUID(),name:extra.name,path:file,kind,size:extra.size,createdAt:new Date().toISOString(),origin:'derived',derivedFrom:source.id,operation:extra.operation};project.assets||=[];project.assets.push(asset);return asset;}

// Corte limpio: une los tramos con voz, con fundidos de audio de 30 ms en cada unión.
export async function cleanCut(store,projectId,folder,mediaId,options={},signal=AbortSignal.timeout(1800000)){
  const project=store.get(projectId),item=findMedia(project,mediaId),index=await readIndex(folder,mediaId);
  if(!index?.transcript)throw new Error('El corte limpio necesita el material indexado y transcrito.');
  const words=await readWords(folder,mediaId),ranges=speechRanges(words,{...options,duration:index.duration});if(!ranges.length)throw new Error('No se ha reconocido voz que conservar.');
  const removed=index.duration-ranges.reduce((sum,range)=>sum+range.end-range.start,0);
  const video=index.hasVideo&&item.kind!=='image',extension=video?'.mp4':'.wav',file=`media/cut-${createHash('sha256').update(JSON.stringify([mediaId,ranges])).digest('hex').slice(0,16)}${extension}`;
  const filters=ranges.map((range,i)=>{const length=range.end-range.start,fade=Math.min(0.03,length/4);return `${video?`[0:v]trim=${range.start}:${range.end},setpts=PTS-STARTPTS[v${i}];`:''}[0:a]atrim=${range.start}:${range.end},asetpts=PTS-STARTPTS,afade=t=in:d=${fade},afade=t=out:st=${Math.max(0,length-fade)}:d=${fade}[a${i}]`;});
  const concat=ranges.map((_,i)=>`${video?`[v${i}]`:''}[a${i}]`).join('')+`concat=n=${ranges.length}:v=${video?1:0}:a=1${video?'[v]':''}[a]`;
  const result=await execute(ffmpeg,['-y','-v','error','-i',inside(folder,item.path),'-filter_complex',filters.join(';')+';'+concat,...(video?['-map','[v]','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p']:[]),'-map','[a]',...(video?['-c:a','aac','-b:a','192k','-movflags','+faststart']:[]),path.join(folder,file)],{signal,timeout:3600000});
  if(result.code!==0)throw new Error('FFmpeg no pudo montar el corte limpio: '+result.stderr.slice(-600));
  const latest=store.get(projectId),asset=newAsset(latest,item,file,video?'video':item.kind==='music'?'music':'voice',{name:`${item.name} · corte limpio`,size:(await stat(path.join(folder,file))).size,operation:{type:'clean-cut',ranges,removedSeconds:round(removed),options}});
  store.save(latest);
  const derived=await buildIndex(folder,{id:asset.id,kind:asset.kind,path:file,name:asset.name},signal,{transcribe:false});
  derived.transcript={...index.transcript,remapped:true};const remapped=remapWords(words,ranges,options);derived.transcript.words=remapped.length;await writeFile(path.join(indexDirectory(folder,asset.id),'words.json'),JSON.stringify(remapped));await writeFile(path.join(indexDirectory(folder,asset.id),'index.json'),JSON.stringify(derived,null,2));
  const final=store.get(projectId);final.mediaIndex||={};final.mediaIndex[asset.id]={status:'ready',error:null,...compactIndex({...derived,transcript:{...derived.transcript,text:index.transcript.text}})};store.save(final);
  return {asset,ranges,removedSeconds:round(removed)};
}

export async function removeBackground(store,projectId,folder,mediaId,signal=AbortSignal.timeout(3*3600000)){
  const project=store.get(projectId),item=findMedia(project,mediaId);if(!['image','video'].includes(item.kind))throw new Error('Quitar el fondo requiere una imagen o un vídeo.');
  const image=item.kind==='image',file=`media/nobg-${createHash('sha256').update(item.id).digest('hex').slice(0,16)}${image?'.png':'.webm'}`;
  const result=await runHyperframes(['remove-background',inside(folder,item.path),'-o',path.join(folder,file),'--device','cpu','--json'],{signal,timeout:3*3600000});
  if(result.code!==0)throw new Error('No se pudo quitar el fondo: '+(result.stderr||result.stdout).slice(-600));
  const latest=store.get(projectId),asset=newAsset(latest,item,file,item.kind,{name:`${item.name} · sin fondo`,size:(await stat(path.join(folder,file))).size,operation:{type:'remove-background',alpha:true}});store.save(latest);return {asset};
}

// Detecta pulsos de una pista musical con el analizador de HyperFrames dentro de un proyecto temporal.
export async function detectBeats(project,folder,mediaId,signal=AbortSignal.timeout(600000)){
  const item=findMedia(project,mediaId);if(!['music','voice','video'].includes(item.kind))throw new Error('Los pulsos requieren audio.');
  const directory=path.join(indexDirectory(folder,mediaId),'beats-project');await rm(directory,{recursive:true,force:true});await mkdir(directory,{recursive:true});
  const name='music'+path.extname(item.path);await copyFile(inside(folder,item.path),path.join(directory,name));
  const duration=(await probeMedia(path.join(directory,name),signal)).duration||30;
  await writeFile(path.join(directory,'index.html'),`<!doctype html><html><body><div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="1280" data-height="720" data-no-timeline><audio id="music" class="clip" data-start="0" data-duration="${duration}" src="${name}"></audio></div></body></html>`);
  const result=await runHyperframes(['beats',directory,'--json'],{signal,timeout:600000});
  const files=await readdir(path.join(directory,'beats')).catch(()=>[]);
  if(!files.length)throw new Error('No se detectaron pulsos: '+(result.stderr||result.stdout).slice(-500));
  const data=JSON.parse(await readFile(path.join(directory,'beats',files[0]),'utf8'));
  const beats=data.beats||[],intervals=beats.slice(1).map((beat,i)=>beat.time-beats[i].time).sort((a,b)=>a-b),median=intervals[Math.floor(intervals.length/2)]||null;
  return {mediaId,bpm:median?Math.round(60/median):null,beats,strongBeats:beats.filter(beat=>beat.strength>=0.7).map(beat=>beat.time)};
}
