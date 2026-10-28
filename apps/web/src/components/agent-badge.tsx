import type { ProviderId } from "@taskpilot/server/api-types";
import { PROVIDER_LABELS } from "@taskpilot/shared";
import { cn } from "@/lib/utils";

const COLOR: Record<ProviderId, string> = { claude: "text-cat-web", copilot: "text-cat-read", codex: "text-cat-run" };

/** The agent's name in its category color; text carries the meaning, color only helps scanning. */
export function AgentBadge({ agent, className }: { agent: ProviderId; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full border border-line px-2 py-0.5 text-xs font-semibold", COLOR[agent], className)}>{PROVIDER_LABELS[agent]}</span>;
}
