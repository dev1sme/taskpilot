import { PROVIDER_LABELS } from "@taskpilot/shared";

/** Model aliases Claude Code accepts; `default` and `inherit` mean "no --model". */
export const CLAUDE_MODEL_ALIASES = ["default", "inherit", "haiku", "sonnet", "opus", "fable", "opusplan"] as const;
/** A Claude model id like claude-sonnet-5-5, or an alias, optionally with the 1M-context suffix. */
const CLAUDE_ID = /^(?:claude-[a-z0-9][a-z0-9.-]*|haiku|sonnet|opus|fable)(?:\[1m\])?$/i;

export function isClaudeModel(value: string): boolean {
  return (CLAUDE_MODEL_ALIASES as readonly string[]).includes(value) || CLAUDE_ID.test(value);
}

/** Why `value` (already a one-word model name) cannot be a Claude model, or null when it can. */
export function claudeModelProblem(value: string): string | null {
  if (isClaudeModel(value)) return null;
  return `is not a ${PROVIDER_LABELS.claude} model; use one of ${CLAUDE_MODEL_ALIASES.join(", ")} or an id like claude-sonnet-5-5`;
}
