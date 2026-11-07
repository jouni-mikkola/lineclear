# Plugins

The base plugins are reactions, worktree, health and alerts, in `plugins/<name>/` and named
in [plugins.json](../plugins.json). A task's side panel takes its items from plugins too (Files, Diff and Pull request
from worktree). A plugin is a `server.ts`.

## Your own plugins

Your own plugins live outside the repo, on the main machine, in `~/.lineclear/plugins/<name>/` (under
`LINECLEAR_HOME`), the same shape as a base plugin. Updates never touch that folder, and every release takes them in:
save a file there and Lineclear rebuilds and restarts within seconds.

- **Add one**: a new folder with a `server.ts`. Its name: lowercase letters, digits
  and dashes, the same as `name` in its `definePlugin`.
- **Change a built-in one**: copy `plugins/<name>/` to `~/.lineclear/plugins/<name>/` and edit it. Yours replaces the
  built-in one of that name, in its place; the server's own behaviour for that name stays.
- **Turn any off**: Settings → Plugins has a switch for each, built in or yours. They go in `~/.lineclear/plugins.json`
  (`{ "off": ["health"] }`), never in the repo's list, so a merge never undoes them.
- **When yours fails**: one that doesn't build is set aside and the rest updates as usual: its last good version runs
  if it had one, else it is left out (a built-in one it replaced comes back). One that throws as the server loads it is
  skipped there. Settings → Plugins shows the error. Fix the file and it comes back with the next rebuild.

A hello world, `~/.lineclear/plugins/hello/server.ts`:

```ts
import { definePlugin } from '../../server/plugin-api.ts'

export default definePlugin({ name: 'hello', about: 'Says hello' })
```

**The contract.** `definePlugin` in `server/plugin-api.ts`: `definePlugin({ name, about })` runs when the server starts.
A plugin folder sits where a base one does, so a base plugin's relative imports (`../../server/plugin-api.ts`) work in a copy too.
