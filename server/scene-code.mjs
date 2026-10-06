// Escenas programadas por agentes: cada escena es un pequeño proyecto HyperFrames (HTML + GSAP) o Remotion (React)
// dentro de code/<sceneId>. Lumen prepara el material, valida seguridad y determinismo, verifica con las
// herramientas de cada motor, guarda historial y renderiza el segmento, añadiendo la narración al final.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile,readdir,stat,copyFile,link,rm,rename,cp} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import ffmpeg from 'ffmpeg-static';
import {execute} from './process.mjs';
import {runHyperframes,probeMedia,mediaItems,readIndex,indexDirectory} from './media-index.mjs';
import {outputSpec} from '../src/video/output.mjs';
import {ENGINE_INFO,latexAvailable,isAdapterEngine,prepareEngine,lintEngine,checkEngine,snapshotEngine,renderEngine} from './engines.mjs';
import {motionTokens,tokensCss,tokensJs,tokensTs,ZOOM_JS,ZOOM_TS} from './motion-tokens.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const CODE_ENGINES=['hyperframes','remotion','manim','revideo'];
export const isCodeScene=scene=>CODE_ENGINES.includes(scene?.engine);
export const workspaceDir=(folder,sceneId)=>path.join(folder,'code',sceneId);
export const vendorSkills=path.join(root,'skills','vendor');
const GENERATED=new Set(['assets','snapshots','.history','.lumen','.vite','node_modules','renders','beats','__pycache__']);
const SOURCE_EXTENSIONS=new Set(['.py','.html','.htm','.css','.js','.mjs','.cjs','.jsx','.ts','.tsx','.json','.svg','.md']);
const IGNORED_SOURCES=new Set(['AGENTS.md','CLAUDE.md','lint.json','check.json']);
export const REMOTION_IMPORTS=['react','remotion','gsap','@remotion/media','@remotion/transitions','@remotion/shapes','@remotion/paths','@remotion/noise','@remotion/motion-blur','@remotion/layout-utils','@remotion/captions','@remotion/media-utils','@remotion/effects','@remotion/light-leaks','@remotion/rough-notation','@remotion/animation-utils','@remotion/gsap','@remotion/lottie','lottie-web','@remotion/three','@react-three/fiber','three'];
const GSAP_PLUGINS=['DrawSVGPlugin','MorphSVGPlugin','MotionPathPlugin','SplitText','TextPlugin','ScrambleTextPlugin','CustomEase','CustomBounce','CustomWiggle','Flip','EasePack','Physics2DPlugin','PhysicsPropsPlugin'];
const FONTS=[['inter','Inter',[400,600,700,800]],['dm-sans','DM Sans',[400,500,600,700]]];

const sha=value=>createHash('sha256').update(value).digest('hex');
const relative=(from,to)=>path.relative(from,to).replaceAll('\\','/');
async function exists(file){try{await stat(file);return true;}catch{return false;}}
// Three.js local (sin CDN): núcleo, una selección de addons y tipografías 3D, más Lottie. Se enlazan en cada
// escena HyperFrames y se marcan de confianza, igual que GSAP.
const THREE_ADDON_DIRS=['postprocessing','shaders','environments','geometries','utils','math','objects','lines','curves','modifiers','animation','effects','textures'];
const THREE_LOADERS=['GLTFLoader.js','FontLoader.js','SVGLoader.js','OBJLoader.js','MTLLoader.js','STLLoader.js','RGBELoader.js','HDRLoader.js','EXRLoader.js','TGALoader.js','DRACOLoader.js','KTX2Loader.js'];
async function filesUnder(directory,prefix=''){const result=[];for(const entry of await readdir(directory,{withFileTypes:true}).catch(()=>[])){const rel=prefix?prefix+'/'+entry.name:entry.name;if(entry.isDirectory())result.push(...await filesUnder(path.join(directory,entry.name),rel));else if(/\.(js|json)$/.test(entry.name))result.push(rel);}return result;}
let threeFiles=null;
async function threeVendorFiles(){
  if(threeFiles)return threeFiles;const three=path.join(root,'node_modules','three');if(!await exists(three))return threeFiles=[];
  const list=[['build/three.module.min.js','three.module.min.js'],['build/three.core.min.js','three.core.min.js']];
  for(const dir of THREE_ADDON_DIRS)for(const file of await filesUnder(path.join(three,'examples','jsm',dir)))list.push([`examples/jsm/${dir}/${file}`,`addons/${dir}/${file}`]);
  for(const file of THREE_LOADERS)list.push([`examples/jsm/loaders/${file}`,`addons/loaders/${file}`]);
  for(const file of ['helvetiker_regular.typeface.json','helvetiker_bold.typeface.json','optimer_bold.typeface.json'])list.push([`examples/fonts/${file}`,`fonts/${file}`]);
  // Dependencias habituales de los addons (../libs).
  for(const file of ['meshopt_decoder.module.js','fflate.module.js','potpack.module.js','chevrotain.module.min.js'])list.push([`examples/jsm/libs/${file}`,`addons/libs/${file}`]);
  const present=[];for(const item of list)if(await exists(path.join(three,item[0])))present.push(item);return threeFiles=present;
}
async function place(source,target){if(await exists(target))return;await mkdir(path.dirname(target),{recursive:true});try{await link(source,target);}catch{await copyFile(source,target);}}
const safeName=(name,fallback)=>{const base=String(name||fallback).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60)||fallback;return base;};

// Archivos fuente editables por el agente (excluye material, capturas, historial y artefactos generados).
export async function sourceFiles(dir,base=dir){
  const result=[];let entries=[];try{entries=await readdir(dir,{withFileTypes:true});}catch{return result;}
  for(const entry of entries){
    const absolute=path.join(dir,entry.name);
    if(entry.isDirectory()){if(dir===base&&GENERATED.has(entry.name)||entry.name==='lumen'&&dir===base)continue;result.push(...await sourceFiles(absolute,base));}
    else if(SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())&&!(dir===base&&IGNORED_SOURCES.has(entry.name)))result.push(relative(base,absolute));
  }
  return result.sort();
}
export async function sourceHash(dir){const files=await sourceFiles(dir);const hash=createHash('sha256');for(const file of files){hash.update(file+'\0');hash.update(await readFile(path.join(dir,file)));}return hash.digest('hex').slice(0,20);}

// ---------- Seguridad y determinismo (análisis estático previo a cualquier ejecución) ----------
const RULES=[
  {id:'network',re:/\bfetch\s*\(|XMLHttpRequest|\bWebSocket\b|\bEventSource\b|sendBeacon|\bimportScripts\b|RTCPeerConnection/,message:'Sin acceso a red: usa solo archivos locales del espacio de trabajo.'},
  {id:'dynamic-code',re:/\beval\s*\(|new\s+Function\b|\bWorker\s*\(|\bimport\s*\(/,message:'No se permite código dinámico (eval, Function, Worker, import()).'},
  {id:'browser-state',re:/document\.cookie|localStorage|sessionStorage|indexedDB|window\.open\s*\(|navigator\.(clipboard|geolocation|mediaDevices)/,message:'No accedas a almacenamiento, ventanas ni dispositivos del navegador.'},
  {id:'node',re:/\brequire\s*\(|\bprocess\.(env|exit|argv)|child_process|['"]node:|['"]fs['"]/,message:'El código del vídeo no puede usar APIs de Node.'},
  {id:'remote-url',re:/(?:src|href|poster|data-composition-src)\s*=\s*["']\s*(?:https?:)?\/\/|url\(\s*["']?\s*(?:https?:)?\/\/|@import|["'`]https?:\/\/(?!www\.w3\.org\/)/i,message:'No enlaces recursos remotos; copia o usa material de assets/.'},
  {id:'nondeterministic',re:/Math\.random\s*\(|Date\.now\s*\(|new\s+Date\s*\(|performance\.now|\bsetTimeout\s*\(|\bsetInterval\s*\(|requestAnimationFrame/,message:'Animación no determinista: usa el tiempo de la composición (timeline de GSAP o useCurrentFrame) y un generador con semilla.'},
];
const HTML_RULES=[{id:'embedded-document',re:/<(iframe|object|embed|form|base)\b|http-equiv/i,message:'No se permiten iframes, objetos incrustados, formularios ni redirecciones.'}];
const strip=(text,ext)=>ext==='.html'||ext==='.htm'?text.replace(/<!--[\s\S]*?-->/g,m=>m.replace(/[^\n]/g,' ')):ext==='.json'||ext==='.md'?'':text.replace(/\/\*[\s\S]*?\*\//g,m=>m.replace(/[^\n]/g,' ')).replace(/(^|[^:\\])\/\/[^\n]*/g,(m,p)=>p+' '.repeat(m.length-p.length));
function lineOf(text,index){return text.slice(0,index).split('\n').length;}
// Archivos instalados por Lumen o por el catálogo oficial: se omiten del análisis mientras no cambie su contenido.
export async function trustFiles(dir,files){const manifest=path.join(dir,'.lumen','trusted.json');let trusted={};try{trusted=JSON.parse(await readFile(manifest,'utf8'));}catch{}for(const file of files){try{trusted[file.replaceAll('\\','/')]=sha(await readFile(path.join(dir,file)));}catch{}}await mkdir(path.dirname(manifest),{recursive:true});await writeFile(manifest,JSON.stringify(trusted,null,2));}
async function trustedFiles(dir){try{return JSON.parse(await readFile(path.join(dir,'.lumen','trusted.json'),'utf8'));}catch{return {};}}
export async function scanSources(dir,engine){
  const issues=[],trusted=await trustedFiles(dir);
  for(const file of await sourceFiles(dir)){
    const buffer=await readFile(path.join(dir,file));if(trusted[file]&&trusted[file]===sha(buffer))continue;
    const ext=path.extname(file).toLowerCase(),raw=buffer.toString('utf8'),text=strip(raw,ext);if(ext==='.py')continue;
    if(raw.length>400000)issues.push({file,line:1,rule:'size',severity:'error',message:'Archivo fuente demasiado grande (máximo 400 KB); usa assets/ para datos pesados.'});
    for(const rule of [...RULES,...(ext==='.html'||ext==='.htm'?HTML_RULES:[])]){const match=rule.re.exec(text);if(match)issues.push({file,line:lineOf(text,match.index),rule:rule.id,severity:'error',message:rule.message,excerpt:raw.split('\n')[lineOf(text,match.index)-1]?.trim().slice(0,160)});}
    if(['.html','.htm'].includes(ext))for(const match of text.matchAll(/<(?:script|img|video|audio|source|link)\b[^>]*?(?:src|href)\s*=\s*["']([^"']+)["']/gi)){const target=match[1];if(/^(data:|#)/.test(target))continue;const resolved=path.resolve(dir,path.dirname(file),target.split(/[?#]/)[0]);if(path.relative(dir,resolved).startsWith('..')||!await exists(resolved))issues.push({file,line:lineOf(text,match.index),rule:'missing-file',severity:'error',message:`Referencia local inexistente o fuera del espacio de trabajo: ${target}`});}
    if(engine==='remotion'&&['.js','.mjs','.jsx','.ts','.tsx'].includes(ext))for(const match of text.matchAll(/(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g)){
      const spec=match[1];
      if(spec.startsWith('.')){const resolved=path.resolve(dir,path.dirname(file),spec);if(path.relative(dir,resolved).startsWith('..'))issues.push({file,line:lineOf(text,match.index),rule:'import',severity:'error',message:`Importación fuera del espacio de trabajo: ${spec}`});continue;}
      const pkg=spec.startsWith('@')?spec.split('/').slice(0,2).join('/'):spec.split('/')[0];
      if(!REMOTION_IMPORTS.includes(pkg))issues.push({file,line:lineOf(text,match.index),rule:'import',severity:'error',message:`Paquete no permitido: ${spec}. Permitidos: ${REMOTION_IMPORTS.join(', ')} y archivos relativos.`});
    }
  }
  return issues;
}

// ---------- Espacio de trabajo ----------
export function sceneBrief(project,scene,media){
  const spec=outputSpec(project.output),scenes=project.storyboard?.scenes||[],index=scenes.findIndex(item=>item.id===scene.id);
  return {sceneId:scene.id,engine:scene.engine,component:scene.component||null,data:scene.data||null,title:scene.title,eyebrow:scene.eyebrow||'',narration:scene.narration,points:scene.points||[],type:scene.type,direction:scene.direction||'',
    durationSeconds:media.duration,fps:spec.fps,width:spec.width,height:spec.height,format:spec.format,
    voice:{file:'assets/voice.wav',speechDuration:media.speechDuration,note:'Lumen mezcla esta narración después del render. No la incluyas como audio; úsala solo para sincronizar.'},
    shots:(()=>{const factor=scene.duration&&media.duration&&Math.abs(media.duration-scene.duration)>0.2?media.duration/scene.duration:1;return (scene.shots||[]).map(shot=>factor===1?shot:{...shot,start:Math.round(shot.start*factor*100)/100,duration:Math.round(shot.duration*factor*100)/100});})(),
    words:(media.words||[]).map(({text,start,end})=>({text,start,end})),captionMode:media.captionMode||null,
    captions:{enabled:project.profile?.captions===true,style:project.profile?.captionStyle||''},
    style:project.style,profile:{font:project.profile?.font||'Inter',palette:project.profile?.palette||null,visualIntensity:project.profile?.visualIntensity||'cinematic',imageStyle:project.profile?.imageStyle||'',logo:media.logoPath?'assets/logo'+path.extname(media.logoPath):null},
    transitionOut:scene.transition||project.profile?.transition||'fade',
    neighbours:{previous:scenes[index-1]?{title:scenes[index-1].title,engine:scenes[index-1].engine||'json'}:null,next:scenes[index+1]?{title:scenes[index+1].title,engine:scenes[index+1].engine||'json'}:null},
    videoPrompt:project.prompt,videoTitle:project.storyboard?.title||project.title};
}

async function mediaCatalog(project,folder,dir){
  const catalog=[];
  for(const item of mediaItems(project)){
    const name=`assets/media/${safeName(path.basename(item.path,path.extname(item.path)),item.id)}${path.extname(item.path).toLowerCase()}`;
    try{await place(path.join(folder,item.path),path.join(dir,name));}catch{continue;}
    const index=await readIndex(folder,item.id),compact=project.mediaIndex?.[item.id];
    let events=null;if(index?.events?.zooms){const eventsFile=`assets/data/${safeName(path.basename(item.path,path.extname(item.path)),item.id)}.events.json`;await mkdir(path.join(dir,'assets','data'),{recursive:true});await writeFile(path.join(dir,eventsFile),JSON.stringify(index.events,null,1));events={file:eventsFile,clicks:index.events.clicks.length,zooms:index.events.zooms.length,idle:index.events.idle.length};}
    catalog.push({mediaId:item.id,events,file:name,kind:item.kind,name:item.name,origin:item.origin,duration:index?.duration??compact?.duration??null,width:index?.width??null,height:index?.height??null,hasAudio:index?.hasAudio??null,alpha:/\.(webm|png)$/i.test(name)&&item.origin==='derived'?true:undefined,indexed:Boolean(index),shots:index?.shots?.length??null,transcriptWords:index?.transcript?.words??null,clicks:index?.events?.clicks?.length??null,contactSheet:index?.sheet?path.join(indexDirectory(folder,item.id),index.sheet):null});
  }
  for(const asset of (project.assets||[]).filter(item=>item.kind==='model')){
    const name=`assets/models/${safeName(path.basename(asset.path,path.extname(asset.path)),asset.id)}.glb`;
    try{await place(path.join(folder,asset.path),path.join(dir,name));}catch{continue;}
    catalog.push({mediaId:asset.id,file:name,kind:'model',name:asset.name,description:asset.description||null,license:asset.license||null,author:asset.author||null,note:'Modelo 3D glTF. HyperFrames: GLTFLoader de vendor/three/addons/loaders/ antes de renderizar. Remotion: useLoader(GLTFLoader, staticFile("models/<archivo>.glb")) dentro de <Suspense>. Si trae animaciones, sincronízalas con AnimationMixer.setTime(tiempo).'});
  }
  for(const asset of (project.assets||[]).filter(item=>item.kind==='data')){
    const name=`assets/data/${safeName(path.basename(asset.path,path.extname(asset.path)),asset.id)}${path.extname(asset.path).toLowerCase()}`;
    try{await place(path.join(folder,asset.path),path.join(dir,name));}catch{continue;}
    const index=project.mediaIndex?.[asset.id];catalog.push({mediaId:asset.id,file:name,kind:'data',name:asset.name,rows:index?.rows??null,columns:index?.columns||[],note:'Datos reales: léelos con library_read para usar cifras exactas en gráficos; no inventes valores.'});
  }
  return catalog;
}

function agentGuide(engine,brief){
  const shared=`# Escena «${brief.title}» (${engine})

Eres quien programa esta escena de un vídeo de Lumen. Escribe código, no JSON. Todo lo que necesitas está en esta carpeta:

- \`lumen/scene.json\`: encargo de la escena (narración, duración exacta ${brief.durationSeconds}s, ${brief.width}x${brief.height} a ${brief.fps} fps, palabras con tiempos, perfil visual, dirección artística y escenas vecinas).
- \`lumen/media.json\`: material del usuario disponible en \`assets/media/\` con duración, si tiene audio, planos y hoja de contactos. Reutilízalo: es la materia prima principal.
- \`assets/sfx/\`: efectos de sonido locales (whoosh, click, ding, shutter, page-turn, switch, whip, record-scratch).
- \`assets/fonts/\`: tipografías locales Inter y DM Sans.
- \`assets/voice.wav\`: narración ya grabada. Lumen la mezcla al final: **no la reproduzcas en la composición**.

Reglas que Lumen comprueba antes de renderizar (si fallan, la escena no se acepta):
- Sin red: nada de fetch, URLs remotas, CDN ni Google Fonts. Usa solo archivos de esta carpeta.
- Determinismo: nada de Math.random, Date, performance.now, setTimeout, setInterval ni requestAnimationFrame. Todo depende del tiempo de la composición; para azar usa un generador con semilla.
- Sin eval, Function, Worker, import() dinámico, almacenamiento del navegador ni APIs de Node.
- La duración total es exactamente la indicada; no la cambies.
- Subtítulos: ${brief.captions?.enabled?`este proyecto los quiere incrustados. Sincronízalos con \`words\` de scene.json${brief.captions.style?` con este estilo: ${brief.captions.style}`:''} y reserva el 18% inferior para ellos.`:'este proyecto no quiere subtítulos incrustados; no los añadas (el SRT se exporta aparte).'}
- Todo el texto debe caber dentro del lienzo.

Herramientas de Lumen por MCP: \`scene_lint\`, \`scene_check\` (lint, errores de ejecución, desbordes, solapes y contraste), \`scene_snapshot\` (fotogramas exactos para que los mires), \`media_search\`, \`media_info\`, \`media_frames\`, \`media_describe\`${engine==='hyperframes'?', `hyperframes_catalog` y `hyperframes_add` (bloques y componentes del catálogo oficial)':''}.

Flujo: lee scene.json y media.json → mira las hojas de contactos y fotogramas del material que vayas a usar → escribe → \`scene_lint\` → \`scene_check\` → \`scene_snapshot\` en los momentos clave y abre las imágenes → corrige lo que veas → repite hasta que esté bien. No declares que está terminado si no has mirado las capturas.

## Sistema de diseño de Lumen (obligatorio)
- \`lumen/tokens.css\` (variables \`--lumen-*\`) y ${engine==='hyperframes'?"\`lumen/tokens.js\` (\`window.LumenTokens\`)":"\`import {tokens} from './lumen/tokens'\`"}: colores, tipografía y escala, retícula, zonas seguras, duraciones, curvas, muelles, escalonados y ritmo del proyecto. Úsalos en lugar de valores sueltos para que todas las escenas sean coherentes.
- Ritmo: planos de 1,5 a 4 s con un único trabajo cada uno; ningún plano estático más de 2,5 s; corta entre planos en vez de animarlo todo en uno; contraste de escala y composición descentrada.
- Sincronía con la voz: \`lumen/scene.json\` trae \`words\` con el segundo exacto de cada palabra. Cada elemento aparece o cambia en el instante en que la narración lo nombra (entre 0,1 s antes y 0,3 s después de la palabra), nunca segundos más tarde; el cue de cada plano es la palabra que lo dispara. Al terminar la voz, cierra con una respiración breve: la escena dura lo que dura la voz más un margen.
- Si scene.json trae \`data\` (título, unidad, elementos etiqueta-valor y fuente), usa exactamente esas cifras para gráficos y rótulos: no inventes ni redondees otras, y cita la fuente si cabe.
- Si scene.json trae \`shots\` (lista de planos con tiempo, trabajo, elemento principal, ancla en la retícula 6x6 y escala), respétala: es el plan aprobado.
- Grabaciones de pantalla: \`lumen/media.json\` indica en \`events\` el archivo con clics y zooms sugeridos. Usa ${engine==='hyperframes'?"\`lumen/zoom.js\` (\`LumenZoom.apply(tl, '#marco', zooms, {start, mediaStart})\`)":"\`import {zoomStyle} from './lumen/zoom'\`"} para acercarte a cada clic y acelera o recorta los tiempos muertos (\`idle\`).

## Oficio con números (Lumen mide parte de esto con \`scene_check\`)
- Tiempo de lectura: cada texto asentado se mantiene al menos \`max(1 s, 0,3 s + caracteres/17)\` (o 3 palabras por segundo, lo que sea mayor); un titular, \`max(1,2 s, 0,3 × palabras)\`; una cifra, 1,2 s después de terminar de contar; un diagrama, código o gráfico, de 1,5 a 2,5 s. No retires un texto antes de que se pueda leer.
- Primer movimiento entre 0,1 y 0,3 s después del corte; el elemento principal visible antes de 0,5 s. Entradas de 0,3 a 0,6 s; salidas del 60 al 80 % de la entrada; conteos de 1,2 a 2,5 s.
- Escalonado por importancia: letras 15–25 ms, palabras 30–60 ms, elementos 60–100 ms; el grupo entero en 0,5 s como mucho; con más de unos 9 elementos, un solo barrido. Nunca tres o más textos apareciendo en el mismo fotograma.
- Curva por defecto: salida fuerte (\`power3.out\`); el sobreimpulso, solo en registro desenfadado y nunca en bloques de texto ni en contadores. Anima solo transformaciones, opacidad, filtro y clip-path; entra desde una escala de 0,94–0,98 o con un desplazamiento de 16–40 px.
- Nada se queda quieto más de unos 2 s: una respiración del 1–2 % o un empuje de cámara de 1,00 a 1,04–1,08 a lo largo del plano (5–7 % en texto solo, 7–8 % sobre fondo oscuro). Como mucho, un movimiento de cámara por frase musical.
- Tamaños: titulares de al menos un 7 % de la altura; cuerpo de al menos 36 px a 1080p en horizontal y 48 px en vertical. Contraste de 4,5:1 como mínimo.
- Transiciones: una principal en el 60–70 % de los cortes (los cortes secos cuentan) más uno o dos acentos; nunca a mitad de frase de la voz, sino en la pausa entre frases; una sola dirección para empujes y deslizamientos; nada de más de tres destellos por segundo.
- Sonido: un efecto por evento visual que importa (en un vídeo explicativo, de 1 a 3 en total), siempre de la misma familia y sin sonidos de videojuego en vídeos serios; el golpe visual llega 1–2 fotogramas antes que el sonido o el pulso, y el sonido nunca va más de 2 fotogramas por detrás de la imagen.

Puedes animar con intención: cortes y recortes de vídeo del usuario, cambios de velocidad, zoom y paneo, texto cinético sincronizado con las palabras, formas y trazados SVG, gráficos, máscaras, desenfoques, partículas con semilla, transiciones internas y efectos de sonido. Evita parecer una diapositiva.
`;
  const hf=`
## HyperFrames (HTML + GSAP)

- Composición principal: \`index.html\`. El elemento raíz conserva \`data-composition-id="main" data-start="0" data-duration="${brief.durationSeconds}" data-width="${brief.width}" data-height="${brief.height}"\`.
- Registra una única timeline pausada en \`window.__timelines.main\`. GSAP está en \`gsap.min.js\` y sus plugins en \`vendor/gsap/\` (${GSAP_PLUGINS.join(', ')}): cárgalos con \`<script src>\` y regístralos con \`gsap.registerPlugin\`.
- Vídeo y audio del usuario: \`<video>\`/\`<audio>\` con \`id\`, \`class="clip"\`, \`data-start\`, \`data-duration\`, \`data-media-start\` (recorte), \`data-playback-rate\`, \`data-volume\` y \`muted\` o \`data-has-audio="true"\`. Nunca llames a play() ni cambies currentTime.
- Antes de construir un efecto a mano, busca en el catálogo (\`hyperframes_catalog\`) y añádelo con \`hyperframes_add\`.
- **3D y acabado casi realista.** HyperFrames renderiza WebGL: usa Three.js para objetos y escenas 3D, cámaras con movimiento, materiales físicos (\`MeshPhysicalMaterial\`: metal, vidrio, transmisión, clearcoat), iluminación de estudio con \`RoomEnvironment\` + \`PMREMGenerator\`, sombras suaves, niebla, partículas con semilla, shaders y posprocesado (bloom, profundidad de campo, grano) con \`EffectComposer\`. Está en local, sin CDN: declara el importmap \`{"imports":{"three":"./vendor/three/three.module.min.js","three/addons/":"./vendor/three/addons/"}}\` y usa \`<script type="module">import * as THREE from "three"\`. Addons en \`vendor/three/addons/\` (postprocessing, shaders, environments, geometries, utils, math, objects, lines, curves, modifiers y los loaders GLTF, SVG, OBJ, STL, RGBE/HDR y de fuentes); tipografías 3D en \`vendor/three/fonts/\` (para \`TextGeometry\`).
- Contrato 3D (adaptador \`three\`; lee \`hyperframes-animation/adapters/three.md\` y, para pasar HTML a texturas, \`html-in-canvas-patterns.md\`): renderiza desde el tiempo de HyperFrames escuchando el evento \`hf-seek\` (\`event.detail.time\`, y \`window.__hfThreeTime\` al iniciar). Nunca uses \`requestAnimationFrame\`, \`setAnimationLoop\` ni \`Math.random\` (usa una semilla propia). Fija \`renderer.setPixelRatio(1)\` y el tamaño del lienzo, y carga modelos y texturas antes de buscar fotogramas. Combina la capa 3D con HTML/GSAP (rótulos y subtítulos encima) y reserva el 3D para los momentos que lo merecen.
- Lottie (animaciones vectoriales de After Effects): \`vendor/lottie/lottie.min.js\`, controlada desde la timeline (\`goToAndStop\`), con los JSON en \`assets/\`.
- Documentación oficial (léela según lo que necesites): \`${relative(root,path.join(vendorSkills,'hyperframes'))}\` dentro del estudio, ruta absoluta \`${path.join(vendorSkills,'hyperframes')}\`. Empieza por \`hyperframes-core/SKILL.md\`; para movimiento \`hyperframes-animation\` y \`hyperframes-keyframes\`; para estética \`hyperframes-creative\`; para sonido \`hyperframes-audio\`; para subtítulos \`embedded-captions\`; para editar material \`talking-head-recut\`, \`general-video\` y \`music-to-video\`.
`;
  const remotion=`
## Remotion (React)

- Escena principal: \`Scene.tsx\` con \`export default function Scene()\`. Lumen registra la composición con la duración, tamaño y fps indicados; no uses \`<Composition>\` ni \`registerRoot\`.
- Usa \`useCurrentFrame()\`, \`useVideoConfig()\`, \`interpolate\`, \`spring\`, \`<Sequence>\`, \`<Series>\` y \`random(semilla)\`.
- Material: \`staticFile('media/<archivo>')\` y \`staticFile('sfx/whoosh.wav')\` (la carpeta pública es \`assets/\`). Inter y DM Sans (400 y 700) ya están cargadas: usa \`fontFamily: 'Inter'\` o \`'DM Sans'\` sin importar nada.
- Vídeo y audio: \`import {Video, Audio} from '@remotion/media'\` con \`trimBefore\`, \`playbackRate\`, \`volume\` (puede ser una función por fotograma), recortes y \`objectFit\`. Imágenes con \`<Img>\` de remotion.
- Paquetes permitidos: ${REMOTION_IMPORTS.join(', ')}. Destacan @remotion/transitions (TransitionSeries), @remotion/effects (etalonaje, LUT, croma, desenfoques, grano…), @remotion/light-leaks, @remotion/shapes, @remotion/paths (evolvePath, interpolatePath), @remotion/noise, @remotion/motion-blur, @remotion/rough-notation, @remotion/layout-utils (fitText, measureText) y @remotion/captions.
- Los efectos WebGL se procesan lentamente en este equipo: úsalos con moderación.
- **3D en Remotion.** Usa \`@remotion/three\` (\`<ThreeCanvas width height>\`, obligatorio) con React Three Fiber (\`@react-three/fiber\`) y Three.js (\`three\`, addons en \`three/examples/jsm/...\`). Anima siempre desde \`useCurrentFrame()\`: nunca uses \`useFrame\` ni relojes propios. Para metal y vidrio realistas, da a la escena un entorno de reflejos: \`RoomEnvironment\` con \`PMREMGenerator\` (\`scene.environment\`, creado una vez con \`useThree\`). Sin entorno, el metal se ve negro. Usa \`meshPhysicalMaterial\` (metalness, roughness, clearcoat, transmission), sombras, niebla y cámaras en movimiento. Para modelos \`.glb\` de la biblioteca (\`staticFile('models/<archivo>.glb')\`), usa \`useLoader(GLTFLoader, url)\` dentro de \`<Suspense>\`. Lee \`remotion-markup/3d.md\`. El 3D se renderiza en el procesador: resérvalo para los momentos que lo merecen.
- Documentación oficial: \`${path.join(vendorSkills,'remotion')}\` (empieza por \`remotion-best-practices/SKILL.md\` y \`remotion-markup/SKILL.md\`; reglas por tema en sus archivos .md).
`;
  const latexNote=latexAvailable()?'LaTeX disponible (TinyTeX): MathTex, Tex, Matrix, DecimalNumber y los números de los ejes funcionan; úsalos para fórmulas y transformaciones entre ecuaciones (TransformMatchingTex).':'Sin LaTeX en este equipo: MathTex, Tex y Matrix no funcionan; escribe fórmulas y números con Text o MarkupText (DecimalNumber(..., mob_class=Text), ejes con números de Text). Para fórmulas complejas, mejor una escena Revideo con Latex.';
  const manim=`
## Manim (Python, Manim Community)

- Escena principal: \`scene.py\` con \`class LumenScene(Scene)\`. Lumen la renderiza con el tamaño y los fps del vídeo; la suma de \`run_time\` y \`wait\` debe dar exactamente ${brief.durationSeconds} s (si no, Lumen congela o recorta el final).
- Identidad: \`from lumen.tokens import TOKENS\` (colores, fuente, tamaño, fps, zona de subtítulos). Fuentes del sistema: \`Segoe UI\` para texto y \`Consolas\` para código.
- Seguridad: solo puedes importar \`manim\`, \`numpy\` y módulos matemáticos (\`math\`, \`random\` con \`random.seed(...)\`, \`itertools\`, \`colorsys\`…) y los componentes del kit (\`from kit.components.x import Y\`). Nada de archivos, sistema, red, \`eval\`, \`getattr\` ni atributos \`__dunder__\`; tampoco cambies \`config\`. Lumen lo comprueba antes de ejecutar.
- ${'${'}LATEX${'}'}
- Material: \`ImageMobject("assets/media/<archivo>.png")\` y \`SVGMobject("assets/media/<archivo>.svg")\`; Manim no reproduce vídeo: deja los clips del usuario para otros motores.
- Puntos fuertes: geometría, ejes y gráficas (\`Axes\`, \`NumberPlane\`, \`plot\`), transformaciones entre formas (\`Transform\`, \`ReplacementTransform\`, \`TransformMatchingShapes\`), construcción paso a paso (\`Create\`, \`Write\`, \`LaggedStart\`, \`Succession\`), cálculo binario, árboles y redes (\`Graph\`), flechas y llaves.
- Documentación: docs.manim.community (la API de Manim CE 0.21); \`scene_check\` renderiza la escena y \`scene_snapshot\` saca fotogramas reales para revisarla.
`;
  const revideo=`
## Revideo (TypeScript en canvas)

- Escena principal: \`src/scene.tsx\` con \`export default makeScene2D('scene', function* (view) {...})\`. \`src/project.ts\` lo genera Lumen (tamaño, fps y fondo): no lo edites. La suma de animaciones y \`waitFor\` debe dar exactamente ${brief.durationSeconds} s.
- Paquetes permitidos: \`@revideo/2d\` (Txt, Rect, Circle, Line, Layout, Img, Code, Latex, Spline, Path, Grid…) y \`@revideo/core\` (createRef, all, sequence, chain, loop, waitFor, waitUntil, easing, tween, useRandom con semilla). Identidad en \`../lumen/tokens.ts\` (impórtalo con la extensión .ts: en la carpeta hay también un tokens.js para HTML; colores, tipografía, duraciones y curvas). Componentes del kit: \`../kit/components/...\`.
- Tiempo explícito: cada \`yield*\` avanza el reloj; usa \`all(...)\` para animar a la vez, \`sequence(0.08, ...)\` para escalonar y \`chain(...)\` para encadenar. Nada de \`Math.random\`, temporizadores ni red.
- Puntos fuertes: animación de código con diferencias (\`Code\` con \`code.edit\`/\`selection\`), fórmulas con \`Latex\` (MathJax incluido, sin instalar nada), diagramas vectoriales que se construyen por pasos y layouts con flexbox (\`Layout\`).
- Material: \`<Img src={'/assets/media/<archivo>.png'}/>\`. Fuentes del sistema (\`Segoe UI\`, \`Consolas\`).
- Documentación: docs.re.video; \`scene_check\` renderiza la escena y \`scene_snapshot\` saca fotogramas reales.
`;
  return shared+({hyperframes:hf,remotion,manim,revideo}[engine]||remotion);
}

function hyperframesScaffold(brief){
  const font=brief.profile.font==='DM Sans'?'DM Sans':'Inter',palette={background:'#111b31',ink:'#f5f8ff',accent:'#65dacf',card:'#1d2b45',...brief.profile.palette};
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<style>
  @font-face{font-family:Inter;font-weight:400;src:url('assets/fonts/inter-400.woff2')}
  @font-face{font-family:Inter;font-weight:700;src:url('assets/fonts/inter-700.woff2')}
  @font-face{font-family:'DM Sans';font-weight:400;src:url('assets/fonts/dm-sans-400.woff2')}
  @font-face{font-family:'DM Sans';font-weight:700;src:url('assets/fonts/dm-sans-700.woff2')}
  :root{--background:${palette.background};--ink:${palette.ink};--accent:${palette.accent};--card:${palette.card}}
  html,body{margin:0;width:${brief.width}px;height:${brief.height}px;overflow:hidden;background:var(--background)}
  #root{position:relative;width:${brief.width}px;height:${brief.height}px;overflow:hidden;font-family:'${font}',sans-serif;color:var(--ink)}
  #title{position:absolute;left:8%;right:8%;top:40%;margin:0;font-size:${Math.round(brief.height*0.09)}px;line-height:1.1;font-weight:700}
</style>
<script src="gsap.min.js"></script>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${brief.durationSeconds}" data-width="${brief.width}" data-height="${brief.height}">
  <h1 id="title">${brief.title.replace(/[&<>]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[char]))}</h1>
</div>
<script>
  const tl=gsap.timeline({paused:true});
  tl.fromTo('#title',{y:40,opacity:0},{y:0,opacity:1,duration:0.8,ease:'power3.out'},0.2);
  tl.to('#title',{opacity:1,duration:${Math.max(0.1,brief.durationSeconds-1)}},1);
  window.__timelines=window.__timelines||{};window.__timelines.main=tl;
</script>
</body>
</html>
`;
}
function remotionScaffold(brief){
  const palette={background:'#111b31',ink:'#f5f8ff',accent:'#65dacf',...brief.profile.palette};
  return `import React from 'react';
import {AbsoluteFill,interpolate,spring,useCurrentFrame,useVideoConfig} from 'remotion';

export default function Scene() {
  const frame=useCurrentFrame();
  const {fps}=useVideoConfig();
  const enter=spring({frame:frame-6,fps,config:{damping:200}});
  return (
    <AbsoluteFill style={{background:'${palette.background}',color:'${palette.ink}',fontFamily:'${brief.profile.font==='DM Sans'?'DM Sans':'Inter'}, sans-serif',justifyContent:'center',padding:'0 8%'}}>
      <h1 style={{fontSize:${Math.round(brief.height*0.09)},margin:0,opacity:enter,transform:\`translateY(\${interpolate(enter,[0,1],[40,0])}px)\`}}>${JSON.stringify(brief.title).slice(1,-1)}</h1>
    </AbsoluteFill>
  );
}
`;
}

export async function prepareWorkspace(project,scene,media,folder){
  const engine=scene.engine,dir=workspaceDir(folder,scene.id);await mkdir(path.join(dir,'lumen'),{recursive:true});
  const brief=sceneBrief(project,scene,media);
  await place(path.join(folder,media.audioPath),path.join(dir,'assets','voice.wav')).catch(async()=>{await copyFile(path.join(folder,media.audioPath),path.join(dir,'assets','voice.wav'));});
  if(await exists(path.join(dir,'assets','voice.wav'))&&sha(await readFile(path.join(dir,'assets','voice.wav')))!==sha(await readFile(path.join(folder,media.audioPath)))){await rm(path.join(dir,'assets','voice.wav'));await place(path.join(folder,media.audioPath),path.join(dir,'assets','voice.wav'));}
  if(media.logoPath)await place(path.join(folder,media.logoPath),path.join(dir,brief.profile.logo));
  for(const file of await readdir(path.join(root,'assets','sfx')))await place(path.join(root,'assets','sfx',file),path.join(dir,'assets','sfx',file));
  for(const [pkg,,weights] of FONTS)for(const weight of weights){const source=path.join(root,'node_modules/@fontsource',pkg,'files',`${pkg}-latin-${weight}-normal.woff2`);if(await exists(source))await place(source,path.join(dir,'assets','fonts',`${pkg}-${weight}.woff2`));}
  const catalog=await mediaCatalog(project,folder,dir);
  await writeFile(path.join(dir,'lumen','scene.json'),JSON.stringify(brief,null,2));
  const tokens=motionTokens(brief);
  await writeFile(path.join(dir,'lumen','tokens.css'),tokensCss(tokens));await writeFile(path.join(dir,'lumen','tokens.js'),tokensJs(tokens));await writeFile(path.join(dir,'lumen','tokens.ts'),tokensTs(tokens));
  await writeFile(path.join(dir,'lumen','zoom.js'),ZOOM_JS);await writeFile(path.join(dir,'lumen','zoom.ts'),ZOOM_TS);
  await writeFile(path.join(dir,'lumen','media.json'),JSON.stringify({note:'Material del proyecto copiado en assets/media. Usa media_info para planos, frases transcritas, silencios y clics; media_frames para ver fotogramas concretos.',media:catalog},null,2));
  const guide=agentGuide(engine,brief);await writeFile(path.join(dir,'AGENTS.md'),guide);await writeFile(path.join(dir,'CLAUDE.md'),guide);
  if(engine==='hyperframes'){
    await place(path.join(root,'node_modules/gsap/dist/gsap.min.js'),path.join(dir,'gsap.min.js'));const vendor=['gsap.min.js'];
    for(const plugin of GSAP_PLUGINS){const source=path.join(root,'node_modules/gsap/dist',plugin+'.min.js');if(await exists(source)){await place(source,path.join(dir,'vendor','gsap',plugin+'.min.js'));vendor.push('vendor/gsap/'+plugin+'.min.js');}}
    for(const [from,to] of await threeVendorFiles()){await place(path.join(root,'node_modules','three',from),path.join(dir,'vendor','three',to));vendor.push('vendor/three/'+to);}
    {const lottie=path.join(root,'node_modules','lottie-web','build','player','lottie.min.js');if(await exists(lottie)){await place(lottie,path.join(dir,'vendor','lottie','lottie.min.js'));vendor.push('vendor/lottie/lottie.min.js');}}
    await trustFiles(dir,vendor);
    if(!await exists(path.join(dir,'index.html')))await writeFile(path.join(dir,'index.html'),hyperframesScaffold(brief));
  }else if(isAdapterEngine(engine))await prepareEngine(engine,dir,brief);
  else if(!await exists(path.join(dir,'Scene.tsx'))&&!await exists(path.join(dir,'Scene.jsx')))await writeFile(path.join(dir,'Scene.tsx'),remotionScaffold(brief));
  return {dir,brief,catalog};
}

// ---------- Historial de fuentes ----------
export async function snapshotSources(dir,label){
  const files=await sourceFiles(dir);if(!files.length)return null;
  const hash=await sourceHash(dir),history=path.join(dir,'.history'),existing=await listHistory(dir);
  if(existing[0]?.hash===hash)return existing[0];
  const id=`${Date.now()}-${hash.slice(0,8)}`,target=path.join(history,id);
  for(const file of files){await mkdir(path.dirname(path.join(target,file)),{recursive:true});await copyFile(path.join(dir,file),path.join(target,file));}
  await writeFile(path.join(target,'.meta.json'),JSON.stringify({id,label:String(label).slice(0,200),hash,files,at:new Date().toISOString()}));
  const all=await listHistory(dir);for(const old of all.slice(40))await rm(path.join(history,old.id),{recursive:true,force:true});
  return {id,label,hash,files,at:new Date().toISOString()};
}
export async function listHistory(dir){
  const history=path.join(dir,'.history');let names=[];try{names=await readdir(history);}catch{return [];}
  const items=[];for(const name of names){try{items.push(JSON.parse(await readFile(path.join(history,name,'.meta.json'),'utf8')));}catch{}}
  return items.sort((a,b)=>b.id.localeCompare(a.id));
}
export async function restoreHistory(dir,id){
  const target=path.join(dir,'.history',id);if(!/^[0-9]+-[a-f0-9]{8}$/.test(id)||!await exists(target))throw new Error('Versión de código inexistente.');
  await snapshotSources(dir,'Antes de restaurar');
  for(const file of await sourceFiles(dir))await rm(path.join(dir,file),{force:true});
  const meta=JSON.parse(await readFile(path.join(target,'.meta.json'),'utf8'));
  for(const file of meta.files){await mkdir(path.dirname(path.join(dir,file)),{recursive:true});await copyFile(path.join(target,file),path.join(dir,file));}
  return meta;
}

// ---------- Validación ----------
const parseJson=text=>{const start=text.indexOf('{');if(start<0)return null;try{return JSON.parse(text.slice(start));}catch{return null;}};
async function remotionEntry(dir,brief){
  const scene=await exists(path.join(dir,'Scene.tsx'))?'Scene.tsx':await exists(path.join(dir,'Scene.jsx'))?'Scene.jsx':null;
  if(!scene)throw new Error('Falta Scene.tsx con export default.');
  const frames=Math.max(1,Math.round(brief.durationSeconds*brief.fps));
  await mkdir(path.join(dir,'.lumen'),{recursive:true});
  const entry=path.join(dir,'.lumen','entry.jsx');
  await writeFile(entry,`import React from 'react';\nimport {registerRoot,Composition} from 'remotion';\nimport '@fontsource/inter/latin-400.css';\nimport '@fontsource/inter/latin-700.css';\nimport '@fontsource/dm-sans/400.css';\nimport '@fontsource/dm-sans/700.css';\nimport Scene from '../${scene}';\nconst Root=()=><Composition id="Scene" component={Scene} durationInFrames={${frames}} fps={${brief.fps}} width={${brief.width}} height={${brief.height}} defaultProps={{}}/>;\nregisterRoot(Root);\n`);
  return {entry,scene,frames};
}
async function compileCheck(dir){
  const {transform}=await import('esbuild');const errors=[];
  for(const file of (await sourceFiles(dir)).filter(file=>/\.(tsx?|jsx?|mjs)$/.test(file))){
    try{await transform(await readFile(path.join(dir,file),'utf8'),{loader:file.endsWith('.tsx')?'tsx':file.endsWith('.ts')?'ts':'jsx',jsx:'automatic',sourcefile:file});}
    catch(error){for(const item of error.errors||[{text:error.message}])errors.push({file,line:item.location?.line||1,rule:'syntax',severity:'error',message:item.text});}
  }
  const main=await exists(path.join(dir,'Scene.tsx'))?'Scene.tsx':'Scene.jsx';
  if(await exists(path.join(dir,main))&&!/export\s+default/.test(await readFile(path.join(dir,main),'utf8')))errors.push({file:main,line:1,rule:'export',severity:'error',message:'Scene debe tener export default.'});
  return errors;
}
export async function lintScene(dir,brief,signal){
  const errors=[],warnings=[];
  const security=await scanSources(dir,brief.engine);errors.push(...security);
  if(brief.engine==='hyperframes'){
    const html=await readFile(path.join(dir,'index.html'),'utf8').catch(()=>null);
    if(!html)errors.push({file:'index.html',line:1,rule:'missing',severity:'error',message:'Falta index.html.'});
    else{
      const rootTag=/<[^>]+data-composition-id=["']main["'][^>]*>/.exec(html)?.[0]||'';const attribute=name=>Number(new RegExp(`${name}=["']([\\d.]+)["']`).exec(rootTag)?.[1]);
      if(!rootTag)errors.push({file:'index.html',line:1,rule:'root',severity:'error',message:'Falta el elemento raíz con data-composition-id="main".'});
      else{if(Math.abs(attribute('data-duration')-brief.durationSeconds)>0.05)errors.push({file:'index.html',line:1,rule:'duration',severity:'error',message:`data-duration del raíz debe ser ${brief.durationSeconds}.`});if(attribute('data-width')!==brief.width||attribute('data-height')!==brief.height)errors.push({file:'index.html',line:1,rule:'size',severity:'error',message:`El raíz debe medir ${brief.width}x${brief.height}.`});}
      if(!security.length){
        const result=await runHyperframes(['lint',dir,'--json'],{signal,timeout:120000});const data=parseJson(result.stdout);
        for(const finding of data?.findings||[])(finding.severity==='error'?errors:warnings).push({file:finding.file?relative(dir,finding.file):'index.html',line:finding.line||1,rule:finding.code,severity:finding.severity,message:finding.message,fix:finding.fixHint||null});
        if(!data&&result.code!==0)errors.push({file:'index.html',line:1,rule:'hyperframes-lint',severity:'error',message:(result.stderr||result.stdout).slice(-600)});
      }
    }
  }else if(isAdapterEngine(brief.engine)){if(!security.length){const result=await lintEngine(brief.engine,dir,brief);errors.push(...result.errors);warnings.push(...result.warnings);}}
  else{
    try{await remotionEntry(dir,brief);}catch(error){errors.push({file:'Scene.tsx',line:1,rule:'missing',severity:'error',message:error.message});}
    if(!errors.length)errors.push(...await compileCheck(dir));
  }
  const report={ok:!errors.length,errors,warnings,checkedAt:new Date().toISOString()};
  await writeFile(path.join(dir,'lint.json'),JSON.stringify(report,null,2));return report;
}

const bundles=new Map();
async function remotionBundle(dir,brief,signal){
  const {entry}=await remotionEntry(dir,brief),hash=await sourceHash(dir),key=dir+hash+brief.durationSeconds+brief.width+brief.fps;
  if(!bundles.has(key)){
    const {bundle}=await import('@remotion/bundler');
    bundles.set(key,bundle({entryPoint:entry,publicDir:path.join(dir,'assets'),outDir:path.join(dir,'.lumen','bundle-'+hash),webpackOverride:config=>({...config,resolve:{...config.resolve,modules:[...(config.resolve?.modules||['node_modules']),path.join(root,'node_modules')]},resolveLoader:{...config.resolveLoader,modules:[...(config.resolveLoader?.modules||['node_modules']),path.join(root,'node_modules')]}})}).catch(error=>{bundles.delete(key);throw error;}));
  }
  signal?.throwIfAborted();return bundles.get(key);
}

// Un navegador por operación: evita abrir y cerrar Chrome en cada fotograma.
async function withBrowser(fn){const {openBrowser}=await import('@remotion/renderer');const browser=await openBrowser('chrome');try{return await fn(browser);}finally{await browser.close({silent:true}).catch(()=>{});}}
// Verificación completa: lint, comprobación del motor y, si pasan, inspección temporal en el navegador
// (tiempos de lectura, contraste real, tamaño en móvil, solapes, planos quietos). La inspección avisa, no bloquea.
export async function checkScene(dir,brief,signal,{inspect=true}={}){
  const report=await checkSceneBase(dir,brief,signal);if(!report.ok||!inspect||isAdapterEngine(brief.engine)||process.env.LUMEN_SKIP_INSPECT)return report;
  try{const {inspectScene}=await import('./inspect.mjs');const result=await inspectScene(dir,brief,{signal});
    report.inspect={warnings:result.warnings,crops:result.crops.map(crop=>({...crop,path:path.relative(dir,crop.path).split(path.sep).join('/')})),texts:result.texts};
    for(const warning of result.warnings)report.issues.push({section:'inspect',severity:warning.rule==='runtime_error'?'warning':warning.severity==='error'?'warning':warning.severity,rule:warning.rule,message:warning.message,time:warning.time,fix:null});
  }catch(error){if(signal?.aborted)throw error;report.inspect={error:error.message.slice(0,300)};}
  await writeFile(path.join(dir,'check.json'),JSON.stringify(report,null,2));return report;
}
async function checkSceneBase(dir,brief,signal){
  const lint=await lintScene(dir,brief,signal);if(!lint.ok)return {ok:false,stage:'lint',lint,issues:lint.errors};
  if(isAdapterEngine(brief.engine)){const result=await checkEngine(brief.engine,dir,brief,signal);const report={ok:result.ok&&!result.issues.some(issue=>issue.severity==='error'),stage:'check',lint,issues:result.issues,samples:[]};await writeFile(path.join(dir,'check.json'),JSON.stringify(report,null,2));return report;}
  if(brief.engine==='hyperframes'){
    const result=await runHyperframes(['check',dir,'--json','--at-transitions','--max-issues','40'],{signal,timeout:600000});const data=parseJson(result.stdout);
    if(!data)return {ok:false,stage:'check',lint,issues:[{severity:'error',rule:'hyperframes-check',message:(result.stderr||result.stdout).slice(-800)}]};
    const issues=[];for(const section of ['runtime','layout','motion','contrast'])for(const finding of data[section]?.findings||[])issues.push({section,severity:finding.severity,rule:finding.code||finding.rule||section,message:finding.message,selector:finding.selector||null,time:finding.time??null,fix:finding.fixHint||null});
    const report={ok:data.ok!==false&&!issues.some(issue=>issue.severity==='error'),stage:'check',lint,issues,samples:data.layout?.samples||[]};await writeFile(path.join(dir,'check.json'),JSON.stringify(report,null,2));return report;
  }
  try{
    const serveUrl=await remotionBundle(dir,brief,signal);const {selectComposition,renderStill}=await import('@remotion/renderer');
    const frames=await withBrowser(async puppeteerInstance=>{const composition=await selectComposition({serveUrl,id:'Scene',inputProps:{},puppeteerInstance});const frames=[0,Math.floor(composition.durationInFrames/2),composition.durationInFrames-1];
    await mkdir(path.join(dir,'.lumen'),{recursive:true});
    for(const frame of frames)await renderStill({composition,serveUrl,frame,output:path.join(dir,'.lumen',`check-${frame}.png`),inputProps:{},puppeteerInstance});return frames;});
    const report={ok:true,stage:'check',lint,issues:[],samples:frames.map(frame=>frame/brief.fps)};await writeFile(path.join(dir,'check.json'),JSON.stringify(report,null,2));return report;
  }catch(error){const report={ok:false,stage:'check',lint,issues:[{severity:'error',rule:'remotion-runtime',message:error.message.slice(0,1500)}]};await writeFile(path.join(dir,'check.json'),JSON.stringify(report,null,2));return report;}
}

export async function snapshotScene(dir,brief,times,signal){
  const lint=await lintScene(dir,brief,signal);if(!lint.ok)throw new Error('Corrige el lint antes de capturar: '+lint.errors.slice(0,4).map(error=>`${error.file}:${error.line} ${error.message}`).join(' | '));
  const valid=[...new Set(times.filter(time=>Number.isFinite(time)&&time>=0&&time<=brief.durationSeconds).map(time=>Math.round(time*1000)/1000))].slice(0,12);
  if(!valid.length)valid.push(0.5,brief.durationSeconds/2,Math.max(0,brief.durationSeconds-0.2));
  const output=path.join(dir,'snapshots',String(Date.now()));await mkdir(output,{recursive:true});
  if(isAdapterEngine(brief.engine))return snapshotEngine(brief.engine,dir,brief,valid,output,signal);
  if(brief.engine==='hyperframes'){
    const result=await runHyperframes(['snapshot',dir,'--at',valid.join(','),'--no-end','-o',output,'--describe','false'],{signal,timeout:600000});
    const files=(await readdir(output).catch(()=>[])).filter(file=>file.endsWith('.png')).sort();
    if(!files.length)throw new Error('HyperFrames no generó capturas: '+(result.stderr||result.stdout).slice(-800));
    return files.map((file,index)=>({time:valid[index]??null,path:path.join(output,file)}));
  }
  const serveUrl=await remotionBundle(dir,brief,signal);const {selectComposition,renderStill}=await import('@remotion/renderer');
  return withBrowser(async puppeteerInstance=>{const composition=await selectComposition({serveUrl,id:'Scene',inputProps:{},puppeteerInstance});const result=[];
  for(const time of valid){const frame=Math.min(composition.durationInFrames-1,Math.round(time*brief.fps)),file=path.join(output,`frame-at-${time}s.png`);await renderStill({composition,serveUrl,frame,output:file,inputProps:{},puppeteerInstance});result.push({time,path:file});}
  return result;});
}

// ---------- Render del segmento ----------
async function hasAudioStream(file){return (await probeMedia(file)).hasAudio;}
// Añade la narración y normaliza el audio del segmento (48 kHz estéreo) para el montaje final.
export async function muxVoice(video,voice,duration,output,signal){
  const withAudio=await hasAudioStream(video);
  const filter=withAudio?`[0:a]aresample=48000,aformat=channel_layouts=stereo[s];[1:a]aresample=48000,aformat=channel_layouts=stereo,apad[v];[s][v]amix=inputs=2:duration=first:normalize=0,atrim=0:${duration}[a]`:`[1:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:${duration}[a]`;
  const result=await execute(ffmpeg,['-y','-v','error','-i',video,'-i',voice,'-filter_complex',filter,'-map','0:v','-map','[a]','-c:v','copy','-c:a','aac','-b:a','192k','-t',String(duration),'-movflags','+faststart',output],{signal,timeout:600000});
  if(result.code!==0)throw new Error('No se pudo mezclar la narración: '+result.stderr.slice(-600));
}

export async function renderCodeScene(project,scene,media,folder,output,signal,onProgress=()=>{}){
  const dir=workspaceDir(folder,scene.id),brief=sceneBrief(project,scene,media);
  const lint=await lintScene(dir,brief,signal);if(!lint.ok)throw new Error(`La escena ${scene.id} no supera el lint: `+lint.errors.slice(0,5).map(error=>`${error.file}:${error.line} ${error.message}`).join(' | '));
  const temp=path.join(path.dirname(output),'raw-'+randomUUID().slice(0,8)+'.mp4');
  try{
    if(scene.engine==='hyperframes'){
      const result=await runHyperframes(['render',dir,'--output',temp,'--fps',String(brief.fps),'--workers','1','--quality','standard','--low-memory-mode','--json'],{signal,timeout:3600000,onLine:line=>{const match=/(\d+)%/.exec(line);if(match)onProgress(Number(match[1]));}});
      if(result.code!==0||!await exists(temp))throw new Error('HyperFrames no completó el render: '+(result.stderr||result.stdout).slice(-1500));
    }else if(isAdapterEngine(scene.engine)){await renderEngine(scene.engine,dir,brief,temp,signal);onProgress(100);
    }else{
      const serveUrl=await remotionBundle(dir,brief,signal);const {selectComposition,renderMedia,makeCancelSignal}=await import('@remotion/renderer');
      await withBrowser(async puppeteerInstance=>{const composition=await selectComposition({serveUrl,id:'Scene',inputProps:{},puppeteerInstance});const {cancelSignal,cancel}=makeCancelSignal();const abort=()=>cancel();signal.addEventListener('abort',abort,{once:true});
      try{await renderMedia({composition,serveUrl,codec:'h264',outputLocation:temp,inputProps:{},concurrency:2,crf:20,cancelSignal,puppeteerInstance,onProgress:({progress})=>onProgress(Math.round(progress*100))});}finally{signal.removeEventListener('abort',abort);}});
    }
    await muxVoice(temp,path.join(folder,media.audioPath),brief.durationSeconds,output,signal);
  }finally{await rm(temp,{force:true});}
  return {engine:scene.engine,sourceHash:await sourceHash(dir)};
}

// ---------- Autor de demostración (sin modelo) ----------
export async function demoAuthor(dir,brief){
  if(isAdapterEngine(brief.engine)){await prepareEngine(brief.engine,dir,brief);return [ENGINE_INFO[brief.engine].main];}
  if(brief.engine==='hyperframes'){
    const items=brief.points.map((point,index)=>`<div class="point" id="p${index}"><span>${String(index+1).padStart(2,'0')}</span>${point.replace(/[&<>]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[char]))}</div>`).join('\n    ');
    const html=hyperframesScaffold(brief).replace('</style>',`  #points{position:absolute;left:8%;right:8%;top:58%;display:flex;gap:18px}\n  .point{flex:1;background:var(--card);border-radius:18px;padding:18px;font-size:${Math.round(brief.height*0.032)}px;line-height:1.3}\n  .point span{display:block;color:var(--accent);font-size:0.7em;margin-bottom:6px}\n  #title{top:22%}\n</style>`).replace('</h1>',`</h1>\n  <div id="points">\n    ${items}\n  </div>`).replace("window.__timelines",`${brief.points.map((_,index)=>`tl.fromTo('#p${index}',{y:30,opacity:0},{y:0,opacity:1,duration:0.6,ease:'power2.out'},${(0.9+index*0.35).toFixed(2)});`).join('\n  ')}\n  window.__timelines`);
    await writeFile(path.join(dir,'index.html'),html);return ['index.html'];
  }
  await writeFile(path.join(dir,'Scene.tsx'),remotionScaffold(brief));return ['Scene.tsx'];
}


// Escribe a mano un archivo fuente del espacio (escena o kit): solo fuentes, nunca material, librerías ni historial.
export async function writeSourceFile(dir,file,content){
  const clean=String(file||'').replaceAll('\\','/').replace(/^\/+/,'');
  const target=path.resolve(dir,clean),rel=relative(dir,target),first=rel.split('/')[0];
  if(!rel||rel.startsWith('..')||path.isAbsolute(rel)||GENERATED.has(first)||first==='lumen'||first==='vendor'||rel==='gsap.min.js'||IGNORED_SOURCES.has(rel))throw new Error('Ese archivo no se puede editar a mano.');
  if(!SOURCE_EXTENSIONS.has(path.extname(rel).toLowerCase()))throw new Error('Solo se pueden editar archivos de código o texto.');
  if(typeof content!=='string'||content.length>400000)throw new Error('Contenido inválido o mayor de 400 KB.');
  await snapshotSources(dir,'Antes de editar a mano '+rel);
  await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content);
  return rel;
}

// ---------- Textos en pantalla editables sin el agente (idea de html-video) ----------
// Candidatos: texto entre etiquetas (HTML/JSX) y cadenas con letras y espacios (JS, TS y Python), sin rutas,
// colores, importaciones ni CSS. La edición sustituye el texto exacto en los archivos fuente.
const TEXT_SKIP=/^(#|\.{0,2}\/|https?:|data:|[a-z-]+:\s*[^ ]+;|@|[\w-]+\.(png|jpe?g|svg|webp|mp4|webm|wav|mp3|glb|json|css|js|ts|tsx|py|html)$)/i;
function textCandidates(source,ext){
  const found=[];const push=(text,index)=>{const value=text.replace(/\s+/g,' ').trim();if(value.length<2||value.length>200||!/[A-Za-zÀ-ÿ]/.test(value)||TEXT_SKIP.test(value)||/^[\w$.-]+$/.test(value)&&!/[A-ZÀ-Ý]/.test(value[0])&&!/\s/.test(value))return;found.push({text:value,raw:text,line:source.slice(0,index).split('\n').length});};
  if(['.html','.htm','.jsx','.tsx'].includes(ext))for(const match of source.matchAll(/>([^<>{}]*[A-Za-zÀ-ÿ][^<>{}]*)</g))push(match[1],match.index);
  if(['.js','.mjs','.jsx','.ts','.tsx','.py'].includes(ext))for(const match of source.matchAll(/(["'])((?:(?!\1)[^\\\n]){2,200})\1/g)){const before=source.slice(Math.max(0,match.index-30),match.index);if(/(import|from|require\(|className|class|fontFamily|font_family|font|fontWeight|src|href|ref|key|id|fill|stroke|color|background|stroke_color|fill_color|easing|ease)\s*[=:]?\s*\{?\s*$/.test(before)||/\bimport\s[^;\n]*$/.test(before))continue;if(!/\s/.test(match[2])&&!/[À-ÿ]/.test(match[2]))continue;push(match[2],match.index);}
  return found;
}
export async function sceneTexts(dir){
  const result=new Map();
  for(const file of await sourceFiles(dir)){const ext=path.extname(file).toLowerCase();if(!['.html','.htm','.js','.mjs','.jsx','.ts','.tsx','.py'].includes(ext)||file.startsWith('vendor/')||file.startsWith('kit/')||file==='gsap.min.js'||file.startsWith('src/project'))continue;
    const source=await readFile(path.join(dir,file),'utf8');for(const item of textCandidates(source,ext)){const entry=result.get(item.text)||{text:item.text,occurrences:[]};entry.occurrences.push({file,line:item.line});result.set(item.text,entry);}}
  return [...result.values()].slice(0,80).map(item=>({text:item.text,count:item.occurrences.length,file:item.occurrences[0].file,line:item.occurrences[0].line}));
}
export async function replaceSceneText(dir,from,to,{all=false}={}){
  if(typeof from!=='string'||!from.trim()||typeof to!=='string'||to.length>500)throw new Error('Texto inválido.');
  if(/[<>{}`]/.test(to)||(/["']/.test(to)&&!/^[^"']*$/.test(from)))throw new Error('El texto nuevo no puede llevar < > { } ni comillas que rompan el código.');
  const targets=[];for(const file of await sourceFiles(dir)){if(file.startsWith('vendor/')||file.startsWith('kit/')||file==='gsap.min.js')continue;const ext=path.extname(file).toLowerCase();if(!['.html','.htm','.js','.mjs','.jsx','.ts','.tsx','.py'].includes(ext))continue;const source=await readFile(path.join(dir,file),'utf8'),count=source.split(from).length-1;if(count)targets.push({file,source,count});}
  const total=targets.reduce((sum,item)=>sum+item.count,0);if(!total)throw new Error('No se encuentra ese texto en el código de la escena.');
  if(total>1&&!all)throw new Error(`El texto aparece ${total} veces: marca «cambiar todas» o edítalo en el código.`);
  await snapshotSources(dir,`Antes de cambiar el texto «${from.slice(0,40)}»`);
  for(const item of targets)await writeFile(path.join(dir,item.file),item.source.split(from).join(to));
  return {replaced:total,files:targets.map(item=>item.file)};
}
