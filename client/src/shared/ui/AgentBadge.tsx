import { PROVIDER_LABELS, type ProviderId } from "../providers";
import "./components.css";

/** Which agent runs a session or step; each agent has its own color. */
export function AgentBadge({ agent }: { agent: ProviderId }) {
  return <span className={`agent-badge agent-${agent}`}>{PROVIDER_LABELS[agent]}</span>;
}
