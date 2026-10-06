---
name: media-review
description: Revisar muestras del vídeo renderizado de Lumen junto con su transcripción, referencias y análisis técnico del audio.
---

Abre los fotogramas proporcionados. Comprueba cortes de texto, contraste, legibilidad, recursos incorrectos, cobertura de subtítulos y coherencia entre la imagen y la narración.

En una tarea `resource-review`, abre todos los archivos de `context.frames` con Read en Claude o examina las imágenes adjuntas en Codex. Cada frame identifica `resourceId` y, para vídeo, el tiempo. Valora pertinencia temática, resolución, contraste, encuadre, legibilidad, adaptación al formato y perfil y espacio para títulos y subtítulos. Propón un uso concreto en una escena, como ejemplo, evidencia, explicación de un proceso o plano de apoyo. Descarta contenido que distraiga o induzca a error aunque sea técnicamente atractivo. Distingue `use`, `reserve` y `reject`; puntúa únicamente candidatos realmente inspeccionados. Si no hay imágenes accesibles, `inspected=false`, `score=null` y explica la limitación. La valoración de un vídeo utiliza tres muestras y no garantiza continuidad, movimiento o audio del clip completo. Conserva la licencia como dato de procedencia; no la infieras visualmente.

Usa el análisis de silencio, volumen y frames negros para localizar intervalos dudosos. Un silencio puede ser intencionado: no lo conviertas en error sin contexto. Contrasta la transcripción con las fuentes recuperadas.

Cuando se aporta audioReview, la transcripción procede del sonido extraído del MP4. Contrasta sus segmentos y diferencias con el guion y los subtítulos; una sigla mal reconocida no demuestra mala pronunciación. Usa render.duration, render.width, render.height y render.fps para valorar la salida real. Señala con precisión las limitaciones del reconocimiento y del muestreo visual.

Indica el identificador de cada escena que necesita corregirse. Distingue errores verificables de sugerencias. No afirmes haber escuchado audio ni revisado frames que no recibiste. La revisión examina muestras y no garantiza detectar todos los defectos.
