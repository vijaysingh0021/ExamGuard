/**
 * Frontend visibility helpers mirror the backend's authorize() role matrix.
 * These helpers improve UX only; API authorization remains authoritative.
 */
export type ExamGuardRole =
  | "platform_admin"
  | "institute_admin"
  | "teacher"
  | "proctor"
  | "student";

export const canManageCandidates = (role: string): boolean =>
  role === "institute_admin" || role === "teacher";

export const canManageExams = (role: string): boolean =>
  role === "institute_admin" || role === "teacher";

export const canReviewVerifications = (role: string): boolean =>
  role === "institute_admin" || role === "proctor";

export const canDecideIncidents = (role: string): boolean =>
  role === "institute_admin" || role === "proctor";

export const canEditOrganization = (role: string): boolean =>
  role === "institute_admin";

export const canAccessExamBuilder = (role: string): boolean =>
  canManageExams(role);

export const canExportReports = (role: string): boolean =>
  role === "institute_admin" || role === "teacher";
