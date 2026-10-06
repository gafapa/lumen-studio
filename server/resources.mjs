import {randomUUID,createHash} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import http from 'node:http';
import https from 'node:https';
import {mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {sceneAssetIds} from './design-media.mjs';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {execute} from './process.mjs';
import {indexSources} from './knowledge.mjs';
import {settings} from './settings.mjs';

const now=()=>new Date().toISOString(),plain=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
export function publicAddress(address){
  const value=address.toLowerCase();
  if(isIP(value)===4){const [a,b]=value.split('.').map(Number);return !([0,10,127].includes(a)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&[0,168].includes(b))||(a===100&&b>=64&&b<=127)||(a===198&&[18,19].includes(b))||a>=224);}
  if(isIP(value)!==6)return false;
  // Accept global unicast only. Reject IPv4 mappings, local, multicast and transition ranges.
  return /^[23]/.test(value)&&!/^2001:(db8|0:|2:|10:|20:)/.test(value)&&!/^2002:/.test(value);
}
export function publicUrl(value,domains=[]){const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port&&![80,443].includes(Number(url.port)))throw new Error('Usa un destino público con URL web sin credenciales.');if(domains.length&&!domains.some(domain=>url.hostname===domain||url.hostname.endsWith('.'+domain)))throw new Error('El dominio no está permitido para este proyecto.');return url;}
// Reintenta cuando el servidor limita la frecuencia (429) o está saturado (503), como hace Wikimedia en ráfagas.
export async function fetchPublic(value,options={}){
  for(let attempt=0;;attempt++){try{return await fetchPublicOnce(value,options);}catch(error){if(attempt<2&&/respondió (429|503)/.test(error.message)&&!options.signal?.aborted){await new Promise(resolve=>setTimeout(resolve,2500*(attempt+1)));continue;}throw error;}}
}
async function fetchPublicOnce(value,{domains=[],signal,limit=2*1024*1024,headers={}}={}){
  const abort=AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(45000)]);
  let url=publicUrl(value,domains);
  for(let redirect=0;redirect<=3;redirect++){
    abort.throwIfAborted();const addresses=await lookup(url.hostname.replace(/^\[|\]$/g,''),{all:true});
    if(!addresses.length||addresses.some(item=>!publicAddress(item.address)))throw new Error('El recurso requiere un destino público.');
    const address=addresses[0];
    const response=await new Promise((resolve,reject)=>{
      const req=(url.protocol==='https:'?https:http).get(url,{signal:abort,headers:{'User-Agent':'LumenVideoStudio/0.1 (project resource research)',...headers},lookup:(hostname,options,callback)=>options?.all?callback(null,[address]):callback(null,address.address,address.family)},res=>{
        if([301,302,303,307,308].includes(res.statusCode)){res.resume();resolve({redirect:res.headers.location});return;}
        if(res.statusCode!==200){res.resume();reject(new Error('El recurso respondió '+res.statusCode+'.'));return;}
        if(Number(res.headers['content-length'])>limit){res.destroy();reject(new Error('Recurso demasiado grande.'));return;}
        const parts=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>limit){res.destroy(new Error('Recurso demasiado grande.'));return;}parts.push(chunk);});res.on('error',reject);res.on('end',()=>resolve({body:Buffer.concat(parts),mime:String(res.headers['content-type']||'').split(';')[0],url:url.href}));
      });req.on('error',reject);
    });
    if(!response.redirect)return response;
    // Revalidate DNS and the allowlist on every redirect, without forwarding provider credentials.
    headers={};url=publicUrl(new URL(response.redirect,url).href,domains);
  }
  throw new Error('Demasiadas redirecciones.');
}
export function parsePage(html,url){
  const attributes=tag=>Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(match=>[match[1].toLowerCase(),plain(match[2]??match[3]??match[4])]));
  const media=[];const add=(value,kind,name)=>{if(!value)return;try{const candidate=publicUrl(new URL(value,url).href);if(!media.some(item=>item.url===candidate.href)&&media.length<12)media.push({url:candidate.href,kind,name:name||kind,sourceUrl:url,origin:'page'});}catch{}};
  // Strip executable and comment contents before extracting media references.
  const safe=html.replace(/<!--[^]*?-->/g,'').replace(/<(script|style)[^>]*>[^]*?<\/\1>/gi,'');
  for(const match of safe.matchAll(/<(img|video|source|meta)\b[^>]*>/gi)){
    const a=attributes(match[0]),tag=match[1].toLowerCase();
    if(tag==='img'&&!(Number(a.width)>0&&Number(a.width)<100)&&!(Number(a.height)>0&&Number(a.height)<100))add(a.src||a['data-src'],'image',a.alt);
    if(tag==='video'||tag==='source'&&a.type?.startsWith('video/'))add(a.src,'video',a.title);
    if(tag==='meta'&&/^og:image(:url)?$/.test(a.property))add(a.content,'image','Imagen de la página');
    if(tag==='meta'&&/^og:video(:url)?$/.test(a.property))add(a.content,'video','Vídeo de la página');
  }
  return {name:plain(/<title[^>]*>([^]*?)<\/title>/i.exec(html)?.[1])||new URL(url).hostname,content:plain(safe.replace(/<(nav|footer)[^>]*>[^]*?<\/\1>/gi,'')).slice(0,20000),media};
}
function key(resource){return resource.url?resource.kind+':'+new URL(resource.url).href.replace(/#.*$/,''):resource.kind+':asset:'+resource.assetId;}
export function addResource(store,id,input){
  if(!['page','image','video','music'].includes(input.kind))throw new Error('Tipo de recurso inválido.');
  if(input.url)input={...input,url:publicUrl(input.url).href};for(const field of ['sourceUrl','licenseUrl'])if(input[field]){const link=new URL(input[field]);if(!['http:','https:'].includes(link.protocol)||link.username||link.password)throw new Error('Enlace de procedencia no admitido.');}
  const project=store.get(id);if(!project)throw new Error('Proyecto inexistente.');project.resources||=[];
  const found=project.resources.find(resource=>key(resource)===key(input)||input.assetId&&resource.assetId===input.assetId);
  if(!found&&project.resources.length>=200)throw new Error('La biblioteca admite 200 recursos por proyecto.');
  const resource=found||{id:randomUUID(),createdAt:now(),status:input.kind==='page'?'reference':'discovered',assessment:null,decision:null};
  // Repeated discoveries preserve downloads, assessments, manual decisions and original provenance.
  for(const field of ['url','kind','assetId','path','mime','size','content','previewPaths','metadata','status','error'])if(input[field]!==undefined)resource[field]=input[field];
  for(const field of ['name','sourceUrl','origin','taskId','query','license','licenseUrl','author','credit'])if(input[field]&&!resource[field])resource[field]=String(input[field]).slice(0,field==='sourceUrl'?4000:1000);
  resource.name||='Recurso';resource.updatedAt=now();if(!found)project.resources.push(resource);
  store.save(project);if(resource.kind==='page'&&resource.content)indexSources(store,project);store.event(id,'resource.saved',{resourceId:resource.id,kind:resource.kind,name:resource.name});return resource;
}
export function syncAssets(store,id){
  let project=store.get(id);project.assets||=[];
  const local=[...(project.recordings||[]).filter(item=>item.status==='completed'&&item.path).map(item=>({id:'recording-'+item.id,name:'Grabación del PC',kind:'video',path:item.path,origin:'recording',createdAt:item.createdAt})),...(project.tasks||[]).filter(task=>task.status==='completed'&&task.output?.visualPath&&['image','video'].includes(task.output.visualKind)).map(task=>({id:'visual-'+createHash('sha256').update(task.output.visualPath).digest('hex').slice(0,16),name:task.sceneId?'Visual · '+(project.storyboard?.scenes.find(scene=>scene.id===task.sceneId)?.title||task.sceneId):task.label,kind:task.output.visualKind,path:task.output.visualPath,credit:task.output.credit,origin:'production',createdAt:task.completedAt}))];
  let changed=false;for(const asset of local)if(!project.assets.some(item=>item.path===asset.path)){project.assets.push(asset);changed=true;}if(changed)store.save(project);
  // Solo el material audiovisual es un recurso; documentos, datos y voces se consultan desde la biblioteca.
  for(const asset of project.assets)if(['image','video','music'].includes(asset.kind)&&!(store.get(id).resources||[]).some(resource=>resource.assetId===asset.id)&&(store.get(id).resources||[]).length<200)addResource(store,id,{...asset,assetId:asset.id,status:'ready',origin:asset.origin||'local',author:asset.credit?.author,license:asset.credit?.license,sourceUrl:asset.credit?.url});
  for(const task of project.tasks||[])if(task.kind==='research'&&task.output)for(const source of task.output.sources||[]){try{if(/^https?:\/\//.test(source.url)&&!(store.get(id).resources||[]).some(resource=>resource.kind==='page'&&key(resource)===key({kind:'page',url:source.url}))&&(store.get(id).resources||[]).length<200)addResource(store,id,{kind:'page',url:source.url,name:source.title,taskId:task.id,origin:'reported'});}catch{}}
  return store.get(id).resources||[];
}
export async function archivePage(store,id,url,{taskId,signal,fetcher=fetchPublic}={}){
  const project=store.get(id);if(!project.options?.webResearch)throw new Error('Activa la investigación web para consultar páginas.');
  publicUrl(url,settings(store).allowedDomains);const existing=(project.resources||[]).find(resource=>resource.kind==='page'&&key(resource)===key({kind:'page',url}));if(existing?.status==='consulted')return existing;
  const reference=addResource(store,id,{kind:'page',url,name:new URL(url).hostname,taskId,origin:'research'});
  try{const response=await fetcher(url,{domains:settings(store).allowedDomains,signal});if(!['text/html','text/plain','application/xhtml+xml'].includes(response.mime))throw new Error('Esta URL no contiene una página de texto.');
    const page=parsePage(response.body.toString('utf8'),response.url||url);
    const resource=addResource(store,id,{kind:'page',url,name:page.name,status:'consulted',content:`URL: ${url}\nRecuperada: ${now()}\n${page.content}`,error:null});
    // Keep the fetched page's actual title, rather than its initial hostname.
    const current=store.get(id);current.resources.find(item=>item.id===resource.id).name=page.name.slice(0,200);store.save(current);indexSources(store,current);
    for(const candidate of page.media)addResource(store,id,{...candidate,taskId});return store.get(id).resources.find(item=>item.id===resource.id);
  }catch(error){addResource(store,id,{kind:'page',url,error:error.message});if(signal?.aborted)throw error;return {...reference,error:error.message};}
}
export async function archiveResearch(store,id,output,taskId,signal){
  for(const source of output.sources||[])if(/^https?:\/\//i.test(source.url)){try{if(store.get(id).options?.webResearch)await archivePage(store,id,source.url,{taskId,signal});else addResource(store,id,{kind:'page',url:source.url,name:source.title,origin:'reported',taskId});}catch(error){if(signal.aborted)throw error;store.event(id,'resource.warning',{taskId,message:error.message});}}
  for(const candidate of output.resources||[]){try{addResource(store,id,{...candidate,taskId,origin:'research'});}catch(error){store.event(id,'resource.warning',{taskId,message:error.message});}}
}
export async function searchResources(store,id,{query,kind='image',provider='commons'},signal){
  const project=store.get(id);if(!project.options?.webResearch)throw new Error('Activa la investigación web para buscar recursos.');if(typeof query!=='string'||!query.trim()||query.length>300||!['image','video'].includes(kind))throw new Error('Consulta o tipo de recurso inválido.');
  if(provider!=='commons'&&!project.options?.externalMedia)throw new Error('Activa proveedores externos para usar Pexels.');
  return (await searchCandidates(store,{query,kind,provider},signal)).map(candidate=>addResource(store,id,candidate));
}
// Candidatos multimedia con URL directa, autor y licencia: Wikimedia Commons (fotos, ilustraciones y vídeo),
// Openverse (imágenes y música con licencia abierta) y Pexels si hay clave configurada.
export async function searchCandidates(store,{query,kind='image',provider='commons'},signal){
  if(typeof query!=='string'||!query.trim()||query.length>300||!['image','video','audio'].includes(kind))throw new Error('Consulta o tipo de recurso inválido.');
  let candidates=[];
  if(provider==='openverse'){
    if(kind==='video')throw new Error('Openverse no tiene vídeo: usa commons o pexels.');
    const endpoint=new URL(`https://api.openverse.org/v1/${kind==='audio'?'audio':'images'}/`);endpoint.searchParams.set('q',query);endpoint.searchParams.set('page_size','8');if(kind==='image')endpoint.searchParams.set('extension','jpg,png,webp');else endpoint.searchParams.set('extension','mp3,ogg,wav');
    publicUrl(endpoint.href,settings(store).allowedDomains);const response=await fetchPublic(endpoint.href,{signal}),data=JSON.parse(response.body);
    candidates=(data.results||[]).filter(item=>item.url).map(item=>({kind,url:item.url,name:item.title||query,sourceUrl:item.foreign_landing_url||item.url,origin:'openverse',query,author:item.creator||'',license:item.license?`CC ${String(item.license).toUpperCase()} ${item.license_version||''}`.trim():'',licenseUrl:item.license_url||'',...(kind==='audio'&&item.duration?{duration:Math.round(item.duration/1000)}:{})}));
  }else if(provider==='commons'){
    if(kind==='audio')throw new Error('Para música usa openverse.');
    const endpoint=new URL('https://commons.wikimedia.org/w/api.php');Object.entries({action:'query',generator:'search',gsrnamespace:'6',gsrsearch:query+(kind==='video'?' filetype:video':' filetype:bitmap|drawing'),gsrlimit:'6',prop:'imageinfo',iiprop:'url|size|mime|extmetadata|thumbmime',iiurlwidth:'1280',iiextmetadatafilter:'LicenseShortName|LicenseUrl|Artist|ImageDescription|Credit',format:'json'}).forEach(([k,v])=>endpoint.searchParams.set(k,v));
    publicUrl(endpoint.href,settings(store).allowedDomains);const response=await fetchPublic(endpoint.href,{signal});const data=JSON.parse(response.body);if(data.error)throw new Error(data.error.info||'No se pudo buscar en Commons.');
    candidates=Object.values(data.query?.pages||{}).flatMap(page=>{let info=page.imageinfo?.[0];if(!info)return [];const image=kind==='image',mime=image?(info.mime==='image/svg+xml'?info.thumbmime:info.mime)||info.thumbmime:info.mime;if(image&&info.mime==='image/svg+xml')info={...info,url:info.thumburl,size:0};if(!['image/png','image/jpeg','image/webp','video/mp4','video/webm'].includes(mime))return [];return [{kind,url:image&&info.size<12*1024*1024&&Math.max(info.width,info.height)<=2560?info.url:image?info.thumburl||info.url:info.url,name:page.title.replace(/^File:/,''),sourceUrl:info.descriptionurl,origin:'commons',query,author:plain(info.extmetadata?.Artist?.value),license:plain(info.extmetadata?.LicenseShortName?.value),licenseUrl:plain(info.extmetadata?.LicenseUrl?.value)}];});
  }else{
    if(kind==='audio')throw new Error('Pexels no tiene música: usa openverse.');const selected=settings(store).providers.find(item=>item.id===provider&&item.enabled&&item.adapter==='pexels');if(!selected)throw new Error('Proveedor Pexels no disponible.');const apiKey=process.env[selected.keyEnv];if(!apiKey)throw new Error('Falta la clave de Pexels.');
    const url=`https://api.pexels.com/${kind==='image'?'v1/search':'videos/search'}?query=${encodeURIComponent(query)}&per_page=6`;publicUrl(url,settings(store).allowedDomains);const response=await fetchPublic(url,{signal,headers:{Authorization:apiKey}}),data=JSON.parse(response.body);
    candidates=(kind==='image'?data.photos||[]:data.videos||[]).flatMap(item=>{const url=kind==='image'?item.src?.large2x:item.video_files?.filter(file=>file.file_type==='video/mp4').sort((a,b)=>Math.abs(a.width-1280)-Math.abs(b.width-1280))[0]?.link;return url?[{kind,url,name:item.alt||query,sourceUrl:item.url,origin:'pexels',query,author:item.photographer||item.user?.name,license:'Pexels License',licenseUrl:'https://www.pexels.com/license/'}]:[];});
  }
  return candidates;
}
function localPath(folder,value){const target=path.resolve(folder,value||'');if(!value||!target.startsWith(path.resolve(folder)+path.sep))throw new Error('Archivo de recurso fuera del proyecto.');return target;}
const locks=new Map();
export async function prepareResource(store,id,resourceId,folder,signal,{fetcher=fetchPublic}={}){
  const lock=id+':'+resourceId;if(locks.has(lock))return locks.get(lock);
  const work=(async()=>{
    let project=store.get(id),resource=project.resources?.find(item=>item.id===resourceId);if(!resource||!['image','video'].includes(resource.kind))throw new Error('Selecciona una imagen o un vídeo.');
    if(resource.status==='ready'&&resource.previewPaths?.length){try{await Promise.all(resource.previewPaths.map(frame=>stat(localPath(folder,frame.path))));return resource;}catch{}}
    try{
      let asset=project.assets?.find(item=>item.id===resource.assetId);
      if(!asset){if(!project.options?.webResearch)throw new Error('La descarga de candidatos requiere investigación web.');const response=await fetcher(resource.url,{signal,limit:80*1024*1024});
        const extensions={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','video/mp4':'mp4','video/webm':'webm'},extension=extensions[response.mime];if(!extension||response.mime.split('/')[0]!==resource.kind)throw new Error('La URL no es un archivo multimedia compatible; las páginas de vídeo no son clips descargables.');
        const filename=`media/resource-${resource.id}.${extension}`;await mkdir(path.join(folder,'media'),{recursive:true});await writeFile(localPath(folder,filename),response.body);
        asset={id:randomUUID(),name:resource.name,path:filename,kind:resource.kind,mime:response.mime,size:response.body.length,origin:resource.origin,createdAt:now(),credit:{author:resource.author,url:resource.sourceUrl,license:resource.license}};

      }
      const input=localPath(folder,asset.path);if((await stat(input)).size>80*1024*1024)throw new Error('Recurso demasiado grande para valorar.');
      const probe=await execute(ffprobe.path,['-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-of','json',input],{signal,timeout:30000});if(probe.code)throw new Error('No se pudo analizar el archivo multimedia.');
      const data=JSON.parse(probe.stdout),stream=data.streams.find(item=>item.codec_type==='video');if(!stream?.width||!stream.height)throw new Error('El recurso no contiene imagen.');if(stream.width*stream.height>40000000)throw new Error('La imagen excede el límite de resolución para valorar.');const duration=resource.kind==='video'?Number(data.format?.duration||stream.duration)||null:null;
      if(resource.kind==='video'&&!duration)throw new Error('No se puede determinar la duración del vídeo.');
      const times=resource.kind==='video'?[0.1,0.5,0.9].map(fraction=>duration*fraction):[0],frames=[];
      await mkdir(path.join(folder,'resources',resource.id),{recursive:true});
      for(const [index,time] of times.entries()){const file=`resources/${resource.id}/preview-${index}.jpg`;const result=await execute(ffmpeg,['-hide_banner','-loglevel','error','-y','-protocol_whitelist','file,pipe',...(resource.kind==='video'?['-ss',String(time)]:[]),'-i',input,'-frames:v','1','-vf','scale=1280:1280:force_original_aspect_ratio=decrease','-threads','1',localPath(folder,file)],{signal,timeout:45000});if(result.code)throw new Error('No se pudo preparar la previsualización.');await stat(localPath(folder,file));frames.push({path:file,time,resourceId});}
      project=store.get(id);project.assets||=[];if(!project.assets.some(item=>item.id===asset.id)){project.assets.push(asset);store.save(project);}
      const result=addResource(store,id,{kind:resource.kind,url:resource.url,assetId:asset.id,path:asset.path,status:'ready',previewPaths:frames,metadata:{width:stream.width,height:stream.height,duration},error:null});return result;
    }catch(error){const current=store.get(id);const item=current.resources?.find(value=>value.id===resourceId);if(item){item.error=error.message;item.status='unavailable';store.save(current);}if(signal?.aborted)throw error;return {...resource,status:'unavailable',error:error.message,previewPaths:[]};}
  })();locks.set(lock,work);try{return await work;}finally{locks.delete(lock);}
}
export function resourceContext(project){return (project.resources||[]).map(({content,previewPaths,...resource})=>({...resource,excerpt:content?.slice(0,800),previews:previewPaths||[],usedIn:(project.storyboard?.scenes||[]).filter(scene=>resource.assetId&&sceneAssetIds(scene).includes(resource.assetId)).map(scene=>scene.id)}));}
export function assessmentKey(resource){return createHash('sha256').update(JSON.stringify([resource.id,resource.assetId,resource.url,resource.path])).digest('hex').slice(0,16);}
export function validateAssessment(output,resources){
  const expected=new Set(resources.map(resource=>resource.id));if(output.resources.length!==expected.size||new Set(output.resources.map(item=>item.resourceId)).size!==expected.size)throw new Error('La valoración debe cubrir una vez cada candidato solicitado.');
  for(const item of output.resources){const resource=resources.find(candidate=>candidate.id===item.resourceId);if(!resource)throw new Error('La valoración menciona un recurso inexistente.');if(item.inspected&&!resource.previewPaths?.length)throw new Error('No se puede afirmar haber visto un recurso sin previsualización.');if(!item.inspected&&(item.recommendation==='use'||item.score!==null))throw new Error('Un recurso no inspeccionado no admite nota ni recomendación de uso.');}
  return output;
}
export function applyAssessment(project,output,task){for(const value of output.resources){const resource=project.resources?.find(item=>item.id===value.resourceId);if(!resource)throw new Error('Candidato inexistente.');resource.assessment={...value,key:assessmentKey(resource),at:now(),taskId:task.id,model:task.metrics?.model||project.runtime};resource.updatedAt=now();}}
