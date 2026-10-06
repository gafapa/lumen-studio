import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {execute} from '../server/process.mjs';
import {prepareClip,prepareLayerMedia,validateSceneMedia} from '../server/design-media.mjs';
import {validate} from '../server/schemas.mjs';
import {sceneDesign,layerPose,layerContent,themeFor} from '../src/video/design.mjs';
import {compositionForClip} from '../src/video/design-preview.mjs';
import {compositionHtml} from '../server/hyperframes.mjs';
import {designAnimation} from '../server/design-html.mjs';
import {Store} from '../server/store.mjs';
import {Harness} from '../server/harness.mjs';
const scene={id:'scene-01',title:'Solicitud y respuesta',duration:8,narration:'El cliente solicita una configuración de red.',type:'diagram',eyebrow:'DHCP',points:['Cliente','Servidor'],sourceIds:[]};
const videoLayer={id:'clip-a',type:'media',box:{x:43,y:34,w:51,h:44},start:1,duration:2,motion:'fade',media:{assetId:'video-a',from:2,to:4,rate:1,fit:'cover'}};
const composition={layout:'canvas',background:'grid',camera:'push',layers:[videoLayer]};
test('el contrato valida geometría, cortes, capas y tiempos antes de producir',()=>{
  const valid={...scene,composition};assert.equal(validate('storyboard',{title:'DHCP',scenes:[valid]}).scenes[0],valid);
  for(const patch of [{duration:9},{box:{x:60,y:34,w:51,h:44}},{media:{from:4,to:2}},{keyframes:[{time:9,x:0,y:0,scale:1,rotation:0,opacity:1}]}])assert.throws(()=>validate('storyboard',{title:'DHCP',scenes:[{...valid,composition:{...composition,layers:[{...videoLayer,...patch}]}}]}));
  assert.throws(()=>validate('storyboard',{title:'DHCP',scenes:[{...valid,composition:{...composition,layers:[videoLayer,videoLayer]}}]}),/duplicados/);
  assert.throws(()=>validate('storyboard',{title:'DHCP',scenes:[{...valid,composition:{...composition,layers:Array.from({length:9},(_,i)=>({...videoLayer,id:'clip-'+i}))}}]}),/ocho/);
  assert.throws(()=>validate('storyboard',{title:'DHCP',scenes:[{...valid,composition:{...composition,layers:[{id:'chart',type:'chart',chart:{type:'bars'}}]}}]}),/emparejados/);
});
test('los medios requieren recursos existentes y respetan el descarte y la selección humana',()=>{
  const project={assets:[{id:'video-a',kind:'video'}],resources:[],recordings:[]};
  validateSceneMedia(project,{...scene,composition});
  assert.throws(()=>validateSceneMedia({...project,assets:[]},{...scene,composition}),/inexistente/);
  project.resources=[{assetId:'video-a',assessment:{recommendation:'reject'}}];assert.throws(()=>validateSceneMedia(project,{...scene,composition}),/descartado/);
  project.resources[0].decision='use';validateSceneMedia(project,{...scene,composition});
  assert.throws(()=>validateSceneMedia(project,{...scene,composition:{...composition,layers:[{...videoLayer,media:{recordingId:'missing'}}]}}),/grabación/);
});
test('las capas resuelven overrides, movimiento determinista y fragmentos sin tapar los títulos',()=>{
  const design=sceneDesign({...scene,type:'video',composition:{layout:'split',layers:[{...videoLayer,id:'primary'}]}},{visualIntensity:'cinematic'});
  assert.equal(design.layers.filter(layer=>layer.id==='primary').length,1);assert.ok(design.layers.some(layer=>layer.id==='heading'));
  const layer={...videoLayer,style:{opacity:.8},keyframes:[]};assert.equal(layerPose(layer,0,8).opacity,0);assert.equal(layerPose(layer,4,8).opacity,0);assert.ok(layerPose(layer,1.5,8).opacity>.7);
  assert.deepEqual(layerPose(layer,1.5,8),layerPose(layer,1.5,8));
  const canvas=compositionForClip(scene,{visualIntensity:'cinematic'});assert.ok(canvas.layers.filter(layer=>layer.id.startsWith('node')).every(layer=>layer.box.x+layer.box.w<43));
  const content=layerContent({type:'text',text:'<script>alert(1)</script>',style:{}},themeFor('technology'));assert.ok(!content.includes('<script>'));
});
test('HyperFrames conserva capas, medios temporizados y animación en la composición real',()=>{
  const project={profile:{visualIntensity:'cinematic'},style:'technology',output:{format:'landscape'}},board={...scene,composition:{...composition,layers:[{id:'heading',type:'text',text:'Un título visible',box:{x:6,y:10,w:88,h:15},start:0,motion:'rise'},videoLayer,{id:'graph',type:'chart',box:{x:6,y:36,w:30,h:35},start:0,motion:'draw',chart:{type:'line',labels:['A','B'],values:[1,2],unit:''}}]}},media={duration:8,words:[],layerMedia:[{layerId:'clip-a',path:'media/prepared.mp4',kind:'video'}]};
  const html=compositionHtml(board,media,project);assert.match(html,/Un título visible/);assert.match(html,/data-start="1" data-duration="2"/);assert.match(html,/prepared.mp4/);assert.match(html,/chart-path/);
  const animation=designAnimation(board,media,project);assert.match(animation,/strokeDashoffset/);assert.match(animation,/power2.out/);assert.match(animation,/__timelines.main/);
  const escaped=designAnimation({...scene,composition:{...composition,layers:[{id:'counter',type:'counter',start:0,chart:{values:[4],unit:'</script>'}}]}},media,project);assert.ok(!escaped.includes('</script>'));
});
test('FFmpeg extrae píxeles del intervalo seleccionado, cambia velocidad y reutiliza el archivo',async t=>{
  const folder=await mkdtemp(path.join(os.tmpdir(),'lumen-design-'));t.after(async()=>{assert.ok(folder.startsWith(path.join(os.tmpdir(),'lumen-design-')));await rm(folder,{recursive:true,force:true});});
  const source=path.join(folder,'source.mp4');const generated=await execute(ffmpeg,['-y','-v','error','-f','lavfi','-i','color=c=red:s=160x90:r=30:d=2','-f','lavfi','-i','color=c=blue:s=160x90:r=30:d=2','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-c:v','libx264','-pix_fmt','yuv420p',source]);assert.equal(generated.code,0);
  const clip=await prepareClip(folder,{path:'source.mp4',kind:'video',assetId:'video-a'},{from:2.3,to:3.7,rate:2});assert.ok(Math.abs(clip.duration-.7)<.0001);assert.equal(clip.assetId,'video-a');
  const png=path.join(folder,'cut.png');const frame=await execute(ffmpeg,['-y','-v','error','-i',path.join(folder,clip.path),'-frames:v','1',png]);assert.equal(frame.code,0);
  const canvas=createCanvas(160,90),context=canvas.getContext('2d');context.drawImage(await loadImage(png),0,0);const rgb=context.getImageData(80,45,1,1).data;assert.ok(rgb[2]>220&&rgb[0]<30,'El corte debe ser azul, sin el preroll rojo.');
  const probe=await execute(ffprobe.path,['-v','error','-show_entries','format=duration','-of','json',path.join(folder,clip.path)]);assert.ok(Math.abs(Number(JSON.parse(probe.stdout).format.duration)-.7)<.06,probe.stdout);
  const before=(await stat(path.join(folder,clip.path))).mtimeMs;const repeat=await prepareClip(folder,{path:'source.mp4',kind:'video'},{from:2.3,to:3.7,rate:2});assert.equal(repeat.path,clip.path);assert.equal((await stat(path.join(folder,clip.path))).mtimeMs,before);
  await assert.rejects(prepareClip(folder,{path:'source.mp4',kind:'video'},{from:3,to:5}),/fuera/);
  await assert.rejects(prepareClip(folder,{path:'../outside.mp4',kind:'video'},{from:0,to:1}),/pertenecer/);
  const project={assets:[{id:'video-a',kind:'video',path:'source.mp4'}],resources:[],profile:{visualIntensity:'cinematic'}};
  const layers=await prepareLayerMedia(project,{...scene,composition},folder,new AbortController().signal);assert.equal(layers[0].sourceFrom,2);assert.equal(layers[0].sourceTo,4);assert.equal(layers[0].assetId,'video-a');
});
test('editar un corte conserva la voz y solo invalida el diseño de esa escena y el render',async t=>{
  const folder=await mkdtemp(path.join(os.tmpdir(),'lumen-design-')),store=new Store(folder);t.after(async()=>{store.close();await rm(folder,{recursive:true,force:true});});
  const harness=new Harness(store,{}),project=await harness.create({prompt:'Explicar DHCP con gráficos, imágenes y cortes de vídeo.',duration:15,runtime:'demo',architecture:'tools',context:'minimal',style:'technology',concurrency:2,desktop:false,sources:[],options:{autonomousProduction:true}});
  project.assets=[{id:'video-a',kind:'video'}];project.storyboard={title:'DHCP',scenes:[scene]};project.tasks=[{id:'storyboard',kind:'storyboard',dependencies:[],status:'completed',approved:true,output:project.storyboard},...['voice','visual','captions','scene'].map(kind=>({id:kind==='scene'?'media-scene-01':kind+'-1',kind,sceneId:'scene-01',dependencies:kind==='scene'?['voice-1','visual-1','captions-1']:kind==='captions'?['voice-1']:[],status:'completed',approved:true,output:{key:kind}})),{id:'render',kind:'render',dependencies:['media-scene-01'],status:'completed',output:{}}];store.save(project);
  const updated=await harness.updateScene(project.id,scene.id,{composition});assert.equal(updated.tasks.find(task=>task.kind==='voice').status,'completed');assert.equal(updated.tasks.find(task=>task.kind==='captions').status,'completed');assert.equal(updated.tasks.find(task=>task.kind==='visual').status,'pending');assert.equal(updated.tasks.find(task=>task.kind==='render').status,'pending');
  const saved=JSON.stringify(updated.storyboard);await assert.rejects(harness.updateScene(project.id,scene.id,{composition:{...composition,layers:[{...videoLayer,duration:20}]}}));assert.equal(JSON.stringify(store.get(project.id).storyboard),saved);
});
