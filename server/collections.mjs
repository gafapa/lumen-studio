// Proyectos (colecciones de vídeos). En la interfaz se llaman «Proyecto»; internamente `collection`,
// porque cada `project` del código heredado representa un vídeo. Un proyecto define ajustes globales
// que cada vídeo hereda (con sobrescrituras por vídeo), su guía de estilo y la configuración de agentes.
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Ajv from 'ajv';
import {kokoroPython} from './media-index.mjs';
// Serialización con claves ordenadas: compara ajustes sin depender del orden de inserción.
export const stable=value=>JSON.stringify(value,(key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(name=>[name,item[name]])):item);

// ---------- Agentes: roles, modelos y esfuerzo ----------
export const AGENT_ROLES=[
  {kind:'creative-director',label:'Director creativo',scope:'project',description:'Guía de estilo y plan de la serie de vídeos.'},
  {kind:'kit-designer',label:'Diseñador del kit',scope:'project',description:'Programa los componentes compartidos (intro, rótulos, subtítulos, cierre).'},
  {kind:'librarian',label:'Documentalista',scope:'project',description:'Describe el material para poder buscarlo.'},
  {kind:'library-researcher',label:'Investigador de biblioteca',scope:'project',description:'Busca en la web imágenes, vídeos, documentos y datos y los añade a la biblioteca.'},
  {kind:'copilot',label:'Pídeselo a Lumen',scope:'project',description:'Convierte tus peticiones en cambios del proyecto y nuevos vídeos.'},
  {kind:'assistant',label:'Asistente de campos',scope:'project',description:'Sugiere y mejora textos y ajustes (botón ✨).'},
  {kind:'plan',label:'Director',scope:'video',description:'Decide el plan de trabajo y los agentes.'},
  {kind:'research',label:'Investigador',scope:'video',description:'Reúne fuentes y verifica datos.'},
  {kind:'script',label:'Guionista',scope:'video',description:'Estructura y redacta la narración.'},
  {kind:'storyboard',label:'Storyboard',scope:'video',description:'Dirige cada escena y elige el material.'},
  {kind:'review',label:'Revisor de contenido',scope:'video',description:'Comprueba exactitud y claridad.'},
  {kind:'resource-review',label:'Revisor de material',scope:'video',description:'Valora imágenes y vídeos candidatos.'},
  {kind:'production-plan',label:'Director de producción',scope:'video',description:'Ordena voz, visuales y render.'},
  {kind:'screencast',label:'Operador del PC',scope:'video',description:'Graba demostraciones en el escritorio.'},
  {kind:'scene-code',label:'Programador de escena',scope:'video',description:'Programa cada escena en HyperFrames, Remotion, Manim o Revideo.'},
  {kind:'scene-critic',label:'Crítico de escenas',scope:'video',description:'Puntúa cada escena con una rúbrica de diseño y pide mejoras.'},
  {kind:'fact-check',label:'Verificador de hechos',scope:'video',description:'Comprueba cifras, comandos, nombres y licencias antes de producir.'},
  {kind:'final-review',label:'Revisor final',scope:'video',description:'Revisa fotogramas, audio y coherencia del MP4.'},
  {kind:'publish',label:'Publicación',scope:'video',description:'Propone título, descripción, capítulos, etiquetas y miniatura.'},
];
export const EFFORTS=['low','medium','high','xhigh','max'];
const CLAUDE_TIERS=['haiku','sonnet','opus','fable'],CODEX_TIERS=['gpt-6-luna','gpt-6.1-sol','gpt-6-astra'];
// Perfil equilibrado. Criterio: cuánto pesa el rol en la calidad final, cuántas veces se llama por vídeo y qué
// necesita (visión, código, web o solo texto).
// - Decisiones creativas de alto impacto y pocas llamadas (dirección creativa, storyboard, kit): el modelo más capaz.
// - Lo que más se repite (programar escenas, criticarlas): un modelo intermedio con esfuerzo alto o medio; el crítico
//   usa el mismo nivel que el programador para que su juicio no quede por debajo del trabajo que evalúa.
// - Verificar datos y la revisión final, una o dos llamadas por vídeo pero con errores caros: intermedio con esfuerzo alto.
// - Triaje visual y tareas mecánicas (describir material, valorar recursos, ordenar la producción): el más económico.
// - Textos rápidos para la interfaz (asistente, «Pídeselo a Lumen», publicación): intermedio con esfuerzo bajo.
const BALANCED={
  claude:{'creative-director':['opus','high'],storyboard:['opus','high'],'kit-designer':['opus','medium'],
    'scene-code':['sonnet','medium'],'scene-critic':['sonnet','medium'],'final-review':['sonnet','high'],'fact-check':['sonnet','high'],
    research:['sonnet','medium'],script:['sonnet','medium'],review:['sonnet','medium'],'library-researcher':['sonnet','medium'],screencast:['sonnet','medium'],
    plan:['sonnet','low'],copilot:['sonnet','low'],assistant:['sonnet','low'],publish:['sonnet','low'],
    librarian:['haiku','low'],'resource-review':['haiku','low'],'production-plan':['haiku','low']},
  codex:{'creative-director':['gpt-6-astra','high'],storyboard:['gpt-6-astra','medium'],'kit-designer':['gpt-6.1-sol','xhigh'],
    'scene-code':['gpt-6.1-sol','medium'],'scene-critic':['gpt-6.1-sol','medium'],'final-review':['gpt-6.1-sol','high'],'fact-check':['gpt-6.1-sol','high'],
    research:['gpt-6.1-sol','medium'],script:['gpt-6.1-sol','medium'],review:['gpt-6.1-sol','medium'],'library-researcher':['gpt-6.1-sol','medium'],screencast:['gpt-6.1-sol','medium'],
    plan:['gpt-6.1-sol','low'],copilot:['gpt-6.1-sol','low'],publish:['gpt-6.1-sol','low'],assistant:['gpt-6-luna','medium'],
    librarian:['gpt-6-luna','low'],'resource-review':['gpt-6-luna','low'],'production-plan':['gpt-6-luna','low']},
};
// Perfiles de gasto definidos rol a rol (no un desplazamiento uniforme): el ahorro recorta donde menos se nota
// (crítica, textos de interfaz, triaje) y mantiene un modelo competente para programar y dirigir; la calidad sube
// los roles que deciden el resultado sin disparar el coste de los que se llaman a menudo o deben responder rápido.
const ECONOMY={
  claude:{'creative-director':['sonnet','high'],storyboard:['sonnet','high'],'kit-designer':['sonnet','high'],
    'scene-code':['sonnet','medium'],'scene-critic':['sonnet','low'],'final-review':['sonnet','medium'],'fact-check':['sonnet','medium'],
    research:['sonnet','low'],script:['sonnet','low'],review:['haiku','low'],'library-researcher':['sonnet','low'],screencast:['sonnet','low'],
    plan:['haiku','low'],copilot:['sonnet','low'],assistant:['haiku','low'],publish:['haiku','low'],
    librarian:['haiku','low'],'resource-review':['haiku','low'],'production-plan':['haiku','low']},
  codex:{'creative-director':['gpt-6.1-sol','high'],storyboard:['gpt-6.1-sol','high'],'kit-designer':['gpt-6.1-sol','high'],
    'scene-code':['gpt-6.1-sol','medium'],'scene-critic':['gpt-6.1-sol','low'],'final-review':['gpt-6.1-sol','medium'],'fact-check':['gpt-6.1-sol','medium'],
    research:['gpt-6.1-sol','low'],script:['gpt-6.1-sol','low'],review:['gpt-6-luna','medium'],'library-researcher':['gpt-6.1-sol','low'],screencast:['gpt-6.1-sol','low'],
    plan:['gpt-6-luna','low'],copilot:['gpt-6-luna','medium'],assistant:['gpt-6-luna','low'],publish:['gpt-6-luna','low'],
    librarian:['gpt-6-luna','low'],'resource-review':['gpt-6-luna','low'],'production-plan':['gpt-6-luna','low']},
};
const QUALITY={
  claude:{'creative-director':['opus','xhigh'],storyboard:['opus','xhigh'],'kit-designer':['opus','high'],
    'scene-code':['opus','high'],'scene-critic':['opus','medium'],'final-review':['opus','high'],'fact-check':['opus','high'],
    research:['sonnet','high'],script:['opus','medium'],review:['sonnet','high'],'library-researcher':['sonnet','high'],screencast:['sonnet','high'],
    plan:['sonnet','medium'],copilot:['sonnet','medium'],assistant:['sonnet','low'],publish:['sonnet','medium'],
    librarian:['sonnet','low'],'resource-review':['sonnet','low'],'production-plan':['haiku','low']},
  codex:{'creative-director':['gpt-6-astra','xhigh'],storyboard:['gpt-6-astra','high'],'kit-designer':['gpt-6-astra','high'],
    'scene-code':['gpt-6.1-sol','xhigh'],'scene-critic':['gpt-6-astra','medium'],'final-review':['gpt-6-astra','high'],'fact-check':['gpt-6-astra','high'],
    research:['gpt-6.1-sol','high'],script:['gpt-6-astra','medium'],review:['gpt-6.1-sol','high'],'library-researcher':['gpt-6.1-sol','high'],screencast:['gpt-6.1-sol','high'],
    plan:['gpt-6.1-sol','medium'],copilot:['gpt-6.1-sol','medium'],assistant:['gpt-6.1-sol','low'],publish:['gpt-6.1-sol','medium'],
    librarian:['gpt-6.1-sol','low'],'resource-review':['gpt-6.1-sol','low'],'production-plan':['gpt-6-luna','low']},
};
const PRESETS={economy:ECONOMY,balanced:BALANCED,quality:QUALITY};
export function agentPreset(runtime,preset='balanced'){
  const table={...BALANCED[runtime],...(PRESETS[preset]||BALANCED)[runtime]};
  return Object.fromEntries(Object.entries(table).map(([kind,[model,effort]])=>[kind,{model,effort}]));
}
export function availableModels(){
  let codex=CODEX_TIERS.map(slug=>({slug,label:slug,efforts:EFFORTS}));
  try{const cache=JSON.parse(readFileSync(path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'models_cache.json'),'utf8'));const listed=(cache.models||[]).filter(model=>model.visibility==='list').map(model=>({slug:model.slug,label:model.display_name||model.slug,description:model.description,efforts:(model.supported_reasoning_levels||[]).map(level=>level.effort).filter(effort=>EFFORTS.includes(effort))}));if(listed.length)codex=listed;}catch{}
  return {claude:[{slug:'haiku',label:'Haiku',description:'Rápido y económico; tareas simples y triaje visual.',efforts:[]},{slug:'sonnet',label:'Sonnet',description:'Equilibrio entre calidad y coste.',efforts:EFFORTS},{slug:'opus',label:'Opus',description:'Máxima calidad para dirección creativa y código difícil.',efforts:EFFORTS},{slug:'fable',label:'Fable',description:'El más capaz; consumo alto.',efforts:EFFORTS}],codex,roles:AGENT_ROLES,efforts:EFFORTS,presets:{economy:'Ahorro',balanced:'Equilibrado',quality:'Calidad'}};
}
// Argumentos de CLI para el modelo y esfuerzo del rol. Haiku no admite nivel de esfuerzo.
export function roleSettings(project,kind){const runtime=project.runtime;if(!['claude','codex'].includes(runtime))return null;return project.agents?.[runtime]?.[kind]||agentPreset(runtime)[kind]||null;}
export function modelArgs(runtime,role){
  if(!role?.model)return [];
  if(runtime==='claude')return ['--model',role.model,...(role.effort&&role.model!=='haiku'?['--effort',role.effort]:[])];
  return ['-m',role.model,...(role.effort?['-c',`model_reasoning_effort="${role.effort}"`]:[])];
}

// ---------- Ajustes heredables ----------
export const INHERITED_KEYS=['runtime','architecture','context','concurrency','style','renderer','authoring','output','options','profile','agents','desktop'];
export function defaultSettings(){return {runtime:'claude',architecture:'single',context:'minimal',concurrency:2,style:'editorial',renderer:'remotion',authoring:'code',desktop:false,output:{format:'landscape',resolution:'720p',fps:30},options:{finalReview:true,replan:true,autonomousProduction:true,audioReview:true,storyboardApproval:true,critic:true,criticRounds:1,factCheck:true,publish:true,budgetTokens:5000000,budgetCost:null},profile:{visualIntensity:'cinematic',loudness:-14,captions:false,...(kokoroPython()?{voice:'kokoro:ef_dora'}:{})},agents:{claude:agentPreset('claude'),codex:agentPreset('codex')}};}
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
export function deepMerge(...layers){const result={};for(const layer of layers)if(plain(layer))for(const [key,value] of Object.entries(layer)){if(value===undefined)continue;result[key]=plain(value)&&plain(result[key])?deepMerge(result[key],value):structuredClone(value);}return result;}
// Valores efectivos y su origen (app, proyecto o vídeo) para mostrarlos en la interfaz.
export function effectiveSettings(collection,overrides={}){
  const base=defaultSettings(),values=deepMerge(base,collection?.settings||{},overrides),origins={};
  if(values.runtime==='demo')for(const key of ['autonomousProduction','audioReview','storyboardApproval','critic'])if(collection?.settings?.options?.[key]===undefined&&overrides?.options?.[key]===undefined)values.options[key]=false;
  const walk=(value,prefix)=>{for(const [key,item] of Object.entries(value)){const name=prefix?prefix+'.'+key:key;if(plain(item)&&!/^agents\.[a-z]+\./.test(name+'.x'))walk(item,name);else{const at=source=>name.split('.').reduce((node,part)=>node?.[part],source);origins[name]=at(overrides)!==undefined?'video':at(collection?.settings||{})!==undefined?'project':'app';}}};
  walk(values,'');return {values,origins};
}
export const inheritedHash=values=>createHash('sha256').update(JSON.stringify(INHERITED_KEYS.map(key=>values[key]))).digest('hex').slice(0,16);

// ---------- Validación ----------
const ajv=new Ajv({allErrors:true,strict:false});
const roleSchema={type:'object',properties:{model:{type:'string',pattern:'^[a-z0-9.-]{2,60}$'},effort:{enum:EFFORTS}},required:['model'],additionalProperties:false};
const agentsSchema={type:'object',properties:{claude:{type:'object',additionalProperties:roleSchema},codex:{type:'object',additionalProperties:roleSchema}},additionalProperties:false};
export const collectionSchema={type:'object',properties:{id:{type:'string'},createdAt:{type:'string'},updatedAt:{type:'string'},kit:{type:'object'},kits:{type:'object'},bible:{type:'object'},styleFrames:{type:'array'},styleReference:{type:['object','null']},exemplars:{type:'array'},agentRuns:{type:'object'},metrics:{type:'object'},seriesPlan:{type:'object'},copilotProposal:{type:'object'},assets:{type:'array'},mediaIndex:{type:'object'},sources:{type:'array'},name:{type:'string',minLength:1,maxLength:120},objective:{type:'string',maxLength:4000},audience:{type:'string',maxLength:1000},styleGuide:{type:'string',maxLength:20000},rules:{type:'array',maxItems:60,items:{type:'object',properties:{id:{type:'string'},text:{type:'string',minLength:1,maxLength:500},locked:{type:'boolean'}},required:['text'],additionalProperties:false}},notes:{type:'array',maxItems:200,items:{type:'object',properties:{id:{type:'string'},text:{type:'string',maxLength:500},at:{type:'string'},source:{type:'string'}},additionalProperties:false}},settings:{type:'object'}},additionalProperties:false};
const validateCollection=ajv.compile(collectionSchema);
export {agentsSchema};

export function collectionContext(collection){
  if(!collection)return '';
  const rules=(collection.rules||[]).map(rule=>`- ${rule.locked?'[OBLIGATORIA] ':''}${rule.text}`).join('\n'),notes=(collection.notes||[]).slice(-20).map(note=>'- '+note.text).join('\n');
  return [`Proyecto «${collection.name}». Este vídeo forma parte de él y debe ser coherente con el resto.`,collection.objective?'Objetivo del proyecto: '+collection.objective:'',collection.audience?'Audiencia: '+collection.audience:'',collection.styleGuide?'Guía de estilo:\n'+collection.styleGuide:'',rules?'Reglas del proyecto (las OBLIGATORIAS prevalecen sobre el encargo del vídeo; el resto son preferencias que el encargo puede ajustar):\n'+rules:'',notes?'Decisiones aprendidas en el proyecto:\n'+notes:'',collection.bible?.segments?.length?`Secciones recurrentes de la serie (inclúyelas en cada vídeo donde corresponda, con los componentes del kit si existen): ${collection.bible.segments.map(segment=>`${segment.name} [${segment.placement==='opening'?'al principio':segment.placement==='closing'?'al final':'donde encaje'}]: ${segment.purpose}`).join('; ')}.`:'',
    collection.bible?.taste?`Carácter visual de la serie: movimiento ${collection.bible.taste.motionIntensity||'equilibrado'}, densidad ${collection.bible.taste.density||'equilibrada'}, variedad ${collection.bible.taste.visualVariance||'coherente'}.${collection.bible.taste.antiPatterns?.length?' Evita siempre: '+collection.bible.taste.antiPatterns.join('; ')+'.':''}`:'',
    collection.styleReference?.status==='ready'?collection.styleReference.brief:'',
    collection.styleFrames?.length?'El proyecto tiene fotogramas de estilo aprobados: cada escena se compara con ellos para juzgar la coherencia.':'',
    ...Object.values({...collection.kits,...(collection.kit?.engine&&!collection.kits?.[collection.kit.engine]?{[collection.kit.engine]:collection.kit}:{})}).filter(kit=>kit?.status==='ready').map(kit=>`Kit de escenas ${kit.engine} del proyecto: ${(kit.components||[]).map(item=>item.name+' — '+item.description).join('; ')}. Las escenas ${kit.engine} lo reciben en kit/; dirígelas para que usen estos componentes.`)].filter(Boolean).join('\n\n');
}

export function createCollection(store,input,validateSettings){
  const value={id:randomUUID(),name:String(input.name||'Proyecto sin título').slice(0,120),objective:input.objective||'',audience:input.audience||'',styleGuide:input.styleGuide||'',rules:(input.rules||[]).map(rule=>({id:rule.id||randomUUID(),text:rule.text,locked:Boolean(rule.locked)})),notes:[],settings:input.settings||{},createdAt:new Date().toISOString()};
  if(!validateCollection(value))throw new Error('Proyecto inválido: '+ajv.errorsText(validateCollection.errors));
  validateSettings(effectiveSettings(value).values);return store.saveCollection(value);
}
export function updateCollection(store,id,changes,validateSettings){
  const current=store.getCollection(id);if(!current)throw new Error('Proyecto inexistente.');
  const next={...current,...changes,id,settings:changes.settings?deepMerge(current.settings,changes.settings):current.settings};
  if(changes.settings?.agents)next.settings.agents={...current.settings?.agents,...changes.settings.agents};
  if(next.rules)next.rules=next.rules.map(rule=>({id:rule.id||randomUUID(),text:rule.text,locked:Boolean(rule.locked)}));
  const {createdAt,updatedAt,...checked}=next;if(!validateCollection(checked))throw new Error('Proyecto inválido: '+ajv.errorsText(validateCollection.errors));
  validateSettings(effectiveSettings(next).values);store.saveCollection(next);return next;
}
// Vídeos cuyos valores heredados difieren de los efectivos actuales del proyecto.
export function staleVideos(store,collection){
  return store.list().filter(video=>video.collectionId===collection.id).map(video=>{const {values}=effectiveSettings(collection,video.overrides||{});const changed=INHERITED_KEYS.filter(key=>stable(values[key])!==stable(video[key]));return {videoId:video.id,title:video.title,changed,values};}).filter(item=>item.changed.length);
}
