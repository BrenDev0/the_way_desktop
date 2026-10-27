import { execFile, spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { ToolError } from "../core/tools/contract";
import type { CommandPort, CommandResult } from "../core/tools/ports";

const NO_FOLDER =
  "No folder is open in the desktop app, so there is nowhere to run a command. Ask the user to " +
  "choose one with the folder button, then try again.";

// What one command may print before it is cut off: far more than the model is ever shown, and
// enough that a runaway command cannot fill the app's memory.
const MAX_CAPTURE_BYTES = 10 * 1024 * 1024;
// The Windows console writes in a legacy code page unless told otherwise.
const UTF8_FIRST = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $ProgressPreference = 'SilentlyContinue'; ";

/**
 * The user's own shell -- PowerShell on Windows, bash (else sh) elsewhere -- run in the folder
 * they opened. No terminal and no input: a command that waits for someone to type is ended by
 * the time limit rather than hanging the turn. It runs with the user's permissions and the
 * app's own environment; the app keeps no credentials in it.
 */
export class NodeCommand implements CommandPort {
  readonly shell: string;

  constructor(
    private readonly root: () => Promise<string | null>,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {
    this.shell = platform === "win32" ? "PowerShell (Windows)" : "bash";
  }

  folder(): Promise<string | null> {
    return this.root();
  }

  async run(command: string, timeoutMs: number): Promise<CommandResult> {
    const folder = await this.root();
    if (!folder) throw new ToolError(NO_FOLDER);
    try {
      if (!(await stat(folder)).isDirectory()) throw new Error("not a folder");
    } catch {
      throw new ToolError(`The open folder no longer exists on disk (${folder}). Ask the user to choose one again.`);
    }

    const windows = this.platform === "win32";
    const [program, args] = windows
      ? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", UTF8_FIRST + command]]
      : ["/bin/bash", ["-c", command]];

    return new Promise<CommandResult>((done, fail) => {
      const child = spawn(program, args, {
        cwd: folder,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", CI: "1", NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        // its own process group, so the time limit ends the command and what it started
        detached: !windows,
      });

      let stdout = "";
      let stderr = "";
      let size = 0;
      let timedOut = false;
      let finished = false;

      const end = () => {
        if (windows) execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => {});
        else {
          try {
            process.kill(-child.pid!, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }
      };
      const keep = (into: "out" | "err") => (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_CAPTURE_BYTES) return end();
        if (into === "out") stdout += chunk.toString("utf8");
        else stderr += chunk.toString("utf8");
      };
      child.stdout.on("data", keep("out"));
      child.stderr.on("data", keep("err"));

      const timer = setTimeout(() => {
        timedOut = true;
        end();
      }, timeoutMs);

      child.on("error", (error: NodeJS.ErrnoException) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        fail(
          error.code === "ENOENT"
            ? new ToolError(`The shell (${this.shell}) could not be started on this computer.`)
            : new ToolError(`The command could not be run: ${error.message}`),
        );
      });
      child.on("close", (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        done({ code, stdout, stderr, timedOut });
      });
    });
  }
}
