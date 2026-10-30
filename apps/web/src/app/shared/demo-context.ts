/**
 * Organization and event shown while there is no auth (CORE-02) nor events (EVT-01).
 * ponytail: constants on purpose; replace with the session/selected event when those exist.
 */
export const DEMO_CONTEXT = {
  organization: { name: 'Asociación Patagonia Emprende', plan: 'Plan Pro' },
  event: {
    id: 'demo-event',
    slug: 'patagonia-emprende-2026',
    name: 'Patagonia Emprende 2026',
    layoutVersionId: 'demo-v1',
  },
} as const;

export const APP_NAME = 'Juntta Feria';
