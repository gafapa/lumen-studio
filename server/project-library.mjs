// Biblioteca de recursos (de proyecto o de vídeo): imágenes, vídeo y audio (índice multimedia), documentos
// (texto extraído e indexado para consulta) y datos tabulares (columnas, tipos y vista previa).
// Los elementos viven en `assets` del propietario; el estado de procesado, en `mediaIndex`.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {extractDocument,splitKnowledge,retrieve} from './knowledge.mjs';
import {queueIndex,indexDirectory,searchMedia,mediaInfo,readIndex} from './media-index.mjs';
import {fetchPublic} from './resources.mjs';

export const LIBRARY_KINDS={model:['.glb'],image:['.png','.jpg','.jpeg','.webp','.gif'],video:['.mp4','.webm','.mov','.mkv','.m4v'],audio:['.wav','.mp3','.ogg','.m4a','.aac','.flac'],document:['.pdf','.txt','.md','.markdown','.html','.htm'],data:['.csv','.tsv','.json']};
const MIME_EXTENSIONS={'model/gltf-binary':'.glb','image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif','video/mp4':'.mp4','video/webm':'.webm','audio/mpeg':'.mp3','audio/wav':'.wav','audio/x-wav':'.wav','audio/ogg':'.ogg','application/pdf':'.pdf','text/plain':'.txt','text/markdown':'.md','text/html':'.html','text/csv':'.csv','application/json':'.json'};
export function kindFor(extension,role='music'){const kind=Object.entries(LIBRARY_KINDS).find(([,list])=>list.includes(extension))?.[0];return kind==='audio'?(role==='voice'?'voice':'music'):kind||null;}
export const knowledgeKey=ownerId=>'lib:'+ownerId;
const MEDIA=['image','video','music','voice'];

// ---------- Documentos ----------
function htmlText(html){return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/[ \t]+/g,' ').replace(/\n\s*\n+/g,'\n\n').trim();}
export async function documentText(file,name){
  const extension=path.extname(name).toLowerCase(),buffer=await readFile(file);
  if(extension==='.pdf'){const result=await extractDocument({name:'documento.pdf',base64:buffer.toString('base64')});return {text:result.content,pages:(result.content.match(/\[Página \d+/g)||[]).length||null};}
  const raw=buffer.toString('utf8');return {text:(['.html','.htm'].includes(extension)?htmlText(raw):raw).slice(0,400000),pages:null};
}
// Indexa los fragmentos de un documento bajo la clave de biblioteca del propietario (no se mezcla con las fuentes del vídeo).
export function indexDocument(store,ownerId,asset,text){
  const key=knowledgeKey(ownerId),ids=store.db.prepare('SELECT id FROM knowledge WHERE project_id=? AND source_id=?').all(key,asset.id).map(row=>row.id);
  for(const id of ids){store.db.prepare('DELETE FROM knowledge WHERE id=?').run(id);store.db.prepare('DELETE FROM knowledge_search WHERE id=?').run(id);}
  const add=store.db.prepare('INSERT INTO knowledge(id,project_id,source_id,data) VALUES(?,?,?,?)'),search=store.db.prepare('INSERT INTO knowledge_search(id,project_id,content) VALUES(?,?,?)');
  for(const [part,chunk] of splitKnowledge(text).entries()){const id=`${key}-${asset.id}-${part}`;add.run(id,key,asset.id,JSON.stringify({id,sourceId:asset.id,name:asset.name,...chunk}));search.run(id,key,chunk.text);}
}

// ---------- Datos ----------
function splitLine(line,separator){const cells=[];let current='',quoted=false;for(let i=0;i<line.length;i++){const char=line[i];if(quoted){if(char==='"'&&line[i+1]==='"'){current+='"';i++;}else if(char==='"')quoted=false;else current+=char;}else if(char==='"')quoted=true;else if(char===separator){cells.push(current);current='';}else current+=char;}cells.push(current);return cells.map(cell=>cell.trim());}
export function parseTable(text,extension){
  if(extension==='.json'){const value=JSON.parse(text);const rows=Array.isArray(value)?value:Array.isArray(value?.data)?value.data:Array.isArray(value?.rows)?value.rows:null;if(!rows)return {columns:Object.keys(value||{}).map(name=>({name,type:typeof value[name]})),rows:[],structure:'object'};const objects=rows.filter(row=>row&&typeof row==='object'&&!Array.isArray(row));const names=[...new Set(objects.flatMap(row=>Object.keys(row)))].slice(0,100);return {names,rows:objects.map(row=>names.map(name=>row[name]))};}
  const lines=text.replace(/\r/g,'').split('\n').filter(line=>line.trim());if(!lines.length)return {names:[],rows:[]};
  const separator=extension==='.tsv'?'\t':[',',';','\t'].sort((a,b)=>lines[0].split(b).length-lines[0].split(a).length)[0];
  const names=splitLine(lines[0],separator).map((name,index)=>name||'columna_'+(index+1));return {names,rows:lines.slice(1).map(line=>splitLine(line,separator))};
}
const number=value=>{if(typeof value==='number')return value;if(typeof value!=='string')return NaN;const clean=value.replace(/\s/g,'');if(!/^-?[\d.,]+%?$/.test(clean))return NaN;const normalized=/,\d{1,2}%?$/.test(clean)&&!/\.\d{1,2}%?$/.test(clean)?clean.replace(/\./g,'').replace(',','.'):clean.replace(/,/g,'');return Number(normalized.replace('%',''));};
export function summarizeTable({names=[],rows=[],structure,columns}){
  if(structure==='object')return {rows:0,columns,preview:[],structure};
  const summary=names.map((name,index)=>{const values=rows.map(row=>row[index]).filter(value=>value!==undefined&&value!==null&&value!=='');const numbers=values.map(number).filter(Number.isFinite);const numeric=values.length&&numbers.length/values.length>=0.9;return {name,type:numeric?'number':values.every(value=>!Number.isNaN(Date.parse(value)))&&values.length?'date':'text',filled:values.length,...(numeric?{min:Math.min(...numbers),max:Math.max(...numbers),sum:Math.round(numbers.reduce((a,b)=>a+b,0)*1000)/1000}:{distinct:new Set(values.map(String)).size,examples:[...new Set(values.map(String))].slice(0,5)})};});
  return {rows:rows.length,columns:summary,preview:rows.slice(0,20).map(row=>Object.fromEntries(names.map((name,index)=>[name,row[index]??null])))};
}

// ---------- Procesado ----------
// Procesa un elemento recién añadido según su tipo y guarda el estado en mediaIndex del propietario.
export async function processItem(owner,ownerId,folder,assetId,{db}={}){
  const item=owner.get(ownerId)?.assets?.find(asset=>asset.id===assetId);if(!item)return;
  if(MEDIA.includes(item.kind))return queueIndex(owner,ownerId,folder,assetId);
  const save=value=>{const current=owner.get(ownerId);current.mediaIndex={...current.mediaIndex,[assetId]:{kind:item.kind,name:item.name,...value}};owner.save(current);};
  save({status:'running'});
  try{
    const file=path.join(folder,item.path),directory=indexDirectory(folder,assetId);await mkdir(directory,{recursive:true});
    if(item.kind==='model'){const header=Buffer.alloc(12);const handle=await (await import('node:fs/promises')).open(file,'r');try{await handle.read(header,0,12,0);}finally{await handle.close();}if(header.toString('ascii',0,4)!=='glTF')throw new Error('No es un modelo glTF binario (.glb) válido.');save({status:'ready',error:null,version:header.readUInt32LE(4),bytes:header.readUInt32LE(8)});}
    else if(item.kind==='document'){const {text,pages}=await documentText(file,item.path);if(text.trim().length<20)throw new Error('No se ha podido extraer texto del documento.');await writeFile(path.join(directory,'text.txt'),text);if(db)indexDocument(db,ownerId,item,text);save({status:'ready',error:null,characters:text.length,pages,excerpt:text.slice(0,400),indexedAt:new Date().toISOString()});}
    else if(item.kind==='data'){const table=summarizeTable(parseTable((await readFile(file,'utf8')).slice(0,20*1024*1024),path.extname(item.path).toLowerCase()));await writeFile(path.join(directory,'data.json'),JSON.stringify(table,null,1));save({status:'ready',error:null,rows:table.rows,columns:table.columns.map(column=>column.name).slice(0,40),indexedAt:new Date().toISOString()});}
  }catch(error){save({status:'failed',error:error.message});}
}
export function libraryItems(owner){return (owner?.assets||[]).map(asset=>({...asset,scope:asset.scope||'own',index:owner.mediaIndex?.[asset.id]||{status:'pending'}}));}

export async function libraryItem(owner,folder,itemId){
  const asset=(owner.assets||[]).find(item=>item.id===itemId);if(!asset)throw new Error('Recurso inexistente.');
  const index=owner.mediaIndex?.[itemId]||{status:'pending'},directory=indexDirectory(folder,itemId);
  if(MEDIA.includes(asset.kind)){const info=await mediaInfo(owner,folder,itemId);return {...info,asset,index};}
  if(asset.kind==='document'){let text='';try{text=await readFile(path.join(directory,'text.txt'),'utf8');}catch{}return {...asset,asset,index,document:{characters:text.length,excerpt:text.slice(0,3000)}};}
  let data=null;try{data=JSON.parse(await readFile(path.join(directory,'data.json'),'utf8'));}catch{}return {...asset,asset,index,data};
}
// Lectura para agentes: un tramo de texto o filas de datos.
export async function readItem(owner,folder,itemId,{offset=0,length=6000,limit=200,columns}={}){
  const asset=(owner.assets||[]).find(item=>item.id===itemId);if(!asset)throw new Error('Recurso inexistente: '+itemId);
  const directory=indexDirectory(folder,itemId);
  if(asset.kind==='document'){const text=await readFile(path.join(directory,'text.txt'),'utf8').catch(()=>{throw new Error('El documento todavía no está procesado.');});const start=Math.max(0,Number(offset)||0),size=Math.min(20000,Math.max(500,Number(length)||6000));return {id:itemId,name:asset.name,sourceUrl:asset.sourceUrl||null,characters:text.length,offset:start,text:text.slice(start,start+size),more:start+size<text.length};}
  if(asset.kind==='data'){const summary=JSON.parse(await readFile(path.join(directory,'data.json'),'utf8').catch(()=>{throw new Error('Los datos todavía no están procesados.');}));const table=parseTable(await readFile(path.join(folder,asset.path),'utf8'),path.extname(asset.path).toLowerCase());const selected=Array.isArray(columns)&&columns.length?columns.filter(name=>table.names?.includes(name)):table.names||[];const rows=(table.rows||[]).slice(Number(offset)||0,(Number(offset)||0)+Math.min(1000,Number(limit)||200)).map(row=>Object.fromEntries(selected.map(name=>[name,row[table.names.indexOf(name)]??null])));return {id:itemId,name:asset.name,summary:{rows:summary.rows,columns:summary.columns},rows,file:asset.path};}
  return {id:itemId,name:asset.name,kind:asset.kind,note:'Es un recurso multimedia: usa media_info y media_frames para verlo.'};
}
// Búsqueda conjunta: material (nombre, habla, descripciones), texto de documentos y nombres o columnas de datos.
export async function searchLibrary(store,owner,ownerKeys,folder,query,limit=20){
  const hits=(await searchMedia(owner,folder,query,limit)).map(hit=>({...hit,type:'media'}));
  for(const key of ownerKeys)for(const fragment of retrieve(store,knowledgeKey(key),query,8))hits.push({type:'document',id:fragment.sourceId,name:fragment.name,offset:fragment.start,text:fragment.text.slice(0,400),score:1});
  const terms=String(query).toLocaleLowerCase().split(/\s+/).filter(term=>term.length>2);
  for(const asset of owner.assets||[])if(asset.kind==='data'){const columns=owner.mediaIndex?.[asset.id]?.columns||[];const text=(asset.name+' '+columns.join(' ')+' '+(asset.description||'')).toLocaleLowerCase();if(terms.some(term=>text.includes(term)))hits.push({type:'data',id:asset.id,name:asset.name,columns,score:0.8});}
  return hits.slice(0,limit*2);
}

// ---------- Altas ----------
export function addAsset(owner,ownerId,input){const current=owner.get(ownerId);const asset={id:randomUUID(),createdAt:new Date().toISOString(),origin:'upload',...input};current.assets=[...(current.assets||[]),asset];owner.save(current);return asset;}
// Descarga un recurso público (sin destinos privados) y lo añade con su procedencia.
export async function addFromUrl(owner,ownerId,folder,{url,name,sourceUrl,author,license,licenseUrl,description,expect=null,domains=[]},signal){
  const response=await fetchPublic(url,{domains,signal,limit:150*1024*1024});
  if(response.body.length<16)throw new Error('La descarga llegó vacía (el sitio exige navegador o sesión). Busca otra URL directa, por ejemplo con library_find_media.');
  const fromName=path.extname(new URL(response.url).pathname).toLowerCase(),extension=Object.values(LIBRARY_KINDS).flat().includes(fromName)?fromName:MIME_EXTENSIONS[response.mime];
  const kind=extension&&kindFor(extension);if(!kind)throw new Error('Tipo de recurso no admitido: '+(response.mime||fromName||'desconocido'));
  const family=kind==='voice'||kind==='music'?'audio':kind;
  if(expect&&expect!==family)throw new Error(`Se esperaba ${expect} y la URL devolvió ${response.mime||kind}${family==='document'?' (una página web, no el archivo)':''}. Usa la URL directa del archivo; library_find_media las devuelve.`);
  const file='media/web-'+randomUUID()+extension;await mkdir(path.join(folder,'media'),{recursive:true});await writeFile(path.join(folder,file),response.body);
  return addAsset(owner,ownerId,{name:String(name||path.basename(new URL(response.url).pathname)||'Recurso web').slice(0,200),path:file,kind,size:response.body.length,origin:'web',sourceUrl:sourceUrl||url,downloadUrl:response.url,author:author||null,license:license||null,licenseUrl:licenseUrl||null,description:description||null});
}
export async function addText(owner,ownerId,folder,{name,content,sourceUrl,description}){
  if(typeof content!=='string'||content.trim().length<20)throw new Error('El texto es demasiado corto.');
  const file='media/nota-'+randomUUID()+'.md';await mkdir(path.join(folder,'media'),{recursive:true});await writeFile(path.join(folder,file),content.slice(0,400000));
  return addAsset(owner,ownerId,{name:String(name||'Nota').slice(0,200)+'.md',path:file,kind:'document',size:Buffer.byteLength(content),origin:'agent',sourceUrl:sourceUrl||null,description:description||null});
}
