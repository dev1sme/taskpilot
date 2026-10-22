import { Robot } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { call } from "../../shared/api/http";
import { href } from "../../shared/router";
import { useWorkspace } from "../workspace";

/** The part of `GET /api/config/agents` the notice needs: which agents can run a whole subtask. */
type AgentRoles = Array<{ check?: { roles: string[] } }>;

/**
 * Shown when the run gives subtasks out (a dispatch step) and no agent, in .claude/agents or
 * ~/.claude/agents, can run one: the leader then has no subagent to pick.
 */
export function SubagentNotice() {
  const { t } = useTranslation("task");
  const { repo } = useWorkspace();
  // Same key as the agents page, so writing the templates there clears the notice here.
  const { data } = useQuery({
    queryKey: ["library", "agents", repo?.path],
    queryFn: () => call<AgentRoles>("GET", "/api/config/agents"),
    enabled: !!repo?.path,
  });
  if (!data || data.some((a) => a.check?.roles.includes("member"))) return null;
  return (
    <p className="subagent-notice" role="status">
      <Robot weight="duotone" aria-hidden="true" />
      <span>
        {t("noSubagents")} <a href={href({ page: "config", section: "agents" })}>{t("noSubagentsLink")}</a>
      </span>
    </p>
  );
}
