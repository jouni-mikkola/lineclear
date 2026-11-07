# Architecture

Lineclear is a CLI with a rules loop (`src/`), a web UI (`ui/`), a pi extension (`pi/`) and a server (`server/`, the
fork of herdr-projects 2.0 that runs the agents). Each module states its own border in the first lines of its
folder's `README.md`, so a new module edits no shared page. This page keeps only the layer rules.

## A module's border

The first lines of a folder's `README.md` are blocks of `Key: value` lines, split by blank lines:

```
Module: `name`        (optional: the folder's name by default)
Covers: `a/`, `b.ts`  (optional: files and folders from the repo root, the README's folder by default)
Owns: what the module is for
May import: `other`, `another` or none
Lines: the most lines its source files may have together
```

`bun run check` reads them (`scripts/gates/borders.ts`). These fail: an import that `May import` does not allow, a
source file in no module, a name in `May import` that is no module, a module over its `Lines`. A file belongs to the
module with the longest folder or file that covers it. One README can hold several blocks, for single files that are
modules of their own.

An import cycle between files fails too: a file that imports, by any path, a file that imports it back. Type-only
imports count for the borders but not for cycles, since they are gone when the code runs.

## Layers

Mostly from the bottom up. The README of each module says exactly what it may import.

1. Leaves that import nothing of ours: `brand`, `pi`, `shared`, `registry`, `store`, `check-line`.
2. The CLI and the server on top of them: `cli`, `server`, `helper`, `secrets`, `project-models`.
3. The web UI: `kit`, `web`, `samples`.
4. Wiring and tools: `bin`, `scripts`, `gates`, `server-scripts`.
5. Tests: `tests`, `ui-test`, `server-tests`. They import what they test, never the other way round.

## Rules of thumb

- Code that two modules share lives in the lower one. `shared` holds what the server's parts both need.
- Tests may import what they test, never the other way round.
- An import across a border that is not allowed fails the gate.
