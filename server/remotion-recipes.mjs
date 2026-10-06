// Inspiración para kits de Remotion: oficio de la documentación oficial, paquetes instalados y un recetario de
// componentes por papel (revisado en octubre de 2026 con remotion.dev y los paquetes 4.0.532 instalados).
import path from 'node:path';
import {readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {vendorSkills} from './scene-code.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

// Recetas: qué componente construir y con qué piezas de Remotion. roles coincide con los papeles del catálogo.
export const REMOTION_RECIPES=[
  {name:'title-spring-lockup',title:'Tarjeta de título con muelle',roles:['title'],packages:['remotion','@remotion/layout-utils'],description:'Título y subtítulo que entran con spring() de duración fija (durationInFrames) y damping alto, ajustados al ancho con fitText tras cargar las fuentes; respiración del 1–2 % mientras se mantienen.'},
  {name:'kinetic-headline',title:'Titular cinético palabra a palabra',roles:['title','captions'],packages:['remotion','@remotion/animation-utils'],description:'Cada palabra entra escalonada con interpolate + Easing y makeTransform; la palabra clave cambia de color o peso. Parámetros: texto, palabra destacada y ritmo.'},
  {name:'path-draw-intro',title:'Intro con trazo que se dibuja',roles:['title','closing'],packages:['@remotion/paths','@remotion/shapes'],description:'Un trazo SVG (forma de la marca o del tema) se dibuja con evolvePath y se transforma en el logo o el título con interpolatePath.'},
  {name:'lower-third-rounded',title:'Rótulo inferior con caja redondeada',roles:['lower-third'],packages:['remotion','@remotion/layout-utils'],description:'Nombre y cargo con una barra de acento que se despliega (scaleX) y texto revelado con máscara; ancho calculado con measureText; entrada, permanencia y salida parametrizadas.'},
  {name:'lower-third-rough',title:'Rótulo con subrayado a mano',roles:['lower-third','annotation'],packages:['@remotion/rough-notation'],description:'Rótulo limpio cuya palabra clave recibe un subrayado o un recuadro dibujado a mano con rough-notation, sincronizado con la narración.'},
  {name:'tiktok-captions',title:'Subtítulos palabra a palabra',roles:['captions'],packages:['@remotion/captions'],description:'createTikTokStyleCaptions con combineTokensWithinMilliseconds bajo (palabra a palabra) o alto (por páginas); la palabra activa resaltada; máximo dos líneas y fuera de la zona de interfaz.'},
  {name:'captions-highlight-box',title:'Subtítulos con caja de resaltado',roles:['captions'],packages:['@remotion/captions','@remotion/layout-utils'],description:'Caja de color que viaja de palabra en palabra detrás del texto activo (medida con measureText), con transición de 4–6 fotogramas.'},
  {name:'transition-series-brand',title:'Transición de marca',roles:['transition'],packages:['@remotion/transitions'],description:'TransitionSeries con una presentación propia o combinada (slide, wipe, clockWipe, iris, flip, zoomBlur, dreamyZoom, filmBurn, crosswarp, crossZoom, ripple, dissolve, bookFlip, swap, blurSlide, pushCut) y springTiming; una sola transición firma para toda la serie.'},
  {name:'light-leak-overlay',title:'Destello de luz entre escenas',roles:['transition','background'],packages:['@remotion/transitions','@remotion/effects'],description:'TransitionSeries.Overlay con el efecto light-leak (no acorta la duración) para cambios de capítulo; intensidad y color de la marca.'},
  {name:'count-up-stat',title:'Cifra que cuenta',roles:['data'],packages:['remotion','@remotion/shapes'],description:'Número que cuenta con interpolate (sin sobreimpulso en el número), etiqueta y anillo de progreso con Pie; formato local de miles y unidades como parámetros.'},
  {name:'bar-chart',title:'Gráfico de barras animado',roles:['data'],packages:['remotion'],description:'Barras que crecen escalonadas con spring de damping alto, ejes y etiquetas de valor; datos reales como props (de library_read), nunca inventados.'},
  {name:'line-chart-draw',title:'Gráfico de líneas que se dibuja',roles:['data'],packages:['@remotion/paths','@remotion/media-utils'],description:'Serie convertida en trazo suave (createSmoothSvgPath) que se dibuja con evolvePath; punto y valor que viajan por la línea con getPointAtLength.'},
  {name:'comparison-split',title:'Comparativa en dos columnas',roles:['data','ui'],packages:['remotion'],description:'Dos columnas (antes/después, opción A/B) que entran desde los lados con cortina central; filas con check y cruz escalonados.'},
  {name:'code-typing',title:'Código que se teclea',roles:['code'],packages:['remotion'],description:'Bloque de código monoespaciado con tecleo determinista por fotograma, cursor, resaltado de sintaxis propio y línea destacada al terminar (como la plantilla Code Hike).'},
  {name:'terminal-session',title:'Sesión de terminal',roles:['code'],packages:['remotion'],description:'Terminal con prompt, comando tecleado, salida que aparece por líneas y estado final (éxito o error en color); sonido de teclas opcional con los efectos locales de assets/sfx.'},
  {name:'code-diff',title:'Diferencias de código',roles:['code'],packages:['remotion'],description:'Líneas eliminadas que se pliegan en rojo y añadidas que se despliegan en verde, con desplazamiento de cámara hasta el cambio.'},
  {name:'three-hero-object',title:'Objeto 3D protagonista',roles:['3d'],packages:['@remotion/three','@react-three/fiber','three'],description:'Objeto o dispositivo en ThreeCanvas con meshPhysicalMaterial, entorno RoomEnvironment para reflejos, sombra suave y órbita de cámara desde useCurrentFrame; colores y textos como props.'},
  {name:'three-network',title:'Red 3D de nodos',roles:['3d','data'],packages:['@remotion/three','@react-three/fiber','three'],description:'Nodos 3D conectados por líneas, con paquetes que viajan por los enlaces y la cámara que se acerca al nodo activo; topología como datos.'},
  {name:'three-extruded-text',title:'Texto o logo extruido en 3D',roles:['3d','title','closing'],packages:['@remotion/three','@react-three/fiber','three'],description:'Texto o forma SVG extruida (ExtrudeGeometry) con bisel, luz de estudio y giro de presentación para intros y cierres.'},
  {name:'effects-grade',title:'Etalonaje y texturas de marca',roles:['background','3d'],packages:['@remotion/effects'],description:'Look de la serie con efectos sobre Img, Video y Solid: grano (noise), viñeta, halftone, scanlines, glow, chromatic-aberration, duotone, paper o burlap; intensidad como parámetro.'},
  {name:'noise-background',title:'Fondo orgánico en movimiento',roles:['background'],packages:['@remotion/noise','@remotion/shapes'],description:'Manchas o retícula que derivan con noise2D/noise3D y semilla fija; colores de la paleta y movimiento lento que no compite con el contenido.'},
  {name:'device-mockup',title:'Dispositivo con pantalla',roles:['ui'],packages:['remotion','@remotion/media'],description:'Marco de portátil o móvil con una grabación o captura dentro (Video/Img con objectFit), empuje de cámara y reflejo sutil.'},
  {name:'ui-callout-zoom',title:'Zoom con señal sobre una grabación',roles:['ui','annotation'],packages:['remotion','@remotion/shapes'],description:'Zoom a una zona de la grabación de pantalla (con lumen/zoom.ts sobre los clics) más un Callout o Arrow que señala el elemento.'},
  {name:'notification-stack',title:'Notificaciones que se apilan',roles:['ui'],packages:['remotion'],description:'Tarjetas de notificación que entran con muelle y se apilan desplazando a las anteriores; contenido como lista de props.'},
  {name:'annotation-circle',title:'Círculo y flecha a mano',roles:['annotation'],packages:['@remotion/rough-notation','@remotion/shapes'],description:'Círculo, recuadro o tachado dibujado a mano sobre un elemento, con flecha y etiqueta; aparece justo cuando la narración lo nombra.'},
  {name:'motion-blur-move',title:'Movimiento rápido con desenfoque',roles:['motion','transition'],packages:['@remotion/motion-blur'],description:'Entradas y barridos rápidos con CameraMotionBlur o Trail para que el movimiento se perciba físico; úsalo con moderación.'},
  {name:'audio-reactive',title:'Visualización de la voz o la música',roles:['background','motion'],packages:['@remotion/media-utils'],description:'Barras u onda que reaccionan al audio (useAudioData + visualizeAudioWaveform) para cierres o momentos musicales.'},
  {name:'logo-sting-close',title:'Cierre con logo y llamada a la acción',roles:['closing'],packages:['remotion','@remotion/shapes','@remotion/effects'],description:'El logo se construye por partes con muelles escalonados, brillo (glow o shine) al completarse y llamada a la acción o URL; fondo de marca.'},
  {name:'chapter-card',title:'Separador de sección',roles:['title','transition'],packages:['remotion','@remotion/shapes'],description:'Número y nombre de sección con barra de progreso de la serie; aparece entre bloques y mantiene la estructura reconocible.'},
  {name:'lottie-accent',title:'Detalle animado con Lottie',roles:['annotation','motion'],packages:['@remotion/lottie'],description:'Icono o ilustración Lottie de la biblioteca sincronizada con el fotograma (Lottie con playbackRate y loop controlados), coloreada con la paleta.'},
];

async function localDocs(){
  const dir=path.join(vendorSkills,'remotion','remotion-markup');let topics=[];try{topics=(await readdir(dir)).filter(name=>name.endsWith('.md')&&name!=='SKILL.md').map(name=>name.replace(/\.md$/,''));}catch{}
  const transitions=(await readdir(path.join(root,'node_modules','@remotion','transitions','dist','presentations')).catch(()=>[])).filter(name=>name.endsWith('.js')&&!name.startsWith('upload')).map(name=>name.replace(/\.js$/,''));
  const effects=(await readdir(path.join(root,'node_modules','@remotion','effects','dist','esm')).catch(()=>[])).filter(name=>name.endsWith('.mjs')&&!/utils|shader|index/.test(name)).map(name=>name.replace(/\.mjs$/,''));
  return [
    '## Documentación y piezas instaladas',
    `- Reglas por tema en \`${path.join(dir).replaceAll('\\','/')}\`: ${topics.join(', ')}. Empieza por \`remotion-best-practices/SKILL.md\`.`,
    transitions.length?`- @remotion/transitions instaladas (${transitions.length}): ${transitions.join(', ')}. Cube no está (es de pago).`:'',
    effects.length?`- @remotion/effects instalados (${effects.length}, se pasan con la prop \`effects\` a Img, Video, Solid y formas): ${effects.join(', ')}.`:'',
    '- Otros paquetes disponibles: @remotion/shapes (Rect, Circle, Ellipse, Triangle, Star, Polygon, Pie, Heart, Arrow, Callout, Spark y sus make*), @remotion/paths (evolvePath, interpolatePath, getPointAtLength, warpPath…), @remotion/noise, @remotion/motion-blur (Trail, CameraMotionBlur), @remotion/layout-utils (measureText, fitText, fitTextOnNLines, fillTextBox), @remotion/captions, @remotion/rough-notation, @remotion/animation-utils (interpolateStyles, makeTransform), @remotion/media-utils, @remotion/lottie, @remotion/gsap, @remotion/three con @react-three/fiber y three.',
  ].filter(Boolean).join('\n');
}

const CRAFT=`## Oficio (documentación oficial de Remotion)
- **spring()**: por defecto (mass 1, damping 10, stiffness 100) rebota; sube damping (p. ej. 200) para quitar el rebote, usa overshootClamping para evitar sobrepasar y durationInFrames para que un componente dure siempre lo mismo (clave en un kit). Orden: estirar, invertir y retrasar (delay, reverse).
- **interpolate()**: usa siempre extrapolateLeft/Right 'clamp', easing con Easing.*, Easing.step1 para mantener valores discretos y output 'perceptual-scale' para escalas que se perciban lineales.
- **TransitionSeries**: una transición solapa las dos escenas y acorta la duración total; TransitionSeries.Overlay (flashes, destellos) no la acorta. Una transición al principio o al final da entradas y salidas.
- **Texto**: measureText, fitText y fillTextBox solo después de cargar las fuentes (delayRender/continueRender si hace falta); fitText devuelve el tamaño que cabe en un ancho.
- **Subtítulos**: createTikTokStyleCaptions con combineTokensWithinMilliseconds bajo para palabra a palabra; cada token incluye su espacio inicial.
- **Azar**: random('semilla-'+i), nunca Math.random.
- Componentes del kit: props tipadas para textos, colores y tiempos, con valores por defecto; duración declarada; nada de valores sueltos (usa lumen/tokens.ts).

## Referencias externas (para estudiar, no para importar)
- Plantillas oficiales (remotion.dev/templates): Hello World (spring e interpolate), 3D (React Three Fiber), Code Hike (animaciones de código), TikTok (subtítulos palabra a palabra), Overlay (rótulos sobre fondo transparente), Audiogram y Music Visualization (audio), Stargazer (cifras que cuentan).
- Ejemplos oficiales en github.com/remotion-dev: typewriter, morph-text, text-warping, 3d-text, glb-example, remotion-three-gltf-example, remotion-gl-transitions, light-leak-example, d3-example; serie completa con datos: github.com/remotion-dev/github-unwrapped.
- Bibliotecas de la comunidad (índice en remotion.dev/docs/resources): Remocn, RemotionUI, Remotion Bits, Onda (70 componentes y 18 transiciones), RenderComp Free (50 plantillas MIT), Remotion Animated.`;

export async function remotionInspiration(){return [CRAFT,await localDocs(),'## Recetario de componentes',REMOTION_RECIPES.map(item=>`- **${item.title}** (${item.packages.join(', ')}): ${item.description}`).join('\n')].join('\n\n');}
