import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import express from 'express';
import {Store} from '../server/store.mjs';
import {Harness} from '../server/harness.mjs';
import {Desktop} from '../server/desktop.mjs';
import {mountExtensions} from '../server/extension-routes.mjs';
import {runtimeStatus} from '../server/runtimes.mjs';
import {validate} from '../server/schemas.mjs';

// Two subscription CLI calls, isolated from the studio; no recording or paid media.
try{process.loadEnvFile(path.resolve('.env'));}catch(error){if(error.code!=='ENOENT')throw error;}
const directory=path.resolve('.data/verification',`capabilities-${Date.now()}`);
await mkdir(directory,{recursive:true});
const store=new Store(directory),desktop=new Desktop(store),harness=new Harness(store,desktop),app=express();
app.use(express.json());mountExtensions(app,{store,harness,desktop});app.use((error,req,res,next)=>res.status(400).json({error:error.message}));
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const previousServer=process.env.LUMEN_SERVER_URL;process.env.LUMEN_SERVER_URL=`http://127.0.0.1:${server.address().port}`;
const results=[];
try{
  const status=await runtimeStatus();
  for(const runtime of ['codex','claude']){
    assert.equal(status[runtime].authenticated,true,`Inicia sesión en ${runtime}.`);
    const renderer=runtime==='codex'?'remotion':'hyperframes';
    const project=await harness.create({prompt:'Explica DHCP en 15 segundos para principiantes. Diseña dos escenas: un proceso cliente-servidor y dos líneas de un ejemplo de comandos. Usa exclusivamente los apuntes y representaciones reales del motor elegido. Máximo 25 palabras de narración total.',duration:15,runtime,architecture:'tools',context:'minimal',style:'technology',concurrency:2,desktop:false,renderer,output:{format:'portrait',resolution:'720p',fps:24},options:{persistent:false,externalMedia:false,webResearch:false,audioReview:false,finalReview:false},sources:[{name:'Apuntes',content:'DHCP asigna automáticamente configuración de red. El cliente solicita y el servidor responde. En Windows ipconfig /release libera la configuración e ipconfig /renew solicita una nueva. Aquí mostramos texto de ejemplo, no ejecutamos comandos.'}]});
    const task={id:'design-capabilities',role:'storyboard',dependencies:[],attempts:1,instruction:'Antes de diseñar debes llamar a studio_capabilities por MCP. Consulta authoring.components y sus presentaciones. Usa los tipos apropiados y IDs de fuentes aportadas. No investigues en la web ni uses proveedores, grabaciones o código libre. Devuelve únicamente el contrato de storyboard.'};
    const result=await harness.modelTask(project.id,task,'storyboard',AbortSignal.timeout(240000));validate('storyboard',result.output);
    const attempts=await readdir(path.join(harness.folder(project.id),'runs',task.id));
    const attempt=path.join(harness.folder(project.id),'runs',task.id,attempts.at(-1));
    const catalog=JSON.parse(await readFile(path.join(attempt,'capabilities.json'),'utf8')),events=await readFile(path.join(attempt,'events.jsonl'),'utf8');
    assert.equal(catalog.selected.renderer,renderer);assert.equal(catalog.runtimes.active,runtime);assert.equal(catalog.media.externalAllowed,false);
    assert.ok(events.split('\n').some(line=>{if(!line)return false;const event=JSON.parse(line);return runtime==='codex'?event.item?.tool==='studio_capabilities':event.message?.content?.some(block=>block.type==='tool_use'&&block.name.endsWith('studio_capabilities'));}),'El agente debe consultar la herramienta MCP.');
    assert.equal(result.output.scenes.length,2);assert.ok(result.output.scenes.every(scene=>catalog.authoring.sceneTypes.includes(scene.type)));
    assert.ok(result.output.scenes.every(scene=>!scene.visual?.providerIds?.length&&!scene.visual?.recordingId&&!scene.visual?.assetId));
    results.push({runtime,renderer,mcpCapabilitiesConsulted:true,sceneTypes:result.output.scenes.map(scene=>scene.type),metrics:result.metrics,attempt});
    console.log(runtime,renderer,'PASS',result.output.scenes.map(scene=>scene.type).join(', '));
  }
  await writeFile(path.join(directory,'report.json'),JSON.stringify({passed:true,results},null,2));
  console.log('Informe:',path.join(directory,'report.json'));
}finally{
  if(previousServer===undefined)delete process.env.LUMEN_SERVER_URL;else process.env.LUMEN_SERVER_URL=previousServer;
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();
}
