import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const compose = fileURLToPath(new URL('../docker-compose.yml', import.meta.url));
const result = spawnSync('docker', ['compose', '-f', compose, '--profile', 'omada', 'config', '--format', 'json'], { encoding: 'utf8' });
if (result.error || result.status !== 0) {
  console.error('Compose validation failed. Install/start Docker and supply the deployment environment. Configuration output is suppressed to protect secrets.');
  process.exit(1);
}
const config = JSON.parse(result.stdout);
const env = config.services.backend.environment;
const missing = ['DB_PASSWORD', 'JWT_SECRET', 'ROUTER_CREDENTIALS_KEY', 'TENANT_KEYS_ENCRYPTION_KEY', 'OMADA_CONTROLLER_URL', 'RADIUS_PUBLIC_HOST'].filter(key => !env[key] || /^(change-me|generate-|base64-or)/.test(env[key]));
if (missing.length) {
  console.error('Missing or placeholder deployment settings:', missing.join(', '));
  process.exit(1);
}
for (const key of ['APP_URL', 'PORTAL_URL', 'OMADA_CONTROLLER_URL']) {
  const url = new URL(env[key]);
  if (url.protocol !== 'https:' || ['5.189.188.138', 'triva.pandabus.live'].includes(url.hostname)) {
    throw new Error(key + ' must point to the new stack over HTTPS, not legacy production');
  }
}
const radiusPorts = config.services.radius.ports;
if (radiusPorts.every(port => port.host_ip === '127.0.0.1')) {
  console.error('RADIUS is still loopback-only. Set RADIUS_BIND_ADDRESS to the intended host/VPN interface and restrict incoming UDP 1812/1813 to approved NAS sources.');
  process.exit(1);
}
console.log('Omada Compose preflight passed. This checks configuration only; it does not deploy, prove RADIUS authentication, or verify AP adoption.');
