import { call, taskUrl } from "../../shared/api/http";
import type { ActivityItem } from "./types";

export const activityApi = {
  activity: (key: string) => call<ActivityItem[]>("GET", `${taskUrl(key)}/activity?limit=300`),
};
