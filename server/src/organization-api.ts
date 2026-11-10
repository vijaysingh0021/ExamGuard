import { z } from 'zod';

export const organizationApiRoles = {
  candidateRead: ['institute_admin', 'teacher', 'proctor'] as const,
  incidentRead: ['institute_admin', 'teacher', 'proctor'] as const,
  questionManage: ['institute_admin', 'teacher'] as const,
  memberManage: ['institute_admin'] as const,
};

const pageSchema = z.coerce.number().int().min(1).max(10_000).default(1);
const pageSizeSchema = z.coerce.number().int().min(1).max(100).default(50);
const directionSchema = z.enum(['asc', 'desc']).default('asc');

export const candidateListQuerySchema = z.object({
  page: pageSchema,
  pageSize: pageSizeSchema,
  search: z.string().trim().max(120).optional(),
  sortBy: z.enum(['name', 'email', 'createdAt']).default('name'),
  sortOrder: directionSchema,
});

export const incidentListQuerySchema = z.object({
  page: pageSchema,
  pageSize: pageSizeSchema,
  candidateId: z.string().uuid().optional(),
  examId: z.string().uuid().optional(),
  status: z.enum(['open', 'dismissed', 'resolved', 'escalated', 'awaiting_student']).optional(),
  eventType: z.string().trim().min(1).max(80).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
}).superRefine((value, ctx) => {
  if (value.from && value.to && new Date(value.from) > new Date(value.to)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: '`to` must be on or after `from`' });
  }
});

export const questionOrderSchema = z.object({
  questionIds: z.array(z.string().uuid()).min(1).max(500),
}).superRefine(({ questionIds }, ctx) => {
  if (new Set(questionIds).size !== questionIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['questionIds'], message: 'Question IDs must be unique' });
  }
});

export const memberUpdateSchema = z.object({
  role: z.enum(['institute_admin', 'teacher', 'proctor', 'student']).optional(),
  active: z.boolean().optional(),
}).refine(value => value.role !== undefined || value.active !== undefined, {
  message: 'At least one of role or active must be provided',
});

export const paginationOffset = (page: number, pageSize: number) => (page - 1) * pageSize;

export const candidateWhere = (organizationId: string, search?: string) => ({
  organizationId,
  ...(search ? {
    OR: [
      { name: { contains: search, mode: 'insensitive' as const } },
      { email: { contains: search, mode: 'insensitive' as const } },
      { phone: { contains: search, mode: 'insensitive' as const } },
      { externalId: { contains: search, mode: 'insensitive' as const } },
    ],
  } : {}),
});

export const incidentWhere = (organizationId: string, filters: z.infer<typeof incidentListQuerySchema>) => ({
  organizationId,
  ...(filters.candidateId ? { candidateId: filters.candidateId } : {}),
  ...(filters.examId ? { examId: filters.examId } : {}),
  ...(filters.status ? { status: filters.status } : {}),
  ...(filters.from || filters.to ? {
    createdAt: {
      ...(filters.from ? { gte: new Date(filters.from) } : {}),
      ...(filters.to ? { lte: new Date(filters.to) } : {}),
    },
  } : {}),
  ...(filters.eventType ? { events: { some: { event: { type: filters.eventType } } } } : {}),
});

export const paginationHeaders = (page: number, pageSize: number, total: number) => ({
  'X-Page': String(page),
  'X-Page-Size': String(pageSize),
  'X-Total-Count': String(total),
  'X-Total-Pages': String(Math.ceil(total / pageSize)),
});

export const memberCanBeManaged = (actorUserId: string, targetUserId: string, targetRole: string, isPlatformAdmin: boolean) =>
  actorUserId !== targetUserId && targetRole !== 'platform_admin' && !isPlatformAdmin;

export const questionOrderMatches = (existingIds: string[], requestedIds: string[]) =>
  existingIds.length === requestedIds.length && new Set(existingIds).size === existingIds.length && requestedIds.every(id => existingIds.includes(id));

export const wouldRemoveLastActiveAdmin = (currentRole: string, currentActive: boolean, nextRole: string | undefined, nextActive: boolean | undefined, activeAdminCount: number) => {
  const remainsActiveAdmin = (nextRole ?? currentRole) === 'institute_admin' && (nextActive ?? currentActive);
  return currentRole === 'institute_admin' && !remainsActiveAdmin && (currentActive ? activeAdminCount <= 1 : activeAdminCount === 0);
};

export const prismaErrorResponse = (code: string): { status: number; message: string } | undefined => {
  switch (code) {
    case 'P2002': return { status: 409, message: 'Already exists' };
    case 'P2025': return { status: 404, message: 'Not found' };
    case 'P2003': return { status: 400, message: 'Referenced record does not exist' };
    case 'P2034': return { status: 409, message: 'The record changed concurrently. Reload and try again.' };
    default: return undefined;
  }
};
