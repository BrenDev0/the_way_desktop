import { describe, expect, it } from "vitest";
import { explain, gitTools } from "../../src/core/tools/git";
import type { GitPort, GitResult } from "../../src/core/tools/ports";
import { MemoryFileSystem } from "../support/memoryFileSystem";

/** Answers each call in turn and remembers what was asked. */
class FakeGit implements GitPort {
  readonly calls: { args: string[]; network: boolean }[] = [];
  constructor(private readonly answers: Partial<GitResult>[] = []) {}
  async run(args: string[], options: { network?: boolean } = {}): Promise<GitResult> {
    this.calls.push({ args, network: options.network === true });
    return { code: 0, stdout: "", stderr: "", ...(this.answers.shift() ?? {}) };
  }
}

const tools = (git: GitPort) => gitTools(git, new MemoryFileSystem());
const fail = (stderr: string, code = 128): Partial<GitResult> => ({ code, stderr });

describe("reading", () => {
  it("GitStatus reports a clean tree in words", async () => {
    const git = new FakeGit([{ stdout: "## main...origin/main\n" }]);
    expect(await tools(git).GitStatus.run({})).toContain("working tree clean");
    expect(git.calls[0].args).toEqual(["status", "--porcelain=v1", "--branch"]);
  });

  it("GitStatus shows changes and the ahead/behind header untouched", async () => {
    const out = await tools(new FakeGit([{ stdout: "## main...origin/main [ahead 2]\n M a.txt\n?? b.txt\n" }])).GitStatus.run({});
    expect(out).toContain("[ahead 2]");
    expect(out).toContain("?? b.txt");
  });

  it("GitLog caps the limit and keeps the path after --", async () => {
    const git = new FakeGit([{ stdout: "abc1234 2026-10-01 Ana  first" }]);
    await tools(git).GitLog.run({ limit: 5000, path: "src/a.ts" });
    expect(git.calls[0].args).toContain("--max-count=100");
    expect(git.calls[0].args.slice(-2)).toEqual(["--", "src/a.ts"]);
  });

  it("GitDiff never lets a repository pick the diff program", async () => {
    const git = new FakeGit([{ stdout: "diff --git" }]);
    await tools(git).GitDiff.run({ staged: true });
    expect(git.calls[0].args).toEqual(["diff", "--no-ext-diff", "--no-textconv", "--cached"]);
  });

  it("GitDiff cuts a huge diff and says so", async () => {
    const out = await tools(new FakeGit([{ stdout: "x".repeat(50_000) }])).GitDiff.run({});
    expect(out.length).toBeLessThan(31_000);
    expect(out).toContain("cut at 30,000");
  });

  it("GitShow refuses a revision that would be read as an option", async () => {
    await expect(tools(new FakeGit()).GitShow.run({ revision: "--output=/etc/x" })).rejects.toThrow(/cannot start with '-'/);
  });

  it("GitFetch gets the longer network time", async () => {
    const git = new FakeGit();
    await tools(git).GitFetch.run({});
    expect(git.calls[0]).toEqual({ args: ["fetch"], network: true });
  });
});

describe("paths", () => {
  it("refuses a path outside the open folder and git's pathspec magic", async () => {
    await expect(tools(new FakeGit()).GitAdd.run({ paths: ["../elsewhere"] })).rejects.toThrow(/outside/);
    await expect(tools(new FakeGit()).GitAdd.run({ paths: [":(top)x"] })).rejects.toThrow(/plain path/);
    await expect(tools(new FakeGit()).GitLog.run({ path: "C:\\x" })).rejects.toThrow(/absolute/);
  });

  it("GitAdd needs a list of paths and puts them after --", async () => {
    await expect(tools(new FakeGit()).GitAdd.run({})).rejects.toThrow(/list of paths/);
    const git = new FakeGit();
    await tools(git).GitAdd.run({ paths: ["a.txt", "docs/"] });
    expect(git.calls[0].args).toEqual(["add", "--", "a.txt", "docs"]);
  });
});

describe("writing", () => {
  it("GitCommit passes the message as one argument, not through a shell", async () => {
    const git = new FakeGit([{ stdout: "[main abc] x\n" }]);
    await tools(git).GitCommit.run({ message: 'fix "quotes"; rm -rf /' });
    expect(git.calls[0].args).toEqual(["commit", "-m", 'fix "quotes"; rm -rf /']);
    await expect(tools(new FakeGit()).GitCommit.run({ message: "  " })).rejects.toThrow(/empty/);
  });

  it("GitPush builds only the push it was asked for: never forced", async () => {
    const git = new FakeGit([{ stderr: "To origin\n  a..b  main -> main" }]);
    expect(await tools(git).GitPush.run({ remote: "origin", branch: "main", set_upstream: true })).toContain("main -> main");
    expect(git.calls[0]).toEqual({ args: ["push", "--set-upstream", "origin", "main"], network: true });
    for (const args of git.calls.map((c) => c.args)) {
      expect(args.join(" ")).not.toMatch(/force|-f\b|--delete|--mirror/);
    }
  });

  it("GitPush refuses a remote that would be read as an option", async () => {
    await expect(tools(new FakeGit()).GitPush.run({ remote: "--force" })).rejects.toThrow(/cannot start with '-'/);
  });

  it("the approval shows the message and what is staged, and the commits a push sends", async () => {
    const commit = await tools(new FakeGit([{ stdout: " a.txt | 1 +" }])).GitCommit.preview!({ message: "Add a" });
    expect(commit).toContain("Add a");
    expect(commit).toContain("a.txt | 1 +");
    const push = await tools(new FakeGit([{ stdout: "abc1234 Add a" }])).GitPush.preview!({});
    expect(push).toContain("Commits that will be sent:");
    expect(push).toContain("abc1234 Add a");
  });
});

describe("when the user's git is not set up", () => {
  const cases: [string, string, RegExp][] = [
    ["not a repository", "fatal: not a git repository (or any of the parent directories): .git", /not a git repository/],
    ["no identity", "fatal: unable to auto-detect email address (got 'x@y.(none)')", /git config --global user.name/],
    ["no identity (older wording)", "*** Please tell me who you are.", /git config --global user.email/],
    ["no remote", "fatal: No configured push destination.", /no remote/],
    ["no credentials", "fatal: could not read Username for 'https://github.com': terminal prompts disabled", /never holds their password/],
    ["ssh key missing", "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.", /set up their own git access/],
    ["wrong account", "remote: Permission to a/b.git denied to someone.\nfatal: unable to access", /set up their own git access/],
    ["never pushed", "fatal: The current branch topic has no upstream branch.", /set_upstream/],
    ["behind the remote", " ! [rejected]        main -> main (fetch first)", /remote has commits this computer does not/],
  ];
  it.each(cases)("%s -> tells the agent what to tell the user", (_label, stderr, expected) => {
    expect(explain({ code: 128, stdout: "", stderr })).toMatch(expected);
  });

  it("nothing staged is read from stdout, where git prints it", () => {
    expect(explain({ code: 1, stdout: "nothing to commit, working tree clean", stderr: "" })).toMatch(/Nothing is staged/);
  });

  it("an unknown failure still carries git's own words", async () => {
    await expect(tools(new FakeGit([fail("fatal: something odd", 2)])).GitStatus.run({})).rejects.toThrow(/exit 2.*something odd/);
  });

  it("a failed push is an error the agent reads, not a success", async () => {
    await expect(
      tools(new FakeGit([fail("fatal: could not read Username for 'https://github.com'")])).GitPush.run({}),
    ).rejects.toThrow(/set up/);
  });
});
