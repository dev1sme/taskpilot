import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import { onTaskEvent } from "../../api/events";
import type { SessionView } from "../../api/types";

export function useSessions(taskKey: string) {
  const [sessions, setSessions] = useState<SessionView[]>([]);

  const reload = useCallback(async () => {
    setSessions(await api.sessions(taskKey));
  }, [taskKey]);

  useEffect(() => {
    void reload();
    return onTaskEvent("sessions", taskKey, () => void reload());
  }, [reload, taskKey]);

  return { sessions, reload };
}
