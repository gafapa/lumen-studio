import {settings,updateSettings,providerAvailability} from './settings.mjs';
import {extractDocument,retrieve} from './knowledge.mjs';
import {importMedia,callProvider,downloadMedia} from './providers.mjs';
import {Benchmarks} from './benchmarks.mjs';
import {mountCompletion} from './completion-routes.mjs';
import {archivePage,addResource,syncAssets,searchResources,prepareResource,resourceContext} from './resources.mjs';
import {sceneAssetIds} from './design-media.mjs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {capabilitiesFor} from './capabilities.mjs';
import {mountCode} from './code-routes.mjs';
import {mountCollections} from './collection-routes.mjs';
import {CollectionAgents} from './collection-agents.mjs';
import {syncCollection} from './library-sync.mjs';

export function mountExtensions(app,{store,harness,desktop}){
  mountCompletion(app,{store,harness});
  const agents=new CollectionAgents(store,harness,desktop);
  harness.onAgentEvent=(videoId,kind,event,sceneId)=>agents.activity(videoId,kind,event,sceneId);
  const code=mountCode(app,{store,harness,desktop,libraryResearch:(owner,options)=>agents.research(owner,options),onCollectionChange:cid=>syncCollection(store,cid,id=>harness.folder(id),harness.active)});
  mountCollections(app,{store,harness,agents});
  const benchmarks=new Benchmarks(store,harness),route=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(error){next(error);}},exists=(req,res,next)=>store.get(req.params.id)?next():res.status(404).json({error:'Proyecto inexistente.'});
  app.get('/api/settings',(req,res)=>res.json({...settings(store),providers:providerAvailability(store)}));
  app.put('/api/settings',route(async(req,res)=>res.json(updateSettings(store,req.body))));
  app.post('/api/documents/extract',route(async(req,res)=>res.json(await extractDocument(req.body))));
  app.get('/api/experiments',(req,res)=>res.json(benchmarks.list()));
  app.post('/api/experiments',route(async(req,res)=>res.status(201).json(await benchmarks.create(req.body))));
  app.post('/api/experiments/:id/run',route(async(req,res)=>res.json(benchmarks.run(req.params.id))));
  app.post('/api/experiments/:id/pause',route(async(req,res)=>res.json(await benchmarks.pause(req.params.id))));
  app.patch('/api/projects/:id/config',exists,route(async(req,res)=>res.json(await harness.configure(req.params.id,req.body))));
  app.get('/api/projects/:id/capabilities',exists,route(async(req,res)=>res.json(await capabilitiesFor(store,store.get(req.params.id),'storyboard'))));
  app.get('/api/projects/:id/versions',exists,(req,res)=>res.json(store.snapshots(req.params.id)));
  app.post('/api/projects/:id/versions',exists,route(async(req,res)=>{if(harness.active.has(req.params.id))throw new Error('Espera a que termine el proyecto.');const {project,...metadata}=store.snapshot(store.get(req.params.id),String(req.body.label||'Versión manual').slice(0,200));res.json(metadata);}));
  app.post('/api/projects/:id/versions/:versionId/restore',exists,route(async(req,res)=>res.json(await harness.restore(req.params.id,req.params.versionId))));
  app.post('/api/projects/:id/artifacts/:taskId/approve',exists,route(async(req,res)=>res.json(await harness.approveArtifact(req.params.id,req.params.taskId))));
  app.get('/api/projects/:id/knowledge',exists,route(async(req,res)=>res.json(retrieve(store,req.params.id,String(req.query.q||store.get(req.params.id).prompt),Number(req.query.limit)||6))));
  const resourceAction=async(id,action,params,signal=AbortSignal.timeout(180000))=>{
    if(action==='resource-add'){if(!store.get(id).options?.webResearch)throw new Error('Activa la investigación web para registrar candidatos externos.');return addResource(store,id,{kind:params.kind,url:params.url,name:String(params.name||'Recurso encontrado').slice(0,200),sourceUrl:params.sourceUrl||params.url,author:params.author,license:params.license,licenseUrl:params.licenseUrl,origin:'agent'});}
    if(action==='resource-search')return searchResources(store,id,params,signal);
    if(action==='resource-preview'){const resource=await prepareResource(store,id,params.resourceId,harness.folder(id),signal);return {resource,images:await Promise.all((resource.previewPaths||[]).map(async frame=>({mimeType:'image/jpeg',data:(await readFile(path.join(harness.folder(id),frame.path))).toString('base64'),resourceId:resource.id,time:frame.time})))};}
    if(action==='web')return archivePage(store,id,params.url,{signal});
    throw new Error('Herramienta desconocida.');
  };
  app.post('/api/projects/:id/web-source',exists,route(async(req,res)=>{if(harness.active.has(req.params.id))throw new Error('Espera a que termine la etapa en curso.');await resourceAction(req.params.id,'web',req.body);await harness.export(req.params.id);res.json(store.get(req.params.id));}));
  app.get('/api/projects/:id/resources',exists,(req,res)=>{syncAssets(store,req.params.id);res.json(resourceContext(store.get(req.params.id)));});
  for(const action of ['add','search','preview'])app.post('/api/projects/:id/resources/'+action,exists,route(async(req,res)=>{if(harness.active.has(req.params.id))throw new Error('Espera a que termine la etapa en curso.');await resourceAction(req.params.id,'resource-'+action,req.body);await harness.export(req.params.id);res.json(store.get(req.params.id));}));
  app.post('/api/projects/:id/resources/review',exists,route(async(req,res)=>res.json(await harness.reviewResources(req.params.id))));
  app.patch('/api/projects/:id/resources/:resourceId',exists,route(async(req,res)=>{
    const id=req.params.id;if(harness.active.has(id))throw new Error('Espera a que termine la etapa en curso.');let project=store.get(id),resource=project.resources?.find(item=>item.id===req.params.resourceId);if(!resource||!['use','reserve','reject',null].includes(req.body.decision))throw new Error('Recurso o decisión inválidos.');store.snapshot(project,'Antes de seleccionar un recurso');resource.decision=req.body.decision;store.save(project);
    if(resource.decision==='reject'&&resource.assetId)for(const scene of project.storyboard?.scenes||[])if(sceneAssetIds(scene).includes(resource.assetId)){const layers=scene.composition?.layers?.filter(layer=>layer.media?.assetId!==resource.assetId);await harness.updateScene(id,scene.id,{...(scene.visual?.assetId===resource.assetId?{visual:{...scene.visual,assetId:null}}:{}),...(layers?{composition:layers.length?{...scene.composition,layers}:null}:{})});}
    await harness.export(id);res.json(store.get(id));
  }));
  app.post('/api/projects/:id/stage/approve',exists,route(async(req,res)=>res.json(await harness.approveStage(req.params.id))));
  app.post('/api/projects/:id/assets',exists,route(async(req,res)=>{if(harness.active.has(req.params.id))throw new Error('Espera a que termine el proyecto.');const project=store.get(req.params.id);store.snapshot(project,'Antes de importar recurso');const asset=await importMedia(req.body,harness.folder(project.id));project.assets||=[];project.assets.push(asset);store.save(project);syncAssets(store,project.id);code.indexPending(project.id);await harness.export(project.id);res.json(store.get(project.id));}));
  app.post('/api/projects/:id/assets/generate',exists,route(async(req,res)=>{if(harness.active.has(req.params.id))throw new Error('Espera a que termine el proyecto.');const project=store.get(req.params.id);if(!project.options?.externalMedia)throw new Error('Activa proveedores externos en este proyecto.');const provider=settings(store).providers.find(item=>item.id===req.body.providerId&&item.enabled);if(!provider)throw new Error('Proveedor no disponible.');const result=await callProvider(provider,{prompt:String(req.body.prompt||'').slice(0,4000),duration:project.duration},AbortSignal.timeout(300000),{store,projectId:project.id,scope:'manual:'+String(req.body.requestId||req.body.prompt)});const file=await downloadMedia(result.url,harness.folder(project.id),AbortSignal.timeout(90000));const asset={id:crypto.randomUUID(),name:String(req.body.prompt).slice(0,100),...file,kind:file.mime.startsWith('image/')?'image':file.mime.startsWith('audio/')?'music':'video',providerId:provider.id,credit:result.credit,createdAt:new Date().toISOString()};project.assets||=[];project.assets.push(asset);store.save(project);await harness.export(project.id);res.json(project);}));
  app.post('/api/internal/project',route(async(req,res)=>{const token=req.headers.authorization?.replace(/^Bearer /,'');const authorization=desktop.tokens.get(token);if(!authorization||authorization.projectId!==req.body.projectId)return res.status(403).json({error:'Sesión de agente no autorizada.'});
    if(authorization.collectionId){const collection=store.getCollection(authorization.collectionId);if(!collection)return res.status(404).json({error:'Proyecto inexistente.'});if(code.AGENT_ACTIONS.has(req.body.action))return res.json(await code.agentAction(authorization,req.body.action,req.body.params||{}));if(req.body.action==='capabilities')return res.json(await capabilitiesFor(store,(await import('./collection-agents.mjs')).collectionAsProject(collection),authorization.kind));if(req.body.action==='knowledge')return res.json((collection.sources||[]).map(source=>({name:source.name,text:source.content.slice(0,4000)})));if(req.body.action==='assets')return res.json({assets:collection.assets||[],resources:[],recordings:[]});throw new Error('Herramienta no disponible para agentes de proyecto.');}const project=store.get(authorization.projectId);if(req.body.action==='capabilities')return res.json(await capabilitiesFor(store,project,authorization.kind||'storyboard'));if(req.body.action==='knowledge')return res.json(retrieve(store,project.id,String(req.body.params?.query||project.prompt),6));if(req.body.action==='assets')return res.json({assets:project.assets||[],resources:resourceContext(project),recordings:project.recordings||[]});if(['web','resource-add','resource-search','resource-preview'].includes(req.body.action)){const result=await resourceAction(project.id,req.body.action,req.body.params||{});await harness.export(project.id);return res.json(result);}if(code.AGENT_ACTIONS.has(req.body.action))return res.json(await code.agentAction(authorization,req.body.action,req.body.params||{}));throw new Error('Herramienta desconocida.');}));
  return benchmarks;
}
