import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import {execute} from '../server/process.mjs';
import {Store} from '../server/store.mjs';
import {Harness} from '../server/harness.mjs';
import {prepareWorkspace,demoAuthor,workspaceDir} from '../server/scene-code.mjs';
import {motionTokens,tokensCss} from '../server/motion-tokens.mjs';
import {validate,validateCreate} from '../server/schemas.mjs';
import {createCollection,INHERITED_KEYS} from '../server/collections.mjs';
import {critiqueTimes,scoreOf,MAX_SCORE,styleFramesFromKit} from '../server/critic.mjs';
import {installExemplars} from '../server/scene-pipeline.mjs';

const validateSettings=values=>validateCreate({...Object.fromEntries(INHERITED_KEYS.map(key=>[key,values[key]])),prompt:'Validación de ajustes del proyecto',duration:60,sources:[]});
async function setup(t){
  const directory=await mkdtemp(path.join(os.tmpdir(),'lumen-quality-')),store=new Store(directory);
  t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});
  return {store,directory};
}
async function voice(file,seconds){const result=await execute(ffmpeg,['-y','-v','error','-f','lavfi','-i',`sine=f=440:d=${seconds}`,file],{timeout:60000});assert.equal(result.code,0,result.stderr);}
const scene=extra=>({id:'uno',title:'Hola',duration:3,narration:'Hola.',type:'title',eyebrow:'',points:['A'],sourceIds:[],engine:'hyperframes',direction:'Texto cinético.',voiceover:null,...extra});

test('los tokens de movimiento escalan con el lienzo y se instalan en cada escena',async t=>{
  const {directory}=await setup(t);
  const landscape=motionTokens({width:1920,height:1080,fps:30,format:'landscape',profile:{palette:{accent:'#ff0066'}},captions:{enabled:false}});
  const portrait=motionTokens({width:1080,height:1920,fps:30,format:'portrait',profile:{},captions:{enabled:true}});
  assert.equal(landscape.type.hero,portrait.type.hero);assert.equal(landscape.color.accent,'#ff0066');assert.ok(landscape.type.hero>landscape.type.body*3);
  assert.equal(landscape.safe.captionZone,0);assert.ok(portrait.safe.captionZone>0);assert.ok(portrait.safe.platformUI);
  assert.match(tokensCss(landscape),/--lumen-accent:#ff0066/);
  const project={id:'p',prompt:'Prueba',style:'technology',output:{format:'landscape',resolution:'720p',fps:30},profile:{font:'Inter'},assets:[],recordings:[],storyboard:{title:'T',scenes:[scene()]}};
  await mkdir(path.join(directory,'media'));await voice(path.join(directory,'media','voz.wav'),3);
  const {dir}=await prepareWorkspace(project,project.storyboard.scenes[0],{duration:3,speechDuration:3,audioPath:'media/voz.wav',words:[]},directory);
  for(const file of ['tokens.css','tokens.js','tokens.ts','zoom.js','zoom.ts'])assert.ok((await readFile(path.join(dir,'lumen',file),'utf8')).length>50,file);
  assert.match(await readFile(path.join(dir,'AGENTS.md'),'utf8'),/Sistema de diseño de Lumen/);
});

test('los planos del storyboard no pueden salirse de su escena y el crítico elige momentos clave',()=>{
  const board=shots=>({title:'T',scenes:[scene({shots})]});
  const shot={start:0,duration:1.5,job:'Presentar',focal:'Título',anchor:'B2',scale:'xl',mediaId:null,cue:null};
  assert.doesNotThrow(()=>validate('storyboard',board([shot,{...shot,start:1.5}])));
  assert.throws(()=>validate('storyboard',board([{...shot,start:2,duration:3}])),/termina después/);
  assert.throws(()=>validate('storyboard',board([{...shot,anchor:'Z9'}])));
  const times=critiqueTimes({durationSeconds:6,shots:[{start:0,duration:2},{start:2,duration:4}]});
  assert.ok(times.length<=8&&times.every(time=>time>=0&&time<=6));assert.ok(times.includes(1.2)&&times.includes(4.4));
  assert.equal(scoreOf({scores:{hierarchy:5,readability:5,motionPurpose:5,rhythm:5,consistency:5,originality:5}}),MAX_SCORE);
});

test('el storyboard espera la aprobación antes de programar y se puede rehacer',async t=>{
  const {store}=await setup(t);const coded=[],boards=[];
  const runtimeInvoke=async({kind,task})=>{if(kind==='storyboard')boards.push(task.feedback);return {output:kind==='plan'?{reasoning:'Uno',tasks:[{id:'board',kind:'storyboard',role:'storyboard',label:'Storyboard',dependencies:[],instruction:'Diseña.'}]}:kind==='storyboard'?{title:'Demo',scenes:[scene()]}:null,metrics:{durationMs:1,inputTokens:1,outputTokens:1}};};
  const harness=new Harness(store,{owner:null,tokens:new Map()},{runtimeInvoke,sceneProducer:async(project,id)=>({sceneId:id,audioPath:`media/${id}.wav`,duration:3,speechDuration:3,words:[]}),renderer:async()=>({path:'media/v.mp4',duration:3}),mediaReviewer:async()=>({approved:true,summary:'ok',issues:[],frames:[]})});
  harness.codeScene=async(id,task)=>{coded.push(task.sceneId);return {output:{summary:'Programada',engine:'hyperframes',files:['index.html'],verified:{lint:true,check:true,snapshotsReviewed:true},mediaUsed:[],notes:[],sourceHash:'h'},metrics:{durationMs:1,inputTokens:1,outputTokens:1}};};
  harness.run=async function(id){const controller=new AbortController();const operation=this.execute(id,controller.signal);this.active.set(id,{controller,operation});try{await operation;}finally{this.active.delete(id);}return store.get(id);};
  const project=await harness.create({prompt:'Un vídeo de prueba con una escena.',duration:15,runtime:'codex',authoring:'code',architecture:'single',context:'minimal',style:'editorial',concurrency:1,desktop:false,sources:[],options:{autonomousProduction:false,finalReview:false,audioReview:false,storyboardApproval:true,critic:false}});
  await harness.run(project.id);
  let current=store.get(project.id);assert.equal(current.status,'needs-approval');assert.equal(current.awaiting,'storyboard');assert.equal(coded.length,0);
  await harness.redoStoryboard(project.id,'Más dinámico, por favor');
  current=store.get(project.id);assert.equal(boards.length,2);assert.match(boards[1].issues[0].message,/Más dinámico/);assert.equal(current.awaiting,'storyboard');assert.equal(coded.length,0);
  await harness.approveStoryboard(project.id);
  current=store.get(project.id);assert.deepEqual(coded,['uno']);assert.ok(current.storyboardApprovedAt);assert.equal(current.status,'completed');
});

test('el crítico conserva la mejor versión, las variantes se comparan y una escena aprobada se convierte en ejemplo',{timeout:600000},async t=>{
  const {store}=await setup(t);
  const collection=createCollection(store,{name:'Serie',settings:{runtime:'demo'}},validateSettings);
  let coderCalls=0,criticCalls=0;const critiques=[18,18,20,16],pairwise=[];
  const runtimeInvoke=async({kind,context})=>{
    if(kind==='scene-code'){coderCalls++;await demoAuthor(context.workspace,context.brief);const file=path.join(context.workspace,'index.html');await writeFile(file,(await readFile(file,'utf8')).replace('>Hola<',`>Ronda${coderCalls}<`));return {output:{summary:'Versión '+coderCalls,engine:'hyperframes',files:['index.html'],verified:{lint:true,check:true,snapshotsReviewed:true},mediaUsed:[],notes:[]},metrics:{durationMs:1,inputTokens:1,outputTokens:1}};}
    if(kind==='scene-critic'){assert.ok(context.frames.length>0);
      // Prueba de mirada: el crítico simulado lee los códigos del manifiesto (un modelo los lee en las imágenes).
      const codes=[];for(const frame of context.frames){const manifest=JSON.parse(await readFile(path.join(path.dirname(frame.path),'codes.json'),'utf8'));codes.push(manifest.find(item=>item.path===frame.path).code);}
      {const visible=JSON.stringify(context);assert.ok(codes.every(code=>!visible.includes(code)),'el contexto no debe llevar los códigos');}
      if(context.mode==='pairwise'){pairwise.push(context.order);const versions=context.versions;return {output:{preferred:context.order==='XY'?'X':'Y',reason:'Prefiero la primera que veo',wouldPost:{X:false,Y:false},issues:[{video:'X',severity:'warning',time:1.2,message:'Más aire'},{video:'Y',severity:'warning',time:null,message:'Sin segundo'}],seenCodes:codes},metrics:{durationMs:1,inputTokens:1,outputTokens:1}};}
      const total=critiques[criticCalls++]??15,each=Math.floor(total/6),scores={hierarchy:each,readability:each,motionPurpose:each,rhythm:each,consistency:each,originality:total-each*5};return {output:{scores,verdict:'revise',summary:'Crítica '+criticCalls,issues:[{severity:'warning',time:1,message:'Más contraste'},{severity:'warning',time:null,message:'Sin localizar'}],strengths:['Buen ritmo'],framesReviewed:context.frames.length,seenCodes:criticCalls===1?[]:codes,wouldPost:false,wouldPostReason:'Falta contraste',poster:1.5},metrics:{durationMs:1,inputTokens:1,outputTokens:1}};}
    throw new Error('Inesperado: '+kind);
  };
  const harness=new Harness(store,{owner:null,tokens:new Map()},{runtimeInvoke});
  const video=await harness.create({prompt:'Primer vídeo de la serie de pruebas',duration:15,sources:[],collectionId:collection.id});
  const project=store.get(video.id);project.runtime='codex';project.authoring='code';project.options={...project.options,critic:true,criticRounds:1};project.storyboard={title:'T',scenes:[scene()]};
  await mkdir(path.join(harness.folder(project.id),'media'),{recursive:true});await voice(path.join(harness.folder(project.id),'media','voz.wav'),3);
  project.tasks=[{id:'media-uno',kind:'scene',sceneId:'uno',dependencies:[],status:'completed',output:{sceneId:'uno',duration:3,speechDuration:3,audioPath:'media/voz.wav',words:[{text:'Hola',start:.1,end:.5}]}},{id:'code-uno',kind:'scene-code',sceneId:'uno',dependencies:['media-uno'],status:'running'}];store.save(project);
  // Ronda 1: rúbrica (el primer intento no devuelve los códigos y se repite). Ronda 2: comparación a ciegas en los dos órdenes;
  // el crítico simulado prefiere siempre la versión que ve primero (sesgo de posición): gana un orden y pierde el otro → no hay mejora.
  const result=await harness.codeScene(project.id,project.tasks[1],AbortSignal.timeout(400000));
  const main=workspaceDir(harness.folder(project.id),'uno');
  assert.equal(coderCalls,2);assert.equal(result.output.rounds,2);assert.equal(result.output.critique.score,18);assert.equal(result.output.critique.max,MAX_SCORE);
  assert.equal(criticCalls,2);assert.deepEqual(pairwise.sort(),['XY','YX']);assert.equal(result.output.critique.verified,true);assert.equal(result.output.critique.wouldPost,false);
  assert.ok(result.output.critique.issues.every(issue=>issue.time!=null));assert.equal(result.output.critique.history.length,2);assert.equal(result.output.critique.history[1].improved,false);
  assert.match(await readFile(path.join(main,'index.html'),'utf8'),/>Ronda1</);
  {const latest=store.get(project.id);latest.tasks[1]={...latest.tasks[1],status:'completed',output:result.output};store.save(latest);}

  // Variantes en paralelo con su crítica; elegir una sustituye el código y guarda la versión anterior.
  await harness.sceneVariants(project.id,'uno',{count:2,instruction:'Más tipográfica'});
  await harness.variantRuns.get(project.id+':uno')?.work;
  const variants=store.get(project.id).sceneVariants.uno;assert.equal(variants.status,'completed');assert.equal(variants.items.length,2);
  assert.ok(variants.items.every(item=>!item.error&&item.snapshots.length>0&&item.score!=null),JSON.stringify(variants.items));
  const chosen=variants.items[0],marker=(await readFile(path.join(workspaceDir(harness.folder(project.id),chosen.id),'index.html'),'utf8')).match(/>(Ronda\d+)</)[1];
  await harness.chooseSceneVariant(project.id,'uno',chosen.id);
  assert.match(await readFile(path.join(main,'index.html'),'utf8'),new RegExp('>'+marker+'<'));assert.equal(store.get(project.id).tasks[1].output.variantChosen,chosen.id);
  await harness.discardSceneVariants(project.id,'uno');assert.ok(!(await readdir(path.join(harness.folder(project.id),'code'))).some(name=>name.includes('--v')));

  // Ejemplo del proyecto: código en .txt y fotogramas, instalable en otras escenas del mismo motor.
  const exemplar=await harness.saveSceneExemplar(project.id,'uno',{note:'Me encanta'});
  assert.ok(exemplar.files.includes('index.html.txt'));assert.ok(exemplar.frames.length>0);assert.equal(store.getCollection(collection.id).exemplars.length,1);
  const other=path.join(harness.folder(project.id),'otra');await mkdir(other,{recursive:true});
  const installed=await installExemplars(store,store.getCollection(collection.id),other,{engine:'hyperframes',title:'Hola de nuevo',direction:''});
  assert.equal(installed.length,1);assert.ok((await readdir(path.join(other,'lumen','references',exemplar.id))).includes('index.html.txt'));
  assert.equal((await installExemplars(store,store.getCollection(collection.id),other,{engine:'remotion',title:'x'})).length,0);

  // Los fotogramas del kit se convierten en fotogramas de estilo.
  const kit=path.join(harness.folder(project.id),'kit-falso'),run=path.join(kit,'snapshots','001');await mkdir(run,{recursive:true});
  for(const index of [0,1,2,3,4,5])await writeFile(path.join(run,`f${index}.png`),'png');
  const frames=await styleFramesFromKit(store,store.getCollection(collection.id),kit);assert.ok(frames.length>0&&frames.length<=4);assert.ok(frames.every(frame=>frame.source==='kit'));
});

test('la revisión del montaje detecta planos estáticos demasiado largos y su escena',{timeout:120000},async t=>{
  const {directory}=await setup(t);const {reviewMedia}=await import('../server/production.mjs');
  const file=path.join(directory,'v.mp4');
  const result=await execute(ffmpeg,['-y','-v','error','-f','lavfi','-i','color=c=navy:s=320x180:r=30:d=4','-f','lavfi','-i','testsrc=s=320x180:r=30:d=2','-f','lavfi','-i','sine=f=440:d=6','-filter_complex','[0:v][1:v]concat=n=2:v=1[v]','-map','[v]','-map','2:a','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',file],{timeout:60000});assert.equal(result.code,0,result.stderr);
  const project={duration:6,render:{path:'v.mp4',duration:6,segments:[{sceneId:'uno',title:'Quieta',start:0,duration:4},{sceneId:'dos',title:'Viva',start:4,duration:2}]},storyboard:{scenes:[{id:'uno',title:'Quieta'},{id:'dos',title:'Viva'}]}};
  const review=await reviewMedia(project,directory,AbortSignal.timeout(60000));
  assert.ok(review.checks.includes('static-holds'));assert.equal(review.freezes.length,1);assert.ok(review.issues.some(issue=>/Plano estático/.test(issue)&&/Quieta/.test(issue)),JSON.stringify(review.issues));
});

test('el kit se amplía sin perder componentes y valida cada operación',async t=>{
  const {store,directory}=await setup(t);const {mergeComponents,kitSeconds,CollectionAgents}=await import('../server/collection-agents.mjs');
  await mkdir(path.join(directory,'components'));for(const file of ['intro.html','cierre.html'])await writeFile(path.join(directory,'components',file),'x');
  const previous=[{name:'Intro',file:'components/intro.html'},{name:'Cierre',file:'components/cierre.html'},{name:'Borrado',file:'components/no-existe.html'}];
  assert.deepEqual((await mergeComponents(directory,previous,[{name:'Cifra',file:'components/cifra.html'}])).map(item=>item.name),['Cifra','Intro','Cierre']);
  assert.deepEqual((await mergeComponents(directory,previous,previous,'cierre')).map(item=>item.name),['Intro','Borrado']);
  assert.equal(kitSeconds({kits:{}},'hyperframes'),8);assert.equal(kitSeconds({kits:{remotion:{components:Array(12).fill({})}}},'remotion',1),21);assert.equal(kitSeconds({kits:{remotion:{components:Array(40).fill({})}}},'remotion'),40);assert.equal(kitSeconds({kits:{remotion:{components:Array(40).fill({})}}},'hyperframes'),8);
  const collection=createCollection(store,{name:'Serie',settings:{runtime:'demo'}},validateSettings),agents=new CollectionAgents(store,new Harness(store,{owner:null,tokens:new Map()},{}),{tokens:new Map()});
  assert.throws(()=>agents.kit(collection.id,{mode:'add',component:{name:'Cifra'}}),/Crea primero el kit/);
  const ready=store.getCollection(collection.id);ready.kits={hyperframes:{engine:'hyperframes',status:'ready',version:'v',components:[{name:'Intro',file:'components/intro.html'}]}};store.saveCollection(ready);
  assert.throws(()=>agents.kit(collection.id,{mode:'add',component:{name:'intro'}}),/Ya hay un componente/);
  assert.throws(()=>agents.kit(collection.id,{engine:'remotion',mode:'add',component:{name:'Intro'}}),/Crea primero el kit remotion/);
  assert.throws(()=>agents.kit(collection.id,{mode:'remove',component:{name:'Nada'}}),/inexistente/);
});

test('un proyecto mantiene un kit por motor a la vez y migra el kit único anterior',{timeout:300000},async t=>{
  const {store}=await setup(t);const {CollectionAgents,kitDir,kitsOf,installKit}=await import('../server/collection-agents.mjs');const {collectionFolder}=await import('../server/library-sync.mjs');
  const harness=new Harness(store,{owner:null,tokens:new Map()},{});
  // Proyecto antiguo: un solo kit en code/kit.
  const old=createCollection(store,{name:'Antiguo',settings:{runtime:'demo'}},validateSettings),legacy=path.join(collectionFolder(store,old.id),'code','kit');
  await mkdir(legacy,{recursive:true});await writeFile(path.join(legacy,'KIT.md'),'# Kit');
  {const value=store.getCollection(old.id);value.kit={engine:'remotion',status:'ready',version:'r1',components:[{name:'Intro',file:'components/Intro.tsx'}]};value.agentRuns={'kit-designer':{status:'completed'}};store.saveCollection(value);}
  const agents=new CollectionAgents(store,harness,{tokens:new Map()});
  const migrated=store.getCollection(old.id);assert.equal(migrated.kit,undefined);assert.equal(migrated.kits.remotion.version,'r1');assert.equal(migrated.agentRuns['kit-designer:remotion'].status,'completed');
  assert.equal(await readFile(path.join(kitDir(store,old.id,'remotion'),'KIT.md'),'utf8'),'# Kit');
  // Proyecto nuevo con los dos kits a la vez.
  const collection=createCollection(store,{name:'Doble',settings:{runtime:'demo'}},validateSettings);
  agents.kit(collection.id,{engine:'hyperframes'});agents.kit(collection.id,{engine:'remotion'});
  assert.throws(()=>agents.kit(collection.id,{engine:'remotion'}),/ya está trabajando/);
  const wait=async key=>{for(let i=0;i<2400;i++){const run=store.getCollection(collection.id).agentRuns?.[key];if(run&&run.status!=='running')return run;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('sin terminar');};
  for(const engine of ['hyperframes','remotion']){const run=await wait('kit-designer:'+engine);assert.equal(run.status,'completed',run.error);}
  const kits=kitsOf(store.getCollection(collection.id));assert.equal(kits.hyperframes.status,'ready');assert.equal(kits.remotion.status,'ready');assert.notEqual(kitDir(store,collection.id,'hyperframes'),kitDir(store,collection.id,'remotion'));
  const workspace=path.join(collectionFolder(store,collection.id),'scratch');await mkdir(workspace,{recursive:true});
  assert.equal((await installKit(store,store.getCollection(collection.id),workspace,'remotion')).version,kits.remotion.version);
  assert.equal((await installKit(store,store.getCollection(collection.id),workspace,'hyperframes')).version,kits.hyperframes.version);
});

test('los documentos y datos de la biblioteca no rompen el registro de recursos del vídeo',async t=>{
  const {store}=await setup(t);const {syncAssets}=await import('../server/resources.mjs');const harness=new Harness(store,{owner:null,tokens:new Map()},{});
  const video=await harness.create({prompt:'Un vídeo con biblioteca mixta de pruebas',duration:15,runtime:'demo',authoring:'code',architecture:'single',context:'minimal',style:'editorial',concurrency:1,desktop:false,sources:[]});
  const project=store.get(video.id);project.assets=[{id:'d',kind:'document',name:'Notas.md',path:'media/n.md'},{id:'c',kind:'data',name:'Datos.csv',path:'media/d.csv'},{id:'v',kind:'voice',name:'Voz',path:'media/v.wav'},{id:'i',kind:'image',name:'Foto',path:'media/f.png'}];store.save(project);
  const resources=syncAssets(store,video.id);assert.deepEqual(resources.filter(item=>item.assetId).map(item=>item.assetId),['i']);
});

test('cada escena se construye sobre un componente del kit y, si ninguno encaja, se añade uno nuevo una sola vez',{timeout:300000},async t=>{
  const {store}=await setup(t);const {CollectionAgents,resolveSceneComponent,kitOf}=await import('../server/collection-agents.mjs');const {invoke}=await import('../server/runtimes.mjs');
  // Diseñador simulado: el kit de demostración más los componentes que se le pidan.
  let designs=0;const runtimeInvoke=async args=>{const result=await invoke(args);if(args.kind==='kit-designer'){designs++;const asked=/«([^»]+)»/.exec(args.task.instruction||args.context.feedback?.instruction||'')?.[1];if(asked)result.output.components=[...result.output.components,{name:asked,file:'components/kit.css',description:'Nuevo',usage:'<div class="x"></div>'}];}return result;};
  const harness=new Harness(store,{owner:null,tokens:new Map()},{runtimeInvoke}),agents=new CollectionAgents(store,harness,{tokens:new Map()});
  const collection=createCollection(store,{name:'Serie',settings:{runtime:'demo'}},validateSettings);
  const value=store.getCollection(collection.id);value.kits={remotion:{engine:'remotion',status:'ready',version:'r',components:[{name:'Intro',file:'components/Intro.tsx'}]}};store.saveCollection(value);
  const kitted=store.getCollection(collection.id);
  assert.deepEqual(resolveSceneComponent(kitted,scene({engine:'hyperframes',component:'intro'})).engine,'remotion');
  assert.equal(resolveSceneComponent(kitted,scene({engine:'hyperframes',component:'intro'})).component,'Intro');
  assert.deepEqual(resolveSceneComponent(kitted,scene({component:'Inventado'})).newComponent,{name:'Inventado',description:''});
  assert.equal(resolveSceneComponent(kitted,scene({component:null,newComponent:{name:'INTRO',description:''}})).component,'Intro');
  // Dos escenas piden a la vez el mismo componente nuevo en un motor sin kit: se crea el kit una vez con él.
  const [first,second]=await Promise.all([agents.ensureComponent(collection.id,'hyperframes',{name:'Cifra destacada',description:'Un número grande'}),agents.ensureComponent(collection.id,'hyperframes',{name:'cifra destacada',description:''})]);
  assert.equal(first,'Cifra destacada');assert.equal(second,'Cifra destacada');assert.equal(designs,1);
  const kit=kitOf(store.getCollection(collection.id),'hyperframes');assert.equal(kit.status,'ready');assert.ok(kit.components.some(item=>item.name==='Cifra destacada'));
  // Con el kit ya creado, un componente nuevo se añade sin rehacer el resto.
  assert.equal(await agents.ensureComponent(collection.id,'hyperframes',{name:'Esquema de red',description:'Nodos y enlaces'}),'Esquema de red');assert.equal(designs,2);
  assert.ok(kitOf(store.getCollection(collection.id),'hyperframes').components.some(item=>item.name==='Cifra destacada'));
});

test('las escenas HyperFrames traen Three.js y Lottie locales de confianza y reciben los modelos 3D de la biblioteca',async t=>{
  const {directory}=await setup(t);const {scanSources}=await import('../server/scene-code.mjs');const {processItem}=await import('../server/project-library.mjs');
  await mkdir(path.join(directory,'media'));await voice(path.join(directory,'media','voz.wav'),3);
  // Un .glb mínimo válido (cabecera glTF binaria) y otro falso.
  const glb=Buffer.alloc(20);glb.write('glTF',0,'ascii');glb.writeUInt32LE(2,4);glb.writeUInt32LE(20,8);await writeFile(path.join(directory,'media','router.glb'),glb);await writeFile(path.join(directory,'media','falso.glb'),'no es un modelo');
  const project={id:'p',prompt:'3D',style:'technology',output:{format:'landscape',resolution:'720p',fps:30},profile:{font:'Inter'},recordings:[],storyboard:{title:'T',scenes:[scene()]},assets:[{id:'m1',kind:'model',name:'Router',path:'media/router.glb'},{id:'m2',kind:'model',name:'Falso',path:'media/falso.glb'}]};
  const owner={get:()=>project,save:value=>Object.assign(project,value)};
  await processItem(owner,'p',directory,'m1');await processItem(owner,'p',directory,'m2');
  assert.equal(project.mediaIndex.m1.status,'ready');assert.equal(project.mediaIndex.m2.status,'failed');
  const {dir,catalog}=await prepareWorkspace(project,project.storyboard.scenes[0],{duration:3,speechDuration:3,audioPath:'media/voz.wav',words:[]},directory);
  for(const file of ['three.module.min.js','three.core.min.js','addons/environments/RoomEnvironment.js','addons/loaders/GLTFLoader.js','addons/postprocessing/EffectComposer.js','fonts/helvetiker_regular.typeface.json'])assert.ok((await readFile(path.join(dir,'vendor','three',file))).length>100,file);
  assert.ok((await readFile(path.join(dir,'vendor','lottie','lottie.min.js'))).length>1000);
  assert.ok(catalog.some(item=>item.kind==='model'&&item.file.startsWith('assets/models/')&&item.file.endsWith('.glb')));
  assert.match(await readFile(path.join(dir,'AGENTS.md'),'utf8'),/3D y acabado casi realista/);
  await writeFile(path.join(dir,'index.html'),'<html><head><script type="importmap">{"imports":{"three":"./vendor/three/three.module.min.js","three/addons/":"./vendor/three/addons/"}}</script></head><body><canvas id="gl"></canvas><script type="module">import * as THREE from "three";import {RoomEnvironment} from "three/addons/environments/RoomEnvironment.js";window.addEventListener("hf-seek",event=>{});</script></body></html>');
  assert.deepEqual(await scanSources(dir,'hyperframes'),[]);
});

test('la inspiración del kit agrupa el catálogo por papel y trae el recetario de Remotion con paquetes permitidos',async t=>{
  const {rolesOf,kitInspiration}=await import('../server/hyperframes-catalog.mjs');const {REMOTION_RECIPES}=await import('../server/remotion-recipes.mjs');const {REMOTION_IMPORTS}=await import('../server/scene-code.mjs');
  assert.deepEqual(rolesOf({name:'lt-clean-bar',type:'block',tags:['lower-third','overlay']}),['lower-third']);
  assert.ok(rolesOf({name:'code-3d-extrude',type:'block',tags:['code','3d','webgl']}).includes('3d'));
  for(const recipe of REMOTION_RECIPES)for(const pkg of recipe.packages)assert.ok(REMOTION_IMPORTS.includes(pkg),recipe.name+': '+pkg);
  assert.ok(REMOTION_IMPORTS.includes('@remotion/three')&&REMOTION_IMPORTS.includes('@react-three/fiber')&&REMOTION_IMPORTS.includes('three'));
  const {store}=await setup(t);const remotion=await kitInspiration(store,'remotion');
  assert.match(remotion,/Recetario de componentes/);assert.match(remotion,/TransitionSeries/);assert.match(remotion,/@remotion\/transitions instaladas/);
  assert.match(await kitInspiration(store,'hyperframes'),/ocho reglas/);
});
