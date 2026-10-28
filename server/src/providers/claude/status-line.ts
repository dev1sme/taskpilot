/** The model id and session cost in a Claude Code status line payload; fields it lacks are left out. */
export function claudeStatusLineMetrics(payload: Record<string, unknown>): { model?: string; costUsd?: number } {
  const model = payload.model as { id?: unknown } | undefined;
  const cost = payload.cost as { total_cost_usd?: unknown } | undefined;
  return {
    ...(typeof model?.id === "string" && model.id ? { model: model.id } : {}),
    ...(typeof cost?.total_cost_usd === "number" && Number.isFinite(cost.total_cost_usd) ? { costUsd: cost.total_cost_usd } : {}),
  };
}
