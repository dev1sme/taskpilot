import { useMutation } from "@tanstack/react-query";
import { call } from "@/lib/api";
import { queryClient } from "@/lib/query-client";
import { taskUrl } from "@/features/workspace/queries";

/** Marks a task done or reopens it (task.yml); the list refreshes without waiting for the watcher. */
export function useSetTaskDone() {
  return useMutation({
    mutationFn: ({ key, done }: { key: string; done: boolean }) => call<{ done: { at: number | null } | null }>("PUT", `${taskUrl(key)}/done`, { done }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["tasks"] }),
  });
}
