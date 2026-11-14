CREATE TYPE "SupportTicketStatus" AS ENUM ('open', 'in_progress', 'awaiting_requester', 'resolved', 'closed');

CREATE TABLE "student_invitations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "student_invitations_tokenHash_key" ON "student_invitations"("tokenHash");
CREATE INDEX "student_invitations_organizationId_email_expiresAt_idx" ON "student_invitations"("organizationId", "email", "expiresAt");
CREATE INDEX "student_invitations_organizationId_acceptedAt_expiresAt_idx" ON "student_invitations"("organizationId", "acceptedAt", "expiresAt");

ALTER TABLE "student_invitations"
ADD CONSTRAINT "student_invitations_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "student_invitations"
ADD CONSTRAINT "student_invitations_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "requesterId" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_tickets_organizationId_status_updatedAt_idx" ON "support_tickets"("organizationId", "status", "updatedAt");
CREATE INDEX "support_tickets_requesterId_updatedAt_idx" ON "support_tickets"("requesterId", "updatedAt");

ALTER TABLE "support_tickets"
ADD CONSTRAINT "support_tickets_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "support_tickets"
ADD CONSTRAINT "support_tickets_requesterId_fkey"
FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "support_messages" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_messages_ticketId_createdAt_idx" ON "support_messages"("ticketId", "createdAt");

ALTER TABLE "support_messages"
ADD CONSTRAINT "support_messages_ticketId_fkey"
FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "support_messages"
ADD CONSTRAINT "support_messages_authorId_fkey"
FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
