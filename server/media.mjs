import {mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execute} from './process.mjs';
import ffmpeg from 'ffmpeg-static';
import {generateMedia,callProvider,downloadMedia} from './providers.mjs';
import ffprobe from 'ffprobe-static';
import {captionsFromWords} from './captions.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function wavDuration(buffer){let offset=12,rate=null,size=null;while(offset+8<=buffer.length){const name=buffer.toString('ascii',offset,offset+4),length=buffer.readUInt32LE(offset+4);if(name==='fmt '&&length>=16)rate=buffer.readUInt32LE(offset+16);if(name==='data')size=length;offset+=8+length+(length%2);}if(!rate||size==null)throw new Error('Archivo de voz WAV inválido.');return size/rate;}
export async function produceScene(project,sceneId,folder,signal,onEvent=()=>{}){const {composeScene}=await import('./media-parts.mjs');return composeScene(project,sceneId,folder,signal,onEvent);}
let bundled=null,browser=null,renderQueue=Promise.resolve();
export async function renderProject(project,folder,signal,onProgress){
  const operation=renderQueue.catch(()=>{}).then(async()=>{signal.throwIfAborted();const {renderSegments}=await import('./production.mjs');return renderSegments(project,folder,signal,onProgress);});renderQueue=operation;
  let abort;const interrupted=new Promise((_,reject)=>{abort=()=>reject(new Error('Render detenido.'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
  try{return await Promise.race([operation,interrupted]);}finally{signal.removeEventListener('abort',abort);}
}
export async function closeMedia(){if(browser){const instance=await browser;browser=null;await instance.close({silent:true});}}
export async function renderSceneRemotion(project,folder,signal,onProgress){
  const {bundle}=await import('@remotion/bundler');const {selectComposition,renderMedia,makeCancelSignal,openBrowser}=await import('@remotion/renderer');
  if(!bundled)bundled=bundle({entryPoint:path.join(root,'src/video/entry.jsx'),publicDir:null}).catch(error=>{bundled=null;throw error;});
  const serveUrl=await bundled;
  if(!browser)browser=openBrowser('chrome').catch(error=>{browser=null;throw error;});const puppeteerInstance=await browser;
  const media=Object.fromEntries(project.tasks.filter(task=>task.kind==='scene').map(task=>{const output=task.output;if(!output)throw new Error('Faltan recursos de una escena.');const base=process.env.LUMEN_SERVER_URL||'http://127.0.0.1:4310';return [task.sceneId,{...output,audioUrl:`${base}/api/projects/${project.id}/files/${output.audioPath}`,recordingUrl:output.recordingPath?`${base}/api/projects/${project.id}/files/${output.recordingPath}`:null}];}));
  for(const output of Object.values(media)){const base=`${process.env.LUMEN_SERVER_URL||'http://127.0.0.1:4310'}/api/projects/${project.id}/files/`;output.visualUrl=output.visualPath?base+output.visualPath:null;output.logoUrl=output.logoPath?base+output.logoPath:null;output.layerMedia=(output.layerMedia||[]).map(layer=>({...layer,url:base+layer.path,prepared:true}));}
  const inputProps={storyboard:project.storyboard,style:project.style,profile:project.profile,output:project.output,media};
  const composition=await selectComposition({serveUrl,id:'LumenVideo',inputProps,puppeteerInstance});
  const outputName=`video-${Date.now()}.mp4`,outputLocation=path.join(folder,'media',outputName);
  const {cancelSignal,cancel}=makeCancelSignal();const abort=()=>cancel();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)cancel();let last=-1;
  try{await renderMedia({composition,serveUrl,inputProps,puppeteerInstance,codec:'h264',outputLocation,concurrency:2,crf:23,cancelSignal,onProgress:({progress})=>{const percent=Math.round(progress*100);if(percent!==last&&percent%5===0){last=percent;onProgress(percent);}}});}
  finally{signal.removeEventListener('abort',abort);}
  const render={path:`media/${outputName}`,duration:composition.durationInFrames/composition.fps,width:composition.width,height:composition.height,fps:composition.fps,size:(await stat(outputLocation)).size,createdAt:new Date().toISOString(),captionMode:'estimated-by-word-groups',media};
  await writeFile(path.join(folder,'render.json'),JSON.stringify(render,null,2));return render;
}
export async function technicalReview(project,folder,signal){
  const {reviewMedia}=await import('./production.mjs');return reviewMedia(project,folder,signal);
}
