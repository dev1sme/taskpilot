import { codexCommand } from "../../../core/codex/launch.js";
import type { AgentBackend } from "./types.js";

export const codexBackend: AgentBackend = { id: "codex", transport: "rpc", launcher: () => codexCommand() };
