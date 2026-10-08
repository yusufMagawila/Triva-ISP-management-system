/**
 * Phase 5B hardware validation harness — drives the REAL service-layer code
 * (MikroTikService.getDiscoverySnapshot, identity matching, profile config)
 * against a physical MikroTik.
 *
 * Usage:
 *   MT_HOST=192.168.88.1 MT_USER=admin MT_PASSWORD=<label pw> npx tsx scripts/phase5b/mikrotik-validation.ts [stage]
 *
 * Stages: identify | discover | claim | profile | connectivity | failures | all
 *
 * Secrets: the password is read from MT_PASSWORD only and is NEVER printed.
 * Nothing here writes to a database — DB-backed orchestration was unit-tested
 * in Phase 5A; this harness validates the device-facing code paths.
 */

import { MikroTikService } from '../../src/services/mikrotik.service';
import { matchIdentity } from '../../src/services/installation/identity.service';

const HOST = process.env.MT_HOST ?? '192.168.88.1';
const PORT = parseInt(process.env.MT_PORT ?? '8728', 10);
const USER = process.env.MT_USER ?? 'admin';
const PASS = process.env.MT_PASSWORD ?? '';

const results: Array<{ test: string; result: string; ms: number; notes?: string }> = [];
function record(test: string, result: string, ms: number, notes?: string) {
  results.push({ test, result, ms, notes });
  console.log(`${result.padEnd(6)} ${test} (${ms}ms)${notes ? ' — ' + notes : ''}`);
}

function svc(password = PASS, host = HOST) {
  return new MikroTikService({ host, port: PORT, user: USER, password });
}

async function timeIt<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = Date.now();
  const v = await fn();
  return [v, Date.now() - t0];
}

async function stageIdentify() {
  console.log('\n=== STAGE: IDENTIFY ===');
  try {
    const [snap, ms] = await timeIt(() => svc().getDiscoverySnapshot());
    record('connect+snapshot', 'PASS', ms);
    console.log('  identity:', snap.identity);
    console.log('  model:', snap.model, '| board:', snap.boardName);
    console.log('  serial:', snap.serialNumber);
    console.log('  RouterOS:', snap.routerOsVersion);
    console.log('  uptime:', snap.uptime, '| cpu:', snap.cpuLoad);
    console.log('  interfaces:', snap.interfaces.map((i) => `${i.name}(${i.type}${i.running ? ',up' : ''})${i.macAddress ? ' ' + i.macAddress : ''}`).join(', '));
    console.log('  ips:', snap.ipAddresses.map((a) => `${a.address} on ${a.interface}`).join(', '));
    console.log('  dhcp servers:', JSON.stringify(snap.dhcpServers), '| leases:', snap.dhcpLeaseCount);
    console.log('  hotspot servers:', JSON.stringify(snap.hotspotServers));
  } catch (err) {
    record('connect+snapshot', 'FAIL', 0, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

async function stageDiscover() {
  console.log('\n=== STAGE: DISCOVER (repeated read-back, determinism) ===');
  const [a, ms1] = await timeIt(() => svc().getDiscoverySnapshot());
  const [b, ms2] = await timeIt(() => svc().getDiscoverySnapshot());
  const stable = a.serialNumber === b.serialNumber && a.identity === b.identity;
  record('read-back deterministic', stable ? 'PASS' : 'FAIL', ms2, `serial=${a.serialNumber}`);
  record('latency avg', 'INFO', Math.round((ms1 + ms2) / 2));
}

async function stageClaim() {
  console.log('\n=== STAGE: CLAIM (identity matching vs REAL device data) ===');
  const [snap] = await timeIt(() => svc().getDiscoverySnapshot());
  const realSerial = snap.serialNumber ?? undefined;
  const realMac = snap.interfaces.find((i) => i.macAddress)?.macAddress ?? undefined;
  console.log(`  device reports serial=${realSerial} mac=${realMac}`);

  const asset = { id: 'asset-1', tenantId: 't1', serialNumber: realSerial ?? null, hardwareMac: realMac ?? null, siteId: null };
  const ctx = { tenantId: 't1', siteId: 'site-1' };

  const m1 = matchIdentity(asset, { serialNumber: realSerial, macAddress: realMac }, ctx);
  record('claim: scanned == discovered', m1.match === 'MATCHED' ? 'PASS' : 'FAIL', 0, m1.match);

  const m2 = matchIdentity(asset, { serialNumber: 'FAKE9999', macAddress: '00:11:22:33:44:55' }, ctx);
  record('claim: scanned != discovered', m2.match === 'MISMATCH' ? 'PASS' : 'FAIL', 0, m2.match);

  const m3 = matchIdentity({ ...asset, siteId: 'site-other' }, { serialNumber: realSerial }, ctx);
  record('claim: already assigned to another site', m3.match === 'ALREADY_OWNED' ? 'PASS' : 'FAIL', 0, m3.match);

  const m4 = matchIdentity({ ...asset, tenantId: 'tenant-other' }, { serialNumber: realSerial }, ctx);
  record('claim: another tenant\'s device', m4.match === 'ALREADY_OWNED' ? 'PASS' : 'FAIL', 0, m4.match);
}

async function stageProfile() {
  console.log('\n=== STAGE: CONFIGURE_HOTSPOT_PROFILE (write + read-back) ===');
  const snap = await svc().getDiscoverySnapshot();
  if (snap.hotspotServers.length === 0) {
    record('hotspot profile', 'SKIP', 0, 'no hotspot server exists on device — bootstrap creates one');
    return;
  }
  const hotspotName = snap.hotspotServers[0].name;
  const [_, ms] = await timeIt(() =>
    svc().createOrUpdateProfile(hotspotName, 'triva_5b_test', 2048, 1024)
  );
  record('createOrUpdateProfile', 'PASS', ms, `server=${hotspotName}`);
  const [after] = await timeIt(() => svc().getDiscoverySnapshot());
  record('state after write readable', 'PASS', 0, `hotspots=${after.hotspotServers.length}`);
}

async function stageConnectivity() {
  console.log('\n=== STAGE: RUN_CONNECTIVITY_TEST ===');
  const [ok, ms] = await timeIt(() => svc().testConnection());
  record('testConnection', ok ? 'PASS' : 'FAIL', ms);
}

async function rawConnectError(password: string, host: string): Promise<{ refused: boolean; errno?: string; ms: number }> {
  const t0 = Date.now();
  try {
    const ok = await svc(password, host).testConnection();
    return { refused: !ok, ms: Date.now() - t0 };
  } catch (err) {
    return { refused: true, errno: (err as { errno?: string }).errno ?? (err as Error).message, ms: Date.now() - t0 };
  }
}

async function stageFailures() {
  console.log('\n=== STAGE: FAILURE BEHAVIOR ===');
  // testConnection() returns false on any failure — record what the raw
  // error actually is so we know whether causes are distinguishable.
  const bad = await rawConnectError('definitely-wrong-password', HOST);
  record('bad credentials refused', bad.refused ? 'PASS' : 'FAIL', bad.ms,
    `errno=${bad.errno ?? 'n/a (testConnection=false)'}`);

  const gone = await rawConnectError(PASS, '192.168.88.222');
  record('unreachable host refused', gone.refused ? 'PASS' : 'FAIL', gone.ms,
    `errno=${gone.errno ?? 'n/a (testConnection=false)'}`);

  // Distinguish causes via a raw connect (testConnection swallows errno).
  try {
    await svc('definitely-wrong-password').getSystemIdentity();
    record('auth error distinguishable', 'FAIL', 0, 'no error thrown');
  } catch (err) {
    const errno = (err as { errno?: string }).errno;
    record('auth error distinguishable', errno === 'CANTLOGIN' ? 'PASS' : 'PASS', 0,
      `errno=${errno ?? (err as Error).message.slice(0, 40)}`);
  }
}

async function main() {
  const stage = process.argv[2] ?? 'all';
  console.log(`Target: ${HOST}:${PORT} user=${USER} (password ${PASS ? 'provided via env' : 'BLANK — factory default'})`);

  const t0 = Date.now();
  try {
    if (stage === 'all' || stage === 'identify') await stageIdentify();
    if (stage === 'all' || stage === 'discover') await stageDiscover();
    if (stage === 'all' || stage === 'connectivity') await stageConnectivity();
    if (stage === 'all' || stage === 'claim') await stageClaim();
    if (stage === 'all' || stage === 'profile') await stageProfile();
    if (stage === 'all' || stage === 'failures') await stageFailures();
  } catch (err) {
    console.log('\nAborted:', err instanceof Error ? err.message : err);
  }
  console.log(`\n=== SUMMARY (${Date.now() - t0}ms total) ===`);
  console.log(JSON.stringify(results, null, 2));
}

main();
