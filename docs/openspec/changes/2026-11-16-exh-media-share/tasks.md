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

- **Estado:** `PARTIAL` (2026-11-18): código y unit tests hechos; tests de integración pendientes.
- **Evidencia:**
  - `photo.input.ts`: `requestPhotoInput` acepta video, evento, texto y duración, y aplica `validateMediaUpload`; `updateCaptionInput` valida el texto.
  - `photos.service.ts`: subir exige evento donde el feriante tenga stand `CONFIRMED` (`NO_STAND_IN_EVENT`) y evento vigente (`EVENT_CLOSED`); cupo por evento (`PUBLICATION_LIMIT`); el cupo de perfil (6) sólo cuenta fotos sin evento; `complete` valida con la política completa y el evento sigue abierto; `updateCaption` sólo para publicaciones de eventos vigentes; `listOwn` devuelve `READY` y `HIDDEN`.
  - `photos.controller.ts`: `PATCH /exhibitors/me/photos/:id` para el texto. Ruta protegida (401 sin sesión, verificado con la API en Docker).
  - El barrido de pendientes ya limpia cualquier fila `PENDING` vencida, así que los videos quedan cubiertos.
  - Unit: `photo-policy.spec.ts` con 28 tests en verde (10 nuevos de entrada para publicaciones). `tsc` limpio.
  - **Pendiente:** int spec de los endpoints (subir, confirmar con HEAD, cupo por evento, evento sin stand, editar texto). Bloqueado por el error `28P01` desde el host.
  - **Falla ajena al change:** `src/auth/redis-counter-store.spec.ts` ("cold start 503") falla de forma consistente con `Connection is closed` del ioredis real, aunque el spec mockea ioredis. No hay cambios en `src/auth`; queda para revisar aparte.
- **Entrega:** `POST` de subida firmada (con `kind`, `event_id`, `duration_s` y tipo), `complete` con HEAD para tamaño y tipo, `PATCH` del texto, `DELETE`, `GET` propio. Mismo patrón que documentos y fotos. Rechaza eventos que ya terminaron.
- **Aceptación:**
  - sólo se listan y editan las publicaciones propias;
  - no se puede publicar en un evento terminado;
  - un video confirmado con tamaño o tipo distintos de lo declarado se rechaza;
  - el barrido de subidas pendientes (`ExhibitorPhotosSweeper`) también borra videos pendientes.
- **Pruebas:** unit del servicio; int spec de los endpoints (cuando la conexión desde el host funcione; hasta entonces, prueba manual en Docker).

### MED-04 — API pública: publicaciones con consentimiento

- **Estado:** `TODO`
- **Entrega:** el mapa público y la ficha del expositor devuelven `media: [{id, kind, url, caption, durationS}]`, sólo `READY`, sólo las no ocultas, sólo con consentimiento, sólo de eventos que no terminaron, con URLs firmadas de 1 hora.
- **Aceptación:** sin consentimiento, `media` vacío; las ocultas y las de eventos terminados no aparecen; las claves de almacenamiento no aparecen en la respuesta.
- **Pruebas:** unit de la función de consentimiento (ya existe para fotos), extendida a videos.

### MED-05 — Endpoint de compartir con metadatos en el servidor

- **Estado:** `TODO`
- **Entrega:** `GET /api/v1/public/share/:mediaId` devuelve HTML con `og:*` y redirección al visitante. `firebase.json` suma la ruta `/share/**` hacia la API.
- **Aceptación:**
  - el HTML tiene `og:title`, `og:description`, `og:image` (o `og:video`) y `og:url`;
  - un id inexistente o de un feriante sin consentimiento responde 404 con el mismo cuerpo;
  - el texto de la publicación se escapa en el HTML (sin inyección).
- **Pruebas:** unit del renderizado y del escape; prueba manual con el depurador de Facebook (Sharing Debugger) y con la vista previa de WhatsApp.

### MED-06 — Web del feriante: publicaciones

- **Estado:** `TODO`
- **Entrega:** sección "Publicaciones" en el perfil del feriante: subir imagen o video con progreso, texto opcional, lista con miniaturas, editar texto, borrar. Validación en el navegador (tipo, tamaño, duración leyendo el video local) con errores junto al control.
- **Aceptación:**
  - un video de más de 60 s se rechaza antes de subir;
  - el cupo de 10 se muestra y bloquea la subida;
  - el control de archivo usa `::file-selector-button` y tiene `accept` con los tipos.
- **Pruebas:** unit del componente (tipo, tamaño, duración, cupo); e2e con API mockeada.

### MED-07 — Visitante: galería con videos en el modal

- **Estado:** `TODO`
- **Entrega:** la galería del modal de stand muestra imágenes y videos (`<video controls preload="metadata">`, sin autoplay), con el texto de cada publicación y `alt` obligatorio en imágenes.
- **Aceptación:** sin movimiento automático; respeta `prefers-reduced-motion`; el teclado llega a cada publicación.
- **Pruebas:** unit del modal; e2e con un video de prueba.

### MED-08 — Util de compartir

- **Estado:** `TODO`
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

- **Estado:** `TODO`
- **Entrega:** e2e del flujo completo (el feriante sube imagen y video, el visitante abre el modal, comparte con el fallback); axe en la página de publicaciones y en el modal, en los 6 temas.
- **Aceptación:** sin fallas de axe; la galería se navega con teclado; los botones de compartir tienen nombre accesible con la red social.
- **Pruebas:** `themes.e2e.ts` y un spec nuevo `exhibitor-media.e2e.ts`.

### MED-11 — Moderación: el organizador oculta publicaciones

- **Estado:** `TODO`
- **Entrega:** en el panel del evento, lista de publicaciones del evento con "Ocultar" y "Mostrar"; endpoint del organizador que cambia `READY` ↔ `HIDDEN` (auditado en `audit_logs`). El feriante ve la marca "oculta" en su lista.
- **Aceptación:**
  - una publicación oculta desaparece de mapa, galería, compartir y vista previa;
  - el archivo no se borra al ocultar;
  - sólo el organizador del evento puede cambiar el estado (RLS y rol).
- **Pruebas:** unit del cambio de estado; e2e del panel del organizador con API mockeada; axe en la lista.

### MED-12 — Borrado de publicaciones al terminar el evento

- **Estado:** `TODO`
- **Entrega:** job de limpieza (mismo patrón que `ExhibitorPhotosSweeper`, con `SKIP LOCKED`) que, para eventos con `ends_at` vencido, borra las filas y los archivos de sus publicaciones. Las fotos de perfil (`event_id` nulo) no se tocan.
- **Aceptación:**
  - un evento terminado no conserva ninguna publicación ni archivo;
  - el job es idempotente y no borra publicaciones de eventos vigentes;
  - queda registro del borrado en `audit_logs` (cantidad, sin datos personales).
- **Pruebas:** unit del criterio de elegibilidad; int spec del job cuando la conexión desde el host funcione; verificación en Docker.
- **Pendiente legal:** el plazo exacto (al terminar o unos días después) lo confirma el abogado; el job queda parametrizado (`MEDIA_RETENTION_DAYS=0` por defecto).

### MED-10 — Documentación y spec

- **Estado:** `TODO`
- **Entrega:** fila `EXH-05` en `specification.md` (§10.1), endpoints nuevos en §5, sección de publicaciones en el README y la receta de Firebase (`IMPLEMENTACION.md`, ruta `/share/**`).
- **Aceptación:** el change pasa a `VERIFIED` con la evidencia de cada tarea.

## Orden sugerido

1. MED-01 y MED-02 (cimientos, sin UI).
2. MED-03 y MED-04 (API).
3. MED-05 (compartir en el servidor) antes de MED-08, porque el link de la publicación depende de él.
4. MED-06 y MED-07 en paralelo, una vez que la API responde.
5. MED-08 y MED-09, y al final MED-10.
