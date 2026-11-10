import type { Express } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, type AuthRequest } from './auth.js';
import { loadConfig } from './config.js';
import { verifyUnsubscribe } from './email-outbox.js';
import { prisma } from './prisma.js';

const prefsBody = z.object({ examEmails: z.boolean().optional(), adminEmails: z.boolean().optional() }).strict();

export function registerEmailRoutes(app: Express) {
  app.get('/api/email/preferences', authenticate, async (req: AuthRequest, res, next) => { try {
    const p = await prisma.emailPreference.findUnique({ where: { userId: req.auth!.userId } });
    res.json({ examEmails: p?.examEmails ?? true, adminEmails: p?.adminEmails ?? true, note: 'Security emails such as password reset cannot be turned off.' });
  } catch (error) { next(error); } });

  app.put('/api/email/preferences', authenticate, async (req: AuthRequest, res, next) => { try {
    const data = prefsBody.parse(req.body); const userId = req.auth!.userId;
    const p = await prisma.emailPreference.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    res.json({ examEmails: p.examEmails, adminEmails: p.adminEmails });
  } catch (error) { next(error); } });

  // One-click unsubscribe from an emailed link. The HMAC-signed token identifies the user and category; no login needed.
  app.get('/api/email/unsubscribe', rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }), async (req, res, next) => { try {
    const parsed = typeof req.query.token === 'string' ? verifyUnsubscribe(req.query.token, loadConfig().JWT_SECRET) : null;
    if (!parsed) return res.status(400).type('html').send('<!doctype html><title>ExamGuard</title><p>This unsubscribe link is invalid.</p>');
    const field = parsed.category === 'exam' ? 'examEmails' : 'adminEmails';
    await prisma.emailPreference.upsert({ where: { userId: parsed.userId }, create: { userId: parsed.userId, [field]: false }, update: { [field]: false } });
    res.type('html').send(`<!doctype html><title>ExamGuard</title><p>You will no longer receive ${parsed.category === 'exam' ? 'exam' : 'administrative'} emails from ExamGuard. You can change this in the notification menu after signing in.</p>`);
  } catch (error) { next(error); } });
}
