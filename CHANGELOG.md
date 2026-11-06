# Changelog

## 0.1.0

The first release.

### What works

- One-line install on Linux, which adds Bun, herdr and pi, and an update that rolls back when it breaks.
- `lineclear project add`, and a roadmap file in each project with ordered steps, each with a why and a done when.
- Rules, with no AI, that start each ready step, wake a stalled one, and hold new work while a machine is busy.
- A worker per step on its own branch, a reviewer from another company than the worker, and a merge lane that keeps
  main green.
- The Dispatcher as a chat in the web UI, the Inbox for real decisions, and live views of Home, roadmap, usage,
  agent browsers and settings, on a phone or a desktop.
- More machines over SSH with `lineclear machine add`.
- `lineclear migrate` from Shepherdr 2.0 and back, and `lineclear uninstall`.

### Known not to work

- Linux only. Other systems are not tried.
- The first project takes several commands: the install does not yet start the board or make the Dispatcher.
- Home is not yet the Dispatcher chat. The chat is at `/chat`.
- `server/` and some docs still use Shepherdr's names inside.

### Origin

Lineclear began as a fork of [Shepherdr 2.0](https://github.com/eliasstravik/herdr-projects) (MIT). Its notice is in
`server/NOTICE`.
