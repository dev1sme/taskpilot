import type { RawFile } from "./files.js";

/** A raw config file as the editor opens it. */
export interface RawFileView {
  path: string;
  format: RawFile["format"];
  deletable: boolean;
  exists: boolean;
  content: string;
  /** Version token to send back on save; "absent" when the file does not exist. */
  hash: string;
}

/** The diff a save would make, and whether the file changed since it was read. */
export interface RawPreview {
  diff: string;
  changed: boolean;
  stale: boolean;
}
