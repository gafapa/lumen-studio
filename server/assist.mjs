// IA para rellenar: sugerencias por campo (con el contexto del proyecto o del vídeo) y «Pídeselo a Lumen»,
// que traduce una petición en lenguaje natural a cambios concretos del proyecto que el usuario revisa.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {effectiveSettings,collectionContext} from './collections.mjs';
import {collectionAsProject,kitsOf} from './collection-agents.mjs';
import {settings} from './settings.mjs';
import {validate} from './schemas.mjs';

export const FIELDS={
  name:{type:'text',label:'nombre del proyecto',guide:'Un nombre corto y memorable, de 2 a 5 palabras.'},
  objective:{type:'text',label:'objetivo del proyecto',guide:'Qué se quiere conseguir con estos vídeos y para qué, en 1 a 3 frases concretas.'},
  audience:{type:'text',label:'audiencia',guide:'Quién verá los vídeos: perfil, conocimientos previos, contexto de visionado y qué necesita.'},
  styleGuide:{type:'text',label:'guía de estilo',guide:'Guía concreta y accionable en 8 a 15 puntos: tono, ritmo, tipografía y color, cómo usar el material propio, la voz y los subtítulos, y qué evitar.'},
  captionStyle:{type:'text',label:'estilo de subtítulos',guide:'Cómo se ven los subtítulos: posición, tamaño, colores, caja, animación palabra a palabra. Una o dos frases.'},
  rules:{type:'rules',label:'reglas del proyecto',guide:'De 3 a 8 reglas breves y verificables. locked=true solo para las innegociables (marca, legales, accesibilidad).'},
  palette:{type:'palette',label:'paleta de color',guide:'Tres paletas distintas coherentes con el proyecto, con contraste suficiente entre texto y fondo.'},
  videoPrompt:{type:'text',label:'encargo de un vídeo nuevo',guide:'Encargo completo para un vídeo del proyecto: tema, objetivo, estructura en pasos, material de la biblioteca que conviene usar y tono. No repitas vídeos existentes.'},
  creativeBrief:{type:'text',label:'encargo para el director creativo',guide:'Qué serie de vídeos y qué enfoque se pide, en 2 a 4 frases.'},
  researchBrief:{type:'text',label:'encargo para el investigador de la biblioteca',guide:'Qué recursos buscar en la web (imágenes, vídeos, documentos, datos), con qué fuentes y licencias preferidas.'},
  kitInstruction:{type:'text',label:'indicación para el diseñador del kit',guide:'Qué componentes compartidos crear o cambiar (intro, rótulos, subtítulos, cierre, transiciones) y cómo deben verse.'},
  kitComponent:{type:'text',label:'componente nuevo para el kit',guide:'Un componente reutilizable que todavía no exista en el kit (mira project.kit) y que la serie necesite: empieza por su nombre corto, dos puntos, y después qué muestra, qué parámetros admite y cuándo se usa. Ejemplos: «Comparativa: dos columnas…», «Cifra destacada: …», «Paso numerado: …». Una propuesta por sugerencia.'},
  sceneInstruction:{type:'text',label:'cambio para una escena',guide:'Una petición concreta para el programador de la escena: qué se ve, ritmo, material a usar (mediaId y segundos), animaciones y sonido.'},
  narration:{type:'text',label:'narración de la escena',guide:'Texto que se locuta, natural y claro, ajustado a la duración de la escena (unas 145 palabras por minuto).'},
  direction:{type:'text',label:'dirección artística de la escena',guide:'Qué se ve y en qué orden, movimiento, tipografía y material concreto a reutilizar, para que un agente programe la escena.'},
  segments:{type:'segments',label:'secciones recurrentes de la serie',guide:'De 2 a 5 secciones que se repiten en cada vídeo (entradilla, cabecera, sección fija, cierre con llamada a la acción…), con su propósito y si van al principio, al final o donde encajen.'},
  antiPatterns:{type:'rules',label:'cosas que la serie debe evitar',guide:'De 3 a 6 antipatrones visuales o narrativos concretos que no deben aparecer nunca (p. ej. titulares centrados sobre degradado, fundidos lentos genéricos). locked=false.'},
  videoBrief:{type:'text',label:'encargo del vídeo',guide:'Encargo del vídeo: tema, objetivo, estructura, material y tono.'},
};

// Contexto compacto del proyecto (y del vídeo/escena si aplica) para las sugerencias.
export function assistContext(store,{collectionId,videoId,sceneId}){
  const video=videoId?store.get(videoId):null,collection=store.getCollection(collectionId||video?.collectionId);
  const library=(source,scope)=>(source?.assets||[]).slice(0,40).map(asset=>({id:asset.id,scope,name:asset.name,kind:asset.kind,description:asset.description||null,excerpt:source.mediaIndex?.[asset.id]?.excerpt?.slice(0,200)||source.mediaIndex?.[asset.id]?.transcript?.text?.slice(0,200)||null,columns:source.mediaIndex?.[asset.id]?.columns||undefined,duration:source.mediaIndex?.[asset.id]?.duration||undefined}));
  const scene=video?.storyboard?.scenes.find(item=>item.id===sceneId)||null;
  return {
    project:collection?{name:collection.name,objective:collection.objective,audience:collection.audience,styleGuide:collection.styleGuide,rules:collection.rules,notes:(collection.notes||[]).slice(-10),profile:effectiveSettings(collection).values.profile,kit:Object.values(kitsOf(collection)).flatMap(kit=>(kit.components||[]).map(item=>`${item.name} (${kit.engine})`)),videos:store.list().filter(item=>item.collectionId===collection.id).slice(0,30).map(item=>({title:item.title,prompt:item.prompt.slice(0,300),status:item.status}))}:null,
    library:[...library(collection,'project'),...library(video?{assets:(video.assets||[]).filter(asset=>asset.scope!=='project'),mediaIndex:video.mediaIndex}:null,'video')],
    video:video?{title:video.title,prompt:video.prompt,duration:video.duration,format:video.output?.format,scenes:(video.storyboard?.scenes||[]).map(item=>({id:item.id,title:item.title,duration:item.duration,narration:item.narration.slice(0,400),engine:item.engine||'json',direction:(item.direction||'').slice(0,300)}))}:null,
    scene:scene?{id:scene.id,title:scene.title,duration:scene.duration,narration:scene.narration,direction:scene.direction||'',engine:scene.engine||'json',points:scene.points}:null,
  };
}
function ownerProject(store,{collectionId,videoId}){
  const video=videoId?store.get(videoId):null,collection=store.getCollection(collectionId||video?.collectionId);
  const base=video||(collection?collectionAsProject(collection):null);if(!base)throw new Error('Proyecto o vídeo inexistente.');
  return {...base,mcpServers:settings(store).mcpServers,allowedDomains:settings(store).allowedDomains,collectionContext:collectionContext(collection)};
}

// Sugerencias para un campo: varias propuestas que el usuario elige y edita.
export async function suggest(store,harness,{field,collectionId,videoId,sceneId,current='',instruction=''},signal=AbortSignal.timeout(240000)){
  const spec=FIELDS[field];if(!spec)throw new Error('Campo sin asistente: '+field);
  const project=ownerProject(store,{collectionId,videoId}),folder=videoId?harness.folder(videoId):path.join(store.root,'collections',project.id);
  const context={field,label:spec.label,type:spec.type,guide:spec.guide,current:String(current||'').slice(0,20000),instruction:String(instruction||'').slice(0,2000),...assistContext(store,{collectionId,videoId,sceneId})};
  const result=await harness.runtimeInvoke({kind:'assistant',project,task:{id:'assistant',role:'asistente',instruction:'',attempts:1,dependencies:[]},context,attemptDir:path.join(folder,'runs','assistant',Date.now()+'-'+randomUUID().slice(0,6)),signal,onEvent:()=>{}});
  return result.output;
}

// «Pídeselo a Lumen»: convierte la propuesta del modelo en un parche de proyecto revisable.
export function copilotPatch(collection,output){
  const changes=output.changes,patch={},settingsPatch={},profile={},out={},diff=[];
  const set=(key,value,label)=>{if(value!==null&&value!==undefined&&value!==''&&JSON.stringify(value)!==JSON.stringify(collection[key])){patch[key]=value;diff.push({label,value:typeof value==='string'?value:JSON.stringify(value)});}};
  set('name',changes.name,'Nombre');set('objective',changes.objective,'Objetivo');set('audience',changes.audience,'Audiencia');set('styleGuide',changes.styleGuide,'Guía de estilo');
  if(changes.addRules?.length||changes.removeRules?.length){const rules=(collection.rules||[]).filter(rule=>!changes.removeRules.includes(rule.text));for(const rule of changes.addRules)if(!rules.some(item=>item.text===rule.text))rules.push(rule);patch.rules=rules;for(const rule of changes.addRules)diff.push({label:'Nueva regla',value:(rule.locked?'[obligatoria] ':'')+rule.text});for(const text of changes.removeRules)diff.push({label:'Quitar regla',value:text});}
  const map=[['captions','captions','Subtítulos'],['captionStyle','captionStyle','Estilo de subtítulos'],['font','font','Tipografía'],['transition','transition','Transición'],['visualIntensity','visualIntensity','Intensidad visual']];
  for(const [from,to,label] of map)if(changes[from]!=null){profile[to]=changes[from];diff.push({label,value:String(changes[from])});}
  if(changes.voice){profile.voice=changes.voice==='kokoro'?'kokoro:ef_dora':'';diff.push({label:'Voz',value:changes.voice==='kokoro'?'Kokoro neuronal':'Windows'});}
  if(changes.palette){profile.palette=changes.palette;diff.push({label:'Paleta',value:Object.values(changes.palette).join(' · ')});}
  for(const [key,label] of [['format','Formato'],['resolution','Resolución'],['fps','Fotogramas']])if(changes[key]!=null){out[key]=changes[key];diff.push({label,value:String(changes[key])});}
  if(Object.keys(profile).length)settingsPatch.profile=profile;if(Object.keys(out).length)settingsPatch.output=out;
  for(const [key,label] of [['authoring','Autoría'],['runtime','Motor de agentes']])if(changes[key]){settingsPatch[key]=changes[key];diff.push({label,value:changes[key]});}
  if(Object.keys(settingsPatch).length)patch.settings=settingsPatch;
  return {summary:output.summary,patch,diff,videos:output.videos,questions:output.questions};
}
export function validateCopilot(output){return validate('copilot-plan',output);}
