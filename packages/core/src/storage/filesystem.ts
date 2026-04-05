import { statSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { StorageBackend } from "./interface";

/**
 * Storage backend that writes files to the local filesystem.
 *
 * This is the default backend and preserves existing behavior: files live at
 * `{snapshotsDir}/{snapshotId}/{filename}` and DB refs are absolute paths.
 */
export class FilesystemBackend implements StorageBackend {
  private readonly snapshotsDir: string;

  constructor(snapshotsDir: string) {
    this.snapshotsDir = snapshotsDir;
  }

  private absolutePath(snapshotId: number, filename: string): string {
    return join(this.snapshotsDir, String(snapshotId), filename);
  }

  async localPath(snapshotId: number, filename: string): Promise<string> {
    const p = this.absolutePath(snapshotId, filename);
    await mkdir(dirname(p), { recursive: true });
    return p;
  }

  async finalize(snapshotId: number, filename: string): Promise<string> {
    // File was already written to the final path — just return the ref.
    return this.absolutePath(snapshotId, filename);
  }

  async putText(snapshotId: number, filename: string, content: string): Promise<string> {
    const p = this.absolutePath(snapshotId, filename);
    await mkdir(dirname(p), { recursive: true });
    await Bun.write(p, content);
    return p;
  }

  async putBytes(snapshotId: number, filename: string, content: Uint8Array): Promise<string> {
    const p = this.absolutePath(snapshotId, filename);
    await mkdir(dirname(p), { recursive: true });
    await Bun.write(p, content);
    return p;
  }

  async getBytes(ref: string): Promise<Uint8Array> {
    return Bun.file(ref).bytes();
  }

  async fileExists(ref: string): Promise<boolean> {
    return Bun.file(ref).exists();
  }

  async fileSize(ref: string): Promise<number> {
    try {
      return statSync(ref).size;
    } catch {
      return 0;
    }
  }

  async deleteAll(snapshotId: number): Promise<void> {
    const dir = join(this.snapshotsDir, String(snapshotId));
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }

  validateRef(ref: string): boolean {
    // Resolve both to catch symlink tricks; normalize trailing separator
    const normalized = `${this.snapshotsDir.replace(/\/?$/, "")}/`;
    try {
      return ref.startsWith(normalized) || ref === this.snapshotsDir;
    } catch {
      return false;
    }
  }
}
