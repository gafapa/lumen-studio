import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {Store} from '../server/store.mjs';
import {Desktop} from '../server/desktop.mjs';
import {Harness} from '../server/harness.mjs';
import {produceScene,renderProject,technicalReview,closeMedia} from '../server/media.mjs';
const store=new Store(path.resolve(`.data/verification/computer-render-${Date.now()}`)),desktop=new Desktop(store),harness=new Harness(store,desktop);
const initial=await harness.create({prompt:'Verificación privada de grabación, narración y composición del PC.',duration:15,runtime:'demo',architecture:'single',context:'minimal',style:'editorial',concurrency:1,desktop:true,sources:[]});
const folder=harness.folder(initial.id),controller=new AbortController();
const server=http.createServer(async(req,res)=>{
  try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname.split('/files/')[1]||''),file=path.resolve(folder,name);assert.ok(file.startsWith(folder+path.sep));const buffer=await readFile(file);const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),buffer.length-1):buffer.length-1;
    res.setHeader('Content-Type',file.endsWith('.wav')?'audio/wav':'video/mp4');res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Accept-Ranges','bytes');if(range){res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${buffer.length}`);}res.setHeader('Content-Length',end-start+1);res.end(req.method==='HEAD'?undefined:buffer.subarray(start,end+1));
  }catch(error){res.statusCode=404;res.end(error.message);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));process.env.LUMEN_SERVER_URL=`http://127.0.0.1:${server.address().port}`;
try{
  await desktop.action(initial.id,'human','start_recording',{seconds:5});if(desktop.recording)await desktop.recording.completion;await desktop.stop(initial.id,'human');
  const project=store.get(initial.id);assert.equal(project.recordings[0].status,'completed');assert.ok(project.recordings[0].durationSeconds>0);
  project.storyboard={title:'Prueba de grabación',scenes:[{id:'desktop-demo',title:'Una demostración en el PC',duration:15,narration:'Esta grabación de prueba comprueba cómo incorporar una demostración del escritorio a un vídeo narrado.',type:'screencast',eyebrow:'COMPUTER USE',points:[],sourceIds:[]}]};
  const output=await produceScene(project,'desktop-demo',folder,controller.signal);project.tasks=[{id:'media-desktop-demo',kind:'scene',sceneId:'desktop-demo',output,status:'completed'}];
  project.render=await renderProject(project,folder,controller.signal,progress=>{if(progress%25===0)console.log('Render',progress);});
  const review=await technicalReview(project,folder,controller.signal);assert.equal(review.approved,true);store.save(project);await harness.export(project.id);console.log('PC → voz → MP4',{path:project.render.path,seconds:project.render.duration,clipSeconds:output.recordingDuration,size:project.render.size,decode:review.approved});
}finally{if(desktop.recording)await desktop.stop(initial.id,'human').catch(()=>{});await closeMedia();await new Promise(resolve=>server.close(resolve));store.close();}
