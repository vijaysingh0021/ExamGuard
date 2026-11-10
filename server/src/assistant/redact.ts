/** Applied to text before it reaches a model provider, to provider output, and to anything logged. */
const PATTERNS: Array<[string, RegExp]> = [
  ['JWT', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
  ['SECRET', /\b(?:bearer\s+|api[_-]?key[=:\s]+|secret[=:\s]+|password[=:\s]+|token[=:\s]+)[A-Za-z0-9._~+/=-]{8,}/gi],
  ['SIGNED_URL', /https?:\/\/\S*(?:X-Amz-Signature|Signature=|sig=)\S*/gi],
  ['EMAIL', /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g],
  ['MAC', /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g],
  ['PHONE', /(?<!\w)\+?\d[\d\s().-]{8,}\d(?!\w)/g],
];
export const redact = (text: string) => PATTERNS.reduce((t, [label, re]) => t.replace(re, `[REDACTED_${label}]`), text);

const OVERRIDE = /(ignore|disregard|forget)\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier)?\s*(instructions|rules|policy|policies|system prompt)|reveal\s+(your\s+)?(system\s+prompt|instructions)|you\s+are\s+now\s+(?:dan|an?\s+unrestricted)|developer\s+mode|jailbreak/i;
/** Heuristic speed bump only; authorization never depends on it. */
export const looksLikeInjection = (text: string) => OVERRIDE.test(text);
