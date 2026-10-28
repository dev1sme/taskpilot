import { QueryClient } from "@tanstack/react-query";

/**
 * Freshness is driven by the server's event stream (see `events.ts`), never by polling or
 * refocus, so queries never go stale on their own.
 */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false } },
});
