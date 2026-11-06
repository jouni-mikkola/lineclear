import type { Settings } from "./project.ts";
import type { World } from "./world.ts";

/**
 * The world the rules of one project act on. A paused project's tasks are not written to or started, and a task the
 * owner stopped is not written to either, because a write starts it again. A refusal comes back as the error text, as any failed tell does.
 */
export function holdWorld(world: World, settings: Settings): World {
  const stopped = new Set<string>();
  const tasks = world.tasks(settings.space);
  if (typeof tasks !== "string") for (const t of tasks) if (t.stopped && t.id) stopped.add(t.id);
  const why = (id: string) => (settings.paused ? "the project is paused" : stopped.has(id) ? `${id} was stopped by the owner` : undefined);
  const held = Object.create(world) as World;
  held.tellTask = (id, text, kind) => why(id) ?? world.tellTask(id, text, kind);
  held.stopTask = (id) => why(id) ?? world.stopTask(id);
  held.nudge = (id, text) => why(id) ?? world.nudge(id, text);
  held.addTask = (...a) => (settings.paused ? "the project is paused" : world.addTask(...a));
  if (world.addTaskOn) held.addTaskOn = (...a) => (settings.paused ? "the project is paused" : world.addTaskOn?.(...a));
  return held;
}
