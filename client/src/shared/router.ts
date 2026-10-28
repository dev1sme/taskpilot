import { useEffect, useState } from "react";
import { isProviderId, type ProviderId } from "./providers";

export type Route =
  { page: "overview" } | { page: "tasks" } | { page: "task"; key: string } | { page: "config"; section: ConfigSection; file?: string; cli?: ProviderId } | { page: "backups" };

export type ConfigSection = "memory" | "settings" | "hooks" | "agents" | "commands" | "skills" | "workflow" | "formats" | "mcp" | "codegraph";

const CONFIG: ConfigSection[] = ["memory", "settings", "hooks", "agents", "commands", "skills", "workflow", "formats", "mcp", "codegraph"];
const SHARED: ConfigSection[] = ["workflow", "formats", "codegraph"];
let selectedCli: ProviderId = "claude";

export const isCliConfigSection = (section: ConfigSection): boolean => !SHARED.includes(section);
export const selectedConfigCli = (): ProviderId => selectedCli;

/** Hash routes keep the server a plain static host: #/, #/tasks, #/tasks/PROJ-1, #/mcp, #/workflow/format-plan.md … */
export function parseRoute(hash: string): Route {
  const [path, search = ""] = hash.replace(/^#\/?/, "").split("?", 2);
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const rawCli = new URLSearchParams(search).get("cli");
  const cli = isProviderId(rawCli) ? rawCli : "claude";
  if (parts[0] === "tasks") return parts[1] ? { page: "task", key: parts[1] } : { page: "tasks" };
  if (parts[0] === "backups") return { page: "backups" };
  if (parts[0] === "workflow" && parts[1]) return { page: "config", section: "workflow", file: parts[1] };
  if (CONFIG.includes(parts[0] as ConfigSection)) {
    const section = parts[0] as ConfigSection;
    if (isCliConfigSection(section)) {
      selectedCli = cli;
      return { page: "config", section, cli };
    }
    return { page: "config", section };
  }
  return { page: "overview" };
}

export function href(route: Route): string {
  switch (route.page) {
    case "overview":
      return "#/";
    case "tasks":
      return "#/tasks";
    case "task":
      return `#/tasks/${encodeURIComponent(route.key)}`;
    case "config":
      return `#/${route.section}${route.file ? `/${encodeURIComponent(route.file)}` : ""}${isCliConfigSection(route.section) && (route.cli ?? selectedCli) !== "claude" ? `?cli=${route.cli ?? selectedCli}` : ""}`;
    case "backups":
      return "#/backups";
  }
}

export function navigate(route: Route): void {
  location.hash = href(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
