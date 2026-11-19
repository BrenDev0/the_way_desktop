import { ToolError } from "../tools/contract";

export interface ComputerGrant {
  id: string;
  label: string;
  path: string;
}

export function splitComputerPath(path: string): { label: string; rest: string } {
  const parts = path.replaceAll("\\", "/").split("/").filter((part) => part.trim() && part !== ".");
  if (parts.includes("..")) throw new ToolError(`Path '${path}' goes outside the granted folder`);
  return { label: parts[0] ?? "", rest: parts.slice(1).join("/") };
}

const SENSITIVE_DIRS = new Set([".ssh", ".aws", ".gnupg", ".azure", ".kube", ".docker", ".password-store", "keychains"]);

const SENSITIVE_FILES = [
  /^\.env(\..+)?$/i,
  /\.(pem|key|p12|pfx|kdbx|keystore|jks)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^\.(npmrc|netrc|pgpass)$/i,
  /^(login data|cookies|web data|key4\.db|logins\.json|credentials\.json)$/i,
];

export function isSensitive(path: string): boolean {
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
  if (parts.some((part) => SENSITIVE_DIRS.has(part.toLowerCase()))) return true;
  const name = parts[parts.length - 1] ?? "";
  return SENSITIVE_FILES.some((pattern) => pattern.test(name));
}

export const PROTECTED = "That file holds credentials or keys, so it is not available to the agent.";

export function labelFor(path: string, taken: readonly string[]): string {
  const base = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "Carpeta";
  const used = new Set(taken.map((label) => label.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    if (!used.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
  }
}
