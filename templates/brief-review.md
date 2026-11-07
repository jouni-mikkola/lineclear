Review before the merge, unless your change touches only files under docs/ (a roadmap file too) and passed the check (then it needs no review): have the change reviewed by fresh eyes using the model {{reviewer}}, {{reviewer_note}}.
Run `lineclear review {{id}}` in your worktree: it is one model call with no tools that gets this brief, the diff against the base and the repo's rules, and stores the tagged findings as JSON. It replaces starting a reviewer agent.
The reviewer reads the change against the why and the done-when above. Review the diff once and fix every
critical and major finding. Review again only when a critical finding was fixed, for at most {{rounds}} rounds in all.
The reviewer reads only the diff; it does not run the full check. A finding still open after that makes
this step stop: decide it yourself by the written rule (merge when only minor or trivial findings are left, and list them in your facts). The owner is never asked a step question.
When the call answers a usage or quota limit (429), never ask the owner: run it again with `--model <provider/model>` of another reviewer yourself (no one will
message you about it), and say so in the pull request. Run it once per round.

Writing: Commit messages, pull request titles and bodies, review comments and changelog lines: short plain English, one point per line, no en or em dashes, no semicolons, and none of these words: across, leverage, robust, seamless, delve, comprehensive, ensure.
