import crypto from 'node:crypto';
import type { Express } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { authenticate, authorize, signToken, type AuthRequest } from './auth.js';
import { loadConfig } from './config.js';
import { emailProviderFromEnv } from './email.js';
import { prisma } from './prisma.js';
import { Prisma } from './generated/prisma/client.js';
import { passwordPolicy } from './password-reset.js';

const rowSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
});
const rowsSchema = z.object({ students: z.array(rowSchema).min(1).max(100) }).strict();
const tokenSchema = z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/);
const inviteBodySchema = z.object({ token: tokenSchema, password: z.string().min(10).max(128) }).strict();
const tokenHash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const inviteRateLimit = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

type PreviewStatus = 'ready' | 'duplicate_in_file' | 'candidate_exists' | 'account_exists' | 'invitation_pending';
type PreviewRow = { index: number; name: string; email: string; status: PreviewStatus; reason?: string };

async function previewRows(organizationId: string, rows: z.infer<typeof rowSchema>[]): Promise<PreviewRow[]> {
  const emails = [...new Set(rows.map(row => row.email))];
  const now = new Date();
  const [candidates, users, pending] = await Promise.all([
    prisma.candidate.findMany({ where: { organizationId, email: { in: emails } }, select: { email: true } }),
    prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true } }),
    prisma.studentInvitation.findMany({
      where: { organizationId, email: { in: emails }, acceptedAt: null, expiresAt: { gt: now } },
      select: { email: true },
    }),
  ]);
  const candidateEmails = new Set(candidates.map(candidate => candidate.email.toLowerCase()));
  const accountEmails = new Set(users.map(user => user.email.toLowerCase()));
  const pendingEmails = new Set(pending.map(invitation => invitation.email.toLowerCase()));
  const seen = new Set<string>();

  return rows.map((row, index) => {
    let status: PreviewStatus = 'ready';
    if (seen.has(row.email)) status = 'duplicate_in_file';
    else if (candidateEmails.has(row.email)) status = 'candidate_exists';
    else if (accountEmails.has(row.email)) status = 'account_exists';
    else if (pendingEmails.has(row.email)) status = 'invitation_pending';
    seen.add(row.email);
    const reason = status === 'duplicate_in_file' ? 'Email appears more than once in this CSV'
      : status === 'candidate_exists' ? 'Student already exists in this institution'
      : status === 'account_exists' ? 'Email already belongs to an ExamGuard account'
      : status === 'invitation_pending' ? 'An active invitation already exists'
      : undefined;
    return { index: index + 1, name: row.name, email: row.email, status, ...(reason ? { reason } : {}) };
  });
}

export function registerStudentInvitationRoutes(app: Express) {
  app.post('/api/organizations/:organizationId/students/import/preview', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
    const { students } = rowsSchema.parse(req.body);
    res.json({ rows: await previewRows(req.auth!.organizationId!, students) });
  } catch (error) { next(error); } });

  app.get('/api/organizations/:organizationId/student-invitations', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
    const invitations = await prisma.studentInvitation.findMany({
      where: { organizationId: req.auth!.organizationId!, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, name: true, email: true, expiresAt: true, createdAt: true },
    });
    res.json(invitations);
  } catch (error) { next(error); } });

  app.post('/api/organizations/:organizationId/students/import', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
    const { students } = rowsSchema.parse(req.body);
    const organizationId = req.auth!.organizationId!;
    const preview = await previewRows(organizationId, students);
    const ready = preview.filter(row => row.status === 'ready');
    const provider = emailProviderFromEnv();
    if (ready.length && !provider) return res.status(503).json({ error: 'Student invitations require configured email delivery. No invitations were created.' });

    const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
    if (!organization) return res.status(404).json({ error: 'Organization not found' });
    const appUrl = new URL('/student/invitation', loadConfig().APP_BASE_URL).toString();
    const results: Array<{ email: string; status: 'invited' | 'skipped' | 'failed'; reason?: string }> = [];
    for (const row of preview) {
      if (row.status !== 'ready') {
        results.push({ email: row.email, status: 'skipped', reason: row.reason });
        continue;
      }

      const currentPreview = await previewRows(organizationId, [{ name: row.name, email: row.email }]);
      if (currentPreview[0].status !== 'ready') {
        results.push({ email: row.email, status: 'skipped', reason: currentPreview[0].reason ?? 'This student can no longer be invited.' });
        continue;
      }

      const token = crypto.randomBytes(32).toString('base64url');
      const invitation = await prisma.studentInvitation.create({
        data: {
          organizationId,
          createdById: req.auth!.userId,
          email: row.email,
          name: row.name,
          tokenHash: tokenHash(token),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
        },
        select: { id: true },
      });
      try {
        await provider!.send({
          to: row.email,
          subject: `Invitation to ${organization.name} on ExamGuard`,
          text: `${row.name},\n\n${organization.name} invited you to join ExamGuard as a student. This invitation expires in 7 days.\n\nCreate your account using this one-time link:\n${appUrl}?token=${encodeURIComponent(token)}\n\nIf you were not expecting this invitation, you can ignore this message.`,
          idempotencyKey: `student-invitation:${invitation.id}`,
        });
        results.push({ email: row.email, status: 'invited' });
      } catch {
        await prisma.studentInvitation.deleteMany({ where: { id: invitation.id, acceptedAt: null } });
        results.push({ email: row.email, status: 'failed', reason: 'Invitation email could not be delivered; no active invitation was retained.' });
      }
    }

    const invited = results.filter(result => result.status === 'invited').length;
    await prisma.auditLog.create({
      data: {
        organizationId,
        actorId: req.auth!.userId,
        action: 'student.invitations_imported',
        targetType: 'StudentInvitation',
        targetId: organizationId,
        metadata: { invited, skipped: results.filter(result => result.status === 'skipped').length, failed: results.filter(result => result.status === 'failed').length },
      },
    });
    res.status(200).json({ invited, results });
  } catch (error) { next(error); } });

  app.get('/api/public/student-invitations/:token', inviteRateLimit, async (req, res, next) => { try {
    const token = tokenSchema.parse(req.params.token);
    const invitation = await prisma.studentInvitation.findUnique({
      where: { tokenHash: tokenHash(token) },
      select: { name: true, email: true, expiresAt: true, acceptedAt: true, organization: { select: { name: true } } },
    });
    if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) return res.status(404).json({ error: 'Invitation not found or expired' });
    res.json({ name: invitation.name, email: invitation.email, organizationName: invitation.organization.name, expiresAt: invitation.expiresAt });
  } catch (error) { next(error); } });

  app.post('/api/auth/student-invitations/accept', inviteRateLimit, async (req, res, next) => { try {
    const { token, password } = inviteBodySchema.parse(req.body);
    if (!passwordPolicy(password)) return res.status(400).json({ error: 'Password must contain upper and lower case letters, a number, and be at least 10 characters.' });
    const invitation = await prisma.studentInvitation.findUnique({ where: { tokenHash: tokenHash(token) } });
    if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) return res.status(404).json({ error: 'Invitation not found or expired' });
    const passwordHash = await bcrypt.hash(password, 12);

    let account: { user: { id: string; name: string; email: string; updatedAt: Date }; organization: { id: string; name: string } };
    try {
      account = await prisma.$transaction(async tx => {
        const claimed = await tx.studentInvitation.updateMany({
          where: { id: invitation.id, acceptedAt: null, expiresAt: { gt: new Date() } },
          data: { acceptedAt: new Date() },
        });
        if (claimed.count !== 1) throw new Error('INVITATION_ALREADY_USED');
        const existingUser = await tx.user.findUnique({ where: { email: invitation.email }, select: { id: true } });
        if (existingUser) throw new Error('INVITATION_ACCOUNT_EXISTS');
        const user = await tx.user.create({
          data: {
            name: invitation.name,
            email: invitation.email,
            passwordHash,
            memberships: { create: { organizationId: invitation.organizationId, role: 'student', active: true } },
            candidates: { create: { organizationId: invitation.organizationId, name: invitation.name, email: invitation.email } },
          },
          select: { id: true, name: true, email: true, updatedAt: true },
        });
        const organization = await tx.organization.findUniqueOrThrow({ where: { id: invitation.organizationId }, select: { id: true, name: true } });
        await tx.auditLog.create({
          data: {
            organizationId: invitation.organizationId,
            actorId: user.id,
            action: 'student.invitation_accepted',
            targetType: 'StudentInvitation',
            targetId: invitation.id,
          },
        });
        return { user, organization };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Error && error.message === 'INVITATION_ACCOUNT_EXISTS') return res.status(409).json({ error: 'This email already has an ExamGuard account. Sign in to that account and contact your institution administrator.' });
      if (error instanceof Error && error.message === 'INVITATION_ALREADY_USED') return res.status(409).json({ error: 'This invitation has already been used or expired.' });
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ error: 'An account or student record already exists for this invitation.' });
      throw error;
    }
    res.status(201).json({
      token: signToken(account.user.id, account.user.updatedAt.getTime()),
      user: { id: account.user.id, name: account.user.name, email: account.user.email },
      organization: account.organization,
      role: 'student',
    });
  } catch (error) { next(error); } });

  app.post('/api/organizations/:organizationId/student-invitations/:invitationId/revoke', authenticate, authorize('institute_admin', 'teacher'), async (req: AuthRequest, res, next) => { try {
    const revoked = await prisma.studentInvitation.deleteMany({
      where: { id: String(req.params.invitationId), organizationId: req.auth!.organizationId!, acceptedAt: null },
    });
    if (!revoked.count) return res.status(404).json({ error: 'Pending invitation not found' });
    await prisma.auditLog.create({
      data: {
        organizationId: req.auth!.organizationId!,
        actorId: req.auth!.userId,
        action: 'student.invitation_revoked',
        targetType: 'StudentInvitation',
        targetId: String(req.params.invitationId),
      },
    });
    res.status(204).end();
  } catch (error) { next(error); } });
}
