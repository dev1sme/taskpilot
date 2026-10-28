import { createHashHistory, createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

function NotFound() {
  const { t } = useTranslation();
  return <p className="p-6 text-muted">{t("notFound")}</p>;
}

const rootRoute = createRootRoute({ component: Outlet, notFoundComponent: NotFound });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: function Home() {
    const { t } = useTranslation();
    return <p className="p-6 text-muted">{t("appName")}</p>;
  },
});

const routeTree = rootRoute.addChildren([indexRoute]);

// Hash routes keep the server a plain static host: #/, #/tasks/PROJ-1, #/config/mcp?cli=codex…
export const router = createRouter({ routeTree, history: createHashHistory(), defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
