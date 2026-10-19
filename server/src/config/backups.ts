import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../errors.js";

export interface BackupEntry {
  id: string;
  at: number;
  /** Absolute path of the file that was backed up. */
  path: string;
  display: string;
  reason: string;
  bytes: number;
  /** False when the file did not exist yet (the write created it). */
  existed: boolean;
}

const ID = /^\d{13}-[0-9a-f]{6}$/;

/**
 * Copies of config files taken right before TaskPilot overwrites them:
 * <dir>/<id>/meta.json + <dir>/<id>/content.
 */
export class BackupStore {
  constructor(private readonly dir: string) {}

  async save(file: { abs: string; display: string }, content: string | null, reason: string): Promise<BackupEntry> {
    const id = `${Date.now()}-${randomBytes(3).toString("hex")}`;
    const entry: BackupEntry = {
      id,
      at: Date.now(),
      path: file.abs,
      display: file.display,
      reason,
      bytes: content === null ? 0 : Buffer.byteLength(content),
      existed: content !== null,
    };
    const folder = path.join(this.dir, id);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    if (content !== null) await writeFile(path.join(folder, "content"), content, { mode: 0o600 });
    await writeFile(path.join(folder, "meta.json"), JSON.stringify(entry, null, 2), { mode: 0o600 });
    return entry;
  }

  async list(limit = 200): Promise<BackupEntry[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const entries = await Promise.all(
      names.filter((n) => ID.test(n)).map(async (n) => {
        try {
          return JSON.parse(await readFile(path.join(this.dir, n, "meta.json"), "utf8")) as BackupEntry;
        } catch {
          return null;
        }
      }),
    );
    return entries.filter((e): e is BackupEntry => e !== null).sort((a, b) => b.at - a.at).slice(0, limit);
  }

  async get(id: string): Promise<{ entry: BackupEntry; content: string | null }> {
    if (!ID.test(id)) throw new HttpError(400, "Mã backup không hợp lệ");
    const folder = path.join(this.dir, id);
    let entry: BackupEntry;
    try {
      entry = JSON.parse(await readFile(path.join(folder, "meta.json"), "utf8")) as BackupEntry;
    } catch {
      throw new HttpError(404, "Không tìm thấy backup");
    }
    const content = entry.existed ? await readFile(path.join(folder, "content"), "utf8") : null;
    return { entry, content };
  }
}
