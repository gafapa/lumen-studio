import React,{useEffect,useState} from 'react';
import {Send,History,Camera,Check,AlertTriangle,Loader2} from 'lucide-react';
import {studioApi} from './studio-api.mjs';
import {AiField} from './AiAssist.jsx';
import {CodeEditor} from './CollectionStudio.jsx';
import {useAutosave,SaveStatus} from './autosave.jsx';
import './code-studio.css';

// Motores de escenas programadas.
const CODE_ENGINES=['hyperframes','remotion','manim','revideo'];
const ENGINE_LABELS={hyperframes:'HyperFrames',remotion:'Remotion',manim:'Manim',revideo:'Revideo'};
// Textos en pantalla: corregirlos no necesita al agente; se cambian en el código y quedan en el historial.
function SceneTexts({project,scene,act,notify,onChange}){
  const [texts,setTexts]=useState(null),[drafts,setDrafts]=useState({}),[all,setAll]=useState({});
  const load=()=>studioApi(`/projects/${project.id}/scenes/${scene.id}/texts`).then(list=>{setTexts(list);setDrafts({});}).catch(()=>setTexts([]));
  useEffect(()=>{load();},[scene.id,project.updatedAt]);
  if(!texts?.length)return null;
  const apply=async item=>{const to=drafts[item.text];if(to==null||to===item.text)return;if(await act(()=>studioApi(`/projects/${project.id}/scenes/${scene.id}/texts`,{method:'PUT',body:{from:item.text,to,all:Boolean(all[item.text])}}))){notify?.('Texto cambiado; continúa la producción para renderizarlo.');load();onChange?.();}};
  return <section className="code-panel"><h4>Textos en pantalla</h4><p className="form-note">Corrige erratas o cambia un texto sin gastar una llamada al agente. Se cambia en el código, se comprueba y queda en el historial.</p>
    <div className="scene-texts">{texts.map(item=><div key={item.text}><input aria-label={`Texto: ${item.text}`} value={drafts[item.text]??item.text} onChange={event=>setDrafts({...drafts,[item.text]:event.target.value})} onBlur={()=>apply(item)} onKeyDown={event=>{if(event.key==='Enter')apply(item);}}/>{item.count>1&&<label className="inline-check"><input type="checkbox" checked={Boolean(all[item.text])} onChange={event=>setAll({...all,[item.text]:event.target.checked})}/>{item.count} veces</label>}</div>)}</div>
  </section>;
}
// Versiones de la escena en otros motores: cambiar de motor no borra la anterior.
function EngineVersions({project,scene,act,notify}){
  const versions=Object.entries(project.engineVersions?.[scene.id]||{});if(!versions.length)return null;
  return <section className="code-panel"><h4>Versiones en otros motores</h4>{versions.map(([engine,item])=><div key={engine} className="engine-version"><span>{ENGINE_LABELS[engine]||engine}{item.output?.critique?.score!=null?` · crítica ${item.output.critique.score}/${item.output.critique.max}`:''} · {new Date(item.at).toLocaleString('es')}</span><button className="button secondary" disabled={active(project)} onClick={async()=>{if(await act(()=>studioApi(`/projects/${project.id}/scenes/${scene.id}/engine-version`,{method:'POST',body:{engine}})))notify?.(`La escena vuelve a su versión en ${ENGINE_LABELS[engine]||engine}.`);}}>Volver a esta versión</button></div>)}</section>;
}
const active=project=>['running','planning','rendering'].includes(project.status);
const file=(project,value)=>`/api/projects/${project.id}/files/${value}`;
const statusLabel={pending:'Pendiente',running:'Programando…',completed:'Programada',failed:'Con errores'};
const RUBRIC=[['hierarchy','Jerarquía'],['readability','Legibilidad'],['motionPurpose','Propósito del movimiento'],['rhythm','Ritmo'],['consistency','Coherencia con la serie'],['originality','Originalidad']];
function Critique({critique}){if(!critique)return null;return <section className="code-panel"><div className="panel-head"><h4>Crítica independiente</h4><span className={`critic-score ${critique.verdict==='accept'?'ok':''}`}>{critique.score}/{critique.max}</span></div>
  <div className="critic-bars">{RUBRIC.map(([key,label])=><div key={key}><span>{label}</span><i><b style={{width:`${(critique.scores?.[key]||0)*20}%`}}/></i><small>{critique.scores?.[key]??'—'}</small></div>)}</div>
  <p className="form-note">{critique.summary}</p>
  <div className="critic-flags"><span className={critique.wouldPost?'ok':'no'}>{critique.wouldPost?'La publicaría tal cual':'Aún no la publicaría'}{critique.wouldPostReason?': '+critique.wouldPostReason:''}</span>{critique.verified===false&&<span className="no">El crítico no demostró haber mirado las imágenes: su opinión no cuenta para aceptar cambios</span>}{critique.poster!=null&&<span>Mejor fotograma para miniatura: segundo {critique.poster}</span>}</div>
  {critique.history?.length>1&&<ol className="critic-rounds">{critique.history.map(item=><li key={item.round}>{item.kind==='rúbrica'?<>Ronda {item.round}: rúbrica, {item.score}/{critique.max}</>:<>Ronda {item.round}: comparación a ciegas con dos críticos ({(item.orders||[]).map(order=>order.preferred).join(' / ')}) → {item.improved?'mejora confirmada':'sin mejora, se conserva la anterior'}</>}</li>)}</ol>}
  {critique.issues?.length>0&&<ul className="critic-issues">{critique.issues.map((issue,index)=><li key={index} className={issue.severity}>{issue.time!=null?`${issue.time.toFixed(1)} s · `:''}{issue.message}</li>)}</ul>}</section>;}
function Variants({project,scene,act,notify}){
  const [count,setCount]=useState(2),[instruction,setInstruction]=useState(''),[engine,setEngine]=useState('');const state=project.sceneVariants?.[scene.id],running=state?.status==='running',file=value=>`/api/projects/${project.id}/files/${value}`;
  const task=project.tasks.find(item=>item.id==='code-'+scene.id);if(!CODE_ENGINES.includes(scene.engine)||task?.status!=='completed')return null;
  return <section className="code-panel"><h4>Variantes</h4><p className="form-note">Genera 2 o 3 alternativas de esta escena en paralelo, compáralas y quédate con la mejor. El render es local: puedes iterar sin pagar por intento (sí consume agentes).</p>
    {!running&&!state?.items?.length&&<><div className="form-row"><label>Cuántas<select value={count} onChange={event=>setCount(Number(event.target.value))}><option value={2}>2 variantes</option><option value={3}>3 variantes</option></select></label><label>Motor<select aria-label="Motor de las variantes" value={engine} onChange={event=>setEngine(event.target.value)}><option value="">El mismo ({ENGINE_LABELS[scene.engine]})</option>{CODE_ENGINES.filter(item=>item!==scene.engine).map(item=><option key={item} value={item}>Probar en {ENGINE_LABELS[item]}</option>)}</select></label></div><AiField label="Qué explorar (opcional)" field="sceneInstruction" target={{videoId:project.id,sceneId:scene.id}} value={instruction} onChange={setInstruction} multiline placeholder="Ej.: una más tipográfica, otra centrada en mi grabación"/><button className="button secondary" disabled={active(project)} onClick={async()=>{if(await act(()=>studioApi(`/projects/${project.id}/scenes/${scene.id}/variants`,{method:'POST',body:{count,instruction,engine:engine||null}})))notify?.('Generando variantes…');}}><Send size={14}/>Probar variantes</button></>}
    {running&&<p className="form-note activity-line"><Loader2 size={13} className="spin"/>Generando {state.items?.length||''} variantes; tardará como programar la escena varias veces.</p>}
    {state?.status==='failed'&&<p className="code-error">{state.error}</p>}
    {state?.items?.length>0&&<><div className="variant-grid">{state.items.map(item=><article key={item.id} className="variant-card">{item.error?<p className="code-error">{item.error}</p>:<><div className="code-snapshots">{item.snapshots.map(shot=><img key={shot} src={file(shot)} alt="Fotograma de la variante"/>)}</div>{item.engine&&item.engine!==scene.engine&&<span className="critic-score">{ENGINE_LABELS[item.engine]}</span>}{item.score!=null&&<span className="critic-score">{item.score}/{item.max}</span>}<p className="form-note">{item.summary}</p><button className="button primary" onClick={async()=>{if(await act(()=>studioApi(`/projects/${project.id}/scenes/${scene.id}/variants/${item.id}/choose`,{method:'POST',body:{}})))notify?.('Variante aplicada; continúa la producción para renderizarla.');}}><Check size={14}/>Usar esta</button></>}</article>)}</div>
      <button className="text-button" onClick={()=>act(()=>studioApi(`/projects/${project.id}/scenes/${scene.id}/variants`,{method:'DELETE'}))}>Descartar variantes</button></>}
  </section>;
}
const transitions=[['cut','Corte'],['fade','Fundido'],['dissolve','Disolución'],['fadeblack','Fundido a negro'],['slideleft','Deslizar'],['wipeleft','Cortinilla'],['circleopen','Círculo'],['zoomin','Zoom']];

// Actividad en directo del agente que programa una escena.
function SceneActivity({project,sceneId,running}){
  const [events,setEvents]=useState([]);
  useEffect(()=>{if(!running)return;const load=()=>studioApi(`/projects/${project.id}/events`).then(list=>setEvents(list.filter(event=>event.type==='agent.activity'&&event.sceneId===sceneId).slice(-6))).catch(()=>{});load();const timer=setInterval(load,2500);return ()=>clearInterval(timer);},[project.id,sceneId,running]);
  if(!running)return null;
  return <ul className="activity-feed">{events.length?events.map(event=><li key={event.seq}><Loader2 size={12} className={event===events.at(-1)?'spin':'hidden'}/>{event.message}</li>):<li><Loader2 size={12} className="spin"/>Preparando la escena…</li>}</ul>;
}

// Boceto de los planos de una escena: dónde va el elemento principal y a qué escala, sobre la retícula 6x6.
const SPAN={xl:4,l:3,m:2,s:1};
export function ShotBoard({scene,width=1280,height=720}){
  const shots=scene.shots||[];if(!shots.length)return null;const ratio=height/width,w=200,h=Math.round(w*ratio);
  return <div className="shot-board">{shots.map((shot,index)=>{const full=shot.anchor==='full',column=full?0:'ABCDEF'.indexOf(shot.anchor[0]),row=full?0:Number(shot.anchor.slice(1))-1,span=full?6:SPAN[shot.scale]||2,cw=w/6,ch=h/6,x=Math.min(column,6-span)*cw,y=Math.min(row,6-Math.max(1,Math.round(span/2)))*ch,bw=span*cw,bh=Math.max(1,Math.round(span/2))*ch;
    return <figure key={index} className="shot-card"><svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label={`Plano ${index+1}: ${shot.job}`}><rect width={w} height={h} rx="6" className="shot-frame"/>{[1,2,3,4,5].map(n=><g key={n}><line x1={n*cw} x2={n*cw} y1="0" y2={h} className="shot-grid"/><line y1={n*ch} y2={n*ch} x1="0" x2={w} className="shot-grid"/></g>)}<rect x={x+2} y={y+2} width={bw-4} height={bh-4} rx="4" className={full?'shot-full':'shot-focal'}/><text x={x+6} y={y+14} className="shot-text">{shot.focal.slice(0,28)}</text>{shot.mediaId&&<text x={w-6} y={h-6} textAnchor="end" className="shot-media">▶ material</text>}</svg>
      <figcaption><strong>{index+1}. {shot.job}</strong><small>{shot.start.toFixed(1)}–{(shot.start+shot.duration).toFixed(1)} s · {shot.anchor} · {shot.scale}{shot.cue?` · «${shot.cue}»`:''}</small></figcaption></figure>;})}</div>;
}
// Aprobación del storyboard antes de programar: aprobar o pedir otro enfoque.
// Componente del kit sobre el que se construye la escena; si ninguno encaja, uno nuevo que se añadirá al kit.
function KitChoice({kits,draft,setDraft,scene}){
  const ready=Object.values(kits).filter(kit=>kit?.status==='ready');
  const value=draft.component==='__new'?'__new':draft.component?(draft.component.includes('::')?draft.component:`${scene.engine}::${draft.component}`):'';
  if(!ready.length)return <p className="form-note">El proyecto todavía no tiene kit de escenas: el programador compondrá la escena desde cero.</p>;
  return <div className="kit-choice"><label>Componente del kit<select aria-label="Componente del kit" value={value} onChange={event=>setDraft({...draft,component:event.target.value,...(event.target.value.includes('::')?{engine:event.target.value.split('::')[0]}:{})})}><option value="">Que lo elija el programador</option>{ready.flatMap(kit=>(kit.components||[]).map(item=>({...item,engine:kit.engine}))).sort((a,b)=>a.name.localeCompare(b.name,'es')).map(item=><option key={item.engine+item.name} value={`${item.engine}::${item.name}`}>{item.name}</option>)}<option value="__new">Ninguno encaja: crear un componente nuevo…</option></select></label>
    {draft.component==='__new'&&<div className="form-row"><label>Nombre del componente nuevo<input value={draft.newName} maxLength={80} onChange={event=>setDraft({...draft,newName:event.target.value})} placeholder="Ej.: Esquema de red"/></label><label>Qué hace<input value={draft.newDescription} maxLength={1000} onChange={event=>setDraft({...draft,newDescription:event.target.value})} placeholder="Qué muestra y qué parámetros admite"/></label></div>}
    <p className="form-note">{draft.component==='__new'?'Se añadirá al kit antes de programar la escena y quedará disponible para el resto de la serie.':'La escena se construye sobre este componente. Si ninguno encaja, elige crear uno nuevo.'}</p></div>;
}
function StoryboardApproval({project,act,notify}){
  const [instruction,setInstruction]=useState('');
  const pending=project.authoring==='code'&&project.options?.storyboardApproval&&project.storyboard&&!project.storyboardApprovedAt;
  if(!pending)return null;
  const waiting=project.awaiting==='storyboard'||project.status==='needs-approval',busy=active(project);
  return <section className="code-panel approval-panel"><h4>{waiting?'El storyboard espera tu aprobación':'Storyboard pendiente de aprobación'}</h4><p className="form-note">Revisa los planos de cada escena (abajo). Al aprobar, los agentes programan las escenas; puedes seguir editando el texto y la dirección de cualquier escena antes.</p>
    {project.storyboard.contract&&<p className="story-contract">Este vídeo le cuenta a <b>{project.storyboard.contract.audience}</b> que <b>{project.storyboard.contract.claim}</b>.</p>}
    {project.storyboard.concepts?.length>0&&<div className="story-concepts">{project.storyboard.concepts.map((concept,index)=><article key={index} className={index===project.storyboard.chosenConcept?'chosen':''}><strong>{concept.title}{concept.unexpected&&<em> · inesperado</em>}{index===project.storyboard.chosenConcept&&<em> · elegido</em>}</strong><p>{concept.idea}</p><small>Se ve: {concept.sees}</small><small>Gancho: {concept.hook}</small>{index!==project.storyboard.chosenConcept&&<button className="text-button" disabled={busy} onClick={async()=>{if(await act(()=>studioApi(`/projects/${project.id}/storyboard/redo`,{method:'POST',body:{instruction:`Usa el enfoque «${concept.title}»: ${concept.idea} Gancho: ${concept.hook}`}})))notify?.('El storyboard se está rehaciendo con ese enfoque.');}}>Usar este enfoque</button>}</article>)}</div>}
    {project.storyboard.rejectedTypical&&<p className="form-note">Enfoque típico descartado: {project.storyboard.rejectedTypical}</p>}
    {project.storyboard.distinctness?.length>0&&<details className="story-distinct"><summary>Comprobación de personalidad: {project.storyboard.distinctness.filter(item=>item.answer).length}/{project.storyboard.distinctness.length} sí</summary><ul>{project.storyboard.distinctness.map((item,index)=><li key={index} className={item.answer?'ok':'no'}>{item.answer?'Sí':'No'} · {item.question}</li>)}</ul></details>}
    {project.factCheck&&<div className={`fact-check ${project.factCheck.claims.some(claim=>claim.status==='wrong')?'bad':project.factCheck.claims.some(claim=>claim.status==='unverified')||project.factCheck.licenses.some(item=>item.status!=='ok')?'warn':'ok'}`}><strong>Verificación de datos</strong><p>{project.factCheck.summary}</p>
      {project.factCheck.claims.filter(claim=>claim.status!=='verified').map((claim,index)=><p key={index}><b>{claim.status==='wrong'?'Incorrecto':'Sin comprobar'}</b>: «{claim.claim}»{claim.fix?` → ${claim.fix}`:''}{claim.evidence?<small> {claim.evidence}</small>:null}</p>)}
      {project.factCheck.licenses.filter(item=>item.status!=='ok').map((item,index)=><p key={'l'+index}><b>Licencia {item.status==='problem'?'con problemas':'sin aclarar'}</b>: {item.name}. <small>{item.note}</small></p>)}
      <small>{project.factCheck.claims.filter(claim=>claim.status==='verified').length} de {project.factCheck.claims.length} datos comprobados con su fuente.</small></div>}
    {project.lookCheck?.warnings?.length>0&&<div className="look-repeat"><strong>Se parece a vídeos anteriores</strong>{project.lookCheck.warnings.map((warning,index)=><p key={index}>{warning.message}{warning.alternatives?.length?<small> Alternativas: {warning.alternatives.join(' · ')}.</small>:null}</p>)}</div>}
    {project.storyboardChecks?.dependencies?.length>0&&<div className="look-repeat"><strong>Conceptos usados antes de explicarse</strong>{project.storyboardChecks.dependencies.map((item,index)=><p key={index}>«{item.title}» da por sabido «{item.concept}», que se explica después, en «{item.introducedIn}».</p>)}</div>}
    {project.storyboardChecks?.prior?.length>0&&<p className="form-note">Se da por sabido: {project.storyboardChecks.prior.join(', ')}. Si tu audiencia no lo conoce, pide que una escena lo explique.</p>}
    <ul className="kit-plan">{project.storyboard.scenes.filter(scene=>CODE_ENGINES.includes(scene.engine)).map(scene=><li key={scene.id}><strong>{scene.title}{scene.data?<small> · datos: {scene.data.title} ({scene.data.items.length})</small>:null}</strong>{scene.component?<em>{scene.component}</em>:scene.newComponent?<em className="new">Nuevo: {scene.newComponent.name}</em>:<em className="none">sin componente</em>}</li>)}</ul>
    <div className="component-actions"><button className="button primary" disabled={busy} onClick={async()=>{if(await act(()=>studioApi(`/projects/${project.id}/storyboard/approve`,{method:'POST',body:{}})))notify?.('Storyboard aprobado: empieza la programación.');}}><Check size={14}/>Aprobar y programar las escenas</button></div>
    <AiField label="O pide otro enfoque" field="videoBrief" target={{videoId:project.id}} value={instruction} onChange={setInstruction} multiline placeholder="Ej.: más ritmo y menos texto, abre con el problema real y usa mis grabaciones desde el principio"/>
    <button className="button secondary" disabled={busy||instruction.trim().length<3} onClick={async()=>{if(await act(()=>studioApi(`/projects/${project.id}/storyboard/redo`,{method:'POST',body:{instruction}}))){setInstruction('');notify?.('El storyboard se está rehaciendo.');}}}><Send size={14}/>Pedir otro enfoque</button>
  </section>;
}

// Escenas del vídeo: texto, dirección, motor, código, verificación y cambios, en un solo sitio.
export function CodeScenes({project,act,notify}){
  const scenes=project.storyboard?.scenes||[],[sceneId,setSceneId]=useState(scenes[0]?.id||''),[data,setData]=useState(null),[openFile,setOpenFile]=useState(''),[busy,setBusy]=useState(false);
  const scene=scenes.find(item=>item.id===sceneId)||scenes[0],base=`/projects/${project.id}/scenes/${scene?.id}`,target={videoId:project.id,sceneId:scene?.id};
  const [draft,setDraft]=useState(null),[instruction,setInstruction]=useState(''),[remember,setRemember]=useState(false);
  const fromScene=item=>item&&{title:item.title,narration:item.narration,direction:item.direction||'',engine:item.engine||'json',duration:item.duration,transition:item.transition||'fade',component:item.component||(item.newComponent?'__new':''),newName:item.newComponent?.name||'',newDescription:item.newComponent?.description||''};
  const [kits,setKits]=useState({});useEffect(()=>{if(project.collectionId)studioApi(`/collections/${project.collectionId}`).then(value=>setKits({...value.kits,...(value.kit?.engine&&!value.kits?.[value.kit.engine]?{[value.kit.engine]:value.kit}:{})})).catch(()=>{});},[project.collectionId,project.updatedAt]);
  const blockedNow=active(project)||project.example;
  // Autoguardado de la escena: solo envía los campos cambiados; la voz y el código se rehacen al continuar.
  const {status,reset}=useAutosave(draft&&{sceneId:scene?.id,...draft},async value=>{const current=scenes.find(item=>item.id===value.sceneId);if(!current)return;const before=fromScene(current),changes=Object.fromEntries(Object.keys(before).filter(key=>String(value[key]??'')!==String(before[key]??'')).map(key=>[key,value[key]]));if(!Object.keys(changes).length)return;if(!value.title.trim()||!value.narration.trim())throw new Error('El título y la narración no pueden quedar vacíos.');
    // El componente del kit se envía como component/newComponent; elegir uno fija el motor de su kit.
    if(['component','newName','newDescription'].some(key=>key in changes)){delete changes.newName;delete changes.newDescription;if(value.component==='__new'){if(value.newName.trim().length<2){delete changes.component;if(!Object.keys(changes).length)return;}else{changes.component=null;changes.newComponent={name:value.newName.trim(),description:value.newDescription.trim()};}}else{const [engine,name]=value.component?value.component.split('::'):[null,null];changes.component=name||null;changes.newComponent=null;if(engine)changes.engine=engine;}}
    await studioApi(`/projects/${project.id}/scenes/${value.sceneId}`,{method:'PATCH',body:changes});},{delay:1500,enabled:!blockedNow});
  // Solo se sustituye el borrador con lo del servidor si no hay cambios locales pendientes (evita pisar lo que se está escribiendo).
  const previous=React.useRef(null);
  useEffect(()=>{if(!scene)return;const next=fromScene(scene),prior=previous.current;const localEdits=prior&&prior.id===scene.id&&draft&&JSON.stringify(draft)!==JSON.stringify(prior.values);previous.current={id:scene.id,values:next};if(localEdits){reset({sceneId:scene.id,...next});return;}setDraft(next);reset({sceneId:scene.id,...next});},[scene?.id,JSON.stringify(scene)]);
  const refresh=()=>scene&&studioApi(base+'/code').then(value=>{setData(value);setOpenFile(current=>value.files.some(item=>item.path===current)?current:value.files.find(item=>/index\.html|Scene\.tsx/.test(item.path))?.path||value.files[0]?.path||'');}).catch(()=>setData(null));
  useEffect(()=>{refresh();},[scene?.id,project.updatedAt]);
  if(!scenes.length)return <p className="form-note">Genera el storyboard para editar sus escenas.</p>;
  const run=async fn=>{setBusy(true);try{await fn();await refresh();}catch(error){notify?.(error.message,true);}finally{setBusy(false);}};
  const task=project.tasks.find(item=>item.id==='code-'+scene.id),coded=CODE_ENGINES.includes(scene.engine),blocked=busy||active(project)||project.example;
  return <div className="code-studio">
    <div className="section-heading"><div><h3>Escenas</h3><p className="form-note">Edita el texto y la dirección de cada escena (con ✨ si quieres ayuda), pide cambios al programador con tus palabras o toca el código a mano. Todo queda en el historial.</p></div></div>
    <StoryboardApproval project={project} act={act} notify={notify}/>
    <div className="code-scene-list">{scenes.map((item,index)=>{const itemTask=project.tasks.find(entry=>entry.id==='code-'+item.id);return <button key={item.id} className={item.id===scene.id?'selected':''} onClick={()=>setSceneId(item.id)}><span>{String(index+1).padStart(2,'0')} · {item.title}</span><small>{CODE_ENGINES.includes(item.engine)?item.engine:'plantilla'} · {itemTask?statusLabel[itemTask.status]||itemTask.status:'sin código'}</small></button>;})}</div>
    {draft&&<section className="code-panel">
      <div className="panel-head"><h4>La escena</h4><SaveStatus status={status} idle={blockedNow?'En producción: los cambios se podrán guardar al terminar':'Se guarda automáticamente'}/></div>
      <div className="form-row"><label>Título<input aria-label="Título de la escena" value={draft.title} onChange={event=>setDraft({...draft,title:event.target.value})}/></label><label>Segundos<input aria-label="Duración de la escena" type="number" min="2" max="120" step="0.5" value={draft.duration} onChange={event=>setDraft({...draft,duration:Number(event.target.value)})}/></label><label>Motor<select aria-label="Motor de la escena" value={draft.engine} onChange={event=>setDraft({...draft,engine:event.target.value})}><option value="hyperframes">HyperFrames · HTML y GSAP</option><option value="remotion">Remotion · React</option><option value="manim">Manim · matemáticas (Python)</option><option value="revideo">Revideo · código y fórmulas</option><option value="json">Plantilla de capas</option></select></label><label>Entrada<select aria-label="Transición de entrada" value={draft.transition} onChange={event=>setDraft({...draft,transition:event.target.value})}>{transitions.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
      {CODE_ENGINES.includes(draft.engine)&&project.collectionId&&<KitChoice kits={kits} draft={draft} setDraft={setDraft} scene={scene}/>}
      {scene.shots?.length>0&&<><h4>Planos</h4><ShotBoard scene={scene} width={project.output?.format==='portrait'?720:1280} height={project.output?.format==='portrait'?1280:project.output?.format==='square'?960:720}/></>}
      <AiField label="Narración" field="narration" target={target} value={draft.narration} onChange={value=>setDraft({...draft,narration:value})} multiline rows={4}/>
      <AiField label="Dirección artística" field="direction" target={target} value={draft.direction} onChange={value=>setDraft({...draft,direction:value})} multiline rows={4} placeholder="Qué se ve, en qué orden, qué material se usa y cómo se mueve"/>
      <p className="form-note">Al cambiar la narración se rehacen la voz y la programación de la escena cuando continúes la producción.</p>
    </section>}
    <SceneActivity project={project} sceneId={scene.id} running={task?.status==='running'}/>
    <div className="code-grid">
      <section className="code-panel">
        <h4>{coded?`Código · ${scene.engine}`:'Escena con plantilla'}</h4>
        {data?.task?.error&&<p className="code-error"><AlertTriangle size={14}/>{data.task.error}</p>}
        {data?.task?.output?.summary&&<p className="form-note">{data.task.output.summary}</p>}
        {data?.files?.length?<CodeEditor files={data.files} openFile={openFile} setOpenFile={setOpenFile} disabled={blocked} onSave={async(path,content)=>{const result=await act(()=>studioApi(base+'/code/file',{method:'PUT',body:{path,content}}));await refresh();return result;}}/>:<p className="form-note">{coded?'Todavía no hay código: continúa la producción para que el agente lo escriba.':'Cambia el motor a HyperFrames o Remotion y guarda, o pide abajo lo que quieres, para que un agente programe esta escena.'}</p>}
      </section>
      <section className="code-panel">
        <h4>Verificación</h4>
        {data?.check?<p className={data.check.ok?'code-ok':'code-error'}>{data.check.ok?<><Check size={14}/>Supera lint y comprobación</>:<><AlertTriangle size={14}/>{data.check.issues?.length||0} problemas</>}</p>:<p className="form-note">Sin comprobar todavía.</p>}
        {data?.check?.issues?.slice(0,6).map((issue,index)=><p className="code-issue" key={index}>{issue.message}</p>)}
        <div className="code-snapshots">{(data?.snapshots||[]).map(item=><a key={item} href={file(project,item)} target="_blank" rel="noreferrer"><img src={file(project,item)} alt="Captura de la escena"/></a>)}</div>
        {coded&&task?.output&&project.collectionId&&<button className="button secondary" disabled={blocked} onClick={()=>run(async()=>{await studioApi(base+'/exemplar',{method:'POST',body:{}});notify?.('Guardada como ejemplo del proyecto: guiará las próximas escenas.');})}><Check size={14}/>Guardar como ejemplo del proyecto</button>}
        {coded&&data?.files?.length>0&&<button className="button secondary" disabled={blocked} onClick={()=>run(async()=>{await studioApi(base+'/code/snapshot',{method:'POST',body:{at:[0.5,(scene.duration||4)/2,Math.max(0.5,(scene.duration||4)-0.6)]}});notify?.('Capturas actualizadas.');})}><Camera size={14}/>Capturar fotogramas</button>}
      </section>
    </div>
    <Critique critique={task?.output?.critique}/>
    <Variants project={project} scene={scene} act={act} notify={notify}/>
    <SceneTexts project={project} scene={scene} act={act} notify={notify}/>
    <EngineVersions project={project} scene={scene} act={act} notify={notify}/>
    <section className="code-panel">
      <AiField label="Pide un cambio al programador" field="sceneInstruction" target={target} value={instruction} onChange={setInstruction} multiline placeholder="Ej.: usa el minuto 1:20 de mi grabación con zoom al botón, sube el ritmo y añade un whoosh en cada corte"/>
      {project.collectionId&&<label className="inline-check"><input type="checkbox" checked={remember} onChange={event=>setRemember(event.target.checked)}/>Recordarlo para los próximos vídeos del proyecto</label>}
      <button className="button primary" disabled={blocked||instruction.trim().length<3} onClick={()=>run(async()=>{await act(()=>studioApi(base+'/instruct',{method:'POST',body:{instruction,remember,...(coded?{}:{engine:draft?.engine==='remotion'?'remotion':'hyperframes'})}}));setInstruction('');setRemember(false);notify?.('El agente está aplicando el cambio.');})}><Send size={14}/>Enviar al programador</button>
    </section>
    {data?.history?.length>0&&<section className="code-panel"><h4><History size={15}/>Historial del código</h4><div className="code-history">{data.history.map(item=><div key={item.id}><span>{item.label}</span><small>{new Date(item.at).toLocaleString('es')}</small><button className="text-button" disabled={blocked} onClick={()=>run(async()=>{await act(()=>studioApi(base+'/code/restore',{method:'POST',body:{historyId:item.id}}));notify?.('Versión restaurada. Continúa la producción para renderizarla.');})}>Restaurar</button></div>)}</div></section>}
  </div>;
}
