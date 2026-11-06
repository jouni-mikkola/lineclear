Review before the merge, unless your change touches only files under docs/ (a roadmap file too) and passed the check (then it needs no review): have the change reviewed by fresh eyes using the model {{reviewer}}, {{reviewer_note}}.
The reviewer reads the change against the why and the done-when above. It fails a change that makes a Health number of docs/numbers.md
worse (`lineclear measure <project> --since <day>` prints them). Fix every
critical and major finding, then review again, for at most {{rounds}} rounds (one round when the diff is under 150 lines and touches neither the rules nor the server core).
The reviewer reads the diff and your `--changed` result; it does not run the full check. A finding still open after that makes
this step stop: decide it yourself by the written rule (merge when only minor or trivial findings are left, and list them in your facts). The owner is never asked a step question.
When a reviewer answers a usage or quota limit (429), never ask the owner: pick the next reviewer yourself (no one will
message you about it): a model from another company that pi offers, or another model of your own company with a fresh context, and say so in the pull request.
Start the reviewer's prompt with the line `LINECLEAR_CHAT="{{id}}/Reviewer"` and, on the next line, `review round N`: `lineclear measure` prices the review from them.

Writing: Commit messages, pull request titles and bodies, review comments and changelog lines: short plain English, one point per line, no en or em dashes, no semicolons, and none of these words: across, leverage, robust, seamless, delve, comprehensive, ensure.
