import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type SearchKind = "name" | "content";

/** The computer's own search index. Null when it cannot answer: not supported here, not running. */
export interface SystemSearch {
  search(root: string, terms: string[], kind: SearchKind, signal?: AbortSignal): Promise<string[] | null>;
}

const TIMEOUT_MS = 15_000;
const MAX_BUFFER = 8 * 1024 * 1024;
const run = promisify(execFile);

export function macQuery(terms: string[], kind: SearchKind): string {
  if (kind === "content") return terms.join(" ");
  return terms.map((term) => `kMDItemFSName == "*${term}*"cd`).join(" && ");
}

const WINDOWS_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
  "$scope = $env:THEWAY_SCOPE.Replace(\"'\", \"''\")",
  "$terms = @($env:THEWAY_TERMS -split ' ' | Where-Object { $_ })",
  "if ($env:THEWAY_KIND -eq 'name') {",
  "  $filter = ($terms | ForEach-Object { \"System.FileName LIKE '%$_%'\" }) -join ' AND '",
  "} else {",
  "  $filter = \"CONTAINS('\" + (($terms | ForEach-Object { '\"' + $_ + '\"' }) -join ' AND ') + \"')\"",
  "}",
  "$sql = \"SELECT TOP 500 System.ItemPathDisplay FROM SystemIndex WHERE SCOPE='file:$scope' AND $filter\"",
  "$connection = New-Object -ComObject ADODB.Connection",
  "$connection.Open(\"Provider=Search.CollatorDSO;Extended Properties='Application=Windows';\")",
  "$rows = New-Object -ComObject ADODB.Recordset",
  "$rows.Open($sql, $connection)",
  "while (-not $rows.EOF) { $rows.Fields.Item(0).Value; $rows.MoveNext() }",
].join("\n");

export function windowsCommand(): { file: string; args: string[] } {
  const encoded = Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64");
  return { file: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded] };
}

export function parsePaths(stdout: string): string[] {
  return stdout.split("\n").map((line) => line.replace(/\r$/, "").trim()).filter(Boolean);
}

async function ask(file: string, args: string[], env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<string[] | null> {
  try {
    const { stdout } = await run(file, args, { env, timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, signal, windowsHide: true });
    return parsePaths(stdout);
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

const mac: SystemSearch = {
  search: (root, terms, kind, signal) => ask("/usr/bin/mdfind", ["-onlyin", root, macQuery(terms, kind)], process.env, signal),
};

const windows: SystemSearch = {
  search: (root, terms, kind, signal) => {
    const { file, args } = windowsCommand();
    const env = { ...process.env, THEWAY_SCOPE: root, THEWAY_TERMS: terms.join(" "), THEWAY_KIND: kind };
    return ask(file, args, env, signal);
  },
};

export function systemSearchFor(platform: string): SystemSearch | null {
  if (platform === "darwin") return mac;
  if (platform === "win32") return windows;
  return null;
}
