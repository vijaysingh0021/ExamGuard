import { prisma } from './prisma.js';

export async function connectDatabase() {
  await prisma.$connect();
  const [{ current_database }] = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  console.info(`PostgreSQL connected: ${current_database}`);
}
