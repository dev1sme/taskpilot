import { useQuery } from "@tanstack/react-query";
import { useInvalidateOnEvent } from "../../shared/api/useInvalidateOnEvent";
import { usageApi } from "./api";

/** Plan usage (5h / 7d), live; null until a session has reported it. */
export function useUsage() {
  const query = useQuery({ queryKey: ["usage"], queryFn: usageApi.usage });
  useInvalidateOnEvent("usage", ["usage"]);
  return query.data ?? null;
}
