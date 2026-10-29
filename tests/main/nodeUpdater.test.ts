import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../../src/core/api";
import { NodeUpdater } from "../../src/main/nodeUpdater";

let server: Server;
let folder: string;
let handler: (res: ServerResponse) => void;

const url = (path: string) => `http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "the-way-updater-"));
  server = createServer((_req, res) => handler(res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(folder, { recursive: true, force: true });
});

describe("saving the installer", () => {
  it("writes what the server sends, and says how much, against what it promised", async () => {
    const body = Buffer.alloc(2_000_000, 7);
    handler = (res) => { res.writeHead(200, { "Content-Length": body.length }); res.end(body); };

    const saved = await new NodeUpdater(join(folder, "update")).download(url("/installer"), "THE-WAY-Setup-0.1.8.exe");

    expect(saved.file).toBe(join(folder, "update", "THE-WAY-Setup-0.1.8.exe"));
    expect(saved.written).toBe(body.length);
    expect(saved.expected).toBe(body.length);
    expect((await readFile(saved.file)).equals(body)).toBe(true);
  });

  it("replaces what an earlier update left in its folder", async () => {
    handler = (res) => { res.writeHead(200); res.end(Buffer.alloc(10)); };
    const updater = new NodeUpdater(join(folder, "update"));
    const first = await updater.download(url("/a"), "THE-WAY-Setup-0.1.7.exe");

    await updater.download(url("/b"), "THE-WAY-Setup-0.1.8.exe");

    await expect(stat(first.file)).rejects.toThrow();
  });

  it("does not hand back a download cut off partway as if it were whole", async () => {
    handler = (res) => {
      res.writeHead(200, { "Content-Length": 5_000_000 });
      res.write(Buffer.alloc(1000));
      setTimeout(() => res.destroy(), 20);
    };

    const result = await new NodeUpdater(join(folder, "update")).download(url("/cut"), "THE-WAY-Setup.exe").catch((error) => error);

    // it either failed outright, or says it got less than it was promised: both are refused upstream
    if (result instanceof ApiError) expect(result.code).toBe("unreachable");
    else expect(result.written).toBeLessThan(result.expected ?? Number.POSITIVE_INFINITY);
  });

  it("fails with the bucket's status when it refuses the link, for the window to say in Spanish", async () => {
    handler = (res) => { res.writeHead(403); res.end("Request has expired"); };

    const failure = await new NodeUpdater(join(folder, "update")).download(url("/expired"), "THE-WAY-Setup.exe").catch((e) => e);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(403);
  });

  it("says it is unreachable when nothing answers", async () => {
    const dead = url("/x");
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));

    const failure = await new NodeUpdater(join(folder, "update")).download(dead, "THE-WAY-Setup.exe").catch((e) => e);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe("unreachable");
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  it("starts a program on its own and returns once it has started", async () => {
    await expect(new NodeUpdater(folder).launch(process.execPath)).resolves.toBeUndefined();
  });

  it("fails when the program cannot be started", async () => {
    await expect(new NodeUpdater(folder).launch(join(folder, "does-not-exist.exe"))).rejects.toThrow();
  });
});
