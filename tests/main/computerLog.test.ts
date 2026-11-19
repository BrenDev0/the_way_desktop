import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ComputerLog } from "../../src/main/computerLog";

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "the-way-log-"));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

function logAt(times: string[]) {
  const queue = [...times];
  return new ComputerLog(base, () => new Date(queue.shift() ?? "2026-11-19T12:00:00Z"));
}

describe("ComputerLog", () => {
  it("lists what was done, newest first, with when", async () => {
    const log = logAt(["2026-11-19T10:00:00Z", "2026-11-19T10:05:00Z"]);
    await log.claim("ana");
    await log.append({ tool: "SearchComputer", detail: '"acme"', ok: true });
    await log.append({ tool: "ReadComputerFile", detail: "Documentos/acme.txt", ok: false, note: "binary" });

    expect(await log.recent()).toEqual([
      { at: "2026-11-19T10:05:00.000Z", tool: "ReadComputerFile", detail: "Documentos/acme.txt", ok: false, note: "binary" },
      { at: "2026-11-19T10:00:00.000Z", tool: "SearchComputer", detail: '"acme"', ok: true },
    ]);
  });

  it("is kept between runs for the same account", async () => {
    const first = new ComputerLog(base);
    await first.claim("ana");
    await first.append({ tool: "ReadComputerFile", detail: "a.txt", ok: true });

    const again = new ComputerLog(base);
    await again.claim("ana");

    expect((await again.recent()).map((entry) => entry.detail)).toEqual(["a.txt"]);
  });

  it("starts another account with an empty record", async () => {
    const first = new ComputerLog(base);
    await first.claim("ana");
    await first.append({ tool: "ReadComputerFile", detail: "a.txt", ok: true });

    const next = new ComputerLog(base);
    await next.claim("bob");

    expect(await next.recent()).toEqual([]);
    const reread = new ComputerLog(base);
    await reread.claim("bob");
    expect(await reread.recent()).toEqual([]);
  });

  it("can be cleared by the person it belongs to", async () => {
    const log = new ComputerLog(base);
    await log.claim("ana");
    await log.append({ tool: "ReadComputerFile", detail: "a.txt", ok: true });

    await log.clear();

    expect(await log.recent()).toEqual([]);
    const again = new ComputerLog(base);
    await again.claim("ana");
    expect(await again.recent()).toEqual([]);
  });

  it("keeps the latest 500 and drops the oldest", async () => {
    const log = new ComputerLog(base);
    await log.claim("ana");
    for (let i = 0; i < 505; i += 1) await log.append({ tool: "ReadComputerFile", detail: `f${i}`, ok: true });

    const recent = await log.recent(1000);

    expect(recent).toHaveLength(500);
    expect(recent[0].detail).toBe("f504");
    expect(recent[499].detail).toBe("f5");
  });

  it("limits how many it hands back", async () => {
    const log = new ComputerLog(base);
    await log.claim("ana");
    for (let i = 0; i < 5; i += 1) await log.append({ tool: "ReadComputerFile", detail: `f${i}`, ok: true });

    expect((await log.recent(2)).map((entry) => entry.detail)).toEqual(["f4", "f3"]);
  });

  it("does not lose entries written at the same moment", async () => {
    const log = new ComputerLog(base);
    await log.claim("ana");

    await Promise.all(Array.from({ length: 20 }, (_, i) => log.append({ tool: "SearchComputer", detail: `q${i}`, ok: true })));

    expect(await log.recent()).toHaveLength(20);
  });
});
