/**
 * Phase 5B bootstrap validation — serves a REAL buildRouterBootstrapScript
 * output over local HTTP, has the physical router fetch+import it, and
 * captures the router's own heartbeat requests (pull-discovery evidence).
 */
import http from 'http';
import { RouterOSAPI } from 'node-routeros';
import { buildRouterBootstrapScript } from '../../src/services/router-provisioning.service';

const HOST_IP = '192.168.88.254'; // this machine on the router LAN
const PORT = 8787;
const API_URL = `http://${HOST_IP}:${PORT}`;
const PROV_KEY = 'trk_phase5b_testkey123';

const hits: { ts: number; url: string }[] = [];

const fakeRouter = {
  id: 'test-router-001',
  name: 'Phase5B-Lab',
  ipAddress: '10.251.0.10',
  apiPort: 8728,
  username: 'triva-agent',
  passwordHash: 'LabTestPass-Phase5B',
  passwordEnc: null,
  hotspotName: 'hotspot1',
  provisioningKey: PROV_KEY,
  updatedAt: new Date(),
};

const script = buildRouterBootstrapScript(fakeRouter, API_URL);

const server = http.createServer((req, res) => {
  const url = req.url ?? '/';
  hits.push({ ts: Date.now(), url });
  console.log(`[req] ${url.slice(0, 140)}`);
  if (url.startsWith(`/bootstrap/router/${PROV_KEY}`)) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(script);
  } else if (url.startsWith('/bootstrap/heartbeat/')) {
    res.writeHead(200).end('ok');
  } else if (url.startsWith('/bootstrap/sync/')) {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end(':put "triva sync received"\r\n');
  } else if (url.endsWith('.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html><body>triva portal stub</body></html>');
  } else {
    res.writeHead(404).end('nf');
  }
});

function connect() {
  const api = new RouterOSAPI({ host: '192.168.88.1', port: 8728, user: 'admin', password: process.env.MIKROTIK_PASS ?? '', timeout: 15 });
  api.on('error', () => {});
  return api.connect().then(() => api);
}

async function main() {
  await new Promise<void>((r) => server.listen(PORT, HOST_IP, r));
  console.log(`server on ${API_URL} | script ${script.length} bytes`);

  const api = await connect();
  const t0 = Date.now();

  // Router pulls the bootstrap over the LAN
  await api.write('/tool/fetch', [`=url=${API_URL}/bootstrap/router/${PROV_KEY}`, '=dst-path=triva-bootstrap.rsc', '=keep-result=yes']);
  console.log('fetch bootstrap:', Date.now() - t0, 'ms');

  const files = await api.write('/file/print', ['?name=triva-bootstrap.rsc']);
  console.log('downloaded file:', JSON.stringify(files.map((f: {name:string;size:string}) => ({ name: f.name, size: f.size }))));

  // Import it — this is the real apply step
  const t1 = Date.now();
  await api.write('/import', ['=file-name=triva-bootstrap.rsc']);
  console.log('import:', Date.now() - t1, 'ms');
  await api.close();

  // Read back what the bootstrap actually installed
  const api2 = await connect();
  const users = await api2.write('/user/print', ['?name=triva-agent']);
  console.log('triva-agent user:', JSON.stringify(users.map((u: {name:string;group:string}) => ({ name: u.name, group: u.group }))));
  const wg = await api2.write('/ip/hotspot/walled-garden/print');
  console.log('walled-garden:', wg.length, 'entries');
  const wgip = await api2.write('/ip/hotspot/walled-garden/ip/print');
  console.log('walled-garden-ip:', wgip.length, 'entries');
  const scripts = await api2.write('/system/script/print');
  console.log('scripts:', JSON.stringify(scripts.map((s: {name:string}) => s.name)));
  const sched = await api2.write('/system/scheduler/print');
  console.log('schedulers:', JSON.stringify(sched.map((s: {name:string;interval:string}) => ({ name: s.name, interval: s.interval }))));
  const hfiles = await api2.write('/file/print');
  console.log('files:', JSON.stringify(hfiles.map((f: {name:string}) => f.name)));
  await api2.close();

  // Wait for heartbeat + sync scheduler hits (1m / 15s intervals)
  console.log('\nwaiting 75s for scheduler-driven heartbeat/sync hits...');
  await new Promise((r) => setTimeout(r, 75000));

  const hbHits = hits.filter((h) => h.url.startsWith('/bootstrap/heartbeat/'));
  const syncHits = hits.filter((h) => h.url.startsWith('/bootstrap/sync/'));
  console.log(`\nheartbeat hits: ${hbHits.length}`);
  hbHits.slice(0, 3).forEach((h) => console.log('  hb:', decodeURIComponent(h.url).slice(0, 160)));
  console.log(`sync hits: ${syncHits.length}`);
  syncHits.slice(0, 3).forEach((h) => console.log('  sync:', h.url.slice(0, 120)));

  server.close();
}
main().catch((e) => { console.log('FAIL:', e.errno || e.message || e); server.close(); process.exit(1); });
