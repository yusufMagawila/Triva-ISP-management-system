// Phase 3C webhook security attack suite.
// Runs INSIDE the backend container against http://localhost:4000 and the
// isolated test DB. Prints pass/fail only — never prints secrets.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const BASE = 'http://localhost:4000';

const post = (path, body) =>
  fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).then(async (r) => ({ status: r.status, body: (await r.text()).slice(0, 120) }))
    .catch((e) => ({ status: 0, body: String(e).slice(0, 120) }));

const results = [];
const t = (name, pass, detail) => results.push({ name, pass, detail });
const payStatus = async (id) =>
  (await prisma.payment.findUnique({ where: { id }, select: { status: true } }))?.status;

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { webhookSecret: { not: null } },
    select: { id: true, webhookSecret: true },
  });
  if (!tenant) throw new Error('no tenant with webhookSecret');
  const S = tenant.webhookSecret;

  const other = await prisma.tenant.findFirst({ where: { id: { not: tenant.id } } });
  if (other && !other.webhookSecret) {
    await prisma.tenant.update({
      where: { id: other.id },
      data: { webhookSecret: 'other-tenant-secret-' + Date.now() },
    });
  }

  const mk = (provider, tenantId) =>
    prisma.payment.create({
      data: { tenantId: tenantId || tenant.id, amount: 1500, phone: '255700000000', status: 'PENDING', provider },
    });

  const payM = await mk('MONGIKE');
  const payA = await mk('ANYPAY');
  const payZ = await mk('ZENOPAY_MOBILE');
  const payZ2 = await mk('ZENOPAY_MOBILE');
  const payOther = other ? await mk('MONGIKE', other.id) : null;

  let r = await post('/api/payments/webhook/mongike', { order_id: payM.id, status: 'COMPLETED' });
  t('missing token rejected', r.status === 404 || r.status === 401, `http=${r.status}`);

  r = await post('/api/payments/webhook/mongike/WRONGTOKEN', { order_id: payM.id, status: 'COMPLETED' });
  t('invalid token -> 401', r.status === 401, `http=${r.status}`);

  r = await post(`/api/payments/webhook/mongike/${S}`, { order_id: 'nonexistent_xyz', status: 'COMPLETED' });
  t('unknown order -> 401', r.status === 401, `http=${r.status}`);

  r = await post(`/api/payments/webhook/mongike/${S}`, { status: 'COMPLETED' });
  t('missing order_id -> 401', r.status === 401, `http=${r.status}`);

  r = await post(`/api/payments/webhook/mongike/${S}`, { order_id: payM.id, status: 'COMPLETED', reference: 'FAKE' });
  const s5 = await payStatus(payM.id);
  t('forged COMPLETED not trusted (stays PENDING)', r.status === 200 && s5 === 'PENDING', `http=${r.status} db=${s5}`);

  r = await post(`/api/payments/webhook/mongike/${S}`, { order_id: payM.id, status: 'FAILED' });
  const s6 = await payStatus(payM.id);
  t('forged FAILED not trusted (stays PENDING)', r.status === 200 && s6 === 'PENDING', `http=${r.status} db=${s6}`);

  if (payOther) {
    r = await post(`/api/payments/webhook/mongike/${S}`, { order_id: payOther.id, status: 'COMPLETED' });
    const s7 = await payStatus(payOther.id);
    t('cross-tenant order + wrong token -> 401', r.status === 401 && s7 === 'PENDING', `http=${r.status} db=${s7}`);
  }

  const rs = await Promise.all(
    Array.from({ length: 5 }, () =>
      post(`/api/payments/webhook/mongike/${S}`, { order_id: payM.id, status: 'COMPLETED' }))
  );
  const s8 = await payStatus(payM.id);
  t('5x concurrent duplicate deliveries safe', rs.every((x) => x.status === 200) && s8 === 'PENDING',
    `codes=${rs.map((x) => x.status)} db=${s8}`);

  r = await post(`/api/payments/webhook/mongike/${S}`, { order_id: payM.id, status: 'COMPLETED', amount: 1, currency: 'USD' });
  const s9 = await payStatus(payM.id);
  t('spoofed amount/currency ignored', r.status === 200 && s9 === 'PENDING', `http=${r.status} db=${s9}`);

  r = await post(`/api/payments/webhook/anypay/${S}`, { order_id: payA.id, status: 'COMPLETED', transid: 'FAKE' });
  const s10 = await payStatus(payA.id);
  t('anypay forged COMPLETED not trusted', r.status === 200 && s10 === 'PENDING', `http=${r.status} db=${s10}`);

  r = await post(`/api/payments/webhook/zenopaymobile/${S}`, { order_id: payZ.id, payment_status: 'COMPLETED' });
  const s11 = await payStatus(payZ.id);
  t('zenopay valid-token callback processed', r.status === 200, `http=${r.status} db=${s11} (token-only provider)`);

  r = await post('/api/payments/webhook/zenopaymobile/WRONGTOKEN', { order_id: payZ2.id, payment_status: 'COMPLETED' });
  const s12 = await payStatus(payZ2.id);
  t('zenopay invalid token -> 401, stays PENDING', r.status === 401 && s12 === 'PENDING', `http=${r.status} db=${s12}`);

  r = await post(`/api/payments/webhook/mongike/${S}`, { garbage: true });
  t('malformed body -> 401/400', r.status === 401 || r.status === 400, `http=${r.status}`);

  r = await post('/api/auth/activation-webhook/WRONGTOKEN', { order_id: 'act_fake', status: 'SUCCESS' });
  t('activation webhook invalid token -> 401', r.status === 401, `http=${r.status}`);

  r = await post('/api/subscription/webhook/WRONGTOKEN', { order_id: 'sub_fake', status: 'SUCCESS' });
  t('subscription webhook invalid token -> 401', r.status === 401 || r.status === 404, `http=${r.status}`);

  for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.name}  [${x.detail}]`);
  const fails = results.filter((x) => !x.pass);
  console.log(`RESULT: ${results.length - fails.length}/${results.length} passed`);
  await prisma.$disconnect();
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error('ERR', e && e.message ? e.message : e); process.exit(1); });
