// The one place that names herdr's command line and socket. Every call to herdr in `src/` and `server/` is built here
// (server/server/live/herdr.ts is the socket half of the same adapter); `bun run gates` fails on a herdr command or
// socket anywhere else. On another machine a call is the same call with `--machine <label-or-id>`: herdr forwards it
// over its own saved SSH connection, so Lineclear keeps no script for it.

/** The command for one herdr call, here or, with `machine`, on a machine saved in herdr. */
export const herdrArgv = (args: string[], machine?: string): string[] => ["herdr", ...(machine ? ["--machine", machine] : []), ...args];

/** The command for a call to one named herdr session. */
export const herdrSessionArgv = (session: string, args: string[]): string[] => ["herdr", "--session", session, ...args];

/** Where a named session's socket is, under `home`. */
export const herdrSocketOf = (home: string, session: string): string => `${home}/.config/herdr/sessions/${session}/herdr.sock`;

/** The environment variable that points a child at one herdr socket. */
export const HERDR_SOCKET_ENV = "HERDR_SOCKET_PATH";

/** The variables a detached child keeps: the path, the home, and where herdr and Lineclear live. */
export const KEPT_ENV = /^(PATH|HOME|XDG_.*|LINECLEAR_.*|HERDR_SOCKET_PATH)$/;

/** The version a herdr prints for `--version` or `status server`. */
export const herdrVersionOf = (text: string | null): string | null => text?.match(/^(?:herdr\s+|version:\s*)(\S+)/m)?.[1] ?? null;
