import {defaultProductionPlan} from './production-plan.mjs';
const base=[
  ['Qué es DHCP','Tu equipo acaba de conectarse a una red. Para comunicarse necesita una dirección IP y otros parámetros. DHCP automatiza esa configuración para que no tengas que introducirla a mano.','title',['Una dirección para tu equipo','Configuración automática']],
  ['Una red que se organiza sola','Piensa en una recepción que asigna habitaciones. El servidor DHCP administra direcciones disponibles y ofrece una a cada dispositivo. También puede comunicar la máscara de subred, la puerta de enlace y los servidores DNS.','diagram',['Tu dispositivo','Servidor DHCP','Configuración de red']],
  ['Cuatro mensajes, una conexión','En una asignación inicial habitual, el cliente descubre servidores con DHCP Discover. Un servidor propone una configuración con Offer. El cliente solicita la oferta con Request y el servidor confirma con Acknowledge.','diagram',['Discover','Offer','Request','Acknowledge']],
  ['Una dirección prestada','La dirección se concede durante un periodo llamado concesión. Antes de que termine, el cliente intenta renovarla. Esto permite reutilizar direcciones cuando los equipos abandonan la red.','bullets',['Asignación temporal','Renovación de la concesión','Reutilización de direcciones']],
  ['Automática o manual','La configuración automática facilita administrar muchos dispositivos. Una configuración manual exige elegir parámetros compatibles y evitar direcciones duplicadas. Un servidor también puede reservar una dirección para un dispositivo concreto.','comparison',['Automática: gestión centralizada','Manual: configuración por equipo']],
  ['Lo que debes recordar','DHCP configura parámetros de red. DNS resuelve nombres: cumple una función diferente. DHCP no garantiza por sí solo que tengas acceso a Internet. Recuerda la secuencia de asignación: descubrir, ofrecer, solicitar y confirmar.','bullets',['DHCP configura la red','DNS resuelve nombres','Discover → Offer → Request → ACK']],
];
export function demoStoryboard(project) {
  const count=Math.min(6,Math.max(2,Math.round(project.duration/20)));
  const short=['DHCP asigna automáticamente una dirección IP y parámetros de red a tu dispositivo.','El servidor administra direcciones disponibles y comunica cómo conectarte con los otros equipos.'];
  return {title:'DHCP: una dirección para cada dispositivo',scenes:base.slice(0,count).map(([title,narration,type,points],index)=>({id:`scene-${String(index+1).padStart(2,'0')}`,title,narration:project.duration<30?short[index]:narration,type,points,duration:project.duration/count,eyebrow:index===0?'REDES · CONCEPTOS ESENCIALES':`PASO ${String(index+1).padStart(2,'0')}`,sourceIds:['rfc2131']}))};
}
export async function demoRun(kind,project) {
  await new Promise(resolve=>setTimeout(resolve,650));
  if(kind==='plan')return {reasoning:'Demostración fija de DHCP. Este modo comprueba la interfaz y el pipeline; no mide la capacidad de un modelo.',tasks:[
    {id:'research',label:'Reunir los conceptos',role:'investigador',kind:'research',dependencies:[],instruction:'Preparar fuentes y conceptos.'},
    {id:'script',label:'Escribir el guion',role:'guionista',kind:'script',dependencies:['research'],instruction:'Explicar el tema para principiantes.'},
    {id:'storyboard',label:'Diseñar las escenas',role:'storyboard',kind:'storyboard',dependencies:['script'],instruction:'Crear escenas con diagramas y textos breves.'},
    {id:'review',label:'Revisar el contenido',role:'revisor',kind:'review',dependencies:['research','storyboard'],instruction:'Comprobar consistencia y fuentes.'},
  ]};
  if(kind==='production-plan')return defaultProductionPlan(project,project.tasks.find(task=>task.kind==='storyboard')?.id||'storyboard');
  if(kind==='final-review')return {approved:project.technicalReview?.approved!==false&&project.audioReview?.approved!==false,summary:'Revisión de demostración basada en los análisis técnicos; no evalúa un modelo.',issues:[]};
  if(kind==='research')return {summary:'Demostración preparada sobre DHCP. La fuente base es RFC 2131.',sources:[{id:'rfc2131',title:'RFC 2131 — Dynamic Host Configuration Protocol',url:'https://www.rfc-editor.org/rfc/rfc2131',claims:['DHCP permite asignar parámetros de configuración de red.','La asignación inicial puede usar Discover, Offer, Request y ACK.','Las direcciones pueden concederse durante un tiempo limitado.']}]};
  if(kind==='script')return {title:'Qué es DHCP',scenes:demoStoryboard(project).scenes.map(({id,title,narration,sourceIds})=>({id,title,narration,sourceIds}))};
  if(kind==='storyboard'){const board=demoStoryboard(project);if(project.authoring==='code')board.scenes=board.scenes.map((scene,index)=>({...scene,engine:index%2?'remotion':'hyperframes',direction:'Composición de demostración.',voiceover:null,shots:[{start:0,duration:Math.round(scene.duration*50)/100,job:'Presentar la idea',focal:scene.title,anchor:'B2',scale:'xl',mediaId:null,cue:null},{start:Math.round(scene.duration*50)/100,duration:Math.round(scene.duration*50)/100,job:'Desarrollar con ejemplos',focal:scene.points[0]||scene.title,anchor:'D4',scale:'m',mediaId:null,cue:null}]}));return board;}
  if(kind==='review')return {approved:true,summary:'Contenido de demostración predefinido. Esta aceptación no es una evaluación de un agente real.',issues:[]};
  throw new Error('La demo no controla el escritorio.');
}
