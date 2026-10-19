import { useEffect, useState } from "react";
import { api, type TaskSummary } from "./api";
import { Markdown } from "./Markdown";

export function DocsView({ task }: { task: TaskSummary }) {
  const files = [...task.specFiles, ...task.outputFiles];
  const [picked, setOpen] = useState(files[0]?.path ?? "");
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The picked file may disappear on disk; fall back to the first one.
  const open = files.some((f) => f.path === picked) ? picked : (files[0]?.path ?? "");

  // Reload when the selected file changes on disk (task.updatedAt moves on every watcher event).
  useEffect(() => {
    if (!open) return;
    api
      .file(task.key, open)
      .then((r) => {
        setContent(r.content);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [task.key, open, task.updatedAt]);

  return (
    <div className="docs">
      <nav className="files">
        <FileGroup label="Spec" files={task.specFiles.map((f) => f.path)} open={open} onOpen={setOpen} />
        <FileGroup label="Tài liệu" files={task.outputFiles.map((f) => f.path)} open={open} onOpen={setOpen} />
      </nav>
      {error ? <p className="error">{error}</p> : content !== null && <Markdown source={content} />}
    </div>
  );
}

function FileGroup(props: { label: string; files: string[]; open: string; onOpen: (path: string) => void }) {
  if (props.files.length === 0) return null;
  return (
    <div className="file-group">
      <span className="label">{props.label}</span>
      {props.files.map((f) => (
        <button key={f} type="button" aria-pressed={f === props.open} onClick={() => props.onOpen(f)}>
          {f}
        </button>
      ))}
    </div>
  );
}
