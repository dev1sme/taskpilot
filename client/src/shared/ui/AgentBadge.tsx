import { AGENT_LABELS, type Agent } from "../agents";
import "./components.css";

/** Which agent runs a session or step; each agent has its own color. */
export function AgentBadge({ agent }: { agent: Agent }) {
  return <span className={`agent-badge agent-${agent}`}>{AGENT_LABELS[agent]}</span>;
}
