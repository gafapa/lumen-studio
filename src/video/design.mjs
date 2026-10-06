// Shared design contract and deterministic geometry for both renderers.
export const layerTypes=['text','card','shape','icon','media','chart','line','counter'];
export const motions=['none','fade','rise','slide-left','slide-right','pop','wipe','draw','float','ken-burns'];
export const icons=['computer','server','network','globe','shield','database','clock','check','play','lightbulb'];
const nullable=properties=>({type:['object','null'],properties,additionalProperties:false});
const number=(minimum,maximum)=>({type:'number',minimum,maximum});
const color={type:'string',pattern:'^(#[a-fA-F0-9]{6}|accent|ink|card|background|transparent)$'};
export const compositionSchema=nullable({
  layout:{enum:['auto','canvas','split','focus','montage','picture-in-picture']},
  background:{enum:['solid','gradient','grid','aurora']},
  camera:{enum:['none','push','pull','pan-left','pan-right','drift']},
  layers:{type:'array',maxItems:24,items:{type:'object',required:['id','type'],additionalProperties:false,properties:{
    id:{type:'string',pattern:'^[a-z0-9-]+$'},type:{enum:layerTypes},text:{type:['string','null'],maxLength:500},
    box:nullable({x:number(0,100),y:number(0,100),w:number(1,100),h:number(.2,100)}),
    start:number(0,120),duration:{type:['number','null'],minimum:.1,maximum:120},motion:{enum:motions},
    style:nullable({fill:color,color,fontSize:number(12,160),radius:number(0,80),opacity:number(0,1),weight:{enum:[400,600,700,800]},align:{enum:['left','center','right']},border:number(0,8),glow:{type:'boolean'}}),
    shape:{enum:['rectangle','circle','pill']},icon:{enum:[null,...icons]},
    media:nullable({assetId:{type:['string','null']},recordingId:{type:['string','null']},from:number(0,7200),to:{type:['number','null'],minimum:.1,maximum:7200},rate:number(.25,4),fit:{enum:['cover','contain']},volume:number(0,1)}),
    chart:nullable({type:{enum:['bars','line','donut']},labels:{type:'array',maxItems:8,items:{type:'string',maxLength:50}},values:{type:'array',minItems:1,maxItems:8,items:number(0,1000000)},unit:{type:'string',maxLength:20}}),
    keyframes:{type:'array',maxItems:12,items:{type:'object',required:['time','x','y','scale','rotation','opacity'],additionalProperties:false,properties:{time:number(0,120),x:number(-100,100),y:number(-100,100),scale:number(.1,3),rotation:number(-360,360),opacity:number(0,1)}}},
  }}},
});
export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const clamp=value=>Math.max(0,Math.min(1,value));
export function themeFor(style,profile={}){const themes={editorial:{background:'#eae5ff',ink:'#302654',accent:'#7957df',card:'#f8f6ff'},technology:{background:'#111b31',ink:'#f5f8ff',accent:'#65dacf',card:'#1d2b45'},whiteboard:{background:'#f7f3e9',ink:'#292f32',accent:'#dc8652',card:'#ffffff'}};return {...(themes[style]||themes[['documentary','news'].includes(style)?'technology':style==='presentation'?'whiteboard':'editorial']),...profile.palette};}
const hash=value=>[...value].reduce((n,char)=>(n*31+char.charCodeAt(0))>>>0,0);
export const advancedDesign=(scene,profile={})=>!!scene.composition||['rich','cinematic'].includes(profile.visualIntensity);
export function validateDesign(scene){
  const composition=scene.composition;if(!composition)return;
  if(!Array.isArray(composition.layers))throw new Error('La composición requiere una lista de capas.');
  const resolved=sceneDesign(scene);if(resolved.layers.length>24||resolved.layers.filter(layer=>layer.type==='media').length>8)throw new Error('Máximo 24 capas y ocho multimedia por escena.');
  const ids=new Set();let videos=0;
  for(const layer of composition.layers||[]){
    if(ids.has(layer.id))throw new Error('Identificadores de capa duplicados.');ids.add(layer.id);
    if((layer.start||0)>=scene.duration||(layer.duration!=null&&(layer.start||0)+layer.duration>scene.duration+.02))throw new Error('Una capa excede la duración de la escena.');
    if(layer.box&&(layer.box.x==null||layer.box.y==null||layer.box.w==null||layer.box.h==null||layer.box.x+layer.box.w>100.01||layer.box.y+layer.box.h>100.01))throw new Error('La caja de una capa debe caber en el lienzo.');
    if(layer.type==='media'){videos++;if(layer.media?.to!=null&&layer.media.to<= (layer.media.from||0))throw new Error('El final del corte debe ser posterior al inicio.');}
    if(layer.type==='chart'&&(!layer.chart||!layer.chart.values?.length||layer.chart.values.length!==layer.chart.labels?.length))throw new Error('Un gráfico requiere etiquetas y valores emparejados.');
    if(layer.type==='counter'&&!layer.chart?.values?.length)throw new Error('Un contador requiere un valor explícito y fundamentado.');
    let previous=-1;for(const keyframe of layer.keyframes||[]){if(keyframe.time<=previous||keyframe.time<(layer.start||0)||keyframe.time>Math.min(scene.duration,(layer.start||0)+(layer.duration??scene.duration)))throw new Error('Los keyframes deben estar ordenados y dentro del intervalo de la capa.');previous=keyframe.time;}
  }
  if(videos>8)throw new Error('Máximo ocho capas multimedia por escena.');
  if(composition.layout==='canvas'&&!composition.layers?.length)throw new Error('Un lienzo libre requiere capas.');
}
const box=(x,y,w,h)=>({x,y,w,h});
const text=(id,value,area,size=32,start=0)=>({id,type:'text',text:value,box:area,start,motion:'rise',style:{fontSize:size,weight:700}});
export function sceneDesign(scene,profile={},duration=scene.duration){
  const custom=scene.composition||{},portrait=profile.format==='portrait',cinematic=profile.visualIntensity==='cinematic',variant=hash(scene.id||scene.title)%3;
  const layout=custom.layout||(['image','video','stock','screencast'].includes(scene.type)?variant===0?'focus':'split':'auto');
  const layers=[];
  if(layout!=='canvas'){
    layers.push(text('eyebrow',scene.eyebrow||'LUMEN · APRENDE',box(6,5,84,5),15));layers.at(-1).style.color='accent';
    layers.push(text('heading',scene.title,box(6,12,88,portrait?13:17),portrait?43:scene.type==='title'?65:48,.1));
    const mediaScene=['image','video','stock','screencast'].includes(scene.type),points=scene.points||[];
    if(mediaScene){
      const area=layout==='picture-in-picture'?box(62,53,32,27):layout==='focus'||layout==='montage'?box(4,31,92,43):portrait?box(6,31,88,35):box(43,34,51,45);
      layers.push({id:'primary',type:'media',box:area,start:0,motion:'ken-burns',media:{assetId:null,recordingId:null,fit:'cover'},style:{radius:24}});
      const left=layout==='focus'||layout==='montage'?6:portrait?6:6,top=portrait?69:layout==='focus'||layout==='montage'?76:37,width=layout==='focus'||layout==='montage'||portrait?88:33;
      points.slice(0,layout==='focus'||layout==='montage'||portrait?1:3).forEach((point,i)=>layers.push({...text('point-'+i,point,box(left,top+i*(portrait?5:13),width,portrait?8:layout==='focus'||layout==='montage'?5:11),portrait?25:28,.5+i*.45),type:'card',style:{fontSize:portrait?25:28,fill:'card',radius:18}}));
    }else if(scene.type==='diagram'||scene.type==='timeline'){
      const count=Math.min(6,points.length),vertical=portrait;
      for(let i=0;i<count;i++){
        const area=vertical?box(10,31+i*8.7,80,7):box(6+i*88/count,41,80/count,29);
        layers.push({id:'node-'+i,type:'card',text:points[i],box:area,start:.25+i*.32,motion:'pop',style:{fill:'card',fontSize:vertical?25:Math.min(29,110/count),radius:20,border:1},icon:i===0?'computer':i===count-1?'server':'network'});
        if(i<count-1)layers.push({id:'link-'+i,type:'line',box:vertical?box(48,area.y+7,4,2):box(area.x+area.w,53,8/count,6),start:.7+i*.32,motion:'draw',style:{color:'accent'}});
      }
    }else{
      const limit=portrait?5:6,columns=scene.type==='comparison'?2:scene.type==='code'||scene.type==='quote'?1:variant===2?2:1,rows=Math.ceil(Math.min(points.length,limit)/columns);
      points.slice(0,limit).forEach((point,i)=>{const cols=portrait?1:columns,row=portrait?i:Math.floor(i/cols),rowHeight=(portrait?46:45)/Math.max(rows,portrait?points.length:1);layers.push({id:'point-'+i,type:scene.type==='quote'||scene.type==='code'?'text':'card',text:point,box:box(6+(i%cols)*46,34+row*rowHeight,cols===1?88:42,Math.max(5,rowHeight-2)),start:.35+i*.28,motion:scene.type==='code'?'wipe':'rise',style:{fill:scene.type==='code'?'card':scene.type==='quote'?'transparent':'card',fontSize:portrait?27:scene.type==='title'?34:scene.type==='code'?27:30,radius:18},icon:scene.type==='code'?null:'check'});});
    }
    layers.push({id:'rule',type:'shape',shape:'pill',box:box(6,29,cinematic?12:8,.5),start:.1,motion:'wipe',style:{fill:'accent'}});
  }
  for(const layer of custom.layers||[]){const index=layers.findIndex(item=>item.id===layer.id);if(index>=0)layers[index]={...layers[index],...layer,box:layer.box||layers[index].box,style:{...layers[index].style,...layer.style}};else layers.push(layer);}
  return {layout,background:custom.background||(cinematic?['aurora','grid','gradient'][variant]:'gradient'),camera:custom.camera||(cinematic?'drift':'none'),layers:layers.map((layer,i)=>({...layer,box:layer.box||box(6,34+(i%6)*7,88,7),start:layer.start||0,duration:layer.duration??duration-(layer.start||0),motion:layer.motion||'rise',style:layer.style||{},keyframes:layer.keyframes||[]}))};
}
export function motionFrames(layer,duration){
  if(layer.keyframes?.length)return layer.keyframes;
  const start=layer.start||0,end=Math.min(duration,start+(layer.duration??duration-start)),enter=Math.min(.6,(end-start)*.25),base={x:0,y:0,scale:1,rotation:0,opacity:1},from={...base,opacity:layer.motion==='none'?1:0};
  if(['rise','float'].includes(layer.motion))from.y=3;
  if(layer.motion==='slide-left')from.x=8;if(layer.motion==='slide-right')from.x=-8;
  if(layer.motion==='pop'){from.scale=.82;from.rotation=-2;}
  if(layer.motion==='ken-burns'){from.scale=1;from.opacity=1;return [{time:start,...from},{time:end,...base,scale:1.08,x:-1}];}
  if(layer.motion==='float'){const frames=[{time:start,...from},{time:start+enter,...base}];for(let t=start+enter+2;t<end-.22;t+=2)frames.push({time:t,...base,y:frames.length%2?-1:1,x:frames.length%2?.5:-.5});frames.push({time:Math.max(start+enter,end-.22),...base},{time:end,...base,opacity:0});return frames.filter((frame,i,array)=>!i||frame.time>array[i-1].time);}
  if(layer.motion==='none')return [{time:start,...base},{time:end,...base}];
  return [{time:start,...from},{time:start+enter,...base},{time:Math.max(start+enter,end-.22),...base},{time:end,...base,opacity:0}].filter((frame,i,array)=>!i||frame.time>array[i-1].time);
}
export function layerPose(layer,time,duration){
  const frames=motionFrames(layer,duration);let left=frames[0],right=frames.at(-1);for(let i=1;i<frames.length;i++)if(time<=frames[i].time){left=frames[i-1];right=frames[i];break;}
  const progress=clamp((time-left.time)/Math.max(.0001,right.time-left.time)),ease=1-(1-progress)**3;
  const result={};for(const key of ['x','y','scale','rotation','opacity'])result[key]=left[key]+(right[key]-left[key])*ease;
  result.opacity*=time<layer.start||time>=layer.start+layer.duration?0:layer.style?.opacity??1;
  result.reveal=['wipe','draw'].includes(layer.motion)?clamp((time-layer.start)/.65):1;
  return result;
}
export function cameraPose(camera,time,duration){const p=clamp(time/Math.max(1,duration));return camera==='push'?{scale:1+.06*p,x:0,y:0}:camera==='pull'?{scale:1.06-.06*p,x:0,y:0}:camera==='pan-left'?{scale:1.05,x:-1+2*p,y:0}:camera==='pan-right'?{scale:1.05,x:1-2*p,y:0}:camera==='drift'?{scale:1.025,x:p*.6,y:-p*.4}:{scale:1,x:0,y:0};}
export function layerCss(layer,theme){const s=layer.style||{},resolve=(value,fallback)=>theme[value]||value||fallback;return {position:'absolute',left:layer.box.x+'%',top:layer.box.y+'%',width:layer.box.w+'%',height:layer.box.h+'%',borderRadius:layer.shape==='circle'?'50%':layer.shape==='pill'?999:s.radius??(layer.type==='card'||layer.type==='media'?20:0),overflow:'hidden',background:resolve(s.fill,layer.type==='card'?theme.card:'transparent'),color:resolve(s.color,theme.ink),fontSize:s.fontSize||30,fontWeight:s.weight||700,textAlign:s.align||'left',border:s.border?`${s.border}px solid ${theme.accent}60`:undefined,boxShadow:s.glow?`0 0 45px ${theme.accent}44`:layer.type==='card'?'0 12px 35px #00000012':undefined,display:'flex',alignItems:'center',justifyContent:s.align==='center'?'center':'flex-start',padding:layer.type==='card'?18:0,lineHeight:1.2,whiteSpace:'pre-wrap',overflowWrap:'anywhere'};}
const iconPaths={computer:'M3 4h18v12H3z M8 21h8 M12 16v5',server:'M3 3h18v7H3z M3 14h18v7H3z M6 6h1 M6 17h1',network:'M9 2h6v5H9z M2 17h6v5H2z M16 17h6v5h-6z M12 7v5 M5 17v-5h14v5',globe:'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20 M2 12h20 M12 2c-6 7-6 13 0 20c6-7 6-13 0-20',shield:'M12 2L3 6v6c0 5 9 10 9 10s9-5 9-10V6z M8 12l3 3 5-6',database:'M3 6c0-5 18-5 18 0c0 5-18 5-18 0v12c0 5 18 5 18 0V6 M3 12c0 5 18 5 18 0',clock:'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20 M12 6v6l4 3',check:'M4 12l5 5L20 5',play:'M6 3l15 9-15 9z',lightbulb:'M8 18h8 M9 22h6 M8 15c-8-8 0-18 8-12c5 4 1 9 0 12z'};
export function iconSvg(icon,color,size=40){return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${iconPaths[icon]||iconPaths.network}"/></svg>`;}
export function chartSvg(layer,theme,progress=1){
  const c=layer.chart,values=c?.values||[0],max=Math.max(1,...values),labels=c?.labels||[],unit=escapeHtml(c?.unit||'');
  if(layer.type==='counter')return `<div class="counter-value"><span class="counter-number">${Math.round(values[0]*progress).toLocaleString('es')}${unit}</span><small style="display:block;font-size:.32em;margin-top:10px">${escapeHtml(layer.text||labels[0]||'')}</small></div>`;
  if(c?.type==='donut'){const total=values.reduce((a,b)=>a+b,0)||1;let offset=0;return `<svg viewBox="0 0 500 300" width="100%" height="100%">${values.map((value,i)=>{const fraction=value/total,stroke=`<circle cx="140" cy="150" r="95" fill="none" stroke="${[theme.accent,theme.ink,theme.card][i%3]}" stroke-width="36" pathLength="1000" stroke-dasharray="${fraction*1000} ${1000-fraction*1000}" stroke-dashoffset="${-offset*1000}" transform="rotate(-90 140 150)" opacity="${progress}"/>`;offset+=fraction;return stroke+`<text x="280" y="${75+i*30}" font-size="20" fill="${theme.ink}">${escapeHtml(labels[i])}: ${value}${unit}</text>`;}).join('')}</svg>`;}
  if(c?.type==='line'){const points=values.map((value,i)=>`${40+i*420/Math.max(1,values.length-1)},${230-value/max*180}`).join(' ');return `<svg viewBox="0 0 500 300" width="100%" height="100%"><path d="M40 30v210h420" stroke="${theme.ink}55" fill="none"/><polyline class="chart-path" points="${points}" fill="none" stroke="${theme.accent}" stroke-width="5" pathLength="1000" stroke-dasharray="1000" stroke-dashoffset="${1000*(1-progress)}"/>${values.map((value,i)=>`<text x="${40+i*420/Math.max(1,values.length-1)}" y="270" text-anchor="middle" font-size="17" fill="${theme.ink}">${escapeHtml(labels[i])}</text>`).join('')}</svg>`;}
  return `<svg viewBox="0 0 500 300" width="100%" height="100%">${values.map((value,i)=>{const w=420/values.length,x=40+i*w,h=value/max*180;return `<g><rect class="chart-bar" x="${x}" y="${240-h}" width="${w*.65}" height="${h}" rx="6" fill="${theme.accent}" style="transform-box:fill-box;transform-origin:bottom;transform:scaleY(${progress})"/><text x="${x+w*.33}" y="${225-h}" text-anchor="middle" fill="${theme.ink}" font-size="20">${value}${unit}</text><text x="${x+w*.33}" y="270" text-anchor="middle" fill="${theme.ink}" font-size="18">${escapeHtml(labels[i])}</text></g>`;}).join('')}</svg>`;
}
export function layerContent(layer,theme,progress=1){
  if(layer.type==='icon')return iconSvg(layer.icon,theme[layer.style.color]||layer.style.color||theme.accent,80);
  if(layer.type==='chart'||layer.type==='counter')return chartSvg(layer,theme,progress);
  if(layer.type==='line')return `<svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${layer.box.h>layer.box.w?'M50 0v85l-15-20m15 20 15-20':'M0 50h85l-20-15m20 15-20 15'}" fill="none" stroke="${theme[layer.style.color]||layer.style.color||theme.accent}" stroke-width="4" pathLength="1000" stroke-dasharray="1000" stroke-dashoffset="${1000*(1-progress)}"/></svg>`;
  if(layer.type==='shape')return '';
  return `${layer.icon?`<span style="flex-shrink:0;margin-right:16px;display:flex">${iconSvg(layer.icon,theme.accent)}</span>`:''}<span>${escapeHtml(layer.text)}</span>`;
}
export function cssText(style){return Object.entries(style).filter(([,value])=>value!==undefined).map(([key,value])=>`${key.replace(/[A-Z]/g,m=>'-'+m.toLowerCase())}:${typeof value==='number'&&!['opacity','fontWeight','lineHeight','zIndex'].includes(key)?value+'px':value}`).join(';');}
export function backgroundCss(design,theme){return design.background==='solid'?theme.background:design.background==='grid'?`linear-gradient(${theme.accent}12 1px,transparent 1px),linear-gradient(90deg,${theme.accent}12 1px,transparent 1px),radial-gradient(ellipse at 75% 20%,${theme.accent}24,transparent 65%),${theme.background}`:design.background==='aurora'?`radial-gradient(ellipse at 20% 15%,${theme.accent}38,transparent 55%),radial-gradient(ellipse at 90% 70%,${theme.accent}20,transparent 55%),linear-gradient(135deg,${theme.background},${theme.card})`:`linear-gradient(135deg,${theme.background},${theme.card})`;}
