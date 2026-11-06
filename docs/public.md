# Publishing Lineclear as a new repository

The history of this repository holds machine names, paths, addresses and working notes. It must not go public. The public
repository is a new one, with one fresh first commit made from a clean export of the current tree. These steps make
nothing public by themselves: the owner runs the last two.

1. **Check the working tree.** `bun run check` passes, and `bun scripts/personal-scan.ts` prints nothing.
2. **Export.** From a clean checkout of main:

       bun scripts/public-tree.ts ../lineclear-public

   The export holds every tracked file but the working notes (the list is `PRIVATE` in `scripts/public-tree.ts`), has
   `docs/public-roadmap.md` as `docs/ROADMAP.md`.
3. **Scan the export.** `cd ../lineclear-public && git init -b main && git add -A`, then `bun scripts/personal-scan.ts`.
   It must print nothing. Read `git diff --cached --name-only` once by eye.
4. **One commit.** `git commit -m "Lineclear"` with an author the owner chooses for the public
   (`git -c user.name=... -c user.email=... commit`). `git log` must show one commit, with only that address.
5. **Create the new repository** on the host (empty, no README), add it as `origin` and push `main` to it. The old
   repository stays private; its history is never sent anywhere public.
6. **After publishing**, check the README install line
   (`curl -fsSL https://raw.githubusercontent.com/<owner>/lineclear/main/install.sh | sh`) on a fresh machine.

The export is a snapshot. Tests that read the maintainers' working notes (the detailed roadmap and `docs/numbers.md`) fail
in it; keep developing in the private repository and export again for each public release.
