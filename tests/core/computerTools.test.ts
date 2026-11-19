import { describe, expect, it } from "vitest";
import { isHomeNoise, isSensitive, labelFor, splitComputerPath } from "../../src/core/computer/access";
import { computerTools } from "../../src/core/tools/computer";
import type { ComputerPort, DirectoryEntry, FileInfo, WalkEntry } from "../../src/core/tools/ports";

class FakeComputer implements ComputerPort {
  asked: string[] = [];
  documentCalls: string[] = [];
  constructor(
    private readonly files: Record<string, string>,
    private readonly pickNext: { label: string; home?: boolean } | null = null,
    private readonly texts: Record<string, string> = {},
  ) {}

  async document(path: string) {
    this.documentCalls.push(path);
    return this.texts[path] ?? "";
  }

  index: { name: WalkEntry[] | null; content: WalkEntry[] | null } = { name: null, content: null };
  indexCalls: string[] = [];

  async indexed(path: string, terms: string[], kind: "name" | "content") {
    this.indexCalls.push(`${kind}:${path}:${terms.join(" ")}`);
    return this.index[kind];
  }

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

  reads: string[] = [];

  async readBytes(path: string) {
    this.reads.push(path);
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
  it("says the whole user folder was granted, and to start with a search", async () => {
    const computer = new FakeComputer({}, { label: "Usuario", home: true });

    const result = await tools(computer).RequestComputerAccess.run({ reason: "Buscar el contrato" });

    expect(result).toContain("whole folder, 'Usuario'");
    expect(result).toContain("Start with SearchComputer");
  });

  it("says what was granted, and how to name paths in it", async () => {
    const computer = new FakeComputer({}, { label: "Documentos" });

    const result = await tools(computer).RequestComputerAccess.run({ reason: "Buscar el contrato de Acme" });

    expect(computer.asked).toEqual(["Buscar el contrato de Acme"]);
    expect(result).toContain("'Documentos'");
    expect(result).toContain("Documentos/...");
  });

  it("tells the agent not to insist when the user picks nothing", async () => {
    const result = await tools(new FakeComputer({}, null)).RequestComputerAccess.run({ reason: "buscar" });

    expect(result).toMatch(/did not allow it/);
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

describe("ReadComputerFile on documents and long files", () => {
  const pdf = (text: string, size = 5000) => ({
    computer: new FakeComputer({ "Documentos/informe.pdf": "x".repeat(size) }, null, { "Documentos/informe.pdf": text }),
    path: "Documentos/informe.pdf",
  });

  it("reads a PDF, Word or Excel file as the text the server extracted", async () => {
    const { computer, path } = pdf("Informe de ventas");

    expect(await tools(computer).ReadComputerFile.run({ path })).toBe("Informe de ventas");
    expect(computer.documentCalls).toEqual([path]);
  });

  it("sends each document type through the extractor, and a text file through none", async () => {
    const computer = new FakeComputer({ "D/a.docx": "x", "D/b.xlsx": "x", "D/c.txt": "hola" }, null, { "D/a.docx": "A", "D/b.xlsx": "B" });
    const run = tools(computer).ReadComputerFile.run;

    expect([await run({ path: "D/a.docx" }), await run({ path: "D/b.xlsx" }), await run({ path: "D/c.txt" })]).toEqual(["A", "B", "hola"]);
    expect(computer.documentCalls).toEqual(["D/a.docx", "D/b.xlsx"]);
  });

  it("pages a long document and says how to ask for the rest", async () => {
    const { computer, path } = pdf("a".repeat(40_000) + "b".repeat(10_000));
    const run = tools(computer).ReadComputerFile.run;

    const first = await run({ path });
    const second = await run({ path, offset: 40_000 });

    expect(first).toContain("[characters 0-40,000 of 50,000; call again with offset=40000 for the rest]");
    expect(first.startsWith("a")).toBe(true);
    expect(second.startsWith("b")).toBe(true);
    expect(second).toContain("end of file");
  });

  it("asks the server to read a document once, however many pages are read", async () => {
    const { computer, path } = pdf("x".repeat(100_000));
    const run = tools(computer).ReadComputerFile.run;

    await run({ path });
    await run({ path, offset: 40_000 });
    await run({ path, offset: 80_000 });

    expect(computer.documentCalls).toHaveLength(1);
  });

  it("pages a long text file the same way", async () => {
    const run = tools(new FakeComputer({ "D/a.txt": "z".repeat(90_000) })).ReadComputerFile.run;

    expect(await run({ path: "D/a.txt", offset: 80_000 })).toContain("end of file");
  });

  it("refuses an offset past the end, and a bad one", async () => {
    const { computer, path } = pdf("corto");
    const run = tools(computer).ReadComputerFile.run;

    await expect(run({ path, offset: 99 })).rejects.toThrow(/past the end/);
    await expect(run({ path, offset: -1 })).rejects.toThrow(/whole number/);
    await expect(run({ path, offset: "1" })).rejects.toThrow(/whole number/);
  });

  it("says a scanned document has no text, rather than returning nothing", async () => {
    const { computer, path } = pdf("   ");

    await expect(tools(computer).ReadComputerFile.run({ path })).rejects.toThrow(/scanned images/);
  });

  it("refuses a document over the size limit without sending it anywhere", async () => {
    const { computer, path } = pdf("x", 1);
    computer.stat = async () => ({ exists: true, isDirectory: false, size: 33 * 1024 * 1024 });

    await expect(tools(computer).ReadComputerFile.run({ path })).rejects.toThrow(/over the 33,554,432/);
    expect(computer.documentCalls).toEqual([]);
  });
});

const file = (path: string, size = 10): WalkEntry => ({ path, isDirectory: false, size });

const filler = (count: number, content = "x") =>
  Object.fromEntries(Array.from({ length: count }, (_, i) => [`Documentos/relleno/f${String(i).padStart(4, "0")}.txt`, content]));

describe("SearchComputer and the system index", () => {
  const small = { "Documentos/acme-notas.txt": "x", "Documentos/otro/acme.txt": "x" };
  const big = () => ({ ...filler(5200), "Documentos/acme-notas.txt": "x", "Documentos/zzz-acme.txt": "x" });
  const lines = (result: string) => result.split("\n").filter((line) => line.startsWith("Documentos/"));

  it("scans a small folder itself, so nothing is missed, and does not ask the index", async () => {
    const computer = new FakeComputer(small);
    computer.index.name = [file("Documentos/acme-notas.txt")];

    const result = await tools(computer).SearchComputer.run({ query: "Acme" });

    expect(lines(result)).toEqual(["Documentos/otro/acme.txt", "Documentos/acme-notas.txt"]);
    expect(result).not.toMatch(/system index/);
    expect(computer.indexCalls).toEqual([]);
  });

  it("still scans a folder of exactly the small size, without the index", async () => {
    const computer = new FakeComputer({ ...filler(4999), "Documentos/acme.txt": "x" });
    computer.index.name = [];

    expect(await tools(computer).SearchComputer.run({ query: "acme" })).toBe("Documentos/acme.txt");
    expect(computer.indexCalls).toEqual([]);
  });

  it("asks the index once the folder is bigger, and adds what it knows to what the scan found", async () => {
    const computer = new FakeComputer(big());
    computer.index.name = [file("Documentos/zzz-acme.txt")];

    const result = await tools(computer).SearchComputer.run({ query: "acme" });

    expect(lines(result)).toEqual(["Documentos/zzz-acme.txt", "Documentos/acme-notas.txt"]);
    expect(result).toMatch(/system index.*thorough=true/);
    expect(computer.indexCalls).toEqual(["name:Documentos:acme"]);
  });

  it("does not list a file twice when the scan and the index both found it", async () => {
    const computer = new FakeComputer(big());
    computer.index.name = [file("Documentos/acme-notas.txt"), file("Documentos/zzz-acme.txt")];

    expect(lines(await tools(computer).SearchComputer.run({ query: "acme" }))).toEqual(["Documentos/zzz-acme.txt", "Documentos/acme-notas.txt"]);
  });

  it("keeps scanning to the end when the index finds nothing", async () => {
    const computer = new FakeComputer(big());
    computer.index.name = [];

    const result = await tools(computer).SearchComputer.run({ query: "acme" });

    expect(result).toContain("Documentos/zzz-acme.txt");
    expect(result).not.toMatch(/system index/);
    expect(computer.indexCalls).toHaveLength(1);
  });

  it("keeps scanning to the end when there is no index to ask", async () => {
    expect(await tools(new FakeComputer(big())).SearchComputer.run({ query: "acme" })).toContain("Documentos/zzz-acme.txt");
  });

  it("scans to the end and never asks the index when told to be thorough", async () => {
    const computer = new FakeComputer(big());
    computer.index.name = [file("Documentos/acme-notas.txt")];

    const result = await tools(computer).SearchComputer.run({ query: "acme", thorough: true });

    expect(result).toContain("Documentos/zzz-acme.txt");
    expect(computer.indexCalls).toEqual([]);
  });

  it("drops what the index returns from build folders", async () => {
    const computer = new FakeComputer(big());
    computer.index.name = [file("Documentos/node_modules/acme.txt"), file("Documentos/zzz-acme.txt")];

    const result = await tools(computer).SearchComputer.run({ query: "acme" });

    expect(result).not.toContain("node_modules");
    expect(result).toContain("Documentos/zzz-acme.txt");
  });

  it("matches without caring about accents or capitals", async () => {
    const computer = new FakeComputer({ "Documentos/Contrato Ñandú.txt": "x" });

    expect(await tools(computer).SearchComputer.run({ query: "nandu CONTRATO" })).toContain("Contrato Ñandú.txt");
  });
});

describe("SearchComputerText", () => {
  const files = {
    "Documentos/notas.txt": "primera linea\nel contrato con Acme vence en mayo\nfin",
    "Documentos/otro.txt": "nada de esto",
    "Documentos/foto.png": "contrato acme",
    "Documentos/node_modules/dep.txt": "contrato acme",
  };

  it("finds the text files that hold every word, with the line, ignoring accents and capitals", async () => {
    const result = await tools(new FakeComputer(files)).SearchComputerText.run({ query: "ACME contrató" });

    expect(result).toContain("Documentos/notas.txt:2: el contrato con Acme vence en mayo");
    expect(result).not.toContain("otro.txt");
    expect(result).not.toContain("foto.png");
    expect(result).not.toContain("node_modules");
  });

  it("needs every word, not any", async () => {
    expect(await tools(new FakeComputer(files)).SearchComputerText.run({ query: "contrato zzz" })).toMatch(/^No file contains all of/);
  });

  it("uses the index for contents, and shows the line for the text files it returns", async () => {
    const computer = new FakeComputer(files);
    computer.index.content = [file("Documentos/notas.txt"), file("Documentos/informe.pdf", 99)];

    const result = await tools(computer).SearchComputerText.run({ query: "acme" });

    expect(result).toContain("Documentos/notas.txt:2: el contrato con Acme vence en mayo");
    expect(result).toContain("Documentos/informe.pdf  (document)");
    expect(result).toMatch(/system index/);
    expect(computer.indexCalls).toEqual(["content:Documentos:acme"]);
  });

  it("scans the text files when the index finds nothing", async () => {
    const computer = new FakeComputer(files);
    computer.index.content = [];

    expect(await tools(computer).SearchComputerText.run({ query: "acme" })).toContain("Documentos/notas.txt:2");
  });

  it("scans when asked to be thorough, without asking the index", async () => {
    const computer = new FakeComputer(files);
    computer.index.content = [file("Documentos/informe.pdf")];

    const result = await tools(computer).SearchComputerText.run({ query: "acme", thorough: true });

    expect(result).toContain("notas.txt");
    expect(result).not.toContain("informe.pdf");
    expect(computer.indexCalls).toEqual([]);
  });

  it("says what it does not read, and that documents are opened with ReadComputerFile", async () => {
    expect(await tools(new FakeComputer(files)).SearchComputerText.run({ query: "acme" })).toMatch(/Only text files are read.*ReadComputerFile/);
  });

  it("skips a text file too big to read", async () => {
    const computer = new FakeComputer({ "Documentos/grande.txt": "acme" });
    computer.walk = async function* () {
      yield { path: "Documentos/grande.txt", isDirectory: false, size: 3_000_000 };
    };

    expect(await tools(computer).SearchComputerText.run({ query: "acme" })).toMatch(/^No file contains/);
  });

  it("limits what it shows and says how many more", async () => {
    const many = Object.fromEntries(Array.from({ length: 35 }, (_, i) => [`Documentos/n${i}.txt`, "acme"]));

    const result = await tools(new FakeComputer(many)).SearchComputerText.run({ query: "acme" });

    expect(result).toContain("and 5 more files");
  });

  it("points to RequestComputerAccess when nothing is granted, and ends on Stop", async () => {
    expect(await tools(new FakeComputer({})).SearchComputerText.run({ query: "acme" })).toMatch(/RequestComputerAccess/);
    const stopped = new AbortController();
    stopped.abort();

    await expect(tools(new FakeComputer(files)).SearchComputerText.run({ query: "acme" }, stopped.signal)).rejects.toThrow();
  });
});

describe("SearchComputerText and folder size", () => {
  const big = () => ({ ...filler(5200, "nada"), "Documentos/notas.txt": "contrato acme", "Documentos/zzz-tarde.txt": "contrato acme" });

  it("stops scanning a big folder when the index knows it, keeping what the scan found first", async () => {
    const computer = new FakeComputer(big());
    computer.index.content = [file("Documentos/informe.pdf")];

    const result = await tools(computer).SearchComputerText.run({ query: "acme" });

    expect(result).toContain("Documentos/notas.txt:1: contrato acme");
    expect(result).toContain("Documentos/informe.pdf  (document)");
    expect(result).not.toContain("zzz-tarde");
    expect(computer.reads.length).toBeLessThan(5200);
  });

  it("scans a big folder to the end when the index knows nothing", async () => {
    const computer = new FakeComputer(big());
    computer.index.content = [];

    expect(await tools(computer).SearchComputerText.run({ query: "acme" })).toContain("Documentos/zzz-tarde.txt:1");
    expect(computer.reads).toHaveLength(5202);
  });

  it("scans a big folder to the end when told to be thorough, though the index knows it", async () => {
    const computer = new FakeComputer(big());
    computer.index.content = [file("Documentos/informe.pdf")];

    const result = await tools(computer).SearchComputerText.run({ query: "acme", thorough: true });

    expect(result).toContain("Documentos/zzz-tarde.txt:1");
    expect(result).not.toContain("informe.pdf");
    expect(computer.indexCalls).toEqual([]);
  });

  it("reads every text file of a small folder itself, and still adds the documents only the index knows", async () => {
    const computer = new FakeComputer({ "Documentos/notas.txt": "contrato acme", "Documentos/otro.txt": "contrato acme tambien" });
    computer.index.content = [file("Documentos/notas.txt"), file("Documentos/informe.pdf")];

    const result = await tools(computer).SearchComputerText.run({ query: "acme" });

    expect(result).toContain("Documentos/notas.txt:1: contrato acme");
    expect(result).toContain("Documentos/otro.txt:1: contrato acme tambien");
    expect(result).toContain("Documentos/informe.pdf  (document)");
    expect(result.match(/notas\.txt/g)).toHaveLength(1);
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

  it("knows program and app data inside a user's folder, but keeps iCloud Drive and the Library itself", () => {
    for (const path of ["AppData/Local/x", "appdata", ".cache/pip", ".config/gcloud", "NTUSER.DAT", "Library/Caches/x", "library/Preferences"]) {
      expect(isHomeNoise(path), path).toBe(true);
    }
    for (const path of ["Desktop/a.txt", "Documents/AppData/a.txt", "Library", "Library/Mobile Documents/x", "OneDrive/a.docx"]) {
      expect(isHomeNoise(path), path).toBe(false);
    }
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
