import type { TaskView } from "./taskMonitor";

/**
 * Which tasks get an icon on the screen edge: those seen running while the app was open,
 * until the user dismisses them. A task that was already over when the app first saw it
 * is history, not news -- fifty old checkmarks floating over the desktop would bury the
 * one that just finished.
 */
export class DockTasks {
  private readonly seenRunning = new Set<string>();
  private readonly dismissed = new Set<string>();

  /** The monitor's full list in, the docked ones out, oldest first so new icons join the end. */
  select(tasks: TaskView[]): TaskView[] {
    for (const task of tasks) {
      if (task.status === "running" || task.status === "needs_approval") this.seenRunning.add(task.id);
    }
    return tasks
      .filter((task) => this.seenRunning.has(task.id) && !this.dismissed.has(task.id))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Only a finished task can be put away; a running one -- or one waiting on the user --
   *  would vanish mid-work. */
  dismiss(id: string, tasks: TaskView[]): boolean {
    const task = tasks.find((candidate) => candidate.id === id);
    if (!task || task.status === "running" || task.status === "needs_approval") return false;
    this.dismissed.add(id);
    return true;
  }

  reset(): void {
    this.seenRunning.clear();
    this.dismissed.clear();
  }
}
