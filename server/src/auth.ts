import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { loadConfig } from './config.js';
import { Membership, type Role } from './models.js';

export interface AuthRequest extends Request { auth?: { userId: string; organizationId?: string; role?: Role } }
export const bearerToken = (authorization?: string) => {
  if (!authorization?.startsWith('Bearer ')) return undefined;
  const token = authorization.slice('Bearer '.length).trim();
  return token || undefined;
};
export const jwtSubject = (payload: jwt.JwtPayload) =>
  typeof payload.sub === 'string' && payload.sub.trim().length > 0 ? payload.sub : undefined;
export const signToken = (userId: string) => {
  if (!userId.trim()) throw new Error('A non-empty user ID is required to sign a token');
  return jwt.sign({ sub: userId }, loadConfig().JWT_SECRET, { expiresIn: '8h' });
};
export type CompanionClaims = { userId: string; organizationId: string; examId: string; candidateId: string; attemptId: string; expiresAt?: number };
export const signCompanionToken = (claims: Omit<CompanionClaims, 'userId' | 'expiresAt'> & { userId: string }) => jwt.sign({ sub: claims.userId, organizationId: claims.organizationId, examId: claims.examId, candidateId: claims.candidateId, attemptId: claims.attemptId }, loadConfig().JWT_SECRET, { expiresIn: '10m', audience: 'examguard-device-monitor' });
export function authenticateCompanion(req: AuthRequest, res: Response, next: NextFunction) {
  try { const token = bearerToken(req.headers.authorization); if (!token) throw new Error(); const payload = jwt.verify(token, loadConfig().JWT_SECRET, { audience: 'examguard-device-monitor' }) as jwt.JwtPayload; const userId = jwtSubject(payload); if (!userId || typeof payload.organizationId !== 'string' || typeof payload.examId !== 'string' || typeof payload.candidateId !== 'string' || typeof payload.attemptId !== 'string') throw new Error(); req.auth = { userId }; (req as AuthRequest & { companion?: CompanionClaims }).companion = { userId, organizationId: payload.organizationId, examId: payload.examId, candidateId: payload.candidateId, attemptId: payload.attemptId, expiresAt: payload.exp }; next(); } catch { res.status(401).json({ error: 'Companion pairing token is invalid or expired. Return to the active exam and generate a new pairing token.' }); }
}
export const roleCanAccess = (role: Role, allowed: Role[]) => allowed.includes(role);
export const tenantFilter = (organizationId: string) => ({ organizationId });
export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  try { const token = bearerToken(req.headers.authorization); if (!token) throw new Error(); const payload = jwt.verify(token, loadConfig().JWT_SECRET) as jwt.JwtPayload; const userId = jwtSubject(payload); if (!userId) throw new Error(); req.auth = { userId }; next(); } catch { res.status(401).json({ error: 'Authentication required' }); }
}
export function authorize(...allowed: Role[]) { return async (req: AuthRequest, res: Response, next: NextFunction) => {
  const organizationId = req.params.organizationId || req.body.organizationId || req.query.organizationId;
  if (typeof organizationId !== 'string' || !Types.ObjectId.isValid(organizationId) || !req.auth) return res.status(403).json({ error: 'Organization context required' });
  const membership = await Membership.findOne({ userId: req.auth.userId, organizationId, active: true }).lean();
  if (!membership || !roleCanAccess(membership.role as Role, allowed)) return res.status(403).json({ error: 'Insufficient organization permission' });
  req.auth.organizationId = String(organizationId); req.auth.role = membership.role as Role; next();
}; }
