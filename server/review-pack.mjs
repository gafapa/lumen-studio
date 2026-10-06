// Material de revisión (idea de Showtime): fotogramas sellados con un código aleatorio que el revisor debe
// devolver («prueba de que miró»), tira de cortes (2 fotogramas antes y 4 después de cada cambio de escena,
// donde se esconden fogonazos y dobles exposiciones), miniatura de 168x94 y recortes de texto a tamaño real.
import path from 'node:path';
import {randomInt,randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';
import {execute} from './process.mjs';

const codeSvg=(code,width)=>{const size=Math.max(18,Math.round(width*0.022)),pad=Math.round(size*0.45),w=Math.round(size*4.2),h=size+pad*2;
  return {svg:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" rx="${Math.round(size*0.3)}" fill="#ffde3b"/><text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${size}" fill="#111">${code}</text></svg>`),w,h};};

// Copia cada imagen con un código de 5 cifras en la esquina superior derecha. Devuelve [{path, code, label}].
export async function stampImages(images,targetDir){
  await mkdir(targetDir,{recursive:true});const result=[];
  for(const [index,image] of images.entries()){
    const source=typeof image==='string'?{path:image}:image,code=String(randomInt(10000,100000));
    try{const meta=await sharp(source.path).metadata(),badge=codeSvg(code,meta.width||1280),out=path.join(targetDir,`${String(index).padStart(2,'0')}-${randomUUID().slice(0,8)}${path.extname(source.path)==='.jpg'?'.jpg':'.png'}`);
      const scale=Math.min(1,1024/(meta.width||1024)),width=Math.round((meta.width||1280)*scale),height=Math.round((meta.height||720)*scale),small=codeSvg(code,width);
      await sharp(source.path).resize({width,height}).composite([{input:small.svg,top:Math.round(height*0.02),left:Math.max(0,width-small.w-Math.round(width*0.02))}]).jpeg({quality:84}).toFile(out.replace(/\.png$/,'.jpg'));
      result.push({...source,path:out.replace(/\.png$/,'.jpg'),code,original:source.path});continue;
}catch{}
  }
  return result;
}
// Un revisor solo cuenta si devuelve los códigos de las imágenes que dice haber visto (al menos el 80 %).
export function checkSeenCodes(stamped,seen){const expected=new Set(stamped.map(item=>item.code)),got=new Set((seen||[]).map(String));let hits=0;for(const code of expected)if(got.has(code))hits++;const invented=[...got].filter(code=>!expected.has(code)).length;return {ok:expected.size===0||(hits>=Math.ceil(expected.size*0.8)&&invented===0),hits,expected:expected.size,invented};}

// Tira de cortes: por cada cambio de escena, los fotogramas desde 2 antes hasta 4 después.
export async function cutsSheet(video,boundaries,fps,output,signal){
  const frames=boundaries.map(time=>Math.round(time*fps)).filter(frame=>frame>2);if(!frames.length)return null;
  const select=frames.map(frame=>`between(n\\,${frame-2}\\,${frame+4})`).join('+');
  const result=await execute(ffmpeg,['-y','-v','error','-i',video,'-vf',`select='${select}',scale=320:-2,tile=7x${frames.length}:padding=4:color=black`,'-frames:v','1','-vsync','vfr',output],{signal,timeout:300000});
  return result.code===0?output:null;
}
// Miniatura de 168x94: ¿se entiende el vídeo en una lista de recomendados?
export async function thumbnail(video,time,output,signal){const result=await execute(ffmpeg,['-y','-v','error','-ss',String(time),'-i',video,'-frames:v','1','-vf','scale=168:94:force_original_aspect_ratio=decrease,pad=168:94:(ow-iw)/2:(oh-ih)/2',output],{signal,timeout:60000});return result.code===0?output:null;}
// Recortes de texto a resolución completa a partir de cajas medidas en la inspección.
export async function textCrops(frame,boxes,dir,prefix,limit=6){
  await mkdir(dir,{recursive:true});const out=[];let meta;try{meta=await sharp(frame).metadata();}catch{return out;}
  for(const [index,box] of boxes.slice(0,limit).entries()){const pad=Math.round(box.height*0.4),left=Math.max(0,Math.floor(box.x-pad)),top=Math.max(0,Math.floor(box.y-pad)),width=Math.min(meta.width-left,Math.ceil(box.width+pad*2)),height=Math.min(meta.height-top,Math.ceil(box.height+pad*2));if(width<8||height<8)continue;
    const file=path.join(dir,`${prefix}-${index}.png`);try{await sharp(frame).extract({left,top,width,height}).toFile(file);out.push({path:file,text:box.text,time:box.time});}catch{}}
  return out;
}
