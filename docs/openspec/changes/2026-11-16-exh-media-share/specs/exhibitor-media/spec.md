# Spec: Publicaciones del feriante y compartir (`exhibitor-media`)

Requisitos y escenarios. Cada escenario tiene su prueba en las tareas de `tasks.md`.

## Requisito 1: el feriante publica imágenes y videos

- **Escenario: subir una imagen.** Dado un feriante con perfil público y menos de 10 publicaciones en el evento, cuando sube un JPG de 3 MB con un texto de 80 caracteres, entonces la publicación queda `READY` y aparece en su lista.
- **Escenario: subir un video válido.** Dado un MP4 con video H.264 y audio AAC, de 40 MB y 45 s, cuando lo confirma, entonces queda `READY` con `duración = 45`.
- **Escenario: formato con conversión.** Dado un video HEVC, cuando el navegador no puede reproducirlo, entonces la subida se rechaza con un mensaje que indica MP4 H.264 o WebM.
- **Escenario: evento terminado.** Dado un evento cuyo `ends_at` ya pasó, cuando el feriante intenta publicar en él, entonces la subida se rechaza.
- **Escenario: video demasiado largo.** Dado un video de 75 s, cuando lo elige, entonces el navegador lo rechaza antes de subirlo y no hay ninguna llamada a la API.
- **Escenario: cupo lleno.** Dado un feriante con 10 publicaciones, cuando intenta subir otra, entonces el control queda deshabilitado con un aviso.
- **Escenario: tipo no permitido.** Dado un archivo `.mov`, entonces la subida se rechaza con un mensaje junto al control.

## Requisito 2: privacidad de las publicaciones

- **Escenario: sin consentimiento.** Dado un feriante que no aceptó el perfil público, cuando un visitante ve el stand, entonces no ve sus publicaciones.
- **Escenario: archivo no confirmado.** Dado un archivo subido pero no confirmado, entonces no aparece en ninguna respuesta pública y el barrido lo borra al vencer su plazo.
- **Escenario: claves ocultas.** Dada cualquier respuesta pública, entonces no contiene claves de almacenamiento, sólo URLs firmadas que vencen a la hora.

## Requisito 3: el visitante ve y comparte publicaciones

- **Escenario: galería con video.** Dado un stand con una imagen y un video, cuando el visitante abre el modal, entonces ve ambas publicaciones, el video con controles y sin reproducción automática.
- **Escenario: compartir en celular.** Dado un celular con Web Share API que admite archivos, cuando el visitante toca "Compartir", entonces se abre el menú nativo con el archivo adjunto y el texto.
- **Escenario: compartir en escritorio.** Dado un escritorio sin Web Share, cuando el visitante toca "Compartir", entonces se ofrecen WhatsApp, Facebook y "Copiar link", y no aparece Instagram.
- **Escenario: cancelar el menú.** Dado que el visitante cierra el menú nativo sin elegir, entonces no aparece ningún error.

## Requisito 4: vista previa al compartir

- **Escenario: WhatsApp muestra la publicación.** Dado un link `/api/v1/public/share/:id`, cuando un rastreador lo lee, entonces recibe HTML con `og:title`, `og:description` y `og:image` u `og:video`.
- **Escenario: publicación inexistente.** Dado un id que no existe o de un feriante sin consentimiento, cuando se pide el link, entonces responde 404 con el mismo cuerpo en ambos casos.
- **Escenario: texto con etiquetas.** Dado un texto con `<script>`, cuando se genera el HTML, entonces el texto aparece escapado.

## Requisito 5: accesibilidad

- **Escenario: imágenes con texto alternativo.** Dada una imagen publicada, entonces tiene un `alt` no vacío (el texto de la publicación o el nombre del producto).
- **Escenario: teclado.** Dado un visitante que navega sólo con teclado, entonces llega a cada publicación y a cada botón de compartir, con nombre accesible.
- **Escenario: movimiento reducido.** Dado un usuario con "reducir movimiento" activado, entonces la galería no anima transiciones.

## Requisito 6: moderación del organizador

- **Escenario: ocultar.** Dado un organizador con una publicación `READY` de su evento, cuando la oculta, entonces deja de aparecer en el mapa, la galería, la página de compartir y la vista previa; el feriante la ve marcada como oculta.
- **Escenario: mostrar de nuevo.** Dado una publicación oculta, cuando el organizador la muestra, entonces vuelve a aparecer.
- **Escenario: otro organizador.** Dado un organizador de otra organización, cuando intenta ocultar una publicación ajena, entonces la operación no se realiza.

## Requisito 7: borrado al terminar el evento

- **Escenario: evento terminado.** Dado un evento cuyo `ends_at` pasó, cuando corre la limpieza, entonces se borran sus publicaciones (filas y archivos) y el link de compartir deja de responder.
- **Escenario: fotos de perfil.** Dadas fotos de perfil (sin evento), cuando corre la limpieza, entonces no se borran.
- **Escenario: evento vigente.** Dado un evento que aún no terminó, cuando corre la limpieza, entonces sus publicaciones se conservan.
