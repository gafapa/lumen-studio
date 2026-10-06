import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,rename,readFile} from 'node:fs/promises';
import path from 'node:path';
import {invoke,runtimeStatus} from './runtimes.mjs';
import {validate,validateCreate} from './schemas.mjs';
import {produceScene,renderProject,technicalReview} from './media.mjs';
import {saveKnowledge,retrieve} from './knowledge.mjs';
import {settings,providerAvailability} from './settings.mjs';
import {capabilitiesFor,capabilitiesForRole} from './capabilities.mjs';
import {validateSceneMedia} from './design-media.mjs';
import {producePart,composeScene} from './media-parts.mjs';
import {reviewAudio} from './audio-review.mjs';
import {archiveResearch,archivePage,syncAssets,resourceContext,prepareResource,assessmentKey,validateAssessment,applyAssessment} from './resources.mjs';
export const approvalKinds=['research','resource-review','script','storyboard','production-plan','screencast','scene','voice','visual','captions','scene-code'];
import {defaultProductionPlan,validateProductionPlan} from './production-plan.mjs';
import {CODE_ENGINES,isCodeScene,prepareWorkspace,checkScene,snapshotSources,sourceFiles,sourceHash,workspaceDir,listHistory,restoreHistory,sceneBrief,lintScene} from './scene-code.mjs';
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {kokoroPython} from './media-index.mjs';
import {syncLibrary} from './library-sync.mjs';
import {installKit,kitsOf,kitOf,resolveSceneComponent} from './collection-agents.mjs';
import {recentLooks,looksBrief,lookRepeat,recordLook} from './looks.mjs';
import {budgetState} from './receipt.mjs';
import {execute} from './process.mjs';
import ffmpeg from 'ffmpeg-static';
// Tareas que no llaman a modelos: siguen aunque se alcance el límite de gasto.
const MECHANICAL_TASKS=new Set(['voice','visual','captions','scene','render','technical-review','audio-review']);
import {runScenePipeline,createVariants,chooseVariant,discardVariants,saveExemplar,archiveWorkspace,restoreEngineVersion} from './scene-pipeline.mjs';
import {effectiveSettings,INHERITED_KEYS,inheritedHash,collectionContext,roleSettings,stable} from './collections.mjs';
const require_pitfalls=root=>readFileSync(path.join(root,'pitfalls.json'),'utf8');
const writeFileSyncSafe=(file,data)=>{const temp=file+'.'+process.pid+'.tmp';writeFileSync(temp,data);renameSync(temp,file);};
export function descendants(tasks,id){const affected=new Set([id]);let changed=true;while(changed){changed=false;for(const task of tasks)if(task.dependencies.some(dep=>affected.has(dep))&&!affected.has(task.id)){affected.add(task.id);changed=true;}}return affected;}
export function runnable(tasks){return tasks.filter(task=>task.status==='pending'&&task.dependencies.every(id=>tasks.find(dep=>dep.id===id)?.status==='completed'));}
export class Harness {
  constructor(store,desktop,{runtimeInvoke=invoke,sceneProducer=produceScene,partProducer=producePart,compositor=composeScene,audioReviewer=reviewAudio,renderer=renderProject,mediaReviewer=technicalReview}={}){this.store=store;this.desktop=desktop;this.runtimeInvoke=runtimeInvoke;this.sceneProducer=sceneProducer;this.partProducer=partProducer;this.compositor=compositor;this.audioReviewer=audioReviewer;this.renderer=renderer;this.mediaReviewer=mediaReviewer;this.active=new Map();this.exports=new Map();this.variantRuns=new Map();}
  folder(id){return path.join(this.store.root,'projects',id);}
  async regeneratePart(id,sceneId,part,{start=true,words}={}){
    if(this.active.has(id))throw new Error('Detén el proyecto antes de regenerar un recurso.');if(!['voice','visual','captions'].includes(part))throw new Error('Recurso inválido.');const project=this.store.get(id),scene=project.storyboard?.scenes.find(item=>item.id===sceneId);if(!scene)throw new Error('Escena inexistente.');this.store.snapshot(project,'Antes de regenerar '+part);
    if(part==='voice'&&project.captionOverrides)delete project.captionOverrides[sceneId];
    if(words){let end=0;if(part!=='captions'||!Array.isArray(words)||words.length>3000||words.some(word=>typeof word.text!=='string'||!word.text.trim()||!Number.isFinite(word.start)||!Number.isFinite(word.end)||word.start<end||(end=word.end)<=word.start||word.end>Math.max(scene.duration,project.tasks.find(task=>task.sceneId===sceneId&&task.output?.speechDuration)?.output.speechDuration||0)+1))throw new Error('Subtítulos: texto y tiempos consecutivos válidos requeridos.');project.captionOverrides||={};project.captionOverrides[sceneId]=words;}
    project.resourceVersions||={};project.resourceVersions[sceneId]||={};project.resourceVersions[sceneId][part]=(project.resourceVersions[sceneId][part]||0)+1;
    const task=project.tasks.find(item=>item.kind===part&&item.sceneId===sceneId)||project.tasks.find(item=>item.kind==='scene'&&item.sceneId===sceneId);if(task)this.invalidate(project,task.id);project.status='draft';project.audioReview=null;this.store.save(project);this.store.event(id,'resource.regenerated',{sceneId,part});await this.export(id);return start?this.run(id):project;
  }
  async approvePart(id,sceneId,part){const project=this.store.get(id);if(!['voice','visual','captions'].includes(part))throw new Error('Recurso inválido.');const component=project.tasks.find(task=>task.kind===part&&task.sceneId===sceneId&&task.status==='completed'),scene=project.tasks.find(task=>task.kind==='scene'&&task.sceneId===sceneId&&task.status==='completed'),key=component?.output?.key||scene?.output?.partKeys?.[part];if(!key)throw new Error('El recurso todavía no está preparado.');project.approvals||={};project.approvals[key]={at:new Date().toISOString(),sceneId,part};if(component)component.approved=true;if(scene&&['voice','visual','captions'].every(kind=>project.approvals[scene.output.partKeys?.[kind]]))scene.approved=true;this.store.save(project);await this.export(id);return project;}
  async timeline(id,scenes){if(this.active.has(id))throw new Error('Detén la producción antes de editar el timeline.');const project=this.store.get(id),existing=new Map(project.storyboard?.scenes.map(scene=>[scene.id,scene]));if(!Array.isArray(scenes)||scenes.length!==existing.size||new Set(scenes.map(scene=>scene.id)).size!==existing.size||scenes.some(scene=>!existing.has(scene.id)))throw new Error('El timeline debe conservar todas las escenas, una vez cada una.');if(scenes.every((scene,index)=>project.storyboard.scenes[index].id===scene.id&&project.storyboard.scenes[index].duration===scene.duration))return project;const board={...project.storyboard,scenes:scenes.map(scene=>({...existing.get(scene.id),duration:scene.duration}))};validate('storyboard',board);this.store.snapshot(project,'Antes de editar timeline');for(const scene of board.scenes)if(scene.duration!==existing.get(scene.id).duration){this.invalidate(project,`media-${scene.id}`);const codeTask=project.tasks.find(task=>task.id==='code-'+scene.id);if(codeTask)codeTask.feedback={instruction:`La duración de la escena ha cambiado a ${scene.duration} s. Reajusta los tiempos de la composición sin cambiar su diseño.`};}project.storyboard=board;const task=project.tasks.find(task=>task.kind==='storyboard');if(task)task.output=structuredClone(board);if(project.tasks.some(task=>task.id==='render'))this.invalidate(project,'render');project.status='draft';this.store.save(project);await this.export(id);return project;}
  applyProduction(project,value){this.applyProductionBase(project,value);this.attachQualityTasks(project);}
  applyProductionBase(project,value){validateProductionPlan(value,{...project,availableProviders:providerAvailability(this.store).filter(item=>item.ready),availableProviderIds:providerAvailability(this.store).filter(item=>item.ready).map(item=>item.id)});project.productionPlan=value;project.tasks=[...project.tasks.filter(task=>!['voice','visual','captions','scene','render','technical-review','audio-review','final-review'].includes(task.kind)),...value.tasks.map(task=>({...task,dependencies:[...new Set([...task.dependencies,...(task.kind==='voice'||task.kind==='visual'?['production-director']:[])])],status:'pending',attempts:0,output:null,error:null,...(task.kind==='scene'?{sceneInput:structuredClone(project.storyboard.scenes.find(scene=>scene.id===task.sceneId))}:{})}))];delete project.previousProduction;this.attachCodeTasks(project);}
  attachCodeTasks(project){
    const existing=new Map(project.tasks.filter(task=>task.kind==='scene-code').map(task=>[task.id,task])),codeIds=[];
    project.tasks=project.tasks.filter(task=>task.kind!=='scene-code');
    for(const scene of project.storyboard?.scenes||[]){
      if(!isCodeScene(scene))continue;const id='code-'+scene.id,previous=existing.get(id);codeIds.push(id);
      const reuse=previous?.status==='completed'&&JSON.stringify(previous.sceneInput)===JSON.stringify(scene);
      project.tasks.push(reuse?{...previous,dependencies:['media-'+scene.id]}:{id,kind:'scene-code',sceneId:scene.id,role:'programador',label:'Programar · '+scene.title,instruction:'Programa la escena con '+scene.engine,dependencies:['media-'+scene.id],status:'pending',attempts:0,output:null,error:null,feedback:previous&&previous.status!=='completed'?previous.feedback||null:null,version:(previous?.version||0)+1});
    }
    const render=project.tasks.find(task=>task.id==='render');if(render)render.dependencies=[...new Set([...render.dependencies.filter(dep=>!dep.startsWith('code-')),...codeIds])];
  }
  pitfalls(limit=12){try{return JSON.parse(require_pitfalls(this.store.root)).sort((a,b)=>b.count-a.count).slice(0,limit).map(item=>item.text);}catch{return [];}}
  recordPitfalls(texts){if(!texts.length)return;const file=path.join(this.store.root,'pitfalls.json');let list=[];try{list=JSON.parse(require_pitfalls(this.store.root));}catch{}for(const text of texts){const clean=String(text).replace(/\s+/g,' ').trim().slice(0,300);if(!clean)continue;const found=list.find(item=>item.text===clean);if(found){found.count++;found.at=new Date().toISOString();}else list.push({text:clean,count:1,at:new Date().toISOString()});}list=list.sort((a,b)=>b.count-a.count).slice(0,200);writeFileSyncSafe(file,JSON.stringify(list,null,2));}
  codeScene(id,task,signal){return runScenePipeline(this,id,task,signal);}
  sceneVariants(id,sceneId,options){return createVariants(this,id,sceneId,options);}
  chooseSceneVariant(id,sceneId,variantId){return chooseVariant(this,id,sceneId,variantId);}
  discardSceneVariants(id,sceneId){return discardVariants(this,id,sceneId);}
  saveSceneExemplar(id,sceneId,options){return saveExemplar(this,id,sceneId,options);}
  async instructScene(id,sceneId,{instruction,engine,remember=false}={}){
    if(this.active.has(id))throw new Error('Detén la producción antes de pedir un cambio.');
    if(typeof instruction!=='string'||instruction.trim().length<3||instruction.length>4000)throw new Error('Describe el cambio que quieres (3–4000 caracteres).');
    let project=this.store.get(id),scene=project.storyboard?.scenes.find(item=>item.id===sceneId);if(!scene)throw new Error('Escena inexistente.');
    if(!isCodeScene(scene)){if(!CODE_ENGINES.includes(engine))throw new Error('Elige HyperFrames, Remotion, Manim o Revideo para programar esta escena.');await this.updateScene(id,sceneId,{engine});project=this.store.get(id);}
    else if(engine&&engine!==scene.engine)throw new Error('Para cambiar de motor, edita la escena; el código actual pertenece a '+scene.engine+'.');
    this.store.snapshot(project,'Antes de pedir un cambio en '+sceneId);
    let task=project.tasks.find(item=>item.id==='code-'+sceneId);if(!task){this.attachCodeTasks(project);task=project.tasks.find(item=>item.id==='code-'+sceneId);}
    if(!task)throw new Error('Genera primero la producción del vídeo.');
    this.invalidate(project,task.id);task.feedback={instruction:instruction.trim()};project.revisions.push({type:'instruction',at:new Date().toISOString(),sceneId,message:instruction.trim()});
    if(remember&&project.collectionId){const collection=this.store.getCollection(project.collectionId);if(collection){collection.notes=[...(collection.notes||[]),{id:randomUUID(),text:instruction.trim().slice(0,500),at:new Date().toISOString(),source:'Indicación en «'+project.title+'»'}].slice(-200);this.store.saveCollection(collection);}}project.status='draft';this.store.save(project);this.store.event(id,'scene.instruction',{sceneId,message:instruction.trim()});await this.export(id);return this.run(id);
  }
  async applyKit(id){
    if(this.active.has(id))throw new Error('Detén la producción antes de aplicar el kit.');
    const project=this.store.get(id),collection=project?.collectionId&&this.store.getCollection(project.collectionId);if(!Object.values(kitsOf(collection)).some(kit=>kit?.version))throw new Error('El proyecto no tiene kit.');
    let updated=0;
    for(const task of project.tasks.filter(item=>item.kind==='scene-code'&&item.status==='completed'&&item.output)){
      const scene=project.storyboard.scenes.find(item=>item.id===task.sceneId),dir=workspaceDir(this.folder(id),task.sceneId);
      if(!scene||!kitOf(collection,scene.engine)?.version||task.output.kitVersion===kitOf(collection,scene.engine).version)continue;
      const kit=await installKit(this.store,collection,dir,scene.engine);if(!kit)continue;
      const media=project.tasks.find(item=>item.kind==='scene'&&item.sceneId===scene.id)?.output;
      if(media){const lint=await lintScene(dir,sceneBrief(project,scene,media));if(!lint.ok){this.store.event(id,'kit.apply-failed',{sceneId:scene.id,message:lint.errors.slice(0,3).map(error=>error.message).join(' | ')});continue;}}
      task.output={...task.output,kitVersion:kit.version,sourceHash:await sourceHash(dir)};updated++;
    }
    if(updated&&project.tasks.some(item=>item.id==='render'))this.invalidate(project,'render');
    if(updated)project.status='draft';this.store.save(project);this.store.event(id,'kit.applied',{message:`Kit aplicado a ${updated} escenas.`});await this.export(id);return {updated};
  }
  // Comprueba con los códigos sellados que la revisión final abrió las imágenes.
  async reviewerLooked(id,output){try{const {checkSeenCodes}=await import('./review-pack.mjs'),codes=JSON.parse(await readFile(path.join(this.folder(id),'review','.codes.json'),'utf8'));return checkSeenCodes(codes.map(code=>({code})),output?.seenCodes).ok;}catch{return true;}}
  // Amplía el límite de gasto un 50 % y continúa la producción.
  async continueBudget(id){if(this.active.has(id))throw new Error('La producción sigue en marcha.');const project=this.store.get(id);if(!project)throw new Error('Proyecto inexistente.');project.budgetExtra=(project.budgetExtra||0)+0.5;project.awaiting=null;project.status='draft';this.store.save(project);this.store.event(id,'budget.extended',{message:'Límite de gasto ampliado un 50 %.'});return this.run(id);}
  async approveStoryboard(id){
    if(this.active.has(id))throw new Error('Espera a que termine la etapa en curso.');
    const project=this.store.get(id);if(!project.storyboard)throw new Error('Todavía no hay storyboard.');
    project.storyboardApprovedAt=new Date().toISOString();project.awaiting=null;const board=project.tasks.find(task=>task.kind==='storyboard');if(board)board.approved=true;this.store.save(project);this.store.event(id,'storyboard.approved',{message:'Storyboard aprobado: empieza la programación de las escenas.'});await this.export(id);return this.run(id);
  }
  async redoStoryboard(id,instruction){
    if(this.active.has(id))throw new Error('Espera a que termine la etapa en curso.');
    if(typeof instruction!=='string'||instruction.trim().length<3)throw new Error('Describe qué enfoque quieres.');
    const project=this.store.get(id),board=project.tasks.find(task=>task.kind==='storyboard');if(!board)throw new Error('Todavía no hay storyboard.');
    this.store.snapshot(project,'Antes de pedir otro enfoque');this.invalidate(project,board.id);board.feedback={approved:false,summary:'Petición del usuario',issues:[{severity:'error',sceneId:null,message:instruction.trim()}],scope:'Rehaz el storyboard aplicando esta petición; conserva lo que no contradiga.'};project.storyboardApprovedAt=null;project.status='draft';this.store.save(project);await this.export(id);return this.run(id);
  }
  async codeHistory(id,sceneId){const dir=workspaceDir(this.folder(id),sceneId);return listHistory(dir);}
  async restoreCode(id,sceneId,historyId){
    if(this.active.has(id))throw new Error('Detén la producción antes de restaurar código.');
    const project=this.store.get(id),scene=project.storyboard?.scenes.find(item=>item.id===sceneId),task=project.tasks.find(item=>item.id==='code-'+sceneId);if(!scene||!task)throw new Error('La escena no tiene código.');
    const dir=workspaceDir(this.folder(id),sceneId),meta=await restoreHistory(dir,historyId);
    const media=project.tasks.find(item=>item.kind==='scene'&&item.sceneId===sceneId)?.output;
    if(media){const lint=await lintScene(dir,sceneBrief(project,scene,media));if(!lint.ok)throw new Error('La versión restaurada no supera el lint: '+lint.errors.slice(0,3).map(error=>error.message).join(' | '));}
    if(task.output)task.output={...task.output,sourceHash:await sourceHash(dir),historyId:meta.id,restoredAt:new Date().toISOString()};
    if(project.tasks.some(item=>item.id==='render'))this.invalidate(project,'render');project.status='draft';this.store.save(project);this.store.event(id,'scene.code-restored',{sceneId,message:'Código restaurado: '+meta.label});await this.export(id);return project;
  }
  async create(input){
    let collection=null,overrides=null;
    if(input.collectionId){collection=this.store.getCollection(input.collectionId);if(!collection)throw new Error('Proyecto inexistente.');overrides=input.overrides||{};const {values}=effectiveSettings(collection,overrides);const {collectionId,overrides:_,...rest}=input;input={...Object.fromEntries(INHERITED_KEYS.map(key=>[key,values[key]])),...rest,sources:[...(collection.sources||[]),...(rest.sources||[])].slice(0,10)};}
    validateCreate(input);input={...input,authoring:input.authoring||(input.runtime==='demo'?'json':'code'),options:collection?input.options:{autonomousProduction:input.runtime!=='demo',audioReview:input.runtime!=='demo',...input.options}};const id=randomUUID();
    const project={id,renderer:'remotion',...input,profile:collection?input.profile:{visualIntensity:'cinematic',...(input.runtime!=='demo'&&kokoroPython()?{voice:'kokoro:ef_dora'}:{}),...input.profile},title:input.prompt.replace(/^(crea|genera|haz)\s+(un\s+)?v[ií]deo\s+(sobre\s+)?/i,'').slice(0,85),status:'draft',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),tasks:[],storyboard:null,recordings:[],assets:[],resources:[],approvals:{},sessions:{},metrics:{calls:0,inputTokens:0,outputTokens:0,durationMs:0,unknownUsageCalls:0},revisions:[],review:null,render:null,error:null};
    if(collection){project.collectionId=collection.id;project.overrides=overrides;project.inheritedHash=inheritedHash(project);}
    await mkdir(this.folder(id),{recursive:true});this.store.save(project);if(collection)await syncLibrary(this.store,id,videoId=>this.folder(videoId));await saveKnowledge(this.store,this.store.get(id),this.folder(id));await this.export(id);return this.store.get(id);
  }
  async export(id){
    const operation=(this.exports.get(id)||Promise.resolve()).catch(()=>{}).then(async()=>{
      const project=this.store.get(id),artifacts={'project.json':project,'storyboard.json':project.storyboard,'script.json':project.tasks.find(task=>task.kind==='script')?.output||null,'assets.json':project.tasks.filter(task=>task.kind==='scene'&&task.output).map(task=>task.output),'render.json':project.render,'resources.json':project.resources||[]};
      for(const [name,data] of Object.entries(artifacts)){const temp=path.join(this.folder(id),`${name}.${randomUUID()}.tmp`);await writeFile(temp,JSON.stringify(data,null,2));await rename(temp,path.join(this.folder(id),name));}
    });this.exports.set(id,operation);try{await operation;}finally{if(this.exports.get(id)===operation)this.exports.delete(id);}
  }
  async run(id){
    if(this.store.get(id)?.collectionId&&!this.active.has(id))await syncLibrary(this.store,id,videoId=>this.folder(videoId));
    const project=this.store.get(id);if(!project)throw new Error('Proyecto inexistente.');if(this.active.has(id))return project;
    if([...this.variantRuns.keys()].some(key=>key.startsWith(id+':')))throw new Error('Espera a que terminen las variantes de escena antes de producir.');
    project.error=null;this.store.save(project);
    if(project.runtime!=='demo'){const status=await runtimeStatus();if(!status[project.runtime]?.authenticated)throw new Error(`Inicia sesión en ${project.runtime==='codex'?'Codex':'Claude Code'} antes de generar.`);}
    const controller=new AbortController();this.active.set(id,controller);
    const operation=this.execute(id,controller.signal).catch(error=>{const latest=this.store.get(id);latest.status=controller.signal.aborted?'paused':'failed';latest.error=controller.signal.aborted?null:error.message;this.store.save(latest);this.store.event(id,'project.failed',{message:error.message});}).finally(async()=>{this.active.delete(id);await this.export(id).catch(()=>{});});
    this.active.set(id,{controller,operation});return this.store.get(id);
  }
  async pause(id){const running=this.active.get(id);if(running){(running.controller||running).abort();await running.operation;}const project=this.store.get(id);if(project){project.status='paused';for(const task of project.tasks)if(task.status==='running')task.status='pending';this.store.save(project);this.store.event(id,'project.paused',{message:'Ejecución detenida. Los artefactos aceptados se conservan.'});}return project;}
  async modelTask(id,task,kind,signal){
    let project=this.store.get(id);
    let reviewResources=[];
    if(kind==='resource-review'){
      for(const resourceId of task.resourceIds||[])reviewResources.push(await prepareResource(this.store,id,resourceId,this.folder(id),signal));
      project=this.store.get(id);
    }
    const dependencyArtifacts=Object.fromEntries(task.dependencies.map(dep=>[dep,project.tasks.find(item=>item.id===dep)?.output]).filter(([,output])=>output));
    const needsSources=project.context==='full'||['plan','research','review'].includes(kind)||!Object.keys(dependencyArtifacts).length;
    const query=project.prompt+' '+task.instruction,fragments=[...retrieve(this.store,id,query,6),...retrieve(this.store,'lib:'+id,query,4),...(project.collectionId?retrieve(this.store,'lib:'+project.collectionId,query,4):[])];
    const shared=project.options?.sharedKnowledge?(await import('./library.mjs')).retrieveLibrary(this.store,project.prompt+' '+task.instruction):[];
    const capabilities=capabilitiesForRole(await capabilitiesFor(this.store,project,kind),kind);
    const previousLooks=kind==='storyboard'?looksBrief(await recentLooks(this.store,project).catch(()=>[])):undefined;
    const extraContext=kind==='fact-check'?{storyboard:project.storyboard,library:(project.assets||[]).map(asset=>({id:asset.id,name:asset.name,kind:asset.kind,author:asset.author||asset.credit?.author||null,license:asset.license||asset.credit?.license||null,sourceUrl:asset.sourceUrl||asset.credit?.url||null}))}:kind==='publish'?{storyboard:{title:project.storyboard?.title,scenes:(project.storyboard?.scenes||[]).map(scene=>({id:scene.id,title:scene.title,narration:scene.narration}))},render:{duration:project.render?.duration,segments:(project.render?.segments||[]).map(segment=>({sceneId:segment.sceneId,start:segment.start,duration:segment.duration}))},posters:project.tasks.filter(item=>item.kind==='scene-code'&&item.output?.critique?.poster!=null).map(item=>({sceneId:item.sceneId,start:(project.render?.segments||[]).find(segment=>segment.sceneId===item.sceneId)?.start??null,poster:item.output.critique.poster})),previous:project.publication||null}:{};
    const context={previousLooks,...extraContext,capabilities,projectFolder:this.folder(id),sharedLibrary:shared,sources:needsSources?(project.context==='full'?project.sources:fragments.length?fragments.map(fragment=>({id:fragment.sourceId,name:fragment.name,content:fragment.text})):project.sources):[],knowledge:fragments,artifacts:project.context==='full'?Object.fromEntries(project.tasks.filter(item=>item.output).map(item=>[item.id,item.output])):dependencyArtifacts,feedback:task.feedback||null,assets:project.assets||[],resources:resourceContext(project),...(kind==='resource-review'?{reviewResources:reviewResources.map(({content,...resource})=>resource),frames:reviewResources.flatMap(resource=>(resource.previewPaths||[]).map(frame=>({...frame,path:path.join(this.folder(id),frame.path)})))}:{}),providers:capabilities.media?.providers||[],...(kind==='production-plan'?{storyboard:project.storyboard,productionExample:defaultProductionPlan(project,project.tasks.find(task=>task.kind==='storyboard').id)}:{}),...(kind==='final-review'?{render:project.render,audio:project.audioReview,technical:project.technicalReview,storyboard:project.storyboard,frames:(project.technicalReview?.reviewFrames||project.technicalReview?.frames||[]).map(frame=>({...frame,path:path.join(this.folder(id),frame.path)}))}:{}),...(['plan','storyboard'].includes(kind)?{recordings:project.recordings.filter(item=>item.status==='completed').slice(-8)}:{})};
    const attemptDir=path.join(this.folder(id),'runs',task.id,`${Date.now()}-attempt-${task.attempts}`);
    const nativePages=new Set();let token=null;const actor=`${task.id}:${randomUUID()}`;
    if(kind==='screencast')this.desktop.acquire(id,actor);
    if(kind==='screencast'||kind==='storyboard'||kind==='fact-check'||project.architecture==='tools'){token=randomUUID();this.desktop.tokens?.set(token,{projectId:id,actor,kind});}
    try{const result=await this.runtimeInvoke({kind,project:{...project,mcpServers:settings(this.store).mcpServers,allowedDomains:settings(this.store).allowedDomains,collectionContext:collectionContext(project.collectionId&&this.store.getCollection(project.collectionId))},task,context,attemptDir,signal,mcpToken:token,onEvent:event=>{
      const nativeWeb=/WebSearch|WebFetch|web_search|web_fetch/.test(JSON.stringify(event.item?.name||event.item?.type||event.item?.action||event.message?.content?.filter(item=>item.type==='tool_use')||''));
      if(nativeWeb){const visit=value=>{if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){if((key==='url'||key==='urls')&&typeof item==='string'&&/^https?:\/\//.test(item))nativePages.add(item);else visit(item);}};visit(event);}
      const interesting=event.item?.type||event.type;if(['command_execution','mcp_tool_call','tool_use'].includes(interesting)||event.type==='assistant')this.store.event(id,'runtime.event',{taskId:task.id,event});}});if(kind==='resource-review'){validate('resource-review',result.output);validateAssessment(result.output,reviewResources);}
      if(project.options?.webResearch)for(const url of [...nativePages].slice(0,30)){try{await archivePage(this.store,id,url,{taskId:task.id,signal});}catch(error){if(signal.aborted)throw error;this.store.event(id,'resource.warning',{taskId:task.id,message:error.message});}}
      if(kind==='screencast'&&!this.store.get(id).recordings.some(item=>item.id===result.output.recordingId&&item.status==='completed'))throw new Error('El operador no ha devuelto una grabación válida del proyecto.');if(result.metrics?.sessionId&&project.options?.persistent&&kind!=='screencast'){const current=this.store.get(id);current.sessions||={};current.sessions[task.id]=result.metrics.sessionId;this.store.save(current);}return result;}
    finally{if(token)this.desktop.tokens?.delete(token);if(kind==='screencast')await this.desktop.release(id,actor);}
  }
  async execute(id,signal){
    let project=this.store.get(id);project.error=null;
    if(!project.tasks.some(task=>task.kind==='storyboard')){
      project.status='planning';this.store.save(project);this.store.event(id,'director.started',{message:'El director está decidiendo el plan y los agentes.'});
      let planned;for(let attempt=1;attempt<=2;attempt++){try{planned=await this.modelTask(id,{id:'director',role:'director',dependencies:[],attempts:attempt,instruction:attempt>1?'El plan anterior no fue válido. Corrige el contrato y las dependencias.':''},'plan',signal);break;}catch(error){if(signal.aborted||attempt===2)throw error;this.store.event(id,'director.retry',{message:error.message});}}
      validate('plan',planned.output);project=this.store.get(id);project.example=false;project.plan=planned.output;project.tasks=[...project.tasks.filter(task=>task.kind==='resource-review'),...planned.output.tasks.map(task=>({...task,status:'pending',attempts:0,output:null,metrics:null,error:null}))];
      if(project.tasks.some(task=>task.kind==='screencast')&&!project.desktop)throw new Error('El director solicitó control del PC, pero está desactivado.');
      this.addMetrics(project,planned.metrics);this.store.save(project);await writeFile(path.join(this.folder(id),'plan.json'),JSON.stringify(planned.output,null,2));this.store.event(id,'director.completed',{message:planned.output.reasoning});
    }
    project=this.store.get(id);for(const task of project.tasks)if(task.status==='failed'){task.status='pending';task.attempts=0;task.error=null;}project.status='running';project.executionStartedAt=new Date().toISOString();this.store.save(project);
    const inflight=new Map();let failed=null;
    while(!signal.aborted){
      project=this.store.get(id);
      this.ensureResourceReviews(project);project=this.store.get(id);
      const storyboardGate=project.options?.storyboardApproval&&project.authoring==='code'&&!project.storyboardApprovedAt;
      const budget=budgetState(project,settings(this.store).prices||{}),budgetGate=budget.exceeded;
      const ready=runnable(project.tasks).filter(task=>!(storyboardGate&&task.kind==='scene-code')&&!(budgetGate&&!MECHANICAL_TASKS.has(task.kind))&&!inflight.has(task.id)&&(task.kind!=='screencast'||!this.desktop.owner)&&(!project.options?.approvalGates||task.dependencies.every(dep=>{const dependency=project.tasks.find(item=>item.id===dep);return !approvalKinds.includes(dependency?.kind)||dependency.approved===true;})));
      for(const task of ready.slice(0,Math.max(0,project.concurrency-inflight.size))){
        const job=this.executeTask(id,task.id,signal).catch(error=>{failed=error;}).finally(()=>inflight.delete(task.id));inflight.set(task.id,job);
      }
      if(!inflight.size){
        project=this.store.get(id);
        if(project.tasks.every(task=>task.status==='completed')){project.status=project.tasks.some(task=>['review','final-review'].includes(task.kind)&&task.output?.approved===false)||project.technicalReview?.approved===false||project.audioReview?.approved===false?'needs-review':'completed';project.wallTimeMs=(project.wallTimeMs||0)+Date.now()-Date.parse(project.executionStartedAt);this.store.save(project);this.store.snapshot(project,'Producción terminada');if(project.status==='completed')recordLook(this.store,project).catch(()=>{});import('./receipt.mjs').then(({writeReceipt})=>writeReceipt(this.folder(id),this.store.get(id),{prices:settings(this.store).prices||{}})).catch(()=>{});this.store.event(id,'project.completed',{message:project.status==='completed'?'Tu vídeo está listo para revisar.':'Hay observaciones que requieren revisión.'});return;}
        if(failed){if(await this.replan(id,failed,signal)){failed=null;continue;}throw failed;}
        if(project.options?.approvalGates&&project.tasks.some(task=>task.status==='completed'&&approvalKinds.includes(task.kind)&&!task.approved)){project.status='needs-approval';this.store.save(project);this.store.event(id,'approval.required',{message:'Revisa y aprueba los artefactos antes de continuar.'});return;}
        if(budgetGate&&project.tasks.some(task=>task.status==='pending'&&!MECHANICAL_TASKS.has(task.kind))){project.status='needs-approval';project.awaiting='budget';this.store.save(project);this.store.event(id,'budget.reached',{message:`Se ha alcanzado el límite de gasto del vídeo (${budget.limitTokens?Math.round(budget.tokens/1e3)+' k de '+Math.round(budget.limitTokens/1e3)+' k tokens':''}${budget.limitCost?(budget.limitTokens?' · ':'')+(budget.cost??0).toFixed(2)+' de '+budget.limitCost+' $':''}). Amplía el límite para continuar.`});return;}
        if(storyboardGate&&project.tasks.some(task=>task.kind==='scene-code'&&task.status==='pending')){project.status='needs-approval';project.awaiting='storyboard';this.store.save(project);this.store.event(id,'storyboard.approval',{message:'Revisa los planos del storyboard y apruébalo para programar las escenas.'});return;}
        if(project.tasks.some(task=>task.kind==='screencast'&&task.status==='pending')&&this.desktop.owner){await new Promise(resolve=>setTimeout(resolve,500));continue;}
        throw new Error('Las tareas pendientes no pueden avanzar. Revisa sus dependencias.');
      }
      await Promise.race(inflight.values());if(failed){await Promise.all(inflight.values());if(await this.replan(id,failed,signal)){failed=null;continue;}throw failed;}
    }
    await Promise.all(inflight.values());throw new Error('Ejecución detenida.');
  }
  ensureResourceReviews(project){
    syncAssets(this.store,project.id);project=this.store.get(project.id);
    const board=project.tasks.find(task=>task.kind==='storyboard');if(!board||board.status!=='pending')return;
    const afterBoard=descendants(project.tasks,board.id),research=project.tasks.filter(task=>task.kind==='research'&&!afterBoard.has(task.id));
    let changed=false;
    for(const task of research)if(!board.dependencies.includes(task.id)){board.dependencies.push(task.id);changed=true;}
    if(research.every(task=>task.status==='completed')){
      const assigned=new Set(project.tasks.filter(task=>task.kind==='resource-review'&&task.status!=='failed').flatMap(task=>task.resourceIds||[]));
      const candidates=(project.resources||[]).filter(resource=>['image','video'].includes(resource.kind)&&resource.decision!=='reject'&&!assigned.has(resource.id)&&(!resource.assessment||resource.assessment.key!==assessmentKey(resource)));
      for(let i=0;i<candidates.length;i+=8){
        const taskId='resource-review-'+randomUUID().slice(0,8);project.tasks.push({id:taskId,kind:'resource-review',role:'revisor',label:'Valorar imágenes y vídeos · '+(i/8+1),instruction:'Selecciona los mejores recursos para la composición y justifica su uso.',resourceIds:candidates.slice(i,i+8).map(resource=>resource.id),dependencies:research.map(task=>task.id),status:'pending',attempts:0,output:null,error:null});board.dependencies.push(taskId);changed=true;
      }
      for(const task of project.tasks.filter(task=>task.kind==='resource-review'))if(!board.dependencies.includes(task.id)){board.dependencies.push(task.id);changed=true;}
    }
    if(changed)this.store.save(project);
  }
  async reviewResources(id){
    if(this.active.has(id))throw new Error('Espera a que termine la etapa en curso.');
    syncAssets(this.store,id);let project=this.store.get(id);
    const candidates=(project.resources||[]).filter(resource=>['image','video'].includes(resource.kind)&&resource.decision!=='reject');
    if(!candidates.length)throw new Error('Añade imágenes o vídeos antes de valorarlos.');
    if(project.runtime!=='demo'){const status=await runtimeStatus();if(!status[project.runtime]?.authenticated)throw new Error('Inicia sesión en el motor del proyecto.');}
    const previousStatus=project.status,controller=new AbortController(),taskIds=[];
    for(let i=0;i<candidates.length;i+=8){const taskId='resource-review-'+randomUUID().slice(0,8);taskIds.push(taskId);project.tasks.push({id:taskId,kind:'resource-review',role:'revisor',label:'Valorar recursos · '+(i/8+1),instruction:'Valora estos candidatos para la composición del vídeo.',resourceIds:candidates.slice(i,i+8).map(resource=>resource.id),dependencies:[],status:'pending',attempts:0,output:null,error:null});}
    project.status='running';this.store.save(project);
    const operation=(async()=>{for(const taskId of taskIds){controller.signal.throwIfAborted();await this.executeTask(id,taskId,controller.signal);}const current=this.store.get(id);current.status=current.options?.approvalGates?'needs-approval':previousStatus;this.store.save(current);})().catch(error=>{const current=this.store.get(id);current.status=controller.signal.aborted?'paused':'failed';current.error=controller.signal.aborted?null:error.message;this.store.save(current);}).finally(async()=>{this.active.delete(id);await this.export(id);});
    this.active.set(id,{controller,operation});return this.store.get(id);
  }
  async approveStage(id){
    if(this.active.has(id))throw new Error('Espera a que termine la etapa en curso.');
    const project=this.store.get(id),pending=project.tasks.filter(task=>task.status==='completed'&&approvalKinds.includes(task.kind)&&!task.approved);
    if(!pending.length)throw new Error('No hay una etapa pendiente de aprobación.');
    for(const task of pending)task.approved=true;this.store.save(project);this.store.event(id,'stage.approved',{taskIds:pending.map(task=>task.id),message:'Etapa revisada por el usuario.'});await this.export(id);return this.run(id);
  }
  addMetrics(project,metrics){if(metrics.kind){project.metrics.byRole||={};const role=project.metrics.byRole[metrics.kind]||={calls:0,inputTokens:0,outputTokens:0,cachedTokens:0,durationMs:0,model:null,effort:null};role.calls++;role.inputTokens+=metrics.inputTokens||0;role.outputTokens+=metrics.outputTokens||0;role.cachedTokens+=metrics.cachedTokens||0;role.durationMs+=metrics.durationMs||0;role.model=metrics.model||role.model;role.effort=metrics.effort||role.effort;}project.metrics.calls++;project.metrics.durationMs+=metrics.durationMs||0;project.metrics.contextBytes=(project.metrics.contextBytes||0)+(metrics.contextBytes||0);project.metrics.cachedTokens=(project.metrics.cachedTokens||0)+(metrics.cachedTokens||0);if(metrics.inputTokens==null)project.metrics.unknownUsageCalls++;else project.metrics.inputTokens+=metrics.inputTokens;project.metrics.outputTokens+=metrics.outputTokens||0;}
  async replan(id,error,signal){
    const current=this.store.get(id);if(signal.aborted||!current.options?.replan||current.runtime==='demo'||(current.replans||0)>=(current.options.maxReplans??2))return false;
    current.replans=(current.replans||0)+1;this.store.save(current);this.store.snapshot(current,'Antes de replanificar');
    const result=await this.modelTask(id,{id:`director-replan-${current.replans}`,role:'director',dependencies:current.tasks.filter(task=>task.status==='completed').map(task=>task.id),attempts:1,instruction:`Replanifica tras el fallo: ${error.message}. Preserva ids e instrucciones de las tareas aceptadas. Sustituye la tarea fallida o simplifica el contenido; no repitas el mismo plan. El plan sigue produciendo exactamente un storyboard.`},'plan',signal);
    validate('plan',result.output);const project=this.store.get(id);const old=new Map(project.tasks.map(task=>[task.id,task]));
    const changed=[];project.tasks=result.output.tasks.map(task=>{const accepted=old.get(task.id);if(accepted?.status==='completed'&&accepted.kind===task.kind&&accepted.instruction===task.instruction&&JSON.stringify(accepted.dependencies)===JSON.stringify(task.dependencies))return accepted;changed.push(task.id);return {...task,status:'pending',attempts:0,output:null,error:null};});
    for(const id of changed)this.invalidate(project,id);project.plan=result.output;project.status='running';this.addMetrics(project,result.metrics);const board=project.tasks.find(task=>task.kind==='storyboard'&&task.status==='completed');if(board){project.storyboard=board.output;this.materialize(project,board.id);}else{project.storyboard=null;project.render=null;}
    this.store.save(project);this.store.event(id,'director.replanned',{message:result.output.reasoning,attempt:project.replans});await this.export(id);return true;
  }
  async configure(id,changes,{replace=false}={}){
    if(this.active.has(id))throw new Error('Detén el proyecto antes de cambiar su configuración.');
    const project=this.store.get(id);
    const modeOnly=Object.keys(changes).length===1&&changes.options&&Object.keys(changes.options).length===1&&typeof changes.options.approvalGates==='boolean';
    if(modeOnly){project.options={...project.options,approvalGates:changes.options.approvalGates};if(project.status==='needs-approval'&&!changes.options.approvalGates)project.status='paused';this.store.save(project);this.store.event(id,'mode.changed',{mode:changes.options.approvalGates?'supervised':'automatic'});await this.export(id);return project;}
    if(!replace){for(const key of ['options','output','profile'])if(changes[key])changes[key]={...project[key],...changes[key]};
    if(changes.profile?.palette)changes.profile.palette={...project.profile?.palette,...changes.profile.palette};}
    if(Object.keys(changes).every(key=>stable(changes[key])===stable(project[key])))return project;
    const input=Object.fromEntries(Object.keys((await import('./schemas.mjs')).createSchema.properties).filter(key=>project[key]!==undefined).map(key=>[key,project[key]]));
    validateCreate({...input,...changes});this.store.snapshot(project,'Antes de cambiar configuración');
    const pipelineChanged=changes.options&&['autonomousProduction','audioReview','finalReview'].some(key=>Boolean(changes.options[key])!==Boolean(project.options?.[key]));
    const externalChanged=changes.options&&Boolean(changes.options.externalMedia)!==Boolean(project.options?.externalMedia);
    const voiceChanged=externalChanged||changes.profile&&changes.profile.voice!==project.profile?.voice;
    const visualChanged=externalChanged||changes.profile&&(changes.profile.imageStyle!==project.profile?.imageStyle||JSON.stringify(changes.profile.palette)!==JSON.stringify(project.profile?.palette));
    const logoChanged=changes.profile&&changes.profile.logoAssetId!==project.profile?.logoAssetId;
    Object.assign(project,changes);if(voiceChanged)project.captionOverrides={};
    if(logoChanged)for(const task of project.tasks.filter(task=>task.kind==='scene'))this.invalidate(project,task.id);
    if(voiceChanged||visualChanged)for(const task of project.tasks.filter(task=>task.kind==='scene'||task.kind==='voice'&&voiceChanged||task.kind==='visual'&&visualChanged))this.invalidate(project,task.id);
    if(project.tasks.some(task=>task.id==='render'))this.invalidate(project,'render');
    if(pipelineChanged){project.productionPlan=null;project.audioReview=null;project.finalReview=null;const board=project.tasks.find(task=>task.kind==='storyboard'&&task.status==='completed');if(board){project.tasks=project.tasks.filter(task=>!['production-plan','voice','visual','captions','scene','render','technical-review','audio-review','final-review'].includes(task.kind));this.materialize(project,board.id);}}
    project.status='draft';this.store.save(project);await this.export(id);return project;
  }
  async applyInheritance(id){
    const project=this.store.get(id),collection=project?.collectionId&&this.store.getCollection(project.collectionId);if(!collection)throw new Error('El vídeo no pertenece a un proyecto.');
    const {values}=effectiveSettings(collection,project.overrides||{}),changes=Object.fromEntries(INHERITED_KEYS.filter(key=>stable(values[key])!==stable(project[key])).map(key=>[key,values[key]]));
    if(!Object.keys(changes).length)return project;const updated=await this.configure(id,changes,{replace:true});const latest=this.store.get(id);latest.inheritedHash=inheritedHash(latest);this.store.save(latest);this.store.event(id,'inheritance.applied',{message:'Ajustes del proyecto aplicados: '+Object.keys(changes).join(', ')});return latest;
  }
  async setOverrides(id,overrides){
    const project=this.store.get(id),collection=project?.collectionId&&this.store.getCollection(project.collectionId);if(!collection)throw new Error('El vídeo no pertenece a un proyecto.');
    for(const key of Object.keys(overrides||{}))if(!INHERITED_KEYS.includes(key))throw new Error('Ajuste no heredable: '+key);
    project.overrides=overrides||{};this.store.save(project);return this.applyInheritance(id);
  }
  async restore(id,snapshotId){
    if(this.active.has(id))throw new Error('Detén el proyecto antes de restaurar.');const snapshot=this.store.getSnapshot(snapshotId,id);if(!snapshot)throw new Error('Versión inexistente.');this.store.snapshot(this.store.get(id),'Antes de restaurar');const restored=structuredClone(snapshot.project);restored.status=restored.render?'completed':'draft';restored.sessions={};for(const task of restored.tasks)if(task.status==='running')task.status='pending';this.store.save(restored);await saveKnowledge(this.store,restored,this.folder(id));this.store.event(id,'version.restored',{snapshotId,message:snapshot.label});await this.export(id);return restored;
  }
  async approveArtifact(id,taskId){const project=this.store.get(id),task=project.tasks.find(task=>task.id===taskId);if(!task||task.status!=='completed')throw new Error('El artefacto todavía no está terminado.');task.approved=true;task.approvedAt=new Date().toISOString();this.store.save(project);this.store.event(id,'artifact.approved',{taskId});await this.export(id);return project;}
  async executeTask(id,taskId,signal){
    for(let attempt=0;attempt<2;attempt++){
      let project=this.store.get(id),task=project.tasks.find(item=>item.id===taskId);const version=task.version||0;task.status='running';task.attempts++;task.startedAt=new Date().toISOString();this.store.save(project);this.store.event(id,'task.started',{taskId,message:task.label});
      try{
        let output,metrics=null;
        if(['voice','visual','captions','scene'].includes(task.kind)){const runtimeProject={...project,jobStore:this.store,providerConfig:settings(this.store).providers};if(task.providerId){if(task.kind==='voice')runtimeProject.profile={...project.profile,voice:'provider:'+task.providerId};else if(task.kind==='visual')runtimeProject.storyboard={...project.storyboard,scenes:project.storyboard.scenes.map(scene=>scene.id===task.sceneId?{...scene,visual:{...scene.visual,providerIds:[task.providerId]}}:scene)};}output=await (task.kind==='scene'?project.options?.autonomousProduction?this.compositor:this.sceneProducer:this.partProducer)(runtimeProject,task.sceneId,...(task.kind==='scene'?[]:[task.kind]),this.folder(id),signal,(type,data)=>this.store.event(id,type,data));}
        else if(task.kind==='render')output=await this.renderer(project,this.folder(id),signal,progress=>this.store.event(id,'render.progress',{progress}));
        else if(task.kind==='technical-review'){output=await this.mediaReviewer({...project,styleReference:(()=>{const collection=project.collectionId&&this.store.getCollection(project.collectionId),reference=collection?.styleReference;if(reference?.status!=='ready')return null;const dir=path.join(this.store.root,'collections',collection.id,'reference'),asset=(collection.assets||[]).find(item=>item.id===reference.assetId);return {name:reference.name,spec:reference.spec,dir,file:asset?path.join(this.store.root,'collections',collection.id,asset.path):null};})()},this.folder(id),signal);if(project.options?.audioReview&&!project.tasks.some(task=>task.kind==='audio-review'))output.audioReview=await this.audioReviewer(project,this.folder(id),signal);}
        else if(task.kind==='audio-review')output=await this.audioReviewer(project,this.folder(id),signal);
        else if(task.kind==='scene-code'){const result=await this.codeScene(id,task,signal);output=result.output;metrics=result.metrics;}
        else {let result=await this.modelTask(id,task,task.kind,signal);
          if(task.kind==='final-review'&&!(await this.reviewerLooked(id,result.output))){this.store.event(id,'final-review.retry',{message:'El revisor no demostró haber mirado las imágenes: se repite la revisión.'});result=await this.modelTask(id,{...task,instruction:(task.instruction||'')+' En el intento anterior no devolviste los códigos de las imágenes en seenCodes: abre cada imagen y devuélvelos.'},task.kind,signal);}
          output=result.output;metrics=result.metrics;}
        if(task.kind==='research')await archiveResearch(this.store,id,output,taskId,signal);
        project=this.store.get(id);task=project.tasks.find(item=>item.id===taskId);
        if(!task||(task.version||0)!==version)return;
        if(signal.aborted){task.status='pending';this.store.save(project);return;}
        task.status='completed';task.output=output;task.metrics=metrics;task.error=null;task.approved=false;task.completedAt=new Date().toISOString();if(['scene','scene-code'].includes(task.kind))task.sceneInput=structuredClone(project.storyboard.scenes.find(scene=>scene.id===task.sceneId));if(task.kind==='scene-code')task.feedback=null;if(metrics)this.addMetrics(project,metrics);
        if(task.kind==='resource-review')applyAssessment(project,output,task);
        if(task.kind==='storyboard'){project.storyboardApprovedAt=null;const collection=project.collectionId&&this.store.getCollection(project.collectionId);for(const [index,scene] of output.scenes.entries()){validateSceneMedia(project,scene);if(project.authoring!=='code')scene.engine='json';else if(!scene.engine)scene.engine='hyperframes';if(collection)output.scenes[index]=resolveSceneComponent(collection,scene);}
          {const introduced=new Map(),issues=[];output.scenes.forEach((scene,index)=>{for(const concept of scene.introduces||[])if(!introduced.has(concept.toLowerCase()))introduced.set(concept.toLowerCase(),index);});const prior=new Set();output.scenes.forEach((scene,index)=>{for(const concept of scene.uses||[]){const at=output.scenes.findIndex(item=>(item.introduces||[]).some(entry=>entry.toLowerCase()===concept.toLowerCase()));if(at<0)prior.add(concept);else if(at>index)issues.push({sceneId:scene.id,title:scene.title,concept,introducedIn:output.scenes[at].title});}});project.storyboardChecks={dependencies:issues,prior:[...prior]};}
          {const collection=project.collectionId&&this.store.getCollection(project.collectionId);project.lookCheck=await lookRepeat(this.store,{...project,storyboard:output},{kitComponents:Object.values(kitsOf(collection)).flatMap(kit=>(kit.components||[]).map(item=>item.name))}).catch(()=>null);}project.storyboard=output;project.title=output.title;this.materialize(project,taskId);}
        if(task.kind==='production-plan')this.applyProduction(project,output);
        if(['voice','visual','captions'].includes(task.kind)&&project.approvals?.[output.key])task.approved=true;
        if(task.kind==='scene'&&output.partKeys&&Object.values(output.partKeys).every(key=>project.approvals?.[key]))task.approved=true;
        if(task.kind==='render')project.render=output;
        if(task.kind==='audio-review')project.audioReview=output;
        if(task.kind==='technical-review'){project.technicalReview=output;if(output.audioReview)project.audioReview=output.audioReview;}
        if(task.kind==='fact-check'){project.factCheck=output;const wrong=output.claims.filter(claim=>claim.status==='wrong');
          if(wrong.length&&(project.factFixes||0)<1){const board=project.tasks.find(item=>item.kind==='storyboard');if(board){project.factFixes=(project.factFixes||0)+1;this.invalidate(project,board.id);board.feedback={approved:false,summary:'El verificador encontró datos incorrectos.',issues:wrong.map(claim=>({severity:'error',sceneId:claim.sceneId,message:`«${claim.claim}» es incorrecto. ${claim.evidence}${claim.fix?' Corrección: '+claim.fix:''}`})),scope:'Corrige solo estos datos; conserva todo lo demás del storyboard.'};this.store.event(id,'fact-check.correction',{message:`El verificador encontró ${wrong.length} datos incorrectos: el storyboard se corrige.`});}}}
        if(task.kind==='publish'){let poster=null;if(output.posterTime!=null&&project.render?.path){const file=`media/poster-${Date.now()}.png`;const result=await execute(ffmpeg,['-y','-v','error','-ss',String(Math.min(output.posterTime,(project.render.duration||1)-0.05)),'-i',path.join(this.folder(id),project.render.path),'-frames:v','1',path.join(this.folder(id),file)],{timeout:60000}).catch(()=>null);if(result?.code===0)poster=file;}project.publication={...output,poster,generatedAt:new Date().toISOString(),edited:false};}
        if(task.kind==='final-review'){
          // Prueba de mirada: sin los códigos de las imágenes, la revisión no puede aprobar.
          try{const {checkSeenCodes}=await import('./review-pack.mjs'),codes=JSON.parse(await readFile(path.join(this.folder(id),'review','.codes.json'),'utf8')),seen=checkSeenCodes(codes.map(code=>({code})),output.seenCodes);output.verified=seen.ok;if(!seen.ok){output.approved=false;output.summary='El revisor no demostró haber abierto las imágenes (devolvió '+seen.hits+' de '+seen.expected+' códigos): revisión no válida. '+output.summary;output.issues=[...output.issues,{severity:'warning',sceneId:null,message:'Revisión final sin prueba de mirada: repítela.'}];}}catch{}
          project.finalReview=output;const codeIssues=output.issues.filter(issue=>issue.sceneId&&isCodeScene(project.storyboard.scenes.find(scene=>scene.id===issue.sceneId)));this.recordPitfalls(codeIssues.map(issue=>issue.message));if(!output.approved&&(project.finalCorrections||0)<1){const codeTargets=new Set(codeIssues.filter(issue=>issue.severity==='error').map(issue=>issue.sceneId));if(codeTargets.size){project.finalCorrections=(project.finalCorrections||0)+1;for(const sceneId of codeTargets){const codeTask=project.tasks.find(item=>item.id==='code-'+sceneId);if(codeTask){const previousOutput=codeTask.output;this.invalidate(project,codeTask.id);codeTask.feedback={issues:codeIssues.filter(issue=>issue.sceneId===sceneId),fromFinalReview:true,previousOutput};}}this.store.event(id,'final-review.correction',{message:'La revisión final devuelve escenas programadas a su agente: '+[...codeTargets].join(', ')});}const targets=new Set(output.issues.filter(issue=>issue.severity==='error'&&issue.sceneId&&!codeTargets.has(issue.sceneId)).map(issue=>issue.sceneId));if(targets.size){project.finalCorrections=(project.finalCorrections||0)+1;const storyboard=project.tasks.find(item=>item.kind==='storyboard');this.invalidate(project,storyboard.id);storyboard.feedback={...output,scope:'Corrige únicamente las escenas señaladas; conserva las demás.'};this.store.event(id,'final-review.correction',{message:output.summary});}}}
        if(task.kind==='review'){
          const reviews=project.tasks.filter(item=>item.kind==='review'&&item.output).map(item=>item.output);
          project.review={approved:reviews.every(item=>item.approved),summary:reviews.map(item=>item.summary).join('\n\n'),issues:reviews.flatMap(item=>item.issues)};
          if(!output.approved&&project.revisions.filter(revision=>revision.type==='automatic').length<2){
            const target=task.dependencies.map(dep=>project.tasks.find(item=>item.id===dep)).find(item=>item.kind==='storyboard');
            if(target){project.revisions.push({type:'automatic',at:new Date().toISOString(),message:output.summary});this.invalidate(project,target.id);target.feedback=output;this.store.event(id,'review.correction',{message:'El revisor solicita una corrección del storyboard.'});}
          }
        }
        this.store.save(project);if(['visual','scene','screencast'].includes(task.kind))syncAssets(this.store,id);await mkdir(path.join(this.folder(id),'artifacts'),{recursive:true});await writeFile(path.join(this.folder(id),'artifacts',`${taskId}.json`),JSON.stringify(output,null,2));this.store.event(id,'task.completed',{taskId,message:task.label});await this.export(id);return;
      }catch(error){
        project=this.store.get(id);task=project.tasks.find(item=>item.id===taskId);if(!task||(task.version||0)!==version)return;task.error=error.message;task.status=signal.aborted?'pending':attempt===1?'failed':'pending';task.feedback={error:error.message};this.store.save(project);this.store.event(id,'task.retry',{taskId,message:error.message});if(signal.aborted)return;if(attempt===1)throw error;
      }
    }
  }
  reuseScene(project,task,scene){if(!task)return null;if(task.sceneInput&&JSON.stringify(task.sceneInput)!==JSON.stringify(scene))return null;if(task.cachedOutput&&task.sceneInput){task.output=task.cachedOutput;task.status='completed';delete task.cachedOutput;}return task;}
  // Tareas de calidad que se añaden a cualquier plan: verificar datos antes de producir y preparar la publicación al final.
  attachQualityTasks(project){
    if(project.runtime==='demo')return;const board=project.tasks.find(task=>task.kind==='storyboard');
    if(board&&project.options?.factCheck===true&&!project.tasks.some(task=>task.id==='fact-check'))project.tasks.push({id:'fact-check',kind:'fact-check',role:'verificador',label:'Verificar datos y licencias',instruction:'Comprueba cada dato, cifra, comando y licencia del storyboard contra las fuentes, la biblioteca y la web.',dependencies:[board.id],status:'pending',attempts:0,output:null,error:null});
    if(board&&project.tasks.some(task=>task.id==='fact-check'))for(const task of project.tasks)if(task.id!=='fact-check'&&['voice','visual','captions','scene','production-plan'].includes(task.kind)&&task.dependencies.includes(board.id)&&!task.dependencies.includes('fact-check'))task.dependencies.push('fact-check');
    const last=project.tasks.find(task=>task.id==='final-review')||project.tasks.find(task=>task.id==='technical-review'),publish=project.tasks.find(task=>task.id==='publish');
    if(last&&project.options?.publish===true&&!publish)project.tasks.push({id:'publish',kind:'publish',role:'publicación',label:'Preparar la publicación',instruction:'Propón título, descripción, capítulos, etiquetas y fotograma de miniatura.',dependencies:[last.id],status:'pending',attempts:0,output:null,error:null});
    else if(last&&publish&&!publish.dependencies.includes(last.id))publish.dependencies=[last.id];
  }
  materialize(project,storyboardId){
    if(project.options?.autonomousProduction){project.previousProduction=project.tasks.filter(task=>['voice','visual','captions','scene'].includes(task.kind));project.tasks=[...project.tasks.filter(task=>!['production-plan','voice','visual','captions','scene','render','technical-review','audio-review','final-review'].includes(task.kind)),{id:'production-director',kind:'production-plan',role:'director',label:'Planificar producción audiovisual',instruction:'Decide el DAG de producción para este storyboard usando las capacidades disponibles. Explica la delegación, el paralelismo y los proveedores elegidos. Puedes modificar el ejemplo; conserva las dependencias necesarias para garantizar recursos, render y revisión completos.',dependencies:[storyboardId],status:'pending',attempts:0,output:null,error:null}];this.attachQualityTasks(project);return;}
    const sceneIds=project.storyboard.scenes.map(scene=>`media-${scene.id}`);
    const cognitive=project.tasks.filter(task=>!['production-plan','voice','visual','captions','scene','render','technical-review','audio-review','final-review'].includes(task.kind));
    const existing=new Map(project.tasks.filter(task=>task.kind==='scene').map(task=>[task.id,task]));
    project.tasks=[...cognitive,...project.storyboard.scenes.map(scene=>this.reuseScene(project,existing.get(`media-${scene.id}`),scene)||{id:`media-${scene.id}`,label:`Producir · ${scene.title}`,role:'producción',kind:'scene',sceneId:scene.id,dependencies:[storyboardId,...(scene.type==='screencast'?cognitive.filter(task=>task.kind==='screencast').map(task=>task.id):[])],status:'pending',attempts:0,output:null,error:null}),
      {id:'render',label:'Renderizar el vídeo',role:'editor',kind:'render',dependencies:[...sceneIds,...cognitive.filter(task=>task.kind==='review').map(task=>task.id)],status:'pending',attempts:0,output:null,error:null},
      {id:'technical-review',label:'Comprobar el resultado',role:'revisor técnico',kind:'technical-review',dependencies:['render'],status:'pending',attempts:0,output:null,error:null},
      ...(project.options?.finalReview&&project.runtime!=='demo'?[{id:'final-review',label:'Revisar imágenes y contenido del MP4',role:'revisor',kind:'final-review',dependencies:['technical-review'],instruction:'Examina los fotogramas, transcripción y análisis técnico del resultado.',status:'pending',attempts:0,output:null,error:null}]:[])];
    this.attachCodeTasks(project);this.attachQualityTasks(project);
  }
  invalidate(project,id){const affected=descendants(project.tasks,id);for(const task of project.tasks)if(affected.has(task.id)){if(task.kind==='scene'&&task.output&&id!==task.id){task.cachedOutput=task.output;}if(id===task.id)delete task.cachedOutput;task.status='pending';task.approved=false;task.output=null;task.error=null;task.version=(task.version||0)+1;}if(affected.has('render'))project.render=null;if(affected.has('technical-review'))project.technicalReview=null;if(affected.has('audio-review'))project.audioReview=null;if(affected.has('final-review'))project.finalReview=null;return affected;}
  restoreEngineVersion(id,sceneId,engine){return restoreEngineVersion(this,id,sceneId,engine);}
  async updateScene(id,sceneId,changes){if(this.active.has(id))throw new Error('Detén la ejecución antes de editar una escena.');const project=this.store.get(id);const index=project?.storyboard?.scenes.findIndex(scene=>scene.id===sceneId);if(index==null||index<0)throw new Error('Escena inexistente.');
    // Cambiar de motor archiva la versión actual (code/<escena>@<motor>) para poder volver a ella sin reprogramar.
    {const current=project.storyboard.scenes[index];if(changes.engine&&changes.engine!==current.engine&&isCodeScene(current))await archiveWorkspace(this,project,sceneId,current.engine,project.tasks.find(task=>task.id==='code-'+sceneId)?.output);}let next={...project.storyboard.scenes[index],...changes,id:sceneId};{const collection=project.collectionId&&this.store.getCollection(project.collectionId);if(collection&&['component','newComponent','engine'].some(key=>Object.hasOwn(changes,key)))next=resolveSceneComponent(collection,Object.hasOwn(changes,'component')&&changes.component?{...next,newComponent:null}:next);}validate('storyboard',{...project.storyboard,scenes:project.storyboard.scenes.map((scene,i)=>i===index?next:scene)});validateSceneMedia(project,next);this.store.snapshot(project,'Antes de editar escena');project.storyboard.scenes[index]=next;const storyboardTask=project.tasks.find(task=>task.kind==='storyboard');if(storyboardTask){storyboardTask.output=structuredClone(project.storyboard);storyboardTask.approved=false;}if(changes.visual?.assetId&&project.resources?.some(resource=>resource.assetId===changes.visual.assetId&&resource.decision==='reject'))throw new Error('Este recurso está descartado. Cambia su selección antes de asignarlo.');if(changes.narration&&project.captionOverrides)delete project.captionOverrides[sceneId];const affected=new Set();const parts=project.options?.autonomousProduction?[...(Object.hasOwn(changes,'narration')?['voice']:[]),...(['type','visual','title','points','eyebrow','composition'].some(key=>Object.hasOwn(changes,key))?['visual']:[])]:[];for(const part of parts){const task=project.tasks.find(item=>item.kind===part&&item.sceneId===sceneId);if(task)for(const id of this.invalidate(project,task.id))affected.add(id);}for(const id of this.invalidate(project,`media-${sceneId}`))affected.add(id);if(project.tasks.some(task=>task.id==='render'))this.attachCodeTasks(project);project.revisions.push({type:'manual',at:new Date().toISOString(),sceneId,message:'Escena editada',affected:[...affected]});project.review=null;for(const review of project.tasks.filter(task=>task.kind==='review')){review.status='pending';review.output=null;review.approved=false;}project.status='draft';this.store.save(project);await this.export(id);return project;}
  async regenerate(id,taskId){if(this.active.has(id))throw new Error('Detén la ejecución antes de regenerar.');const project=this.store.get(id);if(!project.tasks.some(task=>task.id===taskId))throw new Error('Tarea inexistente.');this.invalidate(project,taskId);project.status='draft';this.store.save(project);return this.run(id);}
  async approve(id){const project=this.store.get(id);if(!project?.render)throw new Error('Primero genera el vídeo.');project.approvedAt=new Date().toISOString();project.status='approved';this.store.save(project);return project;}
  async sources(id,sources){if(this.active.has(id))throw new Error('Detén la ejecución antes de modificar las fuentes.');const project=this.store.get(id);validateCreate({...Object.fromEntries(Object.keys(project).filter(key=>['prompt','duration','runtime','architecture','context','style','concurrency','desktop','sources'].includes(key)).map(key=>[key,project[key]])),sources});this.store.snapshot(project,'Antes de cambiar fuentes');project.sources=sources;if(project.tasks.length){project.revisions.push({type:'manual',at:new Date().toISOString(),message:'Fuentes modificadas; el plan se volverá a evaluar.'});project.tasks=[];project.storyboard=null;project.render=null;project.review=null;}project.audioReview=null;project.finalReview=null;project.productionPlan=null;project.status='draft';this.store.save(project);await saveKnowledge(this.store,project,this.folder(id));await this.export(id);return project;}
}
