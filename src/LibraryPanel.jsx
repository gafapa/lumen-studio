import React,{useEffect,useState} from 'react';
import {Film,Image,Music,FileText,Table2,Search,Upload,RefreshCw,Scissors,Eraser,Trash2,Send,Check,AlertTriangle,ExternalLink,Globe,Download,Box} from 'lucide-react';
import {studioApi} from './studio-api.mjs';
import {AiField} from './AiAssist.jsx';
import './code-studio.css';

const icons={image:Image,video:Film,music:Music,voice:Music,document:FileText,data:Table2,model:Box};
const filters=[['all','Todo'],['image','Imágenes'],['video','Vídeos'],['audio','Audio'],['document','Documentos'],['data','Datos']];
const kindLabel={image:'imagen',video:'vídeo',music:'música',voice:'locución',document:'documento',data:'datos'};
const seconds=value=>value==null?'—':value>=60?`${Math.floor(value/60)}:${String(Math.round(value%60)).padStart(2,'0')}`:`${value.toFixed(1)} s`;
function summary(item){
  const index=item.index||{};if(index.status==='failed')return 'error al procesar';if(index.status!=='ready')return index.status==='pending'?'sin procesar':'procesando…';
  if(item.kind==='model')return 'Modelo 3D (.glb) para escenas HyperFrames';
  if(item.kind==='document')return `${index.pages?index.pages+' páginas · ':''}${(index.characters||0)<1000?(index.characters||0)+' caracteres':Math.round(index.characters/1000)+' k caracteres'}`;
  if(item.kind==='data')return `${index.rows} filas · ${(index.columns||[]).length} columnas`;
  return `${seconds(index.duration)}${index.shots?` · ${index.shots} planos`:''}${index.transcript?.words?` · ${index.transcript.words} palabras`:''}`;
}

// Biblioteca de un proyecto o de un vídeo. owner = {base, fileUrl, upload, research:{url, run}, note, active}
export function LibraryPanel({owner,act,notify,title='Biblioteca'}){
  const [items,setItems]=useState([]),[filter,setFilter]=useState('all'),[selected,setSelected]=useState(''),[detail,setDetail]=useState(null),[query,setQuery]=useState(''),[hits,setHits]=useState([]),[role,setRole]=useState('music'),[brief,setBrief]=useState(''),[busy,setBusy]=useState(false),[result,setResult]=useState(null);
  const refresh=()=>studioApi(owner.base+'/library').then(setItems).catch(()=>{});
  useEffect(()=>{refresh();const timer=setInterval(refresh,4000);return ()=>clearInterval(timer);},[owner.base]);
  const current=items.find(item=>item.id===selected);
  useEffect(()=>{setResult(null);if(selected)studioApi(`${owner.base}/library/${selected}`).then(setDetail).catch(()=>setDetail(null));else setDetail(null);},[selected,current?.index?.status]);
  const run=async fn=>{setBusy(true);try{await fn();await refresh();}catch(error){notify?.(error.message,true);}finally{setBusy(false);}};
  const blocked=busy||owner.active;
  const visible=items.filter(item=>filter==='all'||(filter==='audio'?['music','voice'].includes(item.kind):item.kind===filter));
  const upload=event=>{const files=[...event.target.files];event.target.value='';run(async()=>{for(const file of files)await act(()=>owner.upload(file,role));notify?.('Recursos añadidos; se están procesando.');});};
  const researching=owner.research?.run?.status==='running';
  return <div className="material-panel">
    <div className="section-heading"><div><h3>{title}</h3><p className="form-note">{owner.note}</p></div>
      <div className="material-upload"><label>El audio es<select value={role} onChange={event=>setRole(event.target.value)}><option value="music">Música</option><option value="voice">Locución</option></select></label><label className="button primary"><Upload size={14}/>Subir recursos<input type="file" multiple hidden accept="image/*,video/*,audio/*,.mov,.mkv,.m4v,.m4a,.flac,.pdf,.txt,.md,.markdown,.html,.htm,.csv,.tsv,.json,.glb" disabled={blocked} onChange={upload}/></label></div></div>
    {owner.research&&<section className="code-panel"><h4><Globe size={15}/>Buscar recursos con un agente</h4><p className="form-note">El investigador busca en la web imágenes, vídeos, documentos y datos útiles y los añade con su procedencia y licencia.</p><AiField label="Qué debe buscar" field="researchBrief" target={owner.target||{}} value={brief} onChange={setBrief} multiline placeholder="Ej.: datos oficiales de usuarios de 2025 en CSV, fotos con licencia libre de la sede y la ficha técnica del producto en PDF"/>
      {owner.research.run&&<p className={owner.research.run.status==='failed'?'code-error':owner.research.run.status==='completed'?'code-ok':'form-note'}>{owner.research.run.status==='running'?'Investigando…':owner.research.run.status==='completed'?<><Check size={14}/>{owner.research.run.summary}</>:owner.research.run.status==='failed'?<><AlertTriangle size={14}/>{owner.research.run.error}</>:'Detenido'}</p>}
      <div className="component-actions"><button className="button primary" disabled={blocked||researching||brief.trim().length<5} onClick={()=>run(async()=>{await act(()=>studioApi(owner.research.url,{method:'POST',body:{brief}}));setBrief('');notify?.('El investigador está buscando recursos.');owner.onResearch?.();})}><Send size={14}/>Buscar</button></div></section>}
    <div className="library-filters">{filters.map(([key,label])=><button key={key} className={filter===key?'selected':''} onClick={()=>setFilter(key)}>{label} <small>{key==='all'?items.length:items.filter(item=>key==='audio'?['music','voice'].includes(item.kind):item.kind===key).length}</small></button>)}</div>
    <div className="material-search"><Search size={15}/><input aria-label="Buscar en la biblioteca" placeholder="Busca lo que se dice, se ve, se lee o qué datos hay" value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')studioApi(`${owner.base}/library-search?q=${encodeURIComponent(query)}`).then(setHits).catch(error=>notify?.(error.message,true));}}/></div>
    {hits.length>0&&<div className="material-hits">{hits.map((hit,index)=><button key={index} onClick={()=>setSelected(hit.mediaId||hit.id)}><strong>{hit.name}</strong><span>{hit.type==='media'?`${seconds(hit.start)}–${seconds(hit.end)}`:hit.type==='document'?'documento':'datos'}</span><small>{hit.text||(hit.columns||[]).join(', ')}</small></button>)}</div>}
    <div className="material-grid">
      <div className="material-list">{visible.length?visible.map(item=>{const Icon=icons[item.kind]||FileText;return <button key={item.id} className={item.id===selected?'selected':''} onClick={()=>setSelected(item.id)}><Icon size={15}/><span><strong>{item.name}</strong><small>{kindLabel[item.kind]||item.kind} · {item.scope==='project'?'del proyecto · ':''}{item.origin==='web'?'web · ':item.origin==='agent'?'agente · ':item.origin==='derived'?'derivado · ':''}{summary(item)}</small></span></button>;}):<p className="form-note">No hay recursos {filter==='all'?'todavía':'de este tipo'}.</p>}</div>
      {detail&&current&&<div className="material-detail">
        <h4>{current.name}</h4>
        {current.sourceUrl&&<p className="form-note"><a href={current.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={12}/> Procedencia</a>{current.author?` · ${current.author}`:''}{current.license?` · ${current.license}`:''}</p>}
        {current.description&&<p className="form-note">{current.description}</p>}
        {current.kind==='document'&&<>{detail.document?.excerpt?<pre className="library-text">{detail.document.excerpt}{detail.document.characters>3000?'\n…':''}</pre>:<p className="form-note">Procesando el documento…</p>}</>}
        {current.kind==='data'&&detail.data&&<><p className="form-note">{detail.data.rows} filas</p><div className="library-table"><table><thead><tr>{detail.data.columns.map(column=><th key={column.name}>{column.name}<small>{column.type}{column.type==='number'?` · ${column.min}–${column.max}`:''}</small></th>)}</tr></thead><tbody>{(detail.data.preview||[]).slice(0,12).map((row,index)=><tr key={index}>{detail.data.columns.map(column=><td key={column.name}>{String(row[column.name]??'')}</td>)}</tr>)}</tbody></table></div></>}
        {['image','video','music','voice'].includes(current.kind)&&<>{detail.indexed?<>
          <p className="form-note">{seconds(detail.duration)} · {detail.width?`${detail.width}x${detail.height}`:'audio'}{detail.hasAudio?' · con sonido':''}{detail.events?` · ${detail.events.clicks.length} clics registrados`:''}</p>
          {detail.contactSheet&&<img className="material-sheet" src={owner.fileUrl(detail.contactSheet)} alt="Hoja de contactos"/>}
          {detail.sentences?.length>0&&<div className="material-transcript">{detail.sentences.slice(0,80).map((sentence,index)=><p key={index}><span>{seconds(sentence.start)}</span>{sentence.text}</p>)}</div>}
          <div className="component-actions">
            {detail.hasAudio&&<button className="button secondary" disabled={blocked} onClick={()=>run(async()=>{const value=await studioApi(`${owner.base}/media/${current.id}/clean-cut`,{method:'POST',body:{}});setResult(`Corte limpio creado: se han quitado ${value.removedSeconds} s de silencios y muletillas.`);})}><Scissors size={14}/>Quitar silencios y muletillas</button>}
            {['image','video'].includes(current.kind)&&<button className="button secondary" disabled={blocked} onClick={()=>run(async()=>{await studioApi(`${owner.base}/media/${current.id}/remove-background`,{method:'POST',body:{}});setResult('Versión sin fondo creada.');})}><Eraser size={14}/>Quitar fondo</button>}
            {detail.hasAudio&&<button className="button secondary" disabled={blocked} onClick={()=>run(async()=>{const value=await studioApi(`${owner.base}/media/${current.id}/beats`,{method:'POST',body:{}});setResult(`${value.bpm||'?'} BPM · ${value.beats.length} pulsos detectados.`);})}><Music size={14}/>Detectar ritmo</button>}
          </div></>:<><p className="form-note">{detail.status==='failed'?'No se pudo indexar.':'Todavía no está indexado.'}</p><button className="button secondary" disabled={blocked} onClick={()=>run(()=>studioApi(`${owner.base}/media/${current.id}/index`,{method:'POST',body:{}}))}><RefreshCw size={14}/>Indexar</button></>}</>}
        {current.index?.status==='failed'&&<p className="code-error"><AlertTriangle size={14}/>{current.index.error}</p>}
        <div className="component-actions"><a className="button secondary" href={owner.fileUrl(current.path)+'?download=1'}><Download size={14}/>Descargar</a>{current.scope!=='project'&&<button className="button secondary" disabled={blocked} onClick={()=>{if(window.confirm(`¿Quitar «${current.name}» de la biblioteca?`))run(async()=>{await studioApi(`${owner.base}/library/${current.id}`,{method:'DELETE'});setSelected('');notify?.('Recurso quitado.');});}}><Trash2 size={14}/>Quitar</button>}</div>
        {result&&<p className="code-ok"><Check size={14}/>{result}</p>}
      </div>}
    </div>
  </div>;
}
