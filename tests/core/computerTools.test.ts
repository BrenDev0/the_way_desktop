import { describe, expect, it } from "vitest";
import { isSensitive, labelFor, splitComputerPath } from "../../src/core/computer/access";
import { computerTools } from "../../src/core/tools/computer";
import type { ComputerPort, DirectoryEntry, FileInfo, WalkEntry } from "../../src/core/tools/ports";

class FakeComputer implements ComputerPort {
  asked: string[] = [];
  constructor(
    private readonly files: Record<string, string>,
    private readonly pickNext: { label: string } | null = null,
  ) {}

  private labels() {
    return [...new Set(Object.keys(this.files).map((path) => path.split("/")[0]))];
  }

  async grants() {
    return this.labels().map((label) => ({ label }));
  }

  async choose(reason: string) {
    this.asked.push(reason);
    return this.pickNext;
  }

  private under(path: string) {
    const prefix = path.replace(/\/+$/, "");
    return Object.keys(this.files).filter((file) => file.startsWith(`${prefix}/`));
  }

  async stat(path: string): Promise<FileInfo> {
    const clean = path.replace(/\/+$/, "");
    if (clean in this.files) return { exists: true, isDirectory: false, size: this.files[clean].length };
    if (this.labels().includes(clean) || this.under(clean).length) return { exists: true, isDirectory: true, size: 0 };
    return { exists: false, isDirectory: false, size: 0 };
  }

  async list(path: string): Promise<DirectoryEntry[]> {
    const prefix = `${path.replace(/\/+$/, "")}/`;
    const names = new Map<string, DirectoryEntry>();
    for (const file of this.under(path)) {
      const [name, ...more] = file.slice(prefix.length).split("/");
      names.set(name, { name, isDirectory: more.length > 0, size: more.length ? 0 : this.files[file].length });
    }
    return [...names.values()];
  }

  async readBytes(path: string) {
    return new TextEncoder().encode(this.files[path]);
  }

  async *walk(path: string, enter: (name: string) => boolean, signal?: AbortSignal): AsyncIterable<WalkEntry> {
    for (const file of this.under(path).sort()) {
      signal?.throwIfAborted();
      if (!file.split("/").slice(1, -1).every(enter)) continue;
      yield { path: file, isDirectory: false, size: this.files[file].length };
    }
  }
}

const tools = (computer: ComputerPort) => computerTools(computer);

describe("RequestComputerAccess", () => {
  it("says what was granted, and how to name paths in it", async () => {
    const computer = new FakeComputer({}, { label: "Documentos" });

    const result = await tools(computer).RequestComputerAccess.run({ reason: "Buscar el contrato de Acme" });

    expect(computer.asked).toEqual(["Buscar el contrato de Acme"]);
    expect(result).toContain("'Documentos'");
    expect(result).toContain("Documentos/...");
  });

  it("tells the agent not to insist when the user picks nothing", async () => {
    const result = await tools(new FakeComputer({}, null)).RequestComputerAccess.run({ reason: "buscar" });

    expect(result).toMatch(/did not pick a folder/);
    expect(result).toMatch(/do not ask again/);
  });

  it("shows the reason in the question", async () => {
    const preview = await tools(new FakeComputer({})).RequestComputerAccess.preview?.({ reason: "Buscar el contrato" });

    expect(preview).toContain("Buscar el contrato");
  });
});

describe("ListComputerFolder", () => {
  const files = { "Documentos/a.txt": "hola", "Documentos/sub/b.txt": "x", "Fotos/c.txt": "y" };

  it("lists the granted folders when given no path", async () => {
    expect(await tools(new FakeComputer(files)).ListComputerFolder.run({})).toBe("Documentos/\nFotos/");
  });

  it("points to RequestComputerAccess when nothing is granted", async () => {
    expect(await tools(new FakeComputer({})).ListComputerFolder.run({})).toMatch(/RequestComputerAccess/);
  });

  it("lists folders first, then files with their sizes", async () => {
    expect(await tools(new FakeComputer(files)).ListComputerFolder.run({ path: "Documentos" })).toBe("sub/\na.txt  (4 bytes)");
  });

  it("refuses a file, and a folder that is not there", async () => {
    const run = tools(new FakeComputer(files)).ListComputerFolder.run;

    await expect(run({ path: "Documentos/a.txt" })).rejects.toThrow(/is a file/);
    await expect(run({ path: "Documentos/nada" })).rejects.toThrow(/does not exist/);
  });
});

describe("SearchComputer", () => {
  const files = {
    "Documentos/contratos/acme.txt": "x",
    "Documentos/acme-notas.txt": "x",
    "Fotos/acme/viaje.txt": "x",
    "Documentos/node_modules/acme.txt": "x",
  };

  it("searches every granted folder, best name match first, and skips build folders", async () => {
    const result = await tools(new FakeComputer(files)).SearchComputer.run({ query: "acme" });

    expect(result.split("\n")).toEqual([
      "Documentos/acme-notas.txt",
      "Documentos/contratos/acme.txt",
      "Fotos/acme/viaje.txt",
    ]);
  });

  it("can be limited to one folder", async () => {
    const result = await tools(new FakeComputer(files)).SearchComputer.run({ query: "acme", path: "Fotos" });

    expect(result).toBe("Fotos/acme/viaje.txt");
  });

  it("says so when nothing matches", async () => {
    expect(await tools(new FakeComputer(files)).SearchComputer.run({ query: "zzz" })).toMatch(/Nothing matches/);
  });

  it("points to RequestComputerAccess when nothing is granted", async () => {
    expect(await tools(new FakeComputer({})).SearchComputer.run({ query: "acme" })).toMatch(/RequestComputerAccess/);
  });

  it("ends when the user stops it", async () => {
    const stopped = new AbortController();
    stopped.abort();

    await expect(tools(new FakeComputer(files)).SearchComputer.run({ query: "acme" }, stopped.signal)).rejects.toThrow();
  });
});

describe("ReadComputerFile", () => {
  it("reads a text file", async () => {
    expect(await tools(new FakeComputer({ "Documentos/a.txt": "hola" })).ReadComputerFile.run({ path: "Documentos/a.txt" })).toBe("hola");
  });

  it("refuses a folder and a missing file with what to do instead", async () => {
    const run = tools(new FakeComputer({ "Documentos/a.txt": "hola" })).ReadComputerFile.run;

    await expect(run({ path: "Documentos" })).rejects.toThrow(/ListComputerFolder/);
    await expect(run({ path: "Documentos/b.txt" })).rejects.toThrow(/does not exist/);
  });

  it("refuses a file too big to read at once", async () => {
    const run = tools(new FakeComputer({ "Documentos/big.txt": "x".repeat(2_000_001) })).ReadComputerFile.run;

    await expect(run({ path: "Documentos/big.txt" })).rejects.toThrow(/over the/);
  });
});

describe("computer paths", () => {
  it("splits the granted folder from the path inside it", () => {
    expect(splitComputerPath("Documentos/contratos/a.txt")).toEqual({ label: "Documentos", rest: "contratos/a.txt" });
    expect(splitComputerPath("Documentos\\contratos")).toEqual({ label: "Documentos", rest: "contratos" });
    expect(splitComputerPath("")).toEqual({ label: "", rest: "" });
  });

  it("refuses to climb out", () => {
    expect(() => splitComputerPath("Documentos/../.ssh/id_rsa")).toThrow(/outside/);
  });

  it("knows credentials and keys", () => {
    for (const path of ["a/.ssh/config", "a/.env", "a/.env.production", "a/server.pem", "a/id_rsa", "a/.aws/credentials", "a/Login Data"]) {
      expect(isSensitive(path), path).toBe(true);
    }
    for (const path of ["a/contrato.pdf", "a/environment.txt", "a/notas.txt"]) expect(isSensitive(path), path).toBe(false);
  });

  it("names a folder by its own name and keeps names apart", () => {
    expect(labelFor("/Users/ana/Documentos", [])).toBe("Documentos");
    expect(labelFor("C:\\Users\\ana\\Documentos", ["documentos"])).toBe("Documentos 2");
    expect(labelFor("/x/Documentos", ["Documentos", "Documentos 2"])).toBe("Documentos 3");
  });
});
