import crypto from 'node:crypto';
export const passwordPolicy = (password: string) => password.length >= 10 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);
export const createResetToken = () => crypto.randomBytes(32).toString('base64url');
export const hashResetToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
