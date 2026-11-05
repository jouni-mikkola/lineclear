# Import a roadmap file

A project with its plan in another file does not start over. Turn the plan into a JSON list of steps and run:

    lineclear roadmap import plan.json <repo>

This writes `docs/ROADMAP.md` in the format at the top of [ROADMAP.md](ROADMAP.md) and commits it. It refuses to
replace an existing roadmap without `--force`. With `--no-commit` it only writes the file and prints the commit
message to use.

## Shape

The file is a list of steps, or an object with a `steps` list. Steps are written in order. A new `phase` starts a new
phase heading.

| field       | meaning                                                          |
| ----------- | ---------------------------------------------------------------- |
| `id`        | one word, no spaces or commas, not `none`; unique               |
| `title`     | one line, at most 32 characters, naming the result               |
| `result`    | one sentence, at most 140 characters: what a user can do or see  |
| `phase`     | one line, such as `Phase 0: Base`                                |
| `state`     | `open`, `done` or `dropped`                                      |
| `why`       | one line                                                         |
| `done_when` | one line, or a list of lines                                     |
| `locks`     | one line                                                         |
| `after`     | a list of ids, or `["none"]`                                     |
| `reason`    | only for `dropped`; without it the reason is "imported as dropped" |

## Example

```json
[
  {
    "id": "A1",
    "title": "Set up the repo",
    "phase": "Phase 0: Base",
    "state": "done",
    "result": "A new step has a place to land.",
    "why": "Every step needs a place to land.",
    "done_when": ["The check passes."],
    "locks": "repo",
    "after": ["none"]
  },
  {
    "id": "A2",
    "title": "Add login",
    "phase": "Phase 1: Users",
    "state": "open",
    "result": "People can sign in.",
    "why": "People need to sign in.",
    "done_when": ["A user signs in.", "A wrong password is refused."],
    "locks": "auth",
    "after": ["A1"]
  },
  {
    "id": "A3",
    "title": "Add a second theme",
    "phase": "Phase 1: Users",
    "state": "dropped",
    "reason": "One theme is enough.",
    "result": "People can pick a light theme.",
    "why": "Some people like light.",
    "done_when": "Both themes work.",
    "locks": "ui",
    "after": ["A1"]
  }
]
```

## Done steps

A done step has no mark in the file, because done comes from commits on main. The import commit therefore has a
line `Step: A1` for each done step. If the commit is squash merged, keep those lines in the squash message.

## Errors

A field the import cannot place stops it with the step id and the field, for example
`step A2, field after: needs a list of ids, or ["none"]`. Nothing is written. The result must also pass
`lineclear roadmap check`: an unknown or circular `after` stops the import.
