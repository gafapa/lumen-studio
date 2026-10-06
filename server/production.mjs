import {mkdir,writeFile,stat,rename,readFile,rm} from 'node:fs/promises';
import {cutsSheet,thumbnail,stampImages} from './review-pack.mjs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import ffmpeg from 'ffmpeg-static';
import {execute} from './process.mjs';
import {renderSceneRemotion} from './media.mjs';
import {renderHyperframesSegment} from './hyperframes.mjs';
import {captionGroups,srt} from './captions.mjs';

import {outputSpec} from '../src/video/output.mjs';
import {isCodeScene,renderCodeScene} from './scene-code.mjs';
import {probeMedia} from './media-index.mjs';

// Duración del solape de cada transición; un corte es un fotograma de fundido (equivalente a un corte seco).
export const TRANSITION_SECONDS=0.4;
const XFADE={fade:'fade',slide:'slideleft'};
export function transitionFor(project,scene){const name=scene.transition||project.profile?.transition||'cut';return name==='cut'?null:XFADE[name]||name;}
export function sceneOffsets(project,durations,fps){
  const offsets=[];let accumulated=0;
  durations.forEach((duration,index)=>{const overlap=index&&transitionFor(project,project.storyboard.scenes[index])?Math.min(TRANSITION_SECONDS,duration/3,durations[index-1]/3):0;const start=index?accumulated-overlap:0;offsets.push({start,overlap});accumulated=start+duration;});
  return {offsets,total:accumulated};
}
async function withAudio(file,folder,signal){
  if((await probeMedia(file,signal)).hasAudio)return file;
  const output=file.replace(/\.mp4$/,'-a.mp4');
  const result=await execute(ffmpeg,['-y','-v','error','-i',file,'-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-shortest',output],{signal,timeout:300000});
  if(result.code!==0)throw new Error('No se pudo preparar el audio de un segmento.');return output;
}
// Montaje: transiciones xfade/acrossfade, música con ducking bajo la voz y normalización de sonoridad.
// Mezcla medida (Showtime, references/sound-design.md): voz frente a música bajo la voz. Se exportan dos pistas
// con el mismo grafo de audio que el montaje (programa y música atenuada) y se comparan en las ventanas con voz.
// Un margen por debajo de 10 dB tapa palabras; por encima de 25 dB la música apenas se oye.
async function measureMix(project,folder,files,segments,offsets,signal){
  const music=project.assets?.find(item=>item.id===project.profile?.musicAssetId);if(!music)return null;
  const filters=[],inputs=files.flatMap(file=>['-i',file]);files.forEach((_,index)=>filters.push(`[${index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${index}]`));
  let audio='a0';for(let index=1;index<files.length;index++){const overlap=offsets[index].overlap;filters.push(overlap?`[${audio}][a${index}]acrossfade=d=${overlap.toFixed(4)}:c1=tri:c2=tri[ax${index}]`:`[${audio}][a${index}]concat=n=2:v=0:a=1[ax${index}]`);audio='ax'+index;}
  inputs.push('-stream_loop','-1','-i',path.join(folder,music.path));
  filters.push(`[${files.length}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${project.profile?.musicVolume??0.12}[music]`,`[${audio}]asplit=3[program][sidechain][voiceout]`,'[music][sidechain]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[ducked]','[voiceout]aresample=8000,pan=mono|c0=0.5*c0+0.5*c1[v]','[ducked]aresample=8000,pan=mono|c0=0.5*c0+0.5*c1[m]','[program]anullsink');
  const total=offsets.at(-1).start+segments.at(-1).duration,voice=path.join(folder,'review','mix-voice.raw'),bed=path.join(folder,'review','mix-music.raw');await mkdir(path.join(folder,'review'),{recursive:true});
  const result=await execute(ffmpeg,['-y','-v','error',...inputs,'-filter_complex',filters.join(';'),'-map','[v]','-t',total.toFixed(3),'-f','s16le','-ac','1','-ar','8000',voice,'-map','[m]','-t',total.toFixed(3),'-f','s16le','-ac','1','-ar','8000',bed],{signal,timeout:1800000});
  if(result.code!==0)return {error:result.stderr.slice(-300)};
  const [a,b]=await Promise.all([readFile(voice),readFile(bed)]);await Promise.all([voice,bed].map(file=>rm(file,{force:true})));
  const windowSize=3200,db=(buffer,offset)=>{let total=0;const end=Math.min(buffer.length/2,offset+windowSize);for(let i=offset;i<end;i++){const sample=buffer.readInt16LE(i*2)/32768;total+=sample*sample;}return 10*Math.log10(total/Math.max(1,end-offset)+1e-12);};
  const pairs=[];for(let offset=0;offset+windowSize<=Math.min(a.length,b.length)/2;offset+=windowSize){const voiceDb=db(a,offset);if(voiceDb>-40)pairs.push([voiceDb,db(b,offset)]);}
  if(pairs.length<5)return {voiceToMusicDb:null,windows:pairs.length};
  const average=list=>10*Math.log10(list.reduce((sum,value)=>sum+10**(value/10),0)/list.length);
  const voiceDb=average(pairs.map(pair=>pair[0])),musicDb=average(pairs.map(pair=>pair[1]));
  return {voiceDb:Math.round(voiceDb*10)/10,musicUnderVoiceDb:Math.round(musicDb*10)/10,voiceToMusicDb:Math.round((voiceDb-musicDb)*10)/10,windows:pairs.length};
}
export async function assemble(project,folder,segments,outputLocation,signal){
  const spec=outputSpec(project.output),fps=spec.fps,files=[];for(const segment of segments)files.push(await withAudio(path.join(folder,segment.path),folder,signal));
  const {offsets,total}=sceneOffsets(project,segments.map(segment=>segment.duration),fps);
  const filters=[];
  files.forEach((_,index)=>{filters.push(`[${index}:v]fps=${fps},scale=${spec.width}:${spec.height}:force_original_aspect_ratio=decrease,pad=${spec.width}:${spec.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,settb=AVTB[v${index}]`,`[${index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${index}]`);});
  let video='v0',audio='a0',accumulated=segments[0].duration;
  for(let index=1;index<files.length;index++){
    const transition=transitionFor(project,project.storyboard.scenes[index]),overlap=offsets[index].overlap;
    if(overlap)filters.push(`[${video}][v${index}]xfade=transition=${transition}:duration=${overlap.toFixed(4)}:offset=${(accumulated-overlap).toFixed(4)}[vx${index}]`,`[${audio}][a${index}]acrossfade=d=${overlap.toFixed(4)}:c1=tri:c2=tri[ax${index}]`);
    else filters.push(`[${video}][v${index}]concat=n=2:v=1:a=0[vx${index}]`,`[${audio}][a${index}]concat=n=2:v=0:a=1[ax${index}]`);
    video='vx'+index;audio='ax'+index;accumulated+=segments[index].duration-overlap;
  }
  const music=project.assets?.find(item=>item.id===project.profile?.musicAssetId),inputs=files.flatMap(file=>['-i',file]);
  if(music){inputs.push('-stream_loop','-1','-i',path.join(folder,music.path));filters.push(`[${files.length}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${project.profile?.musicVolume??0.12}[music]`,`[${audio}]asplit=2[program][sidechain]`,'[music][sidechain]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[ducked]','[program][ducked]amix=inputs=2:duration=first:normalize=0[mixed]');audio='mixed';}
  filters.push(`[${audio}]loudnorm=I=${project.profile?.loudness??-14}:TP=-1.5:LRA=11,aresample=48000[aout]`);
  const result=await execute(ffmpeg,['-y','-v','error',...inputs,'-filter_complex',filters.join(';'),'-map',`[${video}]`,'-map','[aout]','-t',total.toFixed(3),'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',outputLocation],{signal,timeout:3600000});
  if(result.code!==0)throw new Error('No se ha podido montar el vídeo: '+result.stderr.slice(-900));
  const mix=await measureMix(project,folder,files,segments,offsets,signal).catch(error=>({error:error.message.slice(0,200)}));
  return {offsets,total,mix};
}

export async function renderSegments(project,folder,signal,onProgress=()=>{}){
  const spec=outputSpec(project.output);const segments=[],media={},captions=[];let offset=0,reused=0;
  for(const [index,scene] of project.storyboard.scenes.entries()){
    signal.throwIfAborted();const task=project.tasks.find(item=>item.kind==='scene'&&item.sceneId===scene.id);if(!task?.output)throw new Error('Faltan recursos de una escena.');
    const output={...task.output,logoPath:project.assets?.find(item=>item.id===project.profile?.logoAssetId)?.path||null},codeTask=isCodeScene(scene)?project.tasks.find(item=>item.id==='code-'+scene.id):null;
    if(isCodeScene(scene)&&!codeTask?.output)throw new Error('La escena '+scene.id+' todavía no está programada.');
    const key=createHash('sha256').update(JSON.stringify({scene,output:{...output,reused:undefined},profile:project.profile,style:project.style,renderer:project.renderer||'remotion',output:project.output,code:codeTask?.output?.sourceHash||null,version:6})).digest('hex').slice(0,20);
    const segmentPath=`media/segment-${scene.id}-${key}.mp4`,absolute=path.join(folder,segmentPath);let cached=false;try{cached=(await stat(absolute)).size>1000;}catch{}
    if(cached)reused++;else if(codeTask)await renderCodeScene(project,scene,output,folder,absolute,signal);else if(project.renderer==='hyperframes')await renderHyperframesSegment(project,scene,output,folder,absolute,signal);
    else {const single={...project,storyboard:{title:project.storyboard.title,scenes:[scene]},tasks:[{...task,output}]};const rendered=await renderSceneRemotion(single,folder,signal,()=>{});await rename(path.join(folder,rendered.path),absolute);}
    segments.push({sceneId:scene.id,path:segmentPath,key,reused:cached,duration:Math.round(output.duration*spec.fps)/spec.fps,engine:codeTask?scene.engine:'json'});media[scene.id]=output;
    onProgress(Math.round((index+1)/project.storyboard.scenes.length*80));
  }
  const outputName=`video-${Date.now()}.mp4`,outputLocation=path.join(folder,'media',outputName);
  const {offsets,total,mix}=await assemble(project,folder,segments,outputLocation,signal);
  segments.forEach((segment,index)=>{segment.start=offsets[index].start;captions.push(...captionGroups(media[segment.sceneId].words||[]).map(caption=>({...caption,start:caption.start+offsets[index].start,end:caption.end+offsets[index].start})));});offset=total;
  await writeFile(path.join(folder,'media','subtitles.srt'),srt(captions));onProgress(100);
  const render={path:`media/${outputName}`,renderer:project.renderer||'remotion',duration:offset,width:spec.width,height:spec.height,fps:spec.fps,size:(await stat(outputLocation)).size,createdAt:new Date().toISOString(),segments,reusedSegments:reused,captionMode:new Set(Object.values(media).map(item=>item.captionMode)).size===1?Object.values(media)[0].captionMode:'mixed',captionsPath:'media/subtitles.srt',media,mix:mix||null};await writeFile(path.join(folder,'render.json'),JSON.stringify(render,null,2));return render;
}
export async function reviewMedia(project,folder,signal){
  const video=path.join(folder,project.render.path);
  const response=await execute(ffmpeg,['-hide_banner','-i',video,'-vf','blackdetect=d=1:pix_th=0.05,freezedetect=n=0.003:d=2.5','-af','volumedetect,silencedetect=noise=-45dB:d=2','-f','null','-'],{signal,timeout:900000});
  const issues=[];if(response.code!==0)issues.push('El vídeo contiene errores de decodificación.');
  if(Math.abs(project.render.duration-project.duration)>Math.max(8,project.duration*.15))issues.push('La duración difiere del objetivo.');
  const silence=[...response.stderr.matchAll(/silence_start: ([\d.]+)/g)].map(match=>Number(match[1])),black=[...response.stderr.matchAll(/black_start:([\d.]+)/g)].map(match=>Number(match[1]));if(silence.length)issues.push(`Hay ${silence.length} intervalos de silencio de al menos 2 segundos.`);if(black.length)issues.push(`Hay ${black.length} intervalos negros de al menos 1 segundo.`);
  // Ritmo: planos congelados de más de 2,5 s, asignados a su escena.
  const freezeStarts=[...response.stderr.matchAll(/freeze_start: ([\d.]+)/g)].map(match=>Number(match[1])),freezeDurations=[...response.stderr.matchAll(/freeze_duration: ([\d.]+)/g)].map(match=>Number(match[1]));
  const freezes=freezeStarts.map((start,index)=>{const segment=(project.render.segments||[]).find(item=>start>=item.start&&start<item.start+item.duration);const scene=project.storyboard.scenes.find(item=>item.id===segment?.sceneId);return {start,duration:freezeDurations[index]??null,sceneId:scene?.id||null,title:scene?.title||null};});
  for(const freeze of freezes)issues.push(`Plano estático de ${freeze.duration?freeze.duration.toFixed(1)+' s':'más de 2,5 s'} desde el segundo ${freeze.start.toFixed(1)}${freeze.title?` (escena «${freeze.title}»)`:''}: conviene un corte, un empuje de cámara o una animación.`);
  const frames=[];await mkdir(path.join(folder,'review'),{recursive:true});let offset=0;
  for(const scene of project.storyboard.scenes){
    const duration=project.render.media?.[scene.id]?.duration||scene.duration,speech=project.render.media?.[scene.id]?.speechDuration||duration;offset=project.render.segments?.find(segment=>segment.sceneId===scene.id)?.start??offset;
    const samples=isCodeScene(scene)?[0.6,duration/2,Math.max(0.2,duration-0.5)]:[Math.min(duration/2,Math.max(.25,speech/2)),...(scene.composition?.layers||[]).filter(layer=>layer.type==='media').map(layer=>Math.min(duration-.04,(layer.start||0)+Math.min(layer.duration??duration-(layer.start||0),duration-(layer.start||0))/2))];
    for(const sample of [...new Set(samples.map(value=>Math.round(value*100)/100))].sort((a,b)=>a-b)){
      if(!project.options?.deepReview&&frames.length>=24)break;
      const at=offset+sample,file=`review/${scene.id}-${Math.round(sample*100)}-${Date.now()}.png`;
      const result=await execute(ffmpeg,['-y','-v','error','-ss',String(at),'-i',video,'-frames:v','1',path.join(folder,file)],{signal,timeout:30000});if(result.code===0)frames.push({sceneId:scene.id,at,path:file,layerIds:(scene.composition?.layers||[]).filter(layer=>layer.type==='media'&&sample>=(layer.start||0)&&sample<(layer.start||0)+(layer.duration??duration)).map(layer=>layer.id)});
    }
    offset+=duration;
  }
  // Material de revisión (Showtime): tira de cortes, miniatura y recortes de texto a tamaño real; el revisor recibe
  // copias selladas con un código que debe devolver. Los códigos se guardan aparte, nunca en el proyecto.
  const fps=Number(project.output?.fps)||30,extras=[];
  {const boundaries=(project.render.segments||[]).slice(1).map(segment=>segment.start).filter(time=>time>0.2);
    if(await cutsSheet(video,boundaries,fps,path.join(folder,'review','cuts.jpg'),signal))extras.push({sceneId:null,at:null,path:'review/cuts.jpg',kind:'cuts',label:'tira de cortes: de 2 fotogramas antes a 4 después de cada cambio de escena'});
    const critics=(project.tasks||[]).filter(task=>task.kind==='scene-code'&&task.output?.critique?.poster!=null).map(task=>{const start=(project.render.segments||[]).find(segment=>segment.sceneId===task.sceneId)?.start;return start==null?null:start+task.output.critique.poster;}).filter(time=>time!=null&&time<(project.render.duration||0)),posterAt=critics[0]??Math.min(1.5,(project.render.duration||1)/2);if(await thumbnail(video,posterAt,path.join(folder,'review','thumb-168x94.png'),signal))extras.push({sceneId:null,at:posterAt,path:'review/thumb-168x94.png',kind:'thumbnail',label:'miniatura de 168x94: ¿se entiende en una lista de recomendados?'});
    for(const scene of project.storyboard.scenes.filter(isCodeScene)){try{const check=JSON.parse(await readFile(path.join(folder,'code',scene.id,'check.json'),'utf8')),start=project.render.segments?.find(segment=>segment.sceneId===scene.id)?.start||0;for(const crop of (check.inspect?.crops||[]).slice(0,2))extras.push({sceneId:scene.id,at:start+(crop.time||0),path:path.posix.join('code',scene.id,crop.path),kind:'text',label:`texto a tamaño real: «${String(crop.text||'').slice(0,40)}»`});}catch{}}}
  frames.push(...extras);
  {const mix=project.render.mix;if(mix?.voiceToMusicDb!=null){if(mix.voiceToMusicDb<10)issues.push(`La música tapa la voz: solo ${mix.voiceToMusicDb} dB por debajo (lo recomendable es 10–20 dB). Baja la música o atenúala más bajo la voz.`);else if(mix.voiceToMusicDb>25)issues.push(`La música apenas se oye bajo la voz (${mix.voiceToMusicDb} dB por debajo; lo recomendable es 10–20 dB).`);}}
  // Referencia de estilo: lo que debe conservarse (ok/fuera) y si el vídeo se parece demasiado.
  let referenceCheck=null;
  if(project.styleReference){try{const {referenceDiff,nearCopy}=await import('./style-reference.mjs'),work=path.join(folder,'review','reference');const diff=await referenceDiff(video,project.styleReference.spec,work),copy=await nearCopy(video,project.styleReference.dir,project.styleReference.spec,diff.spec.cuts,work,project.styleReference.file);
    referenceCheck={name:project.styleReference.name,lines:diff.lines,copy};for(const line of diff.lines.filter(item=>!item.ok))issues.push(`Fuera de la referencia «${project.styleReference.name}»: ${line.item} ${line.render} frente a ${line.reference}.`);
    if(copy.result==='fail')issues.push(`Demasiado parecido a la referencia «${project.styleReference.name}» (${Math.round(copy.share*100)} % de fotogramas casi iguales, segundos ${copy.times.join(', ')}): rehaz esos planos con material propio.`);else if(copy.result==='warn')issues.push(`Algunos fotogramas se parecen mucho a la referencia (${Math.round(copy.share*100)} %): revisa los segundos ${copy.times.join(', ')}.`);}catch(error){referenceCheck={error:error.message.slice(0,200)};}}
  const stamped=await stampImages(frames.map(frame=>({...frame,path:path.join(folder,frame.path)})),path.join(folder,'review','stamped'));
  await writeFile(path.join(folder,'review','.codes.json'),JSON.stringify(stamped.map(item=>item.code)));
  const reviewFrames=stamped.map(({code,original,...frame})=>({...frame,path:path.relative(folder,frame.path).split(path.sep).join('/')}));
  await writeFile(path.join(folder,'review','technical.log'),response.stderr);
  return {approved:response.code===0&&referenceCheck?.copy?.result!=='fail',summary:response.code===0?'MP4 decodificado; fotogramas y análisis de audio preparados para revisión final.':'El archivo no supera la comprobación técnica.',issues,mix:project.render.mix||null,checks:['decode','silence','black-frames','static-holds','volume','sampled-frames','cuts','thumbnail','text-crops',...(project.render.mix?.voiceToMusicDb!=null?['voice-music-balance']:[]),...(project.styleReference?['style-reference','near-copy']:[])],frames,reviewFrames,referenceCheck,silence,black,freezes,meanVolume:/mean_volume: ([^\n]+)/.exec(response.stderr)?.[1]||null,transcript:project.storyboard.scenes.map(scene=>({sceneId:scene.id,text:scene.narration,sourceIds:scene.sourceIds})),limitations:['Se revisan muestras de fotogramas por escena, no cada frame.','El audio se analiza con FFmpeg; la revisión conceptual usa la transcripción.']};
}
