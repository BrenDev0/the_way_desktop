import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computerTools } from "../../src/core/tools/computer";
import { ComputerGrants } from "../../src/main/computerGrants";
import { ComputerLog } from "../../src/main/computerLog";
import { NodeComputer, type ComputerPrompts, type NodeComputerOptions } from "../../src/main/nodeComputer";
import type { SearchKind, SystemSearch } from "../../src/main/systemSearch";

let base: string;
let data: string;
let docs: string;
let outside: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "the-way-computer-"));
  data = join(base, "userdata");
  docs = join(base, "Documentos");
  outside = join(base, "outside");
  await mkdir(data);
  await mkdir(join(docs, "contratos"), { recursive: true });
  await mkdir(join(docs, ".ssh"), { recursive: true });
  await mkdir(outside);
  await writeFile(join(docs, "contratos", "acme.txt"), "contrato de acme");
  await writeFile(join(docs, ".env"), "SECRET=1");
  await writeFile(join(docs, ".ssh", "id_rsa"), "key");
  await writeFile(join(outside, "secret.txt"), "top secret");
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

async function computer(picks: (string | null)[] = [], options: NodeComputerOptions = {}) {
  const grants = new ComputerGrants(data);
  await grants.claim("ana");
  const queue = [...picks];
  const next = () => queue.shift() ?? null;
  const asked: string[] = [];
  const extracted: { name: string; text: string }[] = [];
  const prompts: ComputerPrompts = {
    ask: async (reason) => {
      asked.push(reason);
      const picked = next();
      if (picked === null) return null;
      return picked === "HOME" ? { kind: "home" } : { kind: "folder", path: picked };
    },
    folder: async () => next(),
  };
  const access = new NodeComputer(
    grants,
    prompts,
    async (name, data) => {
      const text = new TextDecoder().decode(data);
      extracted.push({ name, text });
      return `extraído: ${text}`;
    },
    options,
  );
  return { grants, access, extracted, asked, tools: computerTools(access) };
}

describe("ComputerGrants", () => {
  it("remembers a grant for the account that made it", async () => {
    const first = await computer();
    await first.grants.add(docs);

    const again = new ComputerGrants(data);
    await again.claim("ana");

    expect((await again.list()).map((g) => g.label)).toEqual(["Documentos"]);
  });

  it("starts another account with none", async () => {
    const first = await computer();
    await first.grants.add(docs);

    const next = new ComputerGrants(data);
    await next.claim("bob");

    expect(await next.list()).toEqual([]);
    const reread = new ComputerGrants(data);
    await reread.claim("bob");
    expect(await reread.list()).toEqual([]);
  });

  it("does not grant the same folder twice, and can take a grant back", async () => {
    const { grants } = await computer();
    const one = await grants.add(docs);
    const two = await grants.add(docs);

    expect(two.id).toBe(one.id);
    expect(await grants.list()).toHaveLength(1);
    expect(await grants.remove(one.id)).toEqual([]);
  });

  it("refuses a whole drive, a folder that is not there, and a folder of keys", async () => {
    const { grants } = await computer();

    await expect(grants.add(parse(docs).root)).rejects.toThrow(/whole drive/);
    await expect(grants.add(join(base, "nada"))).rejects.toThrow(/not available/);
    await expect(grants.add(join(docs, ".ssh"))).rejects.toThrow(/credentials or keys/);
  });
});

describe("NodeComputer", () => {
  it("grants the folder the user picks, and reads inside it", async () => {
    const { tools } = await computer([docs]);

    expect(await tools.RequestComputerAccess.run({ reason: "buscar" })).toContain("'Documentos'");
    expect(await tools.ReadComputerFile.run({ path: "Documentos/contratos/acme.txt" })).toBe("contrato de acme");
    expect(await tools.SearchComputer.run({ query: "acme" })).toBe("Documentos/contratos/acme.txt");
  });

  it("reports no grant when the user cancels the picker", async () => {
    const { tools, grants } = await computer([null]);

    expect(await tools.RequestComputerAccess.run({ reason: "buscar" })).toMatch(/did not allow it/);
    expect(await grants.list()).toEqual([]);
  });

  it("refuses a folder that was never granted", async () => {
    const { tools } = await computer([docs]);
    await tools.RequestComputerAccess.run({ reason: "buscar" });

    await expect(tools.ReadComputerFile.run({ path: "Otra/a.txt" })).rejects.toThrow(/not a folder the user has granted/);
  });

  it("refuses to climb out of the grant", async () => {
    const { tools } = await computer([docs]);
    await tools.RequestComputerAccess.run({ reason: "buscar" });

    await expect(tools.ReadComputerFile.run({ path: "Documentos/../outside/secret.txt" })).rejects.toThrow(/outside/);
    await expect(tools.ReadComputerFile.run({ path: join(outside, "secret.txt") })).rejects.toThrow();
  });

  it("refuses to follow a link out of the grant, and does not walk into it", async (context) => {
    const { tools } = await computer([docs]);
    await tools.RequestComputerAccess.run({ reason: "buscar" });
    try {
      await symlink(outside, join(docs, "escape"), "junction");
    } catch {
      context.skip();
    }

    await expect(tools.ReadComputerFile.run({ path: "Documentos/escape/secret.txt" })).rejects.toThrow(/outside/);
    expect(await tools.SearchComputer.run({ query: "secret" })).toMatch(/Nothing matches/);
  });

  it("never lists, searches or reads credentials and keys, even inside a grant", async () => {
    const { tools } = await computer([docs]);
    await tools.RequestComputerAccess.run({ reason: "buscar" });

    expect(await tools.ListComputerFolder.run({ path: "Documentos" })).toBe("contratos/");
    expect(await tools.SearchComputer.run({ query: "env" })).toMatch(/Nothing matches/);
    expect(await tools.SearchComputer.run({ query: "id_rsa" })).toMatch(/Nothing matches/);
    await expect(tools.ReadComputerFile.run({ path: "Documentos/.env" })).rejects.toThrow(/credentials or keys/);
    await expect(tools.ReadComputerFile.run({ path: "Documentos/.ssh/id_rsa" })).rejects.toThrow(/credentials or keys/);
  });

  it("reads a document through the extractor, with its own name and bytes", async () => {
    const { tools, extracted } = await computer([docs]);
    await tools.RequestComputerAccess.run({ reason: "buscar" });
    await writeFile(join(docs, "contratos", "acme.pdf"), "bytes del pdf");

    expect(await tools.ReadComputerFile.run({ path: "Documentos/contratos/acme.pdf" })).toBe("extraído: bytes del pdf");
    expect(extracted).toEqual([{ name: "acme.pdf", text: "bytes del pdf" }]);
  });

  it("never sends a document from a protected folder to the extractor", async () => {
    const { tools, extracted } = await computer([docs]);
    await tools.RequestComputerAccess.run({ reason: "buscar" });
    await writeFile(join(docs, ".ssh", "notas.pdf"), "x");

    await expect(tools.ReadComputerFile.run({ path: "Documentos/.ssh/notas.pdf" })).rejects.toThrow(/credentials or keys/);
    expect(extracted).toEqual([]);
  });

  it("has no way to write", async () => {
    const { access } = await computer();

    for (const name of ["writeBytes", "makeDirectory", "copy", "move", "remove"]) {
      expect(name in access, name).toBe(false);
    }
  });
});

describe("NodeComputer with the system index", () => {
  const answering = (paths: (string | null)[] | null) => {
    const asked: { root: string; terms: string[]; kind: SearchKind }[] = [];
    const system: SystemSearch = {
      search: async (root, terms, kind) => {
        asked.push({ root, terms, kind });
        return paths ? (paths as string[]) : null;
      },
    };
    return { system, asked };
  };

  it("turns what the index found into granted paths, with what each one is", async () => {
    const { system, asked } = answering([join(docs, "contratos", "acme.txt"), join(docs, "contratos")]);
    const { access } = await computer([docs], { system });
    await access.choose("buscar");

    const found = await access.indexed("Documentos", ["acme"], "name");

    expect(found).toEqual([
      { path: "Documentos/contratos/acme.txt", isDirectory: false, size: 16, cloudOnly: false },
      { path: "Documentos/contratos", isDirectory: true, size: 0, cloudOnly: false },
    ]);
    expect(asked).toHaveLength(1);
    expect(asked[0].terms).toEqual(["acme"]);
    expect(asked[0].kind).toBe("name");
  });

  it("asks the index about the folder searched, not the whole grant", async () => {
    const { system, asked } = answering([]);
    const { access } = await computer([docs], { system });
    await access.choose("buscar");

    await access.indexed("Documentos/contratos", ["acme"], "content");

    expect(asked[0].root.endsWith(join("Documentos", "contratos"))).toBe(true);
    expect(asked[0].kind).toBe("content");
  });

  it("drops what is outside the grant, what holds credentials, and what is gone", async () => {
    const { system } = answering([
      join(outside, "secret.txt"),
      join(docs, ".env"),
      join(docs, ".ssh", "id_rsa"),
      join(docs, "ya-no-existe.txt"),
      docs,
      join(docs, "contratos", "acme.txt"),
    ]);
    const { access } = await computer([docs], { system });
    await access.choose("buscar");

    const found = await access.indexed("Documentos", ["x"], "name");

    expect(found?.map((entry) => entry.path)).toEqual(["Documentos/contratos/acme.txt"]);
  });

  it("drops a link that leads out of the grant", async (context) => {
    const { system } = answering([join(docs, "escape", "secret.txt")]);
    const { access } = await computer([docs], { system });
    await access.choose("buscar");
    try {
      await symlink(outside, join(docs, "escape"), "junction");
    } catch {
      context.skip();
    }

    expect(await access.indexed("Documentos", ["secret"], "name")).toEqual([]);
  });

  it("answers null when there is no index, or it could not answer, so the caller walks instead", async () => {
    const none = await computer([docs]);
    await none.access.choose("buscar");
    const broken = await computer([docs], { system: answering(null).system });
    await broken.access.choose("buscar");

    expect(await none.access.indexed("Documentos", ["a"], "name")).toBeNull();
    expect(await broken.access.indexed("Documentos", ["a"], "name")).toBeNull();
  });

  it("refuses a folder that was not granted, and never asks the index about it", async () => {
    const { system, asked } = answering([]);
    const { access } = await computer([docs], { system });
    await access.choose("buscar");

    await expect(access.indexed("Otra", ["a"], "name")).rejects.toThrow(/not a folder the user has granted/);
    expect(asked).toEqual([]);
  });

  it("does not ask the index about a protected folder", async () => {
    const { system, asked } = answering([]);
    const { access } = await computer([docs], { system });
    await access.choose("buscar");

    expect(await access.indexed("Documentos/.ssh", ["a"], "name")).toEqual([]);
    expect(asked).toEqual([]);
  });
});

describe("NodeComputer and files kept only in the cloud", () => {
  const CLOUD_SIZE = 5000;
  const flagged = { cloudOnly: (size: number) => size === CLOUD_SIZE };

  beforeEach(async () => {
    await writeFile(join(docs, "nube.txt"), "n".repeat(CLOUD_SIZE));
    await writeFile(join(docs, "local.txt"), "hola");
  });

  it("flags them when asked about them, and when listing and walking", async () => {
    const { access } = await computer([docs], flagged);
    await access.choose("buscar");

    expect((await access.stat("Documentos/nube.txt")).cloudOnly).toBe(true);
    expect((await access.stat("Documentos/local.txt")).cloudOnly).toBe(false);
    const listed = await access.list("Documentos");
    expect(listed.find((entry) => entry.name === "nube.txt")?.cloudOnly).toBe(true);
    expect(listed.find((entry) => entry.name === "local.txt")?.cloudOnly).toBe(false);
    const walked: Record<string, boolean | undefined> = {};
    for await (const entry of access.walk("Documentos", () => true)) walked[entry.path] = entry.cloudOnly;
    expect(walked["Documentos/nube.txt"]).toBe(true);
    expect(walked["Documentos/local.txt"]).toBe(false);
  });

  it("refuses to open them, so nothing is downloaded", async () => {
    const { access, tools } = await computer([docs], flagged);
    await access.choose("buscar");

    await expect(access.readBytes("Documentos/nube.txt")).rejects.toThrow(/only in the cloud/);
    await expect(tools.ReadComputerFile.run({ path: "Documentos/nube.txt" })).rejects.toThrow(/only in the cloud/);
    await expect(access.document("Documentos/nube.txt")).rejects.toThrow(/only in the cloud/);
    expect(await tools.ReadComputerFile.run({ path: "Documentos/local.txt" })).toBe("hola");
  });

  it("flags what the index returns", async () => {
    const system: SystemSearch = { search: async () => [join(docs, "nube.txt"), join(docs, "local.txt")] };
    const { access } = await computer([docs], { ...flagged, system });
    await access.choose("buscar");

    const found = await access.indexed("Documentos", ["txt"], "name");

    expect(found?.map((entry) => [entry.path, entry.cloudOnly])).toEqual([
      ["Documentos/nube.txt", true],
      ["Documentos/local.txt", false],
    ]);
  });

  it("does not mistake an ordinary file on this disk for one", async () => {
    await writeFile(join(docs, "grande.txt"), "g".repeat(200_000));
    const { access } = await computer([docs]);
    await access.choose("buscar");

    expect((await access.stat("Documentos/grande.txt")).cloudOnly).toBe(false);
    expect((await access.stat("Documentos/local.txt")).cloudOnly).toBe(false);
  });
});

describe("NodeComputer and the record", () => {
  it("notes a folder being opened to the agent", async () => {
    const log = new ComputerLog(data);
    await log.claim("ana");
    const { access } = await computer([docs], { log });

    await access.choose("buscar");
    await log.recent();

    expect((await log.recent()).map((entry) => [entry.tool, entry.detail, entry.ok])).toEqual([["GrantAdded", "Documentos", true]]);
  });

  it("notes nothing when the user picks no folder", async () => {
    const log = new ComputerLog(data);
    await log.claim("ana");
    const { access } = await computer([null], { log });

    await access.choose("buscar");

    expect(await log.recent()).toEqual([]);
  });
});

describe("searching the user's own folder", () => {
  let home: string;

  beforeEach(async () => {
    home = join(base, "home");
    const files: Record<string, string> = {
      "Desktop/informe-acme.txt": "informe de acme",
      "Documents/contratos/acme.txt": "contrato de acme",
      "Library/Caches/basura.txt": "acme cache",
      "Library/Mobile Documents/com~apple~CloudDocs/nube-acme.txt": "acme en icloud",
      "AppData/Local/Chrome/acme.txt": "acme appdata",
      ".config/gcloud/acme.txt": "acme config",
      ".ssh/id_rsa": "key",
      ".env": "SECRET=1",
      "NTUSER.DAT": "registro",
    };
    for (const [path, content] of Object.entries(files)) {
      await mkdir(join(home, path, ".."), { recursive: true });
      await writeFile(join(home, path), content);
    }
  });

  const allowed = (options: NodeComputerOptions = {}) => computer(["HOME"], { home, ...options });

  it("asks the user once, then has the whole folder under a label of its own", async () => {
    const { tools, asked } = await allowed();

    const first = await tools.RequestComputerAccess.run({ reason: "Buscar el informe de Acme" });
    const second = await tools.RequestComputerAccess.run({ reason: "otra vez" });

    expect(first).toContain("whole folder, 'Usuario'");
    expect(first).toContain("SearchComputer");
    expect(second).toContain("whole folder, 'Usuario'");
    expect(asked).toEqual(["Buscar el informe de Acme"]);
  });

  it("finds a file wherever it is in the user's folder, without being told where", async () => {
    const { tools } = await allowed();
    await tools.RequestComputerAccess.run({ reason: "buscar" });

    const result = await tools.SearchComputer.run({ query: "acme" });

    expect(result.split("\n").sort()).toEqual([
      "Usuario/Desktop/informe-acme.txt",
      "Usuario/Documents/contratos/acme.txt",
      "Usuario/Library/Mobile Documents/com~apple~CloudDocs/nube-acme.txt",
    ]);
  });

  it("finds text inside files, too", async () => {
    const { tools } = await allowed();
    await tools.RequestComputerAccess.run({ reason: "buscar" });

    const result = await tools.SearchComputerText.run({ query: "contrato acme" });

    expect(result).toContain("Usuario/Documents/contratos/acme.txt:1: contrato de acme");
    expect(result).not.toContain("AppData");
    expect(result).not.toContain("Caches");
  });

  it("leaves out program and app data, and what holds credentials", async () => {
    const { tools } = await allowed();
    await tools.RequestComputerAccess.run({ reason: "buscar" });

    expect(await tools.ListComputerFolder.run({ path: "Usuario" })).toBe("Desktop/\nDocuments/\nLibrary/");
    expect(await tools.ListComputerFolder.run({ path: "Usuario/Library" })).toBe("Mobile Documents/");
    await expect(tools.ReadComputerFile.run({ path: "Usuario/AppData/Local/Chrome/acme.txt" })).rejects.toThrow(/program or app data/);
    await expect(tools.ReadComputerFile.run({ path: "Usuario/Library/Caches/basura.txt" })).rejects.toThrow(/program or app data/);
    await expect(tools.ReadComputerFile.run({ path: "Usuario/.config/gcloud/acme.txt" })).rejects.toThrow(/program or app data/);
    await expect(tools.ReadComputerFile.run({ path: "Usuario/NTUSER.DAT" })).rejects.toThrow(/program or app data/);
    await expect(tools.ReadComputerFile.run({ path: "Usuario/.env" })).rejects.toThrow(/credentials or keys/);
  });

  it("does not hide folders of those names in a folder the user picked by hand", async () => {
    const picked = join(base, "elegida");
    await mkdir(join(picked, "AppData"), { recursive: true });
    await writeFile(join(picked, "AppData", "nota.txt"), "mis notas");
    const { tools } = await computer([picked]);
    await tools.RequestComputerAccess.run({ reason: "buscar" });

    expect(await tools.ReadComputerFile.run({ path: "elegida/AppData/nota.txt" })).toBe("mis notas");
  });

  it("filters the index's answers the same way", async () => {
    const system: SystemSearch = {
      search: async () => [
        join(home, "Desktop", "informe-acme.txt"),
        join(home, "AppData", "Local", "Chrome", "acme.txt"),
        join(home, "Library", "Caches", "basura.txt"),
        join(home, ".env"),
        join(home, "Library", "Mobile Documents", "com~apple~CloudDocs", "nube-acme.txt"),
      ],
    };
    const { access } = await allowed({ system });
    await access.choose("buscar");

    const found = await access.indexed("Usuario", ["acme"], "name");

    expect(found?.map((entry) => entry.path)).toEqual([
      "Usuario/Desktop/informe-acme.txt",
      "Usuario/Library/Mobile Documents/com~apple~CloudDocs/nube-acme.txt",
    ]);
  });

  it("is remembered, and a person can add it by hand and take it back", async () => {
    const { grants, access } = await allowed();

    await access.addHome();
    await access.addHome();

    expect((await grants.list()).map((grant) => [grant.label, grant.kind])).toEqual([["Usuario", "home"]]);
    const again = new ComputerGrants(data);
    await again.claim("ana");
    expect((await again.list())[0].kind).toBe("home");
    expect(await again.remove((await again.list())[0].id)).toEqual([]);
  });

  it("is not granted when the user refuses, and says so to the agent", async () => {
    const { tools, grants } = await computer([null], { home });

    expect(await tools.RequestComputerAccess.run({ reason: "buscar" })).toMatch(/did not allow it/);
    expect(await grants.list()).toEqual([]);
  });

  it("still lets the user pick one folder instead, from the same question", async () => {
    const { tools } = await computer([docs], { home });

    expect(await tools.RequestComputerAccess.run({ reason: "buscar" })).toMatch(/Read-only access granted to 'Documentos'\. Use paths/);
  });

  it("notes the grant in the record, whichever way it was given", async () => {
    const log = new ComputerLog(data);
    await log.claim("ana");
    const { tools } = await computer(["HOME"], { home, log });

    await tools.RequestComputerAccess.run({ reason: "buscar" });

    expect((await log.recent()).map((entry) => [entry.tool, entry.detail])).toEqual([["GrantAdded", "Usuario"]]);
  });
});
