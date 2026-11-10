export type ChatTurn = { role: "user" | "assistant"; content: string };
export type AssistantMode = "knowledge" | "model" | "refused" | "no_answer" | "rate_limited";
export interface AssistantReply { mode: AssistantMode; answer: string; sources: Array<{ id: string; title: string }>; intent: string; escalateToHuman: boolean; aiGenerated: boolean; disclaimer: string }

export const MAX_MESSAGE_CHARS = 2000;
export const MAX_HISTORY_TURNS = 12;

/** The server re-validates everything; this only keeps requests small and well-formed. */
export const trimHistory = (turns: ChatTurn[]): ChatTurn[] =>
  turns.slice(-MAX_HISTORY_TURNS).map((t) => ({ role: t.role, content: t.content.slice(0, MAX_MESSAGE_CHARS) }));

export const canSend = (text: string, busy: boolean) => !busy && text.trim().length > 0 && text.length <= MAX_MESSAGE_CHARS;

export const suggestionsFor = (role: string): string[] => {
  if (role === "student") return ["My camera permission is blocked", "How does autosave work?", "How do I pair the Windows Companion?"];
  if (role === "institute_admin") return ["Summarize our exam analytics", "How do automation and retention work?", "How do I reset my password?"];
  return ["Summarize our exam analytics", "Draft a rubric for an essay question", "How do I review an incident?"];
};

/** Human-readable text for failed requests; never echoes server internals. */
export const errorText = (status?: number) =>
  status === 429 ? "You're sending messages too quickly. Please wait a moment and try again."
  : status === 401 ? "Your session has expired. Please sign in again."
  : status === 403 ? "The assistant isn't available for your account in this organization."
  : "The assistant is temporarily unavailable. The help center articles still work once it reconnects.";

export const modeLabel = (mode: "ai_assisted" | "help_center") => (mode === "ai_assisted" ? "AI-assisted" : "Help center");
