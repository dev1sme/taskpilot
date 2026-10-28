import { createHashHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { TaskScreen } from "@/features/task/task-screen";
import { TasksPage } from "@/features/tasks/tasks-page";
import { Pending } from "./pending";
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
  component: function Overview() {
    const { t } = useTranslation("shell");
    return <Pending title={t("nav.overview")} />;
  },
});

const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks",
  component: TasksPage,
});

export const taskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks/$key",
  component: function Task() {
    const { key } = taskRoute.useParams();
    return <TaskScreen taskKey={key} />;
  },
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
  component: function Config() {
    const { t } = useTranslation("shell");
    const { section } = configRoute.useParams();
    return <Pending title={t(`nav.${section}`)} />;
  },
});

const backupsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/backups",
  component: function Backups() {
    const { t } = useTranslation("shell");
    return <Pending title={t("nav.backups")} />;
  },
});

const routeTree = rootRoute.addChildren([overviewRoute, tasksRoute, taskRoute, configRoute, backupsRoute]);

// Hash routes keep the server a plain static host: #/, #/tasks/PROJ-1, #/config/mcp?cli=codex…
export const router = createRouter({ routeTree, history: createHashHistory(), defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
