import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "../workspace";
import { workflowApi } from "./api";
import type { ExecutionSelection } from "./types";

/** One repo-scoped inventory for execution forms and quota policy. */
export function useAgentCapabilities(enabled = true) {
  const { repo } = useWorkspace();
  return useQuery({ queryKey: ["agent-capabilities", repo?.path], queryFn: workflowApi.capabilities, enabled: enabled && !!repo?.path });
}

export function executionCapability(data: Awaited<ReturnType<typeof workflowApi.capabilities>> | undefined, execution: ExecutionSelection) {
  const capability = data?.agents.find((item) => item.agent === execution.agent);
  const models = capability?.models.status === "supported" ? capability.models.items : [];
  const savedModel = execution.model && !models.some((item) => item.model === execution.model) ? execution.model : undefined;
  return { capability, models, savedModel };
}
