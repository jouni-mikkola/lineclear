import type { ReactNode } from "react";
import { STAGE_WORD, stageOf } from "./line-parts.tsx";
import type { Task } from "./parts.tsx";
import { WorkerIcon } from "./roles.tsx";
import { Shape } from "./shapes.tsx";

// What a task's chat shows around its thread: its one header, and a note for an empty or missing chat.

/** What a task page names it by: the one header, with the tabs beneath it as its children. */
export function TaskHead({ id, task, children }: { id: string; task?: Task; children?: ReactNode }) {
  const facts = task ? [STAGE_WORD[stageOf(task)], task.step, task.model].filter((f): f is string => !!f) : [];
  return (
    <header className="pt-6" data-task-head={task ? task.state : "unknown"}>
      <h1 className="break-words text-lg font-semibold leading-6 text-fg">{task ? `${id} ${task.title}` : id}</h1>
      {task && (
        <p className="mt-1 flex min-w-0 items-center gap-2 text-sm text-fg3" data-task-facts>
          <Shape state={task.state} />
          <span className="min-w-0 break-words">{facts.join(" · ")}</span>
        </p>
      )}
      {children}
    </header>
  );
}

/** A task id nothing on this machine has: where to go instead. */
export function TaskNotFound({ id }: { id: string }) {
  return (
    <div className="flex flex-col items-center px-2 py-16 text-center" data-task-missing={id}>
      <h1 className="text-lg font-semibold text-fg">No task {id}</h1>
      <p className="mt-2 max-w-sm text-fg2">Lineclear knows no such task on this machine.</p>
      <a href="/" className="mt-6 text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent">
        Home
      </a>
    </div>
  );
}

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
