import type { Agent } from "../../core/agents.js";
import { CLAUDE_MODEL_ALIASES, claudeModelProblem, isClaudeModel } from "../../core/claude/models.js";

export { CLAUDE_MODEL_ALIASES, isClaudeModel };

/** Aliases that stand for the user's (or the subagent's) own model rather than one to pass. */
const NO_MODEL = new Set<string>(["default", "inherit"]);
/** Any model name passed to a CLI: one word that cannot be read as another flag. */
const MODEL_WORD = /^[A-Za-z0-9][\w.:/[\]-]*$/;

/**
 * Why `value` cannot be the model of `agent`, or null when it can: Claude takes an alias or a
 * `claude-…` id; Copilot's models depend on the account, so any single word goes.
 */
export function modelProblem(agent: Agent, value: unknown): string | null {
  if (typeof value !== "string" || !MODEL_WORD.test(value)) return "must be a model name (one word, not starting with -)";
  return agent === "claude" ? claudeModelProblem(value) : null;
}

/** The model to pass as --model: none for `default`/`inherit`. */
export function launchModel(value: string | undefined): string | undefined {
  return value === undefined || NO_MODEL.has(value) ? undefined : value;
}
