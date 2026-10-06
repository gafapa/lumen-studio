import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../server/store.mjs';
import {Harness,descendants,runnable} from '../server/harness.mjs';
import {validate} from '../server/schemas.mjs';
import {wavDuration} from '../server/media.mjs';
import {claudeUsage} from '../server/runtimes.mjs';
import {Desktop} from '../server/desktop.mjs';
const input={prompt:'Explica DHCP para principiantes en treinta segundos.',duration:30,runtime:'demo',architecture:'multi',context:'minimal',style:'editorial',concurrency:2,desktop:false,sources:[{name:'Apuntes',content:'DHCP asigna direcciones.'}]};
const task=(id,kind,dependencies=[])=>({id,kind,dependencies,label:id,role:kind==='storyboard'?'storyboard':kind==='review'?'revisor':'investigador',instruction:'Realiza la tarea indicada.'});
const plan={reasoning:'Dos investigaciones independientes y un storyboard revisado.',tasks:[task('concepto','research'),task('ejemplo','research'),task('escenas','storyboard',['concepto','ejemplo']),task('revision','review',['escenas'])]};
const storyboard={title:'Cómo funciona DHCP',scenes:[1,2].map(n=>({id:`scene-0${n}`,title:`Escena ${n}`,duration:15,narration:'DHCP configura tu red automáticamente.',type:'diagram',eyebrow:'DHCP',points:['Cliente','Servidor'],sourceIds:['apuntes']}))};
async function setup(t,overrides={}){
  const directory=await mkdtemp(path.join(os.tmpdir(),'lumen-test-'));
  const store=new Store(directory);
  t.after(async()=>{store.close();const resolved=path.resolve(directory);assert.ok(resolved.startsWith(path.join(os.tmpdir(),'lumen-test-')));await rm(resolved,{recursive:true,force:true});});
  const counters={peak:0,current:0,render:0,scene:{},calls:[]};
  const runtimeInvoke=async({kind,task,context,signal})=>{
    counters.calls.push({kind,id:task.id,context});
    if(kind==='research'){
      counters.current++;counters.peak=Math.max(counters.peak,counters.current);
      try{await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,40);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('Cancelado'));},{once:true});});}finally{counters.current--;}
    }
    const output=kind==='plan'?structuredClone(plan):kind==='storyboard'?structuredClone(storyboard):kind==='review'?{approved:true,summary:'Correcto',issues:[]}:{summary:'DHCP asigna direcciones.',sources:[{id:'apuntes',title:'Apuntes',url:'',claims:['DHCP asigna direcciones.']}]};
    return {output,metrics:{durationMs:40,inputTokens:10,outputTokens:5,contextBytes:100}};
  };
  const harness=new Harness(store,{owner:null},{runtimeInvoke,sceneProducer:async(project,id)=>{counters.scene[id]=(counters.scene[id]||0)+1;return {sceneId:id,audioPath:`media/${id}.wav`,duration:15};},renderer:async()=>{counters.render++;return {path:'media/test.mp4',duration:30};},mediaReviewer:async()=>({approved:true,summary:'Decodifica.',issues:[]}),...overrides});
  const project=await harness.create(input);return {store,harness,project,counters};
}
async function generate(harness,id){await harness.run(id);await harness.active.get(id)?.operation;}
test('rechaza planes cíclicos, referencias inexistentes e ids reservados',()=>{
  assert.equal(validate('plan',structuredClone(plan)).tasks.length,4);
  const cycle=structuredClone(plan);cycle.tasks[0].dependencies=['escenas'];assert.throws(()=>validate('plan',cycle),/cíclicas/);
  const missing=structuredClone(plan);missing.tasks[0].dependencies=['ausente'];assert.throws(()=>validate('plan',missing),/inexistente/);
  const duplicate=structuredClone(plan);duplicate.tasks[1].id='concepto';assert.throws(()=>validate('plan',duplicate),/duplicadas/);
  const reserved=structuredClone(plan);reserved.tasks[0].id='render';assert.throws(()=>validate('plan',reserved),/reservados/);
});
test('la revisión no puede aprobar errores materiales',()=>assert.throws(()=>validate('review',{approved:true,summary:'Incorrecto',issues:[{severity:'error',sceneId:null,message:'Error factual'}]}),/errores/));
test('el consumo de Claude incluye lectura y escritura de caché',()=>{
  assert.equal(claudeUsage({input_tokens:2,output_tokens:100,cache_creation_input_tokens:5000,cache_read_input_tokens:9000}).inputTokens,14002);
  assert.equal(claudeUsage({}).inputTokens,null);
});
test('el escritorio exige permiso y una reserva exclusiva del operador',{skip:process.platform!=='win32'},async()=>{
  const projects={a:{desktop:true},b:{desktop:true},c:{desktop:false}};
  const desktop=new Desktop({get:id=>projects[id]});
  assert.throws(()=>desktop.authorize('c','human'),/Activa/);assert.throws(()=>desktop.authorize('a','agente'),/ya no tiene acceso/);
  desktop.acquire('a','agente');assert.equal(desktop.authorize('a','agente'),projects.a);
  assert.throws(()=>desktop.acquire('b','otro'),/reservado/);assert.throws(()=>desktop.authorize('a','human'),/Otro agente/);
  await desktop.release('a','agente');assert.equal(desktop.owner,null);assert.throws(()=>desktop.authorize('a','agente'),/ya no tiene acceso/);
  desktop.acquire('a','otro-intento');assert.throws(()=>desktop.authorize('a','agente'),/ya no tiene acceso/);
});
test('las tareas listas y la invalidación siguen las dependencias',()=>{
  const tasks=plan.tasks.map(item=>({...item,status:'pending'}));assert.deepEqual(runnable(tasks).map(item=>item.id),['concepto','ejemplo']);
  tasks[0].status=tasks[1].status='completed';assert.deepEqual(runnable(tasks).map(item=>item.id),['escenas']);
  assert.deepEqual([...descendants(tasks,'concepto')].sort(),['concepto','escenas','revision']);
});
test('ejecuta investigaciones en paralelo y regenera solo los recursos de la escena editada',async t=>{
  const {store,harness,project,counters}=await setup(t);
  await generate(harness,project.id);let result=store.get(project.id);
  assert.equal(result.status,'completed');assert.equal(counters.peak,2);assert.equal(result.metrics.calls,5);assert.equal(result.metrics.inputTokens,50);
  assert.ok(result.tasks.every(item=>item.status==='completed'));assert.equal(counters.render,1);
  const before=structuredClone(counters.scene);await harness.updateScene(project.id,'scene-02',{narration:'Nueva narración para la segunda escena.'});
  result=store.get(project.id);assert.equal(result.render,null);assert.equal(result.tasks.find(item=>item.id==='media-scene-01').status,'completed');assert.equal(result.tasks.find(item=>item.id==='media-scene-02').status,'pending');
  await generate(harness,project.id);assert.equal(counters.scene['scene-01'],before['scene-01']);assert.equal(counters.scene['scene-02'],before['scene-02']+1);assert.equal(counters.render,2);assert.equal(store.get(project.id).storyboard.scenes[1].narration,'Nueva narración para la segunda escena.');
});
test('selecciona contexto mínimo a partir de dependencias',async t=>{
  const {harness,project,counters}=await setup(t);await generate(harness,project.id);
  const selected=counters.calls.find(call=>call.kind==='storyboard').context;
  assert.deepEqual(Object.keys(selected.artifacts).sort(),['concepto','ejemplo']);assert.deepEqual(selected.sources,[]);
});
test('las escenas de grabación esperan al operador antes de producir recursos',async t=>{
  const {harness,project}=await setup(t);project.storyboard=structuredClone(storyboard);project.storyboard.scenes[0].type='screencast';project.tasks=[...structuredClone(plan.tasks),{...task('captura','screencast'),role:'operador'}];
  harness.materialize(project,'escenas');assert.deepEqual(project.tasks.find(item=>item.sceneId==='scene-01').dependencies,['escenas','captura']);assert.deepEqual(project.tasks.find(item=>item.sceneId==='scene-02').dependencies,['escenas']);
});
test('el loop de revisión se detiene después de dos correcciones',async t=>{
  let reviews=0;
  const {store,harness,project}=await setup(t,{runtimeInvoke:async({kind})=>{
    if(kind==='review')reviews++;
    return {output:kind==='plan'?structuredClone(plan):kind==='storyboard'?structuredClone(storyboard):kind==='review'?{approved:false,summary:'Corregir una afirmación.',issues:[{severity:'error',sceneId:'scene-01',message:'Falta claridad.'}]}:{summary:'Datos',sources:[]},metrics:{inputTokens:1,outputTokens:1,durationMs:1}};
  }});
  await generate(harness,project.id);const result=store.get(project.id);
  assert.equal(reviews,3);assert.equal(result.revisions.filter(item=>item.type==='automatic').length,2);assert.equal(result.status,'needs-review');assert.ok(result.render);
});
test('un fallo de herramienta se reintenta de forma acotada y conserva tareas aceptadas',async t=>{
  let attempts=0;
  const {store,harness,project}=await setup(t,{sceneProducer:async(_,id)=>{if(id==='scene-02'){attempts++;throw new Error('Fallo forzado de voz.');}return {sceneId:id,duration:15};}});
  await generate(harness,project.id);const result=store.get(project.id);
  assert.equal(attempts,2);assert.equal(result.status,'failed');assert.equal(result.tasks.find(item=>item.id==='media-scene-01').status,'completed');assert.equal(result.tasks.find(item=>item.id==='media-scene-02').status,'failed');assert.equal(result.render,null);
});
test('una revisión técnica fallida requiere atención humana',async t=>{
  const {store,harness,project}=await setup(t,{mediaReviewer:async()=>({approved:false,summary:'No decodifica',issues:['Error']})});
  await generate(harness,project.id);assert.equal(store.get(project.id).status,'needs-review');
});
test('un segundo revisor no puede ocultar los errores de una revisión anterior',async t=>{
  const dual=structuredClone(plan);dual.tasks.push(task('fuentes-review','review',['concepto']));
  const {store,harness,project}=await setup(t,{runtimeInvoke:async({kind,task:current})=>({output:kind==='plan'?dual:kind==='storyboard'?structuredClone(storyboard):kind==='review'?{approved:current.id!=='fuentes-review',summary:current.id==='fuentes-review'?'Una fuente requiere comprobación.':'Guion correcto.',issues:current.id==='fuentes-review'?[{severity:'error',sceneId:null,message:'Fuente pendiente.'}]:[]}:{summary:'Datos',sources:[]},metrics:{inputTokens:1,outputTokens:1,durationMs:1}})});
  await generate(harness,project.id);const result=store.get(project.id);assert.equal(result.status,'needs-review');assert.equal(result.review.approved,false);assert.ok(result.review.issues.some(issue=>issue.message==='Fuente pendiente.'));
});
test('reanudación conserva la investigación aceptada después de cancelar',async t=>{
  let storyboardCalls=0,started;
  const gate=new Promise(resolve=>{started=resolve;});
  const {store,harness,project}=await setup(t,{runtimeInvoke:async({kind,signal})=>{
    if(kind==='storyboard'&&++storyboardCalls===1){started();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('Cancelado')),{once:true}));}
    return {output:kind==='plan'?structuredClone(plan):kind==='storyboard'?structuredClone(storyboard):kind==='review'?{approved:true,summary:'Correcto',issues:[]}:{summary:'Datos',sources:[]},metrics:{inputTokens:1,outputTokens:1,durationMs:1}};
  }});
  await harness.run(project.id);await gate;await harness.pause(project.id);
  assert.equal(store.get(project.id).status,'paused');assert.equal(store.get(project.id).tasks.find(item=>item.id==='concepto').status,'completed');
  await generate(harness,project.id);assert.equal(store.get(project.id).status,'completed');assert.equal(storyboardCalls,2);
});
test('recupera sesiones y conserva eventos en SQLite',async t=>{
  const {store,project}=await setup(t);const value=store.get(project.id);value.status='running';value.tasks=[{id:'a',status:'completed'},{id:'b',status:'running'}];store.save(value);store.event(project.id,'test',{message:'Persistido'});store.recover();
  assert.equal(store.get(project.id).status,'paused');assert.deepEqual(store.get(project.id).tasks.map(item=>item.status),['completed','pending']);assert.ok(store.events(project.id).some(item=>item.message==='Persistido'));
});
test('lee la duración WAV aunque haya chunks de metadatos antes del audio',()=>{
  const buffer=Buffer.alloc(12+24+10+8+4000);buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVE',8);buffer.write('fmt ',12);buffer.writeUInt32LE(16,16);buffer.writeUInt32LE(4000,28);buffer.write('JUNK',36);buffer.writeUInt32LE(1,40);buffer.write('data',46);buffer.writeUInt32LE(4000,50);
  assert.equal(wavDuration(buffer),1);assert.throws(()=>wavDuration(Buffer.alloc(15)),/inválido/);
});
