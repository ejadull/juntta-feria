// FND-05: dev-server proxy. The app always calls the relative `/api/v1`; only this file knows
// where the API lives. npm runs default to the local API; Compose sets API_PROXY_TARGET.
const DEFAULT_TARGET = 'http://localhost:3000';

function proxyConfig(env) {
  const raw = (env.API_PROXY_TARGET ?? '').trim();
  const target = raw || DEFAULT_TARGET;
  let protocol;
  try {
    protocol = new URL(target).protocol;
  } catch {
    protocol = null;
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    // Name the variable, never echo its value.
    throw new Error('API_PROXY_TARGET must be an http(s) URL');
  }
  // changeOrigin stays false: the API sees the browser origin and applies its CORS allowlist.
  return { '/api': { target, secure: true, changeOrigin: false } };
}

const config = proxyConfig(process.env);
// Non-enumerable so the dev server does not mistake it for a proxied path; used by the test.
Object.defineProperty(config, 'proxyConfig', { value: proxyConfig, enumerable: false });
module.exports = config;
