import { MikroTikService } from '../../src/services/mikrotik.service';
import { RouterOSAPI } from 'node-routeros';

async function main() {
  const svc = new MikroTikService({ host: '192.168.88.1', port: 8728, user: 'admin', password: process.env.MIKROTIK_PASS ?? '' });

  const t0 = Date.now();
  await svc.createOrUpdateProfile('hotspot1', 'triva-5mbps', 5120, 2048);
  console.log('createOrUpdateProfile (new):', Date.now() - t0, 'ms');

  const api = new RouterOSAPI({ host: '192.168.88.1', port: 8728, user: 'admin', password: '', timeout: 10 });
  api.on('error', () => {});
  await api.connect();

  const profs = await api.write('/ip/hotspot/user/profile/print', ['?name=triva-5mbps']);
  console.log('read-back:', JSON.stringify(profs));

  const t1 = Date.now();
  await svc.createOrUpdateProfile('hotspot1', 'triva-5mbps', 10240, 4096);
  console.log('createOrUpdateProfile (update):', Date.now() - t1, 'ms');

  const profs2 = await api.write('/ip/hotspot/user/profile/print', ['?name=triva-5mbps']);
  console.log('read-back after update:', JSON.stringify(profs2));

  // Also check hotspot server state + host list (is mgmt host bypassed?)
  const hs = await api.write('/ip/hotspot/print');
  console.log('hotspot servers:', JSON.stringify(hs));
  const hosts = await api.write('/ip/hotspot/host/print');
  console.log('hotspot hosts:', JSON.stringify(hosts));
  await api.close();
}
main().catch((e) => { console.log('FAIL:', e.message || e); process.exit(1); });
