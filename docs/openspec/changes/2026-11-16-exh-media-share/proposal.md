# Proposal: Publicaciones del feriante (fotos y videos) y compartir

- **Change ID:** `exh-media-share`
- **Estado:** `PROPOSED`
- **Fecha:** 2026-11-16
- **Pantallas:** Perfil del feriante (publicaciones), modal de stand del visitante (galería y compartir), página pública para compartir
- **Épicas:** EP05 Feriantes, EP08 Portal público
- **Extiende:** `EXH-03` (subida de archivos) y la sección "Fotos del stand" ya construida

## Por qué

Hoy el feriante sube hasta 6 fotos de su perfil. Para vender su producto necesita:

- publicar **fotos y videos** de su producto, cada uno con un texto corto;
- que el visitante pueda **compartir cada publicación** en WhatsApp, Facebook e Instagram, para difundir la feria desde el stand.

## Qué cambia

- **ADDED** capacidad `exhibitor-media`:
  - Publicaciones del feriante de tipo **imagen** o **video**, con texto opcional (máx. 200 caracteres). Hasta **10 publicaciones por feriante y por evento**. Cada publicación pertenece a un evento y se **borra al terminar ese evento**.
  - El organizador puede **ocultar** una publicación desde el panel de su evento y volver a mostrarla.
  - Imágenes: JPG, PNG o WebP, hasta 5 MB (como hoy).
  - Videos: MP4 (H.264 y AAC) o WebM (VP8 o VP9 y Opus o Vorbis), hasta **50 MB** y **60 segundos**. Sólo se aceptan formatos que el navegador reproduce sin convertir. La duración se mide en el navegador antes de subir.
  - En el modal del stand, el visitante ve la galería con videos (controles visibles, sin reproducción automática).
  - **Compartir** cada publicación:
    - en celular, la Web Share API abre el menú nativo con la app elegida (WhatsApp, Facebook e Instagram), con el archivo adjunto;
    - si el navegador no la soporta, o en escritorio: botones para WhatsApp y Facebook (con un link a la publicación) y "Copiar link".
  - Página pública por publicación, con metadatos Open Graph, para que la vista previa de WhatsApp y Facebook muestre la imagen o el video y el texto.
- Las publicaciones siguen la misma regla de privacidad que las fotos: **sólo son públicas si el feriante aceptó el perfil público**; los links de archivo vencen.

## Fuera de alcance

- **Publicar directo en Instagram o Facebook** desde la plataforma. Requiere cuenta profesional, una app de Meta aprobada y permisos de revisión. Instagram no tiene links de compartir para la web: sólo funciona la Web Share API desde el celular.
- **Transcodificación de videos.** Se aceptan MP4 (H.264) y WebM tal como se suben; un formato distinto se rechaza.
- **Conversión de videos** (HEVC u otros formatos que no se reproducen sin convertir): se rechazan.
- **Reportes de contenido por visitantes:** queda para un change aparte.
- Estadísticas de compartidos y de reproducciones.
- Comentarios o "me gusta" de visitantes.

## Impacto

- **Código:** `apps/api` (`exhibitors`, `public`, nuevo endpoint de compartir, storage), `apps/web` (`exhibitor-profile`, `public-catalog/ui/stand-detail-dialog`, util de compartir).
- **Infra:** el bucket necesita CORS para `PUT` de videos (mismo esquema que documentos) y tamaño de carga hasta 50 MB; `firebase.json` suma la ruta de compartir hacia la API.
- **Base de datos:** migración que extiende `exhibitor_photos` (ver `design.md`).
- **Dependencias nuevas:** ninguna.
- **Spec:** nueva fila `EXH-05` en §10.1 y en el índice de endpoints (§5).
