import { purgeExpired } from '../src/maintenance.js';
import { prisma } from '../src/prisma.js';

purgeExpired()
  .then(result => console.info('Expired rows removed:', result))
  .catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
