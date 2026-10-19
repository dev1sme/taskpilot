import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "../../app/workspace";

/** Loads one config view; reloads when the repo changes or on demand. */
export function useConfig<T>(load: () => Promise<T>) {
  const { repo } = useWorkspace();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await load());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    // `load` is a stable api function per page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (repo?.path) void reload();
  }, [repo?.path, reload]);

  return { data, error, loading, reload };
}
