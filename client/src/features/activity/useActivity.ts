import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { onTaskEvent } from "../../api/events";
import type { ActivityItem } from "../../api/types";

/** Activity of every session of the task, oldest first; live items replace earlier versions by id. */
export function useActivity(taskKey: string) {
  const [items, setItems] = useState<ActivityItem[]>([]);

  useEffect(() => {
    let alive = true;
    void api.activity(taskKey).then((list) => alive && setItems(list));
    const off = onTaskEvent("activity", taskKey, (data) => {
      const item = data as ActivityItem;
      setItems((prev) => {
        const i = prev.findIndex((x) => x.id === item.id);
        if (i < 0) return [...prev, item].slice(-300);
        const next = prev.slice();
        next[i] = item;
        return next;
      });
    });
    return () => {
      alive = false;
      off();
    };
  }, [taskKey]);

  return items;
}
