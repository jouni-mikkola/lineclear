import fs from "node:fs";
import { dirname } from "node:path";

let counter = 0;

/** A test sets LINECLEAR_NO_FSYNC: throwaway state needs no durability, and under disk load every fsync stretches the test. */
const durable = () => process.env.LINECLEAR_NO_FSYNC === undefined;

/** Writes the temporary file next to `file`, on disk before it is used. */
function stage(file: string, data: string, mode?: number): string {
  const tmp = `${file}.${process.pid}.${counter++}.tmp`;
  const fd = fs.openSync(tmp, "w", mode);
  try {
    fs.writeSync(fd, data);
    if (durable()) fs.fsyncSync(fd);
  } catch (e) {
    fs.closeSync(fd);
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  fs.closeSync(fd);
  return tmp;
}

/** Puts the rename on disk too, so a power cut cannot bring the old file back. */
function syncDir(file: string): void {
  if (!durable()) return;
  try {
    const fd = fs.openSync(dirname(file), "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // a folder that cannot be synced (some filesystems) only loses this extra safety
  }
}

/**
 * Writes a state file to a temporary file and renames it into place, so a crash or a full disk leaves the old file
 * whole and never half of the new one.
 */
export function writeAtomic(file: string, data: string, opts: { mode?: number } = {}): void {
  const tmp = stage(file, data, opts.mode);
  try {
    fs.renameSync(tmp, file);
    syncDir(file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

/** Like `writeAtomic`, but throws EEXIST when the file is already there, and never shows a half-written file. */
export function createAtomic(file: string, data: string, opts: { mode?: number } = {}): void {
  const tmp = stage(file, data, opts.mode);
  try {
    fs.linkSync(tmp, file);
    syncDir(file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
