import { describe, expect, it } from "vitest";
import { DockTasks } from "../../src/core/tasks/dockTasks";
import type { TaskView } from "../../src/core/tasks/taskMonitor";

function task(id: string, status: TaskView["status"], createdAt = "2026-10-01T10:00:00Z"): TaskView {
  return {
    id, conversationId: "conv", description: id, status, result: null,
    deliverProject: null, deliverPath: null, createdAt, updatedAt: createdAt, steps: [],
  };
}

describe("DockTasks", () => {
  it("docks tasks seen running, not ones already over when the app started", () => {
    const dock = new DockTasks();

    expect(dock.select([task("old", "done"), task("live", "running")]).map((t) => t.id)).toEqual(["live"]);
  });

  it("keeps a task docked after it finishes, until it is dismissed", () => {
    const dock = new DockTasks();
    dock.select([task("t1", "running")]);
    const finished = [task("t1", "done")];

    expect(dock.select(finished).map((t) => t.id)).toEqual(["t1"]);
    expect(dock.dismiss("t1", finished)).toBe(true);
    expect(dock.select(finished)).toEqual([]);
  });

  it("will not dismiss a task that is still running", () => {
    const dock = new DockTasks();
    const running = [task("t1", "running")];
    dock.select(running);

    expect(dock.dismiss("t1", running)).toBe(false);
    expect(dock.select(running).map((t) => t.id)).toEqual(["t1"]);
  });

  it("lists the oldest first, so a new icon joins the end", () => {
    const dock = new DockTasks();

    const docked = dock.select([task("new", "running", "2026-10-01T11:00:00Z"), task("first", "running", "2026-10-01T09:00:00Z")]);

    expect(docked.map((t) => t.id)).toEqual(["first", "new"]);
  });

  it("forgets everything on sign-out", () => {
    const dock = new DockTasks();
    dock.select([task("t1", "running")]);
    dock.reset();

    expect(dock.select([task("t1", "done")])).toEqual([]);
  });
});
