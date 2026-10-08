import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceStore } from "../../src/main/workspaceStore";

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "the-way-workspace-"));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("WorkspaceStore", () => {
  it("keeps the place for the account that chose it", async () => {
    const store = new WorkspaceStore(base);
    await store.claim("alice");
    await store.set(base);
    await store.setRemote("Borradores", "cat-mouse-merida");

    const again = new WorkspaceStore(base);
    expect(await again.claim("alice")).toBe(false);
    expect(await again.place()).toEqual({
      mode: "remote",
      local: base,
      remote: { project: "Borradores", path: "cat-mouse-merida" },
    });
  });

  it("starts another account with nothing of the last one's", async () => {
    const store = new WorkspaceStore(base);
    await store.claim("alice");
    await store.set(base);
    await store.setRemote("Borradores", "cat-mouse-merida");

    const next = new WorkspaceStore(base);
    expect(await next.claim("bob")).toBe(true);
    expect(await next.place()).toEqual({ mode: "local", local: null, remote: null });
    expect(await new WorkspaceStore(base).place()).toEqual({ mode: "local", local: null, remote: null });
  });

  it("treats a place saved before accounts were recorded as someone else's", async () => {
    await writeFile(
      join(base, "workspace.json"),
      JSON.stringify({ folder: base, mode: "remote", remote: { project: "Borradores", path: "cat-mouse-merida" } }),
    );

    const store = new WorkspaceStore(base);
    expect(await store.claim("bob")).toBe(true);
    expect((await store.place()).remote).toBeNull();
  });
});
