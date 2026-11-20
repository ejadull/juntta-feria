import { MAX_PHOTO_BYTES, PHOTO_TYPES } from '../data/exhibitor-photos.repository';

/**
 * Publications (change exh-media-share): the browser checks the same rules as the API, so a file
 * that cannot be published is refused before it is uploaded. The API checks them again on complete.
 */
export const VIDEO_TYPES = ['video/mp4', 'video/webm'] as const;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 60;
export const MAX_CAPTION_LENGTH = 200;
export const MAX_PUBLICATIONS_PER_EVENT = 10;

const MB = 1024 * 1024;

/** Null when the file can be published; otherwise the message to show next to the control. */
export function publicationProblem(
  file: { readonly type: string; readonly size: number },
  durationS: number | null,
): string | null {
  if (file.type.startsWith('video/')) {
    if (!(VIDEO_TYPES as readonly string[]).includes(file.type))
      return 'Este video no se puede reproducir en los navegadores; subí un MP4 H.264 o un WebM.';
    if (file.size > MAX_VIDEO_BYTES) return `Un video pesa como máximo ${MAX_VIDEO_BYTES / MB} MB.`;
    if (durationS === null) return 'No pudimos leer la duración del video. Probá con otro archivo.';
    if (durationS < 1 || durationS > MAX_VIDEO_SECONDS)
      return `Un video dura entre 1 y ${MAX_VIDEO_SECONDS} segundos.`;
    return null;
  }
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type))
    return 'Las imágenes tienen que ser JPG, PNG o WebP.';
  if (file.size === 0 || file.size > MAX_PHOTO_BYTES)
    return `Una imagen pesa como máximo ${MAX_PHOTO_BYTES / MB} MB.`;
  return null;
}

/** Whether the exhibitor may add one more publication to an event. */
export function canPublishInEvent(publicationsInEvent: number): boolean {
  return publicationsInEvent < MAX_PUBLICATIONS_PER_EVENT;
}
