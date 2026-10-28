import type { QueryKey } from "@tanstack/react-query";
import { useEffect } from "react";
import { queryClient } from "./query-client";

type Listener = (data: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
let source: EventSource | null = null;

/** One shared EventSource for the page; returns an unsubscribe function. */
export function onServerEvent(event: string, fn: Listener): () => void {
  source ??= new EventSource("/api/events");
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
    source.addEventListener(event, (e) => {
      const data: unknown = JSON.parse((e as MessageEvent<string>).data);
      for (const listener of listeners.get(event) ?? []) listener(data);
    });
  }
  set.add(fn);
  return () => void set.delete(fn);
}

/** Refetches `queryKey` whenever the server emits `event`; with `taskKey`, only that task's events. */
export function useInvalidateOn(event: string, queryKey: QueryKey, taskKey?: string): void {
  const key = JSON.stringify(queryKey);
  useEffect(
    () =>
      onServerEvent(event, (data) => {
        if (taskKey === undefined || (data as { taskKey?: string }).taskKey === taskKey) void queryClient.invalidateQueries({ queryKey: JSON.parse(key) as QueryKey });
      }),
    [event, key, taskKey],
  );
}
