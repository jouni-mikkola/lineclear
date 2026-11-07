# The page server's routes

The routes are in `src/web-routes.ts`. All answer JSON. A POST must come from Lineclear's own pages.

- `GET /api/home`, `GET /api/roadmap/<project>`, `GET /api/plans`: the data the views read, with no AI. `GET /api/plans` lists each plan started with `lineclear plan`, newest first: its goal, where it stands, the steps it adds and its open Inbox item.
- `GET /api/inbox` lists what waits for you: open items newest first, then waiting tasks. `POST /api/inbox/<n>` with `{"choice": "...", "note": "..."}` answers one (the note is a plan's reason to reject).
- `GET /api/browsers` lists the agents' open browser sessions. `GET /api/browsers/<session>/picture` is a live picture of one (`?size=thumb` a small one for a card, served from memory). `POST /api/browsers/<session>/take` with `{"take": true}` takes one over (false gives it back). `POST /api/browsers/<session>/input` sends a click, text, a key or a scroll to one taken over.
- `GET /api/detect?repo=<folder>` gives what `lineclear project add` finds in a folder. `POST /api/projects` with `{repo, name, space, check, models}` saves it where the CLI does.
- `GET /api/setup` gives the harnesses and accounts found and the model chosen per role. `POST /api/setup` saves a choice where `lineclear setup` does.
- `GET /api/settings` gives each project's settings with its secret names, never their values. `POST /api/projects/<name>` changes a project's commands, Running or Paused (`{"paused": true}`), or the order of a role's models, in the files the CLI writes.
- `GET /api/chat/events` streams the Dispatcher's chat as server-sent events. `POST /api/chat` with `{"text": "...", "files": [ids], "cid": "..."}` sends it a message. `POST /api/chat/files` with `{"name": "...", "data": base64}` attaches a file and gives its id. `GET /api/chat/file?path=` reads a file of the chat. `GET /api/chat/image?path=` shows an image the Dispatcher names from its own folders. `POST /api/chat/answer` with `{"question": id, "choice": n}` answers a card the Dispatcher asked with.
- `/api/task/<id>/chat` and its `/events`, `/file`, `/image`, `/files` and `/answer` are the same for the chat of one task with its agent.

Projects are read again at most once a second. The slow reads run aside, in a process of their own, and answer with the last value while a new one is read: each roadmap at most once a second (one older than a minute is waited for).
