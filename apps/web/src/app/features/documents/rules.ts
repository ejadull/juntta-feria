import type { DocumentStatus, DocumentType } from './data/document.repository';

/** Same limits as the API (EXH-03); the API and the storage enforce them again. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES: readonly string[] = ['application/pdf', 'image/jpeg', 'image/png'];
export const ACCEPT_ATTRIBUTE = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';

export const DOCUMENT_TYPES: readonly DocumentType[] = [
  'CONSTANCIA_AFIP',
  'SEGURO',
  'HABILITACION',
  'OTRO',
];

export const DOCUMENT_TYPE_LABEL: Readonly<Record<DocumentType, string>> = {
  CONSTANCIA_AFIP: 'Constancia de AFIP',
  SEGURO: 'Seguro',
  HABILITACION: 'Habilitación',
  OTRO: 'Otro',
};

/** One document's status, always icon plus text (never color alone). */
export const DOCUMENT_STATUS: Readonly<
  Record<DocumentStatus, { label: string; icon: string; tone: string }>
> = {
  APPROVED: { label: 'Aprobado', icon: '✓', tone: 'bg-primary/10 text-primary-strong' },
  PENDING: { label: 'En revisión', icon: '◔', tone: 'bg-reserved/15 text-text' },
  REJECTED: { label: 'Rechazado', icon: '✕', tone: 'bg-danger/10 text-text' },
};

/** Spanish message for a file that cannot be uploaded; null when it can. */
export function fileProblem(file: { name: string; type: string; size: number }): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) return 'Solo se aceptan archivos PDF, JPG o PNG.';
  if (file.size === 0) return 'El archivo está vacío.';
  if (file.size > MAX_DOCUMENT_BYTES)
    return `El archivo pesa ${formatBytes(file.size)} y el máximo es ${formatBytes(MAX_DOCUMENT_BYTES)}.`;
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB`;
}
