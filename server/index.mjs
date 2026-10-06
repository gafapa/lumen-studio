import express from 'express';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile} from 'node:fs/promises';
import {Store} from './store.mjs';
import {Harness} from './harness.mjs';
import {Desktop} from './desktop.mjs';
import {runtimeStatus} from './runtimes.mjs';
import {demoStoryboard} from './demo.mjs';
import {closeMedia} from './media.mjs';
import {mountExtensions} from './extension-routes.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
try{process.loadEnvFile(process.env.LUMEN_ENV_FILE||path.join(root,'.env'));}catch(error){if(error.code!=='ENOENT')throw error;}
const store=new Store(process.env.LUMEN_DATA_DIR||path.join(root,'.data'));store.recover();
const desktop=new Desktop(store),harness=new Harness(store,desktop),app=express();
const port=Number(process.env.PORT||4310);process.env.LUMEN_SERVER_URL=`http://127.0.0.1:${port}`;
if(process.env.LUMEN_SHUTDOWN_TOKEN)app.post('/api/shutdown',(req,res)=>{if(req.headers.authorization!=='Bearer '+process.env.LUMEN_SHUTDOWN_TOKEN)return res.sendStatus(403);res.sendStatus(202);setTimeout(close,20);});
app.use((req,res,next)=>{
  const origin=req.headers.origin;
  const mediaRequest=/^\/api\/projects\/[^/]+\/files\//.test(req.path);
  if(origin&&mediaRequest&&/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)&&['GET','HEAD','OPTIONS'].includes(req.method)){
    // Remotion opens its composition on a temporary loopback port.
    res.set({'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Methods':'GET, HEAD','Access-Control-Allow-Headers':'Range'});
    if(req.method==='OPTIONS')return res.sendStatus(204);return next();
  }
  if(origin&&!new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`,'http://127.0.0.1:5173','http://localhost:5173']).has(origin))return res.status(403).json({error:'Origen no permitido.'});
  next();
});
app.use(express.json({limit:'85mb'}));
const benchmarks=mountExtensions(app,{store,harness,desktop});
const route=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(error){next(error);}};
const requireProject=(req,res,next)=>{if(!store.get(req.params.id))return res.status(404).json({error:'Proyecto inexistente.'});next();};
let statusCache=null,statusAt=0;
app.get('/api/health',route(async(req,res)=>{if(!statusCache||Date.now()-statusAt>30000){statusCache=await runtimeStatus();statusAt=Date.now();}res.json({runtimes:statusCache,desktop:desktop.status(),activeProjects:[...harness.active.keys()],version:'0.1.0'});}));
app.get('/api/projects',(req,res)=>res.json(store.list()));
app.post('/api/projects',route(async(req,res)=>res.status(201).json(await harness.create(req.body))));
app.get('/api/projects/:id',requireProject,(req,res)=>res.json(store.get(req.params.id)));
app.get('/api/projects/:id/events',requireProject,(req,res)=>res.json(store.events(req.params.id)));
app.post('/api/projects/:id/run',requireProject,route(async(req,res)=>res.json(await harness.run(req.params.id))));
app.post('/api/projects/:id/pause',requireProject,route(async(req,res)=>res.json(await harness.pause(req.params.id))));
app.post('/api/projects/:id/approve',requireProject,route(async(req,res)=>{if(harness.active.has(req.params.id))throw new Error('Espera a que termine la revisión antes de aprobar.');res.json(await harness.approve(req.params.id));}));
app.post('/api/projects/:id/regenerate',requireProject,route(async(req,res)=>res.json(await harness.regenerate(req.params.id,req.body.taskId))));
app.post('/api/projects/:id/budget/continue',requireProject,route(async(req,res)=>res.json(await harness.continueBudget(req.params.id))));
app.patch('/api/projects/:id/publication',requireProject,route(async(req,res)=>{const project=store.get(req.params.id);if(!project.publication)throw new Error('Este vídeo aún no tiene publicación.');const body=req.body||{},clean=value=>String(value??'').slice(0,5000);
  const next={...project.publication,...(body.title!=null?{title:clean(body.title).slice(0,100)}:{}),...(body.description!=null?{description:clean(body.description)}:{}),...(body.shareText!=null?{shareText:clean(body.shareText).slice(0,500)}:{}),...(Array.isArray(body.tags)?{tags:body.tags.map(tag=>clean(tag).slice(0,40)).filter(Boolean).slice(0,20)}:{}),...(Array.isArray(body.chapters)?{chapters:body.chapters.map(chapter=>({time:Math.max(0,Number(chapter.time)||0),title:clean(chapter.title).slice(0,100)})).filter(chapter=>chapter.title).slice(0,30)}:{}),edited:true,editedAt:new Date().toISOString()};
  project.publication=next;store.save(project);res.json(next);}));
app.get('/api/projects/:id/receipt',requireProject,route(async(req,res)=>{const {receipt}=await import('./receipt.mjs');const {settings}=await import('./settings.mjs');res.json(receipt(store.get(req.params.id),{prices:settings(store).prices||{}}));}));
app.patch('/api/projects/:id/scenes/:sceneId',requireProject,route(async(req,res)=>{if(store.get(req.params.id).example)throw new Error('Genera este ejemplo antes de editar su producción.');res.json(await harness.updateScene(req.params.id,req.params.sceneId,req.body));}));
app.put('/api/projects/:id/sources',requireProject,route(async(req,res)=>res.json(await harness.sources(req.params.id,req.body.sources))));
app.put('/api/projects/:id/desktop',requireProject,route(async(req,res)=>{
  if(typeof req.body.enabled!=='boolean')throw new Error('Configuración inválida.');
  const original=store.get(req.params.id);original.desktop=req.body.enabled;store.save(original);
  if(!req.body.enabled){if(harness.active.has(req.params.id))await harness.pause(req.params.id);if(desktop.recording?.projectId===req.params.id)await desktop.stop(req.params.id,'human');if(desktop.owner?.projectId===req.params.id)desktop.owner=null;}
  const project=store.get(req.params.id);project.desktop=req.body.enabled;store.save(project);res.json(project);
}));
app.post('/api/projects/:id/desktop/emergency-stop',requireProject,route(async(req,res)=>{
  const id=req.params.id,project=store.get(id);project.desktop=false;store.save(project);
  for(const [token,session] of desktop.tokens)if(session.projectId===id)desktop.tokens.delete(token);
  if(harness.active.has(id))await harness.pause(id);
  if(desktop.recording?.projectId===id)await desktop.stop(id,'human').catch(error=>store.event(id,'recording.failed',{message:error.message}));
  if(desktop.owner?.projectId===id)desktop.owner=null;
  store.event(id,'desktop.emergency-stop',{message:'Operador detenido y control del PC desactivado.'});await harness.export(id);res.json(store.get(id));
}));
app.post('/api/projects/:id/desktop/:action',requireProject,route(async(req,res)=>res.json(await desktop.action(req.params.id,'human',req.params.action,req.body))));
app.post('/api/projects/:id/stop-recording',requireProject,route(async(req,res)=>res.json(await desktop.stop(req.params.id,'human'))));
app.post('/api/internal/desktop',route(async(req,res)=>{const token=req.headers.authorization?.replace(/^Bearer /,'');const authorization=desktop.tokens.get(token);if(!authorization||authorization.projectId!==req.body.projectId)return res.status(403).json({error:'Sesión de agente no autorizada.'});res.json(await desktop.action(authorization.projectId,authorization.actor,req.body.action,req.body.params));}));
app.get('/api/projects/:id/files/*file',requireProject,route(async(req,res)=>{
  const directory=harness.folder(req.params.id),file=path.resolve(directory,...req.params.file);
  if(!file.startsWith(directory+path.sep))return res.status(403).json({error:'Ruta inválida.'});
  // The project directory lives under .data; permit this known directory after confinement.
  if(req.query.download)res.download(file,path.basename(file),{dotfiles:'allow'});else res.sendFile(file,{dotfiles:'allow'});
}));
app.get('/api/live',(req,res)=>{
  res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.flushHeaders();res.write('data: {"type":"connected"}\n\n');
  const unsubscribe=store.subscribe(event=>res.write(`data: ${JSON.stringify(event)}\n\n`));
  const timer=setInterval(()=>res.write(': keepalive\n\n'),15000);req.on('close',()=>{unsubscribe();clearInterval(timer);});
});
if(process.argv.includes('--production')){app.use(express.static(path.join(root,'dist')));app.get('/{*path}',(req,res)=>res.sendFile(path.join(root,'dist/index.html')));}
app.use((error,req,res,next)=>{console.error(error.message);if(!res.headersSent)res.status(error.status||400).json({error:error.message});});
if(!store.list().length){const project=await harness.create({prompt:'Crea un vídeo de 2 minutos explicando qué es DHCP para principiantes.',duration:120,runtime:'demo',architecture:'multi',context:'minimal',style:'editorial',concurrency:2,desktop:false,sources:[{name:'Fuente de ejemplo',content:'RFC 2131 — https://www.rfc-editor.org/rfc/rfc2131. Demostración fija de DHCP, preparada para explorar el estudio.'}]});project.storyboard=demoStoryboard(project);project.title='DHCP, explicado de forma sencilla';project.example=true;store.save(project);await harness.export(project.id);}
const server=app.listen(port,'127.0.0.1',()=>console.log(`Lumen API: http://127.0.0.1:${port}${process.argv.includes('--production')?' · Estudio disponible en esta dirección':''}`));
let closing=false;async function close(){if(closing)return;closing=true;for(const id of [...benchmarks.active.keys()])await benchmarks.pause(id);for(const id of harness.active.keys())await harness.pause(id);if(desktop.recording)await desktop.stop(desktop.recording.projectId,'human').catch(()=>{});await closeMedia().catch(()=>{});server.close(()=>{store.close();process.exit(0);});setTimeout(()=>process.exit(0),10000).unref();}
process.on('SIGINT',close);process.on('SIGTERM',close);
