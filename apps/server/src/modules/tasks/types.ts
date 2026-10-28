import type { AppState } from "../../core/state.js";

export interface TaskStatus {
  status: "open" | "done";
  /** When it was marked done (ms); null when open or the file has no valid date. */
  doneAt: number | null;
}

export interface TaskFile {
  /** Relative to the task directory, always with forward slashes. */
  path: string;
  size: number;
  mtime: number;
}

export interface TaskSummary {
  key: string;
  title: string;
  specFiles: TaskFile[];
  outputFiles: TaskFile[];
  updatedAt: number;
  /** The task's `task.yml`, when it has a valid one. */
  status: TaskStatus | null;
}

/** How far a task got, as the repo's workflow reads its documents. */
export interface TaskStage {
  done: number;
  total: number;
  step: string | null;
}

/** What the repo's workflow says about task documents; supplied by the app so tasks does not depend on workflow. */
/** A task with what its workflow makes of its documents. */
export interface TaskDetail extends TaskSummary {
  stage: TaskStage;
  /** The decision log's file name, from the workflow. */
  historyFile: string;
  /** Marked done: task.yml says so, or (without the file) the run finished; `at` is unknown then. */
  done: { at: number | null } | null;
}

/** A task as the task list shows it: its run and sessions too. */
export interface TaskListItem extends TaskDetail {
  run: { phase: AppState["runs"][number]["phase"]; stepIndex: number; stepStartedAt: number } | null;
  waitingPermission: boolean;
  sessionsRunning: number;
}
