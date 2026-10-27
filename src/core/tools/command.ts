/**
 * RunCommand: one command on the user's own computer, in the folder they opened, for the skills
 * the kit wrote for an agent with a shell (`git`, `node`, `curl`...).
 *
 * The most powerful tool the agent has, so it is also the most fenced in. It asks the user
 * EVERY time, even in auto mode, showing the exact command and where it will run; it has a
 * time limit and an output limit; it never reads input; and it runs with the user's own
 * permissions, nothing more. The command is not fenced to the folder -- a shell cannot be --
 * which is why the person approving is the protection, and the approval says so.
 */

import { count, text, ToolError, type ToolArgs, type ToolRegistry } from "./contract";
import type { CommandPort, CommandResult } from "./ports";

export const DEFAULT_TIMEOUT_SECONDS = 60;
export const MAX_TIMEOUT_SECONDS = 600;
// A build log is thousands of lines nobody needs; the end of it is the part that says how it went.
export const MAX_OUTPUT = 30_000;
export const MAX_COMMAND_CHARS = 8_000;

/** The last `MAX_OUTPUT` characters, with a note when the start was cut. */
function tail(output: string, label: string): string {
  const trimmed = output.trim();
  if (trimmed.length <= MAX_OUTPUT) return trimmed;
  return `[${label}: the first ${(trimmed.length - MAX_OUTPUT).toLocaleString("en-US")} characters were cut; this is the end]\n${trimmed.slice(-MAX_OUTPUT)}`;
}

function report(command: string, shell: string, result: CommandResult, timeoutSeconds: number): string {
  const lines = [`$ ${command}`, `(shell: ${shell})`];
  if (result.timedOut) lines.push(`STOPPED: it ran longer than ${timeoutSeconds} seconds and was ended.`);
  else lines.push(`exit code: ${result.code}`);
  const out = tail(result.stdout, "stdout");
  const err = tail(result.stderr, "stderr");
  if (out) lines.push("--- stdout ---", out);
  if (err) lines.push("--- stderr ---", err);
  if (!out && !err) lines.push("(no output)");
  return lines.join("\n");
}

export function commandTools(command: CommandPort): ToolRegistry {
  function checked(args: ToolArgs): { command: string; timeoutSeconds: number } {
    const line = text(args, "command").trim();
    if (!line) throw new ToolError("The command is empty");
    if (line.length > MAX_COMMAND_CHARS) throw new ToolError(`The command is longer than ${MAX_COMMAND_CHARS} characters`);
    if (line.includes("\0")) throw new ToolError("The command has a null character");
    return { command: line, timeoutSeconds: Math.min(count(args, "timeout_seconds", DEFAULT_TIMEOUT_SECONDS), MAX_TIMEOUT_SECONDS) };
  }

  return {
    RunCommand: {
      async run(args) {
        const { command: line, timeoutSeconds } = checked(args);
        const result = await command.run(line, timeoutSeconds * 1000);
        const shown = report(line, command.shell, result, timeoutSeconds);
        // a command that did not succeed is a failed call, so the model is told it failed
        if (result.timedOut || result.code !== 0) throw new ToolError(shown);
        return shown;
      },

      /** What the user reads before saying yes: the whole command, where, and with what shell. */
      async preview(args) {
        const { command: line, timeoutSeconds } = checked(args);
        const folder = await command.folder();
        return [
          line,
          "",
          `Carpeta: ${folder ?? "(ninguna abierta)"}`,
          `Intérprete: ${command.shell} · tiempo máximo ${timeoutSeconds} s`,
          "Se ejecuta con tus permisos y puede tocar cualquier cosa a la que tú tengas acceso, no solo esa carpeta. Léelo antes de aprobar.",
        ].join("\n");
      },
    },
  };
}
