// Crítico independiente de escenas: un agente distinto del programador puntúa fotogramas reales con una rúbrica
// de diseño de movimiento y compara con los fotogramas de estilo del proyecto. Solo se aceptan versiones mejores.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readdir,mkdir,copyFile,stat} from 'node:fs/promises';

export const RUBRIC=[
  {key:'hierarchy',label:'Jerarquía',anchor:'0: todo compite; 3: hay un foco claro casi siempre; 5: un único elemento principal por plano, apoyos subordinados y lectura inmediata.'},
  {key:'readability',label:'Legibilidad',anchor:'0: texto cortado, tapado o ilegible; 3: legible con algún roce; 5: todo el texto legible a tiempo, contraste alto, dentro de las zonas seguras y sin tapar los subtítulos.'},
  {key:'motionPurpose',label:'Propósito del movimiento',anchor:'0: animaciones gratuitas o fundidos genéricos; 3: el movimiento acompaña; 5: cada movimiento explica algo, guía la mirada y está sincronizado con la narración.'},
  {key:'rhythm',label:'Ritmo',anchor:'0: planos estáticos largos o todo animado en un solo plano; 3: ritmo correcto; 5: cortes con intención cada 1,5–4 s, sin esperas muertas y con respiración en los momentos clave.'},
  {key:'consistency',label:'Coherencia con la serie',anchor:'0: no parece del mismo proyecto; 3: respeta paleta y tipografía; 5: indistinguible de los fotogramas de estilo, usa el kit y los tokens del proyecto.'},
  {key:'originality',label:'Originalidad',anchor:'0: titular centrado sobre degradado, plantilla obvia; 3: composición correcta; 5: composición descentrada con contraste de escala, uso del material real e ideas visuales propias del contenido.'},
];
export const scoreOf=critique=>RUBRIC.reduce((sum,item)=>sum+(Number(critique?.scores?.[item.key])||0),0);
export const MAX_SCORE=RUBRIC.length*5;

// Instantes que se revisan: inicio, centro de cada plano y final.
export function critiqueTimes(brief){
  const end=Math.max(0.2,brief.durationSeconds-0.35),shots=(brief.shots||[]).map(shot=>shot.start+Math.min(shot.duration*0.6,shot.duration-0.1));
  const times=[0.6,...shots,brief.durationSeconds/2,end].filter(time=>time>=0&&time<=brief.durationSeconds).map(time=>Math.round(time*100)/100);
  return [...new Set(times)].sort((a,b)=>a-b).slice(0,8);
}

// Fotogramas de estilo del proyecto: imágenes de referencia aprobadas (vista previa del kit o imágenes de la biblioteca).
export async function styleFramePaths(store,collection){
  const folder=path.join(store.root,'collections',collection?.id||'-','style-frames'),result=[];
  for(const frame of collection?.styleFrames||[]){const file=path.join(folder,frame.file);try{await stat(file);result.push({path:file,note:frame.note||frame.source});}catch{}}
  if(collection?.styleReference?.status==='ready'){const shots=path.join(store.root,'collections',collection.id,'reference',collection.styleReference.files.shots);try{await stat(shots);result.unshift({path:shots,note:'Referencia de estilo: un fotograma por plano (toma su gramática, no su contenido)'});}catch{}}
  return result.slice(0,5);
}
// Guarda como fotogramas de estilo las capturas más recientes de la vista previa del kit.
export async function styleFramesFromKit(store,collection,kitDirectory,engine=null){
  let runs=[];try{runs=(await readdir(path.join(kitDirectory,'snapshots'))).sort().reverse();}catch{}
  if(!runs[0])return collection.styleFrames||[];
  const files=(await readdir(path.join(kitDirectory,'snapshots',runs[0]))).filter(file=>file.endsWith('.png')).sort(),picked=files.filter((_,index)=>index%Math.max(1,Math.ceil(files.length/4))===0).slice(0,4);
  const folder=path.join(store.root,'collections',collection.id,'style-frames');await mkdir(folder,{recursive:true});
  const frames=(collection.styleFrames||[]).filter(frame=>frame.source!=='kit'||(frame.engine||null)!==engine&&frame.engine);
  for(const file of picked){const name='kit-'+randomUUID().slice(0,8)+'.png';await copyFile(path.join(kitDirectory,'snapshots',runs[0],file),path.join(folder,name));frames.push({id:randomUUID(),file:name,source:'kit',engine,note:'Vista previa del kit'+(engine?' '+engine:'')});}
  return frames.slice(-8);
}

export function criticPrompt(project,context,schema){
  return [
    'Eres el crítico de diseño de movimiento de Lumen. NO programas: evalúas con exigencia profesional una escena ya programada por otro agente, mirando sus fotogramas reales. Sé escéptico: los programadores tienden a sobrevalorar su trabajo.',
    project.collectionContext||'',
    `Escena «${context.scene.title}» (${context.scene.durationSeconds} s, ${context.scene.engine}). Narración: ${context.scene.narration}\nDirección: ${context.scene.direction||'—'}\nPlanos previstos: ${JSON.stringify(context.scene.shots||[])}\nSubtítulos incrustados: ${context.scene.captions?'sí':'no'}`,
    `Imágenes de la escena (ábrelas TODAS con Read; en Codex llegan adjuntas): ${frameList(context.frames)}. ${STAMP_RULE}`,
    context.measured?.length?`Avisos medidos por Lumen en el navegador (confírmalos en las imágenes antes de darlos por buenos): ${context.measured.map(item=>`[${item.rule}${item.time!=null?' · '+item.time+' s':''}] ${item.message}`).join(' | ')}`:'',
    `Pregúntate también:\n${REVIEW_QUESTIONS.map((question,index)=>`${index+1}. ${question}`).join('\n')}`,
    context.styleFrames.length?`Fotogramas de estilo del proyecto (la referencia de coherencia; ábrelos también): ${context.styleFrames.map(frame=>frame.path).join(' | ')}`:'El proyecto no tiene fotogramas de estilo: juzga la coherencia con la guía y la identidad.',
    context.previous?`Ronda anterior: ${context.previous.score}/${MAX_SCORE}. Problemas que debían corregirse: ${context.previous.issues.map(issue=>issue.message).join(' | ')}`:'',
    `Rúbrica (0–5 por criterio, usa las anclas):\n${RUBRIC.map(item=>`- ${item.key} (${item.label}): ${item.anchor}`).join('\n')}`,
    `verdict=accept solo si no hay errores y la suma es al menos ${Math.round(MAX_SCORE*0.7)}/${MAX_SCORE}; si no, revise. issues: problemas concretos y accionables (qué, en qué segundo exacto, cómo arreglarlo); los problemas sin segundo se descartan; severidad error si impide la calidad profesional. strengths: lo que debe conservarse. wouldPost: ¿la publicarías tal cual?, con una razón en wouldPostReason; es un juicio aparte de la nota. poster: el segundo del mejor fotograma para miniatura. Si no pudiste abrir un fotograma, dilo y no apruebes.`,
    `Contrato de salida:\n${JSON.stringify(schema)}`,
  ].filter(Boolean).join('\n\n');
}

// Preguntas que se hace todo revisor (adaptadas de Showtime, references/review.md).
export const REVIEW_QUESTIONS=['Gancho: ¿en el primer segundo y medio se entiende de qué va y apetece seguir?','Claridad: al terminar, ¿se puede decir qué se ha contado y para quién?','Legibilidad: ¿algún texto es demasiado pequeño, demasiado breve, con poco contraste o tapado?','Oficio: alineación, espacios, tipografía y color coherentes, transiciones limpias (mira los fotogramas a mitad de transición) y ningún efecto que el tono no justifique. Revisa los recortes de texto a tamaño real: líneas base, tamaños y pesos iguales, sin viudas.','Personalidad: ¿estos fotogramas podrían pertenecer a otro producto sin cambiar nada?','Póster: ¿qué fotograma publicarías como miniatura?','Honestidad: ¿algo parece una cifra, una cita o una interfaz inventada presentada como real?','Lógica: para cada plano, ¿qué cree un desconocido que es y por qué está ahí?'];
const STAMP_RULE='Cada imagen lleva en una esquina un código amarillo de 5 cifras. Devuelve en seenCodes los códigos de TODAS las imágenes que hayas abierto, exactamente como aparecen; si no puedes abrir una, no inventes su código y dilo. Una revisión sin los códigos se descarta.';
const frameList=frames=>frames.map(frame=>`${frame.label||(frame.time!=null?frame.time+' s':'')} → ${frame.path}`).join(' | ');

// Comparación a ciegas (desde la segunda ronda): dos versiones X e Y con la misma evidencia; sin puntuaciones.
export function pairwisePrompt(project,context,schema){
  const [first,second]=context.order==='YX'?['Y','X']:['X','Y'];
  return [
    'Eres un crítico de diseño de movimiento. NO programas. Comparas dos versiones de la misma escena, X e Y, sin saber cuál es la nueva. Una nota numérica de un modelo es ruido: aquí no hay puntuaciones, solo una preferencia razonada, los problemas localizados y un veredicto absoluto por versión.',
    project.collectionContext||'',
    `Escena «${context.scene.title}» (${context.scene.durationSeconds} s). Narración: ${context.scene.narration}\nDirección: ${context.scene.direction||'—'}`,
    `Versión ${first}: ${frameList(context.versions[first])}`,
    `Versión ${second}: ${frameList(context.versions[second])}`,
    context.styleFrames?.length?`Fotogramas de estilo del proyecto (referencia de coherencia): ${context.styleFrames.map(frame=>frame.path).join(' | ')}`:'',
    `Ábrelas TODAS con Read (en Codex llegan adjuntas). ${STAMP_RULE}`,
    `Pregúntate para cada versión:\n${REVIEW_QUESTIONS.map((question,index)=>`${index+1}. ${question}`).join('\n')}`,
    'preferred: la versión que publicarías antes (X, Y o tie si de verdad no hay diferencia). reason: una frase con el motivo principal. wouldPost: para cada versión por separado, ¿la publicarías tal cual? issues: problemas de cada versión (video X o Y), cada uno con el segundo exacto en que se ve; los problemas sin segundo se descartan. Severidad error si impide la calidad profesional.',
    `Contrato de salida:\n${JSON.stringify(schema)}`,
  ].filter(Boolean).join('\n\n');
}
