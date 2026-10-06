import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import {createCanvas} from '@napi-rs/canvas';
import ffmpeg from 'ffmpeg-static';
import {Store} from '../server/store.mjs';
import {Harness} from '../server/harness.mjs';
import {Desktop} from '../server/desktop.mjs';
import {mountExtensions} from '../server/extension-routes.mjs';
import {syncAssets} from '../server/resources.mjs';
import {execute} from '../server/process.mjs';
import {validate} from '../server/schemas.mjs';

// Four subscription calls: visual assessment and use in storyboard, for each runtime.
// Original local fixtures; no paid media, recording, microphone or external research.
const directory=path.resolve('.data/verification','resources-'+Date.now());await mkdir(directory,{recursive:true});
const store=new Store(directory),desktop=new Desktop(store),harness=new Harness(store,desktop),app=express();app.use(express.json());mountExtensions(app,{store,harness,desktop});app.use((error,req,res,next)=>res.status(400).json({error:error.message}));const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const previous=process.env.LUMEN_SERVER_URL;process.env.LUMEN_SERVER_URL=`http://127.0.0.1:${server.address().port}`;const results=[];
try{
  for(const runtime of ['codex','claude']){
    const project=await harness.create({prompt:'Explica DHCP para principiantes: un cliente solicita configuración y el servidor asigna una dirección IP. Selecciona los recursos que mejor explican esa relación y evita imágenes decorativas sin relación con redes.',duration:15,runtime,architecture:'tools',context:'minimal',style:'technology',concurrency:2,desktop:false,renderer:runtime==='codex'?'remotion':'hyperframes',sources:[{name:'Apuntes DHCP',content:'DHCP permite a un cliente obtener automáticamente configuración IP del servidor. El intercambio simplificado es solicitud del cliente y respuesta del servidor.'}],options:{webResearch:false,externalMedia:false,audioReview:false,autonomousProduction:false,finalReview:false}});
    const folder=harness.folder(project.id);await mkdir(path.join(folder,'media'),{recursive:true});
    for(const [id,title,body,background] of [['dhcp','DHCP','CLIENTE  →  SERVIDOR DHCP','#efeaff'],['cake','RECETA DE TARTA','HARINA + HUEVOS + AZÚCAR','#fff2d5']]){const canvas=createCanvas(1280,720),ctx=canvas.getContext('2d');ctx.fillStyle=background;ctx.fillRect(0,0,1280,720);ctx.fillStyle='#392c60';ctx.font='bold 60px sans-serif';ctx.fillText(title,80,145);ctx.font='bold 43px sans-serif';ctx.fillText(body,80,330);if(id==='dhcp'){ctx.font='36px sans-serif';ctx.fillText('Solicitud de configuración',80,445);ctx.fillText('Respuesta: dirección IP',80,520);}await writeFile(path.join(folder,'media',id+'.png'),canvas.toBuffer('image/png'));const current=store.get(project.id);current.assets.push({id,name:title,kind:'image',path:'media/'+id+'.png',origin:'test-fixture',credit:{author:'Lumen test fixture',license:'CC0'}});store.save(current);}
    const clip=await execute(ffmpeg,['-y','-loglevel','error','-loop','1','-i',path.join(folder,'media/dhcp.png'),'-t','2','-r','12','-pix_fmt','yuv420p','-c:v','libx264','-threads','1',path.join(folder,'media/dhcp.mp4')],{timeout:30000});assert.equal(clip.code,0);
    let current=store.get(project.id);current.assets.push({id:'dhcp-clip',name:'Explicación DHCP en vídeo',kind:'video',path:'media/dhcp.mp4',origin:'test-fixture'});store.save(current);syncAssets(store,project.id);current=store.get(project.id);const task={id:'resource-review-smoke',kind:'resource-review',role:'revisor',label:'Valorar candidatos reales',resourceIds:current.resources.map(resource=>resource.id),dependencies:[],instruction:'Examina los tres candidatos y compara su valor para el encargo. No uses herramientas web.',status:'pending',attempts:0};current.tasks.push(task);store.save(current);
    await harness.executeTask(project.id,task.id,AbortSignal.timeout(240000));current=store.get(project.id);
    const good=current.resources.find(resource=>resource.assetId==='dhcp'),bad=current.resources.find(resource=>resource.assetId==='cake'),video=current.resources.find(resource=>resource.assetId==='dhcp-clip');assert.equal(good.assessment.inspected,true);assert.equal(bad.assessment.inspected,true);assert.ok(good.assessment.score>bad.assessment.score);assert.equal(bad.assessment.recommendation,'reject');assert.equal(video.previewPaths.length,3);assert.equal(video.assessment.inspected,true);assert.ok(video.assessment.limitations.length>0);
    const attempts=await readdir(path.join(folder,'runs',task.id)),attempt=path.join(folder,'runs',task.id,attempts.at(-1));const context=JSON.parse(await readFile(path.join(attempt,'context.json'),'utf8'));assert.equal(context.frames.length,5);
    const design=await harness.modelTask(project.id,{id:'design-resource-smoke',role:'storyboard',dependencies:[task.id],attempts:1,instruction:'Crea dos escenas que sumen 15 segundos. En una escena image usa el assetId del candidato de imagen que el revisor recomienda para DHCP. En la otra usa diagram con dos nodos cliente y servidor. Evita el candidato descartado. Conserva narración breve, máximo 30 palabras en total. Devuelve el contrato de storyboard.'},'storyboard',AbortSignal.timeout(240000));validate('storyboard',design.output);assert.ok(design.output.scenes.some(scene=>scene.visual?.assetId==='dhcp'));assert.ok(design.output.scenes.every(scene=>scene.visual?.assetId!=='cake'));
    results.push({runtime,renderer:project.renderer,frames:context.frames.length,assessments:current.resources.map(resource=>({name:resource.name,...resource.assessment})),storyboard:design.output,metrics:{review:current.tasks.find(item=>item.id===task.id).metrics,design:design.metrics}});console.log(runtime,'PASS',good.assessment.score,'>',bad.assessment.score,'; clip: 3 frames; storyboard uses inspected asset');
  }
  await writeFile(path.join(directory,'report.json'),JSON.stringify({passed:true,results},null,2));console.log('Informe:',path.join(directory,'report.json'));
}finally{if(previous===undefined)delete process.env.LUMEN_SERVER_URL;else process.env.LUMEN_SERVER_URL=previous;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();}
