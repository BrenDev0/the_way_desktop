import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitTools } from "../../src/core/tools/git";
import { NodeFileSystem } from "../../src/main/nodeFileSystem";
import { NodeGit } from "../../src/main/nodeGit";

// The real git against throwaway repositories. Skipped on a machine without git.
const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString();

let base: string;
let work: string;
let remote: string;
let saved: NodeJS.ProcessEnv;

beforeEach(async () => {
  saved = { ...process.env };
  base = await mkdtemp(join(tmpdir(), "the-way-git-"));
  work = join(base, "work");
  remote = join(base, "remote.git");
  await mkdir(work);
  execFileSync("git", ["init", "--bare", "-b", "main", remote], { stdio: "ignore" });
  sh(work, "init", "-b", "main");
  sh(work, "remote", "add", "origin", remote);
});

afterEach(async () => {
  process.env = saved;
  await rm(base, { recursive: true, force: true });
});

const toolsFor = (folder: string | null) => gitTools(new NodeGit(async () => folder), new NodeFileSystem(async () => folder));

/** The user's own git setup, which the tests stand in for with the repository's config. */
function signedInAs(folder: string): void {
  sh(folder, "config", "user.name", "Test");
  sh(folder, "config", "user.email", "test@example.com");
}

describe.skipIf(!hasGit)("the git tools over real git", () => {
  it("status, add, commit and push, end to end", async () => {
    signedInAs(work);
    const tools = toolsFor(work);
    await writeFile(join(work, "a.txt"), "hello\n");

    expect(await tools.GitStatus.run({})).toContain("?? a.txt");
    expect(await tools.GitAdd.run({ paths: ["a.txt"] })).toContain("A  a.txt");
    expect(await tools.GitCommit.run({ message: "Add a" })).toContain("Add a");
    expect(await tools.GitLog.run({})).toContain("Add a");

    await tools.GitPush.run({ remote: "origin", branch: "main", set_upstream: true });
    expect(sh(remote, "log", "--oneline")).toContain("Add a");
    expect(await tools.GitStatus.run({})).toContain("working tree clean");
  });

  it("a commit with no identity explains how the user sets one up", async () => {
    // what a machine that never set git up has: no global, system or environment identity
    process.env.GIT_CONFIG_GLOBAL = join(base, "no-such-config");
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    process.env.GIT_AUTHOR_NAME = "";
    process.env.GIT_AUTHOR_EMAIL = "";
    process.env.GIT_COMMITTER_NAME = "";
    process.env.GIT_COMMITTER_EMAIL = "";
    process.env.EMAIL = "";
    sh(work, "config", "user.useConfigOnly", "true");

    await writeFile(join(work, "a.txt"), "x\n");
    const tools = toolsFor(work);
    await tools.GitAdd.run({ paths: ["a.txt"] });
    await expect(tools.GitCommit.run({ message: "m" })).rejects.toThrow(/git config --global user\.(name|email)/);
  });

  it("a push that cannot reach its remote tells the agent what to tell the user", async () => {
    signedInAs(work);
    await writeFile(join(work, "a.txt"), "x\n");
    const tools = toolsFor(work);
    await tools.GitAdd.run({ paths: ["a.txt"] });
    await tools.GitCommit.run({ message: "m" });
    sh(work, "remote", "set-url", "origin", join(base, "nowhere.git"));
    await expect(tools.GitPush.run({ remote: "origin", branch: "main" })).rejects.toThrow(/set up their own git access|no remote/);
  });

  it("a folder that is not a repository says so", async () => {
    const plain = join(base, "plain");
    await mkdir(plain);
    await expect(toolsFor(plain).GitStatus.run({})).rejects.toThrow(/not a git repository/);
  });

  it("does not use a repository above the open folder", async () => {
    const inner = join(work, "inner");
    await mkdir(inner);
    // `work` is a repository; `inner` is not one and must not borrow it
    await expect(toolsFor(inner).GitStatus.run({})).rejects.toThrow(/not a git repository/);
  });

  it("with no folder open, asks the user to choose one", async () => {
    await expect(toolsFor(null).GitStatus.run({})).rejects.toThrow(/No folder is open/);
  });

  it("without git on the PATH, says git is not installed", async () => {
    process.env.PATH = join(base, "empty");
    process.env.Path = join(base, "empty");
    await expect(toolsFor(work).GitStatus.run({})).rejects.toThrow(/Git is not installed/);
  });
});
