import { useCallback, useState } from "react";
import { queryClient } from "../../shared/api/queryClient";
import { workflowApi } from "../workflow";

/** Marks a task done or reopens it (task.yml), then refreshes the task list without waiting for the watcher. */
export function useTaskDone() {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setDone = useCallback(async (key: string, done: boolean) => {
    setBusyKey(key);
    setError(null);
    try {
      await workflowApi.setDone(key, done);
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  }, []);

  return { busyKey, error, setDone };
}
