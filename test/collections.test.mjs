import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,stat,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import {execute} from '../server/process.mjs';
import {Store} from '../server/store.mjs';
import {Harness} from '../server/harness.mjs';
import {effectiveSettings,createCollection,updateCollection,staleVideos,agentPreset,modelArgs,roleSettings,collectionContext,INHERITED_KEYS} from '../server/collections.mjs';
import {validateCreate} from '../server/schemas.mjs';
import {syncLibrary,collectionFolder} from '../server/library-sync.mjs';
import {CollectionAgents,kitDir,installKit} from '../server/collection-agents.mjs';

const validateSettings=values=>validateCreate({...Object.fromEntries(INHERITED_KEYS.map(key=>[key,values[key]])),prompt:'Validación de ajustes del proyecto',duration:60,sources:[]});
async function setup(t){
  const directory=await mkdtemp(path.join(os.tmpdir(),'lumen-collections-')),store=new Store(directory);
  t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});
  const harness=new Harness(store,{owner:null,tokens:new Map()},{});return {store,harness,directory};
}
const waitRun=async(store,id,kind)=>{for(let i=0;i<900;i++){const run=store.getCollection(id).agentRuns?.[kind];if(run&&run.status!=='running')return run;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('El agente no terminó.');};

test('la herencia resuelve valores con su origen y el modo demo no activa revisiones costosas',()=>{
  const {values,origins}=effectiveSettings({settings:{runtime:'demo',profile:{captions:true}}},{output:{format:'portrait'}});
  assert.equal(values.output.format,'portrait');assert.equal(origins['output.format'],'video');assert.equal(origins['profile.captions'],'project');assert.equal(origins['output.fps'],'app');
  assert.equal(values.options.audioReview,false);assert.equal(values.options.autonomousProduction,false);
  assert.equal(effectiveSettings({settings:{runtime:'claude'}}).values.options.audioReview,true);
});

test('cada rol tiene modelo y esfuerzo, con perfiles de gasto y argumentos de CLI correctos',()=>{
  const balanced=agentPreset('claude'),economy=agentPreset('claude','economy'),quality=agentPreset('claude','quality');
  assert.equal(balanced['scene-code'].model,'sonnet');assert.equal(economy.storyboard.model,'sonnet');assert.equal(quality.storyboard.model,'opus');assert.notEqual(quality.storyboard.model,'fable');
  assert.deepEqual(modelArgs('claude',{model:'opus',effort:'high'}),['--model','opus','--effort','high']);
  assert.deepEqual(modelArgs('claude',{model:'haiku',effort:'low'}),['--model','haiku']);
  assert.deepEqual(modelArgs('codex',{model:'gpt-6-luna',effort:'low'}),['-m','gpt-6-luna','-c','model_reasoning_effort="low"']);
  assert.deepEqual(roleSettings({runtime:'claude',agents:{claude:{plan:{model:'haiku'}}}},'plan'),{model:'haiku'});assert.equal(roleSettings({runtime:'demo'},'plan'),null);
});

test('un vídeo hereda del proyecto, conserva lo propio y detecta cuándo se queda desactualizado',async t=>{
  const {store,harness}=await setup(t);
  const collection=createCollection(store,{name:'Serie',rules:[{text:'Termina con el logo',locked:true}],settings:{runtime:'demo',profile:{captions:true}}},validateSettings);
  const video=await harness.create({prompt:'Primer vídeo de la serie de pruebas',duration:30,sources:[],collectionId:collection.id,overrides:{output:{format:'square'}}});
  assert.equal(video.collectionId,collection.id);assert.equal(video.profile.captions,true);assert.equal(video.output.format,'square');assert.equal(staleVideos(store,collection).length,0);
  updateCollection(store,collection.id,{settings:{profile:{captions:false},output:{format:'portrait'}}},validateSettings);
  const stale=staleVideos(store,store.getCollection(collection.id));assert.deepEqual(stale[0].changed,['profile']);
  await harness.applyInheritance(video.id);const updated=store.get(video.id);assert.equal(updated.profile.captions,false);assert.equal(updated.output.format,'square');assert.equal(staleVideos(store,store.getCollection(collection.id)).length,0);
  assert.match(collectionContext(store.getCollection(collection.id)),/\[OBLIGATORIA\] Termina con el logo/);
});

test('el material del proyecto se enlaza en sus vídeos sin duplicarlo',async t=>{
  const {store,harness}=await setup(t);
  const collection=createCollection(store,{name:'Biblioteca',settings:{runtime:'demo'}},validateSettings),folder=collectionFolder(store,collection.id);
  await mkdir(path.join(folder,'media'),{recursive:true});await writeFile(path.join(folder,'media','clip.mp4'),Buffer.alloc(2048,1));
  const latest=store.getCollection(collection.id);latest.assets=[{id:'a1',name:'Clip',path:'media/clip.mp4',kind:'video'}];store.saveCollection(latest);
  const video=await harness.create({prompt:'Vídeo que usa la biblioteca común',duration:30,sources:[],collectionId:collection.id});
  const asset=video.assets.find(item=>item.id==='a1');assert.equal(asset.scope,'project');
  const linked=await stat(path.join(harness.folder(video.id),asset.path));assert.equal(linked.size,2048);
  latest.assets=[];store.saveCollection(latest);await syncLibrary(store,video.id,id=>harness.folder(id));assert.equal(store.get(video.id).assets.length,0);
});

test('los agentes de proyecto actualizan la guía, crean la serie, diseñan el kit y lo aplican a las escenas',{timeout:240000},async t=>{
  const {store,harness}=await setup(t),agents=new CollectionAgents(store,harness,{tokens:new Map()});
  const collection=createCollection(store,{name:'Kit',rules:[{text:'Regla fija',locked:true}],settings:{runtime:'demo',authoring:'code'}},validateSettings);
  agents.creative(collection.id,{brief:'Serie',createVideos:true});assert.equal((await waitRun(store,collection.id,'creative-director')).status,'completed');
  const guided=store.getCollection(collection.id);assert.ok(guided.styleGuide.length>10);assert.ok(guided.rules.some(rule=>rule.text==='Regla fija'&&rule.locked));
  const created=store.list().filter(video=>video.collectionId===collection.id);assert.equal(created.length,1);assert.equal(created[0].title,'Presentación');
  agents.kit(collection.id,{engine:'hyperframes'});const kitRun=await waitRun(store,collection.id,'kit-designer:hyperframes');assert.equal(kitRun.status,'completed',kitRun.error);
  const kit=store.getCollection(collection.id).kits.hyperframes;assert.equal(kit.engine,'hyperframes');assert.ok(kit.version);await stat(path.join(kitDir(store,collection.id,'hyperframes'),'KIT.md'));
  const workspace=path.join(harness.folder(created[0].id),'code','uno');await mkdir(workspace,{recursive:true});
  const installed=await installKit(store,store.getCollection(collection.id),workspace,'hyperframes');assert.equal(installed.version,kit.version);assert.match(await readFile(path.join(workspace,'kit','KIT.md'),'utf8'),/Rótulo/);
  assert.equal(await installKit(store,store.getCollection(collection.id),workspace,'remotion'),null);
  agents.librarian(collection.id);assert.equal((await waitRun(store,collection.id,'librarian')).status,'completed');
});

test('una indicación puede guardarse como decisión del proyecto',async t=>{
  const {store,harness}=await setup(t);harness.run=async()=>{};
  const collection=createCollection(store,{name:'Memoria',settings:{runtime:'demo',authoring:'code'}},validateSettings);
  const video=await harness.create({prompt:'Vídeo con una escena programada',duration:15,sources:[],collectionId:collection.id});
  const current=store.get(video.id);current.storyboard={title:'T',scenes:[{id:'uno',title:'Uno',duration:4,narration:'Hola.',type:'title',eyebrow:'',points:[],sourceIds:[],engine:'hyperframes'}]};current.tasks=[{id:'media-uno',kind:'scene',sceneId:'uno',dependencies:[],status:'completed',output:{}},{id:'code-uno',kind:'scene-code',sceneId:'uno',dependencies:['media-uno'],status:'completed',output:{}}];store.save(current);
  await harness.instructScene(video.id,'uno',{instruction:'Títulos siempre en mayúsculas',remember:true});
  assert.equal(store.getCollection(collection.id).notes[0].text,'Títulos siempre en mayúsculas');assert.match(collectionContext(store.getCollection(collection.id)),/Decisiones aprendidas[\s\S]*mayúsculas/);
});

test('la biblioteca procesa documentos y datos, los indexa y los lee para los agentes',async t=>{
  const {store,directory}=await setup(t);const {processItem,readItem,searchLibrary,parseTable,summarizeTable}=await import('../server/project-library.mjs');
  const table=summarizeTable(parseTable('mes;ventas\nenero;1.234,5\nfebrero;"980,25"\n','.csv'));assert.deepEqual(table.columns.map(column=>column.type),['text','number']);assert.equal(table.columns[1].sum,2214.75);
  const folder=path.join(directory,'owner');await mkdir(path.join(folder,'media'),{recursive:true});
  await writeFile(path.join(folder,'media','guia.md'),'# Guía\n\nEl producto Aurora usa violeta como color principal en todos los vídeos.');await writeFile(path.join(folder,'media','datos.json'),JSON.stringify([{pais:'España',usuarios:120},{pais:'México',usuarios:340}]));
  const owner={value:{id:'o1',assets:[{id:'doc',name:'Guía',path:'media/guia.md',kind:'document'},{id:'tab',name:'Usuarios',path:'media/datos.json',kind:'data'}],mediaIndex:{}},get(){return this.value;},save(value){this.value=value;}};
  await processItem(owner,'o1',folder,'doc',{db:store});await processItem(owner,'o1',folder,'tab',{db:store});
  assert.equal(owner.value.mediaIndex.doc.status,'ready');assert.equal(owner.value.mediaIndex.tab.rows,2);
  assert.match((await readItem(owner.value,folder,'doc')).text,/Aurora/);assert.deepEqual((await readItem(owner.value,folder,'tab',{columns:['usuarios']})).rows,[{usuarios:120},{usuarios:340}]);
  const hits=await searchLibrary(store,owner.value,['o1'],folder,'Aurora violeta');assert.ok(hits.some(hit=>hit.type==='document'&&hit.id==='doc'));
  assert.ok((await searchLibrary(store,owner.value,['o1'],folder,'usuarios')).some(hit=>hit.type==='data'));
});

test('los trabajos interrumpidos se recuperan, la IA sugiere campos y «Pídeselo a Lumen» propone cambios aplicables',async t=>{
  const {store,harness}=await setup(t);
  const collection=createCollection(store,{name:'Asistida',settings:{runtime:'demo'}},validateSettings);
  const stuck=store.getCollection(collection.id);stuck.agentRuns={'kit-designer':{status:'running'}};store.saveCollection(stuck);
  const agents=new CollectionAgents(store,harness,{tokens:new Map()});assert.equal(store.getCollection(collection.id).agentRuns['kit-designer'].status,'interrupted');
  const {suggest}=await import('../server/assist.mjs');
  assert.ok((await suggest(store,harness,{field:'audience',collectionId:collection.id})).suggestions.length>0);
  assert.equal((await suggest(store,harness,{field:'palette',collectionId:collection.id})).suggestions[0].background.length,7);
  await assert.rejects(suggest(store,harness,{field:'inventado',collectionId:collection.id}),/sin asistente/);
  agents.copilot(collection.id,{request:'pon subtítulos amarillos'});const run=await waitRun(store,collection.id,'copilot');assert.equal(run.status,'completed',run.error);
  const proposal=store.getCollection(collection.id).copilotProposal;assert.ok(proposal.diff.some(item=>item.label==='Subtítulos'));
  await agents.applyProposal(collection.id,proposal.id,{});assert.equal(store.getCollection(collection.id).settings.profile.captions,true);
  await assert.rejects(agents.applyProposal(collection.id,'otra',{}),/ya no está disponible/);
});

test('la edición manual solo admite archivos fuente del espacio y guarda una versión previa',async t=>{
  const {directory}=await setup(t);const {writeSourceFile,listHistory}=await import('../server/scene-code.mjs');
  const dir=path.join(directory,'escena');await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'index.html'),'<p>antes</p>');
  assert.equal(await writeSourceFile(dir,'index.html','<p>después</p>'),'index.html');assert.equal(await readFile(path.join(dir,'index.html'),'utf8'),'<p>después</p>');assert.ok((await listHistory(dir)).length>=1);
  for(const forbidden of ['../fuera.html','assets/x.html','gsap.min.js','lumen/scene.json','vendor/gsap/x.js','foto.png'])await assert.rejects(writeSourceFile(dir,forbidden,'x'),/no se puede|Solo se pueden/);
});
