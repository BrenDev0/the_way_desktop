import { describe, expect, it } from "vitest";
import { cloudOnlyMessage, isCloudOnly } from "../../src/core/computer/cloud";
import { computerTools, type ComputerAudit } from "../../src/core/tools/computer";
import type { ComputerPort, DirectoryEntry, FileInfo, WalkEntry } from "../../src/core/tools/ports";

describe("telling a cloud-only file from a local one", () => {
  it("is a real size with nothing allocated on disk", () => {
    expect(isCloudOnly(5_000_000, 0)).toBe(true);
    expect(isCloudOnly(4096, 0)).toBe(true);
  });

  it("is not a file with something on disk", () => {
    expect(isCloudOnly(5_000_000, 9766)).toBe(false);
  });

  it("is not a small file, which NTFS keeps inside the directory entry with nothing allocated", () => {
    expect(isCloudOnly(99, 0)).toBe(false);
    expect(isCloudOnly(4095, 0)).toBe(false);
  });

  it("is not a guess when the system does not say", () => {
    expect(isCloudOnly(5_000_000, undefined)).toBe(false);
  });

  it("explains itself to the agent, naming the file and what to ask the user", () => {
    expect(cloudOnlyMessage("Nube/informe.pdf")).toMatch(/'Nube\/informe.pdf' is stored only in the cloud.*download.*make it available/);
  });
});

class CloudComputer implements ComputerPort {
  readBytesCalls: string[] = [];
  constructor(private readonly files: Record<string, { text: string; cloud?: boolean }>) {}

  async grants() {
    return [{ label: "Nube" }];
  }

  async choose() {
    return null;
  }

  async stat(path: string): Promise<FileInfo> {
    const file = this.files[path];
    if (file) return { exists: true, isDirectory: false, size: file.text.length, cloudOnly: file.cloud };
    return { exists: true, isDirectory: true, size: 0 };
  }

  async list(): Promise<DirectoryEntry[]> {
    return Object.entries(this.files).map(([path, file]) => ({
      name: path.split("/").pop()!,
      isDirectory: false,
      size: file.text.length,
      cloudOnly: file.cloud,
    }));
  }

  async readBytes(path: string) {
    this.readBytesCalls.push(path);
    return new TextEncoder().encode(this.files[path].text);
  }

  async document() {
    return "";
  }

  async indexed(path: string, terms: string[], kind: "name" | "content"): Promise<WalkEntry[] | null> {
    void path;
    void terms;
    void kind;
    return null;
  }

  async *walk(): AsyncIterable<WalkEntry> {
    for (const [path, file] of Object.entries(this.files)) {
      yield { path, isDirectory: false, size: file.text.length, cloudOnly: file.cloud };
    }
  }
}

const files = {
  "Nube/local.txt": { text: "contrato acme aqui" },
  "Nube/remoto.txt": { text: "contrato acme en la nube", cloud: true },
};

describe("cloud-only files in the tools", () => {
  it("are not opened by ReadComputerFile, and the agent is told why", async () => {
    const computer = new CloudComputer(files);

    await expect(computerTools(computer).ReadComputerFile.run({ path: "Nube/remoto.txt" })).rejects.toThrow(/only in the cloud.*download/);
    expect(computer.readBytesCalls).toEqual([]);
  });

  it("still read when they are local", async () => {
    expect(await computerTools(new CloudComputer(files)).ReadComputerFile.run({ path: "Nube/local.txt" })).toBe("contrato acme aqui");
  });

  it("are listed, marked as only in the cloud", async () => {
    const result = await computerTools(new CloudComputer(files)).ListComputerFolder.run({ path: "Nube" });

    expect(result).toContain("remoto.txt  (24 bytes, only in the cloud)");
    expect(result).toContain("local.txt  (18 bytes)");
  });

  it("are found by name, marked", async () => {
    const result = await computerTools(new CloudComputer(files)).SearchComputer.run({ query: "txt" });

    expect(result).toContain("Nube/remoto.txt  (only in the cloud)");
    expect(result).toContain("Nube/local.txt");
    expect(result).not.toContain("Nube/local.txt  (only");
  });

  it("are not opened by a text search, which says how many it left alone", async () => {
    const computer = new CloudComputer(files);

    const result = await computerTools(computer).SearchComputerText.run({ query: "acme" });

    expect(result).toContain("Nube/local.txt:1: contrato acme aqui");
    expect(result).not.toContain("remoto.txt");
    expect(result).toMatch(/1 text file\(s\) stored only in the cloud were not opened/);
    expect(computer.readBytesCalls).toEqual(["Nube/local.txt"]);
  });
});

describe("the record of what the agent did", () => {
  const entries: Omit<Parameters<ComputerAudit>[0], never>[] = [];
  const audit: ComputerAudit = (entry) => entries.push(entry);
  const tools = () => {
    entries.length = 0;
    return computerTools(new CloudComputer(files), audit);
  };

  it("notes a read, a search and a listing, with what was asked", async () => {
    const run = tools();

    await run.ReadComputerFile.run({ path: "Nube/local.txt", offset: 40_000 }).catch(() => undefined);
    await run.SearchComputer.run({ query: "acme", path: "Nube" });
    await run.SearchComputerText.run({ query: "acme" });
    await run.ListComputerFolder.run({});

    expect(entries).toEqual([
      { tool: "ReadComputerFile", detail: "Nube/local.txt (from character 40000)", ok: false, note: expect.stringMatching(/past the end/) },
      { tool: "SearchComputer", detail: '"acme" in Nube', ok: true },
      { tool: "SearchComputerText", detail: '"acme"', ok: true },
      { tool: "ListComputerFolder", detail: "(the granted folders)", ok: true },
    ]);
  });

  it("notes a refusal with its reason, and still refuses", async () => {
    const run = tools();

    await expect(run.ReadComputerFile.run({ path: "Nube/remoto.txt" })).rejects.toThrow();

    expect(entries).toEqual([{ tool: "ReadComputerFile", detail: "Nube/remoto.txt", ok: false, note: expect.stringMatching(/only in the cloud/) }]);
  });

  it("notes a search the user stopped as stopped", async () => {
    const run = tools();
    const stopped = new AbortController();
    stopped.abort();

    await expect(run.SearchComputerText.run({ query: "acme" }, stopped.signal)).rejects.toThrow();

    expect(entries[0]).toMatchObject({ tool: "SearchComputerText", ok: false, note: "stopped by the user" });
  });

  it("notes the reason for a request for access", async () => {
    const run = tools();

    await run.RequestComputerAccess.run({ reason: "Buscar el contrato de Acme" });

    expect(entries).toEqual([{ tool: "RequestComputerAccess", detail: "Buscar el contrato de Acme", ok: true }]);
  });

  it("works with no record kept", async () => {
    expect(await computerTools(new CloudComputer(files)).ReadComputerFile.run({ path: "Nube/local.txt" })).toBe("contrato acme aqui");
  });
});
