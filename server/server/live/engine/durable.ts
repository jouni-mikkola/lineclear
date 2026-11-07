// Writing a file so that a power cut leaves the old one or the new one.
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'

/** write, flush, rename, flush the folder: after a power cut the file is the old one or the new one, never a hollow one */
export function durableWrite(file: string, text: string, mode = 0o644) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp`
  const fd = openSync(tmp, 'w', mode)
  try {
    writeSync(fd, text)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, file)
  const dir = openSync(dirname(file), 'r')
  try {
    fsyncSync(dir)
  } finally {
    closeSync(dir)
  }
}
