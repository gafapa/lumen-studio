import http from 'node:http';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {Store} from '../server/store.mjs';
import {Desktop} from '../server/desktop.mjs';
import {Harness} from '../server/harness.mjs';
import {invoke} from '../server/runtimes.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const store=new Store(path.resolve(`.data/verification/desktop-${Date.now()}`));
const desktop=new Desktop(store),harness=new Harness(store,desktop);
const project=await harness.create({prompt:'Prueba solo captura y grabación de cinco segundos del escritorio. No hagas clic ni escribas texto.',duration:30,runtime:'demo',architecture:'single',context:'minimal',style:'editorial',concurrency:1,desktop:true,sources:[]});
const server=http.createServer(async(req,res)=>{
  const session=desktop.tokens.get(req.headers.authorization?.replace(/^Bearer /,''));
  if(!session){res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Token inválido'}));return;}
  try{let input='';for await(const chunk of req)input+=chunk;const body=JSON.parse(input);const result=await desktop.action(session.projectId,session.actor,body.action,body.params);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));}
  catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;process.env.LUMEN_SERVER_URL=url;
console.log('Servidor de verificación del escritorio preparado.');
try{
  if(process.argv.includes('--agents')){
    for(const runtime of ['codex','claude']){
      const token=randomUUID(),actor=`operator-${runtime}`,controller=new AbortController();desktop.acquire(project.id,actor);desktop.tokens.set(token,{projectId:project.id,actor});
      const timer=setTimeout(()=>controller.abort(),180000);
      try{
        const result=await invoke({kind:'screencast',project:{...project,runtime},task:{role:'operador',instruction:'Comprueba las herramientas MCP: toma una captura; inicia grabación con seconds=5; detén la grabación después de tu siguiente captura. No hagas clic ni escribas. Devuelve el id real. No inspecciones archivos.'},context:{sources:[],artifacts:{},feedback:null},attemptDir:path.join(harness.folder(project.id),'runs',runtime),signal:controller.signal,mcpToken:token});
        assert.ok(store.get(project.id).recordings.some(item=>item.id===result.output.recordingId&&item.status==='completed'));
        console.log(runtime,{recordingId:result.output.recordingId,metrics:result.metrics});
      }catch(error){console.error(runtime,error.message);process.exitCode=1;}finally{clearTimeout(timer);desktop.tokens.delete(token);await desktop.release(project.id,actor);}
    }
  }else{
    const actor='mcp-verification',token=randomUUID();desktop.acquire(project.id,actor);desktop.tokens.set(token,{projectId:project.id,actor});
    const client=new Client({name:'lumen-verification',version:'1.0'});
    try{
      await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve('server/mcp.mjs')],env:{...process.env,LUMEN_SERVER_URL:url,LUMEN_PROJECT_ID:project.id,LUMEN_MCP_TOKEN:token}}),{timeout:180000});
      const listed=await client.listTools();assert.equal(listed.tools.length,6);console.log('MCP',listed.tools.map(tool=>tool.name));
      const capture=await client.callTool({name:'desktop_screenshot',arguments:{}});assert.equal(capture.isError,undefined);const metadata=JSON.parse(capture.content.find(item=>item.type==='text').text);assert.ok(metadata.width>0);console.log('Captura',{width:metadata.width,height:metadata.height});
      const started=await client.callTool({name:'start_recording',arguments:{seconds:5}});assert.equal(started.isError,undefined);await new Promise(resolve=>setTimeout(resolve,2000));
      const stopped=await client.callTool({name:'stop_recording',arguments:{}});assert.ok(!stopped.isError,JSON.stringify(stopped.content));const recording=store.get(project.id).recordings.at(-1);assert.equal(recording.status,'completed');console.log('Grabación',recording);
    }finally{await client.close();desktop.tokens.delete(token);await desktop.release(project.id,actor);}
    assert.throws(()=>desktop.authorize(project.id,actor),/ya no tiene acceso/);
  }
}finally{if(desktop.recording)await desktop.stop(project.id,'human').catch(()=>{});await harness.export(project.id);await new Promise(resolve=>server.close(resolve));store.close();}
