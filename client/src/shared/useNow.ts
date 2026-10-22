import { useEffect, useState } from "react";

/** `Date.now()` that refreshes every `intervalMs` while mounted; reading the clock here keeps renders pure. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
