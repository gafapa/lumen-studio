import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createOcr,recognizePage} from './ocr.mjs';

export function splitKnowledge(content,size=1200,overlap=160){
  const text=String(content).replace(/\r/g,'').trim(),chunks=[];
  for(let start=0;start<text.length;start+=size-overlap)chunks.push({text:text.slice(start,start+size),start});
  return chunks;
}
export function projectSources(project){return [...(project.sources||[]),...(project.resources||[]).filter(resource=>resource.kind==='page'&&resource.status==='consulted'&&resource.content).map(resource=>({id:resource.id,name:resource.name,content:resource.content}))];}
export function indexSources(store,project){
  store.db.prepare('DELETE FROM knowledge WHERE project_id=?').run(project.id);
  store.db.prepare('DELETE FROM knowledge_search WHERE project_id=?').run(project.id);
  const add=store.db.prepare('INSERT INTO knowledge(id,project_id,source_id,data) VALUES(?,?,?,?)'),search=store.db.prepare('INSERT INTO knowledge_search(id,project_id,content) VALUES(?,?,?)');
  for(const [index,source] of projectSources(project).entries())for(const [part,chunk] of splitKnowledge(source.content).entries()){
    const id=`${project.id}-${index}-${part}`,sourceId=source.id||`source-${index+1}`,data={id,sourceId,name:source.name,...chunk};add.run(id,project.id,sourceId,JSON.stringify(data));search.run(id,project.id,chunk.text);
  }
}
export function retrieve(store,projectId,query,limit=6){
  if(!store.db.prepare('SELECT 1 FROM knowledge WHERE project_id=? LIMIT 1').get(projectId)){const project=store.get(projectId);if(project&&projectSources(project).length)indexSources(store,project);}
  const words=[...new Set((query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[]))].slice(0,30);
  if(!words.length)return [];
  const expression=words.map(word=>`"${word}"`).join(' OR ');
  return store.db.prepare('SELECT k.data, bm25(knowledge_search) AS rank FROM knowledge_search JOIN knowledge k ON k.id=knowledge_search.id WHERE knowledge_search MATCH ? AND knowledge_search.project_id=? ORDER BY rank LIMIT ?').all(expression,projectId,Math.min(20,limit)).map(row=>({...JSON.parse(row.data),score:row.rank}));
}
export async function extractDocument({name,base64,content}){
  if(typeof name!=='string'||name.length>200)throw new Error('Nombre de documento inválido.');
  if(!name.toLowerCase().endsWith('.pdf'))return {name,content:String(content||'').slice(0,100000)};
  const buffer=Buffer.from(base64||'','base64');if(buffer.length>20*1024*1024||buffer.subarray(0,5).toString()!=='%PDF-')throw new Error('PDF inválido o mayor de 20 MB.');
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const pdf=await getDocument({data:new Uint8Array(buffer),useSystemFonts:true,isEvalSupported:false}).promise;
  let ocr=null;try{if(pdf.numPages>500)throw new Error('El PDF supera 500 páginas.');let text='',characters=0,scanned=0;for(let number=1;number<=pdf.numPages;number++){const page=await pdf.getPage(number),data=await page.getTextContent();let pageText=data.items.map(item=>item.str+(item.hasEOL?'\n':' ')).join(''),usedOcr=false;if(pageText.trim().length<20){if(++scanned>50)throw new Error('Divide los PDF escaneados en grupos de hasta 50 páginas.');ocr||=await createOcr();pageText=await recognizePage(page,ocr);usedOcr=true;}characters+=pageText.trim().length;text+=`\n[Página ${number}${usedOcr?' · OCR':''}]\n`+pageText;if(text.length>=100000)break;}if(characters<20)throw new Error('No se reconoce suficiente texto en el documento.');return {name,content:text.slice(0,100000)};}finally{if(ocr)await ocr.close();await pdf.cleanup();}
}
export async function saveKnowledge(store,project,folder){
  indexSources(store,project);await mkdir(path.join(folder,'knowledge'),{recursive:true});
  for(const source of projectSources(project)){const hash=createHash('sha256').update(source.name+source.content).digest('hex').slice(0,16);await writeFile(path.join(folder,'knowledge',`${hash}.json`),JSON.stringify(source,null,2));}
}
export async function importWebSource(url,allowedDomains=[]){
  const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error('URL no admitida.');
  if(allowedDomains.length&&!allowedDomains.some(domain=>parsed.hostname===domain||parsed.hostname.endsWith('.'+domain)))throw new Error('La fuente no pertenece a los dominios permitidos.');
  if(/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[?::1)/.test(parsed.hostname))throw new Error('La investigación web requiere un destino público.');
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error(`La fuente respondió ${response.status}.`);
  const length=Number(response.headers.get('content-length')||0);if(length>2*1024*1024)throw new Error('Fuente web demasiado grande.');const reader=response.body.getReader();let size=0,parts=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();throw new Error('Fuente web demasiado grande.');}parts.push(Buffer.from(value));}
  const html=Buffer.concat(parts).toString('utf8');const title=/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]||parsed.hostname;
  const text=html.replace(/<(script|style|nav|footer)[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
  return {name:title.slice(0,200),content:`URL: ${url}\nRecuperada: ${new Date().toISOString()}\n${text.slice(0,99000)}`};
}
