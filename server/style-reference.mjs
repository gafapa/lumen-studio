// Referencia de estilo medida desde un vídeo (idea de Showtime, references/reference.md): ritmo de cortes,
// duración de planos, energía de movimiento y verbo de cámara por plano, paleta con sus papeles, márgenes y
// tamaños de letra (OCR), sonoridad, silencio y tempo. Se usa su gramática, nunca su contenido; un guardián
// compara después el vídeo propio con la referencia para avisar si se parece demasiado.
import path from 'node:path';
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import ffmpeg from 'ffmpeg-static';
import sharp from 'sharp';
import {execute} from './process.mjs';
import {probeMedia,detectShots,detectSilences} from './media-index.mjs';

const LIMIT_S=180,W=64,H=36;
const quantile=(list,q)=>{if(!list.length)return null;const sorted=[...list].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor(q*(sorted.length-1)))];};
const round=(value,digits=2)=>value==null?null:Math.round(value*10**digits)/10**digits;
const hex=([r,g,b])=>'#'+[r,g,b].map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
const lum=([r,g,b])=>{const c=[r,g,b].map(v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;});return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];};
const contrast=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+0.05)/(y+0.05);};
const saturation=([r,g,b])=>{const max=Math.max(r,g,b),min=Math.min(r,g,b);return max?((max-min)/max):0;};

async function rawFrames(file,{fps,width,height,format='gray',duration,dir,name}){
  const out=path.join(dir,name+'.raw');const result=await execute(ffmpeg,['-y','-v','error','-t',String(Math.min(duration,LIMIT_S)),'-i',file,'-an','-vf',`fps=${fps},scale=${width}:${height}:flags=area`,'-f','rawvideo','-pix_fmt',format,out],{timeout:900000});
  if(result.code!==0)throw new Error('No se pudo leer el vídeo de referencia: '+result.stderr.slice(-300));
  const buffer=await readFile(out),size=width*height*(format==='rgb24'?3:1),frames=[];for(let offset=0;offset+size<=buffer.length;offset+=size)frames.push(buffer.subarray(offset,offset+size));await rm(out,{force:true});return frames;
}
const meanDiff=(a,b)=>{let total=0;for(let i=0;i<a.length;i++)total+=Math.abs(a[i]-b[i]);return total/a.length/255;};
const mean=frame=>{let total=0;for(const value of frame)total+=value;return total/frame.length;};
const std=frame=>{const m=mean(frame);let total=0;for(const value of frame)total+=(value-m)**2;return Math.sqrt(total/frame.length);};

// Paleta: k-medias sobre miniaturas en color; papeles: fondo (lo más extenso), tinta (máximo contraste) y acento (lo más saturado).
function palette(frames){
  const pixels=[];for(const frame of frames)for(let i=0;i<frame.length;i+=3)pixels.push([frame[i],frame[i+1],frame[i+2]]);if(!pixels.length)return null;
  let centers=Array.from({length:6},(_,k)=>pixels[Math.floor((k+0.5)*pixels.length/6)].slice());const assign=new Array(pixels.length).fill(0);
  for(let iteration=0;iteration<10;iteration++){const sums=centers.map(()=>[0,0,0,0]);
    for(let p=0;p<pixels.length;p++){let best=0,distance=Infinity;for(let k=0;k<centers.length;k++){const d=(pixels[p][0]-centers[k][0])**2+(pixels[p][1]-centers[k][1])**2+(pixels[p][2]-centers[k][2])**2;if(d<distance){distance=d;best=k;}}assign[p]=best;sums[best][0]+=pixels[p][0];sums[best][1]+=pixels[p][1];sums[best][2]+=pixels[p][2];sums[best][3]++;}
    centers=centers.map((center,k)=>sums[k][3]?[sums[k][0]/sums[k][3],sums[k][1]/sums[k][3],sums[k][2]/sums[k][3]]:center);}
  const counts=centers.map((_,k)=>assign.filter(value=>value===k).length),colors=centers.map((rgb,k)=>({rgb,share:counts[k]/pixels.length})).filter(item=>item.share>0.01).sort((a,b)=>b.share-a.share);
  const ground=colors[0],ink=colors.slice(1).filter(item=>item.share>=0.02).sort((a,b)=>contrast(b.rgb,ground.rgb)-contrast(a.rgb,ground.rgb))[0]||colors[1]||ground,accent=colors.filter(item=>item!==ground&&item!==ink&&item.share>=0.015).sort((a,b)=>saturation(b.rgb)-saturation(a.rgb))[0]||ink;
  return {ground:hex(ground.rgb),ink:hex(ink.rgb),accent:hex(accent.rgb),flat:colors.length<=3,colors:colors.map(item=>({hex:hex(item.rgb),share:round(item.share,3)}))};
}
// Tempo aproximado: envolvente de energía del audio y autocorrelación entre 70 y 180 pulsaciones por minuto.
async function tempo(file,duration,dir){
  const out=path.join(dir,'audio.raw'),rate=8000;const result=await execute(ffmpeg,['-y','-v','error','-t',String(Math.min(duration,LIMIT_S)),'-i',file,'-vn','-ac','1','-ar',String(rate),'-f','s16le',out],{timeout:600000});if(result.code!==0)return null;
  const buffer=await readFile(out);await rm(out,{force:true});const hop=rate/50,envelope=[];for(let offset=0;offset+hop*2<=buffer.length/2;offset+=hop){let total=0;for(let i=0;i<hop;i++){const sample=buffer.readInt16LE((offset+i)*2)/32768;total+=sample*sample;}envelope.push(Math.sqrt(total/hop));}
  if(envelope.length<200)return null;const onset=envelope.map((value,index)=>Math.max(0,value-(envelope[index-1]??value)));let best=null;
  for(let bpm=70;bpm<=180;bpm++){const lag=Math.round(60*50/bpm);let score=0;for(let i=lag;i<onset.length;i++)score+=onset[i]*onset[i-lag];if(!best||score>best.score)best={bpm,score};}
  const energy=onset.reduce((sum,value)=>sum+value*value,0);return best&&energy>0?{bpm:best.bpm,strength:round(best.score/energy,2)}:null;
}
// Tamaños de letra y margen con OCR (opcional: si falla, se omite).
async function typeMetrics(file,times,height,width,dir){
  try{const {createWorker}=await import('tesseract.js');const worker=await createWorker('spa+eng',1,{cachePath:path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')),'..','.tools','ocr')});const sizes=[],lefts=[];
    try{for(const time of times.slice(0,4)){const frame=path.join(dir,`ocr-${time}.png`);if((await execute(ffmpeg,['-y','-v','error','-ss',String(time),'-i',file,'-frames:v','1',frame],{timeout:60000})).code!==0)continue;
      const {data}=await worker.recognize(frame,{},{blocks:true});for(const line of (data.blocks||[]).flatMap(block=>block.paragraphs||[]).flatMap(paragraph=>paragraph.lines||[])){if((line.confidence??0)<60||String(line.text||'').trim().length<3)continue;sizes.push((line.bbox.y1-line.bbox.y0)/height);lefts.push(line.bbox.x0/width);}}}
    finally{await worker.terminate();}
    if(!sizes.length)return null;const sorted=[...sizes].sort((a,b)=>b-a),levels=[];for(const size of sorted)if(!levels.some(level=>Math.abs(level-size)/level<0.2))levels.push(size);
    return {sizes:levels.slice(0,4).map(value=>round(value,3)),margin:round(quantile(lefts,0.1),3),lines:sizes.length};
  }catch{return null;}
}
function camera(energy){return energy<0.004?'quieto':energy<0.015?'deriva suave':energy<0.04?'movimiento':'movimiento intenso';}

export async function analyzeReference(file,dir,{withType=true}={}){
  await mkdir(dir,{recursive:true});const probe=await probeMedia(file),duration=Math.min(probe.duration||0,LIMIT_S);if(!duration)throw new Error('El vídeo no tiene duración legible.');
  const cutsRaw=await detectShots(file,duration),cuts=cutsRaw.map(shot=>shot.start).filter(time=>time>0);
  const shots=cutsRaw.length?cutsRaw:[{start:0,end:duration}],lengths=shots.map(shot=>shot.end-shot.start);
  const grey=await rawFrames(file,{fps:10,width:W,height:H,duration,dir,name:'grey'}),diffs=grey.map((frame,index)=>index?meanDiff(grey[index-1],frame):0);
  const perShot=shots.map(shot=>{const from=Math.floor(shot.start*10)+2,to=Math.max(from+1,Math.floor(shot.end*10)-1),slice=diffs.slice(from,to),brightness=grey.slice(from,to).map(mean);const energy=slice.length?slice.reduce((a,b)=>a+b,0)/slice.length:0;return {start:round(shot.start),length:round(shot.end-shot.start),energy:round(energy,4),camera:camera(energy),brightness:brightness.length?round(brightness.reduce((a,b)=>a+b,0)/brightness.length/255,2):null};});
  const color=await rawFrames(file,{fps:1,width:32,height:18,format:'rgb24',duration,dir,name:'color'});
  const silences=probe.hasAudio?await detectSilences(file,undefined,'-40dB',0.3):[],silenceShare=probe.hasAudio?round(silences.reduce((sum,item)=>sum+item.end-item.start,0)/duration,2):null;
  const beat=probe.hasAudio?await tempo(file,duration,dir):null,type=withType?await typeMetrics(file,perShot.map(shot=>round(shot.start+shot.length/2,1)),probe.height||1080,probe.width||1920,dir):null;
  // Huella para el guardián anti-copia: fotogramas grises de 64x36 a 4 por segundo.
  const fingerprint=grey.filter((_,index)=>index%Math.round(10/4)===0);await writeFile(path.join(dir,'fingerprint.bin'),Buffer.concat(fingerprint));
  // Hojas para los agentes: un fotograma por segundo y uno por plano.
  const sheet=path.join(dir,'sheet.jpg'),shotsSheet=path.join(dir,'shots.jpg'),columns=6;
  await execute(ffmpeg,['-y','-v','error','-t',String(duration),'-i',file,'-vf',`fps=1,scale=320:-2,tile=${columns}x${Math.max(1,Math.ceil(duration/columns))}:padding=4`,'-frames:v','1',sheet],{timeout:600000});
  const mids=perShot.slice(0,24).map(shot=>Math.round((shot.start+shot.length/2)*(probe.fps||25)));
  await execute(ffmpeg,['-y','-v','error','-i',file,'-vf',`select='${mids.map(frame=>`eq(n\\,${frame})`).join('+')||'eq(n\\,0)'}',scale=320:-2,tile=6x${Math.max(1,Math.ceil(mids.length/6))}:padding=4`,'-vsync','vfr','-frames:v','1',shotsSheet],{timeout:600000});
  const spec={duration:round(duration,1),width:probe.width,height:probe.height,fps:probe.fps,
    shots:{count:shots.length,median:round(quantile(lengths,0.5)),p25:round(quantile(lengths,0.25)),p75:round(quantile(lengths,0.75)),min:round(Math.min(...lengths)),max:round(Math.max(...lengths))},
    pace:round(cuts.length/duration*10,1),cuts:cuts.map(time=>round(time)),perShot,
    energy:{mean:round(diffs.reduce((a,b)=>a+b,0)/Math.max(1,diffs.length),4),cameras:perShot.reduce((counts,shot)=>({...counts,[shot.camera]:(counts[shot.camera]||0)+1}),{})},
    brightness:round(grey.map(mean).reduce((a,b)=>a+b,0)/Math.max(1,grey.length)/255,2),palette:palette(color),type,audio:probe.hasAudio?{silenceShare,tempo:beat}:null,fingerprintFps:4};
  return {spec,files:{sheet:path.basename(sheet),shots:path.basename(shotsSheet),fingerprint:'fingerprint.bin'}};
}

// Resumen para los agentes: lo que se conserva (KEEP) y lo que nunca se toma (CHANGE).
export function referenceBrief(name,spec){
  const keep=[`ritmo: ${spec.pace} cambios de plano por cada 10 s; planos de ${spec.shots.p25}–${spec.shots.p75} s (mediana ${spec.shots.median} s)`,`movimiento: ${Object.entries(spec.energy.cameras).map(([verb,count])=>`${count} planos de ${verb}`).join(', ')}`,spec.palette?`paleta: fondo ${spec.palette.ground}, tinta ${spec.palette.ink}, acento ${spec.palette.accent}${spec.palette.flat?' (plana)':''}`:'',spec.type?`tipografía: tamaños de ${spec.type.sizes.map(size=>Math.round(size*100*10)/10+' %').join(', ')} de la altura; margen lateral del ${Math.round((spec.type.margin||0)*1000)/10} %`:'',`luminosidad media: ${Math.round(spec.brightness*100)} %`,spec.audio?.tempo?`sonido: unas ${spec.audio.tempo.bpm} pulsaciones por minuto${spec.audio.silenceShare!=null?`, ${Math.round(spec.audio.silenceShare*100)} % de silencio`:''}`:''].filter(Boolean);
  return `Referencia de estilo «${name}» (${spec.duration} s). Conserva su gramática: ${keep.join('; ')}. Nunca su contenido: ni sus palabras, logos, imágenes, planos recreados fotograma a fotograma ni su música.`;
}

// Mide un vídeo propio igual que la referencia y compara lo que debe conservarse.
export async function referenceDiff(file,reference,dir){
  const {spec}=await analyzeReference(file,dir,{withType:false}),lines=[];
  const near=(a,b,tolerance)=>a!=null&&b!=null&&Math.abs(a-b)<=Math.max(tolerance*Math.abs(b),0.001);
  lines.push({item:'ritmo (cambios cada 10 s)',reference:reference.pace,render:spec.pace,ok:near(spec.pace,reference.pace,0.35)});
  lines.push({item:'mediana de plano (s)',reference:reference.shots.median,render:spec.shots.median,ok:near(spec.shots.median,reference.shots.median,0.35)});
  lines.push({item:'energía de movimiento',reference:reference.energy.mean,render:spec.energy.mean,ok:near(spec.energy.mean,reference.energy.mean,0.5)});
  if(reference.palette&&spec.palette){const distance=(a,b)=>{const p=x=>[1,3,5].map(i=>parseInt(x.slice(i,i+2),16));const [x,y]=[p(a),p(b)];return Math.sqrt(x.reduce((sum,value,index)=>sum+(value-y[index])**2,0));};lines.push({item:'color de fondo',reference:reference.palette.ground,render:spec.palette.ground,ok:distance(spec.palette.ground,reference.palette.ground)<60});}
  lines.push({item:'luminosidad media',reference:reference.brightness,render:spec.brightness,ok:near(spec.brightness,reference.brightness,0.3)});
  return {lines,spec};
}

// Guardián anti-copia: SSIM por bloques y diferencia de hash sobre fotogramas grises de 64x36.
function ssim(a,b){let total=0,blocks=0;for(let by=0;by<H;by+=6)for(let bx=0;bx<W;bx+=8){const xs=[],ys=[];for(let y=by;y<Math.min(H,by+6);y++)for(let x=bx;x<Math.min(W,bx+8);x++){xs.push(a[y*W+x]);ys.push(b[y*W+x]);}
  const mx=xs.reduce((s,v)=>s+v,0)/xs.length,my=ys.reduce((s,v)=>s+v,0)/ys.length;let vx=0,vy=0,cov=0;for(let i=0;i<xs.length;i++){vx+=(xs[i]-mx)**2;vy+=(ys[i]-my)**2;cov+=(xs[i]-mx)*(ys[i]-my);}vx/=xs.length;vy/=xs.length;cov/=xs.length;
  const c1=(0.01*255)**2,c2=(0.03*255)**2;total+=((2*mx*my+c1)*(2*cov+c2))/((mx*mx+my*my+c1)*(vx+vy+c2));blocks++;}return total/blocks;}
function dhash(frame){const cells=[];for(let y=0;y<8;y++)for(let x=0;x<9;x++){let total=0,count=0;for(let yy=Math.floor(y*H/8);yy<Math.floor((y+1)*H/8);yy++)for(let xx=Math.floor(x*W/9);xx<Math.floor((x+1)*W/9);xx++){total+=frame[yy*W+xx];count++;}cells.push(total/count);}const bits=[];for(let y=0;y<8;y++)for(let x=0;x<8;x++)bits.push(cells[y*9+x]>cells[y*9+x+1]?1:0);return bits;}
// Confirmación en detalle (256x144, solo bloques con textura): el mismo diseño con otras palabras da 0,3–0,45; una copia, 0,8 o más.
async function detailFrame(file,time,dir,name){const out=path.join(dir,name+'.raw');const result=await execute(ffmpeg,['-y','-v','error','-ss',String(time),'-i',file,'-frames:v','1','-vf','scale=256:144:flags=area','-f','rawvideo','-pix_fmt','gray',out],{timeout:60000});if(result.code!==0)return null;const buffer=await readFile(out);await rm(out,{force:true});return buffer.length>=256*144?buffer:null;}
function texturedSsim(a,b){const w=256,h=144;let total=0,blocks=0;for(let by=0;by<h;by+=16)for(let bx=0;bx<w;bx+=16){const xs=[],ys=[];for(let y=by;y<by+16;y++)for(let x=bx;x<bx+16;x++){xs.push(a[y*w+x]);ys.push(b[y*w+x]);}const mx=xs.reduce((s,v)=>s+v,0)/xs.length,my=ys.reduce((s,v)=>s+v,0)/ys.length;let vx=0,vy=0,cov=0;for(let i=0;i<xs.length;i++){vx+=(xs[i]-mx)**2;vy+=(ys[i]-my)**2;cov+=(xs[i]-mx)*(ys[i]-my);}vx/=xs.length;vy/=xs.length;cov/=xs.length;if(Math.sqrt(vx)<10&&Math.sqrt(vy)<10)continue;const c1=(0.01*255)**2,c2=(0.03*255)**2;total+=((2*mx*my+c1)*(2*cov+c2))/((mx*mx+my*my+c1)*(vx+vy+c2));blocks++;}return blocks?total/blocks:0;}
export async function nearCopy(file,referenceDir,referenceSpec,renderCuts,dir,referenceFile=null){
  await mkdir(dir,{recursive:true});
  const fingerprint=await readFile(path.join(referenceDir,'fingerprint.bin')),refFrames=[];for(let offset=0;offset+W*H<=fingerprint.length;offset+=W*H)refFrames.push(fingerprint.subarray(offset,offset+W*H));
  const probe=await probeMedia(file),frames=(await rawFrames(file,{fps:2,width:W,height:H,duration:probe.duration||0,dir,name:'render-grey'})).slice(0,48),refHashes=refFrames.map(dhash);
  let counted=0,copies=0;const times=[],candidates=[];
  frames.forEach((frame,index)=>{if(std(frame)<8)return;counted++;const hash=dhash(frame);let hit=null;for(let r=0;r<refFrames.length&&hit==null;r++){const similarity=ssim(frame,refFrames[r]);if(similarity>=0.93)hit=r;else if(similarity>=0.8){const bits=hash.reduce((sum,bit,i)=>sum+(bit!==refHashes[r][i]?1:0),0);if(bits<=12)hit=r;}}if(hit!=null)candidates.push({time:index/2,ref:hit/(referenceSpec.fingerprintFps||4)});});
  for(const candidate of candidates){if(!referenceFile){copies++;times.push(candidate.time);continue;}const [a,b]=await Promise.all([detailFrame(file,candidate.time,dir,'a'+candidate.time),detailFrame(referenceFile,candidate.ref,dir,'b'+candidate.time)]);if(!a||!b||texturedSsim(a,b)>=0.65){copies++;times.push(candidate.time);}}
  const share=counted?copies/counted:0,positions=list=>list.map(time=>time/Math.max(1,(list===renderCuts?probe.duration:referenceSpec.duration)));
  const a=positions(renderCuts),b=positions(referenceSpec.cuts||[]);let rhythm=0;if(a.length&&b.length&&Math.abs(a.length-b.length)<=Math.max(a.length,b.length)/4){const matched=a.filter(x=>b.some(y=>Math.abs(x-y)<=0.02)).length,precision=matched/a.length,recall=matched/b.length;rhythm=precision+recall?2*precision*recall/(precision+recall):0;}
  const result=share>=0.25||(share>=0.1&&rhythm>=0.8)?'fail':share>=0.05?'warn':'pass';
  return {result,share:round(share,3),rhythm:round(rhythm,2),times:times.slice(0,10),counted};
}
