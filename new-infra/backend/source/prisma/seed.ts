import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create Super Admin user
  const adminPassword = await bcrypt.hash('SuperAdmin@123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@triva.io' },
    update: {},
    create: {
      email: 'admin@triva.io',
      passwordHash: adminPassword,
      name: 'Super Admin',
      role: 'SUPER_ADMIN',
    },
  });

  console.log(`✅ Super Admin created: ${admin.email}`);

  // Create a demo tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo-shop' },
    update: {},
    create: {
      name: 'Demo Shop',
      slug: 'demo-shop',
      email: 'demo@shop.com',
      phone: '+254700000000',
      address: 'Nairobi, Kenya',
      status: 'ACTIVE',
      subscription: {
        create: {
          plan: 'STANDARD',
          status: 'ACTIVE',
          startsAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days (pre-activated demo)
        },
      },
    },
  });

  console.log(`✅ Demo tenant created: ${tenant.name}`);

  // Create merchant user for demo tenant
  const merchantPassword = await bcrypt.hash('Merchant@123', 12);
  const merchant = await prisma.user.upsert({
    where: { email: 'merchant@demo-shop.com' },
    update: {},
    create: {
      email: 'merchant@demo-shop.com',
      passwordHash: merchantPassword,
      name: 'Demo Merchant',
      role: 'MERCHANT',
      tenantId: tenant.id,
    },
  });

  console.log(`✅ Merchant user created: ${merchant.email}`);

  // Create sample internet plans for demo tenant
  const plans = await Promise.all([
    prisma.plan.upsert({
      where: { id: 'plan-1hr-demo' },
      update: {},
      create: {
        id: 'plan-1hr-demo',
        tenantId: tenant.id,
        name: '1 Hour',
        description: 'High speed internet for 1 hour',
        price: 30,
        durationMins: 60,
        downloadKbps: 5120,
        uploadKbps: 2048,
        status: 'ACTIVE',
      },
    }),
    prisma.plan.upsert({
      where: { id: 'plan-3hr-demo' },
      update: {},
      create: {
        id: 'plan-3hr-demo',
        tenantId: tenant.id,
        name: '3 Hours',
        description: 'High speed internet for 3 hours',
        price: 70,
        durationMins: 180,
        downloadKbps: 5120,
        uploadKbps: 2048,
        status: 'ACTIVE',
      },
    }),
    prisma.plan.upsert({
      where: { id: 'plan-day-demo' },
      update: {},
      create: {
        id: 'plan-day-demo',
        tenantId: tenant.id,
        name: '24 Hours',
        description: 'Full day unlimited internet',
        price: 150,
        durationMins: 1440,
        downloadKbps: 10240,
        uploadKbps: 5120,
        status: 'ACTIVE',
      },
    }),
  ]);

  console.log(`✅ Created ${plans.length} sample plans`);
  console.log('🎉 Seeding complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
