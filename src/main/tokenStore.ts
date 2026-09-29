import { safeStorage } from "electron";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TokenStorePort } from "../core/auth";

/**
 * The session token, encrypted with the operating system's keychain (DPAPI on Windows,
 * Keychain on macOS) through Electron's safeStorage. It never leaves the main process.
 */
export class TokenStore implements TokenStorePort {
  private readonly path: string;
  private cached: string | null | undefined;

  constructor(userDataDirectory: string) {
    this.path = join(userDataDirectory, "session.bin");
  }

  async load(): Promise<string | null> {
    if (this.cached !== undefined) return this.cached;
    try {
      const encrypted = await readFile(this.path);
      this.cached = safeStorage.decryptString(encrypted);
    } catch {
      // missing, or written under another OS account: either way, not signed in
      this.cached = null;
    }
    return this.cached;
  }

  async save(token: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      // Refuse rather than write a readable token to disk.
      throw new Error("This system offers no secure storage, so the session cannot be kept.");
    }
    await writeFile(this.path, safeStorage.encryptString(token), { mode: 0o600 });
    this.cached = token;
  }

  async clear(): Promise<void> {
    this.cached = null;
    await rm(this.path, { force: true });
  }
}
