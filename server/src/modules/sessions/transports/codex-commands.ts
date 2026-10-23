import { listCodexModels } from "../../../core/codex/models.js";

/** Codex App Server has no slash commands (they live in the TUI), so the client resolves the ones with an equivalent RPC. */
export type CodexCommand =
  | { kind: "compact" }
  | { kind: "review"; target: Record<string, unknown> }
  | { kind: "model"; id: string }
  | { kind: "skills" }
  | { kind: "skill"; name: string; rest: string }
  | { kind: "unsupported"; name: string };

export interface CodexCommandContext {
  rpc: { request(method: string, params?: unknown): Promise<unknown> };
  threadId: string;
  cwd?: string;
}

export type CodexResolved =
  /** Not a command, or a `$skill` call: send these inputs with `turn/start`. */
  | { kind: "turn"; input: Array<Record<string, unknown>> }
  /** Answered here; `notice` is shown as a note, `error` as an error item, `model` applies to later turns. */
  | { kind: "handled"; notice?: string; error?: string; model?: string };

const SLASH = /^\/([A-Za-z][\w-]*)(?:[ \t]+([\s\S]*))?$/;
const SKILL = /^\$([A-Za-z][\w-]*)(?:\s+([\s\S]*))?$/;

/** `/path/to/file` is not a command because the name stops at the first `/`. */
export function parseCodexCommand(text: string): CodexCommand | null {
  const input = text.trim();
  const slash = SLASH.exec(input);
  if (slash) {
    const name = slash[1].toLowerCase();
    const arg = (slash[2] ?? "").trim();
    if (name === "compact") return { kind: "compact" };
    if (name === "skills") return { kind: "skills" };
    if (name === "model") return { kind: "model", id: arg };
    if (name === "review") return { kind: "review", target: reviewTarget(arg) };
    return { kind: "unsupported", name };
  }
  const skill = SKILL.exec(input);
  return skill ? { kind: "skill", name: skill[1], rest: (skill[2] ?? "").trim() } : null;
}

/** `/review` → working tree; `branch <name>`, `commit <sha>`; anything else is a custom instruction. */
function reviewTarget(arg: string): Record<string, unknown> {
  if (!arg) return { type: "uncommittedChanges" };
  const [word, ...rest] = arg.split(/\s+/);
  const value = rest.join(" ");
  if (word === "branch" && value) return { type: "baseBranch", branch: value };
  if (word === "commit" && value) return { type: "commit", sha: value };
  return { type: "custom", instructions: arg };
}

const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

interface SkillRef {
  name: string;
  path: string;
  enabled: boolean;
  description: string;
}

async function listSkills(ctx: CodexCommandContext): Promise<SkillRef[]> {
  const result = obj(await ctx.rpc.request("skills/list", ctx.cwd ? { cwds: [ctx.cwd] } : {}));
  const skills: SkillRef[] = [];
  for (const entry of Array.isArray(result.data) ? result.data : []) {
    for (const raw of Array.isArray(obj(entry).skills) ? (obj(entry).skills as unknown[]) : []) {
      const s = obj(raw);
      if (str(s.name) && str(s.path)) skills.push({ name: str(s.name), path: str(s.path), enabled: s.enabled !== false, description: str(s.description) });
    }
  }
  return skills;
}

export const unsupportedText = (name: string): string => `/${name} chỉ có trong TUI Codex, App Server không có lệnh này. Dùng được: /compact, /review, /model, /skills, $skill.`;

/** Runs a command against the open thread. Plain text returns `turn` unchanged. */
export async function resolveCodexInput(text: string, ctx: CodexCommandContext): Promise<CodexResolved> {
  const plain: CodexResolved = { kind: "turn", input: [{ type: "text", text, text_elements: [] }] };
  const command = parseCodexCommand(text);
  if (!command) return plain;
  switch (command.kind) {
    case "unsupported":
      return { kind: "handled", error: unsupportedText(command.name) };
    case "compact":
      await ctx.rpc.request("thread/compact/start", { threadId: ctx.threadId });
      return { kind: "handled", notice: "Đang nén ngữ cảnh (/compact)…" };
    case "review":
      await ctx.rpc.request("review/start", { threadId: ctx.threadId, target: command.target, delivery: "inline" });
      return { kind: "handled" };
    case "skills": {
      const skills = (await listSkills(ctx)).filter((s) => s.enabled);
      const lines = skills.map((s) => `$${s.name}${s.description ? ` — ${s.description}` : ""}`);
      return { kind: "handled", notice: skills.length ? `Skill có sẵn:\n${lines.join("\n")}` : "Không có skill nào." };
    }
    case "model": {
      const models = await listCodexModels(ctx.rpc as Parameters<typeof listCodexModels>[0]);
      if (!command.id) {
        return { kind: "handled", notice: `Model có sẵn: ${models.map((m) => m.id).join(", ") || "(trống)"}. Dùng /model <id> để đổi cho các lượt sau.` };
      }
      const found = models.find((m) => m.id === command.id || m.model === command.id);
      if (!found) return { kind: "handled", error: `Model "${command.id}" không có. Có: ${models.map((m) => m.id).join(", ")}.` };
      return { kind: "handled", notice: `Các lượt sau dùng model ${found.model}.`, model: found.model };
    }
    case "skill": {
      const skill = (await listSkills(ctx)).find((s) => s.enabled && s.name === command.name);
      // `$HOME` and the like are ordinary text, so an unknown name is sent as typed.
      if (!skill) return plain;
      const input: Array<Record<string, unknown>> = [{ type: "skill", name: skill.name, path: skill.path }];
      if (command.rest) input.push({ type: "text", text: command.rest, text_elements: [] });
      return { kind: "turn", input };
    }
  }
}
