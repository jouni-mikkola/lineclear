# Current model and effort

The composer + menu shows CLI observations (`Chat.agent.runtime`). `Chat.agent.model` and `effort` remain the selected
launch policy; missing/default values still inherit the CLI configuration. Restart's `on` and `want` retain their
existing meaning. Neither Settings nor Lineclear's model catalog fills a missing runtime observation.

Both coordinator and task chats use the same path. Observations are tied to the active transcript and this launch's
start time. Old logs cannot supply a new launch's values.

## Sources and limits

- **Pi:** the main assistant response’s `message.model`, plus `model_change.modelId` and `thinking_level_change.thinkingLevel`, including `off`. Separate events merge
  within that session. These record CLI configuration rather than guessing from the chosen model.
  **Resume limitation:** Pi restores saved model/thinking state without appending initial settings events for an
  existing session (`createAgentSession`, upstream `sdk.ts`, initial-entry block guarded by `!hasExistingSession`).
  Old pre-launch events cannot prove that CLI/config overrides did not change it. After a resume, the model is
  observable on the next assistant response; effort remains **Not reported** until a new thinking-level event.
  A picker change without an event is likewise not observable. Full resumed-Pi effort support is not claimed.
  [Pi startup source](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/sdk.ts).
- **Other Herdr agent kinds:** Herdr's `AgentInfo` reports kind, status and session identity/path, not model/effort.
  Their transcript formats are not implemented here: **Not reported**. Lack of a reader does not prove that effort
  is unsupported. `effortUnsupported` is reserved for a provider's explicit unsupported report; it renders
  **Not supported**, never an invented effort level.

No CLI configuration files, secrets or auth files are read.
