import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import { onTaskEvent } from "../../api/events";
import type { RunPhase, RunView } from "../../api/types";

export const ACTIVE_PHASES: RunPhase[] = ["starting", "running", "waiting", "gate", "interrupted"];

/** The task's workflow and latest run, kept live through "run" events. */
export function useRun(taskKey: string) {
  const [view, setView] = useState<RunView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setView(await api.run(taskKey));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [taskKey]);

  useEffect(() => {
    void reload();
    return onTaskEvent("run", taskKey, () => void reload());
  }, [reload, taskKey]);

  return { view, error, reload };
}
