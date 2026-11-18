# Design: Publicaciones del feriante y compartir

## Decisiones

### D1. Extender `exhibitor_photos` en vez de crear otra tabla

Las fotos del stand ya tienen subida firmada, verificación con HEAD, RLS, límite por feriante y barrido de subidas no confirmadas. Una publicación de video es el mismo objeto con otro tipo. Se extiende la tabla con:

- `kind` (`IMAGE` | `VIDEO`), con `NOT NULL DEFAULT 'IMAGE'` para las filas existentes;
- `event_id` (`NULL` para las fotos del perfil existentes; **obligatorio para toda publicación nueva**): cada publicación pertenece a un evento;
- `caption` (texto, `NULL` permitido, máx. 200 caracteres);
- `status` ya existe (`PENDING` | `READY`); se suma `HIDDEN` (ver D6);
- `duration_s` (entero, `NULL` para imágenes, `1..60` para videos);
- el check de `content_type` acepta `image/jpeg`, `image/png`, `image/webp`, `video/mp4` y `video/webm`; el de tamaño depende del `kind` (5 MB imagen, 50 MB video).

La tabla conserva su nombre en la migración para no mover datos; en el dominio se la llama "publicación". Las fotos de perfil (`event_id` nulo) no cambian de comportamiento.

**Cambio respecto de la versión anterior:** el cupo de 10 publicaciones es **por feriante y por evento**, no por feriante en total, porque cada publicación se borra al terminar su evento.

### D2. Límites y validación en dos capas

- **Navegador:** tipo, tamaño y duración (cargando el video en un `<video>` local). Da error inmediato.
- **Servidor:** en `complete`, HEAD para tamaño y tipo. La duración no se puede leer del archivo sin procesarlo, así que se toma del cliente y se guarda como declarada. **Riesgo aceptado:** un cliente malicioso puede declarar una duración falsa; el daño es sólo visual (un video más largo que 60 s).

### D2b. Formatos sin conversión

Se aceptan sólo los formatos que el navegador reproduce **sin convertir el archivo**:

- **MP4** con video H.264 y audio AAC;
- **WebM** con video VP8 o VP9 y audio Opus o Vorbis.

Cualquier otro (HEVC, por ejemplo) se rechaza.

**Cómo se verifica:** el navegador intenta cargar el archivo en un `<video>` local. Si no puede decodificarlo, la subida se rechaza con el mensaje "Este video no se puede reproducir en los navegadores; subí un MP4 H.264 o un WebM". El servidor **no inspecciona los códecs** del archivo: confía en la prueba del navegador y en el tipo MIME. Un archivo deliberadamente falso pasaría; el daño es el mismo que en D2, y los navegadores que lo reproducen son los únicos que lo van a mostrar.

### D3. Compartir: Web Share API primero, links como fallback

| Canal | Celular con Web Share (archivos) | Escritorio o sin soporte |
|---|---|---|
| WhatsApp | Menú nativo con el archivo | `wa.me/?text=<texto + link de la publicación>` |
| Facebook | Menú nativo con el archivo | `facebook.com/sharer/sharer.php?u=<link de la publicación>` |
| Instagram | Menú nativo (la app abre con el archivo) | No disponible: se descarga el archivo y se muestra la instrucción |
| Copiar | — | `navigator.clipboard.writeText(link)` |

Instagram sólo acepta publicación desde su app. Por eso no hay un botón que publique en el feed: el botón abre el menú nativo o, en escritorio, descarga el archivo.

### D4. Vista previa de WhatsApp y Facebook: metadatos en el servidor

**Problema:** los rastreadores de Facebook y WhatsApp **no ejecutan JavaScript**. Una página Angular (SPA) no tiene metadatos Open Graph visibles para ellos.

**Decisión:** un endpoint de la API `GET /api/v1/public/share/:mediaId` devuelve HTML con `og:title`, `og:description`, `og:image` (o `og:video`) y `og:url`, y una redirección a `/ferias/:slug?publicacion=:mediaId` para los navegadores. Firebase Hosting enruta `/share/**` a la API, igual que `/api/**`.

Sólo se sirve si el feriante tiene perfil público, la publicación está `READY` y el evento no terminó. Si no, responde 404 con el mismo cuerpo que una publicación inexistente.

### D5. Privacidad y archivos

- Las URLs firmadas de lectura vencen en 1 hora, como hoy.
- La página de compartir no expone claves de almacenamiento: sólo el id de la publicación.
- Un feriante sin consentimiento público no tiene publicaciones visibles, aunque el id sea válido.

### D6. Moderación: el organizador puede ocultar publicaciones

- Estado `HIDDEN`: la publicación deja de aparecer en el mapa, la galería, la página de compartir y la vista previa; el feriante la sigue viendo en su lista, marcada como oculta.
- El organizador la oculta y la vuelve a mostrar desde el panel de su evento.
- Ocultar no borra el archivo: sigue en almacenamiento hasta el borrado de D7.

### D7. Retención: las publicaciones se borran al terminar el evento

- Cada publicación pertenece a un evento (D1). Cuando el evento termina (`ends_at`), un job de limpieza borra **las filas y los archivos** de sus publicaciones, igual que el barrido de subidas pendientes.
- Las fotos de perfil (`event_id` nulo) no se borran con eventos.
- Los links de compartir de esas publicaciones dejan de funcionar al borrarse; es el comportamiento esperado.
- **Pendiente de revisión legal:** el plazo exacto de retención (¿al terminar o unos días después?) y el texto de la declaración de derechos de imagen que el feriante acepta al publicar. Ambos los revisa un abogado, igual que las páginas legales. Hasta esa revisión, el job corre al terminar el evento tal como está definido.

## Riesgos

- **Cuota de almacenamiento:** hasta 10 videos de 50 MB por feriante y por evento. Con muchos feriantes, el costo sube; el borrado de D7 lo acota al tiempo del evento.
- **Compartir en Instagram** depende del celular y de la app instalada; en escritorio la experiencia es sólo de descarga.
- **Códecs (D2b):** la verificación depende del navegador del feriante, no del servidor.
- **Pruebas de integración de la API:** siguen sin conectar desde el host (error `28P01`). Las tareas de la API se verifican con unit tests y con la base de Docker.
