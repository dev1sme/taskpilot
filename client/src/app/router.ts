import { useEffect, useState } from "react";

export type Route =
  | { page: "overview" }
  | { page: "tasks" }
  | { page: "task"; key: string }
  | { page: "config"; section: ConfigSection }
  | { page: "backups" };

export type ConfigSection = "memory" | "settings" | "hooks" | "agents" | "commands" | "skills" | "mcp" | "codegraph";

const CONFIG: ConfigSection[] = ["memory", "settings", "hooks", "agents", "commands", "skills", "mcp", "codegraph"];

/** Hash routes keep the server a plain static host: #/, #/tasks, #/tasks/PROJ-1, #/mcp … */
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "tasks") return parts[1] ? { page: "task", key: parts[1] } : { page: "tasks" };
  if (parts[0] === "backups") return { page: "backups" };
  if (CONFIG.includes(parts[0] as ConfigSection)) return { page: "config", section: parts[0] as ConfigSection };
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
      return `#/${route.section}`;
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
