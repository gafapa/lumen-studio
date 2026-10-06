import {mkdir,readFile,writeFile,stat,rename} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {execute} from './process.mjs';
import {generateMedia,callProvider,downloadMedia} from './providers.mjs';
import {captionsFromWords,alignToScript} from './captions.mjs';
import {advancedDesign,sceneDesign} from '../src/video/design.mjs';
import {prepareLayerMedia} from './design-media.mjs';
import {wavDuration} from './media.mjs';
import {runHyperframes,transcribeWords,findMedia} from './media-index.mjs';

// Locución propia: recorta el audio elegido y obtiene los tiempos de palabras transcribiéndolo.
async function userVoice(project,scene,folder,output,signal){
  const item=findMedia(project,scene.voiceover.assetId);if(!['voice','music','video'].includes(item.kind))throw new Error('La locución debe ser un audio o un vídeo con sonido.');
  const from=scene.voiceover.from||0,to=scene.voiceover.to;
  const cut=await execute(ffmpeg,['-y','-v','error','-ss',String(from),...(to?['-t',String(to-from)]:[]),'-i',path.join(folder,item.path),'-vn','-ar','44100','-ac','1',output],{signal,timeout:600000});
  if(cut.code!==0)throw new Error('No se pudo recortar la locución: '+cut.stderr.slice(-400));
  const directory=output+'.transcript';await mkdir(directory,{recursive:true});const transcript=await transcribeWords(output,directory,signal).catch(()=>null);
  return {voice:'usuario:'+item.name,words:transcript?.words||[]};
}
// Kokoro-82M local mediante HyperFrames; los tiempos de palabras salen de transcribir el resultado.
async function kokoroVoice(text,voice,folder,output,signal){
  const textFile=output+'.txt',raw=output+'.kokoro.wav';await writeFile(textFile,text);
  const result=await runHyperframes(['tts','--text-file',textFile,'-o',raw,'-v',voice,'--json'],{signal,timeout:900000});
  if(result.code!==0)throw new Error('Kokoro no pudo generar la voz: '+(result.stderr||result.stdout).slice(-500));
  const converted=await execute(ffmpeg,['-y','-v','error','-i',raw,'-ar','44100','-ac','1',output],{signal,timeout:300000});if(converted.code!==0)throw new Error('Audio de Kokoro inválido.');
  const directory=output+'.transcript';await mkdir(directory,{recursive:true});const transcript=await transcribeWords(output,directory,signal,'es').catch(()=>null);
  return {voice:'kokoro:'+voice,words:alignToScript(text,transcript?.words||[])};
}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24);
const inflight=new Map();
async function cached(folder,part,key,produce){const id=folder+part+key;if(inflight.has(id))return inflight.get(id);const operation=readOrProduce(folder,part,key,produce).finally(()=>inflight.delete(id));inflight.set(id,operation);return operation;}
async function readOrProduce(folder,part,key,produce){
  await mkdir(path.join(folder,'media'),{recursive:true});const file=path.join(folder,'media',`part-${part}-${key}.json`);
  try{const value=JSON.parse(await readFile(file,'utf8'));for(const entry of [value.audioPath,value.visualPath,value.recordingPath,...(value.layerMedia||[]).map(layer=>layer.path)].filter(Boolean))await stat(path.join(folder,entry));return {...value,reused:true};}catch{}
  const value={...await produce(),key,reused:false};const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value,null,2));await rename(temp,file);return value;
}
export async function producePart(project,sceneId,part,folder,signal,onEvent=()=>{}){
  const scene=project.storyboard.scenes.find(item=>item.id===sceneId);if(!scene)throw new Error('Escena inexistente.');signal.throwIfAborted();
  const revision=project.resourceVersions?.[sceneId]?.[part]||0;
  if(part==='voice'){
    const provider=project.options?.externalMedia&&project.profile?.voice?.startsWith('provider:')?(project.providerConfig||[]).find(item=>item.id===project.profile.voice.slice(9)&&item.kind==='voice'&&item.enabled):null;
    const key=digest({sceneId,text:scene.narration,voice:project.profile?.voice,provider,revision,voiceover:scene.voiceover||null});
    return cached(folder,part,key,async()=>{
      const audioPath=`media/voice-${sceneId}-${key}.wav`,output=path.join(folder,audioPath);let speech=null;
      if(scene.voiceover?.assetId)speech=await userVoice(project,scene,folder,output,signal);
      if(!speech&&project.profile?.voice?.startsWith('kokoro:'))try{speech=await kokoroVoice(scene.narration,project.profile.voice.slice(7)||'ef_dora',folder,output,signal);}catch(error){if(signal.aborted)throw error;onEvent('voice.fallback',{sceneId,message:error.message});}
      if(!speech&&project.options?.externalMedia&&project.profile?.voice?.startsWith('provider:'))try{
        if(!provider)throw new Error('Proveedor de voz no disponible.');
        const remote=await callProvider(provider,{prompt:scene.narration,duration:scene.duration},signal,{store:project.jobStore,projectId:project.id,scope:sceneId+':voice',revision});
        const media=await downloadMedia(remote.url,folder,signal);const response=await execute(ffmpeg,['-y','-v','error','-i',path.join(folder,media.path),'-ar','44100','-ac','1',output],{signal,timeout:120000});if(response.code!==0)throw new Error('Audio generado inválido.');speech={voice:provider.id,words:[]};
      }catch(error){if(signal.aborted)throw error;onEvent('voice.fallback',{sceneId,message:error.message});}
      if(!speech){if(process.platform!=='win32')throw new Error('Selecciona un proveedor de voz; la voz local requiere Windows.');const response=await execute('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/speech.ps1')],{input:JSON.stringify({text:scene.narration,output,voice:project.profile?.voice?.startsWith('provider:')?null:project.profile?.voice||null}),signal,timeout:120000});if(response.code!==0)throw new Error(response.stderr.slice(-900));speech=JSON.parse(response.stdout.trim());}
      return {audioPath,voice:speech.voice,speechDuration:wavDuration(await readFile(output)),speechWords:speech.words||[]};
    });
  }
  if(part==='visual'){
    const key=digest({sceneId,type:scene.type,title:scene.title,points:scene.points,visual:scene.visual,layers:scene.composition?.layers?.filter(layer=>layer.type==='media'),visualIntensity:project.profile?.visualIntensity,format:project.output?.format,imageStyle:project.profile?.imageStyle,palette:project.profile?.palette,providers:project.providerConfig,external:project.options?.externalMedia,revision,recordings:scene.type==='screencast'?project.recordings:undefined});
    return cached(folder,part,key,async()=>{
      const needsPrimary=!advancedDesign(scene,project.profile)||sceneDesign(scene,{...project.profile,format:project.output?.format}).layers.some(layer=>layer.type==='media'&&!layer.media?.assetId&&!layer.media?.recordingId);
      const recording=needsPrimary&&scene.type==='screencast'?(scene.visual?.recordingId?project.recordings.find(item=>item.id===scene.visual.recordingId&&item.status==='completed'):project.recordings.filter(item=>item.status==='completed').at(-1)):null;
      if(needsPrimary&&scene.type==='screencast'&&!recording)throw new Error('Esta escena requiere una grabación terminada.');
      const visual=needsPrimary?await generateMedia(project,scene,folder,signal,onEvent):null;let visualDuration=null;
      if(visual?.kind==='video'){const probe=await execute(ffprobe.path,['-v','error','-show_entries','format=duration','-of','json',path.join(folder,visual.path)],{signal,timeout:30000});if(probe.code!==0)throw new Error('Vídeo generado inválido.');visualDuration=Number(JSON.parse(probe.stdout).format.duration);}
      const primary={recordingPath:recording?.path||null,recordingDuration:recording?.durationSeconds||null,recordingAudio:recording?.systemAudio===true,visualPath:visual?.path||null,visualKind:visual?.kind||null,visualDuration,credit:visual?.credit||null,fallbacks:visual?.fallbacks||[]};
      return {...primary,layerMedia:await prepareLayerMedia(project,scene,folder,signal,primary)};
    });
  }
  if(part==='captions'){
    const voice=project.tasks.find(task=>task.kind==='voice'&&task.sceneId===sceneId&&task.status==='completed')?.output||await producePart(project,sceneId,'voice',folder,signal,onEvent);
    const override=project.captionOverrides?.[sceneId];const key=digest({voiceKey:voice.key,narration:scene.narration,override,revision});
    return cached(folder,part,key,async()=>({words:override||captionsFromWords(voice.speechWords,voice.speechDuration,scene.narration),captionMode:override?'manual':voice.speechWords?.length?(String(voice.voice).startsWith('usuario:')||String(voice.voice).startsWith('kokoro:')?'transcribed':'speech-events'):'estimated'}));
  }
  throw new Error('Componente audiovisual desconocido.');
}
export async function composeScene(project,sceneId,folder,signal,onEvent=()=>{}){
  const scene=project.storyboard.scenes.find(item=>item.id===sceneId),values={};
  await Promise.all(['voice','visual','captions'].map(async part=>{values[part]=project.tasks.find(task=>task.kind===part&&task.sceneId===sceneId&&task.status==='completed')?.output||await producePart(project,sceneId,part,folder,signal,onEvent);}));
  const {voice,visual,captions}=values;
  return {sceneId,...voice,...visual,...captions,duration:voice.speechDuration>0.5?Math.max(voice.speechDuration+0.7,Math.min(scene.duration,voice.speechDuration+1.8)):scene.duration,logoPath:project.assets?.find(item=>item.id===project.profile?.logoAssetId)?.path||null,partKeys:Object.fromEntries(Object.entries(values).map(([key,value])=>[key,value.key])),hash:digest(Object.values(values).map(value=>value.key))};
}
