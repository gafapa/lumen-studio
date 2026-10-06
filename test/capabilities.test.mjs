import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {Store} from '../server/store.mjs';
import {Harness} from '../server/harness.mjs';
import {Desktop} from '../server/desktop.mjs';
import {mountExtensions} from '../server/extension-routes.mjs';
import {buildCapabilities,capabilitiesForRole} from '../server/capabilities.mjs';
import {sceneSchema,schemas} from '../server/schemas.mjs';
import {updateSettings} from '../server/settings.mjs';
import {invoke} from '../server/runtimes.mjs';

const input={prompt:'Explica DHCP mediante un cliente y un servidor.',duration:15,runtime:'demo',architecture:'tools',context:'minimal',style:'technology',concurrency:3,desktop:false,sources:[{name:'Apuntes',content:'DHCP configura automáticamente la red.'}],renderer:'remotion',output:{format:'portrait',resolution:'1080p',fps:24},options:{externalMedia:false,webResearch:false,persistent:true}};
async function setup(t){const folder=await mkdtemp(path.join(os.tmpdir(),'lumen-capabilities-')),store=new Store(folder);t.after(async()=>{store.close();assert.ok(path.resolve(folder).startsWith(path.join(os.tmpdir(),'lumen-capabilities-')));await rm(folder,{recursive:true,force:true});});const desktop=new Desktop(store),harness=new Harness(store,desktop);return {folder,store,desktop,harness,project:await harness.create(input)};}

test('el catálogo deriva el contrato y distingue las presentaciones de los motores',()=>{
  const remotion=buildCapabilities({project:input}),hyperframes=buildCapabilities({project:{...input,renderer:'hyperframes'}});
  assert.deepEqual(remotion.authoring.sceneTypes,sceneSchema.properties.type.enum);
  assert.deepEqual(remotion.authoring.components.map(component=>component.type),sceneSchema.properties.type.enum);
  assert.equal(remotion.authoring.limits.maxScenes,schemas.storyboard.properties.scenes.maxItems);
  assert.deepEqual([remotion.selected.output.width,remotion.selected.output.height,remotion.selected.output.fps],[1080,1920,24]);
  assert.match(remotion.authoring.components.find(component=>component.type==='code').presentation,/monoespaciado/);
  assert.match(hyperframes.authoring.components.find(component=>component.type==='code').presentation,/no hay bloque monoespaciado/);
  assert.match(hyperframes.authoring.components.find(component=>component.type==='screencast').presentation,/silencia/);
  assert.equal(hyperframes.authoring.customRendererCode,false);
  assert.match(hyperframes.authoring.transitionBehavior,/sin solapamiento/);
  assert.ok(hyperframes.engines.hyperframes.potential.includes('GSAP'));
});

test('solo anuncia proveedores listos y respeta permisos sin revelar configuración secreta',()=>{
  const providers=[{id:'image-ok',kind:'image',adapter:'http',ready:true,enabled:true,keyEnv:'PRIVATE_KEY',url:'https://secret.invalid',input:{secret:'hidden'}},{id:'disabled',kind:'video',ready:true,enabled:false},{id:'missing-key',kind:'image',ready:false,enabled:true}];
  const disabled=buildCapabilities({project:input,providers});assert.deepEqual(disabled.media.providers,[]);assert.equal(disabled.runtimes.web.enabled,false);assert.ok(!disabled.runtimes.mcp.tools.includes('web_source'));assert.ok(!disabled.runtimes.mcp.tools.includes('desktop_click'));
  const enabled=buildCapabilities({project:{...input,desktop:true,options:{externalMedia:true,webResearch:true}},providers,kind:'screencast',mcpServers:[{id:'remote',enabled:true,command:'secret',args:['password']}]});
  assert.deepEqual(enabled.media.providers,[{id:'image-ok',kind:'image',adapter:'http'}]);
  assert.ok(enabled.runtimes.mcp.tools.includes('desktop_click'));assert.ok(enabled.runtimes.mcp.tools.includes('web_source'));
  assert.equal(enabled.runtimes.computerUse.allowedForThisAgent,true);
  assert.ok(!JSON.stringify(enabled).includes('PRIVATE_KEY'));assert.ok(!JSON.stringify(enabled).includes('secret.invalid'));assert.ok(!JSON.stringify(enabled).includes('password'));
  const designer=buildCapabilities({project:{...input,desktop:true},kind:'storyboard'});assert.equal(designer.runtimes.computerUse.allowedForThisAgent,false);
  const single=buildCapabilities({project:{...input,architecture:'single'},kind:'script'});assert.equal(single.runtimes.mcp.enabled,false);assert.deepEqual(single.runtimes.mcp.tools,[]);
  // El storyboard siempre puede consultar el material indexado del proyecto.
  const board=buildCapabilities({project:{...input,architecture:'single'},kind:'storyboard'});assert.equal(board.runtimes.mcp.enabled,true);assert.ok(board.runtimes.mcp.tools.includes('media_search'));assert.ok(!board.runtimes.mcp.tools.includes('scene_check'));
});

test('el director, diseñador y revisores conservan el catálogo completo; investigación usa uno compacto',()=>{
  const catalog=buildCapabilities({project:input});
  for(const kind of ['plan','storyboard','production-plan','review','final-review'])assert.ok(capabilitiesForRole(catalog,kind).authoring);
  const compact=capabilitiesForRole(catalog,'research');assert.equal(compact.authoring,undefined);assert.equal(compact.scope,'research');assert.equal(compact.runtimes.active,'demo');assert.ok(JSON.stringify(compact).length<JSON.stringify(catalog).length*.6);
});

test('el harness actualiza capacidades con contexto mínimo y al cambiar el proyecto',async t=>{
  const {store,harness,project,desktop}=await setup(t),calls=[];
  harness.runtimeInvoke=async args=>{calls.push(args);assert.equal(desktop.tokens.get(args.mcpToken).kind,args.kind);return {output:{},metrics:{}};};
  const task={id:'design',role:'storyboard',dependencies:[],instruction:'Diseña',attempts:1};
  await harness.modelTask(project.id,task,'storyboard',new AbortController().signal);
  assert.equal(calls[0].context.capabilities.selected.renderer,'remotion');assert.ok(calls[0].context.capabilities.authoring.components.length);assert.deepEqual(calls[0].context.providers,[]);assert.equal(desktop.tokens.size,0);
  updateSettings(store,{providers:[{id:'local-bridge',adapter:'http',kind:'image',url:'http://127.0.0.1:8189',enabled:true}]});
  await harness.configure(project.id,{renderer:'hyperframes',options:{externalMedia:true}});
  await harness.modelTask(project.id,task,'storyboard',new AbortController().signal);
  assert.equal(calls[1].context.capabilities.selected.renderer,'hyperframes');assert.deepEqual(calls[1].context.providers,[{id:'local-bridge',kind:'image',adapter:'http'}]);
  assert.equal(calls[1].context.projectFolder,harness.folder(project.id));
});

test('el adaptador directo guarda el catálogo y aplica la skill de storyboard con las herramientas de material',async t=>{
  const {folder,project}=await setup(t),attemptDir=path.join(folder,'attempt');project.architecture='single';
  await invoke({kind:'storyboard',project,task:{id:'storyboard',role:'storyboard',instruction:''},context:{},attemptDir,signal:new AbortController().signal});
  const catalog=JSON.parse(await readFile(path.join(attemptDir,'capabilities.json'),'utf8')),context=JSON.parse(await readFile(path.join(attemptDir,'context.json'),'utf8')),prompt=await readFile(path.join(attemptDir,'prompt.txt'),'utf8');
  assert.deepEqual(context.capabilities,catalog);assert.equal(catalog.runtimes.mcp.enabled,true);assert.ok(catalog.runtimes.mcp.tools.includes('media_info'));
  assert.ok(prompt.includes('context.capabilities'));assert.ok(prompt.includes('engines.*.potential'));assert.ok(prompt.includes('Skill storyboard'));assert.ok(!prompt.includes('hyperframes-authoring'));
});

test('studio_capabilities funciona por MCP y API y conserva autorización por proyecto',async t=>{
  const {store,harness,desktop,project}=await setup(t),app=express();app.use(express.json());mountExtensions(app,{store,harness,desktop});app.use((error,req,res,next)=>res.status(400).json({error:error.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  const token='capabilities-test-token';desktop.tokens.set(token,{projectId:project.id,actor:'design',kind:'storyboard'});
  const client=new Client({name:'capabilities-test',version:'1.0.0'}),transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('server/mcp.mjs')],env:{...process.env,LUMEN_MCP_TOKEN:token,LUMEN_PROJECT_ID:project.id,LUMEN_SERVER_URL:base,LUMEN_DESKTOP_TOOLS:'0'},stderr:'pipe'});
  t.after(async()=>{await client.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});await client.connect(transport);
  const tools=await client.listTools();assert.ok(tools.tools.some(tool=>tool.name==='studio_capabilities'));assert.ok(!tools.tools.some(tool=>tool.name==='desktop_click'));
  const toolCatalog=JSON.parse((await client.callTool({name:'studio_capabilities',arguments:{}})).content[0].text);
  const apiCatalog=await (await fetch(`${base}/api/projects/${project.id}/capabilities`)).json();assert.deepEqual(toolCatalog,apiCatalog);
  await harness.configure(project.id,{renderer:'hyperframes'});
  const fresh=JSON.parse((await client.callTool({name:'studio_capabilities',arguments:{}})).content[0].text);assert.equal(fresh.selected.renderer,'hyperframes');
  const forbidden=await fetch(`${base}/api/internal/project`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({projectId:'other-project',action:'capabilities'})});assert.equal(forbidden.status,403);
});
