import { WorkerIcon } from "./roles.tsx";

// What a task's chat shows around its thread: its own head, and a note for an empty or missing chat.

type TaskState = "loading" | "ready" | "writing" | "offline" | "none";

/** Who you talk to in a task's chat: its agent, the task's id, and what it does now. */
export function TaskHead({ id, title, state }: { id: string; title?: string; state: TaskState }) {
  return (
    <div className="flex items-center gap-3" data-task-head={state}>
      <span className="grid size-10 shrink-0 place-items-center rounded-full border border-line bg-raised">
        <WorkerIcon size={22} className={state === "offline" || state === "none" ? "text-fg3" : "text-accent"} />
      </span>
      <div className="min-w-0">
        <h1 className="break-words text-lg font-semibold leading-6 text-fg">{title ? `${id} ${title}` : id}</h1>
        <p className="flex items-center gap-1.5 text-sm text-fg3">
          {state === "writing" && <span className="size-1.5 rounded-full bg-caution" aria-hidden="true" />}
          {TASK_LINE[state]}
        </p>
      </div>
    </div>
  );
}

const TASK_LINE: Record<TaskState, string> = {
  loading: "Connecting",
  ready: "Its agent",
  writing: "Writing",
  offline: "Offline",
  none: "No chat",
};

/** A task's chat with nothing in it: no messages yet, or no chat at all. */
export function TaskNote({ text, none }: { text: string; none?: boolean }) {
  return (
    <div className="flex flex-col items-center px-2 py-10 text-center sm:py-16" data-task-note={none ? "none" : "empty"}>
      <span className="grid size-16 place-items-center rounded-full border border-line bg-raised">
        <WorkerIcon size={34} className={none ? "text-fg3" : "text-accent"} />
      </span>
      <p className="mt-6 max-w-sm text-fg2">{text}</p>
    </div>
  );
}
