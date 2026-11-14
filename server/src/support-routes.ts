import type { Express } from 'express';
import { z } from 'zod';
import { authenticate, authorize, type AuthRequest } from './auth.js';
import { prisma } from './prisma.js';

const memberRoles = ['platform_admin', 'institute_admin', 'teacher', 'proctor', 'student'] as const;
const staffRoles = ['platform_admin', 'institute_admin', 'teacher', 'proctor'] as const;
const ticketInput = z.object({
  subject: z.string().trim().min(4).max(160),
  body: z.string().trim().min(2).max(5000),
}).strict();
const messageInput = z.object({ body: z.string().trim().min(2).max(5000) }).strict();
const statusInput = z.object({ status: z.enum(['open', 'in_progress', 'awaiting_requester', 'resolved', 'closed']) }).strict();

export function registerSupportRoutes(app: Express) {
  app.get('/api/organizations/:organizationId/support/tickets', authenticate, authorize(...memberRoles), async (req: AuthRequest, res, next) => { try {
    const organizationId = req.auth!.organizationId!;
    const tickets = await prisma.supportTicket.findMany({
      where: {
        organizationId,
        ...(req.auth!.role === 'student' ? { requesterId: req.auth!.userId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        subject: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        requester: { select: { id: true, name: true, email: true } },
        _count: { select: { messages: true } },
      },
    });
    res.json(tickets);
  } catch (error) { next(error); } });

  app.post('/api/organizations/:organizationId/support/tickets', authenticate, authorize(...memberRoles), async (req: AuthRequest, res, next) => { try {
    const data = ticketInput.parse(req.body);
    const organizationId = req.auth!.organizationId!;
    const ticket = await prisma.supportTicket.create({
      data: {
        organizationId,
        requesterId: req.auth!.userId,
        subject: data.subject,
        messages: { create: { authorId: req.auth!.userId, body: data.body } },
      },
      select: { id: true, subject: true, status: true, createdAt: true, updatedAt: true },
    });
    await prisma.auditLog.create({
      data: { organizationId, actorId: req.auth!.userId, action: 'support.ticket_created', targetType: 'SupportTicket', targetId: ticket.id },
    });
    res.status(201).json(ticket);
  } catch (error) { next(error); } });

  app.get('/api/organizations/:organizationId/support/tickets/:ticketId', authenticate, authorize(...memberRoles), async (req: AuthRequest, res, next) => { try {
    const ticket = await prisma.supportTicket.findFirst({
      where: {
        id: String(req.params.ticketId),
        organizationId: req.auth!.organizationId!,
        ...(req.auth!.role === 'student' ? { requesterId: req.auth!.userId } : {}),
      },
      include: {
        requester: { select: { id: true, name: true, email: true } },
        messages: { orderBy: { createdAt: 'asc' }, include: { author: { select: { id: true, name: true, email: true } } } },
      },
    });
    if (!ticket) return res.status(404).json({ error: 'Support ticket not found' });
    res.json(ticket);
  } catch (error) { next(error); } });

  app.post('/api/organizations/:organizationId/support/tickets/:ticketId/messages', authenticate, authorize(...memberRoles), async (req: AuthRequest, res, next) => { try {
    const { body } = messageInput.parse(req.body);
    const organizationId = req.auth!.organizationId!;
    const isStaff = req.auth!.role !== 'student';
    const ticket = await prisma.supportTicket.findFirst({
      where: {
        id: String(req.params.ticketId),
        organizationId,
        ...(!isStaff ? { requesterId: req.auth!.userId } : {}),
      },
      select: { id: true, status: true },
    });
    if (!ticket) return res.status(404).json({ error: 'Support ticket not found' });
    if (!isStaff && ['resolved', 'closed'].includes(ticket.status)) return res.status(409).json({ error: 'This ticket is resolved. Open a new ticket if you still need help.' });

    const updated = await prisma.$transaction(async tx => {
      const message = await tx.supportMessage.create({
        data: { ticketId: ticket.id, authorId: req.auth!.userId, body },
        include: { author: { select: { id: true, name: true, email: true } } },
      });
      await tx.supportTicket.update({
        where: { id: ticket.id },
        data: { status: isStaff ? 'awaiting_requester' : 'in_progress' },
      });
      return message;
    });
    await prisma.auditLog.create({
      data: { organizationId, actorId: req.auth!.userId, action: 'support.ticket_replied', targetType: 'SupportTicket', targetId: ticket.id },
    });
    res.status(201).json(updated);
  } catch (error) { next(error); } });

  app.patch('/api/organizations/:organizationId/support/tickets/:ticketId/status', authenticate, authorize(...staffRoles), async (req: AuthRequest, res, next) => { try {
    const { status } = statusInput.parse(req.body);
    const organizationId = req.auth!.organizationId!;
    const updated = await prisma.supportTicket.updateMany({
      where: { id: String(req.params.ticketId), organizationId },
      data: { status },
    });
    if (!updated.count) return res.status(404).json({ error: 'Support ticket not found' });
    const ticket = await prisma.supportTicket.findFirstOrThrow({
      where: { id: String(req.params.ticketId), organizationId },
      select: { id: true, status: true, updatedAt: true },
    });
    await prisma.auditLog.create({
      data: { organizationId, actorId: req.auth!.userId, action: 'support.ticket_status_changed', targetType: 'SupportTicket', targetId: ticket.id, metadata: { status } },
    });
    res.json(ticket);
  } catch (error) { next(error); } });
}
