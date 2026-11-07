Module: `server`
Owns: the server: the live source, agents, chats, the engine and the merge lane
May import: `shared`, `check-line`, `registry`, `secrets`, `project-models`, `store`
Lines: 17700

Module: `store`
Covers: `server/server/store.ts`
Owns: how a `store.sqlite` is opened, with its transactions
May import: none
Lines: 160

Module: `secrets`
Covers: `server/server/live/secrets.ts`
Owns: the vault, and the `secrets` and `totp` words that read it
May import: `cli`, `shared`, `check-line`
Lines: 430

Module: `project-models`
Covers: `server/server/live/project-models.ts`
Owns: the model each role of a space starts on, read from and moved into the project's settings
May import: `cli`, `shared`
Lines: 30
