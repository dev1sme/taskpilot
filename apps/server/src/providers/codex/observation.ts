import path from "node:path";
import { rolloutIdentity } from "./rollout.js";

const turns = new WeakMap<object, { active?: string; closed: Set<string> }>();

/** Late callbacks from a superseded native turn must not borrow the current prompt's fence. */
export function currentCodexTurn(event: string, raw: Record<string, unknown>, state: object): boolean {
  if (typeof raw.turn_id !== "string" || !raw.turn_id || event === "SessionStart") return true;
  let memory = turns.get(state);
  if (!memory) {
    memory = { closed: new Set() };
    turns.set(state, memory);
  }
  const id = raw.turn_id;
  if (memory.closed.has(id)) return false;
  if (event === "UserPromptSubmit") {
    if (memory.active && memory.active !== id) memory.closed.add(memory.active);
    memory.active = id;
  } else if (memory.active && memory.active !== id) return false;
  if (event === "Stop") {
    memory.closed.add(id);
    memory.active = undefined;
  }
  if (memory.closed.size > 400) memory.closed.delete(memory.closed.values().next().value!);
  return true;
}

export function codexHookKey(event: string, raw: Record<string, unknown>): string | undefined {
  if (typeof raw.turn_id !== "string" || !raw.turn_id) return undefined;
  const toolEvent = ["PreToolUse", "PermissionRequest", "PostToolUse", "PostToolUseFailure"].includes(event);
  if (toolEvent && (typeof raw.tool_use_id !== "string" || !raw.tool_use_id)) return undefined;
  return JSON.stringify([raw.session_id, raw.turn_id, raw.hook_event_name, toolEvent ? raw.tool_use_id : null]);
}

/** A process token is inherited by native children; it is not root-thread identity evidence. */
export async function acceptCodexHook(event: string, raw: Record<string, unknown>, meta: { nativeId?: string; repo: string }): Promise<boolean> {
  const id = raw.session_id;
  if (typeof id !== "string" || !id || raw.agent_id || raw.parent_thread_id || raw.parent_session_id) return false;
  if (typeof raw.hook_event_name !== "string" || (raw.hook_event_name !== event && !(event === "Stop" && raw.hook_event_name === "Interrupt"))) return false;
  if (meta.nativeId) return id === meta.nativeId;
  // A child SessionStart may arrive first and share cwd/token/source labels with its parent.
  // Recheck the metadata on later hooks too: SessionStart can race the rollout's first write.
  if (typeof raw.transcript_path !== "string" || !path.isAbsolute(raw.transcript_path)) return false;
  const identity = await rolloutIdentity(raw.transcript_path);
  return identity?.id === id && identity.source === "cli" && typeof identity.cwd === "string" && path.resolve(identity.cwd) === path.resolve(meta.repo);
}
