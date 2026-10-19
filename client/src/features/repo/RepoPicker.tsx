import { FolderOpen } from "@phosphor-icons/react";
import { useEffect, useId, useState } from "react";
import type { RepoInfo } from "../../api/types";
import { Button } from "../../components/Button";
import "./repo.css";

export function RepoPicker({ repo, onChange }: { repo: RepoInfo | null; onChange: (path: string) => Promise<void> }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  useEffect(() => setValue(repo?.path ?? ""), [repo?.path]);

  return (
    <form
      className="repo-picker"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onChange(value);
          setError(null);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor={inputId}>Repo</label>
      <input
        id={inputId}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="/home/ban/projects/my-app"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : undefined}
      />
      <Button type="submit" icon={FolderOpen} busy={busy} disabled={!value.trim() || value === repo?.path}>
        Mở
      </Button>
      {error && (
        <span className="error" id={`${inputId}-error`} role="alert">
          {error}
        </span>
      )}
    </form>
  );
}
