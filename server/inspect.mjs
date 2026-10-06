// Inspección temporal de una escena programada (idea de Showtime, scripts/check.mjs): se abre en un navegador,
// se recorre fotograma a fotograma y se mide lo que el lint estático no ve: textos que no dan tiempo a leer,
// entradas simultáneas, etiquetas que se pisan, texto recortado, tamaño legible en un móvil, contraste real
// sobre los píxeles y planos quietos demasiado tiempo. Devuelve avisos con su segundo y recortes de texto.
import http from 'node:http';
import path from 'node:path';
import {readFile,stat,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {textCrops} from './review-pack.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const THRESHOLDS=JSON.parse(await readFile(path.join(root,'server','data','thresholds.json'),'utf8'));
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.mp4':'video/mp4','.webm':'video/webm','.wav':'audio/wav','.mp3':'audio/mpeg','.glb':'model/gltf-binary'};

function serve(dir,{inject='',fallback=null}={}){
  return new Promise(resolve=>{const server=http.createServer(async(req,res)=>{
    try{const url=decodeURIComponent(new URL(req.url,'http://x').pathname),file=path.resolve(dir,'.'+url);
      if(url==='/__hf_runtime.js'){res.writeHead(200,{'content-type':'text/javascript'});return res.end(await readFile(path.join(root,'node_modules','hyperframes','dist','hyperframe.runtime.iife.js')));}
      if(!file.startsWith(path.resolve(dir))){res.writeHead(403);return res.end();}
      if(fallback){try{await stat(file);}catch{const alt=path.resolve(fallback,'.'+url);if(alt.startsWith(path.resolve(fallback))){res.writeHead(200,{'content-type':TYPES[path.extname(alt).toLowerCase()]||'application/octet-stream'});return res.end(await readFile(alt));}}}
      const target=(await stat(file)).isDirectory()?path.join(file,'index.html'):file;let body=await readFile(target);
      if(inject&&target.endsWith('index.html'))body=Buffer.from(body.toString('utf8').replace(/<\/body>/i,inject+'</body>'));
      res.writeHead(200,{'content-type':TYPES[path.extname(target).toLowerCase()]||'application/octet-stream'});res.end(body);
    }catch{res.writeHead(404);res.end();}
  });server.listen(0,'127.0.0.1',()=>resolve(server));});
}

// Recogido en el navegador en cada instante: textos visibles con su caja, tamaño, color y opacidad efectiva.
const COLLECT=()=>{
  const out=[];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_ELEMENT);const seen=new Set();
  const visible=element=>{let opacity=1;for(let node=element;node&&node.nodeType===1;node=node.parentElement){const style=getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden')return 0;opacity*=Number(style.opacity);if(opacity<0.05)return 0;}return opacity;};
  for(let element=walker.currentNode;element;element=walker.nextNode()){
    if(['SCRIPT','STYLE','CANVAS','SVG','svg','NOSCRIPT','TEMPLATE'].includes(element.tagName))continue;
    const own=[...element.childNodes].filter(node=>node.nodeType===3).map(node=>node.textContent).join('').replace(/\s+/g,' ').trim();
    if(own.length<2||seen.has(element))continue;
    const opacity=visible(element);if(!opacity)continue;
    const rect=element.getBoundingClientRect();if(rect.width<2||rect.height<2)continue;
    const style=getComputedStyle(element),text=element.innerText?.replace(/\s+/g,' ').trim()||own;
    const path=[];for(let node=element;node&&node!==document.body;node=node.parentElement){const parent=node.parentElement;path.unshift(node.tagName+(parent?':'+[...parent.children].indexOf(node):''));}
    out.push({key:element.id||path.join('>'),text:text.slice(0,200),x:rect.x,y:rect.y,width:rect.width,height:rect.height,fontSize:parseFloat(style.fontSize)||0,color:style.color,opacity,decor:element.closest('[data-lumen-decor],[data-st-decor]')?true:false});
    seen.add(element);
  }
  return out;
};
const luminance=([r,g,b])=>{const c=[r,g,b].map(v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;});return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];};
const ratio=(a,b)=>{const [x,y]=[luminance(a),luminance(b)].sort((p,q)=>q-p);return (x+0.05)/(y+0.05);};
const parseColor=value=>(String(value).match(/[\d.]+/g)||[0,0,0]).slice(0,3).map(Number);

// Contraste sobre píxeles reales: color del texto contra la mediana de los píxeles del borde de su caja.
async function measureContrast(png,box,color){
  try{const image=sharp(png),meta=await image.metadata(),left=Math.max(0,Math.floor(box.x-4)),top=Math.max(0,Math.floor(box.y-4)),width=Math.min(meta.width-left,Math.ceil(box.width+8)),height=Math.min(meta.height-top,Math.ceil(box.height+8));if(width<4||height<4)return null;
    const {data,info}=await sharp(png).extract({left,top,width,height}).removeAlpha().raw().toBuffer({resolveWithObject:true}),edge=[];
    for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(x<2||y<2||x>=info.width-2||y>=info.height-2){const i=(y*info.width+x)*3;edge.push([data[i],data[i+1],data[i+2]]);}
    const median=[0,1,2].map(channel=>edge.map(pixel=>pixel[channel]).sort((a,b)=>a-b)[Math.floor(edge.length/2)]);
    return Math.round(ratio(parseColor(color),median)*100)/100;}catch{return null;}
}
async function diffLevel(a,b){try{const [x,y]=await Promise.all([a,b].map(buffer=>sharp(buffer).resize(64,36,{fit:'fill'}).greyscale().raw().toBuffer()));let total=0;for(let i=0;i<x.length;i++)total+=Math.abs(x[i]-y[i]);return total/x.length/255;}catch{return 1;}}

// Abre la escena y la recorre. engine: hyperframes (runtime oficial) o remotion (página de inspección propia).
export async function inspectScene(dir,brief,{engine=brief.engine,signal,outDir=path.join(dir,'.lumen','inspect')}={}){
  const T=THRESHOLDS,width=brief.width,height=brief.height,duration=brief.durationSeconds,step=T.sample_step_s;
  let server,pageUrl,seek;
  if(engine==='hyperframes'){server=await serve(dir,{inject:'<script src="/__hf_runtime.js"></script>'});pageUrl=`http://127.0.0.1:${server.address().port}/index.html`;seek=async(page,t)=>page.evaluate(async t=>{const player=window.__player;if(player?.renderSeek){await player.renderSeek(t);if(window.__hfWaitForSeekCompletion)await window.__hfWaitForSeekCompletion();}else{const tl=window.__timelines?.main;tl?.seek?.(t,false);window.__hfThreeTime=t;window.dispatchEvent(new CustomEvent('hf-seek',{detail:{time:t}}));}},t);}
  else{const {buildRemotionInspector}=await import('./inspect-remotion.mjs');const built=await buildRemotionInspector(dir,brief);server=await serve(built.dir,{fallback:built.fallback});pageUrl=`http://127.0.0.1:${server.address().port}/index.html`;seek=async(page,t)=>page.evaluate(async frame=>{await window.__lumenSeek(frame);},Math.round(t*brief.fps));}
  const {chromium}=await import('playwright');const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const warnings=[],samples=[],shots=[];
  try{
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(pageUrl,{waitUntil:'load',timeout:60000});
    await page.waitForFunction(engine==='hyperframes'?'window.__playerReady||window.__timelines?.main':'window.__lumenReady===true',null,{timeout:60000}).catch(()=>{});
    await page.evaluate(()=>document.fonts?.ready);
    let previousShot=null,stillSince=0;
    for(let t=0;t<=duration-0.02;t+=step){
      signal?.throwIfAborted();const time=Math.round(t*100)/100;await seek(page,time);
      const items=await page.evaluate(COLLECT);samples.push({time,items});
      if(Math.round(time*100)%25===0){const png=await page.screenshot({type:'png'});shots.push({time,png});
        if(previousShot){const level=await diffLevel(previousShot,png);if(level>T.still_diff_threshold)stillSince=time;else if(time-stillSince>T.still_hold_s&&!warnings.some(item=>item.rule==='still_hold'&&item.since===stillSince)&&duration-stillSince>T.still_hold_s&&!(duration-time<0.3&&time-stillSince<T.final_hold_max_s))warnings.push({rule:'still_hold',severity:'warning',time:stillSince,since:stillSince,message:`Plano quieto desde el segundo ${stillSince.toFixed(1)} durante más de ${T.still_hold_s} s: añade un empuje de cámara (4–8 %), una respiración del 1–2 % o un cambio.`});}
        previousShot=png;}
    }
    if(errors.length)warnings.push({rule:'runtime_error',severity:'error',time:null,message:'Errores de ejecución durante la inspección: '+errors.slice(0,2).join(' | ')});
    // Cada texto: cuándo aparece, cuándo se asienta (su caja deja de moverse) y cuándo desaparece.
    const tracks=new Map();
    for(const sample of samples)for(const item of sample.items){const track=tracks.get(item.key)||{key:item.key,text:item.text,first:sample.time,last:sample.time,settled:null,prev:null,boxes:[],maxFont:0,decor:item.decor};
      if(track.prev&&Math.abs(track.prev.x-item.x)<=T.settle_px&&Math.abs(track.prev.y-item.y)<=T.settle_px&&Math.abs(track.prev.width-item.width)<=T.settle_px&&item.opacity>0.9){if(track.settled==null)track.settled=sample.time-step;}else if(track.settled!=null&&sample.time-track.last>step*1.5)track.settled=null;
      track.last=sample.time;track.prev=item;track.text=item.text.length>=track.text.length?item.text:track.text;track.boxes.push({...item,time:sample.time});track.maxFont=Math.max(track.maxFont,item.fontSize);tracks.set(item.key,track);}
    const readable=[...tracks.values()].filter(track=>!track.decor);
    for(const track of readable){
      const chars=track.text.length,words=track.text.split(/\s+/).filter(Boolean).length,need=Math.max(T.reading_min_s,T.reading_lead_s+Math.max(chars/T.reading.cps,words/T.reading.wps));
      const held=(track.last+step)-(track.settled??track.first),endsWithScene=track.last>=duration-step*2;
      if(held+0.05<need&&!endsWithScene)warnings.push({rule:'short_text',severity:'warning',time:track.first,message:`«${track.text.slice(0,50)}» se lee ${held.toFixed(1)} s y necesita ${need.toFixed(1)} s (${chars} caracteres): alárgalo o acórtalo.`});
      const box=track.boxes[Math.floor(track.boxes.length/2)],phonePt=track.maxFont*T.phone_width_pt/width,minPt=T.phone_min_pt[brief.format]??T.phone_min_pt.landscape;
      if(track.maxFont&&(phonePt<minPt||track.maxFont<height*T.tiny_text_frac))warnings.push({rule:'tiny_text',severity:'warning',time:box.time,message:`«${track.text.slice(0,40)}» mide ${Math.round(track.maxFont)} px: en un móvil quedaría en ${phonePt.toFixed(1)} pt (mínimo ${minPt}). Súbelo o quítalo.`});
      const cropped=track.boxes.find(item=>item.x<-2||item.y<-2||item.x+item.width>width+2||item.y+item.height>height+2);
      if(cropped&&track.boxes.filter(item=>item.opacity>0.9).some(item=>item.x<-2||item.x+item.width>width+2||item.y<-2||item.y+item.height>height+2))warnings.push({rule:'text_cropped',severity:'warning',time:cropped.time,message:`«${track.text.slice(0,40)}» se sale del lienzo en el segundo ${cropped.time.toFixed(1)}.`});
    }
    // Entradas en el mismo fotograma (sin escalonar) y etiquetas que se pisan.
    const byFirst=new Map();for(const track of readable)byFirst.set(track.first,[...(byFirst.get(track.first)||[]),track]);
    for(const [time,group] of byFirst)if(group.length>=T.same_frame_entrance_min&&time>0)warnings.push({rule:'same_frame_entrance',severity:'note',time,message:`${group.length} textos aparecen a la vez en el segundo ${time.toFixed(1)}: escalónalos (30–60 ms por palabra, 60–100 ms por elemento).`});
    for(const sample of samples.filter((_,index)=>index%3===0)){const items=sample.items.filter(item=>!item.decor&&item.opacity>0.9);
      for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){const a=items[i],b=items[j],ox=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)),oy=Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)),area=ox*oy,small=Math.min(a.width*a.height,b.width*b.height);
        if(small&&area/small>T.label_overlap_frac&&!a.text.includes(b.text)&&!b.text.includes(a.text)&&!warnings.some(item=>item.rule==='labels_crowded'&&Math.abs(item.time-sample.time)<1))warnings.push({rule:'labels_crowded',severity:'warning',time:sample.time,message:`«${a.text.slice(0,25)}» y «${b.text.slice(0,25)}» se pisan en el segundo ${sample.time.toFixed(1)}.`});}}
    if(!samples.slice(0,Math.ceil(T.first_motion_max_s/step)+1).some(sample=>sample.items.length)&&shots.length>2&&(await diffLevel(shots[0].png,shots[2].png))<=T.still_diff_threshold)warnings.push({rule:'slow_start',severity:'note',time:0,message:`No pasa nada en los primeros ${T.first_motion_max_s} s: el primer movimiento debería llegar entre 0,1 y 0,3 s después del corte.`});
    // Contraste y recortes de texto a tamaño real, en el momento central de cada texto asentado.
    await mkdir(outDir,{recursive:true});const crops=[],big=readable.filter(track=>track.settled!=null).sort((a,b)=>b.maxFont-a.maxFont).slice(0,8);
    for(const [index,track] of big.entries()){const mid=track.settled+((track.last-track.settled)/2),box=track.boxes.reduce((best,item)=>Math.abs(item.time-mid)<Math.abs(best.time-mid)?item:best,track.boxes[0]);
      await seek(page,box.time);const png=await page.screenshot({type:'png'}),file=path.join(outDir,`frame-${index}.png`);await writeFile(file,png);
      if(box.height>=height*T.contrast_min_height_frac){const value=await measureContrast(png,box,box.color);if(value!=null&&value<T.min_contrast)warnings.push({rule:'low_contrast',severity:box.fontSize>=height*0.05?'warning':'error',time:box.time,message:`«${track.text.slice(0,40)}» tiene un contraste de ${value}:1 sobre su fondo (mínimo ${T.min_contrast}:1).`});}
      crops.push(...await textCrops(file,[{...box,time:box.time}],outDir,`text-${String(box.time).replace('.','_')}`,1));}
    return {ok:!warnings.some(item=>item.severity==='error'),warnings,crops,texts:readable.length,samples:samples.length};
  }finally{await browser.close().catch(()=>{});server.close();}
}
