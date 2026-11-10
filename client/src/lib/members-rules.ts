/** Pure rules for the member-management screen. They mirror the server's protections so the UI can explain them; the server still enforces them. */
export type MemberRole = "institute_admin" | "teacher" | "proctor" | "student" | "platform_admin";
export interface Member { id: string; name: string; email: string; role: MemberRole; active: boolean }

export const ROLE_LABEL: Record<MemberRole, string> = { institute_admin: "Administrator", teacher: "Teacher", proctor: "Reviewer", student: "Candidate", platform_admin: "Platform administrator" };
export const ROLE_DESCRIPTION: Record<MemberRole, string> = {
  institute_admin: "Manages members, roles, exams, candidates and organization settings.",
  teacher: "Creates exams and questions, assigns candidates, grades and publishes results.",
  proctor: "Reviews incidents and evidence. Cannot change exams or results.",
  student: "Takes assigned exams and sees released results.",
  platform_admin: "Operates the ExamGuard platform. Cannot be changed from here.",
};
export const ASSIGNABLE_ROLES: MemberRole[] = ["institute_admin", "teacher", "proctor", "student"];

/** The signed-in member is recognised by email (the client session has no user id). The server independently blocks self-changes. */
export const isSameAccount = (actorEmail: string, member: Pick<Member, "email">) => actorEmail.trim().toLowerCase() === member.email.trim().toLowerCase();

export function memberState(actorEmail: string, member: Member, activeAdminCount: number) {
  const isSelf = isSameAccount(actorEmail, member);
  const isPlatform = member.role === "platform_admin";
  const isLastActiveAdmin = member.role === "institute_admin" && member.active && activeAdminCount <= 1;
  const locked = isSelf ? "You can't change your own access here. Ask another administrator." : isPlatform ? "Platform administrators can't be changed from an organization." : "";
  const lastAdmin = "The organization must keep at least one active administrator. Make someone else an administrator first.";
  return {
    isSelf, isPlatform, isLastActiveAdmin,
    canChangeRole: !locked && !isLastActiveAdmin, roleBlockedReason: locked || (isLastActiveAdmin ? lastAdmin : ""),
    canToggleActive: !locked && !isLastActiveAdmin, activeBlockedReason: locked || (isLastActiveAdmin ? lastAdmin : ""),
    canRemove: !locked && !isLastActiveAdmin, removeBlockedReason: locked || (isLastActiveAdmin ? lastAdmin : ""),
  };
}
export const countActiveAdmins = (members: Member[]) => members.filter((m) => m.role === "institute_admin" && m.active).length;

export type MemberAction = { kind: "role"; role: MemberRole } | { kind: "active"; active: boolean } | { kind: "remove" };
/** Plain-language confirmation text for every sensitive change. */
export function describeAction(member: Member, action: MemberAction): { title: string; body: string; confirm: string; destructive: boolean } {
  const who = member.name || member.email;
  if (action.kind === "remove") return { title: `Remove ${who}?`, body: `${who} will lose all access to this organization. This can't be undone from here; they would need to be added again.`, confirm: "Remove member", destructive: true };
  if (action.kind === "active") return action.active
    ? { title: `Reactivate ${who}?`, body: `${who} will be able to sign in to this organization again with the ${ROLE_LABEL[member.role]} role.`, confirm: "Reactivate", destructive: false }
    : { title: `Deactivate ${who}?`, body: `${who} will no longer be able to use this organization. Their records are kept and you can reactivate them later.`, confirm: "Deactivate", destructive: true };
  const gaining = action.role === "institute_admin", losing = member.role === "institute_admin";
  return {
    title: `Change ${who} to ${ROLE_LABEL[action.role]}?`,
    body: `${who} is currently ${ROLE_LABEL[member.role]}. ${ROLE_LABEL[action.role]}: ${ROLE_DESCRIPTION[action.role]}${gaining ? " This gives them full control of the organization." : ""}${losing ? " They will lose administrator access." : ""}`,
    confirm: "Change role", destructive: gaining || losing,
  };
}

/** Turns an API failure into something actionable; server messages for expected conflicts are passed through. */
export function memberErrorMessage(status: number | undefined, serverMessage?: string): string {
  if (status === 409 && serverMessage) return serverMessage;
  if (status === 403) return "You don't have permission to change this member.";
  if (status === 404) return "This member no longer exists in the organization. The list has been refreshed.";
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 400) return "That change isn't valid.";
  return "The change couldn't be saved. Please try again.";
}

export function filterMembers(members: Member[], text: string, role: string, state: string) {
  const q = text.trim().toLowerCase();
  return members.filter((m) => (!q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)) && (!role || m.role === role) && (!state || (state === "active" ? m.active : !m.active)));
}
