import http from 'node:http';
import { Server } from 'socket.io';
import { app } from './app.js';
import { connectDatabase } from './db.js';
import { configurationErrorMessage, loadConfig } from './config.js';
import jwt from 'jsonwebtoken'; import { Types } from 'mongoose'; import { Exam, Membership } from './models.js'; import { bearerToken, jwtSubject } from './auth.js';
let config;
try { config = loadConfig(); } catch { console.error(configurationErrorMessage()); process.exit(1); }
const server = http.createServer(app); const io = new Server(server, { cors: { origin: config.CLIENT_URL } });
io.use((socket, next) => { try { const token = bearerToken(typeof socket.handshake.auth.token === 'string' ? `Bearer ${socket.handshake.auth.token}` : undefined); if (!token) throw new Error(); const payload = jwt.verify(token, config.JWT_SECRET) as jwt.JwtPayload; const userId = jwtSubject(payload); if (!userId) throw new Error(); socket.data.userId = userId; next(); } catch { next(new Error('Authentication required')); } });
io.on('connection', socket => socket.on('join-exam', async ({ organizationId, examId }: { organizationId: string; examId: string }) => { if (!Types.ObjectId.isValid(organizationId) || !Types.ObjectId.isValid(examId)) return socket.emit('subscription_error', { error: 'Invalid monitoring context' }); const membership = await Membership.findOne({ userId: socket.data.userId, organizationId, active: true }).lean(); if (!membership || !['institute_admin', 'teacher', 'proctor'].includes(membership.role)) return socket.emit('subscription_error', { error: 'Not authorized for live monitoring' }); const exam = await Exam.exists({ _id: examId, organizationId }); if (!exam) return socket.emit('subscription_error', { error: 'Assessment not found in this organization' }); socket.join(`org:${organizationId}:exam:${examId}`); socket.emit('subscription_ready', { examId }); }));
app.set('broadcast', (room: string, payload: unknown) => io.to(room).emit('proctoring_incident', payload));
connectDatabase().then(() => server.listen(config.PORT, () => console.info(`ExamGuard API listening on ${config.PORT}`))).catch(() => { console.error('Database connection failed. Verify the database variables, Internet access, and that this IP is allowed in MongoDB Atlas Network Access.'); process.exit(1); });
