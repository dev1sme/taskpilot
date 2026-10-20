import { QueryClient } from "@tanstack/react-query";

/**
 * Freshness here is always driven explicitly by the server's SSE stream (see `events.ts`),
 * never by background polling or refocus, so queries never go stale on their own.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false },
  },
});
