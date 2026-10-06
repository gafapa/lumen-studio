---
name: storyboard
description: Diseñar storyboards de Lumen con una selección explícita de componentes, recursos y grabaciones por escena.
---

Antes de decidir el diseño, lee `context.capabilities` completo, también con contexto mínimo. Si hay MCP, `studio_capabilities` permite refrescar el catálogo. Comprueba `selected.renderer`, dimensiones, perfil y `authoring.components`: un mismo tipo puede tener distinta presentación en Remotion y HyperFrames. Usa los límites derivados del contrato y recursos reales del proyecto.

`engines.*.potential` explica lo que admite el motor; `engines.*.enabled` describe lo que esta app expone ahora. Aquí entregas storyboard JSON, no JSX, HTML o GSAP libres. La plantilla clásica `code` es un bloque monoespaciado en Remotion y tarjetas en HyperFrames; `map` no es un mapa geográfico. Las entradas fade/slide no son disoluciones cruzadas. La plantilla clásica de pantalla completa tapa título y puntos. La composición multicapa, disponible en ambos motores, conserva texto, gráficos y medios según sus cajas y orden; subtítulos y logo permanecen encima. No prometas elementos que esa presentación no muestra.

Ten en cuenta `media.providers`, sus tipos y permisos. Si están vacíos, diseña con componentes locales o recursos cargados. Para una demostración nueva pide un operador en el plan; el diseñador no tiene control directo del PC. El catálogo explica la delegación del harness, las sesiones y las herramientas que Codex/Claude pueden usar en este proyecto.

Cada escena debe resolver una pregunta de la audiencia. Prefiere componentes locales cuando expliquen mejor que una imagen decorativa. Elige `timeline` para secuencias, `code` para código, `comparison` para contrastes y `diagram` para relaciones.

Si hay recursos cargados, referencia `visual.assetId`. Para una demostración, referencia el identificador exacto de una grabación completada mediante `visual.recordingId`. No asignar la misma grabación a todas las escenas por defecto.

Lee también `context.resources`: contiene las páginas consultadas, medios descubiertos, procedencia, licencia declarada y valoraciones visuales. El harness examina candidatos antes de ejecutar el storyboard, con una imagen real o tres fotogramas de vídeo. Elige por pertinencia, claridad, encuadre, coherencia con el perfil y espacio para subtítulos; una foto bonita pero ajena al concepto no aporta valor. Utiliza el uso sugerido por el revisor cuando ayude a explicar la escena. No uses candidatos descartados; una selección explícita del usuario prevalece sobre la recomendación del modelo. Los enlaces sin preparar no son archivos disponibles: utiliza únicamente `assetId` de recursos locales existentes. Una licencia no indicada sigue siendo desconocida y no se puede deducir de los píxeles.

Si investigas con MCP, `web_source` guarda la página y descubre sus medios; `resource_search` reúne candidatos de Commons o Pexels configurado; `resource_add` registra hallazgos y `resource_preview` entrega sus píxeles y los prepara para composición. Si descubres un candidato nuevo durante el diseño, inspecciónalo con `resource_preview` antes de asignarlo. No confundas la URL de una página de vídeo con un clip descargable.

Para imágenes, vídeos o stock, indica `visual.prompt` y una lista ordenada de `visual.providerIds` disponibles. Las herramientas ejecutarán los proveedores y conservarán los fallos. Usa la ilustración local si no hay un recurso válido. Evita párrafos en pantalla y deja tiempo para leer el diagrama.

Diseña vídeos con varias técnicas combinadas, usando scene.composition cuando aporta valor. layout=canvas da control completo: 24 capas como máximo, ocho multimedia y 12 keyframes por capa. Usa cajas x,y,w,h en porcentajes, deja el 20% inferior para subtítulos, ordena las capas de fondo a frente y programa start/duration en segundos. Combina imágenes con clips cortos de recursos, diagramas con iconos/flechas, gráficos animados con valores documentados, rótulos y máscaras. Cambia el apoyo cada 2–5 segundos cuando ayude a comprender, varía encuadres y evita repetir siempre la misma plantilla. El movimiento de cámara debe ser suave y no afectar la lectura.

Para extraer trozos utiliza media={assetId,recordingId:null,from,to,rate,fit}; from/to son segundos del vídeo original y el resultado dura (to-from)/rate. start/duration determinan dónde aparece dentro de la escena. Usa duration igual a la duración del fragmento si quieres un corte único; una capa más larga repetirá el clip. Puedes reutilizar el mismo recurso con cortes distintos en varias capas y escenas. El preparador FFmpeg genera los segmentos y conserva ID, procedencia y licencia. No inventes una acción exacta entre fotogramas de muestra; verifica el intervalo disponible o describe la incertidumbre. Los fragmentos multicapa se usan sin audio del recurso; la narración y música son pistas separadas.

En los contratos estrictos rellena los campos irrelevantes con null donde se permita: text, box, style, media, chart e icon; shape=rectangle, motion=none, keyframes=[] cuando no aplican. No añadas CSS o código libre. Las capas text/card/shape/icon/chart/line/counter producen gráficos por código que combinan con media. Los keyframes usan time absoluto de escena, x/y desplazamiento, scale, rotation y opacity. Para plantillas auto puedes sobrescribir una capa por su id, como heading o primary, o añadir capas independientes; canvas requiere al menos una capa.

## Modo código (authoring=code)

Cuando el proyecto está en modo código, cada escena con `engine` hyperframes o remotion la programa después un agente especializado, que escribe HTML/GSAP o React y verifica su resultado con capturas reales. Tu storyboard deja de ser una plantilla y pasa a ser una dirección:

- Elige `engine` por escena. HyperFrames es la opción predeterminada: tiene catálogo de bloques, subtítulos, transiciones, cursores y una verificación de maquetación. Remotion conviene para un montaje intensivo de vídeo, efectos de imagen, etalonaje o física con spring. Reserva `json` para escenas triviales.
- Escribe en `direction` lo que el programador no puede adivinar: qué se ve y en qué orden, el ritmo, el movimiento y la tipografía, el material que se reutiliza (mediaId y segundos de inicio y fin del material), la sincronía con frases concretas de la narración y los efectos de sonido.
- Reutiliza el material del usuario antes que ilustraciones genéricas. Consulta `media_list`, `media_search` y `media_info`; mira las hojas de contactos o pide `media_frames` antes de citar un fragmento. No describas contenido que no has visto.
- Si el usuario aporta su propia locución, usa `voiceover` con el tramo exacto y transcribe en `narration` lo que se dice. Los silencios largos y las muletillas pueden limpiarse con `media_clean_cut`.
- `transition` es la entrada desde la escena anterior: cut no solapa; fade, dissolve, wipe, slide, circleopen, zoomin, etc. solapan 0,4 s.
- En grabaciones de pantalla, `media_info` incluye los clics y zooms sugeridos: pide al programador que siga el cursor, amplíe donde se hace clic y acelere los tiempos muertos.
- `composition` puede ser null en escenas programadas.
