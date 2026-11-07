---
name: find-docs
description: Looks up current documentation for a library, framework, CLI or API before code relies on it. Use for API signatures, options, versions, setup and migration questions, even for well-known libraries.
---

# Find current docs

Your memory of an API may be out of date. Look it up first, in this order:

1. The project itself: its lock file names the version, and `node_modules/<name>/README.md`, its types
   (`*.d.ts`) or the package's docs folder say what that version does.
2. Context7, when the network allows it: `npx ctx7@latest library <name> "<question>"` gives library ids, then
   `npx ctx7@latest docs <id> "<question>"` gives the docs. At most three calls per question.
3. The library's own website or repository, with the web tools you have.

Quote the version you read about in your facts when it decided something.
