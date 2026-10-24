import { prisma } from './prisma.js';

// PostgreSQL has no TTL indexes, so expired short-lived rows are removed by this job.
// Run it on a schedule (for example daily): `npx tsx scripts/purge-expired.ts`.
export async function purgeExpired(now = new Date()) {
  const [passwordResetTokens, oauthStates, radioLinks, radioObservations] = await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.oAuthAuthorization.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.radioSignalObservation.deleteMany({ where: { observation: { expiresAt: { lt: now } } } }),
    prisma.radioObservation.deleteMany({ where: { expiresAt: { lt: now } } })
  ]);
  return { passwordResetTokens: passwordResetTokens.count, oauthStates: oauthStates.count, radioSignalLinks: radioLinks.count, radioObservations: radioObservations.count };
}
