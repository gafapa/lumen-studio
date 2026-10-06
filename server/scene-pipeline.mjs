// Programación de escenas con calidad controlada: espacio con kit y ejemplos aprobados, programador, verificación,
// crítico independiente con rondas que solo aceptan mejoras, variantes en paralelo y ejemplos del proyecto.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,copyFile,readdir,rm,stat,rename} from 'node:fs/promises';
import {prepareWorkspace,checkScene,snapshotScene,snapshotSources,sourceFiles,sourceHash,workspaceDir,listHistory,restoreHistory,lintScene,isCodeScene} from './scene-code.mjs';
import {installKit} from './collection-agents.mjs';
import {collectionContext} from './collections.mjs';
import {settings} from './settings.mjs';
import {critiqueTimes,styleFramePaths,scoreOf,MAX_SCORE,RUBRIC} from './critic.mjs';
import {stampImages,checkSeenCodes} from './review-pack.mjs';

const SKIP=file=>file.startsWith('vendor/')||file==='gsap.min.js'||file.startsWith('kit/');
const words=value=>new Set(String(value||'').toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').match(/[\p{L}\p{N}]{4,}/gu)||[]);
const exemplarFolder=(store,collectionId,exemplarId)=>path.join(store.root,'collections',collectionId,'exemplars',exemplarId);

// ---------- Ejemplos aprobados ----------
export async function installExemplars(store,collection,dir,scene,limit=2){
  const candidates=(collection?.exemplars||[]).filter(item=>item.engine===scene.engine);if(!candidates.length)return [];
  const target=words(scene.title+' '+(scene.direction||'')),ranked=candidates.map(item=>{const own=words(item.title+' '+(item.direction||''));let overlap=0;for(const word of own)if(target.has(word))overlap++;return {item,score:overlap+(item.score||0)/100};}).sort((a,b)=>b.score-a.score).slice(0,limit).map(entry=>entry.item);
  const root=path.join(dir,'lumen','references');await rm(root,{recursive:true,force:true});
  for(const item of ranked){const source=exemplarFolder(store,collection.id,item.id),destination=path.join(root,item.id);await mkdir(destination,{recursive:true});for(const name of await readdir(source).catch(()=>[]))await copyFile(path.join(source,name),path.join(destination,name)).catch(()=>{});}
  return ranked;
}
export async function saveExemplar(harness,id,sceneId,{note=''}={}){
  const project=harness.store.get(id),collection=project?.collectionId&&harness.store.getCollection(project.collectionId);if(!collection)throw new Error('Los ejemplos se guardan en un proyecto.');
  const scene=project.storyboard?.scenes.find(item=>item.id===sceneId);if(!scene||!isCodeScene(scene))throw new Error('Solo se guardan escenas programadas.');
  const task=project.tasks.find(item=>item.id==='code-'+sceneId);if(!task?.output)throw new Error('La escena todavía no está programada.');
  const dir=workspaceDir(harness.folder(id),sceneId),exemplarId=randomUUID().slice(0,12),target=exemplarFolder(harness.store,collection.id,exemplarId);await mkdir(target,{recursive:true});
  const files=[];for(const file of (await sourceFiles(dir)).filter(file=>!SKIP(file))){const name=file.replaceAll('/','__')+'.txt';await copyFile(path.join(dir,file),path.join(target,name));files.push(name);}
  const frames=[];try{const runs=(await readdir(path.join(dir,'snapshots'))).sort().reverse();for(const run of runs){for(const frame of (await readdir(path.join(dir,'snapshots',run))).filter(name=>name.endsWith('.png')).slice(0,3)){const name='frame-'+frames.length+'.png';await copyFile(path.join(dir,'snapshots',run,frame),path.join(target,name));frames.push(name);}if(frames.length)break;}}catch{}
  await writeFile(path.join(target,'README.txt'),`Escena aprobada «${scene.title}» del vídeo «${project.title}» (${scene.engine}).\nDirección: ${scene.direction||'—'}\nPlanos: ${JSON.stringify(scene.shots||[])}\nResumen: ${task.output.summary||''}\nNota del usuario: ${note||'—'}\nArchivos: ${files.join(', ')} (el sufijo .txt evita que se ejecuten; en el original las rutas usan / en lugar de __).`);
  const entry={id:exemplarId,videoId:id,videoTitle:project.title,sceneId,title:scene.title,engine:scene.engine,direction:scene.direction||'',shots:scene.shots||[],summary:task.output.summary||'',score:task.output.critique?.score??null,note:String(note).slice(0,500),files,frames,at:new Date().toISOString()};
  const latest=harness.store.getCollection(collection.id),removed=(latest.exemplars||[]).slice(0,-29);latest.exemplars=[...(latest.exemplars||[]),entry].slice(-30);harness.store.saveCollection(latest);
  for(const old of removed)await rm(exemplarFolder(harness.store,collection.id,old.id),{recursive:true,force:true});
  return entry;
}

// ---------- Espacio de trabajo con kit y ejemplos ----------
export async function prepareCodeWorkspace(harness,project,scene,media,variantId=null){
  const folder=harness.folder(project.id),{dir,brief}=await prepareWorkspace(project,variantId?{...scene,id:variantId}:scene,media,folder);
  const collection=project.collectionId&&harness.store.getCollection(project.collectionId);
  const kit=await installKit(harness.store,collection,dir,scene.engine),references=await installExemplars(harness.store,collection,dir,scene);
  let guide=await readFile(path.join(dir,'AGENTS.md'),'utf8');
  if(kit)guide+=`\n## Kit del proyecto (versión ${kit.version})\n\nEn \`kit/\` tienes los componentes compartidos del proyecto (intro, rótulos, subtítulos, cierre…). Lee \`kit/KIT.md\` y úsalos en lugar de reinventarlos, para que todos los vídeos sean coherentes. No modifiques \`kit/\`: si necesitas una variante, créala en tu escena. Componentes: ${kit.components.map(item=>item.name).join(', ')}.\n`;
  if(kit&&scene.component){const entry=kit.components.find(item=>item.name===scene.component);guide+=`\n## Componente base de esta escena: «${scene.component}»\n\nEsta escena se construye con el componente «${scene.component}» del kit${entry?` (${entry.file}): ${entry.description}\nUso: ${entry.usage}`:''}.\nÚsalo como base y complétalo con la narración, el material y los planos del storyboard; no reprogrames lo que el componente ya resuelve. Puedes combinarlo con otros componentes del kit. Si al programar compruebas que no encaja, dilo en notes.\n`;}
  else if(kit)guide+=`\n## Componentes\n\nEsta escena no tiene componente asignado: elige el componente del kit que mejor encaje y úsalo como base.\n`;
  if(references.length)guide+=`\n## Ejemplos aprobados del proyecto\n\nEn \`lumen/references/\` hay escenas que el usuario aprobó, con su código (archivos .txt) y fotogramas: ${references.map(item=>`${item.id} («${item.title}»)`).join(', ')}. Son la referencia de calidad y estilo de la serie: estúdialas y alcanza ese nivel, pero adapta, no copies.\n`;
  guide+=`\n## Crítico independiente\n\nAl terminar, otro agente puntuará fotogramas reales de tu escena (0–5) en: ${RUBRIC.map(item=>item.label.toLowerCase()).join(', ')}. Solo se acepta una versión si mejora a la anterior.\n`;
  await writeFile(path.join(dir,'AGENTS.md'),guide);await writeFile(path.join(dir,'CLAUDE.md'),guide);
  return {dir,brief,kit,references,folder,collection};
}

// ---------- Programador y crítico ----------
function agentProject(harness,project){return {...project,mcpServers:settings(harness.store).mcpServers,allowedDomains:settings(harness.store).allowedDomains,collectionContext:collectionContext(project.collectionId&&harness.store.getCollection(project.collectionId))};}
export async function invokeCoder(harness,{id,project,scene,task,dir,brief,position,existingFiles,feedback,signal,label,workspaceOverride=false}){
  const attemptDir=path.join(harness.folder(id),'runs',task.id,Date.now()+'-'+label),token=randomUUID(),actor=task.id+':'+randomUUID();
  harness.desktop.tokens?.set(token,{projectId:id,actor,kind:'scene-code',sceneId:scene.id,...(workspaceOverride?{workspace:dir}:{})});
  try{return await harness.runtimeInvoke({kind:'scene-code',project:agentProject(harness,project),task:{...task,feedback:feedback||null},context:{workspace:dir,brief,position,existingFiles,pitfalls:harness.pitfalls()},attemptDir,signal,mcpToken:token,onEvent:event=>{const interesting=event.item?.type||event.type;if(['command_execution','mcp_tool_call','tool_use','file_change'].includes(interesting)||event.type==='assistant')harness.store.event(id,'runtime.event',{taskId:task.id,event});harness.onAgentEvent?.(id,'scene-code',event,scene.id);}});}
  finally{harness.desktop.tokens?.delete(token);}
}
// Fotogramas sellados para un revisor: los códigos se guardan aparte (nunca en el contexto ni en el nombre del archivo).
async function stampFor(dir,label,images){
  const target=path.join(dir,'.lumen','review',`${Date.now()}-${label}`),stamped=await stampImages(images,target);
  await writeFile(path.join(target,'codes.json'),JSON.stringify(stamped.map(item=>({path:item.path,code:item.code}))));
  return {stamped,frames:stamped.map(item=>({path:item.path,time:item.time??null,label:item.label||null}))};
}
async function critiqueImages(dir,brief,check,signal){
  const frames=await snapshotScene(dir,brief,critiqueTimes(brief),signal);
  const crops=(check?.inspect?.crops||[]).slice(0,4).map(crop=>({path:path.join(dir,crop.path),time:crop.time,label:`texto a tamaño real (${crop.time} s)`}));
  return {frames,images:[...frames.map(frame=>({path:frame.path,time:frame.time,label:frame.time+' s'})),...crops]};
}
const measured=check=>(check?.inspect?.warnings||[]).slice(0,12).map(item=>({rule:item.rule,time:item.time,message:item.message}));
// Crítica absoluta (primera ronda y variantes): rúbrica, «¿lo publicarías?» y prueba de que miró las imágenes.
export async function critiqueScene(harness,{id,project,scene,dir,brief,previous,check=null,signal,label}){
  const {frames,images}=await critiqueImages(dir,brief,check,signal),collection=project.collectionId&&harness.store.getCollection(project.collectionId),styleFrames=await styleFramePaths(harness.store,collection);
  const {stamped,frames:shown}=await stampFor(dir,label,images);let result,seen,attempts=0;const metrics=[];
  do{attempts++;
    result=await harness.runtimeInvoke({kind:'scene-critic',project:agentProject(harness,project),task:{id:'critic-'+scene.id,role:'crítico',instruction:attempts>1?'En el intento anterior no devolviste los códigos de las imágenes: ábrelas de verdad y devuélvelos.':'',attempts,dependencies:[]},context:{mode:'absolute',scene:{title:scene.title,durationSeconds:brief.durationSeconds,engine:scene.engine,narration:scene.narration,direction:scene.direction||'',shots:brief.shots,captions:brief.captions?.enabled},frames:shown,styleFrames,previous,measured:measured(check)},attemptDir:path.join(harness.folder(id),'runs','critic-'+scene.id,Date.now()+'-'+label+'-'+attempts),signal,onEvent:event=>harness.onAgentEvent?.(id,'scene-critic',event,scene.id)});
    metrics.push(result.metrics);seen=checkSeenCodes(stamped,result.output.seenCodes);
  }while(!seen.ok&&attempts<2);
  const output=result.output,located=(output.issues||[]).filter(issue=>issue.time!=null);
  const critique={...output,issues:located,droppedIssues:(output.issues||[]).length-located.length,verified:seen.ok,looked:seen,wouldPost:output.wouldPost!==false};
  if(!seen.ok)critique.verdict='revise';
  return {critique,score:scoreOf(output),frames,images,metrics:sumMetrics(metrics.map(item=>({...item,kind:'scene-critic'})),'scene-critic')};
}
// Comparación a ciegas: dos críticos a la vez, cada uno ve primero una versión. Solo hay mejora si ambos prefieren la nueva.
async function pairwiseRound(harness,{id,project,scene,dir,brief,best,candidate,signal,label}){
  const newIs=Math.random()<0.5?'X':'Y',oldIs=newIs==='X'?'Y':'X',collection=project.collectionId&&harness.store.getCollection(project.collectionId),styleFrames=await styleFramePaths(harness.store,collection);
  const versions={[newIs]:candidate.images,[oldIs]:best.images},stampedBy={};
  for(const key of ['X','Y']){const {stamped,frames}=await stampFor(dir,`${label}-${key}`,versions[key].map(image=>({...image,label:`${key} · ${image.label}`})));stampedBy[key]={stamped,frames};}
  await writeFile(path.join(dir,'.lumen','review',`${label}-key.json`),JSON.stringify({newIs,at:new Date().toISOString()}));
  const judge=async order=>{let result,seen,attempts=0;const metrics=[];do{attempts++;
      result=await harness.runtimeInvoke({kind:'scene-critic',project:agentProject(harness,project),task:{id:'critic-'+scene.id,role:'crítico',instruction:attempts>1?'En el intento anterior no devolviste los códigos de las imágenes: ábrelas de verdad y devuélvelos.':'',attempts,dependencies:[]},context:{mode:'pairwise',order,scene:{title:scene.title,durationSeconds:brief.durationSeconds,engine:scene.engine,narration:scene.narration,direction:scene.direction||''},versions:{X:stampedBy.X.frames,Y:stampedBy.Y.frames},frames:order==='YX'?[...stampedBy.Y.frames,...stampedBy.X.frames]:[...stampedBy.X.frames,...stampedBy.Y.frames],styleFrames},attemptDir:path.join(harness.folder(id),'runs','critic-'+scene.id,Date.now()+'-'+label+'-'+order+'-'+attempts),signal,onEvent:event=>harness.onAgentEvent?.(id,'scene-critic',event,scene.id)});
      metrics.push(result.metrics);seen=checkSeenCodes([...stampedBy.X.stamped,...stampedBy.Y.stamped],result.output.seenCodes);}while(!seen.ok&&attempts<2);
    return {...result.output,verified:seen.ok,metrics:metrics.map(item=>({...item,kind:'scene-critic'}))};};
  const verdicts=await Promise.all([judge('XY'),judge('YX')]);
  const valid=verdicts.filter(item=>item.verified),improved=valid.length===2&&valid.every(item=>item.preferred===newIs);
  const wouldPostNew=valid.length>0&&valid.every(item=>item.wouldPost?.[newIs]!==false),issuesNew=valid.flatMap(item=>(item.issues||[]).filter(issue=>issue.video===newIs&&issue.time!=null).map(({video,...issue})=>issue));
  return {improved,wouldPostNew,issuesNew,reasons:valid.map(item=>item.reason),orders:verdicts.map(item=>({preferred:item.preferred===newIs?'nueva':item.preferred==='tie'?'empate':'anterior',verified:item.verified})),metrics:verdicts.flatMap(item=>item.metrics)};
}
const sumMetrics=(list,kind='scene-code')=>list.filter(Boolean).reduce((total,item)=>({...total,durationMs:total.durationMs+(item.durationMs||0),inputTokens:total.inputTokens+(item.inputTokens||0),outputTokens:total.outputTokens+(item.outputTokens||0),cachedTokens:total.cachedTokens+(item.cachedTokens||0),sessionId:item.sessionId||total.sessionId,model:item.model||total.model,effort:item.effort||total.effort}),{kind,durationMs:0,inputTokens:0,outputTokens:0,cachedTokens:0,sessionId:null,model:null,effort:null});
const criticSummary=(critique,score,history)=>critique?{score,max:MAX_SCORE,scores:critique.scores,verdict:critique.verdict,summary:critique.summary,issues:critique.issues,strengths:critique.strengths,wouldPost:critique.wouldPost!==false,wouldPostReason:critique.wouldPostReason||null,poster:critique.poster??null,verified:critique.verified!==false,history}:null;

// Rondas: la primera se juzga con rúbrica; las siguientes, por comparación a ciegas con la mejor versión.
export async function runScenePipeline(harness,id,task,signal){
  const project=harness.store.get(id),scenes=project.storyboard.scenes,index=scenes.findIndex(scene=>scene.id===task.sceneId),scene=scenes[index];
  const media=project.tasks.find(item=>item.kind==='scene'&&item.sceneId===scene.id&&item.status==='completed')?.output;if(!media)throw new Error('La escena necesita su voz y subtítulos antes de programarse.');
  if(scene.newComponent&&project.collectionId&&harness.collectionAgents){
    harness.store.event(id,'scene.component',{sceneId:scene.id,message:`Ningún componente del kit encaja con «${scene.title}»: el diseñador añade «${scene.newComponent.name}» al kit.`});
    const name=await harness.collectionAgents.ensureComponent(project.collectionId,scene.engine,scene.newComponent,{reason:`la escena «${scene.title}»: ${(scene.direction||scene.narration||'').slice(0,400)}`});signal.throwIfAborted();
    const latest=harness.store.get(id),target=latest.storyboard.scenes.find(item=>item.id===scene.id);if(target){target.component=name;target.newComponent=null;const board=latest.tasks.find(item=>item.kind==='storyboard');if(board?.output)board.output=structuredClone(latest.storyboard);harness.store.save(latest);}
    scene.component=name;scene.newComponent=null;
  }
  const {dir,brief,kit,folder}=await prepareCodeWorkspace(harness,project,scene,media);
  const critic=project.options?.critic===true&&project.runtime!=='demo',correcting=Boolean(task.feedback?.fromFinalReview&&task.feedback.previousOutput),rounds=critic?Math.max(correcting?1:0,Math.min(3,project.options?.criticRounds??1)):0;
  let feedback=task.feedback,best=null,round=0;const metrics=[],history=[];
  // Corrección pedida por la revisión final: la versión actual es la mejor hasta que dos críticos a ciegas prefieran la nueva.
  if(critic&&correcting&&(await listHistory(dir)).length){const check=await checkScene(dir,brief,signal);if(check.ok){const {images}=await critiqueImages(dir,brief,check,signal),saved=await snapshotSources(dir,'Versión antes de la corrección'),previous=task.feedback.previousOutput;
    best={result:{output:previous,metrics:{}},check,historyId:saved?.id||null,critique:previous.critique||{issues:[],wouldPost:false,verdict:'revise',summary:''},score:previous.critique?.score??null,images};history.push({round:0,kind:'versión anterior a la corrección'});}}
  const {budgetState}=await import('./receipt.mjs'),{settings:studioSettings}=await import('./settings.mjs');
  const addCriticMetrics=list=>{for(const item of list){metrics.push(item);const latest=harness.store.get(id);harness.addMetrics(latest,{...item,kind:'scene-critic'});harness.store.save(latest);}};
  for(;round<=rounds;round++){
    if(round>0&&budgetState(harness.store.get(id),studioSettings(harness.store).prices||{}).exceeded){harness.store.event(id,'scene.critique',{sceneId:scene.id,message:'Límite de gasto alcanzado: no se hacen más rondas de mejora en esta escena.'});break;}
    const authored=(await listHistory(dir)).length>0,existingFiles=authored?(await sourceFiles(dir)).filter(file=>!SKIP(file)):[];
    await snapshotSources(dir,round?`Antes de la ronda ${round+1}`:task.feedback?.instruction?'Antes de: '+task.feedback.instruction:'Antes de programar');
    const result=await invokeCoder(harness,{id,project,scene,task,dir,brief,position:(index+1)+' de '+scenes.length,existingFiles,feedback,signal,label:'ronda-'+(round+1)});metrics.push(result.metrics);signal.throwIfAborted();
    const check=await checkScene(dir,brief,signal);
    if(!check.ok){const issues=check.issues.filter(issue=>issue.severity==='error').slice(0,12);harness.recordPitfalls(issues.map(issue=>(issue.rule?issue.rule+': ':'')+issue.message));
      if(best){await restoreHistory(dir,best.historyId);harness.store.event(id,'scene.critique',{sceneId:scene.id,message:'La ronda de mejora no superó la verificación: se conserva la mejor versión.'});break;}
      throw new Error('La escena no supera la verificación de Lumen: '+issues.map(issue=>(issue.file?issue.file+':'+issue.line+' ':'')+issue.message).join(' | '));}
    if(!critic){const saved=await snapshotSources(dir,'Programada: '+result.output.summary.slice(0,120));best={result,check,historyId:saved?.id||null,critique:null,score:null};break;}
    if(!best){
      const review=await critiqueScene(harness,{id,project,scene,dir,brief,previous:null,check,signal,label:'ronda-1'});addCriticMetrics([review.metrics]);
      harness.recordPitfalls(review.critique.issues.filter(issue=>issue.severity==='error').map(issue=>issue.message));
      const saved=await snapshotSources(dir,`Ronda 1 · crítica ${review.score}/${MAX_SCORE}`),images=review.images;
      best={result,check,historyId:saved?.id||null,critique:review.critique,score:review.score,images};
      history.push({round:1,kind:'rúbrica',score:review.score,wouldPost:review.critique.wouldPost,verified:review.critique.verified});
      harness.store.event(id,'scene.critique',{sceneId:scene.id,message:`Crítica de «${scene.title}»: ${review.score}/${MAX_SCORE}${review.critique.wouldPost?'':' · no la publicaría'}${review.critique.verified?'':' · el crítico no demostró haber mirado las imágenes'}. ${review.critique.summary}`});
      if(review.critique.verdict==='accept'&&review.critique.wouldPost&&review.critique.verified)break;
      feedback={issues:review.critique.issues,summary:'El crítico pide mejoras. Conserva: '+(review.critique.strengths||[]).join('; ')};continue;
    }
    // Rondas siguientes: comparación a ciegas contra la mejor versión, en los dos órdenes.
    const {images}=await critiqueImages(dir,brief,check,signal),label=`ronda-${round+1}`;
    const verdict=await pairwiseRound(harness,{id,project,scene,dir,brief,best,candidate:{images},signal,label});addCriticMetrics(verdict.metrics);
    history.push({round:round+1,kind:'comparación a ciegas',improved:verdict.improved,orders:verdict.orders,wouldPost:verdict.wouldPostNew});
    if(verdict.improved){const saved=await snapshotSources(dir,`Ronda ${round+1} · mejora confirmada en los dos órdenes`);
      best={result,check,historyId:saved?.id||null,score:best.score,images,critique:{...best.critique,summary:verdict.reasons[0]||best.critique.summary,issues:verdict.issuesNew,wouldPost:verdict.wouldPostNew,verdict:verdict.wouldPostNew&&!verdict.issuesNew.some(issue=>issue.severity==='error')?'accept':'revise'}};
      harness.store.event(id,'scene.critique',{sceneId:scene.id,message:`Ronda ${round+1} de «${scene.title}»: los dos críticos prefieren la nueva versión.${verdict.wouldPostNew?'':' Aún no la publicarían.'}`});
      if(verdict.wouldPostNew&&best.critique.verdict==='accept')break;
      feedback={issues:verdict.issuesNew,summary:'La nueva versión mejora, pero aún hay problemas: '+verdict.reasons.join(' | ')};
    }else{await restoreHistory(dir,best.historyId);harness.store.event(id,'scene.critique',{sceneId:scene.id,message:`Ronda ${round+1} de «${scene.title}»: no hay mejora en los dos órdenes (${verdict.orders.map(item=>item.preferred).join(' / ')}); se conserva la versión anterior.`});
      feedback={issues:[...(best.critique.issues||[]),...verdict.issuesNew].slice(0,12),summary:'El intento anterior no mejoró la escena según dos críticos a ciegas: prueba otro enfoque para los problemas pendientes.'};}
  }
  const coder=metrics.filter(item=>item?.kind!=='scene-critic');
  if(best.result.metrics?.sessionId&&project.options?.persistent){const current=harness.store.get(id);current.sessions||={};current.sessions[task.id]=best.result.metrics.sessionId;harness.store.save(current);}
  return {output:{...best.result.output,engine:scene.engine,kitVersion:kit?.version||null,workspace:path.relative(folder,dir).replaceAll('\\','/'),sourceHash:await sourceHash(dir),historyId:best.historyId,rounds:Math.min(round+1,rounds+1),critique:criticSummary(best.critique,best.score,history),check:{ok:best.check.ok,warnings:[...(best.check.lint?.warnings||[]),...best.check.issues.filter(issue=>issue.severity!=='error')].slice(0,20)}},metrics:sumMetrics(coder)};
}

// ---------- Variantes ----------
export async function createVariants(harness,id,sceneId,{count=2,instruction='',engine=null}={}){
  if(harness.active.has(id))throw new Error('Detén la producción antes de probar variantes.');
  const key=id+':'+sceneId;if(harness.variantRuns.has(key))throw new Error('Ya se están generando variantes de esta escena.');
  const project=harness.store.get(id),scene=project.storyboard?.scenes.find(item=>item.id===sceneId),task=project.tasks.find(item=>item.id==='code-'+sceneId);
  if(!scene||!isCodeScene(scene)||!task?.output)throw new Error('Programa la escena antes de probar variantes.');
  const media=project.tasks.find(item=>item.kind==='scene'&&item.sceneId===sceneId&&item.output)?.output;if(!media)throw new Error('La escena no tiene voz y subtítulos.');
  const total=Math.min(3,Math.max(2,Number(count)||2)),controller=new AbortController(),folder=harness.folder(id),main=workspaceDir(folder,sceneId);
  const setState=value=>{const current=harness.store.get(id);current.sceneVariants={...current.sceneVariants,[sceneId]:{...current.sceneVariants?.[sceneId],...value}};harness.store.save(current);};
  await discardVariantDirs(harness,id,sceneId);setState({status:'running',startedAt:new Date().toISOString(),instruction,items:[],error:null});
  const critic=project.options?.critic===true&&project.runtime!=='demo',crossEngine=Boolean(engine&&engine!==scene.engine&&isCodeScene({engine})),variantScene=crossEngine?{...scene,engine,component:null,newComponent:null}:scene;
  const work=(async()=>{
    const sources=crossEngine?[]:(await sourceFiles(main)).filter(file=>!SKIP(file));
    const items=await Promise.all(Array.from({length:total},async(_,index)=>{
      const variantId=`${sceneId}--v${index+1}`;
      try{
        const {dir,brief}=await prepareCodeWorkspace(harness,project,variantScene,media,variantId);
        for(const file of sources){await mkdir(path.dirname(path.join(dir,file)),{recursive:true});await copyFile(path.join(main,file),path.join(dir,file));}
        await snapshotSources(dir,'Base de la variante');
        const result=await invokeCoder(harness,{id,project,scene,task,dir,brief,position:'variante '+(index+1),existingFiles:sources,feedback:{instruction:crossEngine?`Variante ${index+1} de ${total}: rehaz esta escena en ${engine} conservando la narración, la duración, los planos y los datos de scene.json, y aprovechando lo que este motor hace mejor. Dirección original: ${scene.direction||'—'}.${instruction?' Indicación del usuario: '+instruction:''}`:`Variante ${index+1} de ${total}: propón una alternativa visual claramente distinta de la versión actual (composición, movimiento, ritmo y uso del material), manteniendo la narración, la duración y el sentido de los planos.${instruction?' Indicación del usuario: '+instruction:''}`},signal:controller.signal,label:'variante-'+(index+1),workspaceOverride:true});
        const check=await checkScene(dir,brief,controller.signal);if(!check.ok)return {id:variantId,error:'No supera la verificación: '+check.issues.slice(0,2).map(issue=>issue.message).join(' | ')};
        const review=critic?await critiqueScene(harness,{id,project,scene:variantScene,dir,brief,check,signal:controller.signal,label:'variante-'+(index+1)}):null;
        const frames=review?.frames||await snapshotScene(dir,brief,[0.6,brief.durationSeconds/2,Math.max(0.3,brief.durationSeconds-0.4)],controller.signal);
        return {id:variantId,engine:variantScene.engine,summary:result.output.summary,score:review?.score??null,max:MAX_SCORE,critique:review?.critique?.summary||null,snapshots:frames.map(frame=>path.relative(folder,frame.path).replaceAll('\\','/'))};
      }catch(error){return {id:variantId,error:error.message};}
    }));
    setState({status:'completed',completedAt:new Date().toISOString(),items});
  })().catch(error=>setState({status:'failed',error:error.message})).finally(()=>harness.variantRuns.delete(key));
  harness.variantRuns.set(key,{controller,work});return harness.store.get(id);
}
async function discardVariantDirs(harness,id,sceneId){const root=path.join(harness.folder(id),'code');for(const name of await readdir(root).catch(()=>[]))if(name.startsWith(sceneId+'--v'))await rm(path.join(root,name),{recursive:true,force:true});}
export async function discardVariants(harness,id,sceneId){const run=harness.variantRuns.get(id+':'+sceneId);if(run){run.controller.abort();await run.work.catch(()=>{});}await discardVariantDirs(harness,id,sceneId);const project=harness.store.get(id);if(project.sceneVariants){delete project.sceneVariants[sceneId];harness.store.save(project);}return project;}
export async function chooseVariant(harness,id,sceneId,variantId){
  if(harness.active.has(id))throw new Error('Detén la producción antes de elegir una variante.');
  const project=harness.store.get(id),item=project.sceneVariants?.[sceneId]?.items?.find(entry=>entry.id===variantId&&!entry.error);if(!item)throw new Error('Variante inexistente.');
  const folder=harness.folder(id),main=workspaceDir(folder,sceneId),variant=workspaceDir(folder,variantId),scene=project.storyboard.scenes.find(entry=>entry.id===sceneId);
  const task0=project.tasks.find(entry=>entry.id==='code-'+sceneId),switching=item.engine&&item.engine!==scene.engine;
  if(switching){await archiveWorkspace(harness,project,sceneId,scene.engine,task0?.output);await mkdir(main,{recursive:true});scene.engine=item.engine;scene.component=null;const board=project.tasks.find(entry=>entry.kind==='storyboard');if(board?.output)board.output=structuredClone(project.storyboard);}
  else await snapshotSources(main,'Antes de elegir la variante '+variantId.split('--').pop());
  for(const file of (await sourceFiles(main)).filter(file=>!SKIP(file)))await rm(path.join(main,file),{force:true});
  if(switching)for(const entry of await readdir(variant,{withFileTypes:true}))if(['assets','lumen','.lumen'].includes(entry.name))await (await import('node:fs/promises')).cp(path.join(variant,entry.name),path.join(main,entry.name),{recursive:true}).catch(()=>{});
  for(const file of (await sourceFiles(variant)).filter(file=>!SKIP(file))){await mkdir(path.dirname(path.join(main,file)),{recursive:true});await copyFile(path.join(variant,file),path.join(main,file));}
  const media=project.tasks.find(entry=>entry.kind==='scene'&&entry.sceneId===sceneId)?.output;
  if(media){const {sceneBrief}=await import('./scene-code.mjs');const lint=await lintScene(main,sceneBrief(project,scene,media));if(!lint.ok)throw new Error('La variante no supera el lint en la escena principal.');}
  await snapshotSources(main,'Variante elegida: '+variantId.split('--').pop());
  const task=project.tasks.find(entry=>entry.id==='code-'+sceneId);task.output={...task.output,summary:item.summary,sourceHash:await sourceHash(main),critique:item.score!=null?{...task.output.critique,score:item.score,summary:item.critique}:task.output.critique,variantChosen:variantId};
  if(project.tasks.some(entry=>entry.id==='render'))harness.invalidate(project,'render');project.status='draft';harness.store.save(project);
  await discardVariants(harness,id,sceneId);harness.store.event(id,'scene.variant',{sceneId,message:'Variante elegida para «'+scene.title+'».'});await harness.export(id);return harness.store.get(id);
}

// ---------- Versiones por motor (idea de html-video): cambiar de motor no borra la versión anterior ----------
// La carpeta de la escena se archiva como code/<escena>@<motor> con su resultado; se puede volver a ella sin reprogramar.
export async function archiveWorkspace(harness,project,sceneId,engine,output){
  const folder=harness.folder(project.id),main=workspaceDir(folder,sceneId),archive=workspaceDir(folder,`${sceneId}@${engine}`);
  try{await stat(main);}catch{return false;}
  await rm(archive,{recursive:true,force:true});await rename(main,archive);
  project.engineVersions={...project.engineVersions,[sceneId]:{...project.engineVersions?.[sceneId],[engine]:{output:output||null,at:new Date().toISOString()}}};
  return true;
}
export async function restoreEngineVersion(harness,id,sceneId,engine){
  if(harness.active.has(id))throw new Error('Detén la producción antes de cambiar de versión.');
  const project=harness.store.get(id),saved=project.engineVersions?.[sceneId]?.[engine],scene=project.storyboard?.scenes.find(item=>item.id===sceneId);if(!saved||!scene)throw new Error('No hay una versión guardada en ese motor.');
  const folder=harness.folder(id),archive=workspaceDir(folder,`${sceneId}@${engine}`);try{await stat(archive);}catch{throw new Error('La carpeta de esa versión ya no existe.');}
  const task=project.tasks.find(item=>item.id==='code-'+sceneId);
  if(isCodeScene(scene)&&scene.engine!==engine)await archiveWorkspace(harness,project,sceneId,scene.engine,task?.output);
  else await rm(workspaceDir(folder,sceneId),{recursive:true,force:true});
  await rename(archive,workspaceDir(folder,sceneId));
  scene.engine=engine;const board=project.tasks.find(item=>item.kind==='storyboard');if(board?.output)board.output=structuredClone(project.storyboard);
  delete project.engineVersions[sceneId][engine];
  if(task){const media=project.tasks.find(item=>item.kind==='scene'&&item.sceneId===sceneId&&item.status==='completed');if(saved.output&&media){task.output=saved.output;task.status='completed';task.error=null;}else{task.status='pending';task.output=null;}}
  if(project.tasks.some(item=>item.id==='render'))harness.invalidate(project,'render');project.status='draft';harness.store.save(project);
  harness.store.event(id,'scene.engine',{sceneId,message:`«${scene.title}» vuelve a su versión en ${engine}.`});await harness.export(id);return harness.store.get(id);
}
