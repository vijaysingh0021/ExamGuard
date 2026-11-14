import bcrypt from 'bcryptjs';
import { connectDatabase } from '../src/db.js';
import { prisma } from '../src/prisma.js';

const email = process.env.SYSTEM_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.SYSTEM_ADMIN_PASSWORD;
const name = process.env.SYSTEM_ADMIN_NAME?.trim() || 'ExamGuard System Administrator';

if (process.env.SYSTEM_ADMIN_BOOTSTRAP !== 'yes' || !email || !password || password.length < 14 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error('Refusing to bootstrap. Set SYSTEM_ADMIN_BOOTSTRAP=yes and provide a valid SYSTEM_ADMIN_EMAIL and a SYSTEM_ADMIN_PASSWORD of at least 14 characters.');
}

const systemAdminEmail = email;
const systemAdminPassword = password;

async function bootstrap() {
await connectDatabase();
const passwordHash = await bcrypt.hash(systemAdminPassword, 12);
await prisma.$transaction(async tx => {
  const [existingUser, existingOrganization, existingPlatformAdmin, existingPlatformAdminFlag] = await Promise.all([
    tx.user.findUnique({ where: { email: systemAdminEmail }, select: { id: true } }),
    tx.organization.findUnique({ where: { slug: 'examguard-system' }, select: { id: true } }),
    tx.membership.findFirst({ where: { role: 'platform_admin' }, select: { userId: true } }),
    tx.user.findFirst({ where: { isPlatformAdmin: true }, select: { id: true } }),
  ]);
  if (existingUser || existingOrganization || existingPlatformAdmin || existingPlatformAdminFlag) {
    throw new Error('System administrator setup has already been initialized or the configured email is already in use. No account was changed.');
  }

  const organization = await tx.organization.create({
    data: { name: 'ExamGuard System Operations', slug: 'examguard-system' },
  });
  const user = await tx.user.create({
    data: { name, email: systemAdminEmail, passwordHash, isPlatformAdmin: true },
  });
  await tx.membership.create({
    data: { userId: user.id, organizationId: organization.id, role: 'platform_admin' },
  });
});
console.info('System administrator was created. Credentials were read from environment variables only; remove the bootstrap flag after setup.');
}

bootstrap().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
