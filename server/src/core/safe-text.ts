/** A closure over secret values, never the environment/configuration object itself. */
export type SafeText = (text: string, maxLength?: number) => string;

export const REDACTED = "[REDACTED]";
export const OMITTED_TEXT = "[OMITTED: text exceeds the safe input limit]";
export const OMITTED_CREDENTIAL_TEXT = "[OMITTED: credential content cannot be safely separated]";
export const TRUNCATED_TEXT = "[TRUNCATED]";
const MAX_INPUT = 256_000;
const MAX_OUTPUT = 32_000;

const CREDENTIALS: RegExp[] = [
  // An unterminated private key is unsafe through the end of the excerpt.
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|$)/g,
  /\b(?:Authorization|Proxy-Authorization)\s*[:=][^\n]*/gi,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/gi,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+(?::[^\s/@]*)?@/gi,
  // Provider tokens and signed JWTs, even without a key/value label.
  /\b(?:sk-(?:ant-|proj-|svcacct-)?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{30,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,
];
// Detect labels separately, avoiding nested greedy key patterns on large credential-like words.
const ASSIGNMENT = /["']?\b[\w.-]+["']?\s*[:=]\s*|--[\w.-]+\s+/g;
const SENSITIVE_KEY = /api[-_]?key|token|secret|password|passwd|pwd|credential|private[-_]?key|signature|cookie|_auth/i;
const ASSIGNMENT_VALUE = /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`[^`]*`|[^\s,;&}\]]+[^\n]*/y;

/** Match against the same text, then merge ranges so one redaction cannot hide another detector. */
function redact(text: string, secrets: RegExp | undefined): string {
  const ranges: Array<[number, number]> = [];
  for (const pattern of [...CREDENTIALS, ...(secrets ? [secrets] : [])]) {
    for (const match of text.matchAll(pattern)) ranges.push([match.index, match.index + match[0].length]);
  }
  const assignments = new RegExp(ASSIGNMENT);
  let assignment: RegExpExecArray | null;
  while ((assignment = assignments.exec(text))) {
    if (!SENSITIVE_KEY.test(assignment[0])) continue;
    ASSIGNMENT_VALUE.lastIndex = assignments.lastIndex;
    const value = ASSIGNMENT_VALUE.exec(text);
    if (value) {
      // Structured values and YAML continuation blocks cannot be safely separated by a text
      // filter. Omit the entire excerpt; its caller keeps document paths in separate fields.
      const tail = text.slice(value.index + value[0].length);
      if (!value[0].startsWith(REDACTED) && (/^[|>{\[]/.test(value[0]) || (!/^["'`]/.test(value[0]) && /^\r?\n[ \t]+\S/.test(tail)))) return OMITTED_CREDENTIAL_TEXT;
      ranges.push([value.index, value.index + value[0].length]);
      assignments.lastIndex = value.index + value[0].length;
    }
  }
  ranges.sort(([a, endA], [b, endB]) => a - b || endB - endA);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else merged.push([...range]);
  }
  let cursor = 0;
  const chunks: string[] = [];
  for (const [start, end] of merged) {
    chunks.push(text.slice(cursor, start), REDACTED);
    cursor = end;
  }
  chunks.push(text.slice(cursor));
  return chunks.join("");
}

function literal(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Redact before truncating, including when a credential crosses the output limit. Unknown opaque
 * secrets cannot be discovered by patterns: callers must supply their internal secret values.
 * Oversized or malformed text is omitted, rather than copying a potentially unsafe prefix.
 */
export function createSafeText(secretValues: readonly string[], defaultMaxLength = 4_000): SafeText {
  const variants = new Set<string>();
  for (const value of secretValues) {
    if (!value) continue;
    variants.add(value);
    variants.add(JSON.stringify(value).slice(1, -1));
    // A lone surrogate has no URI encoding. The raw and JSON forms are still protected.
    try {
      variants.add(encodeURIComponent(value));
      variants.add(encodeURI(value));
    } catch {
      // Do not include the original value in an error or diagnostic.
    }
  }
  const secrets = variants.size
    ? new RegExp(
        [...variants]
          .sort((a, b) => b.length - a.length || a.localeCompare(b))
          .map(literal)
          .join("|"),
        "g",
      )
    : undefined;
  return (text, maxLength = defaultMaxLength) => {
    const limit = Number.isFinite(maxLength) ? Math.max(0, Math.min(MAX_OUTPUT, Math.floor(maxLength))) : 0;
    const bound = (value: string) =>
      value.length <= limit ? value : limit <= TRUNCATED_TEXT.length ? TRUNCATED_TEXT.slice(0, limit) : value.slice(0, limit - TRUNCATED_TEXT.length) + TRUNCATED_TEXT;
    if (typeof text !== "string" || text.length > MAX_INPUT) return bound(OMITTED_TEXT);

    let safe = redact(text, secrets);
    // Remove OSC/CSI terminal controls and invisible formatting before a second literal pass.
    safe = safe
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\|$)/g, "")
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "")
      .replace(/\r\n?/g, "\n");
    // Normalization can join a split secret or provider prefix. Bounds see only filtered text.
    return bound(redact(safe, secrets));
  };
}
