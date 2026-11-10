import { describe, expect, it } from "vitest";
import {
  canAccessExamBuilder,
  canDecideIncidents,
  canEditOrganization,
  canExportReports,
  canManageCandidates,
  canManageExams,
  canReviewVerifications,
} from "../lib/permissions";

describe("ExamGuard role capabilities", () => {
  it("limits organization settings to institute administrators", () => {
    expect(canEditOrganization("institute_admin")).toBe(true);
    expect(canEditOrganization("teacher")).toBe(false);
    expect(canEditOrganization("proctor")).toBe(false);
    expect(canEditOrganization("student")).toBe(false);
  });

  it("limits assessment and candidate management to admins and teachers", () => {
    for (const role of ["institute_admin", "teacher"]) {
      expect(canManageCandidates(role)).toBe(true);
      expect(canManageExams(role)).toBe(true);
      expect(canAccessExamBuilder(role)).toBe(true);
    }
    for (const role of ["proctor", "student", "platform_admin"]) {
      expect(canManageCandidates(role)).toBe(false);
      expect(canManageExams(role)).toBe(false);
      expect(canAccessExamBuilder(role)).toBe(false);
    }
  });

  it("limits CSV exports to admins and teachers", () => {
    expect(canExportReports("institute_admin")).toBe(true);
    expect(canExportReports("teacher")).toBe(true);
    expect(canExportReports("proctor")).toBe(false);
    expect(canExportReports("student")).toBe(false);
  });

  it("limits verification and incident decisions to admins and proctors", () => {
    for (const role of ["institute_admin", "proctor"]) {
      expect(canReviewVerifications(role)).toBe(true);
      expect(canDecideIncidents(role)).toBe(true);
    }
    for (const role of ["teacher", "student", "platform_admin"]) {
      expect(canReviewVerifications(role)).toBe(false);
      expect(canDecideIncidents(role)).toBe(false);
    }
  });
});
