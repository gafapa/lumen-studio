// Tokens de movimiento y diseño que Lumen deja en cada escena (lumen/tokens.*): colores, tipografía, escala,
// retícula, zonas seguras, duraciones, curvas, escalonados y ritmo. Así todas las escenas de un proyecto se
// mueven y componen igual aunque las programen agentes distintos. También ayudas para zoom sobre clics.

const PALETTE={background:'#111b31',ink:'#f5f8ff',accent:'#65dacf',card:'#1d2b45'};
export function motionTokens(brief){
  const width=brief.width,height=brief.height,short=Math.min(width,height),palette={...PALETTE,...brief.profile?.palette};
  const font=brief.profile?.font==='DM Sans'?'DM Sans':brief.profile?.font==='Arial'?'Arial':'Inter';
  const px=value=>Math.round(value);
  return {
    canvas:{width,height,fps:brief.fps,format:brief.format},
    color:palette,
    font:{display:font,body:font==='Inter'?'DM Sans':font},
    // Escala tipográfica relativa al lado corto del lienzo: contrastes grandes entre niveles.
    type:{hero:px(short*0.16),display:px(short*0.11),h1:px(short*0.075),h2:px(short*0.055),body:px(short*0.038),caption:px(short*0.034),label:px(short*0.026)},
    space:{unit:px(short*0.0125),gap:px(short*0.025),margin:px(width*0.06)},
    grid:{columns:12,gutter:px(width*0.02),margin:px(width*0.06),anchors:'Retícula 6x6 de A1 (arriba izquierda) a F6 (abajo derecha): columnas A–F, filas 1–6.'},
    safe:{titleInset:0.05,captionZone:brief.captions?.enabled?0.18:0,platformUI:brief.format==='portrait'?{top:0.1,bottom:0.2,right:0.12}:null},
    duration:{instant:0.12,fast:0.24,base:0.4,slow:0.7,hero:1.1},
    // Curvas: productivas (UI, información) y expresivas (momentos clave). GSAP y CSS equivalentes.
    ease:{standard:{gsap:'power2.inOut',css:'cubic-bezier(0.2,0,0,1)'},entrance:{gsap:'power3.out',css:'cubic-bezier(0,0,0.3,1)'},exit:{gsap:'power2.in',css:'cubic-bezier(0.3,0,1,1)'},expressive:{gsap:'expo.out',css:'cubic-bezier(0.4,0.14,0.3,1)'},overshoot:{gsap:'back.out(1.6)',css:'cubic-bezier(0.34,1.56,0.64,1)'}},
    spring:{snappy:{damping:18,stiffness:180,mass:0.7},default:{damping:14,stiffness:120,mass:0.8},gentle:{damping:20,stiffness:80,mass:1}},
    stagger:{tight:0.04,base:0.08,loose:0.14},
    pacing:{minShot:1.5,maxShot:4,maxStaticHold:2.5,heroHold:2,breathingScale:0.015,cameraPushIn:1.06},
    rules:['Cada plano tiene un único trabajo y un elemento principal.','Corta entre planos en lugar de animar todo dentro de uno.','Contraste fuerte de escala y composición descentrada (60/40), no titulares centrados sobre degradado.','Nada queda completamente quieto: respiración del 1–2 % o un empuje de cámara por escena.','Cada movimiento tiene un porqué; sincroniza los énfasis con las palabras de la narración.'],
  };
}
export function tokensCss(tokens){
  const vars=[...Object.entries(tokens.color).map(([key,value])=>`--lumen-${key}:${value}`),`--lumen-font-display:'${tokens.font.display}',sans-serif`,`--lumen-font-body:'${tokens.font.body}',sans-serif`,...Object.entries(tokens.type).map(([key,value])=>`--lumen-type-${key}:${value}px`),...Object.entries(tokens.space).map(([key,value])=>`--lumen-space-${key}:${value}px`),`--lumen-grid-gutter:${tokens.grid.gutter}px`,`--lumen-grid-margin:${tokens.grid.margin}px`,...Object.entries(tokens.duration).map(([key,value])=>`--lumen-duration-${key}:${value}s`),...Object.entries(tokens.ease).map(([key,value])=>`--lumen-ease-${key}:${value.css}`),`--lumen-caption-zone:${tokens.safe.captionZone*100}%`];
  return `/* Generado por Lumen a partir de la identidad del proyecto. Usa estas variables en lugar de valores sueltos. */\n:root{\n  ${vars.join(';\n  ')};\n}\n`;
}
export function tokensJs(tokens){return `// Generado por Lumen: tokens de diseño y movimiento del proyecto (window.LumenTokens).\nwindow.LumenTokens=${JSON.stringify(tokens,null,1)};\n`;}
export function tokensTs(tokens){return `// Generado por Lumen: tokens de diseño y movimiento del proyecto.\nexport const tokens=${JSON.stringify(tokens,null,1)} as const;\nexport default tokens;\n`;}

// Zoom sobre los clics de una grabación (los tiempos de zooms están en segundos de la grabación, x/y en 0–1).
export const ZOOM_JS=`// Generado por Lumen: zoom automático sobre clics de una grabación (window.LumenZoom).
// LumenZoom.apply(tl, '#marco', zooms, {start, mediaStart, rate, scale, duration})
//  - tl: timeline de la escena; '#marco': contenedor del <video> (no el clip); zooms: lumen/media.json → events.
//  - start: segundo de la escena en que empieza el clip; mediaStart: segundo de la grabación donde empieza el recorte.
window.LumenZoom={apply(tl,target,zooms,{start=0,mediaStart=0,rate=1,scale=1.8,duration=0.6,ease='power3.inOut',end=Infinity}={}){
  for(const zoom of zooms||[]){const from=start+(zoom.start-mediaStart)/rate,to=start+(zoom.end-mediaStart)/rate;if(to<=start||from>=end)continue;
    tl.to(target,{scale,transformOrigin:(zoom.x*100).toFixed(1)+'% '+(zoom.y*100).toFixed(1)+'%',duration,ease},Math.max(start,from));
    tl.to(target,{scale:1,duration,ease},Math.min(end,to));}
  return tl;}};
`;
export const ZOOM_TS=`// Generado por Lumen: zoom automático sobre clics de una grabación.
// const style=zoomStyle(frame/fps, zooms, {mediaStart, rate}); aplícalo al contenedor del <Video>.
import {interpolate,Easing} from 'remotion';
export type Zoom={start:number;end:number;x:number;y:number};
export function zoomStyle(time:number,zooms:Zoom[],{mediaStart=0,rate=1,scale=1.8,ramp=0.6}={}):{transform:string;transformOrigin:string}{
  for(const zoom of zooms||[]){const from=(zoom.start-mediaStart)/rate,to=(zoom.end-mediaStart)/rate;if(time<from||time>to+ramp)continue;
    const inside=interpolate(time,[from,from+ramp,to,to+ramp],[1,scale,scale,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.inOut(Easing.cubic)});
    return {transform:\`scale(\${inside})\`,transformOrigin:\`\${zoom.x*100}% \${zoom.y*100}%\`};}
  return {transform:'scale(1)',transformOrigin:'50% 50%'};
}
`;
