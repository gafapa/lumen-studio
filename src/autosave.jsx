import React,{useEffect,useRef,useState} from 'react';
import {Check,Loader2,AlertTriangle} from 'lucide-react';

// Autoguardado: guarda cuando el valor deja de cambiar durante `delay` ms y al desmontar si queda algo pendiente.
// `save` recibe el valor y debe lanzar si falla. No guarda el valor inicial ni repite un valor ya guardado.
export function useAutosave(value,save,{delay=1200,enabled=true}={}){
  const [status,setStatus]=useState({state:'idle'});
  const serialized=JSON.stringify(value),saved=useRef(serialized),pending=useRef(null),latest=useRef({value,save});
  latest.current={value,save};
  const flush=async()=>{const current=JSON.stringify(latest.current.value);if(current===saved.current)return;pending.current=null;setStatus({state:'saving'});try{await latest.current.save(latest.current.value);saved.current=current;setStatus({state:'saved',at:Date.now()});}catch(error){setStatus({state:'error',message:error.message});}};
  useEffect(()=>{if(!enabled||serialized===saved.current)return;clearTimeout(pending.current);pending.current=setTimeout(flush,delay);return ()=>clearTimeout(pending.current);},[serialized,enabled]);
  useEffect(()=>()=>{if(pending.current){clearTimeout(pending.current);flush();}},[]);
  // Cuando el valor cambia desde fuera (otro agente, IA aplicada), se toma como base guardada.
  const reset=next=>{saved.current=JSON.stringify(next);setStatus({state:'idle'});};
  return {status,flush,reset};
}

export function SaveStatus({status,idle='Se guarda automáticamente'}){
  if(status.state==='saving')return <span className="save-status saving"><Loader2 size={12} className="spin"/>Guardando…</span>;
  if(status.state==='saved')return <span className="save-status saved"><Check size={12}/>Guardado</span>;
  if(status.state==='error')return <span className="save-status error" title={status.message}><AlertTriangle size={12}/>No se pudo guardar: {status.message}</span>;
  return <span className="save-status">{idle}</span>;
}
