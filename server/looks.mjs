// Historial de «looks» (idea de Showtime, references/reference.md §1): qué aspecto tuvo cada vídeo terminado
// (paleta, tipografía, transiciones, componentes, apertura, cierre y estructura) para que el siguiente no se
// repita. Dentro de una serie se mantienen paleta y tipografía a propósito y se varía el resto.
import path from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';

const file=store=>path.join(store.root,'history','looks.json');
async function load(store){try{return JSON.parse(await readFile(file(store),'utf8'));}catch{return [];}}
const shape=durations=>durations.map(value=>value<3?'c':value<6?'m':'l').join('');

export function lookOf(project){
  const scenes=project.storyboard?.scenes||[],transitions={};for(const scene of scenes.slice(1)){const key=scene.transition||'fade';transitions[key]=(transitions[key]||0)+1;}
  const primary=Object.entries(transitions).sort((a,b)=>b[1]-a[1])[0]?.[0]||null,first=scenes[0],last=scenes.at(-1);
  return {videoId:project.id,title:project.title,collectionId:project.collectionId||null,at:new Date().toISOString(),palette:project.profile?.palette||null,font:project.profile?.font||null,
    transitions,primaryTransition:primary,components:scenes.map(scene=>scene.component||null),opening:first?.component||first?.type||null,closing:last?.component||last?.type||null,
    structure:{scenes:scenes.length,duration:Math.round(scenes.reduce((sum,scene)=>sum+(scene.duration||0),0)),shape:shape(scenes.map(scene=>scene.duration||0))},captions:Boolean(project.profile?.captions),engines:[...new Set(scenes.map(scene=>scene.engine).filter(Boolean))]};
}
export async function recordLook(store,project){
  if(!project.storyboard?.scenes?.length)return null;const looks=(await load(store)).filter(item=>item.videoId!==project.id),look=lookOf(project);
  looks.push(look);await mkdir(path.dirname(file(store)),{recursive:true});await writeFile(file(store),JSON.stringify(looks.slice(-200),null,1));return look;
}
// Los cinco últimos vídeos terminados (de la misma serie primero).
export async function recentLooks(store,project,limit=5){const looks=(await load(store)).filter(item=>item.videoId!==project.id);const same=looks.filter(item=>project.collectionId&&item.collectionId===project.collectionId);return [...same,...looks.filter(item=>!same.includes(item))].slice(-limit*2).sort((a,b)=>String(a.at).localeCompare(String(b.at))).slice(-limit);}
// Repeticiones del storyboard actual frente a los últimos vídeos, con alternativas.
export async function lookRepeat(store,project,{kitComponents=[]}={}){
  const recent=await recentLooks(store,project),current=lookOf(project),warnings=[];if(!recent.length)return {warnings,compared:0};
  const usedComponents=new Set(recent.flatMap(item=>item.components).filter(Boolean)),freshComponents=kitComponents.filter(name=>!usedComponents.has(name)).slice(0,3);
  const sameOpening=recent.filter(item=>item.opening&&item.opening===current.opening);
  if(sameOpening.length>=2)warnings.push({rule:'look_repeat',what:'apertura',message:`Empieza igual que ${sameOpening.length} de los últimos ${recent.length} vídeos («${current.opening}»).`,alternatives:freshComponents.length?freshComponents.map(name=>`abrir con «${name}»`):['abrir con el problema real o un dato sorprendente en lugar de la intro habitual']});
  const sameClosing=recent.filter(item=>item.closing&&item.closing===current.closing);
  if(sameClosing.length>=3)warnings.push({rule:'look_repeat',what:'cierre',message:`Termina igual que ${sameClosing.length} de los últimos ${recent.length} vídeos («${current.closing}»).`,alternatives:['variar el cierre: una pregunta, una cifra final o una vuelta al gancho inicial']});
  const sameTransition=recent.filter(item=>item.primaryTransition&&item.primaryTransition===current.primaryTransition);
  if(current.primaryTransition&&sameTransition.length>=3){const used=new Set(recent.map(item=>item.primaryTransition));warnings.push({rule:'look_repeat',what:'transición principal',message:`La transición principal («${current.primaryTransition}») es la misma que en ${sameTransition.length} de los últimos ${recent.length} vídeos.`,alternatives:['cut','fade','slide','wipe','zoom'].filter(name=>!used.has(name)).slice(0,2).map(name=>`usar «${name}» como transición principal`)});}
  const sameShape=recent.filter(item=>item.structure?.shape&&item.structure.shape===current.structure.shape);
  if(sameShape.length>=2)warnings.push({rule:'look_repeat',what:'estructura',message:`Tiene la misma estructura de escenas (${current.structure.scenes} escenas, ritmo «${current.structure.shape}») que ${sameShape.length} vídeos recientes.`,alternatives:['alternar escenas cortas y largas de otra forma (corta-corta-larga)','cambiar el orden: empezar por la demostración y explicar después']});
  const sequence=list=>list.filter(Boolean).slice(0,3).join('>');
  const sameSequence=recent.filter(item=>sequence(item.components)&&sequence(item.components)===sequence(current.components));
  if(sameSequence.length)warnings.push({rule:'look_repeat',what:'secuencia de componentes',message:`Las tres primeras escenas usan los mismos componentes en el mismo orden que «${sameSequence.at(-1).title}».`,alternatives:freshComponents.length?freshComponents.map(name=>`incluir «${name}» al principio`):['reordenar las primeras escenas']});
  return {warnings,compared:recent.length};
}
// Resumen para el storyboard: qué evitar repetir.
export function looksBrief(recent){return recent.map(item=>({title:item.title,opening:item.opening,closing:item.closing,primaryTransition:item.primaryTransition,structure:item.structure,components:item.components.filter(Boolean)}));}
