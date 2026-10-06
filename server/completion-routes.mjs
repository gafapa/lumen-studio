import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {shareLibrary,reuseLibrary,searchLibrary} from './library.mjs';
import {reconcileProviderJob} from './provider-jobs.mjs';
import {whisperPaths} from './audio-review.mjs';
import {execute} from './process.mjs';
import {audioCaptureReady} from './loopback.mjs';
import {kokoroPython} from './media-index.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function mountCompletion(app,{store,harness}){
  if(store.setting('whisper-install',{})?.status==='running')store.setSetting('whisper-install',{status:'failed',error:'La instalación se interrumpió al cerrar el estudio. Puedes volver a iniciarla.'});
  const route=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(error){next(error);}},project=(req,res,next)=>store.get(req.params.id)?next():res.status(404).json({error:'Proyecto inexistente.'});
  app.get('/api/tools',route(async(req,res)=>res.json({whisper:await whisperPaths(),audio:{ready:await audioCaptureReady()},ocr:{ready:true},kokoro:{ready:Boolean(kokoroPython())},installation:store.setting('whisper-install',null)})));
  app.post('/api/tools/kokoro/install',route(async(req,res)=>{if(kokoroPython())return res.json({status:'completed'});const result=await execute('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/setup-kokoro.ps1')],{timeout:1800000});if(result.code!==0)throw new Error(result.stderr.slice(-700)||result.stdout.slice(-700));res.json({status:'completed'});}));
  app.post('/api/tools/audio/install',route(async(req,res)=>{const result=await execute('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/setup-audio.ps1')],{timeout:180000});if(result.code!==0)throw new Error(result.stderr.slice(-700));res.json({status:'completed'});}));
  app.post('/api/tools/whisper/install',route(async(req,res)=>{if((await whisperPaths()).ready)return res.json({status:'completed'});if(store.setting('whisper-install',{})?.status==='running')return res.json({status:'running'});store.setSetting('whisper-install',{status:'running'});execute('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/setup-whisper.ps1')],{timeout:1800000}).then(result=>store.setSetting('whisper-install',{status:result.code===0?'completed':'failed',error:result.code===0?null:result.stderr.slice(-500)})).catch(error=>store.setSetting('whisper-install',{status:'failed',error:error.message}));res.json({status:'running'});}));
  app.get('/api/projects/:id/provider-jobs',project,(req,res)=>res.json(store.jobs(req.params.id)));
  app.post('/api/projects/:id/provider-jobs/:jobId/reconcile',project,route(async(req,res)=>{if(harness.active.has(req.params.id))throw new Error('Detén el proyecto antes de reconciliar.');if(store.job(req.params.jobId)?.projectId!==req.params.id)throw new Error('Solicitud de otro proyecto.');res.json(reconcileProviderJob(store,req.params.jobId,req.body));}));
  app.post('/api/projects/:id/resources/:sceneId/:part/regenerate',project,route(async(req,res)=>res.json(await harness.regeneratePart(req.params.id,req.params.sceneId,req.params.part,req.body))));
  app.post('/api/projects/:id/resources/:sceneId/:part/approve',project,route(async(req,res)=>res.json(await harness.approvePart(req.params.id,req.params.sceneId,req.params.part))));
  app.put('/api/projects/:id/timeline',project,route(async(req,res)=>res.json(await harness.timeline(req.params.id,req.body.scenes))));
  app.get('/api/library',(req,res)=>res.json(searchLibrary(store,String(req.query.q||''))));
  app.post('/api/projects/:id/library',project,route(async(req,res)=>res.json(await shareLibrary(store,harness,req.params.id,req.body))));
  app.post('/api/projects/:id/library/:entryId/import',project,route(async(req,res)=>res.json(await reuseLibrary(store,harness,req.params.id,req.params.entryId))));
}
