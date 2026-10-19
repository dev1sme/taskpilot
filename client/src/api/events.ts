import { token } from "./client";

type Listener = (data: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
let source: EventSource | null = null;

/** One shared EventSource for the page; returns an unsubscribe function. */
export function onServerEvent(event: string, fn: Listener): () => void {
  if (!source) source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
    source.addEventListener(event, (e) => {
      const data: unknown = JSON.parse((e as MessageEvent<string>).data);
      for (const l of listeners.get(event) ?? []) l(data);
    });
  }
  set.add(fn);
  return () => void set.delete(fn);
}

/** Subscribes to events carrying a `taskKey`, filtered to one task. */
export function onTaskEvent(event: string, taskKey: string, fn: (data: unknown) => void): () => void {
  return onServerEvent(event, (data) => {
    if ((data as { taskKey?: string }).taskKey === taskKey) fn(data);
  });
}
