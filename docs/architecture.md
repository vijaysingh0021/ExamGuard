# ExamGuard architecture

The React client communicates with the Express API. The API is the tenant security boundary: JWT identity is resolved to an active membership before every organization-scoped query. PostgreSQL (accessed through Prisma) is the only configured datastore. Socket.IO streams authorized exam-room events.
