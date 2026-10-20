import { call, taskUrl } from "../../shared/api/http";

export const docsApi = {
  file: (key: string, path: string) =>
    call<{ path: string; content: string }>("GET", `${taskUrl(key)}/file?path=${encodeURIComponent(path)}`),
};
