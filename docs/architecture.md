# ExamGuard Architecture Documentation

## Overview
ExamGuard is a multi-tenant examination platform designed for universities and enterprises. It consists of a React frontend, a Node.js/Express/PostgreSQL backend, a Python AI service for proctoring, and a Windows Companion app for radio-frequency monitoring.

## System Components

### 1. Frontend (Client)
- **Framework**: React 18, Vite, TypeScript.
- **Styling**: Tailwind CSS.
- **State Management**: TanStack Query (React Query) for server state.
- **Form Handling**: React Hook Form with Zod validation.
- **Icons**: Lucide React.
- **Charts**: Recharts.
- **Portals**:
  - **Student Portal**: Dashboard, exam interface, attempt history, identity verification.
  - **Institute Portal**: Management of exams, question banks, candidates, monitoring, and grading.
  - **Admin Portal**: Platform-level organization and user management.

### 2. Backend (Server)
- **Runtime**: Node.js 22+, TypeScript.
- **Framework**: Express.js.
- **Database**: PostgreSQL 17 (hosted/local).
- **ORM**: Prisma 7.
- **Authentication**:
  - JWT-based sessions.
  - OIDC (Google/Microsoft) with PKCE.
  - `bcryptjs` for password hashing.
- **Real-time**: Socket.IO for live proctoring notifications.
- **File Storage**: Private Supabase Storage accessed with the official Supabase SDK; evidence downloads are proxied through short-lived API tokens.
- **Validation**: Zod.

### 3. AI Service
- **Framework**: FastAPI (Python 3.12+).
- **Computer Vision**: 
  - **Face Detection**: MediaPipe.
  - **Phone Detection**: YOLO (Ultralytics).
  - **Head Pose Estimation**: Approximate orientation from MediaPipe face landmarks.
- **Integration**: The client captures disclosed, sampled frames and sends them to the authenticated backend, which forwards them to the AI service. The browser never calls the AI service directly.

### 4. Windows Companion (Device Monitor)
- **Framework**: .NET 8, C#.
- **Features**:
  - Bluetooth LE scanning (AdvertisementWatcher).
  - Native Wi-Fi scanning (WlanApi).
- **Authentication**: Exam-scoped pairing tokens issued by the backend.
- **Privacy**: Pseudonymized radio identifiers per session.

## Data Model (Core Entities)
- **Organization**: Multi-tenant isolation boundary.
- **User**: Authentication entity.
- **Membership**: Links User to Organization with a Role.
- **Exam**: Assessment configuration, schedule, and rules.
- **ExamTemplate**: Organization-scoped snapshots of draft exam settings, questions, answer keys, and coding test cases for authorized staff to reuse.
- **Question**: Questions linked to exams or banks.
- **QuestionBank**: Organization-scoped reusable question collections.
- **ExamAssignment**: Candidate assignments that drive the student exam calendar and availability view.
- **Candidate**: Organization-specific student profile.
- **ExamAttempt**: A specific instance of a candidate taking an exam.
- **ProctoringEvent**: Automated signals (face missing, phone detected, etc.).
- **Incident**: Human-reviewable proctoring findings.
- **RadioObservation**: Bluetooth/Wi-Fi signal telemetry.

## Security & Privacy
- **Multi-tenancy**: Strictly enforced via `organizationId` filters in Prisma.
- **Authorization**: Role-based access control (RBAC).
- **Privacy**: Prohibited raw MAC address storage; pseudonymization for radio telemetry.
- **Audit Logging**: Every administrative action is recorded.

---
*Last updated: 2026-11-12*
