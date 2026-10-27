import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commandTools } from "../../src/core/tools/command";
import { NodeCommand } from "../../src/main/nodeCommand";

// The real shell of whatever machine this runs on, in a throwaway folder.
let base: string;
let folder: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "the-way-cmd-"));
  folder = join(base, "work");
  await mkdir(folder);
  await writeFile(join(folder, "hello.txt"), "hi there\n");
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const windows = process.platform === "win32";
const shell = (open: string | null = folder) => new NodeCommand(async () => open);
const run = (command: string, open: string | null = folder) => commandTools(shell(open)).RunCommand.run({ command });

describe("the real shell", () => {
  it("runs a command in the open folder and returns what it printed", async () => {
    const out = await run(windows ? "Get-Content hello.txt" : "cat hello.txt");

    expect(out).toContain("exit code: 0");
    expect(out).toContain("hi there");
  });

  it("starts in the open folder, not where the app runs", async () => {
    const out = await run(windows ? "(Get-Location).Path" : "pwd");

    expect(out.toLowerCase()).toContain("work");
  });

  it("reports a failing command with its exit code and error text", async () => {
    await expect(run(windows ? "exit 3" : "exit 3")).rejects.toThrow(/exit code: 3/);
    await expect(run(windows ? "Get-Content nope.txt" : "cat nope.txt")).rejects.toThrow(/exit code: [1-9]/);
  });

  it("names the shell it used, so the agent writes commands for it", async () => {
    expect(shell().shell).toBe(windows ? "PowerShell (Windows)" : "bash");
    expect(await run("echo hello")).toContain(`(shell: ${shell().shell})`);
  });

  it("does not wait for input: a command that reads stdin finds it closed", async () => {
    const out = await run(windows ? "[Console]::In.ReadLine() -eq $null" : "if read -r line; then echo got-input; else echo no-input; fi");

    expect(out).toMatch(windows ? /True/ : /no-input/);
  });

  it("ends a command that runs past its limit, and says so", async () => {
    const command = windows ? "Start-Sleep -Seconds 30" : "sleep 30";
    const started = Date.now();

    const result = commandTools(shell()).RunCommand.run({ command, timeout_seconds: 1 });

    await expect(result).rejects.toThrow(/STOPPED: it ran longer than 1 seconds/);
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 30_000);

  it("with no folder open, asks the user to choose one", async () => {
    await expect(run("echo hi", null)).rejects.toThrow(/No folder is open/);
  });

  it("when the open folder is gone, says so", async () => {
    await expect(run("echo hi", join(base, "gone"))).rejects.toThrow(/no longer exists/);
  });
});
