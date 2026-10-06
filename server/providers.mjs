import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {persistentProvider} from './provider-jobs.mjs';

const mediaMime={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','video/mp4':'.mp4','video/webm':'.webm','audio/mpeg':'.mp3','audio/wav':'.wav','audio/x-wav':'.wav','audio/ogg':'.ogg'};
export async function downloadMedia(url,folder,signal){
  const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error('URL de medio inválida.');
  const response=await fetch(url,{signal:AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(90000)])});if(!response.ok)throw new Error(`Descarga de medio: HTTP ${response.status}.`);
  const type=(response.headers.get('content-type')||'').split(';')[0],extension=mediaMime[type];if(!extension)throw new Error('El proveedor no devolvió imagen, vídeo o audio compatible.');
  const reader=response.body.getReader();let size=0;const parts=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>150*1024*1024){await reader.cancel();throw new Error('El medio supera 150 MB.');}parts.push(Buffer.from(value));}
  const buffer=Buffer.concat(parts);if(buffer.length<16)throw new Error('Medio vacío.');if(type.startsWith('image/')){const signature=type==='image/png'?buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='image/jpeg'?buffer[0]===255&&buffer[1]===216:buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP';if(!signature)throw new Error('La respuesta no es una imagen válida.');}const name=`asset-${randomUUID()}${extension}`;await mkdir(path.join(folder,'media'),{recursive:true});await writeFile(path.join(folder,'media',name),buffer);return {path:`media/${name}`,mime:type,size:buffer.length};
}
export async function importMedia({name,base64,role},folder){
  const extension=path.extname(name||'').toLowerCase();if(!['.png','.jpg','.jpeg','.webp','.mp4','.webm','.wav','.mp3','.ogg'].includes(extension))throw new Error('Formato de medio no compatible.');
  const buffer=Buffer.from(base64||'','base64');if(buffer.length<16||buffer.length>60*1024*1024)throw new Error('Medio vacío o mayor de 60 MB.');
  const file=`upload-${randomUUID()}${extension}`;await mkdir(path.join(folder,'media'),{recursive:true});await writeFile(path.join(folder,'media',file),buffer);
  return {id:randomUUID(),name:String(name).slice(0,200),path:`media/${file}`,kind:['.mp4','.webm'].includes(extension)?'video':['.wav','.mp3','.ogg'].includes(extension)?(role==='voice'?'voice':'music'):'image',size:buffer.length,createdAt:new Date().toISOString(),origin:'upload'};
}
function resultUrl(data,kind){return data.url||data[kind]?.url||data.video?.url||data.audio?.url||data.images?.[0]?.url||data.output?.url||data.outputs?.[0]?.url;}
async function jsonFetch(url,options){const response=await fetch(url,options);if(!response.ok){const error=new Error(`Proveedor HTTP ${response.status}.`);error.definitive=true;throw error;}return response.json();}
export async function callProvider(provider,request,signal,context={}){return persistentProvider(provider,request,signal,context,(job,checkpoint)=>requestProvider(provider,request,signal,job,checkpoint));}
async function requestProvider(provider,request,signal,job,checkpoint){
  const key=provider.keyEnv?process.env[provider.keyEnv]:null;if(provider.keyEnv&&!key){const error=new Error(`Falta configurar ${provider.keyEnv}.`);error.definitive=true;throw error;}
  const headers={'Content-Type':'application/json',...(key?{Authorization:provider.adapter==='fal'?`Key ${key}`:provider.adapter==='pexels'?key:`Bearer ${key}`}:{})};
  if(job&&provider.idempotent)headers['Idempotency-Key']=job.id;
  const bounded=AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(300000)]);
  if(provider.adapter==='pexels'){
    const data=await jsonFetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(request.prompt)}&per_page=5&orientation=landscape`,{headers,signal:bounded});const video=data.videos?.[0];const file=video?.video_files?.filter(file=>file.file_type==='video/mp4').sort((a,b)=>Math.abs(a.width-1280)-Math.abs(b.width-1280))[0];if(!file)throw new Error('No hay stock para esta búsqueda.');return {url:file.link,credit:{author:video.user?.name,url:video.url,provider:'Pexels'}};
  }
  const body={...(provider.input||{}),prompt:request.prompt,...(provider.kind==='voice'?{text:request.prompt}:{}),...(provider.sendDuration?{duration:request.duration}:{})};
  if(provider.adapter==='http'){
    const data=await jsonFetch(provider.url,{method:'POST',headers,body:JSON.stringify({...body,kind:provider.kind}),signal:bounded});const url=resultUrl(data,provider.kind);if(!url)throw new Error('El adaptador HTTP debe devolver {url} o {images:[{url}]}, {video:{url}} o {audio:{url}}.');return {url,credit:data.credit||null};
  }
  const queued=job?.remote||await jsonFetch(`https://queue.fal.run/${provider.model}`,{method:'POST',headers,body:JSON.stringify(body),signal:bounded});checkpoint(queued);
  const validFal=url=>{const value=new URL(url);if(value.protocol!=='https:'||value.hostname!=='queue.fal.run')throw new Error('URL de cola fal inválida.');return url;};
  const cancel=()=>{if(!job&&queued.cancel_url)fetch(validFal(queued.cancel_url),{method:'PUT',headers}).catch(()=>{});};bounded.addEventListener('abort',cancel,{once:true});
  try{for(let attempt=0;attempt<150;attempt++){const state=await jsonFetch(validFal(queued.status_url),{headers,signal:bounded});if(['FAILED','ERROR','CANCELLED'].includes(state.status)||state.status==='COMPLETED'&&state.error){const error=new Error(String(state.error||'La solicitud terminó sin generar el recurso.'));error.definitive=true;throw error;}if(state.status==='COMPLETED'){const data=await jsonFetch(validFal(queued.response_url),{headers,signal:bounded});const url=resultUrl(data,provider.kind);if(!url)throw new Error('La respuesta fal no contiene un medio.');return {url,credit:null};}await delay(2000,undefined,{signal:bounded});}throw new Error('El proveedor no terminó a tiempo.');}finally{bounded.removeEventListener('abort',cancel);}
}
export async function generateMedia(project,scene,folder,signal,onEvent=()=>{}){
  const visual=scene.visual||{};const selected=project.assets?.find(item=>item.id===visual.assetId);if(selected)return {...selected,fallbacks:[]};
  if(!['image','video','stock'].includes(scene.type))return null;
  const failed=[];if(project.options?.externalMedia){
    const providers=(project.providerConfig||[]).filter(provider=>provider.enabled&&[scene.type,scene.type==='stock'?'video':scene.type].includes(provider.kind));
    const ordered=visual.providerIds?.length?[...visual.providerIds.map(id=>providers.find(provider=>provider.id===id)).filter(Boolean),...providers.filter(provider=>!visual.providerIds.includes(provider.id))]:providers;
    for(const provider of ordered){try{onEvent('provider.started',{sceneId:scene.id,providerId:provider.id});const remote=await callProvider(provider,{prompt:[visual.prompt||scene.title,project.profile?.imageStyle?`Estilo visual: ${project.profile.imageStyle}`:''].filter(Boolean).join('\n'),duration:scene.duration},signal,{store:project.jobStore,projectId:project.id,scope:scene.id+':visual:'+scene.type,revision:project.resourceVersions?.[scene.id]?.visual||0});const file=await downloadMedia(remote.url,folder,signal);if(scene.type==='image'&&!file.mime.startsWith('image/'))throw new Error('Se esperaba una imagen.');if(['video','stock'].includes(scene.type)&&!file.mime.startsWith('video/'))throw new Error('Se esperaba un vídeo.');onEvent('provider.completed',{sceneId:scene.id,providerId:provider.id,path:file.path});return {...file,id:randomUUID(),kind:file.mime.startsWith('image/')?'image':'video',providerId:provider.id,credit:remote.credit,fallbacks:failed};}catch(error){if(signal.aborted)throw error;failed.push({providerId:provider.id,message:error.message});onEvent('provider.failed',{sceneId:scene.id,providerId:provider.id,message:error.message});}}
  }
  if(project.options?.externalMedia&&['video','stock'].includes(scene.type)&&(project.providerConfig||[]).some(provider=>provider.enabled&&provider.kind==='image')){const image=await generateMedia(project,{...scene,type:'image',visual:{...visual,providerIds:[]}},folder,signal,onEvent);return {...image,fallbacks:[...failed,...image.fallbacks]};}
  // A portable local diagram is the last fallback; it always reflects the accepted scene.
  const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
  const theme=project.profile?.palette||{background:'#eae5ff',ink:'#302654',accent:'#7957df'};
  const title=scene.title.match(/.{1,35}(?:\s|$)/g)||[scene.title.slice(0,35)];
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="${theme.background}"/><circle cx="1150" cy="100" r="240" fill="${theme.accent}" opacity=".12"/>${title.slice(0,3).map((line,i)=>`<text x="90" y="${170+i*65}" font-family="Arial" font-size="54" fill="${theme.ink}">${escape(line.trim())}</text>`).join('')}${scene.points.slice(0,4).map((point,i)=>`<text x="100" y="${390+i*55}" font-family="Arial" font-size="28" fill="${theme.ink}">• ${escape(point.slice(0,65))}</text>`).join('')}</svg>`;
  const file=`media/fallback-${scene.id}-${randomUUID()}.svg`;await writeFile(path.join(folder,file),svg);onEvent('provider.fallback',{sceneId:scene.id,message:'Se utiliza una ilustración local del contenido aceptado.'});return {path:file,kind:'image',providerId:'local-diagram',fallbacks:failed};
}
