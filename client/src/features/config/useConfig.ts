import type { QueryKey } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "../../app/workspace";

/** Loads one config view, keyed by `key`; refetches when the repo changes or on demand. */
export function useConfig<T>(key: QueryKey, load: () => Promise<T>, enabled = true) {
  const { repo } = useWorkspace();
  const query = useQuery({
    queryKey: [...key, repo?.path],
    queryFn: load,
    enabled: enabled && !!repo?.path,
  });

  return {
    data: query.data ?? null,
    error: query.error ? (query.error as Error).message : null,
    loading: query.isLoading,
    reload: async () => void (await query.refetch()),
  };
}
