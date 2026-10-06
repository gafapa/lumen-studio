import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,readFile,copyFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import {execute} from '../server/process.mjs';
import {Store} from '../server/store.mjs';
import {Harness} from '../server/harness.mjs';
import {scanSources,trustFiles,prepareWorkspace,demoAuthor,checkScene,renderCodeScene,snapshotSources,listHistory,restoreHistory,lintScene} from '../server/scene-code.mjs';
import {speechRanges,remapWords,summarizeEvents,probeMedia,buildIndex,searchMedia} from '../server/media-index.mjs';
import {alignToScript} from '../server/captions.mjs';
import {sceneOffsets,transitionFor,assemble} from '../server/production.mjs';
import {validate} from '../server/schemas.mjs';

async function temporary(t){const directory=await mkdtemp(path.join(os.tmpdir(),'lumen-code-'));t.after(()=>rm(directory,{recursive:true,force:true}));return directory;}
async function tone(file,seconds,{video=true}={}){const args=video?['-f','lavfi','-i',`testsrc=d=${seconds}:s=320x180:r=30`,'-f','lavfi','-i',`sine=f=440:d=${seconds}`,'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest']:['-f','lavfi','-i',`sine=f=440:d=${seconds}`];const result=await execute(ffmpeg,['-y','-v','error',...args,file],{timeout:60000});assert.equal(result.code,0,result.stderr);}

test('el análisis estático bloquea red, código dinámico, no determinismo e importaciones no permitidas',async t=>{
  const dir=await temporary(t);
  await writeFile(path.join(dir,'index.html'),'<html><body><img src="https://evil.example/x.png"><script>fetch("/x");const r=Math.random();</script></body></html>');
  await writeFile(path.join(dir,'Scene.tsx'),"import React from 'react';\nimport fs from 'fs';\nimport {AbsoluteFill} from 'remotion';\nimport x from '../../secret';\nexport default function Scene(){return <AbsoluteFill/>;}");
  const rules=new Set((await scanSources(dir,'remotion')).map(issue=>issue.rule));
  for(const rule of ['network','nondeterministic','remote-url','import','node'])assert.ok(rules.has(rule),rule);
  await writeFile(path.join(dir,'ok.js'),'// fetch("x") en un comentario no cuenta\nconst a=1;');
  assert.ok(!(await scanSources(dir,'hyperframes')).some(issue=>issue.file==='ok.js'));
});

test('los archivos de confianza se omiten hasta que alguien los modifica',async t=>{
  const dir=await temporary(t);await writeFile(path.join(dir,'lib.js'),'const t=Date.now();');
  assert.equal((await scanSources(dir,'hyperframes')).length,1);
  await trustFiles(dir,['lib.js']);assert.equal((await scanSources(dir,'hyperframes')).length,0);
  await writeFile(path.join(dir,'lib.js'),'const t=Date.now();fetch("/x");');assert.ok((await scanSources(dir,'hyperframes')).length>=1);
});

test('el corte limpio separa las muletillas y remapea los tiempos',()=>{
  const words=[{text:'hola',start:0,end:.4},{text:'eh',start:.5,end:.7,filler:true},{text:'mundo',start:.8,end:1.2},{text:'adiós',start:3,end:3.4}];
  const ranges=speechRanges(words,{padding:0,duration:5});
  assert.deepEqual(ranges,[{start:0,end:.4},{start:.8,end:1.2},{start:3,end:3.4}]);
  assert.deepEqual(remapWords(words,ranges).map(word=>[word.text,word.start]),[['hola',0],['mundo',.4],['adiós',.8]]);
});

test('la telemetría de grabación propone zooms agrupando clics cercanos y detecta tiempos muertos',()=>{
  const summary=summarizeEvents({events:[{type:'click',t:1,x:.5,y:.5},{type:'click',t:2,x:.52,y:.5},{type:'move',t:2.5},{type:'click',t:9,x:.1,y:.9}]});
  assert.equal(summary.zooms.length,2);assert.equal(summary.zooms[0].clicks,2);assert.ok(summary.idle.some(range=>range.start<3.5&&range.end>8));
});

test('los subtítulos conservan el texto del guion con los tiempos reconocidos',()=>{
  const aligned=alignToScript('Hola Kokoro, ¿qué tal?',[{text:'Hola',start:0,end:.3},{text:'Cocoro,',start:.3,end:.8},{text:'qué',start:.9,end:1},{text:'tal',start:1,end:1.3}]);
  assert.deepEqual(aligned.map(word=>word.text),['Hola','Kokoro,','¿qué','tal?']);assert.equal(aligned[1].start,.3);assert.equal(aligned[3].end,1.3);
});

test('las transiciones solapan escenas y los cortes no',()=>{
  const project={profile:{},storyboard:{scenes:[{id:'a'},{id:'b',transition:'dissolve'},{id:'c',transition:'cut'},{id:'d',transition:'slide'}]}};
  assert.equal(transitionFor(project,project.storyboard.scenes[2]),null);assert.equal(transitionFor(project,project.storyboard.scenes[3]),'slideleft');
  const {offsets,total}=sceneOffsets(project,[4,4,4,4],30);
  assert.deepEqual(offsets.map(item=>item.start),[0,3.6,7.6,11.2]);assert.equal(total,15.2);
});

test('el montaje respeta transiciones, mantiene la duración exacta y normaliza el audio',async t=>{
  const dir=await temporary(t);await mkdir(path.join(dir,'media'));
  for(const name of ['a','b','c'])await tone(path.join(dir,'media',name+'.mp4'),3);
  const project={output:{format:'landscape',resolution:'720p',fps:30},profile:{},assets:[],storyboard:{scenes:[{id:'a'},{id:'b',transition:'fade'},{id:'c',transition:'cut'}]}};
  const {total}=await assemble(project,dir,['a','b','c'].map(name=>({sceneId:name,path:`media/${name}.mp4`,duration:3})),path.join(dir,'final.mp4'),AbortSignal.timeout(120000));
  const probe=await probeMedia(path.join(dir,'final.mp4'));assert.equal(total,8.6);assert.ok(Math.abs(probe.duration-8.6)<0.05);assert.equal(probe.width,1280);assert.ok(probe.hasAudio);
});

test('el índice detecta planos y la búsqueda encuentra material por nombre',async t=>{
  const dir=await temporary(t);await mkdir(path.join(dir,'media'));
  const parts=['testsrc','smptebars'];for(const [index,source] of parts.entries()){const result=await execute(ffmpeg,['-y','-v','error','-f','lavfi','-i',`${source}=d=2:s=320x180:r=25`,'-pix_fmt','yuv420p',path.join(dir,`p${index}.mp4`)],{timeout:60000});assert.equal(result.code,0);}
  await writeFile(path.join(dir,'list.txt'),"file 'p0.mp4'\nfile 'p1.mp4'");await execute(ffmpeg,['-y','-v','error','-f','concat','-safe','0','-i',path.join(dir,'list.txt'),'-c','copy',path.join(dir,'media','demo-producto.mp4')],{timeout:60000});
  const index=await buildIndex(dir,{id:'v1',kind:'video',path:'media/demo-producto.mp4',name:'Demo del producto'},AbortSignal.timeout(120000),{transcribe:false});
  assert.equal(index.shots.length,2);assert.equal(index.sheet,'sheet.jpg');
  const hits=await searchMedia({assets:[{id:'v1',kind:'video',path:'media/demo-producto.mp4',name:'Demo del producto'}],recordings:[]},dir,'producto');assert.equal(hits[0].mediaId,'v1');
});

test('el storyboard en modo código crea tareas de programación y la revisión final devuelve errores a su escena',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'lumen-code-')),store=new Store(directory);t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});
  const storyboard={title:'Demo',scenes:[{id:'uno',title:'Uno',duration:4,narration:'Primera escena.',type:'title',eyebrow:'',points:['A'],sourceIds:[],engine:'hyperframes',direction:'Texto cinético.',voiceover:null},{id:'dos',title:'Dos',duration:4,narration:'Segunda escena.',type:'title',eyebrow:'',points:['B'],sourceIds:[],engine:'json',direction:'',voiceover:null}]};
  let reviews=0;const coded=[];
  const runtimeInvoke=async({kind})=>({output:kind==='plan'?{reasoning:'Uno',tasks:[{id:'board',kind:'storyboard',role:'storyboard',label:'Storyboard',dependencies:[],instruction:'Diseña.'}]}:kind==='storyboard'?structuredClone(storyboard):kind==='final-review'?(++reviews===1?{approved:false,summary:'Texto cortado',issues:[{severity:'error',sceneId:'uno',message:'El título se sale del lienzo.'}]}:{approved:true,summary:'Bien',issues:[]}):null,metrics:{durationMs:1,inputTokens:1,outputTokens:1}});
  const harness=new Harness(store,{owner:null,tokens:new Map()},{runtimeInvoke,sceneProducer:async(project,id)=>({sceneId:id,audioPath:`media/${id}.wav`,duration:4,speechDuration:3,words:[]}),renderer:async()=>({path:'media/v.mp4',duration:8}),mediaReviewer:async()=>({approved:true,summary:'ok',issues:[],frames:[]})});
  harness.codeScene=async(id,task)=>{coded.push({sceneId:task.sceneId,feedback:task.feedback});return {output:{summary:'Programada',engine:'hyperframes',files:['index.html'],verified:{lint:true,check:true,snapshotsReviewed:true},mediaUsed:[],notes:[],sourceHash:'h'+coded.length},metrics:{durationMs:1,inputTokens:1,outputTokens:1}};};
  const project=await harness.create({prompt:'Un vídeo de prueba con dos escenas.',duration:15,runtime:'codex',authoring:'code',architecture:'single',context:'minimal',style:'editorial',concurrency:2,desktop:false,sources:[],options:{autonomousProduction:false,finalReview:true,audioReview:false}});
  harness.run=async function(id){const controller=new AbortController();const operation=this.execute(id,controller.signal);this.active.set(id,{controller,operation});try{await operation;}finally{this.active.delete(id);}return store.get(id);};
  await harness.run(project.id);
  const done=store.get(project.id);
  assert.deepEqual(done.tasks.filter(task=>task.kind==='scene-code').map(task=>task.id),['code-uno']);
  assert.ok(done.tasks.find(task=>task.id==='render').dependencies.includes('code-uno'));
  assert.equal(coded.length,2);assert.equal(coded[1].feedback.issues[0].message,'El título se sale del lienzo.');
  assert.equal(done.storyboard.scenes[1].engine,'json');assert.equal(done.status,'completed');
});

test('una petición de cambio invalida solo el código de la escena y llega al programador',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'lumen-code-')),store=new Store(directory);t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});
  const harness=new Harness(store,{owner:null,tokens:new Map()},{});let started=false;harness.run=async()=>{started=true;};
  const project=await harness.create({prompt:'Un vídeo de prueba con una escena.',duration:15,runtime:'demo',authoring:'code',architecture:'single',context:'minimal',style:'editorial',concurrency:1,desktop:false,sources:[]});
  const current=store.get(project.id);current.storyboard={title:'T',scenes:[{id:'uno',title:'Uno',duration:4,narration:'Hola.',type:'title',eyebrow:'',points:[],sourceIds:[],engine:'remotion'}]};
  current.tasks=[{id:'media-uno',kind:'scene',sceneId:'uno',dependencies:[],status:'completed',output:{}},{id:'code-uno',kind:'scene-code',sceneId:'uno',dependencies:['media-uno'],status:'completed',output:{sourceHash:'x'}},{id:'render',kind:'render',dependencies:['media-uno','code-uno'],status:'completed',output:{}}];store.save(current);
  await harness.instructScene(project.id,'uno',{instruction:'Haz el título más grande'});
  const updated=store.get(project.id),task=updated.tasks.find(item=>item.id==='code-uno');
  assert.equal(task.status,'pending');assert.equal(task.feedback.instruction,'Haz el título más grande');assert.equal(updated.tasks.find(item=>item.id==='media-uno').status,'completed');assert.equal(updated.tasks.find(item=>item.id==='render').status,'pending');assert.ok(started);
  await assert.rejects(harness.instructScene(project.id,'uno',{instruction:'x'}),/Describe el cambio/);
});

test('la respuesta del programador sigue su contrato',()=>{
  assert.ok(validate('scene-code',{summary:'Hecho',engine:'remotion',files:['Scene.tsx'],verified:{lint:true,check:true,snapshotsReviewed:true},mediaUsed:[],notes:[]}));
  assert.throws(()=>validate('scene-code',{summary:'Hecho',engine:'json',files:[],verified:{lint:true,check:true,snapshotsReviewed:true},mediaUsed:[],notes:[]}));
});

test('una escena HyperFrames se prepara, verifica, versiona y renderiza con la narración',{timeout:300000},async t=>{
  const folder=await temporary(t);await mkdir(path.join(folder,'media'));
  await tone(path.join(folder,'media','voz.wav'),3,{video:false});await tone(path.join(folder,'media','clip.mp4'),3);
  const project={id:'p',prompt:'Prueba',style:'technology',output:{format:'landscape',resolution:'720p',fps:30},profile:{font:'Inter'},assets:[{id:'a1',kind:'video',path:'media/clip.mp4',name:'Clip'}],recordings:[],storyboard:{title:'T',scenes:[]}};
  const scene={id:'intro',engine:'hyperframes',title:'Hola',narration:'Hola.',points:['Uno','Dos'],type:'title',duration:3};project.storyboard.scenes.push(scene);
  const media={duration:3,speechDuration:3,audioPath:'media/voz.wav',words:[{text:'Hola',start:.1,end:.5}]};
  const {dir,brief,catalog}=await prepareWorkspace(project,scene,media,folder);
  assert.equal(catalog[0].file,'assets/media/clip.mp4');assert.match(await readFile(path.join(dir,'AGENTS.md'),'utf8'),/scene_snapshot/);
  await demoAuthor(dir,brief);assert.ok((await lintScene(dir,brief)).ok);
  const check=await checkScene(dir,brief,AbortSignal.timeout(240000));assert.ok(check.ok,JSON.stringify(check.issues));
  const first=await snapshotSources(dir,'v1');await writeFile(path.join(dir,'index.html'),(await readFile(path.join(dir,'index.html'),'utf8')).replace('Hola','Adiós'));await snapshotSources(dir,'v2');
  await restoreHistory(dir,first.id);assert.match(await readFile(path.join(dir,'index.html'),'utf8'),/>Hola</);assert.ok((await listHistory(dir)).length>=2);
  const output=path.join(folder,'segment.mp4');await renderCodeScene(project,scene,media,folder,output,AbortSignal.timeout(240000));
  const probe=await probeMedia(output);assert.ok(Math.abs(probe.duration-3)<0.1);assert.ok(probe.hasAudio);
});
