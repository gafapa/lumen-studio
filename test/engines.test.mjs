// Motores Manim y Revideo: seguridad, verificación, capturas, render con narración y kit.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import {execute} from '../server/process.mjs';
import {prepareWorkspace,lintScene,checkScene,snapshotScene,renderCodeScene,isCodeScene} from '../server/scene-code.mjs';
import {probeMedia} from '../server/media-index.mjs';
import {ENGINE_INFO,engineList,manimAvailable,pythonAvailable} from '../server/engines.mjs';
const skipManim=manimAvailable()?false:'Manim no está instalado (scripts/install-manim.ps1)';
const skipPython=pythonAvailable()?false:'Sin Python portable (.tools/python o LUMEN_PYTHON)';
import {Store} from '../server/store.mjs';
import {Harness} from '../server/harness.mjs';
import {CollectionAgents,kitOf} from '../server/collection-agents.mjs';
import {createCollection,INHERITED_KEYS} from '../server/collections.mjs';
import {validateCreate,validate} from '../server/schemas.mjs';

async function workspace(t,engine){
  const folder=await mkdtemp(path.join(os.tmpdir(),'lumen-engine-'));t.after(()=>rm(folder,{recursive:true,force:true}));await mkdir(path.join(folder,'media'));
  assert.equal((await execute(ffmpeg,['-y','-v','error','-f','lavfi','-i','sine=f=440:d=3',path.join(folder,'media','voz.wav')],{timeout:60000})).code,0);
  const project={id:'p',prompt:'x',style:'technology',output:{format:'landscape',resolution:'720p',fps:30},profile:{font:'Inter',palette:{background:'#0B1410',ink:'#ECFDF5',accent:'#4ADE80'}},assets:[],recordings:[],storyboard:{title:'T',scenes:[]}};
  const scene={id:'s',engine,title:'Subred /24',narration:'x',points:[],type:'title',duration:3};project.storyboard.scenes.push(scene);
  const media={duration:3,speechDuration:3,audioPath:'media/voz.wav',words:[]};
  return {folder,project,scene,media,...await prepareWorkspace(project,scene,media,folder)};
}

test('el manifiesto describe los cuatro motores y el contrato los acepta',()=>{
  for(const engine of ['hyperframes','remotion','manim','revideo']){assert.ok(ENGINE_INFO[engine].bestFor&&ENGINE_INFO[engine].main);assert.ok(isCodeScene({engine}));}
  assert.match(engineList(),/Manim/);assert.match(engineList(),/Revideo/);
  assert.doesNotThrow(()=>validate('storyboard',{title:'T',scenes:[{id:'a',title:'A',duration:4,narration:'x',type:'title',eyebrow:'',points:[],sourceIds:[],engine:'manim',direction:'',voiceover:null}]}));
});

test('el guardián de Manim bloquea archivos, sistema, introspección y azar sin semilla antes de ejecutar nada',{skip:skipPython},async t=>{
  const {dir,brief}=await workspace(t,'manim');
  await writeFile(path.join(dir,'scene.py'),`import os
import random
from manim import *
class LumenScene(Scene):
    def construct(self):
        open("x.txt", "w")
        self.camera.get_image().save("C:/robado.png")
        leak = ().__class__
        n = random.random()
        self.wait(3)
`);
  const lint=await lintScene(dir,brief),rules=new Set(lint.errors.map(error=>error.rule));
  assert.equal(lint.ok,false);for(const rule of ['import','builtin','io','dunder','nondeterministic'])assert.ok(rules.has(rule),rule+': '+JSON.stringify(lint.errors));
  await writeFile(path.join(dir,'scene.py'),'from manim import *\nclass Otra(Scene):\n    def construct(self):\n        self.wait(3)\n');
  assert.ok((await lintScene(dir,brief)).errors.some(error=>error.rule==='scene'),'la clase principal debe llamarse LumenScene');
});

for(const engine of ['manim','revideo'])test(`una escena ${engine} se verifica, se captura y se renderiza con la narración y la duración exacta`,{timeout:600000,skip:engine==='manim'&&skipManim},async t=>{
  const {folder,project,scene,media,dir,brief}=await workspace(t,engine);
  assert.match(await readFile(path.join(dir,'AGENTS.md'),'utf8'),new RegExp('## '+ENGINE_INFO[engine].label));
  const check=await checkScene(dir,brief,AbortSignal.timeout(300000));assert.ok(check.ok,JSON.stringify(check.issues));
  const frames=await snapshotScene(dir,brief,[0.3,1.5,2.8]);assert.equal(frames.length,3);
  const output=path.join(folder,'segmento.mp4');await renderCodeScene(project,scene,media,folder,output,AbortSignal.timeout(600000));
  const probe=await probeMedia(output);assert.ok(Math.abs(probe.duration-3)<0.1,String(probe.duration));assert.equal(probe.width,1280);assert.ok(probe.hasAudio);
});

test('Revideo solo admite sus paquetes y exige la escena por defecto',async t=>{
  const {dir,brief}=await workspace(t,'revideo');
  await writeFile(path.join(dir,'src','scene.tsx'),"import fs from 'fs';\nimport {makeScene2D} from '@revideo/2d';\nexport const x=1;\nfetch('http://x');\n");
  let rules=new Set((await lintScene(dir,brief)).errors.map(error=>error.rule));for(const rule of ['node','network'])assert.ok(rules.has(rule),rule);
  await writeFile(path.join(dir,'src','scene.tsx'),"import _ from 'lodash';\nimport {makeScene2D} from '@revideo/2d';\nexport const x=1;\n");
  rules=new Set((await lintScene(dir,brief)).errors.map(error=>error.rule));for(const rule of ['import','export'])assert.ok(rules.has(rule),rule);
});

for(const engine of ['manim','revideo'])test(`el kit de demostración se crea también en ${engine}`,{timeout:600000,skip:engine==='manim'&&skipManim},async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'lumen-engine-kit-')),store=new Store(directory);t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});
  const validateSettings=values=>validateCreate({...Object.fromEntries(INHERITED_KEYS.map(key=>[key,values[key]])),prompt:'Validación de ajustes del proyecto',duration:60,sources:[]});
  const collection=createCollection(store,{name:'Serie',settings:{runtime:'demo'}},validateSettings),agents=new CollectionAgents(store,new Harness(store,{owner:null,tokens:new Map()},{}),{tokens:new Map()});
  agents.kit(collection.id,{engine});await agents.active.get(collection.id+':kit-designer:'+engine).promise;
  const kit=kitOf(store.getCollection(collection.id),engine);assert.equal(kit.status,'ready');assert.equal(kit.components.length,1);
});

test('los textos en pantalla se listan y se cambian en el código sin el agente',async t=>{
  const {dir,brief}=await workspace(t,'revideo');
  await writeFile(path.join(dir,'src','scene.tsx'),"import {makeScene2D, Txt} from '@revideo/2d';\nimport {waitFor} from '@revideo/core';\nexport default makeScene2D('scene', function* (view) {\n  view.add(<><Txt text={'Máscara de subred'} fontFamily={'Segoe UI'} /><Txt text={'Puerto 67'} /><Txt text={'Puerto 67'} /></>);\n  yield* waitFor(3);\n});\n");
  const {sceneTexts,replaceSceneText}=await import('../server/scene-code.mjs');
  const texts=await sceneTexts(dir);assert.ok(texts.some(item=>item.text==='Máscara de subred'&&item.count===1));assert.equal(texts.find(item=>item.text==='Puerto 67').count,2);
  assert.ok(!texts.some(item=>item.text==='Segoe UI'||item.text.includes('@revideo')),'no lista fuentes ni importaciones');
  await replaceSceneText(dir,'Máscara de subred','Máscara de red');assert.match(await readFile(path.join(dir,'src','scene.tsx'),'utf8'),/Máscara de red/);
  await assert.rejects(replaceSceneText(dir,'Puerto 67','Puerto 68'),/2 veces/);
  assert.equal((await replaceSceneText(dir,'Puerto 67','Puerto 68',{all:true})).replaced,2);
  await assert.rejects(replaceSceneText(dir,'Puerto 68','<b>x</b>'),/no puede llevar/);
  assert.ok((await lintScene(dir,brief)).ok);
});

test('el storyboard acepta datos y conceptos y detecta un concepto usado antes de explicarse',()=>{
  const scene=(id,extra)=>({id,title:id,duration:4,narration:'x',type:'title',eyebrow:'',points:[],sourceIds:[],engine:'manim',direction:'',voiceover:null,...extra});
  assert.doesNotThrow(()=>validate('storyboard',{title:'T',scenes:[scene('a',{data:{title:'Hosts por máscara',unit:'hosts',items:[{label:'/24',value:254},{label:'/25',value:126}],source:'RFC 950'},introduces:['máscara'],uses:[]}),scene('b',{introduces:[],uses:['máscara']})]}));
  assert.throws(()=>validate('storyboard',{title:'T',scenes:[scene('a',{data:{title:'x',unit:'u',items:[{label:'a',value:'mucho'}],source:null}})]}));
});

test('cambiar de motor archiva la versión anterior y se puede volver a ella sin reprogramar',{timeout:300000},async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'lumen-engine-versions-')),store=new Store(directory);t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});
  const harness=new Harness(store,{owner:null,tokens:new Map()},{});harness.run=async()=>{};
  const project=await harness.create({prompt:'Un vídeo de prueba con una escena.',duration:15,runtime:'demo',authoring:'code',architecture:'single',context:'minimal',style:'editorial',concurrency:1,desktop:false,sources:[]});
  const current=store.get(project.id);current.storyboard={title:'T',scenes:[{id:'uno',title:'Uno',duration:4,narration:'Hola.',type:'title',eyebrow:'',points:[],sourceIds:[],engine:'manim'}]};
  current.tasks=[{id:'media-uno',kind:'scene',sceneId:'uno',dependencies:[],status:'completed',output:{duration:4}},{id:'code-uno',kind:'scene-code',sceneId:'uno',dependencies:['media-uno'],status:'completed',output:{sourceHash:'manim-1',summary:'Versión Manim'}}];store.save(current);
  const main=path.join(harness.folder(project.id),'code','uno');await mkdir(main,{recursive:true});await writeFile(path.join(main,'scene.py'),'# versión manim');
  await harness.updateScene(project.id,'uno',{engine:'revideo'});
  let latest=store.get(project.id);assert.equal(latest.storyboard.scenes[0].engine,'revideo');assert.equal(latest.engineVersions.uno.manim.output.summary,'Versión Manim');
  assert.equal(await readFile(path.join(harness.folder(project.id),'code','uno@manim','scene.py'),'utf8'),'# versión manim');
  await mkdir(main,{recursive:true});await writeFile(path.join(main,'src.tsx'),'// versión revideo');
  latest.tasks.find(task=>task.id==='media-uno').status='completed';latest.tasks.find(task=>task.id==='media-uno').output={duration:4};store.save(latest);
  await harness.restoreEngineVersion(project.id,'uno','manim');
  latest=store.get(project.id);assert.equal(latest.storyboard.scenes[0].engine,'manim');assert.equal(await readFile(path.join(main,'scene.py'),'utf8'),'# versión manim');
  assert.equal(latest.tasks.find(task=>task.id==='code-uno').output.summary,'Versión Manim','vuelve sin reprogramar');assert.ok(latest.engineVersions.uno.revideo,'la versión que se deja también se guarda');
});

test('los componentes creados desde una escena aprobada guardan su procedencia y los anteriores conservan la suya',{timeout:300000,skip:skipManim},async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'lumen-origin-')),store=new Store(directory);t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});
  const validateSettings=values=>validateCreate({...Object.fromEntries(INHERITED_KEYS.map(key=>[key,values[key]])),prompt:'Validación de ajustes del proyecto',duration:60,sources:[]});
  const collection=createCollection(store,{name:'Serie',settings:{runtime:'demo'}},validateSettings),agents=new CollectionAgents(store,new Harness(store,{owner:null,tokens:new Map()},{}),{tokens:new Map()});
  agents.kit(collection.id,{engine:'manim',exemplarId:'ejemplo-1'});await agents.active.get(collection.id+':kit-designer:manim').promise;
  let kit=kitOf(store.getCollection(collection.id),'manim');assert.deepEqual(kit.components[0].origin,{kind:'exemplar',ref:'ejemplo-1',license:null,url:null});
  agents.kit(collection.id,{engine:'manim',instruction:'Más contraste'});await agents.active.get(collection.id+':kit-designer:manim').promise;
  kit=kitOf(store.getCollection(collection.id),'manim');assert.equal(kit.components[0].origin.kind,'exemplar','un cambio posterior no borra la procedencia');
});
