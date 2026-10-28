import { createHashHistory, createRootRoute, createRoute, createRouter, lazyRouteComponent } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { OverviewPage } from "@/features/overview/overview-page";
import { CONFIG_SECTIONS, configSearch, type ConfigSection } from "./routes";
import { Shell } from "./shell";

function NotFound() {
  const { t } = useTranslation();
  return <p className="p-8 text-muted">{t("notFound")}</p>;
}

const rootRoute = createRootRoute({ component: Shell, notFoundComponent: NotFound });

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: OverviewPage,
});

const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks",
  component: lazyRouteComponent(() => import("@/features/tasks/tasks-page"), "TasksPage"),
});

export const taskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks/$key",
  component: lazyRouteComponent(() => import("@/features/task/task-screen"), "TaskRoute"),
});

export const configRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/config/$section",
  validateSearch: configSearch,
  params: {
    parse: ({ section }) => {
      if (!(CONFIG_SECTIONS as readonly string[]).includes(section)) throw new Error(`Unknown config section: ${section}`);
      return { section: section as ConfigSection };
    },
    stringify: ({ section }) => ({ section }),
  },
  // Pages load on first visit: CodeMirror, the diff view and xterm stay out of the start page's bundle.
  component: lazyRouteComponent(() => import("@/features/config/config-route"), "ConfigRoute"),
});

const backupsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/backups",
  component: lazyRouteComponent(() => import("@/features/backups/backups-page"), "BackupsPage"),
});

const routeTree = rootRoute.addChildren([overviewRoute, tasksRoute, taskRoute, configRoute, backupsRoute]);

// Hash routes keep the server a plain static host: #/, #/tasks/PROJ-1, #/config/mcp?cli=codex…
export const router = createRouter({ routeTree, history: createHashHistory(), defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
