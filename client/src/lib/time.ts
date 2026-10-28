import { useEffect, useState } from "react";
import { locale } from "@/i18n";

/** `Date.now()` that refreshes every `intervalMs` while mounted; reading the clock here keeps renders pure. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** "4m 12s", "2h 5m". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Time of day today, date and time otherwise. */
export function clockTime(at: number): string {
  const date = new Date(at);
  const today = new Date().toDateString() === date.toDateString();
  return today
    ? date.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleString(locale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
