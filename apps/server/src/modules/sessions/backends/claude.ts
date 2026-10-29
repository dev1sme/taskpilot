import { claudeLauncher } from "../../../providers/claude/cli-launcher.js";
import { claudeModelProblem } from "../../../providers/claude/models.js";
import { claudeStatusLineMetrics, claudeStatusLineUsage } from "../../../providers/claude/status-line.js";
import { hookSettings } from "../hooks.js";
import type { ProviderBackend } from "./types.js";
import { probePty } from "./probe.js";

/** Claude Code: hooks and status line go in with --settings; payloads are already in the shape TaskPilot reads. */
export const claudeBackend: ProviderBackend = {
  id: "claude",
  launchOptions: (_meta, options) => ({ ...options, settings: hookSettings() }),
  permissionModes: ["default", "acceptEdits", "plan", "auto"],
  supportsSubagents: true,
  requiresLogin: false,
  requiresModelInventory: false,
  warnsWhenNoHook: false,
  supportsExtraDirs: true,
  modelProblem: claudeModelProblem,
  probe: (context) => probePty(claudeBackend, context),
  launcher: claudeLauncher,
  readStatusLine: (payload) => ({
    metrics: { source: "claude-statusline", ...claudeStatusLineMetrics(payload) },
    account: { agent: "claude", usage: claudeStatusLineUsage(payload) },
  }),
};
