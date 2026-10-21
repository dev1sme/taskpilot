import type { Agent } from "../../shared/agents";
import { call, taskUrl } from "../../shared/api/http";
import type { SessionView } from "./types";

export const sessionsApi = {
  sessions: (key: string) => call<SessionView[]>("GET", `${taskUrl(key)}/sessions`),
  createSession: (key: string, agent: Agent) => call<SessionView>("POST", `${taskUrl(key)}/sessions`, { agent }),
  resumeSession: (id: string) => call<SessionView>("POST", `/api/sessions/${id}/resume`),
  stopSession: (id: string) => call<{ ok: true }>("POST", `/api/sessions/${id}/stop`),
  forgetSession: (id: string) => call<{ ok: true }>("DELETE", `/api/sessions/${id}`),
  repoSessions: () => call<SessionView[]>("GET", "/api/repo/sessions"),
  createRepoSession: (agent: Agent) => call<SessionView>("POST", "/api/repo/sessions", { agent }),
  ptyUrl: (id: string) => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/api/sessions/${id}/pty`;
  },
};
