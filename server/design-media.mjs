import path from 'node:path';
import {mkdir,stat,rename,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {execute} from './process.mjs';
import {advancedDesign,sceneDesign} from '../src/video/design.mjs';
const inflight=new Map();
export function sceneAssetIds(scene){return [...new Set([scene.visual?.assetId,...(scene.composition?.layers||[]).filter(layer=>layer.type==='media').map(layer=>layer.media?.assetId)].filter(Boolean))];}
export function validateSceneMedia(project,scene){
  for(const id of sceneAssetIds(scene)){
    const asset=project.assets?.find(item=>item.id===id);
    if(!asset||!['image','video'].includes(asset.kind))throw new Error('La composición usa un recurso multimedia inexistente.');
    if(project.resources?.some(resource=>resource.assetId===id&&(resource.decision==='reject'||resource.assessment?.recommendation==='reject'&&resource.decision!=='use')))throw new Error('La composición usa un recurso descartado. Cambia su selección antes de asignarlo.');
  }
  for(const layer of scene.composition?.layers||[])if(layer.type==='media'){
    if(layer.media?.assetId&&layer.media?.recordingId)throw new Error('Selecciona un recurso o una grabación por capa.');
    if(layer.media?.recordingId&&!project.recordings?.some(recording=>recording.id===layer.media.recordingId&&recording.status==='completed'))throw new Error('La capa requiere una grabación terminada.');
    if(layer.media?.assetId&&project.assets.find(asset=>asset.id===layer.media.assetId)?.kind==='image'&&((layer.media.from||0)>0||layer.media.to!=null||(layer.media.rate??1)!==1))throw new Error('Los tiempos de corte y velocidad solo se aplican a vídeos.');
  }
}
function localFile(folder,file){const absolute=path.resolve(folder,file),relative=path.relative(path.resolve(folder),absolute);if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('El recurso debe pertenecer a este proyecto.');return absolute;}
export async function prepareClip(folder,source,selection={},signal=new AbortController().signal,fps=30){
  signal.throwIfAborted();const absolute=localFile(folder,source.path),info=await stat(absolute);
  const probe=await execute(ffprobe.path,['-v','error','-show_entries','format=duration:stream=codec_type','-of','json',absolute],{signal,timeout:30000});
  if(probe.code!==0)throw new Error('No se puede leer el vídeo de recursos.');
  const metadata=JSON.parse(probe.stdout),sourceDuration=Number(metadata.format?.duration);
  if(!metadata.streams?.some(stream=>stream.codec_type==='video')||!Number.isFinite(sourceDuration)||sourceDuration<=0)throw new Error('El recurso no contiene vídeo válido.');
  const from=selection.from??0,to=selection.to??sourceDuration,rate=selection.rate??1;
  if(!Number.isFinite(from)||!Number.isFinite(to)||!Number.isFinite(rate)||from<0||from>=sourceDuration||to<=from||to>sourceDuration+.04||rate<.25||rate>4)throw new Error('Fragmento fuera del vídeo: comprueba inicio, final y velocidad.');
  const end=Math.min(to,sourceDuration),duration=(end-from)/rate,cut=from>0||end<sourceDuration-.04||rate!==1;
  if(!cut)return {...source,duration,sourceFrom:from,sourceTo:end,rate};
  const key=createHash('sha256').update(JSON.stringify([3,source.path,info.size,info.mtimeMs,from,end,rate,fps])).digest('hex').slice(0,24);
  const hasAudio=metadata.streams?.some(stream=>stream.codec_type==='audio'),tempo=[];let remaining=rate;while(remaining>2){tempo.push('atempo=2');remaining/=2;}while(remaining<0.5){tempo.push('atempo=0.5');remaining/=0.5;}tempo.push('atempo='+remaining.toFixed(4));
  const relative='media/clip-'+key+'.mp4',output=path.join(folder,relative);
  const operation=async()=>{await mkdir(path.dirname(output),{recursive:true});try{await stat(output);return;}catch{}
    const temp=output+'.'+randomUUID()+'.mp4';
    try{const result=await execute(ffmpeg,['-y','-v','error','-ss',String(from),'-t',String(end-from),'-i',absolute,'-vf','setpts=(PTS-STARTPTS)/'+rate,...(hasAudio?['-af','asetpts=PTS-STARTPTS,'+tempo.join(','),'-c:a','aac','-b:a','160k']:['-an']),'-t',String(duration),'-r',String(fps),'-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-threads','1','-movflags','+faststart',temp],{signal,timeout:180000});
      if(result.code!==0)throw new Error('FFmpeg no pudo preparar el fragmento: '+result.stderr.slice(-500));signal.throwIfAborted();await rename(temp,output);
    }finally{await rm(temp,{force:true});}
  };
  if(!inflight.has(output))inflight.set(output,operation().finally(()=>inflight.delete(output)));await inflight.get(output);
  return {...source,path:relative,duration,sourceFrom:from,sourceTo:end,rate,hasAudio};
}
export async function prepareLayerMedia(project,scene,folder,signal,primary={}){
  validateSceneMedia(project,scene);if(!advancedDesign(scene,project.profile))return [];
  const design=sceneDesign(scene,{...project.profile,format:project.output?.format}),result=[];
  for(const layer of design.layers.filter(item=>item.type==='media')){
    const asset=project.assets?.find(item=>item.id===layer.media?.assetId),recording=project.recordings?.find(item=>item.id===layer.media?.recordingId);
    let source=asset?{...asset,assetId:asset.id}:recording?{path:recording.path,kind:'video',recordingId:recording.id}:primary.recordingPath?{path:primary.recordingPath,kind:'video',recordingAudio:primary.recordingAudio}:primary.visualPath?{path:primary.visualPath,kind:primary.visualKind,credit:primary.credit}:null;
    if(!source){if(layer.id==='primary'&&!layer.media?.assetId&&!layer.media?.recordingId)continue;throw new Error('La capa '+layer.id+' necesita un recurso o una grabación.');}
    await stat(localFile(folder,source.path));
    if(source.kind==='video')source=await prepareClip(folder,source,layer.media,signal,project.output?.fps||30);
    result.push({layerId:layer.id,path:source.path,kind:source.kind,duration:source.duration||null,assetId:source.assetId||null,recordingId:source.recordingId||null,sourceFrom:source.sourceFrom??null,sourceTo:source.sourceTo??null,rate:source.rate||1,volume:layer.media?.volume??0,recordingAudio:layer.id==='primary'&&source.recordingAudio===true&&source.path===primary.recordingPath,credit:source.credit||null});
  }
  return result;
}
