import assert from 'node:assert/strict';
import path from 'node:path';
import {readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import {invoke} from '../server/runtimes.mjs';
import {reviewMedia} from '../server/production.mjs';
process.env.CODEX_BIN||='codex';
process.env.CLAUDE_BIN||='claude';
const root=path.resolve('.data/verification'),folders=(await readdir(root)).filter(name=>name.startsWith('renderers-')).sort();
let sample,folder;for(const name of folders.reverse()){for(const id of await readdir(path.join(root,name,'projects'))){try{const project=JSON.parse(await readFile(path.join(root,name,'projects',id,'project.json'),'utf8'));if(project.render){sample=project;folder=path.join(root,name,'projects',id);break;}}catch{}}if(sample)break;}
if(!sample)throw new Error('Ejecuta antes scripts/renderers-smoke.mjs.');
const signal=new AbortController().signal,review=await reviewMedia(sample,folder,signal),results=[],output=path.join(root,`agent-review-${Date.now()}`);await mkdir(output,{recursive:true});
for(const runtime of ['codex','claude']){
  const project={...sample,runtime,architecture:'single',options:{persistent:true},sessions:{}},task={id:'session-probe',role:'investigador',instruction:'Resume los apuntes aportados; no necesitas otras fuentes.',dependencies:[]};
  const context={sources:[{id:'apuntes',name:'Apuntes',content:'DHCP asigna parámetros de configuración de red. El servidor administra direcciones disponibles.'}],artifacts:{}};
  const first=await invoke({kind:'research',project,task,context,attemptDir:path.join(output,runtime,'first'),signal});assert.ok(first.metrics.sessionId);project.sessions[task.id]=first.metrics.sessionId;
  const second=await invoke({kind:'research',project,task:{...task,instruction:'Actualiza tu síntesis previa poniendo primero la función del servidor. Usa los mismos apuntes.'},context,attemptDir:path.join(output,runtime,'resumed'),signal});assert.equal(second.metrics.sessionId,first.metrics.sessionId);console.log(runtime,'session resume PASS');
  const final=await invoke({kind:'final-review',project,task:{id:'final-review',role:'revisor',dependencies:[],instruction:'Examina ambos fotogramas del vídeo de prueba y comprueba que los títulos y subtítulos sean legibles.'},context:{...context,technical:review,storyboard:sample.storyboard,frames:review.frames.map(frame=>({...frame,path:path.join(folder,frame.path)}))},attemptDir:path.join(output,runtime,'review'),signal});assert.equal(typeof final.output.approved,'boolean');results.push({runtime,sessionResumed:true,review:final.output,metrics:[first.metrics,second.metrics,final.metrics]});console.log(runtime,'frame review PASS',final.output.summary);
}
await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log('Resultados:',output);
