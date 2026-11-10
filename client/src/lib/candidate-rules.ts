/** Pure rules for the candidate dashboard. Times use the device clock for DISPLAY only; the server enforces the real start window and deadline. */
export interface ExamLite { id: string; title: string; status: string; startsAt?: string | null; endsAt?: string | null; durationMinutes?: number; instructions?: string | null; requireVerification?: boolean }
export interface AttemptLite { id: string; status: string; startedAt?: string; submittedAt?: string | null; deadlineAt?: string; receiptCode?: string | null }
export interface GradeLite { id: string; totalMarks: number; maxMarks: number; feedback?: string | null; publishedAt?: string | null }
export interface Assignment { id: string; exam: ExamLite | null; attempt?: AttemptLite | null; grade?: GradeLite | null }

export type Phase = "available" | "in_progress" | "closing" | "upcoming" | "completed" | "missed" | "unavailable";
const FINISHED = ["submitted", "expired", "terminated"];
const OPEN_STATUSES = ["published", "scheduled", "live"];
const ts = (v?: string | null) => (v ? new Date(v).getTime() : undefined);

export function phaseOf(a: Assignment, nowMs: number): Phase {
  if (a.attempt && FINISHED.includes(a.attempt.status)) return "completed";
  const exam = a.exam; if (!exam) return "unavailable";
  const starts = ts(exam.startsAt), ends = ts(exam.endsAt);
  const inProgress = !!a.attempt && ["in_progress", "paused"].includes(a.attempt.status);
  if (inProgress) return ends !== undefined && nowMs >= ends ? "closing" : "in_progress";
  if (!OPEN_STATUSES.includes(exam.status)) return exam.status === "completed" ? "missed" : "unavailable";
  if (ends !== undefined && nowMs >= ends) return "missed";
  if (starts !== undefined && nowMs < starts) return "upcoming";
  return "available";
}

export const PHASE_LABEL: Record<Phase, string> = { available: "Available now", in_progress: "In progress", closing: "Closing", upcoming: "Upcoming", completed: "Completed", missed: "Not taken", unavailable: "Not available" };

export function sections(assignments: Assignment[], nowMs: number) {
  const withPhase = assignments.map((a) => ({ a, phase: phaseOf(a, nowMs) }));
  const by = (...p: Phase[]) => withPhase.filter((x) => p.includes(x.phase));
  const endsAt = (x: { a: Assignment }) => ts(x.a.exam?.endsAt) ?? Number.MAX_SAFE_INTEGER;
  const startsAt = (x: { a: Assignment }) => ts(x.a.exam?.startsAt) ?? 0;
  const recency = (x: { a: Assignment }) => ts(x.a.attempt?.submittedAt) ?? ts(x.a.exam?.endsAt) ?? 0;
  return {
    active: by("in_progress", "available", "closing").sort((x, y) => endsAt(x) - endsAt(y)),
    upcoming: by("upcoming").sort((x, y) => startsAt(x) - startsAt(y)),
    history: by("completed", "missed", "unavailable").sort((x, y) => recency(y) - recency(x)),
  };
}

export function formatStartsIn(ms: number): string {
  if (ms <= 0) return "now";
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return `in ${min} minute${min === 1 ? "" : "s"}`;
  const h = Math.floor(min / 60);
  if (h < 48) return `in ${h} hour${h === 1 ? "" : "s"}${min % 60 ? ` ${min % 60} min` : ""}`;
  const d = Math.floor(h / 24); return `in ${d} days`;
}

export const resultText = (g: Pick<GradeLite, "totalMarks" | "maxMarks">) => `${g.totalMarks} / ${g.maxMarks}${g.maxMarks > 0 ? ` (${Math.round((g.totalMarks / g.maxMarks) * 1000) / 10}%)` : ""}`;

/** What a finished attempt means for the candidate, without implying anything about conduct. */
export function submissionStatusText(a: Assignment): string {
  const s = a.attempt?.status; if (!s) return "";
  if (s === "submitted") return "Submitted by you";
  if (s === "expired") return "Closed automatically at the deadline";
  if (s === "terminated") return "Ended by your examiner";
  return s.replaceAll("_", " ");
}

export type Perm = "granted" | "prompt" | "denied" | "unknown";
export interface ReadinessEnv { secure: boolean; hasMediaDevices: boolean; online: boolean; camera: Perm; microphone: Perm }
export interface ReadinessItem { id: string; label: string; status: "ok" | "warn" | "fail"; hint: string }
/** Reads only what the browser already knows. It never requests camera or microphone access: permissions stay user-controlled. */
export function readinessItems(e: ReadinessEnv): ReadinessItem[] {
  const perm = (id: string, label: string, p: Perm): ReadinessItem => p === "granted" ? { id, label, status: "ok", hint: "Allowed for this site." }
    : p === "denied" ? { id, label, status: "fail", hint: `Blocked. Click the lock icon next to the address bar, set ${label} to Allow for this site, then reload.` }
    : p === "prompt" ? { id, label, status: "warn", hint: "Your browser will ask permission when an exam that needs it begins. Choose Allow." }
    : { id, label, status: "warn", hint: "Your browser doesn't report this. You'll be asked when the exam begins if it is needed." };
  return [
    { id: "online", label: "Internet connection", status: e.online ? "ok" : "fail", hint: e.online ? "Connected." : "You appear to be offline. Reconnect before starting." },
    { id: "secure", label: "Secure browser connection", status: e.secure ? "ok" : "fail", hint: e.secure ? "This page is served securely." : "Camera and microphone only work on secure (https) pages. Contact your organizer." },
    { id: "media", label: "Camera and microphone support", status: e.hasMediaDevices ? "ok" : "fail", hint: e.hasMediaDevices ? "Supported by this browser." : "This browser can't access a camera or microphone. Use a current version of Chrome, Edge, Firefox or Safari." },
    perm("camera", "Camera", e.camera), perm("microphone", "Microphone", e.microphone),
  ];
}
