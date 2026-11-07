Module: `cli`
Owns: the CLI and its commands, the rules loop, config and data paths, the web API
May import: `pi`, `check-line`, `registry`, `secrets`, `store`
Lines: 16500

Module: `registry`
Covers: `src/models.ts`
Owns: the models every installed harness lists
May import: none
Lines: 330

Module: `check-line`
Covers: `src/machine-limits.ts`, `src/check-runs.ts`, `src/task-work.ts`, `src/decisions-store.ts`, `src/git.ts`, `src/ssh.ts`, `src/time.ts`
Owns: each machine's name and load limit, a branch's GitHub checks read with gh, the log of the work a task does on its machine, the decisions table, and the one git helper, the one SSH command builder and time constants
May import: none
Lines: 400
