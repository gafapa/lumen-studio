// Catálogo oficial de HyperFrames (bloques y componentes del registro) como fuente de inspiración para los kits:
// se consulta con la CLI, se guarda en caché y se agrupa por el papel que cumple cada pieza en un kit de serie.
import path from 'node:path';
import {mkdir,readFile,writeFile,stat,readdir} from 'node:fs/promises';
import {runHyperframes} from './media-index.mjs';
import {vendorSkills} from './scene-code.mjs';
import {remotionInspiration} from './remotion-recipes.mjs';

const TTL=7*24*3600*1000;
let memory=null;

async function loadRawCatalog(store,{refresh=false}={}){
  const file=path.join(store.root,'cache','hyperframes-catalog.json');
  if(!refresh&&memory&&Date.now()-memory.at<TTL)return memory.items;
  if(!refresh){try{const cached=JSON.parse(await readFile(file,'utf8'));if(Date.now()-cached.at<TTL){memory=cached;return cached.items;}}catch{}}
  const result=await runHyperframes(['catalog','--json'],{timeout:120000}),start=result.stdout.search(/[[{]/);
  if(start<0){if(memory)return memory.items;throw new Error('No se pudo consultar el catálogo de HyperFrames: '+(result.stderr||result.stdout).slice(-300));}
  const parsed=JSON.parse(result.stdout.slice(start)),items=(Array.isArray(parsed)?parsed:parsed.items||parsed.blocks||[]).map(item=>({name:item.name,type:item.type,title:item.title||item.name,description:item.description||'',tags:item.tags||[],duration:item.duration||null,width:item.dimensions?.width||null,height:item.dimensions?.height||null}));
  memory={at:Date.now(),items};await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(memory));return items;
}

// La app está en español: títulos, descripciones y etiquetas traducidos (server/data/hyperframes-catalog.es.json).
// Las piezas nuevas que aún no tengan traducción se muestran en inglés hasta que se actualice ese archivo.
let translations=null;
async function catalogTranslations(){if(translations)return translations;try{translations=JSON.parse(await readFile(new URL('./data/hyperframes-catalog.es.json',import.meta.url),'utf8'));}catch{translations={items:{},tags:{}};}return translations;}
export async function loadCatalog(store,options={}){
  const items=await loadRawCatalog(store,options),es=await catalogTranslations();
  return items.map(item=>{const text=es.items[item.name];return {...item,title:text?.title||item.title,description:text?.description||item.description,translated:Boolean(text),labels:item.tags.map(tag=>es.tags[tag]||tag.replaceAll('-',' '))};});
}

// Papeles de un kit de serie y cómo reconocer en el catálogo las piezas que los cubren.
export const ROLES=[
  {id:'title',label:'Intros y tarjetas de título',match:item=>has(item,['title-card','headline','kinetic'])||/title|headline|intro/i.test(item.name)},
  {id:'lower-third',label:'Rótulos inferiores',match:item=>has(item,['lower-third'])||/^lt-|lower-third/.test(item.name)},
  {id:'captions',label:'Subtítulos y texto cinético',match:item=>has(item,['captions','caption-style','text-effects'])},
  {id:'transition',label:'Transiciones',match:item=>has(item,['transition','transition-primitive'])||/wipe|transition|cut$/.test(item.name)},
  {id:'data',label:'Cifras, gráficos y mapas',match:item=>has(item,['data','map','geography','chart'])||/chart|stat|count|number|map/.test(item.name)},
  {id:'code',label:'Código, terminal y desarrollo',match:item=>has(item,['code','developer','code-animation'])||/terminal|code/.test(item.name)},
  {id:'3d',label:'3D, WebGL y efectos visuales',match:item=>has(item,['3d','webgl','html-in-canvas','particles','3d-motion'])||/^vfx-/.test(item.name)},
  {id:'ui',label:'Interfaz, dispositivos y producto',match:item=>has(item,['mock-ui','product-demo','ui-props','notification','chat','social'])},
  {id:'annotation',label:'Anotación y trazo a mano',match:item=>has(item,['handwritten','annotation'])||/^hw-/.test(item.name)},
  {id:'background',label:'Fondos y texturas',match:item=>has(item,['background','texture'])||/background|grain|field|gradient/.test(item.name)},
  {id:'closing',label:'Logos, cierres y llamadas a la acción',match:item=>/logo|cta|outro|close|lockup|follow/.test(item.name)},
  {id:'motion',label:'Movimientos de cámara y gestos de animación',match:item=>has(item,['camera','motion-primitive'])},
];
const has=(item,tags)=>tags.some(tag=>item.tags.includes(tag));
export function rolesOf(item){return ROLES.filter(role=>role.match(item)).map(role=>role.id);}

// Recursos locales de la documentación oficial que ayudan a diseñar un kit.
async function localReferences(){
  const root=path.join(vendorSkills,'hyperframes'),rel=value=>path.join(root,value).replaceAll('\\','/');
  const list=async dir=>{try{return (await readdir(path.join(root,dir))).sort();}catch{return [];}};
  const presets=await list('hyperframes-creative/frame-presets'),examples=(await list('hyperframes-animation/examples')).filter(name=>name.endsWith('.html')),primitives=await list('music-to-video/references/motion-primitives'),categories=await list('motion-graphics/categories');
  return [
    '## Documentación local para diseñar el kit',
    `- Listón de calidad de un componente: \`${rel('hyperframes-registry/references/component-quality-bar.md')}\` y cómo cablear bloques y componentes: \`${rel('hyperframes-registry/references/wiring-components.md')}\`.`,
    `- Estilo de la casa y antipatrones: \`${rel('hyperframes-creative/references/house-style.md')}\`, composición para vídeo: \`${rel('hyperframes-creative/references/video-composition.md')}\`, principios de movimiento: \`${rel('hyperframes-creative/references/motion-principles.md')}\`, datos en movimiento: \`${rel('hyperframes-creative/references/data-in-motion.md')}\`.`,
    `- Blueprints (22 planos probados con su «movimiento firma»): \`${rel('hyperframes-animation/blueprints-index.md')}\`. Transiciones: \`${rel('hyperframes-animation/transitions/catalog.md')}\`.`,
    presets.length?`- Presets de estilo completos (cada uno con FRAME.md, vista de muestra y piel de subtítulos) en \`${rel('hyperframes-creative/frame-presets')}\`: ${presets.join(', ')}.`:'',
    examples.length?`- Composiciones de ejemplo completas en \`${rel('hyperframes-animation/examples')}\`: ${examples.join(', ')}.`:'',
    primitives.length?`- ${primitives.length} primitivas de movimiento con código en \`${rel('music-to-video/references/motion-primitives')}\` (p. ej. ${primitives.slice(0,14).join(', ')}…).`:'',
    categories.length?`- Módulos de grafismo en \`${rel('motion-graphics/categories')}\`: ${categories.join(', ')} (cada uno con su module.md).`:'',
  ].filter(Boolean).join('\n');
}

// Oficio de la documentación de HyperFrames (hyperframes.heygen.com, revisado en octubre de 2026): reglas de
// movimiento «premium», determinismo y listón de calidad de los componentes del registro.
const HYPERFRAMES_CRAFT=`## Listón de calidad (documentación oficial)
- Un componente, montado solo sobre su fondo, debe mostrar lo que promete su nombre y moverse como dice su descripción. Se descarta si renderiza en blanco, si duplica el movimiento de otro o si no se puede buscar fotograma a fotograma.
- Defectos a evitar: sin timeline propia en \`window.__timelines\`; nombre que promete una técnica ausente (spring sin rebote, 3d sin perspectiva, draw sin trazo); contraste menor de 4.5:1 o detalles de menos de ~24 px a 1080p; degradados morados o azules de relleno; colores fijos sin tokens; \`Math.random\` sin semilla; parámetros sin límites.
- \`hyperframes check\` no es una prueba visual (un render en blanco la pasa): revisa siempre las capturas.

## Movimiento que se percibe premium (ocho reglas)
1. Nada se detiene del todo: en las pausas, una respiración del 1–2 %.
2. La cámara actúa: un empuje o paralaje del 4–8 % por escena.
3. Acción solapada: desfases irregulares y más cortos que las animaciones que separan.
4. Combina propiedades solo cuando cuentan una misma historia.
5. Sobreimpulso y continuidad solo en transformaciones, nunca en contadores.
6. Planos de profundidad, con la oclusión como señal principal.
7. Ritmo según el género: 1,5–4 s por idea.
8. La irregularidad «hecha a mano» sale de un generador con semilla.
Cada movimiento debe afirmar algo (dirigir la atención, dar continuidad, mostrar un cambio o expresar carácter); si no se puede explicar en una frase, sobra. Para no parecer una presentación, algo debe cruzar cada cambio de escena y la energía debe variar.

## Reglas de determinismo
- Las revelaciones con \`fromTo\` incluyen \`opacity:1\`; el estado oculto inicial se fija fuera de la timeline.
- Sin valores relativos (\`+=\`) sobre una propiedad que otra animación está cambiando; sin medir el DOM dentro de callbacks de la timeline.
- No uses \`translate(-50%)\` de CSS en elementos que mueve GSAP: usa \`xPercent\`.
- Trazos SVG: sin dasharray de CSS en el elemento animado, cuidado con el punto del extremo redondeado y \`d\` estático antes de medir.

## Referencias
- Los más instalados del registro: logo-outro, data-chart, editorial-flash-overlay, organic-light-leak-overlay, mk-progress-stat, flowchart, mk-specs-list, mk-callout-highlight, hw-title, code-typing, lt-dark-card y cinematic-zoom.
- Plantillas de proyecto oficiales (estilos de partida): warm-grain, play-mode, swiss-grid, kinetic-type, decision-tree, product-promo, nyt-graph y vignelli.
- Vídeos de lanzamiento con código abierto como modelo de «componentes del kit + timeline anfitriona»: github.com/heygen-com/hyperframes-launch-video (17 subcomposiciones) y github.com/heygen-com/hyperframes-launches.
- Variables y plantillas para componentes reutilizables: hyperframes.heygen.com/prompting/variables-and-templating.md y /concepts/variables.md.`;

// Documento de inspiración que se deja en el espacio del kit.
export async function kitInspiration(store,engine){
  let items=[];try{items=await loadCatalog(store);}catch{}
  const header=engine==='hyperframes'
    ?'# Inspiración para el kit (HyperFrames)\n\nCatálogo oficial: instala cualquier pieza con `hyperframes_add` (o consúltala con `hyperframes_catalog`), estúdiala y conviértela en un componente del kit **adaptado a la identidad del proyecto** (tokens de lumen/tokens.css, tipografía, ritmo y tono). No dejes bloques genéricos tal cual: parametriza textos, colores y tiempos y documenta en KIT.md de qué bloque parte cada componente.'
    :'# Inspiración para el kit (Remotion)\n\nPrimero, el oficio y los paquetes de Remotion. Después, como referencia de qué componentes tener y de cómo se mueven, el catálogo oficial de HyperFrames: sus piezas son HTML/GSAP y no se pueden importar en Remotion, así que recréalas en React con la identidad del proyecto.';
  const groups=ROLES.map(role=>{const list=items.filter(role.match).slice(0,40);return list.length?`## ${role.label} (${list.length})\n${list.map(item=>`- \`${item.name}\` (${item.type}${item.duration?', '+item.duration+' s':''}): ${item.title}. ${item.description}`).join('\n')}`:'';}).filter(Boolean);
  return [header,engine==='hyperframes'?HYPERFRAMES_CRAFT:(await remotionInspiration()),items.length?`El catálogo tiene ${items.length} piezas; aquí van agrupadas por el papel que pueden cumplir en un kit de serie.`:'No se pudo consultar el catálogo ahora; usa la documentación local.',await localReferences(),...groups].join('\n\n');
}
