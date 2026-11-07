import { useState } from "react";
import { DispatcherIcon } from "./roles.tsx";

const SETUP_COMMAND = "lineclear dispatcher setup";

/** The chat when no Dispatcher is set up: what it does, and the one command that makes it. */
export function NoDispatcher() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(SETUP_COMMAND).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="flex flex-col items-center px-2 py-10 text-center" data-chat-none>
      <span className="grid size-16 place-items-center rounded-full border border-line bg-raised">
        <DispatcherIcon size={34} className="text-fg3" />
      </span>
      <p className="mt-6 max-w-sm text-fg">The Dispatcher takes your requests, answers about every project and hands the work to its project's line.</p>
      <div className="mt-6 flex w-full max-w-sm items-center gap-2 rounded-lg border border-line bg-raised p-1.5 pl-4">
        <code className="min-w-0 flex-1 truncate text-left text-sm text-fg" data-setup-command>
          {SETUP_COMMAND}
        </code>
        <button
          type="button"
          onClick={copy}
          className="min-h-11 shrink-0 rounded-md bg-raised2 px-4 text-sm text-fg hover:bg-raised3 focus-visible:outline-2 focus-visible:outline-accent"
          data-copy
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
