// FND-05: dev proxy contract. Run: node --test apps/web/proxy.conf.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { proxyConfig } = require('./proxy.conf.cjs');

test('defaults to the local API for npm runs', () => {
  assert.deepEqual(proxyConfig({}), {
    '/api': { target: 'http://localhost:3000', secure: true, changeOrigin: false },
  });
});

test('uses API_PROXY_TARGET (Compose: http://api:3000)', () => {
  assert.equal(
    proxyConfig({ API_PROXY_TARGET: 'http://api:3000' })['/api'].target,
    'http://api:3000',
  );
});

test('treats a blank value as not set', () => {
  assert.equal(proxyConfig({ API_PROXY_TARGET: '  ' })['/api'].target, 'http://localhost:3000');
});

test('rejects a target that is not an http(s) URL, naming only the variable', () => {
  assert.throws(
    () => proxyConfig({ API_PROXY_TARGET: 'api:3000' }),
    /API_PROXY_TARGET must be an http\(s\) URL/,
  );
  assert.throws(
    () => proxyConfig({ API_PROXY_TARGET: 'ftp://x' }),
    (e) => !e.message.includes('ftp://x'),
  );
});
