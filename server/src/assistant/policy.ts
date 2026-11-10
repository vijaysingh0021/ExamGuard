/** Deterministic assistant authorization. Mirrors ai-service/assistant/policy.py; both run server/…/policy_cases.json. */
export type AssistantRole = 'candidate' | 'teacher' | 'reviewer' | 'admin';
export interface Decision { allowed: boolean; intent: string; reason?: string; escalateToHuman?: boolean }

const ACTIVE_EXAM_ALLOWED = new Set(['platform_support', 'device_readiness', 'logistics']);
const RULES: Array<[string, RegExp]> = [
  ['bypass', /\b(bypass|evade|avoid|disable|trick|fool|cheat|get around|hide from)\b.*\b(proctor|monitor|companion|camera|detection|exam|lockdown|fullscreen|tab)/i],
  ['hidden_tests', /\b(hidden|secret|private)\s+(test|case|input)|test\s*cases?\s+(for|of)\s+(this|the)\s+(problem|question)/i],
  ['exam_answer', /\b(answer|solve|solution|write (the )?code|complete (the )?code|which option|correct option|what is the answer)\b.*\b(question|problem|exam|quiz|test|mcq|assessment)|\bsolve (this|the)\b/i],
  ['records_lookup', /\b(result|score|grade|marks|incident|evidence)s?\b.*\b(of|for)\s+\S+/i],
  ['authoring', /\b(draft|generate|create|write)\b.*\b(question|rubric|template|exam)/i],
  ['analytics', /\b(analytics|report|summar(y|ise|ize)|statistics|audit)\b/i],
  ['device_readiness', /\b(camera|microphone|mic|permission|companion|bluetooth|wi-?fi|network|connection|internet|device)\b/i],
  ['platform_support', /\b(login|log in|sign in|password|account|register|registration|examguard|platform|help|support|certificate|receipt|result release|notification|accessib\w*|screen reader|keyboard)\b/i],
  ['logistics', /\b(when|deadline|start|submit|submission|duration|instructions?|autosave|time)\b/i],
];
const ROLE_INTENTS: Record<AssistantRole, Set<string>> = {
  candidate: new Set(['platform_support', 'device_readiness', 'logistics']),
  teacher: new Set(['platform_support', 'device_readiness', 'logistics', 'authoring', 'analytics']),
  reviewer: new Set(['platform_support', 'device_readiness', 'logistics', 'analytics']),
  admin: new Set(['platform_support', 'device_readiness', 'logistics', 'analytics']),
};

export const classifyIntent = (message: string) => RULES.find(([, re]) => re.test(message))?.[0] ?? 'off_topic';

export function decide(role: string, message: string, examActive = false): Decision {
  if (!(role in ROLE_INTENTS)) return { allowed: false, intent: 'unknown', reason: 'Unknown role.' };
  const r = role as AssistantRole;
  let intent = classifyIntent(message);
  if (intent === 'bypass' || intent === 'hidden_tests') return { allowed: false, intent, reason: "I can't help with that. Exam restrictions and hidden tests stay private." };
  if (r === 'candidate' && intent === 'exam_answer') return { allowed: false, intent, reason: "I can't help answer exam questions. I can help with device, connection and exam-logistics issues." };
  if (intent === 'records_lookup') return { allowed: false, intent, reason: "I can't look up individual records in chat. Use the Results or Evidence Center pages, which enforce your permissions." };
  if (intent === 'exam_answer') intent = 'authoring';
  if (r === 'candidate' && examActive && !ACTIVE_EXAM_ALLOWED.has(intent)) return { allowed: false, intent, reason: 'During an active exam I can only help with technical support and exam logistics.' };
  if (intent === 'off_topic') return { allowed: false, intent, reason: 'I can only help with ExamGuard and exam logistics. For anything else, please contact your exam organizer.' };
  if (!ROLE_INTENTS[r].has(intent)) return { allowed: false, intent, reason: 'That request is outside what the assistant can do for your role.' };
  return { allowed: true, intent };
}
