import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { ApiError } from "../core/api";
import type { Downloaded, UpdaterPorts } from "../core/installUpdate";
import { loopbackUrl } from "./serverConnectionAdapter";

const DOWNLOAD_TIMEOUT = 10 * 60_000;

/** Saves the installer in a folder of its own in the temp folder, and starts it. */
export class NodeUpdater implements Pick<UpdaterPorts, "download" | "discard" | "launch"> {
  constructor(private readonly folder: string) {}

  async download(url: string, filename: string): Promise<Downloaded> {
    // an installer left by an update that did not finish is not kept
    await rm(this.folder, { recursive: true, force: true });
    await mkdir(this.folder, { recursive: true });
    const file = join(this.folder, filename);

    let response: Response;
    try {
      response = await fetch(loopbackUrl(url), { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT), cache: "no-store" });
    } catch {
      throw new ApiError(0, "unreachable", "The installer could not be reached.");
    }
    if (!response.ok || !response.body) throw new ApiError(response.status, "error", `The installer answered ${response.status}.`);

    const said = Number(response.headers.get("content-length"));
    try {
      await pipeline(Readable.fromWeb(response.body as unknown as NodeReadableStream), createWriteStream(file));
    } catch {
      await rm(file, { force: true });
      throw new ApiError(0, "unreachable", "The installer download was cut off.");
    }
    return { file, written: (await stat(file)).size, expected: Number.isFinite(said) && said > 0 ? said : null };
  }

  async discard(file: string): Promise<void> {
    await rm(file, { force: true });
  }

  /** Detached, with nothing connected to it: it outlives this app, which quits right after. */
  launch(file: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(file, [], { detached: true, stdio: "ignore" });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
  }
}
