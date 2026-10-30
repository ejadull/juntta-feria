/**
 * Relative, versioned API base. Same origin as the app: the dev proxy (proxy.conf.cjs) or the
 * production reverse proxy routes it, so no environment-specific URL lives in components.
 */
export const API_BASE = '/api/v1';
