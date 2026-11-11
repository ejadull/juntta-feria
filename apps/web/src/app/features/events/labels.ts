import type { EventStatus } from '../../shared/events/events.repository';

/** Status badge: text plus icon, never color alone (UX-01). */
export const EVENT_STATUS: Record<EventStatus, { label: string; icon: string; tone: string }> = {
  DRAFT: { label: 'Borrador', icon: '…', tone: 'bg-surface-soft' },
  PUBLISHED: { label: 'Publicado', icon: '✓', tone: 'bg-available/15' },
  ACTIVE: { label: 'En curso', icon: '●', tone: 'bg-available/15' },
  CLOSED: { label: 'Cerrado', icon: '■', tone: 'bg-surface-soft' },
  CANCELLED: { label: 'Cancelado', icon: '×', tone: 'bg-danger/10' },
};

/** Event dates are shown in Argentina time (spec section 0). */
const TZ = 'America/Argentina/Buenos_Aires';
const DATE = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeZone: TZ });
const DATE_TIME = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: TZ,
});

export const formatDate = (iso: string): string => DATE.format(new Date(iso));
export const formatDateTime = (iso: string): string => DATE_TIME.format(new Date(iso));
