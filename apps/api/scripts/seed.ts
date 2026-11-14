/**
 * SkyNode Cloud — Development Seed Script
 *
 * Creates a demo user and project for local development.
 * Requires: DATABASE_URL, ENCRYPTION_KEY in environment.
 *
 * Usage: npx ts-node scripts/seed.ts
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const DEMO_USER = {
  email: 'admin@skynode.dev',
  password: 'SkyNode123!',
  name: 'SkyNode Admin',
};

async function seed() {
  const prisma = new PrismaClient();

  try {
    console.log('🌱 Seeding SkyNode Cloud database...\n');

    // 1. Create demo platform user
    const passwordHash = await argon2.hash(DEMO_USER.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    const user = await prisma.platformUser.upsert({
      where: { email: DEMO_USER.email },
      update: {},
      create: {
        email: DEMO_USER.email,
        name: DEMO_USER.name,
        passwordHash,
        emailVerified: true,
        role: 'ADMIN',
      },
    });

    console.log(`  ✓ User: ${user.email} (${user.id})`);
    console.log(`    Password: ${DEMO_USER.password}`);

    // 2. Check if demo project exists
    const existingProject = await prisma.project.findFirst({
      where: { slug: 'demo-project', ownerId: user.id },
    });

    if (existingProject) {
      console.log(`  ✓ Project: ${existingProject.name} (already exists)`);
    } else {
      console.log(`  ⚠ No demo project created — use the dashboard or CLI to provision one.`);
      console.log(`    (Project provisioning requires a running PostgreSQL instance)`);
    }

    console.log('\n✅ Seed complete!\n');
    console.log('  Login at http://localhost:3000/login');
    console.log(`  Email:    ${DEMO_USER.email}`);
    console.log(`  Password: ${DEMO_USER.password}\n`);
  } catch (error: any) {
    console.error('❌ Seed failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

seed();
