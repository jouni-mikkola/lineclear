# Upgrading and updates

## Upgrading from herdr-projects

herdr-projects 2.0 is the next version of herdr-projects: `herdr plugin update` takes you there.

1. Finish or stop the tasks in flight first: their agents keep running, but nothing follows them any more.
2. `herdr plugin update` needs herdr 0.9.4 or later: run `herdr update` first on an older one.
3. Run `herdr plugin update herdr-projects`, then press your old herdr-projects key (or run the action **Open
   Lineclear**, or restart herdr). Lineclear starts and shows its link.

Lineclear brings nothing over from herdr-projects: `~/.herdr-projects` stays exactly as it was. Its keeper, page
server, agent skill and sidebar rows are not tidied away for you.

Later updates are `herdr plugin update` too: the next herdr start, or the next press of the open key, swaps the running
Lineclear for the new version.

## Going back to herdr-projects

herdr-projects 1.2.27 stays on the branch `legacy-herdr-projects` and the tag `v1.2.27`, with its own README. To go back
with your old tasks and settings as they were:

```sh
herdr plugin action invoke herdr-projects.stop                     # stop Lineclear
herdr plugin install eliasstravik/herdr-projects --ref v1.2.27 --yes    # herdr-projects 1.2.27 in its place
```

Then press the herdr-projects key: the board opens. Lineclear's own data stays in `~/.lineclear` for a later try; to
return to Lineclear, `herdr plugin install eliasstravik/herdr-projects --yes`.

## Updates

Lineclear keeps itself up to date. When its own checkout moves to a new commit (a task merged into main), it makes a
release of that commit in `.releases/`: a frozen copy, with `bun install` run only when the lockfile changed, built and
checked there. It then restarts on the release. The server always runs from a
release, never from the checkout, so a later merge can't change what runs; a release that stops as it starts is taken
back. Every open screen then reloads itself to the new version: what you were typing and the files you attached come
back, and it waits until you stop typing, or stop talking to type. A screen reloads only when the
screen itself changed. If an update fails, Lineclear keeps running the last version, says so at the top of every screen
(tap Why for the error) and tries again on the next commit. It follows the checkout herdr links, so a merge on GitHub
arrives once that checkout pulls it; `lineclear merge` pulls main there itself after merging a pull request. A change to
the updater itself (`scripts/supervise.ts` and what it imports) starts it again on the new code, with the server, once
that release is past its trial.

By hand: `bun run build && bun server/main.ts` serves on `http://127.0.0.1:7421` (`LINECLEAR_PORT` to change it).
