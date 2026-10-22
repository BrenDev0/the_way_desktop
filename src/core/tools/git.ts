/**
 * The git tools: the agent's way to look at, stage, commit and push the work in the folder
 * the user opened -- what the kit's drift-check and session-handoff skills need.
 *
 * One tool per thing git is asked to do, never "run this git command": the agent cannot
 * reach a subcommand that is not here (no reset, clean, checkout, force-push), and what it
 * passes in is checked, not handed to a shell. The adapter (src/main/nodeGit.ts) does the
 * running; this file decides what is asked and, when git fails, tells the agent what to
 * tell the user. Most failures are the user's git not being set up yet, and that is
 * theirs to do -- the agent explains it, it does not work around it.
 */

import { count, flag, optionalText, text, ToolError, type ToolArgs, type ToolRegistry } from "./contract";
import type { FileSystemPort, GitPort, GitResult } from "./ports";

// A diff of a lockfile is tens of thousands of lines nobody needs; the cut says so.
const MAX_OUTPUT = 30_000;
const MAX_LOG = 100;

export const GIT_NOT_INSTALLED =
  "Git is not installed on this computer (or the app cannot find it). Tell the user, in " +
  "their language: git has to be installed first (https://git-scm.com/downloads), then " +
  "THE WAY has to be restarted so it finds it. You cannot do this for them.";

/** What went wrong with a git call, written for the agent to pass on to the user. */
export function explain(result: GitResult): string {
  const said = `${result.stderr}\n${result.stdout}`.trim();
  const lower = said.toLowerCase();
  const has = (...needles: string[]) => needles.some((needle) => lower.includes(needle));

  if (has("not a git repository")) {
    return (
      "The open folder is not a git repository. Tell the user; if they want one, they can " +
      "run `git init` in that folder themselves."
    );
  }
  if (has("please tell me who you are", "unable to auto-detect email", "empty ident name")) {
    return (
      "Git does not know who the user is, so it cannot commit. Tell the user, in their " +
      "language, to set their name and email once on this computer, in a terminal: " +
      '`git config --global user.name "Their Name"` and ' +
      '`git config --global user.email "them@example.com"`. Then try again.'
    );
  }
  if (has("no configured push destination", "no such remote", "does not appear to be a git repository")) {
    return (
      "This repository has no remote to push to. Tell the user: they need to add one " +
      "(`git remote add origin <url>`, the address of the repository on GitHub or wherever " +
      "it lives) before anything can be pushed."
    );
  }
  if (
    has(
      "could not read username",
      "could not read password",
      "terminal prompts disabled",
      "authentication failed",
      "permission denied (publickey)",
      "permission to",
      "access denied",
      "invalid credentials",
      "requested url returned error: 403",
      "requested url returned error: 401",
      "repository not found",
      "could not read from remote repository",
      "host key verification failed",
    )
  ) {
    return (
      "Git could not sign in to the remote, so this computer's git is not set up for it " +
      "yet. Tell the user, in their language: they have to set up their own git access " +
      "once -- sign in with Git Credential Manager (installed with git for Windows and Mac: " +
      "run `git push` once in a terminal and sign in when it asks) or add an SSH key to " +
      "their account -- and that THE WAY never holds their password or token. Once they " +
      "say it is done, try the push again. " +
      `Git said: ${firstLines(said, 3)}`
    );
  }
  if (has("has no upstream branch", "no upstream configured")) {
    return (
      "This branch has never been pushed. Call GitPush again with set_upstream true " +
      "(and the remote and branch if you know them)."
    );
  }
  if (has("non-fast-forward", "fetch first", "[rejected]", "updates were rejected")) {
    return (
      "The remote has commits this computer does not. Nothing was overwritten. You have no " +
      "pull or merge tool, so tell the user: they need to bring the remote's changes in " +
      "(`git pull`) and sort out any conflict themselves, then you can push again."
    );
  }
  if (has("nothing to commit", "no changes added to commit", "nothing added to commit")) {
    return "Nothing is staged, so there is nothing to commit. Stage files with GitAdd first (GitStatus shows what changed).";
  }
  if (has("index.lock", "another git process")) {
    return "Another git process is using this repository (a leftover .git/index.lock). Tell the user; if no other git is running they can delete that file.";
  }
  return `git failed (exit ${result.code}): ${firstLines(said, 8) || "no message"}`;
}

function firstLines(value: string, lines: number): string {
  return value.split("\n").slice(0, lines).join(" | ").trim();
}

function clip(output: string): string {
  if (output.length <= MAX_OUTPUT) return output;
  return `${output.slice(0, MAX_OUTPUT)}\n... cut at ${MAX_OUTPUT.toLocaleString("en-US")} characters; ask for a narrower view (a path, or a single commit).`;
}

/** A revision, remote or branch name goes to git as a value; one that starts with "-" would be an option. */
function name(args: ToolArgs, field: string, fallback?: string): string {
  const value = (fallback === undefined ? text(args, field) : optionalText(args, field, fallback)).trim();
  if (value.startsWith("-")) throw new ToolError(`'${field}' cannot start with '-'`);
  if (/[\s\0]/.test(value)) throw new ToolError(`'${field}' cannot contain spaces`);
  return value;
}

function list(args: ToolArgs, field: string): string[] {
  const value = args[field];
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string")) {
    throw new ToolError(`'${field}' is required and must be a list of paths`);
  }
  return value as string[];
}

export function gitTools(git: GitPort, fs: FileSystemPort): ToolRegistry {
  /** A path inside the open folder as git gets it; git's own pathspec magic (":!x") is not allowed. */
  function pathspec(path: string): string {
    if (path.trim().startsWith(":")) throw new ToolError(`'${path}' is not a plain path`);
    return fs.normalize(path) || ".";
  }

  async function ok(args: string[], network = false): Promise<string> {
    const result = await git.run(args, { network });
    if (result.code !== 0) throw new ToolError(explain(result));
    return result.stdout;
  }

  async function status(args: ToolArgs = {}): Promise<string> {
    const command = ["status", "--porcelain=v1", "--branch"];
    if (flag(args, "ignored")) command.push("--ignored");
    const out = (await ok(command)).trimEnd();
    const lines = out.split("\n");
    if (lines.length === 1) return `${lines[0]}\n(nothing to commit, working tree clean)`;
    return clip(out);
  }

  async function log(args: ToolArgs): Promise<string> {
    const limit = Math.min(count(args, "limit", 20), MAX_LOG);
    const command = ["log", `--max-count=${limit}`, "--date=short", "--no-ext-diff", "--pretty=format:%h %ad %an  %s"];
    if (args.path != null) command.push("--", pathspec(text(args, "path")));
    const out = await ok(command);
    return out.trim() || "(no commits yet)";
  }

  async function diff(args: ToolArgs): Promise<string> {
    const command = ["diff", "--no-ext-diff", "--no-textconv"];
    if (flag(args, "staged")) command.push("--cached");
    if (flag(args, "stat")) command.push("--stat");
    if (args.path != null) command.push("--", pathspec(text(args, "path")));
    const out = await ok(command);
    return out.trim() ? clip(out) : "(no differences)";
  }

  async function show(args: ToolArgs): Promise<string> {
    const revision = name(args, "revision", "HEAD");
    return clip(await ok(["show", "--no-ext-diff", "--no-textconv", "--stat", "--patch", revision]));
  }

  async function fetch(args: ToolArgs): Promise<string> {
    const command = ["fetch"];
    if (args.remote != null) command.push(name(args, "remote"));
    await ok(command, true);
    return "Fetched. GitStatus now shows how far ahead or behind this branch is.";
  }

  async function add(args: ToolArgs): Promise<string> {
    const paths = list(args, "paths").map(pathspec);
    await ok(["add", "--", ...paths]);
    return `Staged: ${paths.join(", ")}\n\n${await status()}`;
  }

  async function commit(args: ToolArgs): Promise<string> {
    const message = text(args, "message").trim();
    if (!message) throw new ToolError("The commit message cannot be empty");
    const result = await git.run(["commit", "-m", message]);
    if (result.code !== 0) throw new ToolError(explain(result));
    return clip(result.stdout.trim());
  }

  async function push(args: ToolArgs): Promise<string> {
    const command = ["push"];
    if (flag(args, "set_upstream")) command.push("--set-upstream");
    const remote = args.remote == null ? null : name(args, "remote");
    const branch = args.branch == null ? null : name(args, "branch");
    if (remote ?? branch) command.push(remote ?? "origin");
    if (branch) command.push(branch);
    const result = await git.run(command, { network: true });
    if (result.code !== 0) throw new ToolError(explain(result));
    // git writes the outcome of a push to stderr
    return (result.stderr.trim() || result.stdout.trim() || "Pushed.");
  }

  /** What the approval dialog shows: the thing about to happen, not just its arguments. */
  async function attempt(args: string[]): Promise<string | undefined> {
    const result = await git.run(args).catch(() => null);
    return result && result.code === 0 ? result.stdout.trim() : undefined;
  }

  return {
    GitStatus: { run: status },
    GitLog: { run: log },
    GitDiff: { run: diff },
    GitShow: { run: show },
    GitFetch: { run: fetch },
    GitAdd: {
      run: add,
      preview: async (args) => `Stage:\n${list(args, "paths").map(pathspec).join("\n")}`,
    },
    GitCommit: {
      run: commit,
      preview: async (args) => {
        const staged = await attempt(["diff", "--cached", "--stat", "--no-ext-diff"]);
        return `${text(args, "message").trim()}\n\n${staged || "(nothing staged)"}`;
      },
    },
    GitPush: {
      run: push,
      preview: async (args) => {
        const where = [args.remote, args.branch].filter((part) => typeof part === "string" && part).join(" ");
        const pending = await attempt(["log", "@{u}..HEAD", "--oneline", "--no-decorate"]);
        const head = `git push${flag(args, "set_upstream") ? " --set-upstream" : ""}${where ? ` ${where}` : ""}`;
        return pending ? `${head}\n\nCommits that will be sent:\n${pending}` : head;
      },
    },
  };
}
