# Tasks: Publicaciones del feriante y compartir

Convenciones de §10.1. TDD en dominio, API y componentes. Cada tarea cierra con su evidencia en esta lista.

```
MED-01 ─> MED-02 ─> MED-03 ─┬─> MED-04 ─> MED-05 ─┐
                             │                      ├─> MED-08 ─> MED-09
MED-06 ─────────────────────┘                      │
MED-07 ─────────────────────────────────────────────┘
MED-03 ─> MED-11 (moderación, organizador)
MED-01 ─> MED-12 (borrado al terminar el evento)
MED-10 (al final)
```

### MED-01 — Migración de publicaciones

- **Estado:** `DONE` (2026-11-18)
- **Evidencia:**
  - `apps/api/drizzle/0022_exhibitor_media.sql`, generada desde `schema.ts` con `drizzle-kit generate`; aplicada en la base de desarrollo (23 migraciones).
  - Verificado en la base: un video sin evento o con duración nula se rechaza (`exhibitor_photos_duration_check`); un video válido con evento entra. Ambas pruebas en transacción revertida.
  - Las filas existentes quedan como `IMAGE` sin evento, sin cambios.
  - Nota: el check `exhibitor_photos_publication_event_check` exige evento para cualquier publicación (video o imagen con texto); las fotos de perfil sin texto siguen sin evento.
- **Entrega:** migración que extiende `exhibitor_photos` con `kind`, `event_id`, `caption` y `duration_s`; estado `HIDDEN`; checks de tipo y tamaño por `kind`; `video/mp4` y `video/webm` permitidos; RLS intacta.
- **Aceptación:**
  - las filas existentes quedan como `IMAGE` con `event_id` nulo y sin cambios;
  - toda publicación nueva exige `event_id`;
  - un video sin `duration_s` o con más de 60 s se rechaza en la base;
  - una imagen con `duration_s` se rechaza.
- **Pruebas:** unit de la política; verificación de la migración en la base de Docker (`db-migrate`).

### MED-02 — Política de publicaciones (dominio)

- **Estado:** `DONE` (2026-11-18)
- **Evidencia:** `photo-policy.spec.ts` con 18 tests en verde (8 nuevos: límites, formatos, duración, tamaño, texto, evento, cupo por evento). `tsc` limpio. `validateMediaUpload` devuelve el motivo (`FORMAT`, `SIZE`, `DURATION`, `CAPTION`, `EVENT`) y un mensaje en castellano; las funciones de fotos de perfil no cambiaron.
- **Entrega:** `photo-policy.ts` con límites por tipo (5 MB imagen, 50 MB video, 60 s, 200 caracteres de texto, 10 publicaciones por feriante y evento) y lista de formatos sin conversión (MP4 H.264+AAC, WebM VP8/VP9+Opus/Vorbis).
- **Aceptación:** tests de tipo, tamaño, duración, texto, cupo por evento y formatos; mensajes en castellano.
- **Pruebas:** unit (`photo-policy.spec.ts`).

### MED-03 — API del feriante: subir, confirmar, editar, borrar

- **Estado:** `DONE` (2026-11-20): código, unit e integración hechos.
- **Evidencia:**
  - `photo.input.ts`: `requestPhotoInput` acepta video, evento, texto y duración, y aplica `validateMediaUpload`; `updateCaptionInput` valida el texto.
  - `photos.service.ts`: subir exige evento donde el feriante tenga stand `CONFIRMED` (`NO_STAND_IN_EVENT`) y evento vigente (`EVENT_CLOSED`); cupo por evento (`PUBLICATION_LIMIT`); el cupo de perfil (6) sólo cuenta fotos sin evento; `complete` valida con la política completa y el evento sigue abierto; `updateCaption` sólo para publicaciones de eventos vigentes; `listOwn` devuelve `READY` y `HIDDEN`.
  - `photos.controller.ts`: `PATCH /exhibitors/me/photos/:id` para el texto. Ruta protegida (401 sin sesión, verificado con la API en Docker).
  - El barrido de pendientes ya limpia cualquier fila `PENDING` vencida, así que los videos quedan cubiertos.
  - Unit: `photo-policy.spec.ts` con 28 tests en verde (10 nuevos de entrada para publicaciones). `tsc` limpio.
  - Int spec `apps/api/test/publications.int-spec.ts` (18 tests en verde, dentro del contenedor): subida de perfil y de video, confirmación con HEAD (409 `UPLOAD_MISSING`, 422 con tipo distinto y archivo borrado), cupo de perfil (`PHOTO_LIMIT`) y por evento (`PUBLICATION_LIMIT`), evento sin stand (403), video sin duración (400), evento terminado (409 `EVENT_CLOSED`), edición del texto y 404 ajeno.
  - **Falla ajena al change:** `src/auth/redis-counter-store.spec.ts` ("cold start 503") falla de forma consistente con `Connection is closed` del ioredis real, aunque el spec mockea ioredis. No hay cambios en `src/auth`; queda para revisar aparte.
- **Entrega:** `POST` de subida firmada (con `kind`, `event_id`, `duration_s` y tipo), `complete` con HEAD para tamaño y tipo, `PATCH` del texto, `DELETE`, `GET` propio. Mismo patrón que documentos y fotos. Rechaza eventos que ya terminaron.
- **Aceptación:**
  - sólo se listan y editan las publicaciones propias;
  - no se puede publicar en un evento terminado;
  - un video confirmado con tamaño o tipo distintos de lo declarado se rechaza;
  - el barrido de subidas pendientes (`ExhibitorPhotosSweeper`) también borra videos pendientes.
- **Pruebas:** unit del servicio; int spec de los endpoints (cuando la conexión desde el host funcione; hasta entonces, prueba manual en Docker).

### MED-04 — API pública: publicaciones con consentimiento

- **Estado:** `DONE` (2026-11-18)
- **Evidencia:**
  - `public-exhibitor.ts`: `PublicMedia` y el campo `media`; sin consentimiento no se devuelve nada. `public-exhibitor.spec.ts` con 8 tests en verde (2 nuevos).
  - `public-events.service.ts`: `photosOf` sólo toma fotos de perfil (`event_id` nulo); `mediaOf` toma las publicaciones del evento que se ve, `READY`, de expositores con consentimiento y de eventos que no terminaron. Las firmas de lectura vencen en 1 hora.
  - Verificado contra la base: una publicación `READY` aparece con tipo, texto y duración; una `HIDDEN` no aparece. Las filas de prueba se borraron después.
  - `tsc` limpio; respuesta 200 del mapa con los 9 expositores.
- **Entrega:** el mapa público y la ficha del expositor devuelven `media: [{id, kind, url, caption, durationS}]`, sólo `READY`, sólo las no ocultas, sólo con consentimiento, sólo de eventos que no terminaron, con URLs firmadas de 1 hora.
- **Aceptación:** sin consentimiento, `media` vacío; las ocultas y las de eventos terminados no aparecen; las claves de almacenamiento no aparecen en la respuesta.
- **Pruebas:** unit de la función de consentimiento (ya existe para fotos), extendida a videos.

### MED-05 — Endpoint de compartir con metadatos en el servidor

- **Estado:** `DONE` (2026-11-18)
- **Evidencia:**
  - `GET /api/v1/public/share/:mediaId` devuelve HTML con `og:title`, `og:description`, `og:url`, `og:image` (o `og:video`), `twitter:card`, y una redirección a `/ferias/:slug?publicacion=:id`.
  - La ruta vive bajo `/api/`, así que el rewrite de Firebase que ya existe la cubre; `firebase.json` no cambia.
  - Migración `0023_public_media_share`: función `public_media_share(uuid)` con la misma visibilidad que el mapa (READY, no oculta, consentimiento, evento vigente), `SECURITY DEFINER` y sin acceso para `PUBLIC`.
  - `share-page.spec.ts` con 4 tests en verde (imagen, video, redirección, escape de texto).
  - Verificado contra la API real: publicación lista → 200 con tags; oculta e inexistente → 404 con el mismo mensaje. Las filas de prueba se borraron.
  - Pendiente, en la web (MED-07): que `/ferias/:slug?publicacion=` abra esa publicación.
- **Aceptación:**
  - el HTML tiene `og:title`, `og:description`, `og:image` (o `og:video`) y `og:url`;
  - un id inexistente o de un feriante sin consentimiento responde 404 con el mismo cuerpo;
  - el texto de la publicación se escapa en el HTML (sin inyección).
- **Pruebas:** unit del renderizado y del escape; prueba manual con el depurador de Facebook (Sharing Debugger) y con la vista previa de WhatsApp.

### MED-06 — Web del feriante: publicaciones

- **Estado:** `PARTIAL` (2026-11-20): código y unit tests hechos; e2e dedicado pendiente.
- **Evidencia:**
  - `domain/publication-rules.ts`: formato, tamaño, duración (1..60 s), texto (200) y cupo (10 por evento), con 6 tests en verde. El video sólo se decodifica si el formato es soportado.
  - `exhibitor-publications-section.ts`: elegir feria (sólo las de stand confirmado), subir imagen o video con barra de progreso, texto opcional, lista de la feria elegida con miniaturas, editar texto, eliminar, marca de "oculta por el organizador", y errores junto al control. Sin ferias, el control no aparece y se explica por qué.
  - Repositorio: campos de publicación, `updateCaption` y `myEvents` (HTTP y en memoria). Las fotos de perfil ya no muestran publicaciones.
  - `exhibitor-publications-section.spec.ts`: 7 tests en verde. Suite web completa: 90 archivos, 720 tests en verde. `tsc` limpio.
  - e2e completo: 76 pruebas en verde contra el servidor de desarrollo (puerto 4300), no contra la imagen Docker (build anterior).
  - **Pendiente:** e2e dedicado con API mockeada (subir imagen y video, cupo, editar y eliminar), y el `::file-selector-button` revisado en el navegador.
- **Entrega:** sección "Publicaciones" en el perfil del feriante: subir imagen o video con progreso, texto opcional, lista con miniaturas, editar texto, borrar. Validación en el navegador (tipo, tamaño, duración leyendo el video local) con errores junto al control.
- **Aceptación:**
  - un video de más de 60 s se rechaza antes de subir;
  - el cupo de 10 se muestra y bloquea la subida;
  - el control de archivo usa `::file-selector-button` y tiene `accept` con los tipos.
- **Pruebas:** unit del componente (tipo, tamaño, duración, cupo); e2e con API mockeada.

### MED-07 — Visitante: galería con videos en el modal

- **Estado:** `DONE` (2026-11-20)
- **Evidencia:**
  - `domain/stand-media.ts`: `galleryOf` (publicaciones primero, luego fotos de perfil; la del enlace de compartir va primero) y `standForPublication`. `stand-media.spec.ts` con 6 tests en verde.
  - `stand-detail-dialog`: videos con `controls`, `preload="metadata"` y sin `autoplay`; texto de cada publicación; imágenes con texto alternativo (su texto o el nombre del expositor). Input `highlight`. 8 tests en verde.
  - `fair-map.page.ts`: `?publicacion=<id>` abre el modal del stand de esa publicación, una sola vez, con esa publicación primero.
  - Expositor público con `media` (adaptadores HTTP y en memoria con `[]` por defecto).
  - e2e: `stand-media.e2e.ts` (enlace de compartir abre el video con su texto; sin enlace, el orden no cambia) y suite completa en verde: 78 pruebas, contra el servidor de desarrollo.
  - Suite web: 91 archivos, 728 tests en verde. `tsc` limpio.
  - Movimiento: el video no arranca solo y la galería no anima; el `scroll-snap` ya existente no depende de animaciones.
- **Entrega:** la galería del modal de stand muestra imágenes y videos (`<video controls preload="metadata">`, sin autoplay), con el texto de cada publicación y `alt` obligatorio en imágenes.
- **Aceptación:** sin movimiento automático; respeta `prefers-reduced-motion`; el teclado llega a cada publicación.
- **Pruebas:** unit del modal; e2e con un video de prueba.

### MED-08 — Util de compartir

- **Estado:** `PARTIAL` (2026-11-20): código, unit tests y e2e hechos; falta verificar en celular real y en el bucket.
- **Evidencia:**
  - `shared/share.ts`: `shareMedia` usa el menú nativo con el archivo (incluye Instagram) si el navegador lo permite; si no, ofrece WhatsApp, Facebook, copiar link y descargar. Cancelar el menú nativo no es error. Sin SDK externo.
  - `share.spec.ts`: 5 tests en verde.
  - Modal del stand: botón "Compartir" en cada publicación (no en fotos de perfil), menú de opciones y aviso de "Link copiado." o de error. 10 tests en verde.
  - e2e `stand-media.e2e.ts`: el menú ofrece WhatsApp y Facebook apuntando a la página de compartir de la publicación, y no ofrece Instagram sin menú nativo. Suite completa: 79 pruebas en verde.
  - **Desviación:** el aviso de "copiado" es un texto con `role="status"`, no un toast ni `ariaNotify`. Sirve igual para lectores de pantalla.
  - **Pendiente:** probar el menú nativo en un celular real (Instagram sólo aparece ahí) y confirmar que el bucket permite leer los archivos desde el navegador (CORS `GET`), porque el archivo se descarga para adjuntarlo.
- **Entrega:** `shared/share.ts` con `shareMedia(item)`:
  1. si `navigator.canShare({ files })` existe, usa `navigator.share({ files, text, url })`;
  2. si no, ofrece las opciones de WhatsApp, Facebook y "Copiar link";
  3. Instagram sólo aparece en el paso 1; en escritorio se descarga el archivo con la instrucción.
- **Aceptación:**
  - el usuario que cancela el menú nativo no ve error;
  - "copiar" muestra confirmación con `ariaNotify` o el aviso de toasts;
  - sin ningún SDK externo (no se carga el de Meta).
- **Pruebas:** unit con `navigator.share`, `canShare` y `clipboard` simulados.

### MED-09 — Accesibilidad y e2e

- **Estado:** `PARTIAL` (2026-11-20): e2e y axe hechos; falta el video válido de punta a punta.
- **Evidencia:**
  - `e2e/exhibitor-media.e2e.ts` (9 pruebas en verde):
    - el feriante sube una foto a la feria donde tiene stand, con su texto, y lo ve listado;
    - un video que el navegador no puede leer se rechaza antes de enviarse (sin POST);
    - el visitante llega a la publicación compartida con teclado (video, luego botón "Compartir") y el menú ofrece WhatsApp y Facebook;
    - axe sin fallas en la sección de publicaciones y en el modal, en los 6 temas.
  - El mock de `/exhibitors/me/photos` ahora tiene estado: listar, subir, confirmar, editar texto y borrar.
  - Hallazgo: el axe del modal daba falsos positivos mientras corre la animación de entrada; los tests esperan `opacity: 1` antes de analizar (el mismo criterio del e2e del modal).
  - Suite e2e completa: 88 pruebas en verde.
  - **Pendiente:** el video válido de punta a punta no se automatizó, porque el navegador de prueba no puede generar un video que pueda leer. Y el puente entre lo que sube el feriante y lo que ve el visitante sigue simulado: el mapa del mock no refleja lo subido. Eso se cubre con pruebas de API en Docker, cuando la conexión desde el host funcione.
- **Entrega:** e2e del flujo completo (el feriante sube imagen y video, el visitante abre el modal, comparte con el fallback); axe en la página de publicaciones y en el modal, en los 6 temas.
- **Aceptación:** sin fallas de axe; la galería se navega con teclado; los botones de compartir tienen nombre accesible con la red social.
- **Pruebas:** `themes.e2e.ts` y un spec nuevo `exhibitor-media.e2e.ts`.

### MED-11 — Moderación: el organizador oculta publicaciones

- **Estado:** `DONE` (2026-11-20): código, unit, e2e e integración hechos.
- **Evidencia:**
  - `visibilityAfter` (en `photo-policy.ts`): sólo cambian publicaciones `READY` y `HIDDEN`; una subida pendiente se rechaza; pedir el mismo estado no cambia nada. 3 tests en verde.
  - API: `GET /events/:id/publications` y `PATCH /events/:id/publications/:photoId` con `{ hidden }`, sólo para owner, admin y operador (`MANAGERS`). Cambiar el estado queda en `audit_logs` (`exhibitor_publication.hidden` / `.shown`). El archivo no se borra. Rutas verificadas: sin sesión responden 401.
  - Web: pestaña "Publicaciones" en el detalle del evento, con los botones "Ocultar" y "Mostrar". `event-publications-panel.spec.ts` con 4 tests en verde.
  - e2e: `organizer-publications.e2e.ts` (ocultar y mostrar) y suite completa en verde: 89 pruebas.
  - Quien oculta ve la marca en el plano y al compartir: el mapa y la página de compartir ya filtran por estado (MED-04 y MED-05).
  - Int spec `publications.int-spec.ts`: lista sólo publicadas con nombre del feriante, 403 para feriantes, ocultar y mostrar con auditoría (orden `uploaded` → `hidden` → `shown`), 404 para publicación ajena al evento y 403 para un miembro que no es organizador.
- **Entrega:** en el panel del evento, lista de publicaciones del evento con "Ocultar" y "Mostrar"; endpoint del organizador que cambia `READY` ↔ `HIDDEN` (auditado en `audit_logs`). El feriante ve la marca "oculta" en su lista.
- **Aceptación:**
  - una publicación oculta desaparece de mapa, galería, compartir y vista previa;
  - el archivo no se borra al ocultar;
  - sólo el organizador del evento puede cambiar el estado (RLS y rol).
- **Pruebas:** unit del cambio de estado; e2e del panel del organizador con API mockeada; axe en la lista.

### MED-12 — Borrado de publicaciones al terminar el evento

- **Estado:** `PARTIAL` (2026-11-20): regla, consulta, job e integración hechos; falta sólo la confirmación del plazo por asesoría.
- **Evidencia:**
  - `isRetentionDue` (en `photo-policy.ts`): vencida cuando pasaron `MEDIA_RETENTION_DAYS` desde el fin del evento. 2 tests en verde.
  - `MEDIA_RETENTION_DAYS` en la configuración (por defecto 0, entre 0 y 3650 días), con su test. 55 tests de configuración en verde.
  - `publication-retention.service.ts`: recorre los tenants, borra filas y archivos de publicaciones de eventos vencidos con `FOR UPDATE SKIP LOCKED`, audita `exhibitor_publication.retention_deleted` con id y fecha (sin claves de archivo), y corre cada 10 minutos fuera de los tests. Registrado en el módulo de exhibitors.
  - Las fotos de perfil (sin evento) no se tocan.
  - Verificado contra la base: una publicación de la feria del 14/11 (ya terminada) aparece en la consulta del barrido, se borra con su bloqueo, y no queda ninguna pendiente. La fila de prueba se borró al final.
  - La API arrancó con el job registrado y responde 200.
  - Int spec `publications.int-spec.ts`: el barrido borra filas y archivos (10 publicaciones, READY y pendientes) de un evento terminado, conserva las fotos de perfil, audita cada borrado con `before_json.eventId`, y una segunda pasada borra 0.
  - **Pendiente:** el plazo exacto de retención (al terminar o unos días después): lo confirma el abogado. Hasta entonces, queda en 0 días.
- **Entrega:** job de limpieza (mismo patrón que `ExhibitorPhotosSweeper`, con `SKIP LOCKED`) que, para eventos con `ends_at` vencido, borra las filas y los archivos de sus publicaciones. Las fotos de perfil (`event_id` nulo) no se tocan.
- **Aceptación:**
  - un evento terminado no conserva ninguna publicación ni archivo;
  - el job es idempotente y no borra publicaciones de eventos vigentes;
  - queda registro del borrado en `audit_logs` (cantidad, sin datos personales).
- **Pruebas:** unit del criterio de elegibilidad; int spec del job cuando la conexión desde el host funcione; verificación en Docker.
- **Pendiente legal:** el plazo exacto (al terminar o unos días después) lo confirma el abogado; el job queda parametrizado (`MEDIA_RETENTION_DAYS=0` por defecto).

### MED-10 — Documentación y spec

- **Estado:** `DONE` (2026-11-20). El change sigue `IN_PROGRESS`: pasa a `VERIFIED` cuando se cierren MED-03, MED-08 y MED-09 (pendientes de cada una) y MED-11 y MED-12.
- **Evidencia:**
  - `specification.md`: fila `EXH-09` en §10.1 (estado `IN_PROGRESS`) con su detalle y pendientes; dos endpoints nuevos en el índice de §5 (`/exhibitors/me/photos` y `/public/share/:mediaId`).
  - `README.md`: sección "Publicaciones del feriante" (formatos, cupo, compartir, privacidad) y pendientes de `EXH-09`.
  - `IMPLEMENTACION.md`: el bucket usa el mismo CORS (`PUT` y `GET`) y la página de compartir queda bajo `/api/**`.
  - Corrección: el ID del change era `EXH-05`, pero ese ID ya es "Suscripción del feriante". Ahora es `EXH-09` en todos los documentos.
- **Entrega:** fila `EXH-09` en `specification.md` (§10.1), endpoints nuevos en §5, sección de publicaciones en el README y la receta de Firebase (`IMPLEMENTACION.md`, ruta `/share/**`).
- **Aceptación:** el change pasa a `VERIFIED` con la evidencia de cada tarea.

## Orden sugerido

1. MED-01 y MED-02 (cimientos, sin UI).
2. MED-03 y MED-04 (API).
3. MED-05 (compartir en el servidor) antes de MED-08, porque el link de la publicación depende de él.
4. MED-06 y MED-07 en paralelo, una vez que la API responde.
5. MED-08 y MED-09, y al final MED-10.
