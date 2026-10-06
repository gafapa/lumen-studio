import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';

// Coloca el panel dentro de la ventana: bajo el botón si cabe, si no encima, y siempre sin salirse por los lados.
function usePopoverPosition(anchor,open,deps){
  const [style,setStyle]=useState(null);
  useLayoutEffect(()=>{
    if(!open||!anchor.current)return;
    const place=()=>{const rect=anchor.current.getBoundingClientRect(),margin=12,width=Math.min(560,window.innerWidth-margin*2),preferred=rect.left+width<=window.innerWidth-margin?rect.left:rect.right-width,left=Math.min(Math.max(margin,preferred),window.innerWidth-width-margin);
      const below=window.innerHeight-rect.bottom-margin,above=rect.top-margin,downward=below>=320||below>=above;
      setStyle({position:'fixed',left,width,...(downward?{top:rect.bottom+6,maxHeight:Math.max(180,below-6)}:{bottom:window.innerHeight-rect.top+6,maxHeight:Math.max(180,above-6)})});};
    place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    return ()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[open,...deps]);
  return style;
}
import {Sparkles,Loader2,Check,Plus,X,Send,Wand2} from 'lucide-react';
import {studioApi} from './studio-api.mjs';
import './ai-assist.css';

// Botón ✨ con propuestas de la IA para un campo. target = {collectionId, videoId, sceneId}.
export function AiButton({field,target,current,onPick,type='text',label}){
  const [open,setOpen]=useState(false),[instruction,setInstruction]=useState(''),[busy,setBusy]=useState(false),[result,setResult]=useState(null),[error,setError]=useState('');
  const run=async()=>{setBusy(true);setError('');try{setResult(await studioApi('/assist',{method:'POST',body:{field,...target,current:typeof current==='string'?current:JSON.stringify(current||''),instruction}}));}catch(err){setError(err.message);}finally{setBusy(false);}};
  const filled=Array.isArray(current)?current.length>0:Boolean(String(current||'').trim());
  const anchor=useRef(null),style=usePopoverPosition(anchor,open,[busy,result]);
  useEffect(()=>{if(!open)return;const close=event=>{if(event.key==='Escape')setOpen(false);};document.addEventListener('keydown',close);return ()=>document.removeEventListener('keydown',close);},[open]);
  return <span className="ai-wrap" ref={anchor}>
    <button type="button" className="ai-button" aria-label={`${filled?'Mejorar':'Sugerir'} ${label||field} con IA`} onClick={()=>{setOpen(!open);if(!open&&!result)run();}}><Sparkles size={13}/>{filled?'Mejorar':'Sugerir'}</button>
    {open&&createPortal(<div className="ai-pop" role="dialog" aria-label="Propuestas de la IA" style={style||{visibility:'hidden'}}>
      <div className="ai-pop-head"><strong><Wand2 size={14}/>{filled?'Mejorar':'Proponer'} {label||''}</strong><button type="button" className="icon-button" aria-label="Cerrar" onClick={()=>setOpen(false)}><X size={14}/></button></div>
      <div className="ai-instruction"><input aria-label="Indicación para la IA" value={instruction} placeholder="Opcional: más corto, más técnico, en tono divertido…" onChange={event=>setInstruction(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();run();}}}/><button type="button" className="button secondary" disabled={busy} onClick={run}>{busy?<Loader2 size={14} className="spin"/>:<Send size={14}/>}</button></div>
      {busy&&<p className="form-note">Pensando con el contexto del proyecto…</p>}
      {error&&<p className="code-error">{error}</p>}
      {result&&!busy&&<div className="ai-results">
        {type==='text'&&result.suggestions.map((text,index)=><article key={index}><p>{text}</p><div><button type="button" className="button secondary" onClick={()=>{onPick(text);setOpen(false);}}><Check size={13}/>Usar</button>{filled&&<button type="button" className="text-button" onClick={()=>{onPick(String(current)+'\n\n'+text);setOpen(false);}}><Plus size={13}/>Añadir</button>}</div></article>)}
        {type==='rules'&&<RulesPick suggestions={result.suggestions} onPick={rules=>{onPick(rules);setOpen(false);}}/>}
        {type==='segments'&&<RulesPick suggestions={result.suggestions.map(item=>({...item,text:`${item.name}: ${item.purpose}`}))} onPick={items=>{onPick(items.map(({text,...item})=>item));setOpen(false);}}/>}
        {type==='palette'&&result.suggestions.map(palette=><article key={palette.name} className="ai-palette"><span>{['background','card','accent','ink'].map(key=><i key={key} style={{background:palette[key]}}/>)}</span><strong>{palette.name}</strong><button type="button" className="button secondary" onClick={()=>{const {name,...colors}=palette;onPick(colors);setOpen(false);}}><Check size={13}/>Usar</button></article>)}
        {result.note&&<p className="form-note">{result.note}</p>}
      </div>}
    </div>,document.body)}
  </span>;
}
function RulesPick({suggestions,onPick}){
  const [chosen,setChosen]=useState(suggestions.map(()=>true));
  return <>{suggestions.map((rule,index)=><label key={index} className="inline-check"><input type="checkbox" checked={chosen[index]} onChange={event=>setChosen(chosen.map((value,i)=>i===index?event.target.checked:value))}/>{rule.locked?'🔒 ':''}{rule.text}</label>)}<button type="button" className="button secondary" onClick={()=>onPick(suggestions.filter((_,index)=>chosen[index]))}><Plus size={13}/>Añadir seleccionadas</button></>;
}
// Campo de texto con su botón ✨ junto a la etiqueta.
export function AiField({label,field,target,value,onChange,multiline=false,placeholder,className='',rows}){
  const Input=multiline?'textarea':'input';
  return <label className={`ai-field ${className}`}><span className="ai-label">{label}<AiButton field={field} target={target} current={value} label={label.toLowerCase()} onPick={onChange}/></span><Input aria-label={label} value={value||''} placeholder={placeholder} rows={rows} onChange={event=>onChange(event.target.value)}/></label>;
}

// Actividad en directo de un agente de proyecto.
export function ActivityFeed({collectionId,kind,running}){
  const [events,setEvents]=useState([]);
  useEffect(()=>{if(!running)return;const load=()=>studioApi(`/collections/${collectionId}/activity`).then(list=>setEvents(list.filter(event=>!kind||(kind.endsWith('*')?String(event.kind||'').startsWith(kind.slice(0,-1)):event.kind===kind)).slice(-6))).catch(()=>{});load();const timer=setInterval(load,2500);return ()=>clearInterval(timer);},[collectionId,kind,running]);
  if(!running||!events.length)return running?<p className="form-note activity-line"><Loader2 size={13} className="spin"/>Preparando…</p>:null;
  return <ul className="activity-feed">{events.map(event=><li key={event.seq}><Loader2 size={12} className={event===events.at(-1)?'spin':'hidden'}/>{event.message}</li>)}</ul>;
}

// «Pídeselo a Lumen»: una petición en lenguaje natural que se convierte en cambios revisables.
export function CopilotBox({collection,act,notify,onChange}){
  const [request,setRequest]=useState(''),[videos,setVideos]=useState([]);
  const run=collection.agentRuns?.copilot,proposal=collection.copilotProposal,pending=proposal&&!proposal.appliedAt&&!proposal.discardedAt,working=run?.status==='running';
  useEffect(()=>{setVideos((proposal?.videos||[]).map((_,index)=>index));},[proposal?.id]);
  useEffect(()=>{if(!working)return;const timer=setInterval(onChange,3000);return ()=>clearInterval(timer);},[working]);
  return <section className="copilot">
    <div className="copilot-input"><Sparkles size={18}/><input aria-label="Pídeselo a Lumen" value={request} placeholder="Pídeselo a Lumen: «vídeos verticales con subtítulos amarillos», «añade 3 vídeos sobre DNS», «tono más cercano»…" onChange={event=>setRequest(event.target.value)} onKeyDown={async event=>{if(event.key==='Enter'&&request.trim().length>2&&!working){if(await act(()=>studioApi(`/collections/${collection.id}/copilot`,{method:'POST',body:{request}}))){setRequest('');onChange();}}}}/><button className="button primary" disabled={working||request.trim().length<3} onClick={async()=>{if(await act(()=>studioApi(`/collections/${collection.id}/copilot`,{method:'POST',body:{request}}))){setRequest('');onChange();}}}><Send size={14}/></button></div>
    {working&&<ActivityFeed collectionId={collection.id} kind="copilot" running/>}
    {run?.status==='failed'&&<p className="code-error">{run.error}</p>}
    {pending&&!working&&<div className="copilot-proposal">
      <p><strong>{proposal.summary}</strong><br/><small>Petición: «{proposal.request}»</small></p>
      {proposal.diff.length>0&&<ul>{proposal.diff.map((item,index)=><li key={index}><span>{item.label}</span>{item.value.length>220?item.value.slice(0,220)+'…':item.value}</li>)}</ul>}
      {proposal.videos.length>0&&<><h4>Vídeos propuestos</h4>{proposal.videos.map((video,index)=><label key={index} className="inline-check"><input type="checkbox" checked={videos.includes(index)} onChange={event=>setVideos(event.target.checked?[...videos,index]:videos.filter(item=>item!==index))}/><span><strong>{video.title}</strong> · {video.duration} s — {video.prompt.slice(0,160)}</span></label>)}</>}
      {proposal.questions.length>0&&<div className="copilot-questions">{proposal.questions.map((question,index)=><p key={index}>❓ {question}</p>)}</div>}
      <div className="component-actions"><button className="button primary" onClick={async()=>{const result=await act(()=>studioApi(`/collections/${collection.id}/copilot/apply`,{method:'POST',body:{proposalId:proposal.id,videos}}));if(result){notify(result.created.length?`Aplicado y ${result.created.length} vídeos creados.`:'Cambios aplicados.');onChange();}}}><Check size={14}/>Aplicar</button><button className="button secondary" onClick={async()=>{if(await act(()=>studioApi(`/collections/${collection.id}/copilot/discard`,{method:'POST',body:{}})))onChange();}}>Descartar</button></div>
    </div>}
  </section>;
}
