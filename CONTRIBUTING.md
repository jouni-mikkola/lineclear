# Contributing

Thanks for looking. Small, focused changes are easiest to review.

## Set up

You need Linux, `git` and [Bun](https://bun.sh). Then:

```sh
bun install
bun run check
```

`bun run check` runs what your change reaches: types, tests, doc checks, the code gates and the secret and
personal-data scan. It must pass before a change is merged. `bun scripts/check.ts --full` runs everything.

## Rules of the code

- A module owns one job. Code two modules need lives in the lower one ([architecture](docs/architecture.md)).
- Names say what a thing is or does. No dead code, no copied blocks, no unused exports.
- A comment says why, in one short line. No history comments, no task ids.
- Tests use neutral fixtures: `laptop`, `/home/user`, `example.com`. Never a real host, path, address, account or
  e-mail. `bun run scan` fails on a key, a token, a real e-mail and a home folder of a real user.
- Plain English, short sentences. No en or em dashes.

## Sending a change

Open a pull request with what changed and why. Say how you checked it.
