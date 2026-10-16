import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { loadConfig } from './config.js';
import { Membership, type Role } from './models.js';

export interface AuthRequest extends Request { auth?: { userId: string; organizationId?: string; role?: Role } }
export const signToken = (userId: string) => jwt.sign({ sub: userId }, loadConfig().JWT_SECRET, { expiresIn: '8h' });
export const roleCanAccess = (role: Role, allowed: Role[]) => allowed.includes(role);
export const tenantFilter = (organizationId: string) => ({ organizationId });
export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  try { const token = req.headers.authorization?.replace('Bearer ', ''); if (!token) throw new Error(); const payload = jwt.verify(token, loadConfig().JWT_SECRET) as jwt.JwtPayload; req.auth = { userId: String(payload.sub) }; next(); } catch { res.status(401).json({ error: 'Authentication required' }); }
}
export function authorize(...allowed: Role[]) { return async (req: AuthRequest, res: Response, next: NextFunction) => {
  const organizationId = req.params.organizationId || req.body.organizationId || req.query.organizationId;
  if (!organizationId || !req.auth) return res.status(403).json({ error: 'Organization context required' });
  const membership = await Membership.findOne({ userId: req.auth.userId, organizationId, active: true }).lean();
  if (!membership || !roleCanAccess(membership.role as Role, allowed)) return res.status(403).json({ error: 'Insufficient organization permission' });
  req.auth.organizationId = String(organizationId); req.auth.role = membership.role as Role; next();
}; }
