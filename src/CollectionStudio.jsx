import React,{useEffect,useMemo,useState} from 'react';
import {FolderKanban,Plus,ArrowLeft,Film,Palette,BookText,Bot,RefreshCw,Trash2,Lock,Unlock,X,Play,AlertTriangle,Check,Layers,Boxes,Sparkles,Send,History,Camera,Square,Pencil,Save,Wand2,Loader2} from 'lucide-react';
import {studioApi,uploadCollectionFile} from './studio-api.mjs';
import {LibraryPanel} from './LibraryPanel.jsx';
import {AiButton,AiField,ActivityFeed,CopilotBox} from './AiAssist.jsx';
import './collection-studio.css';
import {useAutosave,SaveStatus} from './autosave.jsx';

const statusLabel={draft:'Borrador',planning:'Planificando',running:'En producción',paused:'En pausa',failed:'Requiere atención',completed:'Listo para revisar',approved:'Aprobado','needs-review':'Revisión pendiente','needs-approval':'Espera aprobación'};
const formats=[['landscape','Horizontal 16:9'],['portrait','Vertical 9:16'],['square','Cuadrado 1:1']];
const tokens=value=>value>=1e6?(value/1e6).toFixed(1)+' M':value>=1e3?Math.round(value/1e3)+' k':String(value||0);

// ---------- Portada: proyectos ----------
export function CollectionsHome({collections,videos=[],onOpen,onOpenVideo,act,notify}){
  const orphans=videos.filter(video=>!video.collectionId);
  const [creating,setCreating]=useState(false),[idea,setIdea]=useState(''),[series,setSeries]=useState(true),[runtime,setRuntime]=useState('claude'),[blank,setBlank]=useState(false),[name,setName]=useState('');
  const createWithAi=async()=>{const created=await act(()=>studioApi('/collections/ai',{method:'POST',body:{idea,runtime,series}}));if(created){setCreating(false);setIdea('');notify('Lumen está preparando tu proyecto.');onOpen(created.id);}};
  const createBlank=async()=>{const created=await act(()=>studioApi('/collections',{method:'POST',body:{name,settings:{runtime}}}));if(created){setCreating(false);setName('');onOpen(created.id);}};
  return <>
    <div className="page-heading"><div><div className="eyebrow">TUS PROYECTOS</div><h1>Proyectos de vídeo</h1><p>Cada proyecto reúne una serie de vídeos con la misma identidad, voz, material y forma de trabajar.</p></div><button className="button primary" onClick={()=>setCreating(true)}><Plus size={16}/>Nuevo proyecto</button></div>
    {creating&&<section className="collection-create">
      {!blank?<>
        <label className="create-idea"><span><Sparkles size={15}/>¿Qué quieres crear?</span><textarea aria-label="Idea del proyecto" value={idea} placeholder="Ej.: una serie de vídeos cortos para explicar los servicios de red a alumnos de 2º de FP, con mis capturas de pantalla y un tono cercano" onChange={event=>setIdea(event.target.value)}/></label>
        <p className="form-note">Lumen propondrá el nombre, el objetivo, la audiencia, la guía de estilo, las reglas, la identidad visual, la voz y los subtítulos. Después podrás cambiarlo todo.</p>
        <div className="form-row"><label>Motor de agentes<select aria-label="Motor de agentes" value={runtime} onChange={event=>setRuntime(event.target.value)}><option value="claude">Claude Code</option><option value="codex">Codex</option><option value="demo">Demo (sin modelo)</option></select></label></div>
        <label className="inline-check"><input type="checkbox" checked={series} onChange={event=>setSeries(event.target.checked)}/>Proponer también una primera serie de vídeos</label>
        <div className="component-actions"><button className="button primary" disabled={idea.trim().length<10} onClick={createWithAi}><Wand2 size={14}/>Crear con IA</button><button className="text-button" onClick={()=>setBlank(true)}>o crear un proyecto vacío</button><button className="button secondary" onClick={()=>setCreating(false)}>Cancelar</button></div>
      </>:<>
        <label>Nombre<input aria-label="Nombre del proyecto" value={name} placeholder="Ej.: Tutoriales de producto" onChange={event=>setName(event.target.value)}/></label>
        <div className="form-row"><label>Motor de agentes<select aria-label="Motor de agentes" value={runtime} onChange={event=>setRuntime(event.target.value)}><option value="claude">Claude Code</option><option value="codex">Codex</option><option value="demo">Demo (sin modelo)</option></select></label></div>
        <div className="component-actions"><button className="button primary" disabled={!name.trim()} onClick={createBlank}>Crear proyecto</button><button className="text-button" onClick={()=>setBlank(false)}>volver a crear con IA</button><button className="button secondary" onClick={()=>setCreating(false)}>Cancelar</button></div>
      </>}
    </section>}
    {collections.length?<div className="collection-grid">{collections.map(collection=>{const palette=collection.settings?.profile?.palette||{};return <button key={collection.id} className="collection-card" data-collection-id={collection.id} onClick={()=>onOpen(collection.id)}><span className="collection-swatch" style={{background:`linear-gradient(135deg,${palette.background||'#eae5ff'},${palette.accent||'#7957df'})`}}><FolderKanban size={22}/></span><strong>{collection.name}</strong><small>{collection.objective||'Sin objetivo definido'}</small><span className="collection-meta">{collection.videoCount} vídeos{collection.running?` · ${collection.running} en producción`:''}{collection.completed?` · ${collection.completed} listos`:''}{collection.agentRuns?.copilot?.status==='running'?' · Lumen está preparándolo…':''}</span></button>;})}</div>
    :!creating&&<div className="empty"><div className="empty-icon"><FolderKanban size={25}/></div><h3>Empieza por un proyecto</h3><p>Describe tu idea y Lumen prepara el proyecto: identidad, voz, guía de estilo y una primera serie de vídeos.</p><button className="button primary" onClick={()=>setCreating(true)}><Plus size={15}/>Nuevo proyecto</button></div>}
    {orphans.length>0&&<><div className="section-heading"><div><h2>Vídeos sin proyecto</h2><p>Creados directamente por la API; no heredan ajustes.</p></div></div><div className="video-grid">{orphans.map(video=><article key={video.id} className="video-card"><button className="video-open" data-project-id={video.id} onClick={()=>onOpenVideo(video.id)}><span className="video-status">{statusLabel[video.status]||video.status}</span><strong>{video.title}</strong><small>{video.prompt}</small></button></article>)}</div></>}
  </>;
}

// ---------- Vista de proyecto ----------
export function CollectionView({collectionId,videos,onBack,onOpenVideo,act,notify,documentSource}){
  const [collection,setCollection]=useState(null),[tab,setTab]=useState('videos'),[modal,setModal]=useState(false);
  const refresh=()=>studioApi('/collections/'+collectionId).then(setCollection).catch(error=>notify(error.message,true));
  useEffect(()=>{refresh();},[collectionId,videos.map(video=>video.updatedAt).join()]);
  const working=Object.values(collection?.agentRuns||{}).some(run=>run?.status==='running');
  useEffect(()=>{if(!working)return;const timer=setInterval(refresh,4000);return ()=>clearInterval(timer);},[working,collectionId]);
  if(!collection)return <div className="loading">Abriendo el proyecto…</div>;
  const persist=async changes=>{const updated=await studioApi('/collections/'+collectionId,{method:'PATCH',body:changes});setCollection(updated);return updated;};
  const externalKey=[collection.copilotProposal?.appliedAt,collection.agentRuns?.['creative-director']?.completedAt,collection.id].join('|');
  const save=async changes=>{const updated=await act(()=>studioApi('/collections/'+collectionId,{method:'PATCH',body:changes}));if(updated){setCollection(updated);notify(updated.stale?.length?`Guardado. ${updated.stale.length} vídeos pueden actualizarse con el cambio.`:'Proyecto guardado.');}};
  const mine=videos.filter(video=>video.collectionId===collectionId),target={collectionId};
  return <div className="collection-view">
    <button className="back-link" onClick={onBack}><ArrowLeft size={15}/>Proyectos</button>
    <div className="page-heading"><div><div className="eyebrow">PROYECTO</div><h1>{collection.name}</h1><p>{collection.objective||'Escribe abajo lo que quieres o define el objetivo en la guía de estilo.'}</p></div><button className="button primary" onClick={()=>setModal(true)}><Plus size={16}/>Nuevo vídeo</button></div>
    <CopilotBox collection={collection} act={act} notify={notify} onChange={refresh}/>
    {collection.stale?.length>0&&<div className="stale-banner"><AlertTriangle size={16}/><span>{collection.stale.length} vídeos usan ajustes anteriores del proyecto ({[...new Set(collection.stale.flatMap(item=>item.changed))].join(', ')}).</span><button className="button secondary" onClick={async()=>{const result=await act(()=>studioApi(`/collections/${collectionId}/apply`,{method:'POST',body:{}}));if(result){notify(`Ajustes aplicados a ${result.results.filter(item=>item.applied).length} vídeos.`);refresh();}}}><RefreshCw size={14}/>Aplicar a todos</button></div>}
    <div className="detail-tabs">{[['videos','Vídeos',Film],['identity','Identidad y salida',Palette],['guide','Guía de estilo',BookText],['kit','Kit de escenas',Boxes],['library','Biblioteca',Film],['agents','Agentes',Bot]].map(([key,label,Icon])=><button key={key} className={tab===key?'selected':''} onClick={()=>setTab(key)}><Icon size={15}/>{label}</button>)}</div>
    {tab==='videos'&&<VideoList videos={mine} stale={collection.stale||[]} onOpen={onOpenVideo} onNew={()=>setModal(true)} act={act} notify={notify}/>}
    {tab==='identity'&&<IdentityPanel key={externalKey} collection={collection} target={target} onSave={persist}/>}
    {tab==='guide'&&<><GuidePanel key={externalKey} collection={collection} target={target} onSave={persist}/><div className="collection-panel"><StyleReference collection={collection} act={act} notify={notify} onChange={refresh}/></div><CreativeBox collection={collection} target={target} act={act} notify={notify} onDone={refresh}/></>}
    {tab==='kit'&&<KitPanel collection={collection} target={target} act={act} notify={notify} onChange={refresh}/>}
    {tab==='agents'&&<AgentsPanel key={externalKey} collection={collection} videos={mine} onSave={persist}/>}
    {tab==='library'&&<LibraryPanel title="Biblioteca del proyecto" act={act} notify={notify} owner={{base:'/collections/'+collectionId,target,fileUrl:value=>`/api/collections/${collectionId}/files/${value}`,upload:(item,role)=>uploadCollectionFile(collectionId,item,role),research:{url:`/collections/${collectionId}/library/research`,run:collection.agentRuns?.['library-researcher'],collectionId},onResearch:refresh,note:'Recursos comunes a todos los vídeos: imágenes, vídeos, audio, documentos y datos. Se procesan una vez y cada vídeo los ve en su biblioteca; los agentes los consultan y citan.'}}/>}
    {tab==='library'&&<AgentRun collection={collection} kind="librarian" label="Documentalista" description="Mira las hojas de contactos del material y describe cada plano para que tú y los agentes podáis buscarlo por lo que se ve." action="Describir material" act={act} notify={notify} onDone={refresh}/>}
    {modal&&<NewVideoModal collection={collection} target={target} onClose={()=>setModal(false)} onCreate={async(body,start)=>{const video=await act(()=>studioApi(`/collections/${collectionId}/videos`,{method:'POST',body}));if(video){setModal(false);if(start)await act(()=>studioApi(`/projects/${video.id}/run`,{method:'POST'}));onOpenVideo(video.id);}}}/>}
    <div className="collection-danger"><button className="text-button" onClick={async()=>{if(!window.confirm(`¿Borrar el proyecto «${collection.name}» y sus ${mine.length} vídeos? No se puede deshacer.`))return;const result=await act(()=>studioApi('/collections/'+collectionId,{method:'DELETE'}));if(result)onBack();}}><Trash2 size={14}/>Borrar proyecto</button></div>
  </div>;
}

function VideoList({videos,stale,onOpen,onNew,act,notify}){
  const staleIds=new Set(stale.map(item=>item.videoId));
  if(!videos.length)return <div className="empty"><div className="empty-icon"><Film size={25}/></div><h3>Todavía no hay vídeos</h3><p>Crea uno, o pídeselo a Lumen arriba: «propón 4 vídeos para empezar».</p><button className="button primary" onClick={onNew}><Plus size={15}/>Nuevo vídeo</button></div>;
  return <div className="video-grid">{videos.map(video=><article key={video.id} className="video-card"><button className="video-open" data-project-id={video.id} onClick={()=>onOpen(video.id)}><span className="video-status">{statusLabel[video.status]||video.status}{staleIds.has(video.id)&&<em> · desactualizado</em>}</span><strong>{video.title}</strong><small>{video.prompt}</small><span className="video-meta">{video.duration} s · {formats.find(([key])=>key===video.output?.format)?.[1]||'Horizontal'}{video.storyboard?` · ${video.storyboard.scenes.length} escenas`:''}</span></button><button className="icon-button" aria-label={`Borrar ${video.title}`} onClick={async()=>{if(!window.confirm(`¿Borrar el vídeo «${video.title}»?`))return;if(await act(()=>studioApi('/projects/'+video.id,{method:'DELETE'})))notify('Vídeo borrado.');}}><Trash2 size={14}/></button></article>)}</div>;
}

function NewVideoModal({collection,target,onClose,onCreate}){
  const [prompt,setPrompt]=useState(''),[duration,setDuration]=useState(60),[format,setFormat]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const submit=async start=>{if(prompt.trim().length<10){setError('Describe el vídeo con al menos 10 caracteres.');return;}setBusy(true);try{await onCreate({prompt,duration,sources:[],overrides:format?{output:{format}}:{}},start);}catch(err){setError(err.message);}finally{setBusy(false);}};
  return <div className="modal-backdrop" onClick={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}><section className="create-modal" role="dialog" aria-modal="true" aria-labelledby="new-video-title"><div className="modal-heading"><h2 id="new-video-title">Nuevo vídeo en «{collection.name}»</h2><button className="icon-button" aria-label="Cerrar" onClick={onClose}><X size={16}/></button></div>
    <AiField label="Encargo del vídeo" field="videoPrompt" target={target} value={prompt} onChange={setPrompt} multiline rows={6} placeholder="Qué cuenta este vídeo, con qué material y para qué. Pulsa ✨ para que Lumen lo proponga con el contexto del proyecto."/>
    <div className="form-row"><label>Duración<select value={duration} onChange={event=>setDuration(Number(event.target.value))}>{[[15,'15 s'],[30,'30 s'],[60,'1 min'],[120,'2 min'],[180,'3 min'],[300,'5 min'],[600,'10 min']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>Formato<select aria-label="Formato del vídeo" value={format} onChange={event=>setFormat(event.target.value)}><option value="">Del proyecto</option>{formats.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
    <p className="form-note">Identidad, voz, subtítulos, motor, agentes y biblioteca se heredan del proyecto. Los recursos propios del vídeo se añaden después en su Biblioteca.</p>
    {error&&<p className="code-error">{error}</p>}
    <div className="component-actions"><button className="button primary" disabled={busy} onClick={()=>submit(true)}><Play size={14}/>Crear y producir</button><button className="button secondary" disabled={busy} onClick={()=>submit(false)}>Crear como borrador</button></div>
  </section></div>;
}

function IdentityPanel({collection,target,onSave}){
  const effective=collection.effective.values,[profile,setProfile]=useState(effective.profile),[output,setOutput]=useState(effective.output),[general,setGeneral]=useState({style:effective.style,authoring:effective.authoring,renderer:effective.renderer});
  const palette={background:'#eae5ff',ink:'#302654',accent:'#7957df',card:'#f8f6ff',...profile.palette};
  const {status}=useAutosave({profile,output,general},value=>onSave({settings:{profile:value.profile,output:value.output,...value.general}}));
  return <section className="collection-panel">
    <div className="panel-head"><span/><SaveStatus status={status}/></div>
    <h3>Identidad <AiButton field="palette" type="palette" label="paleta" target={target} current={profile.palette||''} onPick={colors=>setProfile({...profile,palette:colors})}/></h3>
    <div className="palette-inputs">{[['background','Fondo'],['ink','Texto'],['accent','Acento'],['card','Tarjetas']].map(([key,label])=><label key={key}>{label}<input type="color" value={palette[key]} onChange={event=>setProfile({...profile,palette:{...palette,[key]:event.target.value}})}/></label>)}</div>
    <div className="form-row"><label>Tipografía<select value={profile.font||'Inter'} onChange={event=>setProfile({...profile,font:event.target.value})}>{['Inter','DM Sans','Arial'].map(font=><option key={font}>{font}</option>)}</select></label><label>Intensidad visual<select value={profile.visualIntensity||'cinematic'} onChange={event=>setProfile({...profile,visualIntensity:event.target.value})}><option value="standard">Sobria</option><option value="rich">Rica</option><option value="cinematic">Cinematográfica</option></select></label><label>Estilo base<select value={general.style} onChange={event=>setGeneral({...general,style:event.target.value})}>{['editorial','technology','whiteboard','documentary','short','presentation','infographic','news'].map(style=><option key={style}>{style}</option>)}</select></label></div>
    <h3>Voz y sonido</h3>
    <div className="form-row"><label>Voz<select value={profile.voice?.startsWith('kokoro:')?'kokoro':'windows'} onChange={event=>setProfile({...profile,voice:event.target.value==='kokoro'?'kokoro:ef_dora':''})}><option value="kokoro">Kokoro · neuronal local</option><option value="windows">Windows (SAPI)</option></select></label><label>Sonoridad<select value={profile.loudness??-14} onChange={event=>setProfile({...profile,loudness:Number(event.target.value)})}><option value={-14}>-14 LUFS · redes</option><option value={-16}>-16 LUFS · web</option><option value={-23}>-23 LUFS · emisión</option></select></label><label>Transición por defecto<select value={profile.transition||'fade'} onChange={event=>setProfile({...profile,transition:event.target.value})}>{[['cut','Corte'],['fade','Fundido'],['dissolve','Disolución'],['fadeblack','Fundido a negro'],['slideleft','Deslizar'],['wipeleft','Cortinilla'],['circleopen','Círculo'],['zoomin','Zoom']].map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
    <h3>Subtítulos</h3>
    <label className="inline-check"><input type="checkbox" checked={profile.captions===true} onChange={event=>setProfile({...profile,captions:event.target.checked})}/>Incrustar subtítulos en los vídeos (el SRT se exporta siempre)</label>
    {profile.captions&&<AiField label="Estilo de subtítulos" field="captionStyle" target={target} value={profile.captionStyle||''} onChange={value=>setProfile({...profile,captionStyle:value})} multiline placeholder="Ej.: palabra a palabra, mayúsculas, amarillo sobre caja negra, centrados abajo"/>}
    <h3>Salida y autoría</h3>
    <div className="form-row"><label>Formato<select value={output.format} onChange={event=>setOutput({...output,format:event.target.value})}>{formats.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>Resolución<select value={output.resolution} onChange={event=>setOutput({...output,resolution:event.target.value})}><option>720p</option><option>1080p</option></select></label><label>Fotogramas<select value={output.fps} onChange={event=>setOutput({...output,fps:Number(event.target.value)})}>{[24,30,60].map(fps=><option key={fps} value={fps}>{fps} fps</option>)}</select></label><label>Autoría<select value={general.authoring} onChange={event=>setGeneral({...general,authoring:event.target.value})}><option value="code">Agentes programan cada escena</option><option value="json">Plantilla de capas</option></select></label></div>
  </section>;
}

function GuidePanel({collection,target,onSave}){
  const [bible,setBible]=useState({segments:collection.bible?.segments||[],taste:{motionIntensity:'equilibrado',density:'equilibrada',visualVariance:'coherente',antiPatterns:[],...collection.bible?.taste}});
  const [name,setName]=useState(collection.name||''),[objective,setObjective]=useState(collection.objective||''),[audience,setAudience]=useState(collection.audience||''),[styleGuide,setStyleGuide]=useState(collection.styleGuide||''),[rules,setRules]=useState(collection.rules||[]),[rule,setRule]=useState(''),[notes,setNotes]=useState(collection.notes||[]);
  const {status}=useAutosave({name,objective,audience,styleGuide,rules,notes,bible},value=>onSave({name:value.name.trim()||collection.name,objective:value.objective,audience:value.audience,styleGuide:value.styleGuide,rules:value.rules.filter(item=>item.text.trim()),notes:value.notes.filter(note=>note.text.trim()),bible:{segments:value.bible.segments.filter(item=>item.name.trim()),taste:{...value.bible.taste,antiPatterns:value.bible.taste.antiPatterns.filter(item=>item.trim())}}}));
  const setTaste=(key,value)=>setBible({...bible,taste:{...bible.taste,[key]:value}});
  return <section className="collection-panel">
    <div className="panel-head"><span/><SaveStatus status={status}/></div>
    <AiField label="Nombre" field="name" target={target} value={name} onChange={setName}/>
    <AiField label="Objetivo" field="objective" target={target} value={objective} onChange={setObjective} multiline/>
    <AiField label="Audiencia" field="audience" target={target} value={audience} onChange={setAudience} multiline/>
    <AiField label="Guía de estilo" field="styleGuide" target={target} value={styleGuide} onChange={setStyleGuide} multiline rows={12} className="guide-field" placeholder="Tono, ritmo, cómo se habla, qué se muestra, referencias visuales…"/>
    <h3>Reglas <AiButton field="rules" type="rules" label="reglas" target={target} current={rules.map(item=>item.text).join('\n')} onPick={picked=>setRules([...rules,...picked.filter(item=>!rules.some(existing=>existing.text===item.text))])}/></h3>
    <p className="form-note">Las reglas obligatorias (candado cerrado) prevalecen sobre el encargo de cada vídeo; el resto son preferencias. Puedes editar su texto.</p>
    <div className="rule-list">{rules.map((item,index)=><div key={item.id||index}><button className="icon-button" aria-label={item.locked?'Hacer preferencia':'Hacer obligatoria'} onClick={()=>setRules(rules.map((entry,i)=>i===index?{...entry,locked:!entry.locked}:entry))}>{item.locked?<Lock size={14}/>:<Unlock size={14}/>}</button><input aria-label={`Regla ${index+1}`} value={item.text} onChange={event=>setRules(rules.map((entry,i)=>i===index?{...entry,text:event.target.value}:entry))}/><button className="icon-button" aria-label="Quitar regla" onClick={()=>setRules(rules.filter((_,i)=>i!==index))}><X size={14}/></button></div>)}</div>
    <div className="form-row"><input aria-label="Nueva regla" value={rule} placeholder="Ej.: termina siempre con el logo y la web" onChange={event=>setRule(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&rule.trim()){setRules([...rules,{text:rule.trim(),locked:false}]);setRule('');}}}/><button className="button secondary" disabled={!rule.trim()} onClick={()=>{setRules([...rules,{text:rule.trim(),locked:false}]);setRule('');}}><Plus size={14}/>Añadir</button></div>
    <h3>Biblia de la serie <AiButton field="segments" type="segments" label="secciones recurrentes" target={target} current={bible.segments.map(item=>item.name).join(', ')} onPick={picked=>setBible({...bible,segments:[...bible.segments,...picked]})}/></h3>
    <p className="form-note">Secciones que se repiten en cada vídeo (entradilla, cabecera, sección fija, cierre…). El storyboard las incluye y el kit las programa una vez.</p>
    <div className="rule-list">{bible.segments.map((segment,index)=><div key={index} className="segment-row"><input aria-label={`Sección ${index+1}`} value={segment.name} placeholder="Nombre" onChange={event=>setBible({...bible,segments:bible.segments.map((item,i)=>i===index?{...item,name:event.target.value}:item)})}/><input aria-label={`Propósito de la sección ${index+1}`} value={segment.purpose} placeholder="Para qué sirve" onChange={event=>setBible({...bible,segments:bible.segments.map((item,i)=>i===index?{...item,purpose:event.target.value}:item)})}/><select aria-label={`Posición de la sección ${index+1}`} value={segment.placement} onChange={event=>setBible({...bible,segments:bible.segments.map((item,i)=>i===index?{...item,placement:event.target.value}:item)})}><option value="opening">Al principio</option><option value="closing">Al final</option><option value="any">Donde encaje</option></select><button className="icon-button" aria-label="Quitar sección" onClick={()=>setBible({...bible,segments:bible.segments.filter((_,i)=>i!==index)})}><X size={14}/></button></div>)}</div>
    <button className="button secondary" onClick={()=>setBible({...bible,segments:[...bible.segments,{name:'',purpose:'',placement:'any'}]})}><Plus size={14}/>Añadir sección</button>
    <div className="form-row"><label>Movimiento<select value={bible.taste.motionIntensity} onChange={event=>setTaste('motionIntensity',event.target.value)}><option value="calmado">Calmado</option><option value="equilibrado">Equilibrado</option><option value="enérgico">Enérgico</option></select></label><label>Densidad<select value={bible.taste.density} onChange={event=>setTaste('density',event.target.value)}><option value="aireada">Aireada</option><option value="equilibrada">Equilibrada</option><option value="densa">Densa</option></select></label><label>Variedad visual<select value={bible.taste.visualVariance} onChange={event=>setTaste('visualVariance',event.target.value)}><option value="coherente">Muy coherente</option><option value="variada">Variada</option></select></label></div>
    <h3>Qué evitar <AiButton field="antiPatterns" type="rules" label="qué evitar" target={target} current={bible.taste.antiPatterns.join('\n')} onPick={picked=>setTaste('antiPatterns',[...bible.taste.antiPatterns,...picked.map(item=>item.text)])}/></h3>
    <div className="rule-list">{bible.taste.antiPatterns.map((item,index)=><div key={index}><input aria-label={`Evitar ${index+1}`} value={item} onChange={event=>setTaste('antiPatterns',bible.taste.antiPatterns.map((entry,i)=>i===index?event.target.value:entry))}/><button className="icon-button" aria-label="Quitar" onClick={()=>setTaste('antiPatterns',bible.taste.antiPatterns.filter((_,i)=>i!==index))}><X size={14}/></button></div>)}</div>
    <button className="button secondary" onClick={()=>setTaste('antiPatterns',[...bible.taste.antiPatterns,''])}><Plus size={14}/>Añadir</button>
    {notes.length>0&&<><h3>Decisiones aprendidas</h3><div className="rule-list">{notes.map((note,index)=><div key={note.id||index}><input aria-label={`Decisión ${index+1}`} value={note.text} onChange={event=>setNotes(notes.map((entry,i)=>i===index?{...entry,text:event.target.value}:entry))}/><button className="icon-button" aria-label="Quitar decisión" onClick={()=>setNotes(notes.filter((_,i)=>i!==index))}><X size={14}/></button></div>)}</div></>}
  </section>;
}

function AgentsPanel({collection,videos,onSave}){
  const effective=collection.effective.values,[models,setModels]=useState(null),[runtime,setRuntime]=useState(effective.runtime),[agents,setAgents]=useState(effective.agents),[general,setGeneral]=useState({architecture:effective.architecture,concurrency:effective.concurrency}),[quality,setQuality]=useState({storyboardApproval:effective.options?.storyboardApproval!==false,critic:effective.options?.critic!==false,criticRounds:effective.options?.criticRounds??1,factCheck:effective.options?.factCheck!==false,publish:effective.options?.publish!==false,budgetTokens:effective.options?.budgetTokens??null,budgetCost:effective.options?.budgetCost??null});
  useEffect(()=>{studioApi('/agent-models').then(setModels);},[]);
  const {status}=useAutosave({runtime,agents,general,quality},value=>onSave({settings:{runtime:value.runtime,agents:value.agents,...value.general,options:value.quality}}));
  const usage=useMemo(()=>{const total={};for(const video of videos)for(const [kind,role] of Object.entries(video.metrics?.byRole||{})){const item=total[kind]||={calls:0,inputTokens:0,outputTokens:0};item.calls+=role.calls;item.inputTokens+=role.inputTokens;item.outputTokens+=role.outputTokens;}for(const [kind,role] of Object.entries(collection.metrics||{})){const item=total[kind]||={calls:0,inputTokens:0,outputTokens:0};item.calls+=role.calls;item.inputTokens+=role.inputTokens;item.outputTokens+=role.outputTokens;}return total;},[videos,collection.metrics]);
  if(!models)return <div className="loading">Cargando modelos…</div>;
  const list=runtime==='codex'?models.codex:models.claude,table=agents?.[runtime]||{};
  const preset=async name=>{const values=await studioApi(`/agent-presets/${runtime}/${name}`);setAgents({...agents,[runtime]:values});};
  return <section className="collection-panel">
    <div className="panel-head"><span/><SaveStatus status={status}/></div>
    <div className="form-row"><label>Motor<select value={runtime} onChange={event=>setRuntime(event.target.value)}><option value="claude">Claude Code</option><option value="codex">Codex</option><option value="demo">Demo</option></select></label><label>Arquitectura<select value={general.architecture} onChange={event=>setGeneral({...general,architecture:event.target.value})}><option value="single">Un agente por fase</option><option value="multi">Equipo de agentes</option><option value="tools">Equipo con herramientas MCP</option></select></label><label>Agentes en paralelo<select value={general.concurrency} onChange={event=>setGeneral({...general,concurrency:Number(event.target.value)})}>{[1,2,3,4].map(value=><option key={value}>{value}</option>)}</select></label></div>
    <h3>Calidad</h3>
    <label className="inline-check"><input type="checkbox" checked={quality.storyboardApproval} onChange={event=>setQuality({...quality,storyboardApproval:event.target.checked})}/>Revisar y aprobar el storyboard (planos de cada escena) antes de programar</label>
    <label className="inline-check"><input type="checkbox" checked={quality.critic} onChange={event=>setQuality({...quality,critic:event.target.checked})}/>Crítico independiente: puntúa fotogramas reales de cada escena y pide mejoras</label>
    {quality.critic&&<div className="form-row"><label>Rondas de mejora por escena<select value={quality.criticRounds} onChange={event=>setQuality({...quality,criticRounds:Number(event.target.value)})}><option value={0}>Solo puntuar</option><option value={1}>1 ronda</option><option value={2}>2 rondas</option><option value={3}>3 rondas</option></select></label></div>}
    <p className="form-note">Cada ronda es una llamada más al programador y al crítico: más calidad a cambio de más consumo. Solo se acepta una versión si mejora a la anterior.</p>
    <label className="inline-check"><input type="checkbox" checked={quality.factCheck} onChange={event=>setQuality({...quality,factCheck:event.target.checked})}/>Verificar datos y licencias antes de producir (cifras, comandos, puertos, nombres y material de terceros)</label>
    <label className="inline-check"><input type="checkbox" checked={quality.publish} onChange={event=>setQuality({...quality,publish:event.target.checked})}/>Preparar la publicación al terminar (título, descripción, capítulos, etiquetas y miniatura)</label>
    <div className="form-row"><label>Límite de tokens por vídeo (millones)<input type="number" min="0" step="0.5" value={quality.budgetTokens?quality.budgetTokens/1e6:''} placeholder="Sin límite" onChange={event=>setQuality({...quality,budgetTokens:event.target.value===''?null:Math.round(Number(event.target.value)*1e6)})}/></label><label>Límite de coste por vídeo ($)<input type="number" min="0" step="1" value={quality.budgetCost??''} placeholder="Sin límite" onChange={event=>setQuality({...quality,budgetCost:event.target.value===''?null:Number(event.target.value)})}/></label></div>
    <p className="form-note">Al llegar al límite, los agentes se detienen y Lumen te pregunta si quieres ampliarlo. El coste solo se calcula si configuras los precios de los modelos en los ajustes.</p>
    {runtime!=='demo'&&<><h3>Modelo y esfuerzo por agente</h3><p className="form-note">No todos los agentes necesitan la misma potencia. Criterio del perfil equilibrado: el modelo más capaz para lo que decide el resultado y se llama poco (dirección creativa, storyboard, kit); intermedio con esfuerzo alto para lo que más se repite o donde un error sale caro (programar y criticar escenas, verificar datos, revisión final); el más económico para triaje y tareas mecánicas; e intermedio con esfuerzo bajo para los textos rápidos de la interfaz. «Ahorro» recorta crítica, textos y triaje pero mantiene un buen modelo para programar; «Calidad» sube los roles decisivos sin encarecer los que deben responder rápido. Aplica un perfil y ajusta los roles que quieras; el consumo real de cada rol te ayuda a decidir.</p>
      <div className="component-actions">{Object.entries(models.presets).map(([key,label])=><button key={key} className="button secondary" onClick={()=>preset(key)}>{label}</button>)}</div>
      <table className="agent-table"><thead><tr><th>Agente</th><th>Modelo</th><th>Esfuerzo</th><th>Consumo</th></tr></thead><tbody>{models.roles.map(role=>{const current=table[role.kind]||{},model=list.find(item=>item.slug===current.model),efforts=model?.efforts||models.efforts,used=usage[role.kind];return <tr key={role.kind}><td><strong>{role.label}</strong><small>{role.scope==='project'?'Proyecto · ':''}{role.description}</small></td><td><select aria-label={`Modelo de ${role.label}`} value={current.model||''} onChange={event=>setAgents({...agents,[runtime]:{...table,[role.kind]:{...current,model:event.target.value}}})}>{list.map(item=><option key={item.slug} value={item.slug}>{item.label}</option>)}</select></td><td>{efforts.length?<select aria-label={`Esfuerzo de ${role.label}`} value={current.effort||'medium'} onChange={event=>setAgents({...agents,[runtime]:{...table,[role.kind]:{...current,effort:event.target.value}}})}>{efforts.map(effort=><option key={effort}>{effort}</option>)}</select>:<small>No aplica</small>}</td><td>{used?<small>{used.calls} llamadas · {tokens(used.inputTokens)} entrada · {tokens(used.outputTokens)} salida</small>:<small>—</small>}</td></tr>;})}</tbody></table></>}
  </section>;
}

// ---------- Dentro de un vídeo: lo heredado y lo propio ----------
export function InheritancePanel({project,act,notify}){
  const [data,setData]=useState(null),[format,setFormat]=useState(''),[captions,setCaptions]=useState(''),[runtime,setRuntime]=useState('');
  const {status,reset}=useAutosave({format,captions,runtime},async value=>{await studioApi(`/projects/${project.id}/overrides`,{method:'PUT',body:{overrides:{...(value.format?{output:{format:value.format}}:{}),...(value.captions?{profile:{captions:value.captions==='true'}}:{}),...(value.runtime?{runtime:value.runtime}:{})}}});},{delay:400});
  const refresh=()=>studioApi(`/projects/${project.id}/inheritance`).then(value=>{setData(value);const next={format:value.overrides?.output?.format||'',captions:value.overrides?.profile?.captions==null?'':String(value.overrides.profile.captions),runtime:value.overrides?.runtime||''};setFormat(next.format);setCaptions(next.captions);setRuntime(next.runtime);reset(next);});
  useEffect(()=>{refresh();},[project.id,project.inheritedHash]);
  if(!data)return <div className="loading">Cargando…</div>;
  if(!data.collection)return <p className="form-note">Este vídeo no pertenece a ningún proyecto.</p>;
  const shown=Object.entries(data.origins).filter(([key])=>!key.startsWith('agents'));
  return <section className="collection-panel">
    <h3><Layers size={15}/>Heredado de «{data.collection.name}»</h3>
    {data.stale?.length>0&&<div className="stale-banner"><AlertTriangle size={16}/><span>El proyecto ha cambiado: {data.stale.join(', ')}.</span><button className="button secondary" onClick={async()=>{if(await act(()=>studioApi(`/projects/${project.id}/overrides`,{method:'PUT',body:{overrides:data.overrides}}))){notify('Vídeo actualizado con el proyecto.');refresh();}}}><RefreshCw size={14}/>Actualizar este vídeo</button></div>}
    <div className="panel-head"><h4>Propio de este vídeo</h4><SaveStatus status={status}/></div>
    <div className="form-row"><label>Formato<select value={format} onChange={event=>setFormat(event.target.value)}><option value="">Del proyecto</option>{formats.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>Subtítulos<select value={captions} onChange={event=>setCaptions(event.target.value)}><option value="">Del proyecto</option><option value="true">Incrustados</option><option value="false">Sin subtítulos</option></select></label><label>Motor de agentes<select value={runtime} onChange={event=>setRuntime(event.target.value)}><option value="">Del proyecto</option><option value="claude">Claude Code</option><option value="codex">Codex</option><option value="demo">Demo</option></select></label></div>
    <details className="inherited-list"><summary>Ver todos los valores efectivos</summary><table><tbody>{shown.map(([key,origin])=>{const value=key.split('.').reduce((node,part)=>node?.[part],data.values);return <tr key={key}><td>{key}</td><td>{typeof value==='object'?JSON.stringify(value):String(value)}</td><td><span className={`origin origin-${origin}`}>{origin==='video'?'vídeo':origin==='project'?'proyecto':'app'}</span></td></tr>;})}</tbody></table></details>
  </section>;
}

// ---------- Agentes de proyecto ----------
function useRun(collection,kind,onDone){
  const run=collection.agentRuns?.[kind];
  useEffect(()=>{if(run?.status!=='running')return;const timer=setInterval(onDone,3000);return ()=>clearInterval(timer);},[run?.status]);
  return run;
}
export function RunStatus({run}){if(!run)return null;return <p className={['failed','interrupted'].includes(run.status)?'code-error':run.status==='completed'?'code-ok':'form-note'}>{run.status==='running'?'Trabajando…':run.status==='completed'?<><Check size={14}/>{run.summary||'Terminado'}</>:['failed','interrupted'].includes(run.status)?<><AlertTriangle size={14}/>{run.error}</>:'Detenido'}</p>;}
function AgentRun({collection,kind,label,description,action,body={},act,notify,onDone,children}){
  const run=useRun(collection,kind,onDone),busy=run?.status==='running';
  return <section className="collection-panel agent-run"><h3><Sparkles size={15}/>{label}</h3><p className="form-note">{description}</p>{children}{!busy&&<RunStatus run={run}/>}<ActivityFeed collectionId={collection.id} kind={kind} running={busy}/>
    <div className="component-actions"><button className="button primary" disabled={busy} onClick={async()=>{if(await act(()=>studioApi(`/collections/${collection.id}/agents/${kind}`,{method:'POST',body:typeof body==='function'?body():body}))){notify(label+' trabajando.');onDone();}}}><Send size={14}/>{['interrupted','failed'].includes(run?.status)?'Volver a lanzar':action}</button>{busy&&<button className="button secondary" onClick={()=>act(()=>studioApi(`/collections/${collection.id}/agents/${kind}`,{method:'DELETE'}))}><Square size={14}/>Detener</button>}</div>
  </section>;
}
function CreativeBox({collection,target,act,notify,onDone}){
  const [brief,setBrief]=useState(''),[createVideos,setCreateVideos]=useState(false),[applyIdentity,setApplyIdentity]=useState(false);
  return <AgentRun collection={collection} kind="creative-director" label="Director creativo" description="Una propuesta completa y razonada: guía de estilo, reglas, subtítulos y, si lo pides, la serie de vídeos, a partir del objetivo, la biblioteca y las fuentes. Las reglas obligatorias se conservan." action="Proponer" body={()=>({brief,createVideos,applyIdentity})} act={act} notify={notify} onDone={onDone}>
    <AiField label="Encargo para el director creativo" field="creativeBrief" target={target} value={brief} onChange={setBrief} multiline placeholder="Ej.: una serie de 6 tutoriales cortos en vertical para redes, tono cercano, usando mis grabaciones de pantalla"/>
    <label className="inline-check"><input type="checkbox" checked={createVideos} onChange={event=>setCreateVideos(event.target.checked)}/>Crear los vídeos de la serie como borradores</label>
    <label className="inline-check"><input type="checkbox" checked={applyIdentity} onChange={event=>setApplyIdentity(event.target.checked)}/>Aplicar también la paleta que proponga</label>
    {collection.seriesPlan?.videos?.length>0&&<details><summary>Última serie propuesta ({collection.seriesPlan.videos.length} vídeos)</summary><ol className="note-list">{collection.seriesPlan.videos.map((video,index)=><li key={index}><strong>{video.title}</strong> · {video.duration} s — {video.prompt}</li>)}</ol></details>}
  </AgentRun>;
}
// Editor de archivos de código (kit o escena): ver, editar a mano y guardar con comprobación.
export function CodeEditor({files,openFile,setOpenFile,onSave,disabled}){
  const shown=files.find(item=>item.path===openFile),[editing,setEditing]=useState(false),[draft,setDraft]=useState(''),[report,setReport]=useState(null);
  const {status,reset}=useAutosave({path:openFile,content:draft},async value=>{const result=await onSave(value.path,value.content);if(!result)throw new Error('no se pudo guardar');setReport(result.lint);},{delay:1500,enabled:editing});
  useEffect(()=>{setEditing(false);setReport(null);},[openFile]);
  if(!files.length)return null;
  return <div className="code-editor-box">
    <div className="code-tabs">{files.map(item=><button key={item.path} className={item.path===openFile?'selected':''} onClick={()=>setOpenFile(item.path)}>{item.path}</button>)}</div>
    {editing?<textarea className="code-view code-edit" aria-label={`Editar ${openFile}`} spellCheck={false} value={draft} onChange={event=>setDraft(event.target.value)}/>:<pre className="code-view">{shown?.content??'Archivo demasiado grande para mostrarlo.'}</pre>}
    {report&&<div className={report.ok?'code-ok':'code-error'}>{report.ok?<><Check size={14}/>Guardado y comprobado.</>:<><AlertTriangle size={14}/>Guardado, pero no supera la comprobación: {report.errors.slice(0,3).map(error=>`${error.file}:${error.line} ${error.message}`).join(' · ')}</>}</div>}
    <div className="component-actions">{editing?<><SaveStatus status={status} idle="Se guarda y comprueba mientras escribes"/><button className="button secondary" onClick={()=>setEditing(false)}><Check size={14}/>Listo</button></>:<button className="button secondary" disabled={disabled||shown?.content==null} onClick={()=>{setDraft(shown?.content||'');reset({path:openFile,content:shown?.content||''});setEditing(true);}}><Pencil size={14}/>Editar a mano</button>}</div>
  </div>;
}
// Los resúmenes antiguos del diseñador nombraban el motor; para el usuario solo hay un kit.
const plainKit=text=>String(text||'').replace(/\b(kit|Kit)( de escenas)?\s+(HyperFrames|Remotion)\b/g,'$1$2').replace(/\s*\((HyperFrames|Remotion)\)/g,'');
function KitPanel({collection,target,act,notify,onChange}){
  const [data,setData]=useState(null),[instruction,setInstruction]=useState(''),[openFile,setOpenFile]=useState('');
  const [view,setViewState]=useState(()=>{try{return localStorage.getItem('lumen.kit.view')||'components';}catch{return 'components';}});
  const setView=value=>{setViewState(value);try{localStorage.setItem('lumen.kit.view',value);}catch{}};
  const refresh=()=>studioApi(`/collections/${collection.id}/kit/all`).then(value=>{setData(value);setOpenFile(current=>value.files.some(item=>item.path===current)?current:value.files.find(item=>item.file==='KIT.md')?.path||value.files[0]?.path||'');});
  useEffect(()=>{refresh();},[collection.updatedAt]);
  const busy=Boolean(data?.busy)||Object.entries(collection.agentRuns||{}).some(([key,run])=>key.startsWith('kit-designer')&&run?.status==='running');
  useEffect(()=>{if(!busy)return;const timer=setInterval(()=>{onChange();refresh();},3000);return ()=>clearInterval(timer);},[busy]);
  const file=value=>`/api/collections/${collection.id}/files/${value}`,ready=Boolean(data?.ready);
  const launch=async body=>{if(await act(()=>studioApi(`/collections/${collection.id}/kit/request`,{method:'POST',body}))){if(!body.mode||body.mode==='change')setInstruction('');notify(body.mode==='add'?`El diseñador está añadiendo «${body.component.name}» al kit.`:body.mode==='remove'?`El diseñador está quitando «${body.component.name}».`:'El diseñador del kit está trabajando.');onChange();refresh();return true;}return false;};
  const snapshot=async()=>{for(const engine of data.engines)await act(()=>studioApi(`/collections/${collection.id}/kit/snapshot`,{method:'POST',body:{engine}}));refresh();};
  const lastRun=(data?.runs||[]).filter(run=>run.status!=='running').sort((a,b)=>String(b.completedAt||b.startedAt).localeCompare(String(a.completedAt||a.startedAt)))[0];
  const request=<section className="kit-section">
    <AiField label={ready?'Pide un cambio general al diseñador':'Indicaciones para el kit (opcional)'} field="kitInstruction" target={target} value={instruction} onChange={setInstruction} multiline placeholder={ready?'Ej.: la intro más corta y el rótulo con el logo a la izquierda':'Ej.: estilo técnico y limpio, intro con un terminal que escribe el título'}/>
    <p className="form-note">{ready?'El cambio se aplica a todo el kit. Para cambiar o quitar un componente concreto usa la pestaña Componentes: el diseñador solo tocará ese.':'El diseñador crea el kit con la identidad del proyecto: intro, rótulos, subtítulos, transición de marca y cierre. Después podrás ampliarlo con cualquier componente.'}</p>
    <div className="component-actions"><button className="button primary" disabled={busy||(ready&&instruction.trim().length<3)} onClick={()=>launch({mode:'change',instruction})}><Send size={14}/>{ready?'Pedir cambio':data?.partial?'Volver a crear el kit':'Crear kit'}</button></div>
  </section>;
  const components=data?.components||[],references=(collection.styleFrames?.length||0)+(collection.exemplars?.length||0);
  const views=[['components','Componentes',Boxes,components.length],['preview','Vista previa',Camera,data?.snapshots?.length||0],['request','Pedir cambios',Sparkles,null],['code','Código',Pencil,data?.files?.length||0],['inspiration','Inspiración',Wand2,null],['references','Referencias',Layers,references],['history','Historial',History,data?.history?.length||0]];
  const current=ready?view:'request';
  return <div className="collection-panel kit-panel">
    <div className="kit-head"><h3><Boxes size={15}/>Kit de escenas</h3>{busy&&<button className="button secondary" onClick={()=>act(()=>studioApi(`/collections/${collection.id}/agents/kit-designer`,{method:'DELETE'}))}><Square size={14}/>Detener</button>}</div>
    <p className="form-note">Componentes compartidos que programa un agente con la identidad del proyecto. Cada escena se construye sobre uno de ellos, así que todos los vídeos de la serie comparten las mismas piezas.</p>
    {!data?<p className="form-note"><Loader2 size={13} className="spin"/>Cargando…</p>:ready?<p className="code-ok"><Check size={14}/>Kit · {components.length} componentes{data.updatedAt?' · actualizado '+new Date(data.updatedAt).toLocaleString('es'):''}</p>:!busy&&<p className="form-note">{data.partial?'Hay un kit sin terminar: vuelve a lanzarlo para completarlo.':'Este proyecto todavía no tiene kit.'}</p>}
    {!busy&&lastRun&&<RunStatus run={{...lastRun,summary:plainKit(lastRun.summary),error:plainKit(lastRun.error)}}/>}
    <ActivityFeed collectionId={collection.id} kind="kit-designer*" running={busy}/>
    {data?.stale?.length>0&&<div className="stale-banner"><AlertTriangle size={16}/><span>{data.stale.length} vídeos usan una versión anterior del kit.</span><button className="button secondary" onClick={async()=>{const result=await act(()=>studioApi(`/collections/${collection.id}/kit/apply`,{method:'POST',body:{}}));if(result){notify('Kit aplicado; continúa la producción de esos vídeos para renderizarlos.');refresh();}}}><RefreshCw size={14}/>Aplicar el kit</button></div>}
    {data&&ready&&<div className="studio-tabs kit-views" role="tablist" aria-label="Secciones del kit">{views.map(([key,label,Icon,count])=><button key={key} role="tab" aria-selected={current===key} className={current===key?'selected':''} onClick={()=>setView(key)}><Icon size={14}/>{label}{count?<span className="count-pill">{count}</span>:null}</button>)}</div>}
    {data&&current==='request'&&request}
    {data&&ready&&current==='components'&&<KitComponents components={components} usage={data.usage||{}} target={target} busy={busy} launch={launch}/>}
    {data&&ready&&current==='preview'&&<section className="kit-section"><div className="component-actions"><button className="button secondary" disabled={busy} onClick={snapshot}><Camera size={14}/>Capturar vista previa</button></div>{data.snapshots?.length?<div className="kit-preview">{data.snapshots.map(item=><a key={item} href={file(item)} target="_blank" rel="noreferrer"><img src={file(item)} alt="Vista previa del kit"/></a>)}</div>:<p className="form-note">Todavía no hay capturas de la vista previa.</p>}</section>}
    {data&&ready&&current==='code'&&(data.files?.length>0?<CodeEditor files={data.files} openFile={openFile} setOpenFile={setOpenFile} disabled={busy} onSave={async(path,content)=>{const entry=data.files.find(item=>item.path===path);const result=await act(()=>studioApi(`/collections/${collection.id}/kit/file`,{method:'PUT',body:{path:entry.file,content,engine:entry.engine}}));await refresh();return result;}}/>:<p className="form-note">Sin archivos.</p>)}
    {data&&ready&&current==='inspiration'&&<KitInspiration components={components} busy={busy} launch={launch}/>}
    {data&&ready&&current==='references'&&<section className="kit-section"><StyleReference collection={collection} act={act} notify={notify} onChange={onChange}/><StyleFrames collection={collection} act={act} onChange={onChange}/><Exemplars collection={collection} act={act} notify={notify} onChange={onChange} busy={busy}/></section>}
    {data&&ready&&current==='history'&&(data.history?.length?<div className="code-history">{data.history.map(item=><div key={item.engine+item.id}><span>{plainKit(item.label)}</span><small>{new Date(item.at).toLocaleString('es')}</small><button className="text-button" disabled={busy} onClick={async()=>{if(await act(()=>studioApi(`/collections/${collection.id}/kit/restore`,{method:'POST',body:{historyId:item.id,engine:item.engine}}))){notify('Kit restaurado.');onChange();refresh();}}}>Restaurar</button></div>)}</div>:<p className="form-note">Sin versiones guardadas.</p>)}
  </div>;
}
// Un componente del kit: cambiarlo o quitarlo sin tocar el resto.
// Inspiración: el catálogo oficial de HyperFrames por papel; cualquier pieza se puede pedir como componente del kit.
function KitInspiration({components,busy,launch}){
  const [catalog,setCatalog]=useState(null),[error,setError]=useState(''),[role,setRole]=useState('all'),[query,setQuery]=useState(''),[limit,setLimit]=useState(30);
  useEffect(()=>{studioApi('/hyperframes/catalog').then(setCatalog).catch(err=>setError(err.message));},[]);
  if(error)return <p className="code-error">{error}</p>;
  if(!catalog)return <p className="form-note"><Loader2 size={13} className="spin"/>Cargando el catálogo…</p>;
  const normalize=value=>String(value||'').toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const owned=new Set(components.map(item=>normalize(item.name)));
  const pool=[...catalog.recipes.map(item=>({...item,type:'recipe',tags:[],labels:[],duration:null})),...catalog.items];
  const shown=pool.filter(item=>(role==='all'||item.roles.includes(role))&&(!query.trim()||normalize(item.name+' '+item.title+' '+item.description+' '+item.tags.join(' ')+' '+(item.labels||[]).join(' ')).includes(normalize(query.trim()))));
  return <section className="kit-section">
    <p className="form-note">{pool.length} piezas e ideas para el kit: el catálogo oficial y un recetario de componentes probados para series. Pide cualquiera: el diseñador la programa con la identidad del proyecto y la deja lista para las escenas.</p>
    <div className="kit-toolbar"><input aria-label="Buscar en el catálogo" value={query} onChange={event=>{setQuery(event.target.value);setLimit(30);}} placeholder="Buscar: rótulo, mapa, 3D, código, logo…"/></div>
    <div className="kit-roles">{[{id:'all',label:'Todo'},...catalog.roles].map(item=>{const count=item.id==='all'?pool.length:pool.filter(entry=>entry.roles.includes(item.id)).length;return count?<button key={item.id} className={role===item.id?'selected':''} onClick={()=>{setRole(item.id);setLimit(30);}}>{item.label}<small>{count}</small></button>:null;})}</div>
    <div className="kit-catalog">{shown.slice(0,limit).map(item=>{const added=owned.has(normalize(item.title))||owned.has(normalize(item.name));return <article key={item.name}><div><strong>{item.title}</strong><small>{item.type==='recipe'?'receta':item.type==='block'?'bloque':'componente'}{item.duration?` · ${item.duration} s`:''}</small></div><p>{item.description}</p><div className="kit-tags">{(item.labels||item.tags).slice(0,5).map(tag=><span key={tag}>{tag}</span>)}</div>
      <button className="button secondary" disabled={busy||added||components.filter(entry=>entry.engine===(item.type==='recipe'?'remotion':'hyperframes')).length>=30} onClick={()=>launch({mode:'add',engine:item.type==='recipe'?'remotion':'hyperframes',component:{origin:item.type==='recipe'?{kind:'recipe',ref:item.name,license:null,url:null}:{kind:'catalog',ref:item.name,license:'Apache-2.0',url:'https://github.com/heygen-com/hyperframes'},name:item.title.slice(0,80),description:item.type==='recipe'?`Receta «${item.name}» (${item.packages.join(', ')}): ${item.description}`:`Basado en la pieza «${item.name}» del catálogo oficial de HyperFrames (instálala con hyperframes_add, estúdiala y adáptala a la identidad del proyecto; parametriza textos, colores y tiempos): ${item.description}`}})}>{added?<><Check size={14}/>En el kit</>:<><Plus size={14}/>Añadir al kit</>}</button></article>;})}</div>
    {shown.length>limit&&<button className="button secondary" onClick={()=>setLimit(limit+30)}>Ver más ({shown.length-limit})</button>}
    {!shown.length&&<p className="form-note">Nada coincide con la búsqueda.</p>}
  </section>;
}
// Lista de componentes: compacta, con buscador y ficha desplegable para cambiar o quitar cada uno.
function KitComponents({components,usage,target,busy,launch}){
  const [query,setQuery]=useState(''),[adding,setAdding]=useState(false),[open,setOpen]=useState(null);
  const normalize=value=>String(value||'').toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const shown=components.filter(item=>!query.trim()||normalize(item.name+' '+item.description+' '+item.file).includes(normalize(query.trim())));
  return <section className="kit-section">
    <div className="kit-toolbar">{components.length>5&&<input aria-label="Buscar componente" value={query} onChange={event=>setQuery(event.target.value)} placeholder={`Buscar entre ${components.length} componentes…`}/>}<button className="button secondary" disabled={components.length>=30} onClick={()=>setAdding(!adding)}>{adding?<X size={14}/>:<Plus size={14}/>}{adding?'Cerrar':'Añadir componente'}</button></div>
    {adding&&<AddComponent target={target} busy={busy} launch={launch} count={components.length} onDone={()=>setAdding(false)}/>}
    <div className="kit-list">{shown.map(item=><KitComponent key={item.engine+item.name} item={item} uses={usage[item.engine+'::'+item.name]||0} open={open===item.name} onToggle={()=>setOpen(open===item.name?null:item.name)} target={target} busy={busy} launch={launch}/>)}</div>
    {!shown.length&&<p className="form-note">{query?'Ningún componente coincide con la búsqueda.':'El kit no tiene componentes.'}</p>}
  </section>;
}
function KitComponent({item,uses,open,onToggle,target,busy,launch}){
  const [editing,setEditing]=useState(false),[instruction,setInstruction]=useState('');
  return <article className={open?'open':''}>
    <button className="kit-row" aria-expanded={open} onClick={onToggle}><strong>{item.name}</strong><span>{item.description}</span><small>{uses?`${uses} escena${uses===1?'':'s'}`:'sin usar'}</small></button>
    {open&&<div className="kit-detail"><small className="form-note">{item.file} · {item.origin?.kind==='catalog'?`basado en «${item.origin.ref}» del catálogo de HyperFrames${item.origin.license?' ('+item.origin.license+')':''}`:item.origin?.kind==='recipe'?`receta «${item.origin.ref}» de Lumen`:item.origin?.kind==='exemplar'?'a partir de una escena aprobada del proyecto':'diseño propio del proyecto'}</small><code>{item.usage}</code>
      {editing?<><AiField label={`Qué cambiar en «${item.name}»`} field="kitInstruction" target={target} value={instruction} onChange={setInstruction} multiline placeholder="Ej.: que entre desde la izquierda y admita un subtítulo"/><div className="component-actions"><button className="button primary" disabled={busy||instruction.trim().length<3} onClick={async()=>{if(await launch({mode:'improve',engine:item.engine,component:{name:item.name},instruction})){setEditing(false);setInstruction('');}}}><Send size={14}/>Cambiar componente</button><button className="text-button" onClick={()=>setEditing(false)}>Cancelar</button></div></>
      :<div className="component-actions"><button className="text-button" disabled={busy} onClick={()=>setEditing(true)}><Pencil size={13}/>Cambiar</button><button className="text-button" disabled={busy} onClick={()=>{if(window.confirm(`¿Quitar «${item.name}» del kit? Las escenas que ya lo usan conservan su versión hasta que apliques el kit.`))launch({mode:'remove',engine:item.engine,component:{name:item.name}});}}><Trash2 size={13}/>Quitar</button></div>}
    </div>}
  </article>;
}// Ampliar el kit: un componente nuevo a la vez, con propuestas de la IA según lo que ya existe.
function AddComponent({target,busy,launch,count,onDone}){
  const [name,setName]=useState(''),[description,setDescription]=useState('');
  return <section className="kit-add"><h4>Ampliar el kit <AiButton field="kitComponent" label="componente nuevo" target={target} current={name?name+': '+description:''} onPick={value=>{const text=String(value),index=text.indexOf(':');if(index>0&&index<60){setName(text.slice(0,index).replace(/[«»"*]/g,'').trim());setDescription(text.slice(index+1).trim());}else setDescription(text);}}/></h4>
    <p className="form-note">Añade componentes cuando la serie los necesite (comparativas, cifras destacadas, pasos numerados, citas…). El diseñador crea solo el nuevo y conserva los demás. Las escenas lo usarán al aplicar el kit. {count}/30 componentes.</p>
    <div className="form-row"><label>Nombre<input value={name} maxLength={80} onChange={event=>setName(event.target.value)} placeholder="Ej.: Cifra destacada"/></label></div>
    <label>Qué hace<textarea rows={3} value={description} onChange={event=>setDescription(event.target.value)} placeholder="Qué muestra, qué parámetros admite y cuándo se usa"/></label>
    <div className="component-actions"><button className="button secondary" disabled={busy||name.trim().length<2||count>=30} onClick={async()=>{if(await launch({mode:'add',component:{name:name.trim(),description:description.trim()}})){setName('');setDescription('');onDone?.();}}}><Plus size={14}/>Añadir al kit</button></div>
  </section>;
}

// Referencia de estilo medida desde un vídeo de la biblioteca: su gramática (ritmo, planos, movimiento, paleta, tipografía, sonido).
function StyleReference({collection,act,notify,onChange}){
  const [assetId,setAssetId]=useState(''),videos=(collection.assets||[]).filter(asset=>asset.kind==='video'),reference=collection.styleReference,run=collection.agentRuns?.['style-reference'],busy=run?.status==='running';
  useEffect(()=>{if(!busy)return;const timer=setInterval(onChange,3000);return ()=>clearInterval(timer);},[busy]);
  const file=name=>`/api/collections/${collection.id}/files/reference/${name}`,spec=reference?.spec;
  return <section className="style-frames"><h4>Referencia de estilo</h4><p className="form-note">Elige un vídeo de la biblioteca cuyo estilo quieras para la serie. Lumen mide su ritmo, planos, movimiento, paleta, tamaños de letra y sonido. Los agentes toman su gramática, nunca su contenido, y la revisión final avisa si un vídeo se parece demasiado.</p>
    {busy&&<p className="form-note activity-line"><Loader2 size={13} className="spin"/>Analizando el vídeo…</p>}
    {!busy&&run?.status==='failed'&&<p className="code-error">{run.error}</p>}
    {spec&&!busy&&<div className="reference-card"><strong>{reference.name}</strong>
      <div className="reference-stats"><span><b>{spec.pace}</b> cambios cada 10 s</span><span>planos de <b>{spec.shots.p25}–{spec.shots.p75} s</b></span><span>{Object.entries(spec.energy.cameras).map(([verb,count])=>`${count} ${verb}`).join(' · ')}</span>{spec.type&&<span>letra de {spec.type.sizes.map(size=>Math.round(size*1000)/10+' %').join(', ')} · margen {Math.round((spec.type.margin||0)*1000)/10} %</span>}{spec.audio?.tempo&&<span>~{spec.audio.tempo.bpm} ppm</span>}</div>
      {spec.palette&&<div className="reference-palette">{[['Fondo',spec.palette.ground],['Tinta',spec.palette.ink],['Acento',spec.palette.accent]].map(([label,color])=><span key={label}><i style={{background:color}}/>{label} {color}</span>)}</div>}
      <img src={file(reference.files.shots)} alt="Un fotograma por plano de la referencia"/>
      <div className="component-actions">{spec.palette&&<button className="button secondary" onClick={async()=>{if(await act(()=>studioApi(`/collections/${collection.id}`,{method:'PATCH',body:{settings:{profile:{palette:{background:spec.palette.ground,ink:spec.palette.ink,accent:spec.palette.accent}}}}}))){notify('Paleta de la referencia aplicada a la identidad.');onChange();}}}><Palette size={14}/>Usar su paleta</button>}<button className="text-button" onClick={async()=>{if(await act(()=>studioApi(`/collections/${collection.id}/style-reference`,{method:'DELETE'})))onChange();}}><Trash2 size={13}/>Quitar referencia</button></div></div>}
    {!busy&&(videos.length?<div className="form-row"><select aria-label="Vídeo de referencia" value={assetId} onChange={event=>setAssetId(event.target.value)}><option value="">{spec?'Cambiar por otro vídeo…':'Elige un vídeo de la biblioteca…'}</option>{videos.map(video=><option key={video.id} value={video.id}>{video.name}</option>)}</select><button className="button secondary" disabled={!assetId} onClick={async()=>{if(await act(()=>studioApi(`/collections/${collection.id}/style-reference`,{method:'POST',body:{assetId}}))){setAssetId('');notify('Analizando la referencia de estilo.');onChange();}}}><Wand2 size={14}/>Analizar</button></div>:<p className="form-note">Sube a la biblioteca del proyecto un vídeo de referencia para usarlo.</p>)}
  </section>;
}
// Fotogramas de estilo: referencias visuales aprobadas con las que el crítico compara cada escena.
function StyleFrames({collection,act,onChange}){
  const [assetId,setAssetId]=useState(''),images=(collection.assets||[]).filter(asset=>asset.kind==='image'),file=value=>`/api/collections/${collection.id}/files/style-frames/${value}`;
  return <section className="style-frames"><h4>Fotogramas de estilo</h4><p className="form-note">Referencias visuales de la serie. Se toman de la vista previa del kit y puedes añadir imágenes de la biblioteca. El crítico compara cada escena con ellas.</p>
    <div className="code-snapshots">{(collection.styleFrames||[]).map(frame=><figure key={frame.id}><img src={file(frame.file)} alt={frame.note}/><figcaption>{frame.source==='kit'?'Kit':frame.note}<button className="icon-button" aria-label="Quitar fotograma" onClick={async()=>{if(await act(()=>studioApi(`/collections/${collection.id}/style-frames/${frame.id}`,{method:'DELETE'})))onChange();}}><X size={12}/></button></figcaption></figure>)}</div>
    {images.length>0&&<div className="form-row"><select aria-label="Imagen de referencia" value={assetId} onChange={event=>setAssetId(event.target.value)}><option value="">Añadir una imagen de la biblioteca…</option>{images.map(image=><option key={image.id} value={image.id}>{image.name}</option>)}</select><button className="button secondary" disabled={!assetId} onClick={async()=>{if(await act(()=>studioApi(`/collections/${collection.id}/style-frames`,{method:'POST',body:{assetId}}))){setAssetId('');onChange();}}}><Plus size={14}/>Añadir</button></div>}
  </section>;
}
// Ejemplos aprobados: escenas que guían a las siguientes y pueden convertirse en componentes del kit.
function Exemplars({collection,act,notify,onChange,busy}){
  const list=collection.exemplars||[];if(!list.length)return <section className="style-frames"><h4>Ejemplos aprobados</h4><p className="form-note">Cuando una escena te encante, pulsa «Guardar como ejemplo del proyecto» en su vídeo: las próximas escenas la tomarán como referencia y podrás convertirla en un componente del kit.</p></section>;
  const file=(item,name)=>`/api/collections/${collection.id}/files/exemplars/${item.id}/${name}`;
  return <section className="style-frames"><h4>Ejemplos aprobados ({list.length})</h4><div className="variant-grid">{list.slice().reverse().map(item=><article key={item.id} className="variant-card">{item.frames[0]&&<img src={file(item,item.frames[0])} alt={item.title}/>}<strong>{item.title}</strong><small>{item.videoTitle} · {item.engine}{item.score!=null?` · crítica ${item.score}/30`:''}</small><div className="component-actions"><button className="button secondary" disabled={busy} onClick={async()=>{if(await act(()=>studioApi(`/collections/${collection.id}/exemplars/${item.id}/to-kit`,{method:'POST',body:{}}))){notify('El diseñador está convirtiendo el ejemplo en componente del kit.');onChange();}}}><Boxes size={14}/>Convertir en componente</button><button className="icon-button" aria-label="Quitar ejemplo" onClick={async()=>{if(await act(()=>studioApi(`/collections/${collection.id}/exemplars/${item.id}`,{method:'DELETE'})))onChange();}}><Trash2 size={14}/></button></div></article>)}</div></section>;
}
