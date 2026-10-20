import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useInvalidateOnEvent } from "../../api/useInvalidateOnEvent";

/** Plan usage (5h / 7d), live; null until a session has reported it. */
export function useUsage() {
  const query = useQuery({ queryKey: ["usage"], queryFn: api.usage });
  useInvalidateOnEvent("usage", ["usage"]);
  return query.data ?? null;
}
