/**
 * The desktop tools this build implements -- the mirror of the server's
 * src/desktop/schemas.py. The server's GET /desktop-tools is the source of truth; the app
 * compares itself against it at start-up (see ToolRunner.missingFrom).
 */

export const FILE_TOOLS = [
  "ReadFile",
  "ListDir",
  "SearchFile",
  "SearchCode",
  "CreateDir",
  "CreateFile",
  "UpdateFile",
  "CopyPath",
  "MovePath",
  "DeleteFile",
  "DeleteDir",
] as const;

export const TRANSFER_TOOLS = ["UploadToProject", "DownloadFromProject"] as const;

export const BROWSER_TOOLS = [
  "OpenBrowserPage",
  "ReadBrowserPage",
  "ClickBrowserElement",
  "TypeInBrowser",
  "ListBrowserTabs",
  "SwitchBrowserTab",
  "CloseBrowser",
  "FindWhatsappChat",
  "ReadWhatsappChat",
  "SendWhatsappMessage",
] as const;

/** Asked about even if the server forgot to flag them -- the union of both lists wins. */
export const REQUIRES_APPROVAL: ReadonlySet<string> = new Set([
  "UpdateFile",
  "MovePath",
  "DeleteFile",
  "DeleteDir",
  "UploadToProject",
  "DownloadFromProject",
  "ClickBrowserElement",
  "TypeInBrowser",
  "SendWhatsappMessage",
]);

export type ToolArgs = Record<string, unknown>;

/** Thrown by a tool to fail with a message the model is meant to read and act on. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export interface ToolHandler {
  run(args: ToolArgs): Promise<string>;
  /** What the approval dialog shows beyond the arguments: a diff, a full message. */
  preview?(args: ToolArgs): Promise<string | undefined>;
}

export type ToolRegistry = Record<string, ToolHandler>;

export function text(args: ToolArgs, name: string): string {
  const value = args[name];
  if (typeof value !== "string") throw new ToolError(`'${name}' is required and must be text`);
  return value;
}

export function optionalText(args: ToolArgs, name: string, fallback: string): string {
  const value = args[name];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") throw new ToolError(`'${name}' must be text`);
  return value;
}

export function flag(args: ToolArgs, name: string, fallback = false): boolean {
  const value = args[name];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") throw new ToolError(`'${name}' must be true or false`);
  return value;
}

export function count(args: ToolArgs, name: string, fallback: number): number {
  const value = args[name];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ToolError(`'${name}' must be a positive whole number`);
  }
  return value;
}
