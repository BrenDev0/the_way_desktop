import { describe, expect, it } from "vitest";
import { MAX_OUTPUT, MAX_TIMEOUT_SECONDS, commandTools } from "../../src/core/tools/command";
import { mustAsk } from "../../src/core/tools/autoApprovals";
import { REQUIRES_APPROVAL } from "../../src/core/tools/contract";
import type { CommandPort, CommandResult } from "../../src/core/tools/ports";

class FakeShell implements CommandPort {
  readonly shell = "bash";
  readonly ran: { command: string; timeoutMs: number }[] = [];
  constructor(
    private readonly result: Partial<CommandResult> = {},
    private readonly open: string | null = "/work/project",
  ) {}
  async folder() {
    return this.open;
  }
  async run(command: string, timeoutMs: number): Promise<CommandResult> {
    this.ran.push({ command, timeoutMs });
    return { code: 0, stdout: "", stderr: "", timedOut: false, ...this.result };
  }
}

const tool = (shell: CommandPort) => commandTools(shell).RunCommand;

describe("RunCommand", () => {
  it("runs the command and reports it, the shell, the exit code and what it printed", async () => {
    const shell = new FakeShell({ stdout: "v22.1.0\n" });

    const out = await tool(shell).run({ command: "node --version" });

    expect(shell.ran).toEqual([{ command: "node --version", timeoutMs: 60_000 }]);
    expect(out).toContain("$ node --version");
    expect(out).toContain("(shell: bash)");
    expect(out).toContain("exit code: 0");
    expect(out).toContain("v22.1.0");
  });

  it("says so when there was no output", async () => {
    expect(await tool(new FakeShell()).run({ command: "true" })).toContain("(no output)");
  });

  it("is a failed call when the command fails, with what it printed, so the model knows", async () => {
    const shell = new FakeShell({ code: 2, stderr: "fatal: not a git repository" });

    await expect(tool(shell).run({ command: "git status" })).rejects.toThrow(/exit code: 2[\s\S]*not a git repository/);
  });

  it("is a failed call, and says it was ended, when it ran past its limit", async () => {
    const shell = new FakeShell({ code: null, timedOut: true, stdout: "partial" });

    await expect(tool(shell).run({ command: "sleep 999", timeout_seconds: 5 })).rejects.toThrow(
      /STOPPED: it ran longer than 5 seconds[\s\S]*partial/,
    );
    expect(shell.ran[0].timeoutMs).toBe(5_000);
  });

  it("never lets the limit be raised past ten minutes", async () => {
    const shell = new FakeShell();

    await tool(shell).run({ command: "build", timeout_seconds: 99_999 });

    expect(shell.ran[0].timeoutMs).toBe(MAX_TIMEOUT_SECONDS * 1000);
  });

  it("keeps the end of a very long output, which is where it says how it went", async () => {
    const long = `${"x".repeat(MAX_OUTPUT)}THE END`;

    const out = await tool(new FakeShell({ stdout: long })).run({ command: "build" });

    expect(out).toContain("THE END");
    expect(out).toContain("characters were cut");
    expect(out.length).toBeLessThan(MAX_OUTPUT + 500);
  });

  it("refuses an empty command and one that is not text", async () => {
    await expect(tool(new FakeShell()).run({ command: "   " })).rejects.toThrow(/empty/);
    await expect(tool(new FakeShell()).run({})).rejects.toThrow(/required/);
    await expect(tool(new FakeShell()).run({ command: "a\0b" })).rejects.toThrow(/null character/);
    await expect(tool(new FakeShell()).run({ command: "x".repeat(9_000) })).rejects.toThrow(/longer than/);
  });
});

describe("what the user is shown before they approve", () => {
  it("is the whole command, the folder, the shell, the limit, and a warning that it is not fenced to the folder", async () => {
    const preview = (await tool(new FakeShell()).preview!({ command: "git push origin main", timeout_seconds: 30 }))!;

    expect(preview.split("\n")[0]).toBe("git push origin main");
    expect(preview).toContain("Carpeta: /work/project");
    expect(preview).toContain("bash");
    expect(preview).toContain("30 s");
    expect(preview).toMatch(/no solo esa carpeta/);
  });

  it("says plainly when no folder is open", async () => {
    expect(await tool(new FakeShell({}, null)).preview!({ command: "ls" })).toContain("(ninguna abierta)");
  });
});

describe("how it is approved", () => {
  it("always asks: it is in the approval list and in auto mode it still asks", () => {
    expect(REQUIRES_APPROVAL.has("RunCommand")).toBe(true);
    expect(
      mustAsk({ id: "c", name: "RunCommand", args: {}, location: "desktop", requiresApproval: true, detail: null }),
    ).toBe(true);
  });
});
