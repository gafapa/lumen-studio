// Adaptadores de motor para Manim (Python) y Revideo (TypeScript en canvas), con la misma interfaz que HyperFrames
// y Remotion: preparar el espacio, guía, lint (con análisis de seguridad), verificación, capturas y render.
// También el manifiesto de capacidades de los cuatro motores, que leen el storyboard y el diseñador del kit
// (idea de html-video: elegir motor por escena con criterios explícitos).
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile,readdir,rm,stat,copyFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import ffmpeg from 'ffmpeg-static';
import {execute} from './process.mjs';
import {probeMedia} from './media-index.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const python=process.env.LUMEN_PYTHON||path.join(root,'.tools','python','python.exe'),manimLauncher=path.join(root,'scripts','manim-run.py'),guard=path.join(root,'server','manim-guard.py');
const manimLib=process.env.LUMEN_MANIM_LIB||path.join(root,'.tools','manim-lib');
export const pythonAvailable=()=>existsSync(python)||Boolean(process.env.LUMEN_PYTHON);
export const manimAvailable=()=>pythonAvailable()&&existsSync(path.join(manimLib,'manim'));
const exists=async file=>{try{await stat(file);return true;}catch{return false;}};

export const ENGINE_INFO={
  hyperframes:{label:'HyperFrames',paradigm:'HTML, CSS, GSAP y WebGL',bestFor:'tipografía cinética, maquetación tipo web, rótulos, interfaces, 3D con Three.js, efectos y transiciones con shaders, catálogo oficial de 386 piezas',weaknesses:'matemáticas con fórmulas; lógica de datos compleja',main:'index.html'},
  remotion:{label:'Remotion',paradigm:'React',bestFor:'componentes con datos y gráficos, subtítulos, montaje de vídeo y audio, efectos de imagen, 3D con @remotion/three',weaknesses:'animación de fórmulas; dibujo vectorial muy coreografiado',main:'Scene.tsx'},
  manim:{label:'Manim',paradigm:'Python (Manim Community)',bestFor:'matemáticas y explicaciones técnicas precisas: geometría, gráficas de funciones, ejes, transformaciones entre formas, cálculo binario y diagramas que se construyen paso a paso',weaknesses:'fotos y vídeo del usuario, interfaces, tipografía de marca (solo fuentes del sistema)',main:'scene.py'},
  revideo:{label:'Revideo',paradigm:'TypeScript con generadores en canvas (fork de Motion Canvas)',bestFor:'animación de código con diferencias entre bloques, diagramas vectoriales con tiempos muy explícitos, fórmulas LaTeX (MathJax incluido), explicaciones paso a paso',weaknesses:'3D, catálogo de piezas y efectos de imagen; renders algo más lentos',main:'src/scene.tsx'},
};
export const engineList=()=>Object.entries(ENGINE_INFO).map(([id,info])=>`${info.label} (${id}, ${info.paradigm}): ideal para ${info.bestFor}. Menos indicado para ${info.weaknesses}.`).join('\n');

// Ajusta un vídeo a la duración exacta: congela el último fotograma si es corto y recorta si es largo.
export async function fitDuration(input,duration,output,fps,signal){
  const probe=await probeMedia(input),pad=Math.max(0,duration-(probe.duration||0)+0.1);
  const result=await execute(ffmpeg,['-y','-v','error','-i',input,'-an','-vf',`fps=${fps},tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)}`,'-t',duration.toFixed(3),'-c:v','libx264','-pix_fmt','yuv420p','-crf','18',output],{signal,timeout:900000});
  if(result.code!==0)throw new Error('No se pudo ajustar la duración: '+result.stderr.slice(-400));
  return {original:probe.duration||0};
}
async function framesAt(video,times,dir,signal){
  await mkdir(dir,{recursive:true});const result=[];
  for(const time of times){const file=path.join(dir,`frame-at-${time}s.png`);const run=await execute(ffmpeg,['-y','-v','error','-ss',String(time),'-i',video,'-frames:v','1',file],{signal,timeout:60000});if(run.code===0)result.push({time,path:file});}
  return result;
}
// Planos quietos medidos sobre el vídeo de verificación (los motores sin DOM no admiten la inspección del navegador).
async function stillHolds(video,signal){
  const result=await execute(ffmpeg,['-hide_banner','-i',video,'-vf','freezedetect=n=0.003:d=2.5','-an','-f','null','-'],{signal,timeout:300000});
  const starts=[...result.stderr.matchAll(/freeze_start: ([\d.]+)/g)].map(match=>Number(match[1])),durations=[...result.stderr.matchAll(/freeze_duration: ([\d.]+)/g)].map(match=>Number(match[1]));
  return starts.map((start,index)=>({section:'inspect',severity:'warning',rule:'still_hold',time:Math.round(start*10)/10,message:`Plano quieto desde el segundo ${start.toFixed(1)}${durations[index]?` durante ${durations[index].toFixed(1)} s`:''}: añade un empuje de cámara, una respiración o un cambio.`}));
}

// ---------- Manim ----------
// LaTeX: TinyTeX en .tools/tinytex (scripts/install-tinytex.ps1) para MathTex y Tex.
const latexBin=path.join(root,'.tools','tinytex','bin','windows');
export const latexAvailable=()=>existsSync(path.join(latexBin,'latex.exe'))&&existsSync(path.join(latexBin,'dvisvgm.exe'));
async function hasLatex(){return latexAvailable();}
const manimEnv=()=>({...process.env,PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1',LUMEN_MANIM_LIB:manimLib,...(latexAvailable()?{PATH:latexBin+path.delimiter+(process.env.PATH||process.env.Path||'')}:{})});
export function manimScaffold(brief){
  const palette=brief.profile?.palette||{};
  return `from manim import *
from lumen.tokens import TOKENS

# Escena «${brief.title}»: dura ${brief.durationSeconds} s exactos (la suma de run_time y wait debe dar esa cifra).
class LumenScene(Scene):
    def construct(self):
        self.camera.background_color = TOKENS["color"].get("background", "${palette.background||'#111b31'}")
        title = Text(${JSON.stringify(brief.title)}, font=TOKENS["font"], color=TOKENS["color"].get("ink", "#f5f8ff")).scale(0.9)
        self.play(FadeIn(title, shift=UP * 0.3), run_time=0.6)
        self.wait(${Math.max(0.1,brief.durationSeconds-0.6).toFixed(2)})
`;
}
function manimTokens(brief){
  const palette={background:'#111b31',ink:'#f5f8ff',accent:'#65dacf',card:'#1d2b45',...brief.profile?.palette};
  return `# Generado por Lumen: tokens de la identidad del proyecto para Manim.
TOKENS = ${JSON.stringify({color:palette,font:'Segoe UI',mono:'Consolas',width:brief.width,height:brief.height,fps:brief.fps,duration:brief.durationSeconds,captionZone:brief.captions?.enabled?0.18:0},null,4).replace(/true/g,'True').replace(/false/g,'False').replace(/null/g,'None')}
`;
}
export async function prepareManim(dir,brief){
  await mkdir(path.join(dir,'lumen'),{recursive:true});await writeFile(path.join(dir,'lumen','tokens.py'),manimTokens(brief));
  if(!await exists(path.join(dir,'scene.py')))await writeFile(path.join(dir,'scene.py'),manimScaffold(brief));
}
export async function lintManim(dir,brief){
  const errors=[],warnings=[],files=[];const walk=async(folder,prefix='')=>{for(const entry of await readdir(folder,{withFileTypes:true}).catch(()=>[])){if(['assets','snapshots','.history','.lumen','lumen','media','__pycache__'].includes(entry.name)&&!prefix)continue;const rel=prefix?prefix+'/'+entry.name:entry.name;if(entry.isDirectory())await walk(path.join(folder,entry.name),rel);else if(entry.name.endsWith('.py'))files.push(rel);}};await walk(dir);
  if(!files.includes('scene.py'))return {errors:[{file:'scene.py',line:1,rule:'missing',severity:'error',message:'Falta scene.py con la clase LumenScene.'}],warnings};
  const result=await execute(python,[guard,(await hasLatex())?'1':'0',...files.map(file=>path.join(dir,file))],{cwd:dir,env:manimEnv(),timeout:60000});
  let issues=[];try{issues=JSON.parse(result.stdout.trim()||'[]');}catch{errors.push({file:'scene.py',line:1,rule:'guard',severity:'error',message:'No se pudo analizar el código: '+(result.stderr||result.stdout).slice(-300)});}
  for(const issue of issues)(issue.severity==='error'?errors:warnings).push(issue);
  const source=await readFile(path.join(dir,'scene.py'),'utf8');if(!/class\s+LumenScene\s*\(/.test(source))errors.push({file:'scene.py',line:1,rule:'scene',severity:'error',message:'La escena principal debe llamarse LumenScene.'});
  return {errors,warnings};
}
async function renderManim(dir,brief,{fps,output,signal}){
  if(!manimAvailable())throw new Error('Manim no está instalado en este equipo. Ejecuta scripts/install-manim.ps1 (instala Manim Community en .tools/manim-lib con el Python portable).');
  const media=path.join(dir,'.lumen','manim');await rm(media,{recursive:true,force:true});
  const result=await execute(python,[manimLauncher,'render','scene.py','LumenScene','--media_dir',media,'-r',`${brief.width},${brief.height}`,'--fps',String(fps),'--format','mp4','--disable_caching','--progress_bar','none','-o','lumen'],{cwd:dir,env:manimEnv(),signal,timeout:3600000});
  const find=async folder=>{for(const entry of await readdir(folder,{withFileTypes:true}).catch(()=>[])){const full=path.join(folder,entry.name);if(entry.isDirectory()&&entry.name!=='partial_movie_files'){const hit=await find(full);if(hit)return hit;}else if(entry.name==='lumen.mp4')return full;}return null;};
  const file=await find(media);if(result.code!==0||!file)throw new Error('Manim no pudo renderizar la escena: '+(result.stderr||result.stdout).replace(/\s+/g,' ').slice(-1500));
  await copyFile(file,output);return output;
}

// ---------- Revideo ----------
export const REVIDEO_IMPORTS=['@revideo/2d','@revideo/core'];
export function revideoProject(brief,fps=brief.fps){const background=brief.profile?.palette?.background||'#111b31';return `// Generado por Lumen: no lo edites. Tamaño, fps y fondo salen de la escena.
import {makeProject} from '@revideo/core';
import scene from './scene?scene';
export default makeProject({scenes:[scene],settings:{shared:{size:{x:${brief.width},y:${brief.height}},background:'${background}'},rendering:{fps:${fps},exporter:{name:'@revideo/core/ffmpeg',options:{format:'mp4'}}}}});
`;}
export function revideoScaffold(brief){
  return `import {makeScene2D, Txt, Rect} from '@revideo/2d';
import {createRef, all, waitFor} from '@revideo/core';
import {tokens} from '../lumen/tokens.ts';

// Escena «${brief.title}»: dura ${brief.durationSeconds} s exactos (la suma de las animaciones y esperas debe dar esa cifra).
export default makeScene2D('scene', function* (view) {
  const title = createRef<Txt>();
  view.add(<Txt ref={title} text={${JSON.stringify(brief.title)}} fill={tokens.color.ink} fontFamily={'Segoe UI'} fontWeight={700} fontSize={tokens.type.h1} opacity={0} y={-20} />);
  yield* all(title().opacity(1, 0.6), title().y(0, 0.6));
  yield* waitFor(${Math.max(0.1,brief.durationSeconds-0.6).toFixed(2)});
});
`;
}
export async function prepareRevideo(dir,brief){
  await mkdir(path.join(dir,'src'),{recursive:true});await writeFile(path.join(dir,'src','project.ts'),revideoProject(brief));
  if(!await exists(path.join(dir,'src','scene.tsx')))await writeFile(path.join(dir,'src','scene.tsx'),revideoScaffold(brief));
}
export async function lintRevideo(dir,brief){
  const errors=[],warnings=[];const main=path.join(dir,'src','scene.tsx');
  if(!await exists(main))return {errors:[{file:'src/scene.tsx',line:1,rule:'missing',severity:'error',message:'Falta src/scene.tsx con export default makeScene2D(...).'}],warnings};
  await writeFile(path.join(dir,'src','project.ts'),revideoProject(brief));
  const {transform}=await import('esbuild');const files=[];const walk=async(folder,prefix)=>{for(const entry of await readdir(folder,{withFileTypes:true}).catch(()=>[])){const rel=prefix+'/'+entry.name;if(entry.isDirectory())await walk(path.join(folder,entry.name),rel);else if(/\.(tsx?|jsx?)$/.test(entry.name))files.push(rel);}};await walk(path.join(dir,'src'),'src');await walk(path.join(dir,'components'),'components');
  for(const file of files){const text=await readFile(path.join(dir,file),'utf8');
    try{await transform(text,{loader:file.endsWith('.tsx')?'tsx':file.endsWith('.ts')?'ts':'jsx',jsx:'automatic',sourcefile:file});}catch(error){for(const item of error.errors||[{text:error.message}])errors.push({file,line:item.location?.line||1,rule:'syntax',severity:'error',message:item.text});}
    for(const match of text.matchAll(/(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g)){const spec=match[1];if(spec.startsWith('.'))continue;const pkg=spec.startsWith('@')?spec.split('/').slice(0,2).join('/'):spec.split('/')[0];if(!REVIDEO_IMPORTS.includes(pkg))errors.push({file,line:text.slice(0,match.index).split('\n').length,rule:'import',severity:'error',message:`Paquete no permitido: ${spec}. Permitidos: ${REVIDEO_IMPORTS.join(', ')} y archivos relativos.`});}}
  if(!/export\s+default\s+makeScene2D/.test(await readFile(main,'utf8')))errors.push({file:'src/scene.tsx',line:1,rule:'export',severity:'error',message:'src/scene.tsx debe exportar por defecto makeScene2D(...).'});
  return {errors,warnings};
}
let chromePath=null;async function browserPath(){if(chromePath)return chromePath;const {chromium}=await import('playwright');return chromePath=chromium.executablePath();}
async function renderRevideo(dir,brief,{fps,output,signal}){
  const outDir=path.join(dir,'.lumen','revideo');await rm(outDir,{recursive:true,force:true});await mkdir(outDir,{recursive:true});
  const project=fps===brief.fps?'./src/project.ts':'./src/project-check.ts';if(fps!==brief.fps)await writeFile(path.join(dir,'src','project-check.ts'),revideoProject(brief,fps));
  const options=JSON.stringify({projectFile:project,outFile:'scene.mp4',outDir:'./.lumen/revideo',executablePath:await browserPath()});
  const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,'server','revideo-render.mjs'),options],{cwd:dir,env:{...process.env,DISABLE_TELEMETRY:'true'}});let out='';child.stdout.on('data',data=>out+=data);child.stderr.on('data',data=>out+=data);
    const limit=Math.max(120000,brief.durationSeconds*fps*1500);const timer=setTimeout(()=>{child.kill();reject(new Error('Revideo no terminó en '+Math.round(limit/1000)+' s: suele ser un error dentro de la escena (por ejemplo, un import que no existe o una excepción en el generador). Revisa src/scene.tsx.'));},limit);const abort=()=>{child.kill();reject(new Error('Render cancelado.'));};signal?.addEventListener('abort',abort,{once:true});
    child.on('exit',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve({code,out:out.replace(/\u0000/g,'')});});});
  await rm(path.join(dir,'src','project-check.ts'),{force:true});
  const file=path.join(outDir,'scene.mp4');if(result.code!==0||!await exists(file)){const json=/\{"ok":false,"error":"([^"]*)/.exec(result.out)?.[1];throw new Error('Revideo no pudo renderizar la escena: '+(json||result.out.replace(/\s+/g,' ').slice(-1500)));}
  await copyFile(file,output);return output;
}

// ---------- Interfaz común ----------
const ADAPTERS={manim:{prepare:prepareManim,lint:lintManim,render:renderManim},revideo:{prepare:prepareRevideo,lint:lintRevideo,render:renderRevideo}};
export const isAdapterEngine=engine=>Boolean(ADAPTERS[engine]);
export const prepareEngine=(engine,dir,brief)=>ADAPTERS[engine].prepare(dir,brief);
export const lintEngine=(engine,dir,brief)=>ADAPTERS[engine].lint(dir,brief);
// Verificación: render rápido a 10 fps con el tamaño final (mismo encuadre), duración y planos quietos.
export async function checkEngine(engine,dir,brief,signal){
  const video=path.join(dir,'.lumen','check.mp4');await mkdir(path.dirname(video),{recursive:true});
  try{await ADAPTERS[engine].render(dir,brief,{fps:10,output:video,signal});}catch(error){return {ok:false,issues:[{severity:'error',rule:engine+'-runtime',message:error.message.slice(0,1500)}]};}
  const duration=(await probeMedia(video)).duration||0,issues=[];
  if(Math.abs(duration-brief.durationSeconds)>0.25)issues.push({severity:'warning',rule:'duration',message:`La escena dura ${duration.toFixed(2)} s y debería durar ${brief.durationSeconds} s: ajusta las esperas (Lumen congelará o recortará el final).`});
  issues.push(...await stillHolds(video,signal));
  return {ok:true,issues,video,duration};
}
export async function snapshotEngine(engine,dir,brief,times,output,signal){
  const video=path.join(dir,'.lumen','check.mp4');if(!await exists(video))await ADAPTERS[engine].render(dir,brief,{fps:10,output:video,signal});
  return framesAt(video,times,output,signal);
}
export async function renderEngine(engine,dir,brief,output,signal){
  const raw=path.join(path.dirname(output),'engine-'+Date.now()+'.mp4');
  try{await ADAPTERS[engine].render(dir,brief,{fps:brief.fps,output:raw,signal});await fitDuration(raw,brief.durationSeconds,output,brief.fps,signal);}finally{await rm(raw,{force:true});}
}
