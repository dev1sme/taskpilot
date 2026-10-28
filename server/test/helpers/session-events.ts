import { DEFAULT_PROVIDER } from "../../src/core/providers.js";
import type { SessionMeta } from "../../src/core/state.js";
import { sessionEventFromHook, type HookEvent } from "../../src/modules/sessions/index.js";
import type { WorkflowEngine } from "../../src/modules/workflow/index.js";

/** Delivers a hook to the engine the way SessionManager does: as the neutral session event. */
export function fireHook(engine: Pick<WorkflowEngine, "onEvent">, meta: SessionMeta, event: HookEvent, payload: Record<string, unknown> = {}): Promise<void> {
  return engine.onEvent(meta, sessionEventFromHook({ sessionId: meta.id, provider: meta.agent ?? DEFAULT_PROVIDER }, event, payload));
}
