import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "./styles/app.css";
import "./i18n";
import "./lib/theme";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { router } from "./app/router";
import { Toaster } from "./components/ui/toaster";
import { TooltipProvider } from "./components/ui/tooltip";
import { AuthGate } from "./features/auth/auth-gate";
import { queryClient } from "./lib/query-client";

// xterm measures glyphs when a terminal opens; load the bundled mono face first.
void document.fonts.load('13px "JetBrains Mono"').finally(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          <AuthGate>
            <RouterProvider router={router} />
          </AuthGate>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </StrictMode>,
  ),
);
