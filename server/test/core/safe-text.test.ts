import { describe, expect, it } from "vitest";
import { createSafeText, OMITTED_CREDENTIAL_TEXT, OMITTED_TEXT, REDACTED, TRUNCATED_TEXT } from "../../src/core/safe-text.js";

describe("safe text", () => {
  it("preserves ordinary instructions, paths, model names and Vietnamese", () => {
    const text = "Đọc .claude/tasks/TPL-032/02-plan.md; model gpt-6.1-sol.\nRun npm test -- server/test/core.";
    expect(createSafeText([])(text)).toBe(text);
  });

  it("redacts all known literal values, including short, overlapping and regex-special secrets", () => {
    const secrets = ["a+b/$[x](y)?", "opaque-secret-long", "opaque-secret", "42", ""];
    const safe = createSafeText(secrets);
    expect(safe("a+b/$[x](y)? opaque-secret-long opaque-secret 42 a+b/$[x](y)?")).toBe(Array(5).fill(REDACTED).join(" "));
    expect(secrets).toEqual(["a+b/$[x](y)?", "opaque-secret-long", "opaque-secret", "42", ""]);
  });

  it("protects raw, JSON escaped and URI encoded copies without serializing an env object", () => {
    const value = 'line\n"quote"/value+with spaces';
    const safe = createSafeText([value]);
    for (const form of [value, JSON.stringify(value).slice(1, -1), encodeURI(value), encodeURIComponent(value)]) {
      expect(safe(`before ${form} after`)).toBe(`before ${REDACTED} after`);
    }
  });

  it.each([
    ["OPENAI_API_KEY=plain-credential", "plain-credential"],
    ["clientSecret: 'credential with spaces'", "credential with spaces"],
    ['{"access_token": "value\\\"escaped", "path": "plan.md"}', "value"],
    ["--password private-pass", "private-pass"],
    ["https://host.test/?api_key=query-private&next=plan", "query-private"],
    ["Authorization: Bearer header-private", "header-private"],
    ["Proxy-Authorization: Basic dXNlcjpwYXNzd29yZA==", "dXNlcjpwYXNzd29yZA=="],
    ["Bearer raw-bearer-value", "raw-bearer-value"],
    ["https://username:private-pass@host.test/path", "private-pass"],
    ["Cookie: sid=private-cookie", "private-cookie"],
    ["log: api_key=credential-after-ordinary-label", "credential-after-ordinary-label"],
    ["sk-proj-1234567890abcdefghijklmnopqrstuvwxyz", "sk-proj-1234567890abcdefghijklmnopqrstuvwxyz"],
    ["sk-ant-api03-1234567890abcdefghijklmnop", "sk-ant-api03-1234567890abcdefghijklmnop"],
    ["ghp_1234567890abcdefghijklmnopqrstuvwxyz", "ghp_1234567890abcdefghijklmnopqrstuvwxyz"],
    ["github_pat_1234567890_abcdefghijklmnopqrstuvwxyz", "github_pat_1234567890_abcdefghijklmnopqrstuvwxyz"],
    ["xoxb-1234567890-abcdefghijklmnop", "xoxb-1234567890-abcdefghijklmnop"],
    ["AKIA1234567890ABCDEF", "AKIA1234567890ABCDEF"],
    ["ASIA1234567890ABCDEF", "ASIA1234567890ABCDEF"],
    ["AIza1234567890abcdefghijklmnopqrstuvwxyz", "AIza1234567890abcdefghijklmnopqrstuvwxyz"],
    ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature"],
  ])("removes credential pattern: %s", (text, secret) => {
    const result = createSafeText([])(text);
    expect(result).not.toContain(secret);
    expect(result).toContain(REDACTED);
  });

  it.each(["RSA ", "EC ", "OPENSSH ", ""])("omits a complete or partial %sprivate key", (kind) => {
    const begin = `-----BEGIN ${kind}PRIVATE KEY-----`;
    const end = `-----END ${kind}PRIVATE KEY-----`;
    const safe = createSafeText([]);
    expect(safe(`path.md\n${begin}\nsensitive-body\n${end}\nnext.md`)).toBe(`path.md\n${REDACTED}\nnext.md`);
    expect(safe(`path.md\n${begin}\nsensitive-body\nunfinished`)).toBe(`path.md\n${REDACTED}`);
  });

  it("normalizes terminal controls and catches secret values joined by invisible characters", () => {
    const safe = createSafeText(["opaque-private"]);
    const text = "\x1b]0;title\x07\x1b[31mopaque-\u200bprivate\x1b[0m\r\nnext\x00";
    expect(safe(text)).toBe(`${REDACTED}\nnext`);
  });

  it("redacts the complete credential before truncation, including across the length boundary", () => {
    const safe = createSafeText(["sensitive-long-credential"]);
    const text = "x".repeat(30) + "sensitive-long-credential" + "y".repeat(100);
    const result = safe(text, 55);
    expect(result).toBe("x".repeat(30) + REDACTED + "yyyy" + TRUNCATED_TEXT);
    expect(result).not.toContain("sensitive");
    expect(result.length).toBe(55);
    const token = createSafeText([])("x ".repeat(10) + "sk-proj-" + "S".repeat(100), 45);
    expect(token).not.toContain("sk-proj-");
    expect(token).not.toContain("SSS");
  });

  it("omits oversized input entirely and caps all output limits", () => {
    const safe = createSafeText([]);
    expect(safe("sensitive prefix" + "x".repeat(256_000))).toBe(OMITTED_TEXT);
    expect(safe("x".repeat(40_000), 100_000)).toHaveLength(32_000);
    expect(safe("input", 0)).toBe("");
    expect(safe("input", -1)).toBe("");
    expect(safe("input", Number.NaN)).toBe("");
    expect(safe("input", 3)).toBe("[TR");
  });

  it("does not throw or expose malformed secret values", () => {
    const value = "\ud800private";
    const safe = createSafeText([value]);
    expect(safe(value)).toBe(REDACTED);
    expect(safe(JSON.stringify(value).slice(1, -1))).toBe(REDACTED);
    expect(safe(undefined as unknown as string)).toBe(OMITTED_TEXT);
  });

  it("is deterministic and idempotent for filtered text", () => {
    const safe = createSafeText(["internal-private"]);
    const result = safe("path.md internal-private\napi_key='provider-private'\nnext.md");
    expect(safe(result)).toBe(result);
    expect(safe("path.md internal-private\napi_key='provider-private'\nnext.md")).toBe(result);
    expect(createSafeText(["other-private"])("internal-private")).toBe("internal-private");
  });

  it("does not expose credential tails when known values overlap credential labels or prefixes", () => {
    const safe = createSafeText(["OPENAI_API_KEY", "sk-proj-1234567890"]);
    expect(safe("OPENAI_API_KEY=private-unlabelled-value")).not.toContain("private-unlabelled-value");
    expect(safe("sk-proj-1234567890abcdefghijklmnopqrstuvwxyz")).toBe(REDACTED);
  });

  it("handles large key-like words without dropping the bound or copying credential tails", () => {
    const safe = createSafeText([]);
    const key = "apiKey".repeat(10_000);
    expect(safe(`${key}=private-long-key-value`, 1_000)).not.toContain("private-long-key-value");
    expect(safe(key, 1_000)).toHaveLength(1_000);
  });

  it.each(["password: |\n  private-first\n  private-tail", "token: {\n  value: private-nested\n}", "client_secret: private-first\n  private-tail"])(
    "omits ambiguous credential blocks instead of copying their tails: %s",
    (text) => {
      expect(createSafeText([])(text)).toBe(OMITTED_CREDENTIAL_TEXT);
    },
  );
});
