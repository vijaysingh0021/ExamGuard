import http from 'node:http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { app } from './app.js';
import { connectDatabase } from './db.js';
import { configurationErrorMessage, loadConfig, type Config } from './config.js';
import { prisma } from './prisma.js';
import { isUuid } from './ids.js';
import { bearerToken, jwtSubject } from './auth.js';

let config: Config;
try { config = loadConfig(); } catch (error) {
  const names = (error as { issues?: Array<{ path: Array<string | number> }> }).issues?.map(issue => issue.path.join('.')).join(', ');
  console.error(configurationErrorMessage(), names ? `Invalid or missing: ${names}.` : '');
  process.exit(1);
}
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: config.CLIENT_URL } });

io.use((socket, next) => {
  try {
    const token = bearerToken(typeof socket.handshake.auth.token === 'string' ? `Bearer ${socket.handshake.auth.token}` : undefined);
    if (!token) throw new Error();
    const payload = jwt.verify(token, config.JWT_SECRET) as jwt.JwtPayload;
    const userId = jwtSubject(payload);
    if (!userId) throw new Error();
    socket.data.userId = userId;
    next();
  } catch { next(new Error('Authentication required')); }
});

io.on('connection', socket => socket.on('join-exam', async ({ organizationId, examId }: { organizationId: string; examId: string }) => {
  try {
    if (!isUuid(organizationId) || !isUuid(examId)) return socket.emit('subscription_error', { error: 'Invalid monitoring context' });
    const membership = await prisma.membership.findFirst({ where: { userId: socket.data.userId, organizationId, active: true } });
    if (!membership || !['institute_admin', 'teacher', 'proctor'].includes(membership.role)) return socket.emit('subscription_error', { error: 'Not authorized for live monitoring' });
    const exam = await prisma.exam.findFirst({ where: { id: examId, organizationId }, select: { id: true } });
    if (!exam) return socket.emit('subscription_error', { error: 'Assessment not found in this organization' });
    socket.join(`org:${organizationId}:exam:${examId}`);
    socket.emit('subscription_ready', { examId });
  } catch { socket.emit('subscription_error', { error: 'Live monitoring is temporarily unavailable' }); }
}));

app.set('broadcast', (room: string, payload: unknown) => io.to(room).emit('proctoring_incident', payload));

connectDatabase()
  .then(() => server.listen(config.PORT, () => console.info(`ExamGuard API listening on ${config.PORT}`)))
  .catch(error => { console.error('Database connection failed. Check DATABASE_URL and that PostgreSQL is running.', error.message); process.exit(1); });
