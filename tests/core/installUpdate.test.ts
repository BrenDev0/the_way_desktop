import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/core/api";
import { MIN_INSTALLER_BYTES, installUpdate, type UpdaterPorts } from "../../src/core/installUpdate";
import { friendly } from "../../src/core/userMessages";

const BIG = MIN_INSTALLER_BYTES + 1;

/** The ports, remembering what was done and in what order. */
function ports(over: Partial<UpdaterPorts> = {}) {
  const calls: string[] = [];
  const downloads: { url: string; filename: string }[] = [];
  const all: UpdaterPorts = {
    link: async () => {
      calls.push("link");
      return { url: "https://bucket.example/signed?x=1", filename: "THE-WAY-Setup-0.1.8.exe", version: "0.1.8" };
    },
    download: async (url, filename) => {
      calls.push("download");
      downloads.push({ url, filename });
      return { file: `C:\\Temp\\${filename}`, written: BIG, expected: BIG };
    },
    discard: async (file) => { calls.push(`discard ${file}`); },
    launch: async (file) => { calls.push(`launch ${file}`); },
    quit: () => { calls.push("quit"); },
    ...over,
  };
  return { all, calls, downloads };
}

describe("the app updating itself", () => {
  it("downloads the installer, starts it, and only then quits", async () => {
    const { all, calls, downloads } = ports();

    await installUpdate("win32", all);

    expect(calls).toEqual(["link", "download", "launch C:\\Temp\\THE-WAY-Setup-0.1.8.exe", "quit"]);
    expect(downloads).toEqual([{ url: "https://bucket.example/signed?x=1", filename: "THE-WAY-Setup-0.1.8.exe" }]);
  });

  it("is for Windows only, and asks the server for nothing elsewhere", async () => {
    const { all, calls } = ports();

    await expect(installUpdate("darwin", all)).rejects.toThrow(/solo está disponible en Windows/);
    await expect(installUpdate("linux", all)).rejects.toThrow(/solo está disponible en Windows/);
    expect(calls).toEqual([]);
  });

  it("saves it under a name of its own choosing, whatever the server says", async () => {
    const { all, downloads } = ports({
      link: async () => ({ url: "https://bucket.example/s", filename: "..\\..\\Startup\\evil.exe", version: "0.1.8" }),
    });

    await installUpdate("win32", all);

    expect(downloads[0].filename).toBe("THE-WAY-Setup.exe");
  });

  it("refuses a link that is not https, and downloads nothing", async () => {
    for (const url of ["http://evil.example/THE-WAY-Setup.exe", "ftp://x/y", "file:///C:/x.exe", "not a url"]) {
      const { all, calls } = ports({ link: async () => ({ url, filename: "THE-WAY-Setup.exe", version: null }) });

      await expect(installUpdate("win32", all)).rejects.toThrow(/no es seguro/);
      expect(calls).toEqual([]);
    }
  });

  it("allows plain http only to the computer itself, for a local server", async () => {
    const { all, calls } = ports({
      link: async () => ({ url: "http://localhost:9090/the-way/x", filename: "THE-WAY-Setup.exe", version: null }),
    });

    await installUpdate("win32", all);

    expect(calls).toContain("quit");
  });

  it("throws away an installer that arrived short, and does not run it or quit", async () => {
    const { all, calls } = ports({
      download: async (_url, filename) => ({ file: `C:\\Temp\\${filename}`, written: 5_000_000, expected: 90_000_000 }),
    });

    await expect(installUpdate("win32", all)).rejects.toThrow(/quedó incompleta/);
    expect(calls).toEqual(["link", "discard C:\\Temp\\THE-WAY-Setup-0.1.8.exe"]);
  });

  it("throws away something too small to be an installer, even when the server said that size", async () => {
    const { all, calls } = ports({
      download: async (_url, filename) => ({ file: `C:\\Temp\\${filename}`, written: 300, expected: 300 }),
    });

    await expect(installUpdate("win32", all)).rejects.toThrow(/quedó incompleta/);
    expect(calls.some((call) => call.startsWith("launch"))).toBe(false);
    expect(calls).not.toContain("quit");
  });

  it("accepts an installer whose size the server did not say, if it is big enough", async () => {
    const { all, calls } = ports({
      download: async (_url, filename) => ({ file: `C:\\Temp\\${filename}`, written: BIG, expected: null }),
    });

    await installUpdate("win32", all);

    expect(calls).toContain("quit");
  });

  it("stays open, and says why, when the installer cannot be started", async () => {
    const { all, calls } = ports({ launch: async () => { throw new Error("spawn EACCES"); } });

    await expect(installUpdate("win32", all)).rejects.toThrow("spawn EACCES");
    expect(calls).not.toContain("quit");
  });

  it("tells the person, in Spanish, when the server has no installer or the bucket is down", () => {
    expect(friendly(new ApiError(404, "installer_not_published", "x"))).toMatch(/Todavía no hay un instalador/);
    expect(friendly(new ApiError(503, "downloads_unavailable", "x"))).toMatch(/descargas no están disponibles/);
  });
});
