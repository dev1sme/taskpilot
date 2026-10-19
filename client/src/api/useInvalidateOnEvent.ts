import type { QueryKey } from "@tanstack/react-query";
import { useEffect } from "react";
import { onServerEvent, onTaskEvent } from "./events";
import { queryClient } from "./queryClient";

/** Invalidates `queryKey` whenever the server emits `event` (any task). */
export function useInvalidateOnEvent(event: string, queryKey: QueryKey): void {
  useEffect(
    () => onServerEvent(event, () => void queryClient.invalidateQueries({ queryKey })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [event, JSON.stringify(queryKey)],
  );
}

/** Invalidates `queryKey` whenever the server emits `event` for `taskKey`. */
export function useInvalidateOnTaskEvent(event: string, taskKey: string, queryKey: QueryKey): void {
  useEffect(
    () => onTaskEvent(event, taskKey, () => void queryClient.invalidateQueries({ queryKey })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [event, taskKey, JSON.stringify(queryKey)],
  );
}
