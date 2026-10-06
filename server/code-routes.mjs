// Rutas de material indexado y escenas programadas: las usa la interfaz y, mediante MCP, los agentes.
import path from 'node:path';
import {readFile,readdir,stat} from 'node:fs/promises';
import {mediaItems,findMedia,queueIndex,mediaInfo,searchMedia,mediaFrames,describeShots,cleanCut,removeBackground,detectBeats,runHyperframes} from './media-index.mjs';
import {sceneTexts,replaceSceneText,isCodeScene,workspaceDir,sceneBrief,lintScene,checkScene,snapshotScene,sourceFiles,listHistory,trustFiles,prepareWorkspace,writeSourceFile,snapshotSources,sourceHash} from './scene-code.mjs';
import {link,copyFile,mkdir,rm,rename} from 'node:fs/promises';
import {collectionAsProject,kitBriefFor} from './collection-agents.mjs';
import {collectionFolder,collectionStore} from './library-sync.mjs';
import {kindFor,processItem,libraryItems,libraryItem,searchLibrary,readItem,addFromUrl,addText} from './project-library.mjs';
import {settings} from './settings.mjs';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const UPLOAD_KINDS={image:['.png','.jpg','.jpeg','.webp','.gif'],video:['.mp4','.webm','.mov','.mkv','.m4v'],audio:['.wav','.mp3','.ogg','.m4a','.aac','.flac']};

// Imágenes para el agente reducidas a 768 px en JPEG: unas tres veces menos tokens que el fotograma completo.
const image=async(file)=>{try{const {default:sharp}=await import('sharp');return {mimeType:'image/jpeg',data:(await sharp(file).resize({width:768,withoutEnlargement:true}).jpeg({quality:80}).toBuffer()).toString('base64')};}catch{return {mimeType:'image/png',data:(await readFile(file)).toString('base64')};}};
// Resumen de la verificación para el agente: lo accionable, sin muestras ni rutas internas.
const brief=item=>({severity:item.severity,rule:item.rule||null,...(item.file?{file:item.file,line:item.line}:{}),...(item.time!=null?{time:item.time}:{}),message:String(item.message||'').slice(0,220)});
const trimIssues=report=>({ok:report.ok,stage:report.stage,issues:(report.issues||[]).filter(item=>item.severity!=='note').slice(0,12).map(brief),lint:report.lint?{ok:report.lint.ok,errors:report.lint.errors.slice(0,10).map(brief),warnings:report.lint.warnings.slice(0,6).map(brief)}:undefined});

export function mountCode(app,{store,harness,desktop,libraryResearch=()=>{throw new Error('Investigación no disponible.');},onCollectionChange}={}){
  const route=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(error){next(error);}},exists=(req,res,next)=>store.get(req.params.id)?next():res.status(404).json({error:'Proyecto inexistente.'});
  const folder=id=>harness.folder(id);
  const indexPending=id=>{const project=store.get(id);if(!project)return;for(const item of mediaItems(project))if(!project.mediaIndex?.[item.id])queueIndex(store,id,folder(id),item.id);};
  desktop.onRecording=projectId=>indexPending(projectId);

  function sceneContext(project,sceneId){
    const scene=project.storyboard?.scenes.find(item=>item.id===sceneId);if(!scene)throw new Error('Escena inexistente.');if(!isCodeScene(scene))throw new Error('La escena no está programada en código.');
    const media=project.tasks.find(task=>task.kind==='scene'&&task.sceneId===sceneId&&task.output)?.output;if(!media)throw new Error('La escena todavía no tiene voz y subtítulos.');
    return {scene,media,dir:workspaceDir(folder(project.id),sceneId),brief:sceneBrief(project,scene,media)};
  }
  async function placeInWorkspace(project,sceneId,asset,folder=id=>harness.folder(id)){
    if(!sceneId)return null;const dir=workspaceDir(folder(project.id),sceneId),target=path.join(dir,'assets','media',path.basename(asset.path));
    await mkdir(path.dirname(target),{recursive:true});try{await stat(target);}catch{try{await link(path.join(folder(project.id),asset.path),target);}catch{await copyFile(path.join(folder(project.id),asset.path),target);}}
    return 'assets/media/'+path.basename(asset.path);
  }

  // Acciones que los agentes ejecutan por MCP. sceneId llega en la autorización, nunca del modelo.
  async function agentAction(authorization,action,params={}){
    const collectionMode=Boolean(authorization.collectionId),collection=collectionMode?store.getCollection(authorization.collectionId):null;
    const project=collectionMode?collectionAsProject(collection):store.get(authorization.projectId),id=project.id,sceneId=authorization.sceneId||null;
    const owner=collectionMode?collectionStore(store):store,folder=collectionMode?(cid=>collectionFolder(store,cid)):(vid=>harness.folder(vid)),coder=['scene-code','kit-designer'].includes(authorization.kind);
    const context=()=>{const base=authorization.kind==='kit-designer'?kitBriefFor(store,collection,authorization.engine||'hyperframes'):sceneContext(project,sceneId);return authorization.workspace?{...base,dir:authorization.workspace}:base;};
    if(action.startsWith('scene-')){
      if(!coder||!sceneId)throw new Error('Herramienta disponible solo para el programador de escena o del kit.');
      const {dir,brief}=context();
      if(action==='scene-lint')return lintScene(dir,brief);
      if(action==='scene-check')return trimIssues(await checkScene(dir,brief,AbortSignal.timeout(900000)));
      if(action==='scene-snapshot'){const frames=await snapshotScene(dir,brief,Array.isArray(params.at)?params.at.map(Number):[],AbortSignal.timeout(900000));return {frames:frames.map(frame=>({time:frame.time,path:frame.path})),images:await Promise.all(frames.map(frame=>image(frame.path)))};}
      if(action==='scene-files')return {files:await sourceFiles(dir)};
    }
    if(action==='hyperframes-catalog'){const result=await runHyperframes(['catalog',...(params.query?[String(params.query).slice(0,200)]:[]),...(params.tag?['--tag',String(params.tag).slice(0,60)]:[]),'--json'],{timeout:120000});const start=result.stdout.search(/[[{]/);if(start<0)throw new Error('No se pudo consultar el catálogo: '+(result.stderr||result.stdout).slice(-400));const items=JSON.parse(result.stdout.slice(start));return {items:(Array.isArray(items)?items:items.items||[]).slice(0,30)};}
    if(action==='hyperframes-add'){
      if(!coder||!sceneId)throw new Error('Solo el programador de una escena HyperFrames o del kit puede añadir componentes.');
      const {dir,scene}=context();if(scene.engine!=='hyperframes')throw new Error('El catálogo pertenece a HyperFrames.');
      if(!/^[a-z0-9][a-z0-9-]{0,80}$/.test(params.name||''))throw new Error('Nombre de componente inválido.');
      const before=new Set(await sourceFiles(dir));
      const result=await runHyperframes(['add',params.name,'--dir',dir,'--json','--no-clipboard'],{timeout:180000});
      if(result.code!==0)throw new Error('No se pudo añadir: '+(result.stderr||result.stdout).slice(-600));
      const written=(await sourceFiles(dir)).filter(file=>!before.has(file));await trustFiles(dir,written);
      const start=result.stdout.indexOf('{');let summary=null;try{summary=JSON.parse(result.stdout.slice(start));}catch{}
      return {name:params.name,written,snippet:summary?.snippet||summary?.include||null,summary};
    }
    if(action==='sfx-list'){const dir=path.join(root,'assets','sfx');return {sfx:(await readdir(dir)).map(file=>'sfx/'+file),note:'En HyperFrames: assets/sfx/<archivo>. En Remotion: staticFile("sfx/<archivo>").'};}
    if(action==='media-list')return {media:mediaItems(project).map(item=>({...item,index:project.mediaIndex?.[item.id]||{status:'pending'}}))};
    if(action==='media-search')return {hits:await searchMedia(project,folder(id),String(params.query||'').slice(0,300))};
    if(action==='media-info'){const info=await mediaInfo(project,folder(id),params.mediaId,{from:Number(params.from)||0,to:params.to==null?Infinity:Number(params.to)});const images=info.contactSheet&&params.includeSheet!==false?[await image(info.contactSheet,'image/jpeg')]:[];return images.length?{...info,images}:info;}
    if(action==='media-frames'){const frames=await mediaFrames(project,folder(id),params.mediaId,(params.times||[]).map(Number));return {frames:frames.map(frame=>({time:frame.time})),images:await Promise.all(frames.map(frame=>image(frame.path,'image/jpeg')))};}
    if(action==='media-describe')return describeShots(folder(id),params.mediaId,Array.isArray(params.shots)?params.shots:[]);
    if(action==='media-index'){findMedia(project,params.mediaId);await queueIndex(owner,id,folder(id),params.mediaId);return owner.get(id).mediaIndex?.[params.mediaId];}
    if(action==='media-clean-cut'){const result=await cleanCut(owner,id,folder(id),params.mediaId,{minSilence:params.minSilence??0.45,removeFillers:params.removeFillers!==false});return {...result,workspaceFile:await placeInWorkspace(owner.get(id),sceneId,result.asset,folder)};}
    if(action==='media-remove-background'){const result=await removeBackground(owner,id,folder(id),params.mediaId);return {...result,workspaceFile:await placeInWorkspace(owner.get(id),sceneId,result.asset,folder)};}
    if(action==='media-beats')return detectBeats(project,folder(id),params.mediaId);
    if(action==='library-list')return {items:libraryItems(project).map(({path:file,...item})=>({...item,file}))};
    if(action==='library-search')return {hits:await searchLibrary(store,project,[id,...(project.collectionId&&project.collectionId!==id?[project.collectionId]:[])],folder(id),String(params.query||'').slice(0,300))};
    if(action==='library-read')return readItem(project,folder(id),params.id,params);
    if(action==='library-find-media'){
      if(!['library-researcher','research','storyboard'].includes(authorization.kind))throw new Error('Solo los agentes de investigación buscan multimedia.');
      const {searchCandidates}=await import('./resources.mjs'),kind=params.kind||'image',providers=params.provider?[params.provider]:kind==='audio'?['openverse']:kind==='video'?['commons','pexels']:['commons','openverse'];
      const pexels=settings(store).providers.find(item=>item.enabled&&item.adapter==='pexels'),results=[],errors=[];
      for(const provider of providers){if(provider==='pexels'&&!pexels){if(params.provider)errors.push('Pexels no está configurado en Conexiones.');continue;}try{results.push(...await searchCandidates(store,{query:String(params.query||''),kind,provider:provider==='pexels'?pexels.id:provider},AbortSignal.timeout(45000)));}catch(error){errors.push(provider+': '+error.message);}}
      return {candidates:results.slice(0,16).map(({query,...item})=>item),errors,hint:results.length?'Añade los adecuados con library_add_url (url, name, sourceUrl, author, license, licenseUrl y expect).':'Sin resultados: prueba términos en inglés, más genéricos, u otro proveedor.'};
    }
    if(['library-add-url','library-add-text'].includes(action)){
      if(!['library-researcher','research','storyboard'].includes(authorization.kind))throw new Error('Solo los agentes de investigación pueden añadir recursos.');
      const asset=action==='library-add-url'?await addFromUrl(owner,id,folder(id),{...params,domains:settings(store).allowedDomains},AbortSignal.timeout(120000)):await addText(owner,id,folder(id),params);
      await processItem(owner,id,folder(id),asset.id,{db:store});if(collectionMode)onCollectionChange?.(id);return {added:asset,index:owner.get(id).mediaIndex?.[asset.id]||null};
    }
    throw new Error('Herramienta desconocida.');
  }
  const AGENT_ACTIONS=new Set(['library-list','library-search','library-read','library-find-media','library-add-url','library-add-text','scene-lint','scene-check','scene-snapshot','scene-files','hyperframes-catalog','hyperframes-add','sfx-list','media-list','media-search','media-info','media-frames','media-describe','media-index','media-clean-cut','media-remove-background','media-beats']);

  // ---------- Biblioteca del vídeo (incluye lo heredado del proyecto) ----------
  app.get('/api/projects/:id/library',exists,(req,res)=>res.json(libraryItems(store.get(req.params.id))));
  app.get('/api/projects/:id/library/:itemId',exists,route(async(req,res)=>{const video=store.get(req.params.id),item=await libraryItem(video,folder(video.id),req.params.itemId);if(item.contactSheet)item.contactSheet=path.relative(folder(video.id),item.contactSheet).replaceAll('\\','/');res.json(item);}));
  app.get('/api/projects/:id/library-search',exists,route(async(req,res)=>{const video=store.get(req.params.id);res.json(await searchLibrary(store,video,[video.id,...(video.collectionId?[video.collectionId]:[])],folder(video.id),String(req.query.q||'')));}));
  app.post('/api/projects/:id/library/research',exists,route(async(req,res)=>{if(harness.active.has(req.params.id))throw new Error('Espera a que termine la producción.');res.json(libraryResearch({kind:'video',id:req.params.id},{brief:String(req.body?.brief||'').slice(0,4000)}));}));
  app.delete('/api/projects/:id/library/:itemId',exists,route(async(req,res)=>{const video=store.get(req.params.id),asset=(video.assets||[]).find(item=>item.id===req.params.itemId);if(!asset)throw new Error('Recurso inexistente.');if(asset.scope==='project')throw new Error('Este recurso pertenece al proyecto: bórralo desde la biblioteca del proyecto.');video.assets=video.assets.filter(item=>item.id!==asset.id);if(video.mediaIndex)delete video.mediaIndex[asset.id];store.save(video);await rm(path.join(folder(video.id),asset.path),{force:true});res.json({deleted:true});}));

  // ---------- Interfaz ----------
  // Subida en streaming (hasta 4 GB) para grabaciones y material largo; el audio puede ser voz o música.
  app.post('/api/projects/:id/assets/upload',exists,route(async(req,res)=>{
    if(harness.active.has(req.params.id))throw new Error('Espera a que termine la producción.');
    const name=String(req.query.name||'archivo').slice(0,200),extension=path.extname(name).toLowerCase(),kind=kindFor(extension,req.query.role);
    if(!kind)throw new Error('Formato no compatible. Usa imágenes, vídeo, audio, documentos (pdf, txt, md, html) o datos (csv, tsv, json).');
    const limit=4*1024**3,declared=Number(req.headers['content-length']||0);if(declared>limit)throw new Error('El archivo supera 4 GB.');
    const file='media/upload-'+randomUUID()+extension,target=path.join(folder(req.params.id),file),temp=target+'.part';await mkdir(path.dirname(target),{recursive:true});
    let size=0;req.on('data',chunk=>{size+=chunk.length;if(size>limit)req.destroy(new Error('El archivo supera 4 GB.'));});
    try{await pipeline(req,createWriteStream(temp));if(size<16)throw new Error('Archivo vacío.');await rename(temp,target);}catch(error){await rm(temp,{force:true});throw error;}
    const project=store.get(req.params.id);store.snapshot(project,'Antes de importar material');
    const asset={id:randomUUID(),name,path:file,kind,size,createdAt:new Date().toISOString(),origin:'upload'};
    project.assets||=[];project.assets.push(asset);store.save(project);processItem(store,project.id,folder(project.id),asset.id,{db:store});await harness.export(project.id);res.json(store.get(project.id));
  }));
  app.get('/api/projects/:id/media',exists,(req,res)=>{const project=store.get(req.params.id);res.json(mediaItems(project).map(item=>({...item,index:project.mediaIndex?.[item.id]||{status:'pending'}})));});
  app.post('/api/projects/:id/media/index-all',exists,route(async(req,res)=>{indexPending(req.params.id);res.json({queued:true});}));
  app.post('/api/projects/:id/media/:mediaId/index',exists,route(async(req,res)=>{findMedia(store.get(req.params.id),req.params.mediaId);queueIndex(store,req.params.id,folder(req.params.id),req.params.mediaId);res.json(store.get(req.params.id).mediaIndex[req.params.mediaId]);}));
  app.get('/api/projects/:id/media/:mediaId',exists,route(async(req,res)=>{const info=await mediaInfo(store.get(req.params.id),folder(req.params.id),req.params.mediaId);if(info.contactSheet)info.contactSheet=path.relative(folder(req.params.id),info.contactSheet).replaceAll('\\','/');res.json(info);}));
  app.get('/api/projects/:id/media-search',exists,route(async(req,res)=>res.json(await searchMedia(store.get(req.params.id),folder(req.params.id),String(req.query.q||'')))));
  for(const [action,operation] of [['clean-cut',(id,mediaId,body)=>cleanCut(store,id,folder(id),mediaId,{minSilence:Number(body.minSilence)||0.45,removeFillers:body.removeFillers!==false})],['remove-background',(id,mediaId)=>removeBackground(store,id,folder(id),mediaId)],['beats',(id,mediaId)=>detectBeats(store.get(id),folder(id),mediaId)]])
    app.post(`/api/projects/:id/media/:mediaId/${action}`,exists,route(async(req,res)=>{if(harness.active.has(req.params.id))throw new Error('Espera a que termine la producción.');const result=await operation(req.params.id,req.params.mediaId,req.body||{});await harness.export(req.params.id);res.json(result);}));

  app.get('/api/projects/:id/scenes/:sceneId/code',exists,route(async(req,res)=>{
    const project=store.get(req.params.id),scene=project.storyboard?.scenes.find(item=>item.id===req.params.sceneId);if(!scene)throw new Error('Escena inexistente.');
    const dir=workspaceDir(folder(project.id),scene.id),files=[];
    for(const file of await sourceFiles(dir)){if(file.startsWith('vendor/')||file==='gsap.min.js')continue;const info=await stat(path.join(dir,file));files.push({path:file,size:info.size,content:info.size<200000?await readFile(path.join(dir,file),'utf8'):null});}
    const read=async name=>{try{return JSON.parse(await readFile(path.join(dir,name),'utf8'));}catch{return null;}};
    let snapshots=[];try{const runs=(await readdir(path.join(dir,'snapshots'))).sort().reverse();if(runs[0])snapshots=(await readdir(path.join(dir,'snapshots',runs[0]))).filter(file=>file.endsWith('.png')).map(file=>`code/${scene.id}/snapshots/${runs[0]}/${file}`);}catch{}
    res.json({sceneId:scene.id,engine:scene.engine||'json',task:project.tasks.find(task=>task.id==='code-'+scene.id)||null,files,history:await listHistory(dir),lint:await read('lint.json'),check:await read('check.json'),snapshots});
  }));
  // Edición manual del código de una escena: se comprueba y, si es válida, el segmento se vuelve a renderizar.
  app.put('/api/projects/:id/scenes/:sceneId/code/file',exists,route(async(req,res)=>{
    if(harness.active.has(req.params.id))throw new Error('Detén la producción antes de editar el código.');
    const project=store.get(req.params.id),{dir,brief}=sceneContext(project,req.params.sceneId),file=await writeSourceFile(dir,req.body?.path,req.body?.content),lint=await lintScene(dir,brief);
    if(lint.ok){await snapshotSources(dir,'Editado a mano '+file);const latest=store.get(project.id),task=latest.tasks.find(item=>item.id==='code-'+req.params.sceneId);if(task?.output){task.output={...task.output,sourceHash:await sourceHash(dir),editedByHand:true};if(latest.tasks.some(item=>item.id==='render'))harness.invalidate(latest,'render');latest.status='draft';store.save(latest);await harness.export(latest.id);}}
    res.json({file,lint});
  }));
  app.get('/api/projects/:id/scenes/:sceneId/texts',exists,route(async(req,res)=>{const {dir}=sceneContext(store.get(req.params.id),req.params.sceneId);res.json(await sceneTexts(dir));}));
  app.put('/api/projects/:id/scenes/:sceneId/texts',exists,route(async(req,res)=>{
    if(harness.active.has(req.params.id))throw new Error('Detén la producción antes de editar textos.');
    const project=store.get(req.params.id),{dir,brief}=sceneContext(project,req.params.sceneId),result=await replaceSceneText(dir,String(req.body?.from||''),String(req.body?.to??''),{all:req.body?.all===true}),lint=await lintScene(dir,brief);
    if(!lint.ok){const {restoreHistory,listHistory}=await import('./scene-code.mjs');const last=(await listHistory(dir))[0];if(last)await restoreHistory(dir,last.id);throw new Error('El cambio rompe la escena y se ha deshecho: '+lint.errors.slice(0,2).map(error=>error.message).join(' | '));}
    await snapshotSources(dir,'Texto cambiado a mano');const latest=store.get(project.id),task=latest.tasks.find(item=>item.id==='code-'+req.params.sceneId);if(task?.output){task.output={...task.output,sourceHash:await sourceHash(dir),editedByHand:true};if(latest.tasks.some(item=>item.id==='render'))harness.invalidate(latest,'render');latest.status='draft';store.save(latest);await harness.export(latest.id);}
    res.json({...result,lint});}));
  app.post('/api/projects/:id/scenes/:sceneId/engine-version',exists,route(async(req,res)=>res.json(await harness.restoreEngineVersion(req.params.id,req.params.sceneId,String(req.body?.engine||'')))));
  app.post('/api/projects/:id/scenes/:sceneId/variants',exists,route(async(req,res)=>res.json(await harness.sceneVariants(req.params.id,req.params.sceneId,{count:Number(req.body?.count)||2,instruction:String(req.body?.instruction||'').slice(0,2000),engine:req.body?.engine||null}))));
  app.post('/api/projects/:id/scenes/:sceneId/variants/:variantId/choose',exists,route(async(req,res)=>res.json(await harness.chooseSceneVariant(req.params.id,req.params.sceneId,req.params.variantId))));
  app.delete('/api/projects/:id/scenes/:sceneId/variants',exists,route(async(req,res)=>res.json(await harness.discardSceneVariants(req.params.id,req.params.sceneId))));
  app.post('/api/projects/:id/scenes/:sceneId/exemplar',exists,route(async(req,res)=>res.json(await harness.saveSceneExemplar(req.params.id,req.params.sceneId,{note:String(req.body?.note||'')}))));
  app.post('/api/projects/:id/storyboard/approve',exists,route(async(req,res)=>res.json(await harness.approveStoryboard(req.params.id))));
  app.post('/api/projects/:id/storyboard/redo',exists,route(async(req,res)=>res.json(await harness.redoStoryboard(req.params.id,String(req.body?.instruction||'').slice(0,4000)))));
  app.post('/api/projects/:id/scenes/:sceneId/instruct',exists,route(async(req,res)=>res.json(await harness.instructScene(req.params.id,req.params.sceneId,req.body||{}))));
  app.post('/api/projects/:id/scenes/:sceneId/code/restore',exists,route(async(req,res)=>res.json(await harness.restoreCode(req.params.id,req.params.sceneId,String(req.body?.historyId||'')))));
  app.post('/api/projects/:id/scenes/:sceneId/code/snapshot',exists,route(async(req,res)=>{
    if(harness.active.has(req.params.id))throw new Error('Espera a que termine la producción.');
    const {dir,brief}=sceneContext(store.get(req.params.id),req.params.sceneId);
    const frames=await snapshotScene(dir,brief,Array.isArray(req.body?.at)?req.body.at.map(Number):[],AbortSignal.timeout(900000));
    res.json(frames.map(frame=>({time:frame.time,path:path.relative(folder(req.params.id),frame.path).replaceAll('\\','/')})));
  }));
  app.post('/api/projects/:id/scenes/:sceneId/code/prepare',exists,route(async(req,res)=>{const project=store.get(req.params.id),{scene,media}=sceneContext(project,req.params.sceneId);const {dir}=await prepareWorkspace(project,scene,media,folder(project.id));res.json({files:await sourceFiles(dir)});}));
  return {agentAction,AGENT_ACTIONS,indexPending};
}
