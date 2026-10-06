import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,readFile,readdir,writeFile,copyFile} from 'node:fs/promises';
import express from 'express';
import {Store} from '../server/store.mjs';
import {Harness} from '../server/harness.mjs';
import {Desktop} from '../server/desktop.mjs';
import {mountExtensions} from '../server/extension-routes.mjs';
import {runtimeStatus} from '../server/runtimes.mjs';
import {validate} from '../server/schemas.mjs';
import {validateSceneMedia} from '../server/design-media.mjs';
const root=path.resolve('.data/verification/design-agents-'+Date.now()),store=new Store(root),desktop=new Desktop(store),harness=new Harness(store,desktop),app=express();app.use(express.json());mountExtensions(app,{store,harness,desktop});app.use((error,req,res,next)=>res.status(400).json({error:error.message}));
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const previous=process.env.LUMEN_SERVER_URL;process.env.LUMEN_SERVER_URL='http://127.0.0.1:'+server.address().port;
const results=[];
try{
  const status=await runtimeStatus();for(const runtime of ['codex','claude']){
    assert.equal(status[runtime].authenticated,true);
    const project=await harness.create({prompt:'Explica DHCP en 15 segundos con dos escenas dinámicas. Mezcla diagramas de código, texto y DOS fragmentos distintos de un recurso de vídeo. Usa solo estos apuntes y recursos, narración total máximo 25 palabras.',duration:15,runtime,architecture:'tools',context:'minimal',style:'technology',concurrency:2,desktop:false,renderer:runtime==='codex'?'remotion':'hyperframes',profile:{visualIntensity:'cinematic'},options:{externalMedia:false,webResearch:false,finalReview:false,audioReview:false},sources:[{name:'Apuntes',content:'DHCP configura automáticamente la red: el cliente solicita y el servidor responde. El recurso de prueba tiene 4 segundos: rojo entre 0 y 2, azul entre 2 y 4. Es un recurso de prueba de composición, no representa una captura real de paquetes.'}]});
    const folder=harness.folder(project.id);await mkdir(path.join(folder,'media'),{recursive:true});await copyFile(process.argv[2],path.join(folder,'media/source.mp4'));project.assets=[{id:'video-source',name:'Recurso de prueba con dos planos',kind:'video',path:'media/source.mp4'}];project.resources=[{id:'resource-source',assetId:'video-source',kind:'video',name:'Recurso de prueba',path:'media/source.mp4',status:'ready',decision:'use',metadata:{duration:4,width:640,height:360},assessment:{inspected:false,recommendation:'reserve',limitations:['Recurso sintético para verificar cortes; no simules una valoración visual.']}}];store.save(project);
    const task={id:'design-multilayer',role:'storyboard',dependencies:[],attempts:1,instruction:'Llama a studio_capabilities por MCP antes de diseñar. Devuelve exactamente dos escenas. Primera: composition canvas con EXACTAMENTE CUATRO capas: text (título), icon (red), media clip-a y media clip-b. Segunda: composition=null con plantilla diagram y dos points. Las DOS capas media que usen video-source con intervalos from/to DIFERENTES dentro de 0–4 s. Programa sus starts para un montaje legible; duration igual a (to-from)/rate. No inventes fuentes, recursos, proveedores ni datos. Usa graph JSON, no código libre.'};
    const result=await harness.modelTask(project.id,task,'storyboard',AbortSignal.timeout(600000));validate('storyboard',result.output);for(const scene of result.output.scenes)validateSceneMedia(project,scene);
    assert.equal(result.output.scenes.length,2);const layers=result.output.scenes.flatMap(scene=>scene.composition?.layers||[]),media=layers.filter(layer=>layer.type==='media');assert.ok(media.length>=2);assert.ok(media.every(layer=>layer.media.assetId==='video-source'&&layer.media.from>=0&&layer.media.to<=4));assert.ok(new Set(media.map(layer=>layer.media.from+':'+layer.media.to)).size>=2);assert.ok(layers.some(layer=>['icon','line','shape','chart'].includes(layer.type)));
    const attempts=await readdir(path.join(folder,'runs',task.id)),attempt=path.join(folder,'runs',task.id,attempts.at(-1)),events=await readFile(path.join(attempt,'events.jsonl'),'utf8');assert.ok(events.includes('studio_capabilities'));
    results.push({runtime,renderer:project.renderer,compositionScenes:result.output.scenes.filter(scene=>scene.composition).length,layers:layers.length,cuts:media.map(layer=>layer.media),metrics:result.metrics,attempt});console.log('PASS',runtime,layers.length+' capas',media.length+' cortes');
  }
  await writeFile(path.join(root,'report.json'),JSON.stringify({passed:true,results},null,2));console.log('REPORT',path.join(root,'report.json'));
}finally{if(previous===undefined)delete process.env.LUMEN_SERVER_URL;else process.env.LUMEN_SERVER_URL=previous;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();}
