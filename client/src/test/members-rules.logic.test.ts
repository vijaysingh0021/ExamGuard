import { describe, expect, it } from "vitest";
import { countActiveAdmins, describeAction, filterMembers, memberErrorMessage, memberState, type Member } from "../lib/members-rules";

const m = (over: Partial<Member> = {}): Member => ({ id: "u1", name: "Ana Rao", email: "ana@school.test", role: "teacher", active: true, ...over });

describe("member protections mirror the server", () => {
  it("allows ordinary changes to another member", () => {
    const s = memberState("someone.else@school.test", m(), 2);
    expect(s.canChangeRole).toBe(true); expect(s.canToggleActive).toBe(true); expect(s.canRemove).toBe(true); expect(s.roleBlockedReason).toBe("");
  });
  it("blocks every change to yourself, with a reason", () => {
    const s = memberState(" ANA@school.test ", m(), 2);
    expect(s.canChangeRole).toBe(false); expect(s.canToggleActive).toBe(false); expect(s.canRemove).toBe(false); expect(s.roleBlockedReason).toMatch(/your own access/);
  });
  it("blocks changes to platform administrators", () => {
    const s = memberState("other@school.test", m({ role: "platform_admin" }), 2); expect(s.canChangeRole).toBe(false); expect(s.roleBlockedReason).toMatch(/Platform administrators/);
  });
  it("protects the last active administrator from demotion, deactivation and removal", () => {
    const s = memberState("other@school.test", m({ role: "institute_admin" }), 1);
    expect(s.isLastActiveAdmin).toBe(true); expect(s.canChangeRole).toBe(false); expect(s.canToggleActive).toBe(false); expect(s.canRemove).toBe(false); expect(s.removeBlockedReason).toMatch(/at least one active administrator/);
  });
  it("allows changing an administrator when another active administrator exists, or when they are already inactive", () => {
    expect(memberState("other@school.test", m({ role: "institute_admin" }), 2).canChangeRole).toBe(true);
    expect(memberState("other@school.test", m({ role: "institute_admin", active: false }), 1).canChangeRole).toBe(true);
  });
  it("counts only active administrators", () => {
    expect(countActiveAdmins([m({ role: "institute_admin" }), m({ id: "b", role: "institute_admin", active: false }), m({ id: "c" })])).toBe(1);
  });
});

describe("confirmation text for sensitive actions", () => {
  it("warns when granting or removing administrator access", () => {
    const up = describeAction(m(), { kind: "role", role: "institute_admin" }); expect(up.destructive).toBe(true); expect(up.body).toMatch(/full control/);
    const down = describeAction(m({ role: "institute_admin" }), { kind: "role", role: "teacher" }); expect(down.body).toMatch(/lose administrator access/);
    expect(describeAction(m(), { kind: "role", role: "proctor" }).destructive).toBe(false);
  });
  it("explains deactivation is reversible and removal is not", () => {
    expect(describeAction(m(), { kind: "active", active: false }).body).toMatch(/reactivate them later/);
    expect(describeAction(m(), { kind: "remove" }).body).toMatch(/lose all access/); expect(describeAction(m(), { kind: "remove" }).destructive).toBe(true);
    expect(describeAction(m({ active: false }), { kind: "active", active: true }).confirm).toBe("Reactivate");
  });
  it("falls back to the email when a member has no name", () => { expect(describeAction(m({ name: "" }), { kind: "remove" }).title).toBe("Remove ana@school.test?"); });
});

describe("API errors become meaningful messages", () => {
  it("passes through the server's conflict explanation", () => { expect(memberErrorMessage(409, "The organization must retain at least one active institute administrator")).toMatch(/retain at least one/); });
  it("maps other statuses and never leaks unknown detail", () => {
    expect(memberErrorMessage(403)).toMatch(/permission/); expect(memberErrorMessage(404)).toMatch(/no longer exists/); expect(memberErrorMessage(401)).toMatch(/session has expired/);
    expect(memberErrorMessage(500, "SQL exploded")).not.toMatch(/SQL/); expect(memberErrorMessage(undefined)).toMatch(/try again/);
  });
});

describe("filtering", () => {
  const list = [m(), m({ id: "b", name: "Ben", email: "ben@x.test", role: "student", active: false })];
  it("filters by text, role and state", () => {
    expect(filterMembers(list, "ANA", "", "")).toHaveLength(1); expect(filterMembers(list, "x.test", "", "")).toHaveLength(1);
    expect(filterMembers(list, "", "student", "")).toHaveLength(1); expect(filterMembers(list, "", "", "inactive")).toHaveLength(1); expect(filterMembers(list, "", "", "active")).toHaveLength(1); expect(filterMembers(list, "", "", "")).toHaveLength(2);
  });
});
