// Agentes de proyecto: director creativo (guía y serie), diseñador del kit (componentes compartidos)
// y documentalista (describe el material). Trabajan sobre el proyecto, no sobre un vídeo concreto.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile,stat,rm,cp,readdir} from 'node:fs/promises';
import {existsSync,renameSync} from 'node:fs';
import ffmpeg from 'ffmpeg-static';
import {execute} from './process.mjs';
import {effectiveSettings,collectionContext,updateCollection,INHERITED_KEYS} from './collections.mjs';
import {collectionFolder,syncCollection} from './library-sync.mjs';
import {mediaItems,readIndex} from './media-index.mjs';
import {styleFramesFromKit} from './critic.mjs';
import {kitInspiration} from './hyperframes-catalog.mjs';
import {snapshotScene} from './scene-code.mjs';
import {prepareWorkspace,sceneBrief,checkScene,snapshotSources,sourceHash,sourceFiles,workspaceDir,trustFiles,listHistory} from './scene-code.mjs';
import {validate,validateCreate} from './schemas.mjs';
import {settings} from './settings.mjs';

// La vista previa del kit crece con sus componentes (unos 1,6 s por componente, entre 8 y 40 s).
export const kitSeconds=(collection,engine,extra=0)=>Math.max(8,Math.min(40,Math.ceil(((kitOf(collection,engine)?.components?.length||0)+extra)*1.6)));
const previewTimes=seconds=>{const count=Math.min(8,Math.max(4,Math.round(seconds/2)));return Array.from({length:count},(_,index)=>Math.round((0.8+index*(seconds-1.4)/(count-1))*100)/100);};
// Un proyecto visto como «proyecto de vídeo» para reutilizar capacidades, índice y espacios de trabajo.
export function collectionAsProject(collection){
  const {values}=effectiveSettings(collection);
  return {...values,id:collection.id,collectionId:collection.id,title:collection.name,prompt:collection.objective||collection.name,duration:60,sources:collection.sources||[],assets:collection.assets||[],recordings:[],mediaIndex:collection.mediaIndex||{},storyboard:null,tasks:[],revisions:[],metrics:{calls:0,inputTokens:0,outputTokens:0,durationMs:0,unknownUsageCalls:0}};
}
// Un proyecto puede tener un kit por motor: las escenas HyperFrames usan el suyo y las Remotion el suyo.
export const KIT_ENGINES=['hyperframes','remotion','manim','revideo'];
export function kitsOf(collection){const kits={...(collection?.kits||{})};if(collection?.kit?.engine&&!kits[collection.kit.engine])kits[collection.kit.engine]=collection.kit;return kits;}
export const kitOf=(collection,engine)=>kitsOf(collection)[engine]||null;
export const kitDir=(store,collectionId,engine)=>workspaceDir(collectionFolder(store,collectionId),'kit-'+engine);
// Componente base de una escena: el motor lo decide el kit que lo contiene. Si no existe en ningún kit,
// pasa a ser un componente nuevo que se añadirá antes de programar la escena.
export function resolveSceneComponent(collection,scene){
  if(!KIT_ENGINES.includes(scene.engine))return {...scene,component:null,newComponent:null};
  const key=value=>String(value||'').trim().toLocaleLowerCase(),kits=kitsOf(collection),find=engine=>kits[engine]?.status==='ready'&&kits[engine].components?.find(item=>key(item.name)===key(scene.component));
  if(scene.component){
    const engine=find(scene.engine)?scene.engine:KIT_ENGINES.find(item=>find(item));
    if(engine)return {...scene,engine,component:find(engine).name,newComponent:null};
    return {...scene,component:null,newComponent:scene.newComponent||{name:String(scene.component).slice(0,80),description:''}};
  }
  if(scene.newComponent){const existing=KIT_ENGINES.find(item=>kits[item]?.status==='ready'&&kits[item].components?.some(entry=>key(entry.name)===key(scene.newComponent.name)));if(existing)return {...scene,engine:existing,component:kits[existing].components.find(entry=>key(entry.name)===key(scene.newComponent.name)).name,newComponent:null};}
  return {...scene,component:scene.component||null,newComponent:scene.newComponent||null};
}
// Uso de cada componente en los vídeos del proyecto.
export function componentUsage(store,collectionId,engine){const usage={};for(const video of store.list().filter(item=>item.collectionId===collectionId))for(const scene of video.storyboard?.scenes||[])if(scene.engine===engine&&scene.component)usage[scene.component]=(usage[scene.component]||0)+1;return usage;}
// Proyectos anteriores: un único kit en code/kit → code/kit-<motor> y collection.kits.
export function migrateKits(store,collection){
  if(!collection?.kit?.engine)return collection;const engine=collection.kit.engine;
  if(!collection.kits?.[engine]){const legacy=workspaceDir(collectionFolder(store,collection.id),'kit'),target=kitDir(store,collection.id,engine);try{if(existsSync(legacy)&&!existsSync(target))renameSync(legacy,target);}catch{}collection.kits={...collection.kits,[engine]:collection.kit};}
  delete collection.kit;if(collection.agentRuns?.['kit-designer']){collection.agentRuns['kit-designer:'+engine]||=collection.agentRuns['kit-designer'];delete collection.agentRuns['kit-designer'];}
  store.saveCollection(collection);return collection;
}
export function kitScene(collection,engine,extra=0){return {id:'kit-'+engine,engine,title:'Kit de '+collection.name,eyebrow:'',narration:'Vista previa de los componentes del kit.',points:[],type:'title',duration:kitSeconds(collection,engine,extra),direction:'Vista previa del kit: muestra cada componente en secuencia.',voiceover:null};}

async function silence(folder,seconds){const file=path.join(folder,'media',`kit-silence-${seconds}.wav`);try{await stat(file);}catch{await mkdir(path.dirname(file),{recursive:true});const result=await execute(ffmpeg,['-y','-v','error','-f','lavfi','-i','anullsrc=r=44100:cl=mono','-t',String(seconds),file],{timeout:60000});if(result.code!==0)throw new Error('No se pudo preparar el audio del kit.');}return `media/kit-silence-${seconds}.wav`;}
export async function kitContext(store,collection,engine,extra=0){
  const folder=collectionFolder(store,collection.id),scene=kitScene(collection,engine,extra),project={...collectionAsProject(collection),storyboard:{title:'Kit',scenes:[scene]}};
  const media={duration:scene.duration,speechDuration:0.5,audioPath:await silence(folder,scene.duration),words:[]};
  const {dir,brief}=await prepareWorkspace(project,scene,media,folder);return {dir,brief,project,scene,media};
}
export function kitBriefFor(store,collection,engine){const scene=kitScene(collection,engine),project={...collectionAsProject(collection),storyboard:{title:'Kit',scenes:[scene]}};return {dir:kitDir(store,collection.id,engine),scene,brief:sceneBrief(project,scene,{duration:scene.duration,speechDuration:0.5,audioPath:`media/kit-silence-${scene.duration}.wav`,words:[]})};}
function kitGuide(engine){return `

## Este espacio es el KIT DEL PROYECTO, no una escena

## Oficio con números (Lumen mide parte de esto con \`scene_check\`)
- Tiempo de lectura: cada texto asentado se mantiene al menos \`max(1 s, 0,3 s + caracteres/17)\` (o 3 palabras por segundo, lo que sea mayor); un titular, \`max(1,2 s, 0,3 × palabras)\`; una cifra, 1,2 s después de terminar de contar; un diagrama, código o gráfico, de 1,5 a 2,5 s. No retires un texto antes de que se pueda leer.
- Primer movimiento entre 0,1 y 0,3 s después del corte; el elemento principal visible antes de 0,5 s. Entradas de 0,3 a 0,6 s; salidas del 60 al 80 % de la entrada; conteos de 1,2 a 2,5 s.
- Escalonado por importancia: letras 15–25 ms, palabras 30–60 ms, elementos 60–100 ms; el grupo entero en 0,5 s como mucho; con más de unos 9 elementos, un solo barrido. Nunca tres o más textos apareciendo en el mismo fotograma.
- Curva por defecto: salida fuerte (\`power3.out\`); el sobreimpulso, solo en registro desenfadado y nunca en bloques de texto ni en contadores. Anima solo transformaciones, opacidad, filtro y clip-path; entra desde una escala de 0,94–0,98 o con un desplazamiento de 16–40 px.
- Nada se queda quieto más de unos 2 s: una respiración del 1–2 % o un empuje de cámara de 1,00 a 1,04–1,08 a lo largo del plano (5–7 % en texto solo, 7–8 % sobre fondo oscuro). Como mucho, un movimiento de cámara por frase musical.
- Tamaños: titulares de al menos un 7 % de la altura; cuerpo de al menos 36 px a 1080p en horizontal y 48 px en vertical. Contraste de 4,5:1 como mínimo.
- Transiciones: una principal en el 60–70 % de los cortes (los cortes secos cuentan) más uno o dos acentos; nunca a mitad de frase de la voz, sino en la pausa entre frases; una sola dirección para empujes y deslizamientos; nada de más de tres destellos por segundo.
- Sonido: un efecto por evento visual que importa (en un vídeo explicativo, de 1 a 3 en total), siempre de la misma familia y sin sonidos de videojuego en vídeos serios; el golpe visual llega 1–2 fotogramas antes que el sonido o el pulso, y el sonido nunca va más de 2 fotogramas por detrás de la imagen.
Los componentes del kit deben cumplir estas reglas por defecto (duraciones de entrada, escalonados, tiempos de lectura y respiración), para que todas las escenas las hereden.

### Método para un kit de calidad
1. Lee \`lumen/KIT-INSPIRATION.md\`: el catálogo oficial agrupado por papel (intros, rótulos, subtítulos, transiciones, cifras, código, 3D, interfaz, anotación, fondos, cierres) y la documentación local (listón de calidad de componentes, estilo de la casa, blueprints, presets de estilo, primitivas de movimiento y ejemplos completos).
2. Decide la **firma visual y de movimiento** de la serie (una idea reconocible: un gesto de entrada, una textura, una forma de revelar) y aplícala a todos los componentes.
3. ${engine==='hyperframes'?'Parte de piezas oficiales cuando encajen: consulta \`hyperframes_catalog\`, instala con \`hyperframes_add\` y adáptalas (tokens, tipografía, ritmo); si no encaja ninguna, prográmala desde cero con la misma calidad.':'Apóyate en el oficio y el recetario de Remotion de KIT-INSPIRATION.md (spring con duración fija, TransitionSeries, @remotion/effects, shapes, paths, captions, rough-notation y 3D con @remotion/three) y usa el catálogo de HyperFrames solo como referencia de qué componentes tener y cómo se mueven, recreándolos en React.'}
4. Cada componente: parámetros para textos, colores y tiempos; entrada, permanencia y salida definidas; legible en el formato del proyecto; sin valores sueltos (usa los tokens). Documenta en KIT.md su uso exacto y, si parte de un bloque del catálogo, cuál.
5. Revisa la vista previa con scene_snapshot como lo haría un director de arte: jerarquía, contraste, ritmo y coherencia entre componentes.

Programa componentes reutilizables que usarán todas las escenas ${({hyperframes:'HyperFrames',remotion:'Remotion',manim:'Manim',revideo:'Revideo'})[engine]} del proyecto, con su identidad (paleta, tipografía, tono) y sus reglas:
- Guarda cada componente en \`components/\`${engine==='manim'?' (un módulo .py por componente con clases o funciones que devuelven Mobjects o animaciones; las escenas los importan con from kit.components.<módulo> import ...)':engine==='revideo'?' (un archivo .tsx por componente con funciones que crean nodos y generadores de animación; las escenas los importan desde ../kit/components/)':engine==='hyperframes'?' (fragmentos HTML/CSS o sub-composiciones con data-composition-src; un CSS común en components/kit.css)':' (un archivo .tsx por componente con export nombrado; props tipadas para textos, colores y tiempos)'}.
- En un kit nuevo, como mínimo: intro o cabecera, rótulo inferior (lower third), estilo de subtítulos palabra a palabra, tarjeta de título, transición o barrido de marca y cierre (con el logo si existe en assets/media).
- Documenta en \`KIT.md\` cada componente: para qué sirve, cómo se incluye (fragmento exacto), parámetros y duración recomendada. Los programadores de escena solo leerán KIT.md.
- ${({hyperframes:'index.html',remotion:'Scene.tsx',manim:'scene.py',revideo:'src/scene.tsx'})[engine]} es la vista previa del kit (dura lo que indique lumen/scene.json): muestra todos los componentes en secuencia, también los que se añadan después.
- El kit crece con el tiempo: al añadir un componente no cambies la API (parámetros, nombres de clases o exports) de los existentes, porque hay escenas que ya los usan. Debe superar scene_check y revísalo con scene_snapshot.
- Los componentes deben ser deterministas, sin red y respetar el lienzo y la zona de subtítulos.${engine==='hyperframes'?"\n- HyperFrames admite 3D con Three.js en local (ver «3D y acabado casi realista» más arriba): el kit puede incluir componentes 3D reutilizables, por ejemplo un objeto o dispositivo con material físico, un escenario con iluminación de estudio o una transición con profundidad, parametrizados (colores, textos y tiempos) y renderizados desde hf-seek.":''}`;}

// Lista de componentes tras un cambio: lo que devuelve el agente manda, pero no se pierden componentes
// anteriores que siguen existiendo aunque el agente olvide listarlos; el componente quitado desaparece.
export async function mergeComponents(dir,previous,returned,removed=null){
  const key=name=>String(name).trim().toLocaleLowerCase(),gone=removed&&key(removed),result=returned.filter(item=>key(item.name)!==gone);
  for(const item of previous){if(key(item.name)===gone||result.some(entry=>key(entry.name)===key(item.name)))continue;try{await stat(path.join(dir,item.file));result.push(item);}catch{}}
  return result.slice(0,30);
}

// Frases legibles para la actividad de un agente.
function describeTool(name='',target=''){
  const file=target?path.basename(String(target)):'';const tool=String(name).replace(/^mcp__\w+__/,'');
  const labels={Read:'Lee '+file,Write:'Escribe '+file,Edit:'Edita '+file,MultiEdit:'Edita '+file,Glob:'Busca archivos',Grep:'Busca en la documentación',WebSearch:'Busca en la web: '+target,WebFetch:'Consulta '+target,scene_lint:'Comprueba el código',scene_check:'Verifica la escena en el navegador',scene_snapshot:'Captura fotogramas para revisarlos',media_info:'Mira la hoja de contactos del material',media_frames:'Mira fotogramas del material',media_search:'Busca en el material: '+target,media_describe:'Describe planos del material',library_list:'Revisa la biblioteca',library_search:'Busca en la biblioteca: '+target,library_read:'Lee un recurso de la biblioteca',library_add_url:'Añade a la biblioteca: '+target,library_add_text:'Guarda una nota en la biblioteca',hyperframes_catalog:'Consulta el catálogo de HyperFrames',hyperframes_add:'Añade un componente del catálogo: '+target,studio_capabilities:'Consulta las capacidades del estudio'};
  return (labels[tool]||('Usa '+tool)).trim().slice(0,180);
}
export class CollectionAgents{
  constructor(store,harness,desktop){this.store=store;this.harness=harness;this.desktop=desktop;this.active=new Map();this.queues=new Map();if(harness)harness.collectionAgents=this;this.recover();}
  // Garantiza que el kit de un motor tenga un componente (lo crea el diseñador si falta). Las peticiones
  // de varias escenas se encolan por motor y un mismo componente solo se crea una vez.
  ensureComponent(collectionId,engine,{name,description='',origin=null},{reason=''}={}){
    const queueKey=collectionId+':'+engine,previous=this.queues.get(queueKey)||Promise.resolve();
    const key=value=>String(value||'').trim().toLocaleLowerCase();
    const work=previous.catch(()=>{}).then(async()=>{
      const running=this.active.get(collectionId+':kit-designer:'+engine);if(running)await running.promise.catch(()=>{});
      const collection=this.store.getCollection(collectionId),kit=kitOf(collection,engine);
      const found=kit?.status==='ready'&&kit.components?.find(item=>key(item.name)===key(name));if(found)return found.name;
      const detail=`${description||'diséñalo según su nombre y la identidad del proyecto'}${reason?' Se necesita para: '+reason:''}`;
      if(kit?.status==='ready')this.kit(collectionId,{engine,mode:'add',component:{name,description:detail}});
      else this.kit(collectionId,{engine,instruction:`Incluye obligatoriamente el componente «${name}»: ${detail}`});
      await this.active.get(collectionId+':kit-designer:'+engine).promise;
      const after=this.store.getCollection(collectionId),latest=kitOf(after,engine),component=latest?.components?.find(item=>key(item.name)===key(name));
      // Procedencia declarada por quien pidió el componente (catálogo, receta o ejemplo); si no, es diseño propio.
      if(component){component.origin=origin||component.origin||{kind:'own',ref:null,license:null,url:null};after.kits={...kitsOf(after),[engine]:latest};this.store.saveCollection(after);}
      return component?.name||name;
    });
    this.queues.set(queueKey,work);work.finally(()=>{if(this.queues.get(queueKey)===work)this.queues.delete(queueKey);}).catch(()=>{});
    return work;
  }
  recover(){
    const message='Se interrumpió al reiniciar el estudio. Puedes volver a lanzarlo.';
    for(const collection of this.store.collections())migrateKits(this.store,collection);
    for(const collection of this.store.collections()){const runs=Object.entries(collection.agentRuns||{}).filter(([,run])=>run?.status==='running');if(!runs.length)continue;for(const [kind] of runs)collection.agentRuns[kind]={...collection.agentRuns[kind],status:'interrupted',error:message};this.store.saveCollection(collection);}
    for(const video of this.store.list())if(video.libraryResearch?.status==='running'){video.libraryResearch={...video.libraryResearch,status:'interrupted',error:message};this.store.save(video);}
  }
  // Actividad visible del agente: herramientas que usa y archivos que toca, resumidos para la interfaz.
  activity(ownerId,kind,event,sceneId=null){
    const lines=[];
    for(const block of event.message?.content||[]){if(block.type==='tool_use'){const input=block.input||{};const target=input.file_path||input.path||input.pattern||input.url||input.query||input.mediaId||input.name||'';lines.push(describeTool(block.name,target));}else if(block.type==='text'&&block.text?.trim())lines.push(block.text.trim().split('\n')[0].slice(0,160));}
    const item=event.item;if(item?.type==='command_execution')lines.push('Ejecuta: '+String(item.command||'').slice(0,120));if(item?.type==='mcp_tool_call')lines.push(describeTool(item.tool||item.name,''));if(item?.type==='file_change')lines.push('Edita '+(item.changes||[]).map(change=>path.basename(change.path||'')).join(', '));if(item?.type==='agent_message'&&item.text)lines.push(String(item.text).split('\n')[0].slice(0,160));
    for(const text of lines.filter(Boolean))this.store.event(ownerId,'agent.activity',{kind,sceneId,message:text});
  }
  folder(id){return collectionFolder(this.store,id);}
  status(collectionId){return this.store.getCollection(collectionId)?.agentRuns||{};}
  setRun(collectionId,kind,value){const collection=this.store.getCollection(collectionId);collection.agentRuns={...collection.agentRuns,[kind]:{...collection.agentRuns?.[kind],...value}};this.store.saveCollection(collection);}
  start(collectionId,kind,operation){
    const key=collectionId+':'+kind;if(this.active.has(key))throw new Error('Ese agente ya está trabajando en este proyecto.');
    const collection=this.store.getCollection(collectionId);if(!collection)throw new Error('Proyecto inexistente.');
    const controller=new AbortController();this.setRun(collectionId,kind,{status:'running',startedAt:new Date().toISOString(),error:null});
    const promise=operation(controller.signal).then(result=>{this.setRun(collectionId,kind,{status:'completed',completedAt:new Date().toISOString(),summary:result?.summary||null,error:null});return result;}).catch(error=>{this.setRun(collectionId,kind,{status:controller.signal.aborted?'stopped':'failed',error:error.message});throw error;}).finally(()=>this.active.delete(key));
    promise.catch(()=>{});this.active.set(key,{controller,promise});return {status:'running'};
  }
  stop(collectionId,kind){const run=this.active.get(collectionId+':'+kind);if(run)run.controller.abort();return {stopped:Boolean(run)};}
  async invoke(collection,kind,context,signal,{workspace=null,instruction='',runKey=null,engine=null}={}){
    const project={...collectionAsProject(collection),mcpServers:settings(this.store).mcpServers,allowedDomains:settings(this.store).allowedDomains,collectionContext:collectionContext(collection)};
    const task={id:kind,role:kind,sceneId:workspace?'kit-'+engine:null,instruction,attempts:1,dependencies:[],feedback:context.feedback||null};
    const attemptDir=path.join(this.folder(collection.id),'runs',kind,Date.now()+'-'+randomUUID().slice(0,6)),token=randomUUID();
    this.desktop.tokens?.set(token,{projectId:collection.id,collectionId:collection.id,actor:kind+':'+randomUUID(),kind,sceneId:workspace?'kit-'+engine:null,engine});
    try{const result=await this.harness.runtimeInvoke({kind,project,task,context,attemptDir,signal,mcpToken:token,onEvent:event=>this.activity(collection.id,runKey||kind,event)});const latest=this.store.getCollection(collection.id);latest.metrics||={};const role=latest.metrics[kind]||={calls:0,inputTokens:0,outputTokens:0,durationMs:0};role.calls++;role.inputTokens+=result.metrics?.inputTokens||0;role.outputTokens+=result.metrics?.outputTokens||0;role.durationMs+=result.metrics?.durationMs||0;this.store.saveCollection(latest);return result;}
    finally{this.desktop.tokens?.delete(token);}
  }

  // ---------- Director creativo ----------
  creative(collectionId,{brief='',createVideos=false,applyIdentity=false}={}){
    return this.start(collectionId,'creative-director',async signal=>{
      const collection=this.store.getCollection(collectionId),media=mediaItems(collection).map(item=>({mediaId:item.id,name:item.name,kind:item.kind,index:collection.mediaIndex?.[item.id]?{duration:collection.mediaIndex[item.id].duration,shots:collection.mediaIndex[item.id].shots,transcript:collection.mediaIndex[item.id].transcript?.text?.slice(0,300)||null}:null}));
      const {output}=await this.invoke(collection,'creative-director',{brief,project:{name:collection.name,objective:collection.objective,audience:collection.audience,styleGuide:collection.styleGuide,rules:collection.rules,notes:collection.notes,profile:effectiveSettings(collection).values.profile},media,sources:(collection.sources||[]).map(source=>({name:source.name,content:source.content.slice(0,6000)})),existingVideos:this.store.list().filter(video=>video.collectionId===collectionId).map(video=>({title:video.title,prompt:video.prompt,status:video.status}))},signal);
      validate('creative-plan',output);
      const changes={objective:output.objective||collection.objective,audience:output.audience,styleGuide:output.styleGuide,rules:[...(collection.rules||[]).filter(rule=>rule.locked),...output.rules.filter(rule=>!(collection.rules||[]).some(existing=>existing.text===rule.text))].slice(0,60),settings:{profile:{captions:output.captions.enabled,captionStyle:output.captions.style,...(applyIdentity&&output.palette?{palette:output.palette}:{})}}};
      updateCollection(this.store,collectionId,changes,values=>validateCreate({...Object.fromEntries(INHERITED_KEYS.map(key=>[key,values[key]])),prompt:'Validación de ajustes del proyecto',duration:60,sources:[]}));
      const created=[];if(createVideos)for(const video of output.videos){const made=await this.harness.create({prompt:video.prompt,duration:video.duration,sources:[],collectionId,overrides:video.format?{output:{format:video.format}}:{}});const stored=this.store.get(made.id);stored.title=video.title;this.store.save(stored);created.push(made.id);}
      const latest=this.store.getCollection(collectionId);latest.seriesPlan={reasoning:output.reasoning,videos:output.videos,at:new Date().toISOString(),created};this.store.saveCollection(latest);
      return {summary:`Guía actualizada${created.length?` y ${created.length} vídeos creados como borrador`:''}.`};
    });
  }

  // ---------- Diseñador del kit ----------
  kit(collectionId,{instruction='',engine,exemplarId=null,mode='change',component=null}={}){
    const current=this.store.getCollection(collectionId);if(!current)throw new Error('Proyecto inexistente.');migrateKits(this.store,current);
    {const kits=kitsOf(current),existing=Object.keys(kits);engine||=existing.length===1?existing[0]:'hyperframes';}
    if(!KIT_ENGINES.includes(engine))throw new Error('Motor del kit inválido.');
    const runKey='kit-designer:'+engine,currentKit=kitOf(current,engine);
    {if(mode!=='change'){if(currentKit?.status!=='ready')throw new Error('Crea primero el kit '+engine+'.');if(!component?.name?.trim())throw new Error('Indica el componente.');}
      const names=(currentKit?.components||[]).map(item=>item.name.toLocaleLowerCase());
      if(mode==='add'&&names.includes(component.name.trim().toLocaleLowerCase()))throw new Error('Ya hay un componente con ese nombre: pide un cambio sobre él.');
      if(['improve','remove'].includes(mode)&&!names.includes(component.name.trim().toLocaleLowerCase()))throw new Error('Componente inexistente.');
      if(mode==='add'&&names.length>=30)throw new Error('El kit admite hasta 30 componentes.');}
    const existing=(currentKit?.components||[]).map(item=>item.name).join(', ');
    if(mode==='add')instruction=`Amplía el kit con un componente nuevo, «${component.name.trim()}»: ${component.description||'diséñalo según su nombre y la identidad del proyecto'}. ${instruction}\nConserva intactos los componentes existentes (${existing}) y su API. Crea el nuevo en components/, documéntalo en KIT.md y añádelo a la vista previa. En components devuelve la lista completa del kit.`;
    if(mode==='improve')instruction=`Cambia solo el componente «${component.name}»: ${instruction}\nConserva su API (parámetros, clases o exports) para no romper las escenas que ya lo usan y no toques los demás componentes. Actualiza KIT.md si cambia algo de su uso. En components devuelve la lista completa del kit.`;
    if(mode==='remove')instruction=`Quita el componente «${component.name}» del kit: su archivo (si ningún otro componente lo usa), su sección de KIT.md y su aparición en la vista previa. No cambies los demás. En components devuelve la lista completa del kit.`;
    return this.start(collectionId,runKey,async signal=>{
      const collection=this.store.getCollection(collectionId);
      const {dir,brief}=await kitContext(this.store,collection,engine,mode==='add'?1:mode==='remove'?-1:0);
      if(exemplarId){const source=path.join(collectionFolder(this.store,collectionId),'exemplars',path.basename(exemplarId)),destination=path.join(dir,'lumen','references',path.basename(exemplarId));await mkdir(destination,{recursive:true});for(const name of await readdir(source).catch(()=>[]))await cp(path.join(source,name),path.join(destination,name)).catch(()=>{});}
      await writeFile(path.join(dir,'lumen','KIT-INSPIRATION.md'),await kitInspiration(this.store,brief.engine)).catch(()=>{});
      const guide=(await readFile(path.join(dir,'AGENTS.md'),'utf8'))+kitGuide(brief.engine);await writeFile(path.join(dir,'AGENTS.md'),guide);await writeFile(path.join(dir,'CLAUDE.md'),guide);
      const authored=(await listHistory(dir)).length>0;await snapshotSources(dir,instruction?'Antes de: '+instruction:'Antes de diseñar el kit');
      const {output}=await this.invoke(collection,'kit-designer',{workspace:dir,brief,position:'kit',existingFiles:authored?(await sourceFiles(dir)).filter(file=>!file.startsWith('vendor/')&&file!=='gsap.min.js'):[],pitfalls:this.harness.pitfalls(),feedback:instruction?{instruction}:null},signal,{workspace:dir,instruction,runKey,engine});
      validate('kit-design',output);
      const check=await checkScene(dir,brief,signal);if(!check.ok)throw new Error('El kit no supera la verificación: '+check.issues.filter(issue=>issue.severity==='error').slice(0,6).map(issue=>issue.message).join(' | '));
      const saved=await snapshotSources(dir,'Kit: '+output.summary.slice(0,120)),version=await sourceHash(dir);
      await snapshotScene(dir,brief,previewTimes(brief.durationSeconds),signal).catch(()=>{});
      const latest=this.store.getCollection(collectionId),components=await mergeComponents(dir,kitOf(latest,engine)?.components||[],output.components,mode==='remove'?component.name:null);
      // Procedencia: lo que ya existía conserva la suya; lo nuevo nacido de una escena aprobada se marca como tal.
      {const before=new Map((kitOf(latest,engine)?.components||[]).map(item=>[item.name.toLowerCase(),item.origin]));for(const item of components){const previous=before.get(item.name.toLowerCase());if(previous)item.origin=item.origin||previous;else if(exemplarId)item.origin={kind:'exemplar',ref:exemplarId,license:null,url:null};}}
      latest.kits={...kitsOf(latest),[engine]:{engine,version,status:'ready',summary:output.summary,components,historyId:saved?.id||null,updatedAt:new Date().toISOString()}};delete latest.kit;latest.styleFrames=await styleFramesFromKit(this.store,latest,dir,engine);this.store.saveCollection(latest);
      return {summary:output.summary};
    });
  }

  // ---------- Investigador de biblioteca (proyecto o vídeo) ----------
  research(owner,{brief=''}={}){
    if(owner.kind==='collection')return this.start(owner.id,'library-researcher',async signal=>{
      const collection=this.store.getCollection(owner.id);
      const {output}=await this.invoke(collection,'library-researcher',{brief:brief||collection.objective,project:{name:collection.name,objective:collection.objective,audience:collection.audience},library:(collection.assets||[]).map(asset=>({id:asset.id,name:asset.name,kind:asset.kind,sourceUrl:asset.sourceUrl||null}))},signal);
      validate('library-research',output);await syncCollection(this.store,owner.id,id=>this.harness.folder(id),this.harness.active);return {summary:output.summary};
    });
    const video=this.store.get(owner.id);if(!video)throw new Error('Vídeo inexistente.');
    const key=owner.id+':library-researcher';if(this.active.has(key))throw new Error('El investigador ya está trabajando en este vídeo.');
    const controller=new AbortController(),runs=status=>{const current=this.store.get(owner.id);current.libraryResearch={...current.libraryResearch,...status};this.store.save(current);};
    runs({status:'running',startedAt:new Date().toISOString(),error:null});
    const promise=(async()=>{
      const project={...video,mcpServers:settings(this.store).mcpServers,allowedDomains:settings(this.store).allowedDomains,collectionContext:collectionContext(video.collectionId&&this.store.getCollection(video.collectionId))};
      const token=randomUUID();this.desktop.tokens?.set(token,{projectId:video.id,actor:'library-researcher:'+randomUUID(),kind:'library-researcher'});
      try{const result=await this.harness.runtimeInvoke({kind:'library-researcher',project,task:{id:'library-researcher',role:'investigador',instruction:'',attempts:1,dependencies:[]},context:{brief:brief||video.prompt,library:(video.assets||[]).map(asset=>({id:asset.id,name:asset.name,kind:asset.kind,scope:asset.scope||'video'}))},attemptDir:path.join(this.harness.folder(video.id),'runs','library-researcher',String(Date.now())),signal:controller.signal,mcpToken:token,onEvent:event=>this.activity(video.id,'library-researcher',event)});validate('library-research',result.output);const latest=this.store.get(video.id);this.harness.addMetrics(latest,result.metrics);this.store.save(latest);runs({status:'completed',summary:result.output.summary,completedAt:new Date().toISOString()});}
      catch(error){runs({status:controller.signal.aborted?'stopped':'failed',error:error.message});}
      finally{this.desktop.tokens?.delete(token);this.active.delete(key);}
    })();
    this.active.set(key,{controller,promise});return {status:'running'};
  }

  // ---------- «Pídeselo a Lumen» ----------
  copilot(collectionId,{request,autoApply=false,createVideos=false}={}){
    if(typeof request!=='string'||request.trim().length<3)throw new Error('Escribe qué quieres.');
    return this.start(collectionId,'copilot',async signal=>{
      const collection=this.store.getCollection(collectionId),{assistContext,copilotPatch,validateCopilot}=await import('./assist.mjs');
      const {output}=await this.invoke(collection,'copilot',{request:request.trim(),...assistContext(this.store,{collectionId})},signal);validateCopilot(output);
      const proposal={id:randomUUID(),request:request.trim(),at:new Date().toISOString(),...copilotPatch(this.store.getCollection(collectionId),output)};
      const latest=this.store.getCollection(collectionId);latest.copilotProposal=proposal;this.store.saveCollection(latest);
      if(autoApply)await this.applyProposal(collectionId,proposal.id,{createVideos});
      return {summary:proposal.summary};
    });
  }
  async applyProposal(collectionId,proposalId,{createVideos=true,videos:selected}={}){
    const collection=this.store.getCollection(collectionId),proposal=collection?.copilotProposal;if(!proposal||proposal.id!==proposalId)throw new Error('La propuesta ya no está disponible.');
    if(Object.keys(proposal.patch).length)updateCollection(this.store,collectionId,proposal.patch,values=>validateCreate({...Object.fromEntries(INHERITED_KEYS.map(key=>[key,values[key]])),prompt:'Validación de ajustes del proyecto',duration:60,sources:[]}));
    const created=[];if(createVideos)for(const [index,video] of proposal.videos.entries()){if(Array.isArray(selected)&&!selected.includes(index))continue;const made=await this.harness.create({prompt:video.prompt,duration:video.duration,sources:[],collectionId,overrides:video.format?{output:{format:video.format}}:{}});const stored=this.store.get(made.id);stored.title=video.title;this.store.save(stored);created.push(made.id);}
    const latest=this.store.getCollection(collectionId);latest.copilotProposal={...proposal,appliedAt:new Date().toISOString(),created};this.store.saveCollection(latest);return {applied:true,created};
  }

  // ---------- Documentalista ----------
  librarian(collectionId){
    return this.start(collectionId,'librarian',async signal=>{
      const collection=this.store.getCollection(collectionId),pending=[];let visual=0,unindexed=0;
      for(const item of mediaItems(collection)){if(!['video','image'].includes(item.kind))continue;visual++;const index=await readIndex(this.folder(collectionId),item.id);if(!index){unindexed++;continue;}const shots=index.shots?.length||(item.kind==='image'?1:0);if(shots&&Object.keys(index.descriptions||{}).length<shots)pending.push({mediaId:item.id,name:item.name,kind:item.kind,shots,described:Object.keys(index.descriptions||{}).length});}
      if(!pending.length)return {summary:!visual?'La biblioteca no tiene imágenes ni vídeos que describir. Súbelos o pide al investigador que busque material multimedia.':unindexed?`Hay ${unindexed} imágenes o vídeos que todavía se están procesando; vuelve a intentarlo en un momento.`:'Todo el material visual ya está descrito.'};
      const {output}=await this.invoke(collection,'librarian',{pending:pending.slice(0,20)},signal);validate('librarian',output);
      await syncCollection(this.store,collectionId,id=>this.harness.folder(id),this.harness.active);
      return {summary:output.summary};
    });
  }
}

// Copia el kit del proyecto en el espacio de una escena del mismo motor y lo marca como de confianza.
export async function installKit(store,collection,workspace,engine){
  const kit=kitOf(collection,engine);if(kit?.status!=='ready')return null;
  const source=kitDir(store,collection.id,engine),target=path.join(workspace,'kit');await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});
  try{await cp(path.join(source,'components'),path.join(target,'components'),{recursive:true});}catch{}
  try{await cp(path.join(source,'KIT.md'),path.join(target,'KIT.md'));}catch{}
  const files=[];const walk=async(dir,prefix)=>{for(const entry of await readdir(dir,{withFileTypes:true}).catch(()=>[])){const rel=prefix+'/'+entry.name;if(entry.isDirectory())await walk(path.join(dir,entry.name),rel);else files.push(rel);}};await walk(target,'kit');await trustFiles(workspace,files);
  return {version:kit.version,components:kit.components||[]};
}
