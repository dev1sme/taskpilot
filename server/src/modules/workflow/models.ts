import { AGENT_LABELS, type Agent } from "../../core/agents.js";

/** Model aliases Claude Code accepts; `default` and `inherit` mean "no --model". */
export const CLAUDE_MODEL_ALIASES = ["default", "inherit", "haiku", "sonnet", "opus", "fable", "opusplan"] as const;
/** Aliases that stand for the user's (or the subagent's) own model rather than one to pass. */
const NO_MODEL = new Set<string>(["default", "inherit"]);
/** A Claude model id like claude-sonnet-5-5, or an alias, optionally with the 1M-context suffix. */
const CLAUDE_ID = /^(?:claude-[a-z0-9][a-z0-9.-]*|haiku|sonnet|opus|fable)(?:\[1m\])?$/i;
/** Any model name passed to a CLI: one word that cannot be read as another flag. */
const MODEL_WORD = /^[A-Za-z0-9][\w.:/[\]-]*$/;

export function isClaudeModel(value: string): boolean {
  return (CLAUDE_MODEL_ALIASES as readonly string[]).includes(value) || CLAUDE_ID.test(value);
}

/**
 * Why `value` cannot be the model of `agent`, or null when it can: Claude takes an alias or a
 * `claude-…` id; Copilot's models depend on the account, so any single word goes.
 */
export function modelProblem(agent: Agent, value: unknown): string | null {
  if (typeof value !== "string" || !MODEL_WORD.test(value)) return "must be a model name (one word, not starting with -)";
  if (agent === "claude" && !isClaudeModel(value)) {
    return `is not a ${AGENT_LABELS.claude} model; use one of ${CLAUDE_MODEL_ALIASES.join(", ")} or an id like claude-sonnet-5-5`;
  }
  return null;
}

/** The model to pass as --model: none for `default`/`inherit`. */
export function launchModel(value: string | undefined): string | undefined {
  return value === undefined || NO_MODEL.has(value) ? undefined : value;
}
