import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ToolError } from "../core/tools/contract";
import { GIT_NOT_INSTALLED } from "../core/tools/git";
import type { GitPort, GitResult } from "../core/tools/ports";

const NO_FOLDER =
  "No folder is open in the desktop app, so there is no repository to work in. Ask the user " +
  "to choose one with the folder button, then try again.";

const LOCAL_TIMEOUT = 30_000;
const NETWORK_TIMEOUT = 120_000;
const MAX_BUFFER = 10 * 1024 * 1024;

// Set on every call, whatever the user's own configuration says: nothing here may wait for
// a person who is not looking at a terminal, open a pager or an editor, or run a program
// the repository names for diffing. (The one thing it does not touch is git's credential
// helper: signing in is the user's, through their own Git Credential Manager or SSH key.)
const SAFE_CONFIG = [
  "-c", "core.pager=cat",
  "-c", "core.fsmonitor=false",
  "-c", "core.quotepath=false",
  "-c", "protocol.ext.allow=never",
];

/**
 * The real git, run inside the folder the user opened and never above it. `execFile`, so
 * there is no shell for an argument to talk to.
 */
export class NodeGit implements GitPort {
  constructor(private readonly root: () => Promise<string | null>) {}

  async run(args: string[], options: { network?: boolean } = {}): Promise<GitResult> {
    const folder = await this.root();
    if (!folder) throw new ToolError(NO_FOLDER);
    try {
      if (!(await stat(folder)).isDirectory()) throw new Error("not a folder");
    } catch {
      throw new ToolError(`The open folder no longer exists on disk (${folder}). Ask the user to choose one again.`);
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_PAGER: "cat",
      GIT_EDITOR: "true",
      GIT_OPTIONAL_LOCKS: "0",
      // git's own messages are what explain() reads
      LC_ALL: "C",
      LANGUAGE: "en",
      // a repository above the open folder is not the user's choice of workspace
      GIT_CEILING_DIRECTORIES: dirname(resolve(folder)).replace(/\\/g, "/"),
    };
    delete env.GIT_EXTERNAL_DIFF;
    // an ssh that asks for a passphrase would hang until the timeout
    env.GIT_SSH_COMMAND ??= "ssh -o BatchMode=yes";

    return new Promise<GitResult>((done, fail) => {
      execFile(
        "git",
        [...SAFE_CONFIG, ...args],
        {
          cwd: folder,
          env,
          encoding: "utf8",
          windowsHide: true,
          maxBuffer: MAX_BUFFER,
          timeout: options.network ? NETWORK_TIMEOUT : LOCAL_TIMEOUT,
        },
        (error, stdout, stderr) => {
          if (!error) return done({ code: 0, stdout, stderr });
          const failure = error as NodeJS.ErrnoException & { killed?: boolean; code?: string | number };
          if (failure.code === "ENOENT") return fail(new ToolError(GIT_NOT_INSTALLED));
          if (failure.killed) {
            return fail(
              new ToolError(
                `git took longer than ${(options.network ? NETWORK_TIMEOUT : LOCAL_TIMEOUT) / 1000} seconds and was stopped. ` +
                  (options.network ? "Check the user's connection, or whether git is waiting to sign in." : "The repository may be very large."),
              ),
            );
          }
          if (typeof failure.code === "number") return done({ code: failure.code, stdout, stderr });
          fail(new ToolError(`git could not be run: ${failure.message}`));
        },
      );
    });
  }
}
