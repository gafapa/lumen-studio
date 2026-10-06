# Lumen Video Studio

[![Pruebas](https://github.com/gafapa/lumen-studio/actions/workflows/test.yml/badge.svg)](https://github.com/gafapa/lumen-studio/actions/workflows/test.yml) [![Versión](https://img.shields.io/github/v/release/gafapa/lumen-studio)](https://github.com/gafapa/lumen-studio/releases) [![Licencia: AGPL-3.0](https://img.shields.io/badge/licencia-AGPL--3.0-blue)](LICENSE)

Estudio local de generación de vídeo para cualquier ámbito (anuncios, explicaciones, tutoriales, piezas para redes, presentaciones de producto o demostraciones), con interfaz web y aplicación de escritorio para Windows. Codex y Claude Code planifican y delegan el trabajo mediante sus CLI de suscripción. El harness coordina agentes, herramientas, dependencias, paralelismo, reintentos y revisión. Remotion, HyperFrames y FFmpeg producen archivos reales.

## Instalar desde GitHub

**Aplicación portátil:** descarga el ZIP de la última versión en [Releases](https://github.com/gafapa/lumen-studio/releases), descomprímelo y abre `Lumen Studio.exe`. Las versiones publicadas no incluyen Whisper, Kokoro ni Manim: instálalos desde el código si los necesitas.

**Desde el código** (Windows, git y PowerShell):

```powershell
git clone https://github.com/gafapa/lumen-studio.git
cd lumen-studio
.\iniciar.ps1 -Produccion
```

El lanzador descarga Node portátil, instala dependencias y, si faltan, las skills oficiales de HyperFrames y Remotion (`scripts/update-vendor-skills.mjs`; no se versionan en este repositorio). Componentes opcionales, todos en `.tools` sin tocar el sistema:

| Script | Qué añade |
|---|---|
| `scripts/setup-kokoro.ps1` | Voz neuronal local (Kokoro) |
| `scripts/setup-whisper.ps1` | Transcripción local (Whisper.cpp) |
| `scripts/install-manim.ps1` | Motor Manim (requiere el Python portable) |
| `scripts/install-tinytex.ps1` | LaTeX para fórmulas en Manim |

Variables útiles: `LUMEN_PYTHON` (otro intérprete de Python para Manim), `LUMEN_MANIM_LIB` (otra carpeta de Manim), `CODEX_BIN`, `CLAUDE_BIN`, `LUMEN_DATA_DIR`, `LUMEN_ENV_FILE`.

**Integración continua:** cada push a `main` y cada pull request ejecuta `npm test` (con Manim) y las pruebas de interfaz en Windows. Una etiqueta `v*` (por ejemplo `git tag v0.2.0 && git push --tags`) empaqueta la aplicación de escritorio y la publica en Releases.

## Abrir el estudio

En esta carpeta:

```powershell
.\iniciar.ps1 -Produccion
```

La web está en **http://127.0.0.1:4310**. El modo de desarrollo usa `iniciar.ps1` y el puerto 5173. Si PowerShell bloquea el lanzador, usa `powershell -NoProfile -ExecutionPolicy Bypass -File .\iniciar.ps1 -Produccion`.

La aplicación portátil está en **releases/Lumen Studio-win32-x64/Lumen Studio.exe**. Copia la carpeta completa para trasladarla. Lleva Node, Chromium de Remotion, FFmpeg, Whisper y las bibliotecas de captura de audio; inicia un backend privado al abrirse y lo cierra al salir. En desarrollo también puedes usar `npm run desktop`; `npm run package:desktop` reconstruye el paquete.

La web guarda los datos en `.data`. La aplicación empaquetada los guarda en `app.getPath('userData')/data`; su archivo de credenciales es `userData/.env`. `LUMEN_DATA_DIR` y `LUMEN_ENV_FILE` permiten elegir ubicaciones. No se incluyen tus proyectos, sesiones o credenciales en el paquete.

Necesitas Windows, una voz española instalada y sesión en el CLI elegido: `codex login` o `claude auth login`. Si hace falta, indica `CODEX_BIN` o `CLAUDE_BIN`. El lanzador descarga Node portátil y verifica SHA-256 sin cambiar el PATH global. **Claude Agent SDK no es una dependencia**: los adaptadores usan los CLI y evitan variables que cambiarían su autenticación a una API de pago.

## Proyectos y vídeos

Todo vídeo pertenece a un **proyecto**. El proyecto define una vez lo que comparten sus vídeos y cada vídeo hereda esos valores, con la posibilidad de sobrescribirlos:

| Nivel | Qué define |
|---|---|
| Proyecto | Objetivo, audiencia, guía de estilo, reglas (obligatorias o preferencias), decisiones aprendidas, identidad (paleta, tipografía, intensidad), voz, sonoridad, transición y subtítulos (opcionales, con estilo), formato y autoría por defecto, motor y arquitectura de agentes, **modelo y esfuerzo por rol**, material y conocimiento comunes y kit de escenas. |
| Vídeo | Encargo, duración, fuentes y material propios, formato u otros ajustes sobrescritos, storyboard, escenas, renders y versiones. |
| Escena | Motor (HyperFrames, Remotion o plantilla), dirección artística, código y cambios pedidos. |

La pestaña **Heredado del proyecto** de cada vídeo muestra el valor efectivo de cada ajuste y su origen (app, proyecto o vídeo). Si cambias algo en el proyecto, Lumen marca los vídeos afectados como desactualizados y aplica el cambio cuando tú lo decides, en uno o en todos; la invalidación es la de siempre (por ejemplo, cambiar la voz rehace voz y subtítulos, cambiar el modelo de un agente solo afecta a las siguientes ejecuciones).

Todos los agentes del vídeo reciben el **contexto del proyecto**: objetivo, audiencia, guía, reglas (las obligatorias prevalecen sobre el encargo del vídeo), decisiones aprendidas y el catálogo del kit. La revisión final comprueba además la coherencia con el proyecto. Al pedir un cambio en una escena puedes marcar «recordarlo para los próximos vídeos» y se guarda como decisión del proyecto.

### Agentes, modelos y esfuerzo

En **Agentes** eliges el motor (Claude Code o Codex), la arquitectura, el paralelismo y, para cada rol, el modelo y el esfuerzo: director creativo, diseñador del kit, documentalista, director, investigador, guionista, storyboard, revisores, director de producción, operador del PC y programador de escena. Los perfiles **Ahorro**, **Equilibrado** y **Calidad** ajustan todos los roles a la vez; la tabla muestra el consumo real de cada rol en los vídeos del proyecto para afinar el gasto. Equilibrado reserva los modelos grandes para la dirección (storyboard, director creativo, kit), usa modelos medianos con esfuerzo alto para programar escenas y modelos pequeños para triaje y planificación de producción. Lumen pasa `--model/--effort` a Claude Code y `-m`/`model_reasoning_effort` a Codex; Haiku no admite nivel de esfuerzo.

### Agentes de proyecto

- **Director creativo**: a partir de un encargo, el material indexado y las fuentes, propone guía de estilo, reglas, subtítulos, paleta opcional y, si lo pides, la serie de vídeos, que se crean como borradores.
- **Diseñador del kit**: programa en `collections/<id>/code/kit` componentes compartidos (intro, rótulos, subtítulos, transición de marca, cierre) con la identidad del proyecto, los documenta en `KIT.md` y verifica una vista previa como cualquier escena. Las escenas del mismo motor los reciben en `kit/` (copiados y marcados de confianza). Si el kit cambia, **Aplicar el kit** actualiza las escenas ya programadas y solo vuelve a renderizar.
- **Documentalista**: describe los planos del material mirando sus hojas de contactos para que se puedan buscar por lo que se ve.

El material y el conocimiento del proyecto se suben e indexan una vez en `collections/<id>` y se enlazan (enlaces duros, sin duplicar espacio) en cada vídeo; las descripciones visuales son comunes.

## Crear y editar un vídeo

1. Crea o abre un proyecto y pulsa **Nuevo vídeo**: encargo, duración, formato propio si lo necesitas y fuentes específicas.
2. Si quieres, ajusta en **Heredado del proyecto** lo que cambie solo para este vídeo.
3. Genera y sigue las tareas. En proyectos nuevos con un CLI se activan el director de producción dinámico y la revisión del audio; puedes ajustarlos.
4. En Producción avanzada edita el timeline, las escenas, la voz, los recursos y los subtítulos. Aprueba o regenera cada componente por separado.
5. Continúa la producción para actualizar el MP4. Los componentes y segmentos que conservan sus entradas se reutilizan.
6. Revisa el resultado, apruébalo y descarga el vídeo o los subtítulos SRT.

El timeline permite arrastrar escenas, moverlas con botones, cambiar duraciones y recorrer el MP4 existente. El editor de subtítulos modifica texto y tiempos de palabras. Si la voz real excede la duración prevista, el productor amplía su escena.

## Escenas programadas por agentes

En modo código, el storyboard dirige y cada escena la programa un agente: HyperFrames (HTML, CSS y GSAP con sus plugins) o Remotion (React con @remotion/media, transitions, effects, shapes, paths, noise, motion-blur, layout-utils, captions, light-leaks y rough-notation). El storyboard asigna `engine`, describe en `direction` qué se ve, el ritmo y el material concreto que se reutiliza, y puede usar `voiceover` para una locución propia.

Cada escena vive en `code/<escena>/` dentro del proyecto, con `lumen/scene.json` (narración, duración exacta, palabras con tiempos, perfil), `lumen/media.json` (material disponible), `assets/` (material, efectos de sonido locales y tipografías) y una guía `AGENTS.md`/`CLAUDE.md`. Claude Code y Codex leen la documentación oficial incluida en `skills/vendor` (skills de HyperFrames y Remotion; actualízalas con `node scripts/update-vendor-skills.mjs`).

El agente trabaja con herramientas MCP de Lumen: `scene_lint`, `scene_check` (errores de ejecución y, en HyperFrames, desbordes, solapes, contraste y animación congelada), `scene_snapshot` (fotogramas exactos que el agente mira), `media_*` y, en HyperFrames, el catálogo oficial de bloques (`hyperframes_catalog`, `hyperframes_add`). Lumen repite lint y comprobación al terminar y rechaza la escena si fallan. La revisión final devuelve los errores de una escena programada a su programador, con hasta dos correcciones, y los fallos recurrentes se guardan en `pitfalls.json` para avisar a las siguientes escenas.

Seguridad: Claude solo puede escribir dentro de la carpeta de la escena (Write/Edit restringidos, sin Bash ni web) y Codex trabaja con `workspace-write` sin red. Antes de ejecutar nada, un análisis estático bloquea red y URLs remotas, `eval`/`Function`/`import()`, APIs de Node y del almacenamiento del navegador, y fuentes de no determinismo (`Math.random`, `Date`, temporizadores). En Remotion solo se permiten los paquetes listados y archivos relativos. GSAP y los bloques del catálogo se marcan como de confianza por su hash; si el agente los modifica vuelven a analizarse.

En la pestaña **Escenas en código** ves el código, la verificación y las capturas de cada escena, puedes pedir cambios con tus palabras (el agente modifica el código existente) y restaurar cualquier versión del historial. Una escena de plantilla puede pasar a código eligiendo motor y describiendo el cambio.

### Calidad y coherencia de la serie

- **Planos y aprobación del storyboard.** En modo código el storyboard divide cada escena en planos (`shots`: inicio, duración, trabajo, elemento focal, ancla en una retícula 6x6, escala, material y efecto). Antes de programar, Lumen se detiene y muestra un boceto de cada plano para que lo apruebes o pidas otro enfoque (*Agentes → Calidad*; desactivable).
- **Sistema de diseño.** Cada escena recibe `lumen/tokens.css|js|ts` con colores, escala tipográfica, márgenes, zonas seguras, duraciones, curvas, muelles, escalonados y reglas de ritmo (planos de 1,5 a 4 s y nada quieto más de 2,5 s), derivados de la identidad del proyecto. También recibe `lumen/zoom.js|ts`, que aplica zoom automático sobre los clics de las grabaciones de pantalla a partir de `assets/data/<grabación>.events.json`.
- **Crítico independiente.** Otro agente (Sonnet o GPT de esfuerzo medio por defecto) mira fotogramas reales de la escena junto a los fotogramas de estilo del proyecto y puntúa de 0 a 5 la jerarquía, la legibilidad, el propósito del movimiento, el ritmo, la coherencia con la serie y la originalidad. Puede pedir de 0 a 3 rondas de mejora, y una versión solo se acepta si supera a la anterior; si no, se restaura la mejor. La puntuación aparece en cada escena.
- **Variantes.** Desde una escena programada puedes generar 2 o 3 alternativas en paralelo (`code/<escena>--vN`), compararlas con sus capturas y su puntuación, y quedarte con una. La versión anterior queda en el historial.
- **Ejemplos aprobados.** «Guardar como ejemplo del proyecto» conserva el código y los fotogramas de una escena. Las escenas siguientes del mismo motor reciben los dos ejemplos más afines en `lumen/references/`, y desde *Kit de escenas* puedes convertir un ejemplo en un componente del kit.
- **Biblia de la serie.** En *Guía de estilo* defines las secciones recurrentes (entradilla, cierre…), el carácter visual (movimiento, densidad, variedad) y qué evitar, todo con sugerencias de IA. Los fotogramas de estilo salen de la vista previa del kit o de imágenes de la biblioteca.
- **Un único kit.** Para el usuario hay un solo kit de escenas: una lista de componentes, una vista previa, un historial y una petición de cambios. Por dentro, cada componente es de HyperFrames o de Remotion (`code/kit-<motor>`, cada uno con su diseñador, que pueden trabajar a la vez), y Lumen decide dónde va cada componente nuevo: las piezas del catálogo de HyperFrames en HyperFrames, las recetas de Remotion en Remotion y las peticiones libres en el motor que más componentes tiene. Un cambio general se aplica a todo el kit. Los proyectos con el kit único anterior se migran solos al arrancar.
- **Cada escena parte de un componente del kit.** El storyboard asigna a cada escena programada un componente (`component`), y el motor de la escena es el del kit que lo contiene, así que cada escena puede usar el motor que quiera sin perder coherencia. Si ningún componente encaja, propone uno nuevo (`newComponent`) y Lumen lo añade al kit de ese motor antes de programar la escena (lo crea una sola vez aunque lo pidan varias escenas). En cada escena puedes cambiar el componente o pedir uno nuevo, y el kit muestra en cuántas escenas se usa cada componente.
- **3D casi realista en HyperFrames.** Cada escena HyperFrames trae Three.js en local (`vendor/three`: núcleo, posprocesado, entornos, geometrías, loaders y tipografías 3D) y Lottie, marcados de confianza, sin CDN. Los agentes saben usar materiales físicos, iluminación de estudio, sombras, partículas, shaders y cámaras renderizadas desde `hf-seek`. La biblioteca acepta modelos `.glb`, que llegan a las escenas en `assets/models/`. El storyboard y el diseñador del kit conocen esta capacidad.
- **Inspiración para kits.** El diseñador recibe `lumen/KIT-INSPIRATION.md`. En HyperFrames incluye el catálogo oficial (386 piezas, en caché una semana) agrupado por papel, el listón de calidad, las ocho reglas del movimiento premium, las reglas de determinismo y la documentación local (blueprints, presets, primitivas y ejemplos). En Remotion incluye el oficio de la documentación (spring, interpolate, TransitionSeries, fitText, captions), las transiciones y los efectos instalados y un recetario de 30 componentes. La pestaña *Inspiración* del kit permite explorar todo esto y añadir cualquier pieza como componente. Remotion también hace 3D con `@remotion/three`.
- **Kit ampliable.** En *Kit de escenas* puedes añadir componentes uno a uno (con propuestas de IA según lo que falta), cambiar uno concreto o quitarlo. El diseñador solo toca ese componente, conserva la API de los demás y la vista previa se alarga con el kit (hasta 40 s y 30 componentes).
- **Multimedia con licencia.** El investigador de la biblioteca usa `library_find_media`, que busca en Wikimedia Commons (fotos, diagramas e iconos de SVG convertidos a PNG, y vídeo), Openverse (imágenes y música CC) y Pexels si está configurado. Devuelve URLs directas con autor y licencia. `library_add_url` rechaza las descargas vacías y las páginas web que llegan en lugar del archivo esperado. El documentalista también describe imágenes.
- **Revisión al estilo Showtime** (ideas de github.com/FavioVazquez/showtime):
  - Crítico: la primera ronda se puntúa con la rúbrica. Desde la segunda, dos críticos comparan a ciegas la versión nueva y la mejor anterior, cada uno en un orden; solo hay mejora si ambos prefieren la nueva. Además, cada crítico responde «¿lo publicarías?». Los problemas sin segundo se descartan.
  - Prueba de mirada: cada imagen que ve un revisor lleva un código de 5 cifras que debe devolver. Sin los códigos, su crítica no sirve para aceptar cambios y la revisión final no puede aprobar.
  - Inspección temporal (`server/inspect.mjs`, umbrales en `server/data/thresholds.json`): tras la verificación, cada escena (HyperFrames con su runtime oficial; Remotion con un Thumbnail empaquetado con esbuild) se recorre en el navegador cada 0,1 s. Mide tiempo de lectura, letra diminuta en móvil, contraste real sobre píxeles, texto recortado, etiquetas que se pisan, entradas simultáneas y planos quietos. Avisa al agente sin bloquear y guarda recortes de texto a tamaño real.
  - Material de la revisión final: tira de cortes (de 2 fotogramas antes a 4 después de cada cambio de escena), miniatura de 168x94 y recortes de texto, todo sellado.
  - Historial de looks (`server/looks.mjs`): apertura, cierre, transición principal, estructura y componentes de cada vídeo terminado; el storyboard recibe los últimos y la aprobación avisa de repeticiones, con alternativas.
  - Storyboard con contrato («este vídeo le cuenta a ___ que ___»), de 3 a 5 enfoques con al menos uno inesperado (se puede elegir otro desde la aprobación) y una comprobación de personalidad: con dos «no», el plan se revisa.
  - Recibo de cada vídeo (pestaña Actividad y `receipt.md`): petición literal, llamadas y tokens por rol, rondas de crítica y coste mínimo si se configuran precios (`prices` en los ajustes, en dólares por millón de tokens).
  - Referencia de estilo desde un vídeo de la biblioteca (`server/style-reference.mjs`, en *Guía de estilo*): mide ritmo, planos, energía y cámara por plano, paleta con sus papeles, tamaños de letra y margen (OCR), silencio y tempo. Los agentes toman su gramática y nunca su contenido; la revisión final compara el vídeo con ella y un guardián anti-copia (SSIM y hash de diferencias, confirmados en detalle sobre zonas con textura) lo para si se parece demasiado.
  - Reglas de oficio con números en las guías: tiempos de lectura, escalonados, entradas, respiración, tamaños, transiciones y sonido.
- **Bucle de producción ampliado.**
  - Verificador de hechos (`fact-check`, activo por defecto en los proyectos): tras el storyboard y antes de producir, comprueba cifras, comandos, puertos, nombres y licencias contra las fuentes, la biblioteca y la web. Si encuentra datos incorrectos, el storyboard se corrige automáticamente una vez; el resultado se ve al aprobar el storyboard.
  - Revisión final: si no demuestra haber mirado las imágenes, se repite una vez. Las escenas que devuelve a su programador compiten a ciegas contra su versión anterior y solo se cambian si dos críticos prefieren la corrección.
  - Límite de gasto por vídeo (tokens y, con precios configurados, coste): al alcanzarlo los agentes se detienen y el vídeo pide permiso para seguir (+50 %); las rondas de mejora de escenas también se cortan.
  - Publicación (`publish`): título, descripción, capítulos con tiempos reales, etiquetas, texto para compartir y fotograma de miniatura, editables con autoguardado en la pestaña Actividad.
  - Mezcla medida: el montaje exporta la voz y la música atenuada con el mismo grafo y mide la diferencia en las ventanas con voz; la revisión técnica avisa si queda fuera de 10–20 dB.
- **Modelo y esfuerzo por agente:** tres perfiles definidos rol a rol (Ahorro, Equilibrado y Calidad) para Claude y Codex, con el criterio explicado en la pestaña Agentes.
- **Cuatro motores de escena** (`server/engines.mjs`): HyperFrames, Remotion, **Manim** (Python, Manim Community 0.21, instalado en `.tools/manim-lib` con el Python portable; `scripts/install-manim.ps1` en otra instalación) y **Revideo** (TypeScript en canvas con LaTeX incluido; render en un proceso aparte, sin telemetría). Un manifiesto de capacidades por motor guía al storyboard. Manim pasa antes un guardián de seguridad sobre el árbol sintáctico (`server/manim-guard.py`): solo admite importaciones matemáticas y de Manim y bloquea archivos, sistema, red, introspección y azar sin semilla. LaTeX para Manim con TinyTeX en `.tools/tinytex` (`scripts/install-tinytex.ps1`); sin él, Manim escribe fórmulas con Text y Revideo usa su LaTeX incluido. Los dos motores nuevos se verifican con un render rápido a 10 fps (duración y planos quietos) y su render final se ajusta a la duración exacta antes de mezclar la narración. Admiten kit como los demás.
- **Ideas de html-video:**
  - Datos de la escena (`data`: título, unidad, valores y fuente) separados del código; el programador usa exactamente esas cifras.
  - Conceptos por escena (`introduces` y `uses`): la aprobación del storyboard avisa si una escena da por sabido algo que se explica después.
  - Textos en pantalla editables sin el agente: se cambian en el código, se comprueban y quedan en el historial.
  - Versiones por motor: cambiar el motor de una escena archiva la anterior (`code/<escena>@<motor>`) y se puede volver sin reprogramar; las variantes pueden probarse en otro motor.
  - Procedencia de los componentes del kit (catálogo, receta, ejemplo aprobado o diseño propio, con licencia).
- **Ritmo en el montaje.** La revisión técnica detecta planos congelados de más de 2,5 s e indica a qué escena pertenecen.

## Material propio

La pestaña **Material** importa vídeos, grabaciones, imágenes y audio en streaming (hasta 4 GB; mp4, webm, mov, mkv, m4v, wav, mp3, ogg, m4a, aac y flac). Un audio puede ser música o locución. Todo se indexa en el equipo: duración y formato, planos (detección de escena de FFmpeg), miniaturas y hoja de contactos, silencios, transcripción palabra a palabra con whisper.cpp y muletillas. La búsqueda encuentra lo que se dice y las descripciones visuales que los agentes guardan tras mirar los planos.

Desde el material puedes crear derivados: **corte limpio** sin silencios largos ni muletillas (con fundidos de 30 ms y transcripción remapeada), **sin fondo** (modelo local; WebM con alfa o PNG) y **ritmo** (pulsos y BPM). Los fragmentos usados en plantillas conservan su sonido; cada capa decide su volumen.

Las grabaciones de pantalla registran clics, movimiento y ráfagas de teclado para proponer zooms y detectar tiempos muertos. Por privacidad no se registran las teclas pulsadas y el título de la ventana solo se guarda en los clics.

## Composición dinámica y fragmentos de recursos

Los proyectos nuevos usan el perfil **Dinámico**. En **Diseño y capas** puedes previsualizar una escena, editar sus capas y tiempos, posición, tamaño, animación, fondo y cámara. Combina texto, tarjetas, formas, iconos SVG, flechas, gráficos de barras/línea/anillo, contadores, imágenes, vídeos y grabaciones. El inspector permite modificar capas y orden; el editor JSON añade keyframes. Las composiciones avanzadas funcionan en Remotion y HyperFrames: React por fotograma y HTML/GSAP temporizado comparten geometría y animaciones.

En Recursos, **Usar fragmento** permite seleccionar inicio y final del vídeo original, velocidad, encuadre y momento de aparición en una escena. El corte dura (final-inicio)/velocidad. Puedes insertar varios intervalos del mismo vídeo o mezclar varios recursos con gráficos y rótulos; una capa más larga que su clip lo repite. Los intervalos deben caber en el recurso y en la escena. FFmpeg prepara los cortes locales, reutiliza su caché y conserva ID, procedencia y licencia en los metadatos de render. Los fragmentos se insertan sin audio original; voz y música son pistas separadas. La grabación principal sin recortar puede conservar su sonido del PC en Remotion.

El contrato scene.composition admite layout (auto, canvas, split, focus, montage, picture-in-picture), background, camera y hasta 24 layers, ocho multimedia y 12 keyframes por capa. Cada capa tiene id/type, box con porcentajes x/y/w/h, start/duration en segundos, motion, style y datos específicos de media/chart/icon. Los tiempos de keyframes son segundos absolutos de escena y sus propiedades son x, y, scale, rotation, opacity. duration=null conserva una capa hasta el final. canvas usa solo las capas declaradas; las otras distribuciones permiten añadir o sobrescribir capas de la plantilla por id.

Los agentes reciben el contrato, un ejemplo y las capacidades reales, junto con los recursos valorados, para elegir cortes, gráficos y cambios visuales con intención cada 2–5 segundos. No se ejecuta código arbitrario del modelo. Los gráficos requieren datos documentados y el diseñador no debe afirmar haber visto acciones entre fotogramas de muestra. El revisor del MP4 recibe también muestras dentro de cada capa multimedia. Editar un corte invalida el visual, su composición y los segmentos afectados, conservando la voz.

## Director, agentes y loops

El director de contenido propone un DAG según el encargo: puede escoger solo storyboard para una explicación sencilla, o investigación, guion, revisión y demostraciones. A concentra el contenido en una tarea; B usa agentes por función; C añade MCP. Las skills de contenido se aplican en las tres arquitecturas. La planificación sigue requiriendo una llamada de director.

Con producción dinámica, un segundo director decide el DAG audiovisual sobre el storyboard aceptado. Puede elegir funciones, proveedores disponibles y dependencias. El contrato conserva voz, visual, subtítulos y composición de cada escena, render y revisiones solicitadas. El harness valida referencias, ciclos, permisos y tipos de proveedor antes de ejecutarlo.

Las tareas de agentes son procesos CLI separados; voz, composición y otras operaciones deterministas son herramientas locales. Voz y visuales pueden trabajar en paralelo; los subtítulos esperan a la voz y el render a los recursos y revisiones aceptados. Las puertas de aprobación detienen dependencias hasta la aceptación humana.

Cada tarea tiene hasta dos intentos; las correcciones automáticas de contenido y vídeo final tienen un máximo de dos, y la replanificación hasta tres según configuración. Se conservan artefactos aceptados y cachés durante las correcciones. Las sesiones persistentes se reanudan por tarea; los operadores del PC usan sesión nueva y reserva exclusiva.

El contexto mínimo recupera fragmentos y resultados necesarios; el completo incorpora fuentes y artefactos aceptados. Las skills locales cubren producción de vídeo, storyboard y revisión. En C se exponen herramientas MCP y pueden añadirse servidores propios desde Conexiones.

La investigación web se activa por proyecto. La recuperación web de Lumen impone sus dominios permitidos; a los buscadores nativos del CLI esa restricción se comunica en el prompt, sin imponerla técnicamente sobre sus herramientas nativas.

## Recursos de investigación y supervisión

La pestaña principal **Recursos** reúne páginas, imágenes, vídeos, archivos importados, visuales producidos y grabaciones completadas. Las fuentes web recuperadas con `web_source` o la interfaz se guardan con su texto, URL y fecha; el texto pasa al índice de conocimiento del proyecto sin borrar el plan. También se archivan las referencias declaradas por las tareas de investigación y las URLs detectadas en llamadas nativas de consulta web. Una referencia que no se ha recuperado se identifica como **sin consultar**, con el error si lo hay: no se presenta como evidencia leída.

Las páginas HTML aportan candidatos de sus etiquetas de imagen, vídeo y Open Graph, hasta 12 por página. `resource_search` busca hasta seis candidatos en [Wikimedia Commons](https://www.mediawiki.org/wiki/API:Imageinfo), sin clave, o en [Pexels](https://www.pexels.com/api/documentation/) si existe una conexión habilitada. La búsqueda usa la investigación web y Pexels requiere también proveedores externos. `resource_add` permite registrar otros hallazgos. Se conservan página de procedencia, autor y licencia cuando constan; no se inventa una licencia si falta. La colección se deduplica por URL y tipo y admite 200 recursos por proyecto. No se elige automáticamente el primer resultado de una búsqueda.

Antes del storyboard, el harness añade tareas **Valorar imágenes y vídeos**, en lotes de ocho. Prepara una imagen real o tres fotogramas de cada vídeo (10 %, 50 % y 90 %), mide resolución y duración con FFprobe y entrega las imágenes a Codex o Claude. Guarda pertinencia, calidad, adaptación a la composición, nota de 0 a 100, recomendación de uso y limitaciones. Claude debe abrir las muestras con Read y el adaptador comprueba que la herramienta devolvió imágenes. El modo demo deja la valoración pendiente y no simula visión. El diseñador recibe las valoraciones y los IDs locales para elegir recursos por utilidad educativa.

Desde Recursos puedes preparar un candidato, pedir una nueva valoración, seleccionar, reservar o descartar, abrir su procedencia y asignarlo a una escena. Se muestra dónde se usa cada medio. Descartar un recurso retira sus asignaciones y deja esas escenas pendientes de producción. Una selección manual puede prevalecer sobre la recomendación del modelo. La valoración por fotogramas no equivale a ver el vídeo completo ni a escuchar su audio. Solo se descargan archivos PNG, JPEG, WebP, MP4 y WebM; páginas de YouTube o reproductores incrustados pueden conservarse como referencia, pero no se consideran clips descargables. Se limitan tamaño, duración de operaciones y redirecciones y se bloquean destinos privados en descargas de investigación.

El selector **Modo de ejecución**, visible al crear y al abrir el proyecto, permite **Automático** o **Paso a paso · con supervisión**. Automático continúa hasta el MP4 y sus comprobaciones. El modo supervisado pausa las dependencias tras investigación, valoración de medios, guion, storyboard, plan audiovisual, grabaciones y producción de recursos. **Revisar etapa** muestra resultados y dependencias; **Aprobar etapa y continuar** acepta los artefactos de la etapa y reanuda. También puedes aprobar o regenerar artefactos individualmente. Cambiar de modo conserva tareas terminadas y archivos renderizados; no exige repetir llamadas aceptadas.

La colección y sus decisiones se guardan en SQLite, `project.json` y `resources.json`. Las previsualizaciones están en `resources/<id>/` y los archivos listos para render en `media/`. Se recuperan junto con el resto del proyecto después de cerrar la aplicación.

## Capacidades disponibles para los agentes

El director, diseñador de storyboard y revisores reciben `context.capabilities` completo en cada intento, incluso con contexto mínimo. Se genera a partir del contrato JSON, versiones instaladas, renderizador, salida y perfil del proyecto, proveedores habilitados con credenciales disponibles, permisos de búsqueda y escritorio, y herramientas locales preparadas. Investigación y guion reciben un catálogo compacto para reducir contexto.

El catálogo diferencia las posibilidades generales de [Remotion](https://www.remotion.dev/docs/animating-properties) y [HyperFrames](https://hyperframes.app/docs/3-guides/3-gsap-animation) de los componentes que esta app expone ahora. Describe las presentaciones de cada tipo, sus límites, entradas, subtítulos, recursos, perfil y ejemplos. El agente entrega storyboard JSON; la generación de JSX/HTML/GSAP libre requiere ampliar el contrato y los adaptadores.

También detalla los permisos reales de [Codex CLI](https://learn.chatgpt.com/docs/non-interactive-mode) y [Claude Code](https://code.claude.com/docs/en/headless): JSON estructurado, lectura, visión de imágenes, búsqueda opcional, sesiones y MCP. Los agentes delegan a través del DAG del harness. El control del PC queda reservado al operador; FFmpeg y Whisper los ejecuta el harness. No se presupone acceso a herramientas nativas de subagentes ni al Agent SDK.

Con MCP se puede refrescar el catálogo mediante `studio_capabilities`; está protegido por la sesión y el proyecto. `GET /api/projects/:id/capabilities` permite consultarlo desde la API local. Cada intento guarda `runs/<task>/<attempt>/capabilities.json` junto al prompt y el contexto. El snapshot actual prevalece sobre capacidades de sesiones anteriores y no contiene credenciales ni comandos de servidores externos.

## Render y revisión del resultado

El montaje final une las escenas con transiciones reales (xfade y acrossfade de FFmpeg: fundido, disolución, cortinillas, deslizamientos, círculo, zoom, pixelado…; un corte no solapa), baja la música automáticamente bajo la voz (sidechain) y normaliza la sonoridad a -14 LUFS por defecto. Los subtítulos SRT se ajustan a los solapes. La revisión técnica muestrea inicio, mitad y final de cada escena programada.

La voz predeterminada de los proyectos nuevos es Kokoro-82M local en español cuando está instalada (Conexiones → Herramientas locales → Voz Kokoro; instala un Python aislado en `.tools/python`). Los tiempos de palabra se obtienen transcribiendo el audio y se alinean con el texto del guion; si Kokoro falla se usa la voz de Windows.


Remotion usa React; HyperFrames genera HTML con GSAP y fuentes locales, lo valida y lo renderiza con su CLI. FFmpeg combina segmentos, música, voz y grabaciones, exporta H.264 y analiza el MP4. La caché de segmentos tiene en cuenta escena, recursos, perfil, dimensiones y fps.

Los componentes incluyen títulos, diagramas, comparaciones, conceptos, citas, secuencias, código, esquemas de ubicaciones, imágenes, vídeos, stock y grabaciones. El componente map representa ubicaciones como esquema. El perfil mantiene tipografía, paleta, logo, transiciones, voz, música y estilo de imágenes; puede compartirse entre proyectos.

La voz local usa Windows SAPI mediante `System.Speech.Synthesis`: genera WAV y entrega eventos temporales de palabras. Elige por defecto la primera voz española instalada; el perfil puede seleccionar otra. Funciona sin API y sin coste por generación. Los subtítulos locales se alinean con ellos; una voz externa sin alineación utiliza tiempos estimados. Las aprobaciones se vinculan al contenido de cada componente y una regeneración genera una nueva clave.

La revisión técnica decodifica el MP4 y analiza negro, silencio y volumen. Extrae una muestra por escena durante la narración: hasta 24 por defecto, o todas las escenas si activas revisión completa. Examina muestras, no cada fotograma.

Whisper.cpp transcribe localmente el audio extraído de los segmentos renderizados. Se contrasta con el guion y los tiempos de subtítulos; el resultado incluye transcripciones, diferencias y observaciones. El modelo multilingüe tiny puede confundir siglas o nombres; no certifica la pronunciación. La revisión final del CLI recibe las imágenes, fuentes, metadatos del MP4 y análisis del audio; puede solicitar correcciones parciales.

En Conexiones → Herramientas locales puedes preparar Whisper o WASAPI. El OCR usa Tesseract en español e inglés y descarga sus modelos al primer uso. Los instaladores verifican hashes y también respetan `LUMEN_TOOLS_DIR`.

## Alternativas de voz local evaluadas

Investigación del 2 de octubre de 2026. La clonación de voz es un requisito preferente del usuario. Son candidatas: la integración local activa sigue siendo Windows SAPI. No se han instalado ni medido estos motores y no se anuncian como herramientas disponibles en el catálogo del agente.

| Candidata | Código y modelos oficiales | Encaje |
| --- | --- | --- |
| Chatterbox Multilingual V3 | [Código MIT](https://github.com/resemble-ai/chatterbox/blob/master/LICENSE), modelos MIT de [español de España](https://huggingface.co/ResembleAI/Chatterbox-Multilingual-es-es) y [Latinoamérica](https://huggingface.co/ResembleAI/Chatterbox-Multilingual-es-mx-latam) | Primera candidata para clonación y narración en español a partir de audio de referencia. CPU admitida; GPU opcional. Incluye marca de agua de audio. |
| Qwen3-TTS Base | [Código Apache 2.0](https://github.com/QwenLM/Qwen3-TTS/blob/main/LICENSE), modelos Base Apache 2.0 de [0.6B](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base) y [1.7B](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base) | Clonación desde una muestra corta y soporte de español. Base admite reutilizar el prompt de voz entre generaciones; CustomVoice usa voces predefinidas y VoiceDesign diseña por texto. No atribuir todas las funciones a todas las variantes. |
| Parler-TTS Mini Multilingual v1.1 | [Código Apache 2.0](https://github.com/huggingface/parler-tts/blob/main/LICENSE), [modelo Apache 2.0](https://huggingface.co/parler-tts/parler-tts-mini-multilingual-v1.1) | Español, voces nombradas y descripción de estilo. Comparación adicional si su velocidad resulta aceptable. |

Estas licencias permiten uso comercial bajo sus condiciones, incluidos los avisos de licencia correspondientes. Antes de distribuir un motor deben fijarse versiones, auditar dependencias y archivos del modelo y conservar los avisos. Los clips de referencia para clonación necesitan derechos de uso propios; la licencia del motor no los concede. Aún no hay una auditoría completa del paquete ni un benchmark local de calidad, memoria o velocidad.

Otras opciones requieren más cuidado con su distribución:

- [Kokoro](https://github.com/hexgrad/kokoro) y sus [pesos Apache 2.0](https://huggingface.co/hexgrad/Kokoro-82M) son compactos, pero la ruta de español usa eSpeak NG, bajo [GPLv3](https://github.com/espeak-ng/espeak-ng/blob/master/COPYING). Hay que revisar el paquete combinado.
- [MeloTTS-Spanish](https://huggingface.co/myshell-ai/MeloTTS-Spanish) declara MIT, pero su instalación estándar incluye [Unidecode](https://github.com/myshell-ai/MeloTTS/blob/main/requirements.txt), bajo [GPLv2 o posterior](https://pypi.org/project/Unidecode/1.3.7/). No tratar el entorno completo como si todo fuera MIT.
- [Piper mantenido](https://github.com/OHF-Voice/piper1-gpl) usa GPLv3; cada voz requiere revisar su licencia. GPL permite uso comercial, con obligaciones de redistribución.
- [Supertonic](https://github.com/supertone-oss-archive/supertonic) combina código MIT y modelos OpenRAIL-M con restricciones de uso. El repositorio oficial está archivado; no es la primera opción para este proyecto.

La integración propuesta debe permitir importar una muestra propia o autorizada, guardar un perfil de voz reutilizable, preescuchar una frase y usar ese perfil en todos los segmentos. Cada perfil debe conservar motor y versión del modelo, referencia y sus derechos de uso. Las palabras y subtítulos se alinearán sobre el audio producido; estos modelos no garantizan los eventos SAPI. Este flujo aún no está implementado.

Este PC tiene Radeon 530 e Intel UHD 620, sin NVIDIA. La próxima comparación debe usar CPU, la misma referencia y guion español y medir tiempo por minuto de audio, RAM, pronunciación de siglas, pausas, parecido con la referencia y consistencia entre escenas. La selección se hará después de esa prueba, sin asumir aceleración CUDA.

## Multimedia externa y recuperación

Los adaptadores fal, Pexels y HTTP son opcionales. Permanecen desactivados hasta habilitarlos y permitir multimedia externa en el proyecto. Configura claves en `.env`, usando los nombres de variables de `.env.example`; el JSON público guarda esos nombres, nunca las claves.

Ejemplo:

```json
{ "id": "imagen-fal", "adapter": "fal", "kind": "image", "model": "fal-ai/flux/schnell", "keyEnv": "FAL_KEY", "enabled": false, "input": {} }
```

Para Pexels usa adapter=pexels, kind=stock y keyEnv=PEXELS_API_KEY. Para vídeo o música de fal indica un modelo compatible y sus parámetros input. Para voz externa configura un proveedor voice y el perfil `provider:su-id`. Si falla, se usa la voz local.

Un proveedor HTTP recibe JSON con prompt, kind y los parámetros input. Puede devolver `{url}`, `{images:[{url}]}`, `{video:{url}}` o `{audio:{url}}`. Lumen descarga y comprueba el formato. ComfyUI requiere un puente que cumpla este contrato. También puedes subir imágenes, clips, música y narración locales.

Las solicitudes externas se registran en SQLite antes de enviarlas. Una cola con identificador remoto se reanuda tras cerrar la app; un resultado aceptado se reutiliza. Si la conexión se pierde antes de conocer el identificador, se bloquea su repetición automática y puedes reconciliar la URL o descartar la solicitud en Solicitudes externas. Solo un proveedor que declare soporte de idempotencia recibe Idempotency-Key. Descartar localmente no cancela el trabajo remoto.

Los fallos de vídeo pueden recurrir a un proveedor de imagen y después a una ilustración local. Se conserva la traza de los intentos. Los servicios pueden facturar aparte de la suscripción del CLI. Sus contratos están probados con servicios locales; no se han hecho generaciones de pago ni validado tus cuentas.

## Computer use y grabación

Activa Control del PC en el proyecto. Los operadores pueden capturar la pantalla principal, hacer clic, escribir, pulsar teclas y grabar. La reserva exclusiva evita operaciones simultáneas; la parada de emergencia revoca el acceso y detiene la grabación.

FFmpeg graba hasta cinco minutos. La opción Sonido del PC captura la salida del dispositivo de audio predeterminado con WASAPI y la integra como AAC en el MP4. La captura no instala controladores. El acceso al PC y la captura del sonido deben estar habilitados en el proyecto o en la petición de grabación correspondiente.

Prepara la demostración en primer plano. Asigna cada clip a su escena mediante visual.recordingId. Los clips cortos se repiten durante la escena; su sonido puede reproducirse junto a la narración.

## Biblioteca y conocimiento

Las fuentes PDF, TXT, Markdown y JSON se fragmentan e indexan con SQLite FTS5. Los PDF con texto conservan referencias de página; las páginas escaneadas se reconocen con OCR. Se admiten hasta 500 páginas por PDF y se limita el OCR a 50 páginas escaneadas por importación.

La biblioteca compartida guarda fuentes, medios y estilos. Los proyectos importan copias independientes; cambiar el origen no modifica esas copias. Consultar biblioteca compartida recupera fragmentos relevantes sin cargar el documento entero. Los documentos son evidencia: las skills indican que no se sigan instrucciones operativas insertadas en ellos.

## Persistencia y experimentos

SQLite conserva proyectos, tareas, solicitudes externas, biblioteca, versiones y auditoría. Reiniciar pausa ejecuciones interrumpidas y mantiene artefactos aceptados. Las versiones se guardan al editar y terminar producción; restaurarlas conserva medios inmutables y descarta sesiones posteriores.

Cada carpeta de proyecto contiene project.json, plan.json, script.json, storyboard.json, assets.json, render.json y directorios knowledge, artifacts, runs, review, media e hyperframes. Los intentos conservan prompt, contexto, capacidades, contrato, skills, eventos CLI, resultados y stderr. No publiques `.data` ni `.env`.

El Laboratorio prepara comparaciones de Codex/Claude, A/B/C, contexto mínimo/completo, sesiones nuevas/persistentes y duraciones de 1, 3, 5 o 10 minutos. Su matriz completa produce hasta 96 casos. Prepararlos no ejecuta los agentes: revisa y pulsa Ejecutar. Los lotes se pueden pausar, continuar y exportar a JSON.

Se registran llamadas, tokens, caché, tiempo de agentes y producción, revisiones y fallos. El tiempo de agentes puede superar el transcurrido por el paralelismo. Los CLI no exponen aquí la cuota oficial de suscripción; registra sus observaciones manualmente. No se han ejecutado todos los benchmarks largos ni demostrado qué motor consume menos cuota.

## Verificación

```powershell
npm test
npm run build
npm run test:ui
node scripts/infrastructure-smoke.mjs --audio
node scripts/screen-audio-smoke.mjs
node scripts/full-pipeline-smoke.mjs
node scripts/capabilities-smoke.mjs
node scripts/design-smoke.mjs
# Usa un MP4 local de 4 segundos, con dos planos rojo/azul, para la prueba de agentes:
node scripts/design-agents-smoke.mjs RUTA_DEL_VIDEO.mp4
```

Verificados en este equipo: **71 pruebas de backend y 9 de interfaz**; producción real mediante los dos CLI; Remotion vertical 720×1280 a 24 fps y HyperFrames cuadrado 720×720 a 30 fps; revisiones visual y de audio; OCR de un PDF sin texto; grabación real de pantalla y sonido en H.264/AAC; arranque de Electron y producción desde el paquete portátil a 1080×1080 y 60 fps con transcripción local. Las pruebas usan carpetas independientes.

También se ha verificado que los dos CLI consultan `studio_capabilities` por MCP y producen storyboards multicapa válidos con dos cortes distintos del mismo recurso. La prueba de composición renderiza gráficos, imagen y fragmentos en ambos motores y comprueba los píxeles del intervalo esperado. La prueba de interfaz inserta cortes, edita geometría/keyframes y comprueba el diseño móvil.

Las pruebas de CLI consumen cuota; las de grabación capturan el escritorio real y pueden reproducir una señal de prueba. Los proveedores de pago se prueban mediante contratos controlados. Los informes y capturas están en `.data/verification`; las pruebas de interfaz usan `.data/ui-tests-*`.

El servidor se limita a 127.0.0.1 y comprueba el origen. Es una aplicación de uso local, sin cuentas multiusuario ni despliegue público configurado.

Referencias técnicas: [HyperFrames](https://hyperframes.app/docs/5-packages/cli), [cola fal](https://fal.ai/docs/documentation/model-apis/inference/queue), [Pexels](https://www.pexels.com/api/documentation/), [Whisper.cpp](https://github.com/ggml-org/whisper.cpp), [Tesseract.js](https://github.com/naptha/tesseract.js), [NAudio](https://github.com/naudio/NAudio), [Electron](https://www.electronjs.org/docs/latest/tutorial/security).

## Licencia

Lumen Studio se distribuye bajo la [GNU Affero General Public License v3.0](LICENSE). Las dependencias conservan sus licencias: en particular, **Remotion** tiene su [propia licencia](https://www.remotion.dev/docs/license), que exige licencia de empresa a partir de cierto tamaño de organización; HyperFrames es Apache 2.0 y Manim y Revideo son MIT. Los efectos de `assets/sfx` proceden de `@remotion/sfx` (MIT, uso sin atribución).
